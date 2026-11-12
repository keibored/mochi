import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { freshPet, petReducer } from '../src/petState.ts'
import type { PetAction, PetState } from '../src/petState.ts'
import { isPetState, migratePet, ProgressValidationError, readPet, savePet, STORAGE_KEY, transactPet } from '../src/storage.ts'
import { freshWebSync } from '../src/integration/syncDomain.ts'
import type { SyncPairing, SyncSummaryV2 } from '../src/integration/syncDomain.ts'
import { APP_ORIGIN } from '../src/integration/localConfig.ts'

process.env.TZ = 'Asia/Manila'
const noon = new Date(2026, 10, 12, 12).getTime()
const extensionId = 'a'.repeat(32)
const adopted = () => petReducer(freshPet(), { type: 'adopt' })
const pairing = (epochId = 'epoch-1', reservedAt = noon): Omit<SyncPairing, 'cutoffAt'> => ({
  extensionId, epochId, reservedAt, token: 'test_capability_'.padEnd(40, 'x'), origin: APP_ORIGIN,
})
function connected(state = adopted(), epochId = 'epoch-1', reservedAt = noon) {
  const reserved = petReducer(state, { type: 'sync-reserve', pairing: pairing(epochId, reservedAt) })
  return petReducer(reserved, { type: 'sync-activate', epochId, extensionId, cutoffAt: reservedAt + 1000 })
}
function summary(minutes: number, overrides: Partial<SyncSummaryV2> = {}): SyncSummaryV2 {
  return { schemaVersion: 2, source: 'extension', epochId: 'epoch-1', eventId: 'event-1', revision: 1,
    category: 'Focus', startedAtIso: new Date(noon + 1000).toISOString(),
    endedAtIso: new Date(noon + 1000 + minutes * 60_000).toISOString(), activeDurationMs: minutes * 60_000,
    timeZone: 'Asia/Manila', localDate: '2026-11-12', finalized: false, ...overrides }
}
const ingest = (snapshots: unknown, epochId = 'epoch-1', now = noon + 3 * 60 * 60_000): PetAction => ({ type: 'sync-ingest', epochId, snapshots, now })

function storageFixture(initial: unknown) {
  let raw = JSON.stringify(initial), failWrites = false
  let queue = Promise.resolve()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => key === STORAGE_KEY ? raw : null,
    setItem: (_key: string, value: string) => { if (failWrites) throw new Error('Storage unavailable'); raw = value },
  } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: <T>(name: string, callback: () => T) => {
      assert.equal(name, 'mochi.progress.update')
      const result = queue.then(callback)
      queue = result.then(() => undefined, () => undefined)
      return result
    },
  } } })
  return { raw: () => raw, fail: (value: boolean) => { failWrites = value } }
}

function logFocus(state: PetState, duration: number, id: string, at: number) {
  return petReducer(state, { type: 'log', activity: {
    id, source: 'Manual', category: 'Focus', duration, note: 'Existing focus', timestamp: new Date(at).toISOString(),
  } })
}

test('v4 migration preserves complete existing progress and active timer without replaying rewards', () => {
  let state = logFocus(adopted(), 30, 'manual-old', noon - 2 * 60 * 60_000)
  state = petReducer(state, { type: 'timer-start', id: 'timer-old', duration: 30, now: noon - 60 * 60_000 })
  state = petReducer(state, { type: 'timer-save', id: 'timer-old', now: noon - 30 * 60_000 })
  for (let feed = 0; feed < 3; feed++) state = petReducer(state, { type: 'feed' })
  state = petReducer(state, { type: 'goal', minutes: 90 })
  state = petReducer(state, { type: 'rule-save', hostname: 'study.example', category: 'Focus' })
  state = petReducer(state, { type: 'timer-start', id: 'timer-active', duration: 25, now: noon })
  state = petReducer(state, { type: 'timer-pause', id: 'timer-active', now: noon + 60_000 })
  const legacy = { ...state, version: 4 }
  Reflect.deleteProperty(legacy, 'extensionSync')
  const original = JSON.stringify(legacy)
  const migrated = migratePet(legacy)!
  assert.equal(migrated.version, 5)
  assert.deepEqual(migrated.extensionSync, freshWebSync())
  const expected = { ...legacy, version: 5, extensionSync: freshWebSync() }
  assert.deepEqual(migrated, expected)
  assert.deepEqual([migrated.xp, migrated.foodCredits], [20, 2])
  assert.deepEqual(migrated.activities.map((entry) => entry.source), ['Manual', 'Timer'])
  assert.equal(JSON.stringify(legacy), original)
  storageFixture(legacy)
  assert.deepEqual(readPet(), migrated)
  assert.equal(savePet(migrated), true)
  assert.deepEqual(readPet(), migrated)
  assert.equal(isPetState(readPet()), true)
})

test('an existing active timer blocks the first reward-authority reservation', () => {
  const running = petReducer(adopted(), { type: 'timer-start', id: 'timer-active', duration: 25, now: noon })
  const reserved = petReducer(running, { type: 'sync-reserve', pairing: pairing() })
  assert.equal(reserved, running)
  assert.equal(reserved.extensionSync.authorityStartedAt, null)
  const resolved = petReducer(running, { type: 'timer-cancel', id: 'timer-active', now: noon + 1000 })
  assert.equal(petReducer(resolved, { type: 'sync-reserve', pairing: pairing() }).extensionSync.authorityStartedAt, noon)
})

test('a fresh pet receives 10 XP and 4 credits for synced 30 minutes; feeding and reload preserve spent credits', async () => {
  storageFixture(connected())
  const synced = (await transactPet(ingest([summary(30)]))).pet
  assert.deepEqual([synced.xp, synced.foodCredits], [10, 4])
  assert.equal(synced.activities.length, 0, 'extension snapshots stay in their separate source ledger')
  const fed = (await transactPet({ type: 'feed' })).pet
  assert.deepEqual([fed.xp, fed.foodCredits], [10, 2])
  assert.deepEqual(readPet(), fed)
  const retriedAfterReload = (await transactPet(ingest([summary(30)]))).pet
  assert.deepEqual([retriedAfterReload.xp, retriedAfterReload.foodCredits], [10, 2])
  assert.equal(retriedAfterReload.extensionSync.summaries.length, 1)
})

test('concurrent tabs and duplicate snapshots award a completed block only once', async () => {
  storageFixture(connected())
  const action = ingest([summary(30), summary(30)])
  await Promise.all([transactPet(action), transactPet(action), transactPet(action)])
  const saved = readPet()
  assert.deepEqual([saved.xp, saved.foodCredits, saved.extensionSync.summaries.length], [10, 4, 1])
  await transactPet({ type: 'feed' })
  await Promise.all([transactPet(action), transactPet(action)])
  assert.deepEqual([readPet().xp, readPet().foodCredits], [10, 2])
})

test('ten historical focus minutes plus five synced minutes grant only the newly earned block', async () => {
  const prior = logFocus(adopted(), 10, 'manual-before-pair', noon - 60_000)
  const paired = connected(prior)
  assert.deepEqual(paired.extensionSync.baselineFocusMinutes, { '2026-11-12': 10 })
  storageFixture(paired)
  const result = (await transactPet(ingest([summary(5)]))).pet
  assert.deepEqual([result.xp, result.foodCredits], [5, 2])
  assert.deepEqual(result.activities, prior.activities)
})

test('manual and optional timer records do not add rewards after reservation, even before activation or while offline', () => {
  const pending = petReducer(adopted(), { type: 'sync-reserve', pairing: pairing() })
  const manual = logFocus(pending, 30, 'manual-after-cutoff', noon + 60_000)
  assert.deepEqual([manual.xp, manual.foodCredits], [0, 0])
  let timer = petReducer(manual, { type: 'timer-start', id: 'timer-optional', duration: 30, now: noon + 120_000 })
  timer = petReducer(timer, { type: 'timer-pause', id: 'timer-optional', now: noon + 180_000 })
  timer = petReducer(timer, { type: 'timer-resume', id: 'timer-optional', now: noon + 240_000 })
  timer = petReducer(timer, { type: 'timer-save', id: 'timer-optional', now: noon + 35 * 60_000 })
  assert.deepEqual([timer.xp, timer.foodCredits], [0, 0])
  assert.deepEqual(timer.activities.map((entry) => entry.source), ['Manual', 'Timer'])
  const noLivePair = { ...timer, extensionSync: { ...timer.extensionSync, pairing: null } }
  assert.equal(isPetState(noLivePair), true)
  const disconnected = logFocus(noLivePair, 60, 'manual-while-disconnected', noon + 60 * 60_000)
  assert.deepEqual([disconnected.xp, disconnected.foodCredits], [0, 0])
  assert.equal(disconnected.extensionSync.authorityStartedAt, noon)
})

test('later local-tool logs do not inflate the frozen focus baseline for synced rewards', () => {
  const before = logFocus(adopted(), 10, 'baseline-focus', noon - 60_000)
  const paired = connected(before)
  const optional = logFocus(paired, 120, 'optional-focus', noon + 60_000)
  const first = petReducer(optional, ingest([summary(5)]))
  const next = petReducer(first, ingest([summary(20, { revision: 2 })]))
  assert.deepEqual([first.xp, first.foodCredits], [5, 2])
  assert.deepEqual([next.xp, next.foodCredits], [10, 4])
  assert.deepEqual(next.extensionSync.baselineFocusMinutes, { '2026-11-12': 10 })
})

test('an old tab cannot submit even an empty batch after another tab changes the epoch', async () => {
  storageFixture(connected())
  await transactPet(ingest([summary(15)]))
  const later = noon + 2 * 60 * 60_000
  await transactPet({ type: 'sync-reserve', pairing: pairing('epoch-2', later) })
  await transactPet({ type: 'sync-activate', epochId: 'epoch-2', extensionId, cutoffAt: later + 1000 })
  const saved = JSON.stringify(readPet())
  await assert.rejects(transactPet(ingest([], 'epoch-1', later + 2000)), ProgressValidationError)
  assert.equal(JSON.stringify(readPet()), saved)
  assert.equal(readPet().extensionSync.summaries[0].epochId, 'epoch-1', 'accepted old-epoch ledger is retained')
})

test('failed writes leave rewards, spent credits and accepted revisions unchanged and retry awards only the difference', async () => {
  const fixture = storageFixture(connected())
  await transactPet(ingest([summary(30)]))
  await transactPet({ type: 'feed' })
  const before = fixture.raw()
  fixture.fail(true)
  const nextRevision = ingest([summary(45, { revision: 2 })])
  await assert.rejects(transactPet(nextRevision), /cannot be saved/)
  assert.equal(fixture.raw(), before)
  assert.deepEqual([readPet().xp, readPet().foodCredits], [10, 2])
  fixture.fail(false)
  await transactPet(nextRevision)
  await transactPet(nextRevision)
  const saved = readPet()
  assert.deepEqual([saved.xp, saved.foodCredits], [15, 4])
  assert.equal(saved.extensionSync.summaries[0].revision, 2)
})

test('conflicting snapshot batches reject atomically while valid storage remains usable', async () => {
  const fixture = storageFixture(connected())
  await transactPet(ingest([summary(30)]))
  const before = fixture.raw()
  await assert.rejects(transactPet(ingest([
    summary(15, { eventId: 'valid-addition' }), summary(20, { revision: 2 }),
  ])), ProgressValidationError)
  assert.equal(fixture.raw(), before)
  const fed = (await transactPet({ type: 'feed' })).pet
  assert.deepEqual([fed.xp, fed.foodCredits], [10, 2])
})
