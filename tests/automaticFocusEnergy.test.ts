import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { freshPet, petReducer } from '../src/petState.ts'
import type { PetAction, PetState } from '../src/petState.ts'
import { isPetState, migratePet, readPet, STORAGE_KEY, transactPet } from '../src/storage.ts'
import type { SyncSummaryV2 } from '../src/integration/syncDomain.ts'
import { APP_ORIGIN } from '../src/integration/localConfig.ts'

process.env.TZ = 'Asia/Manila'
const minute = 60_000
const noon = new Date(2026, 10, 16, 12).getTime()
const day = '2026-11-16'
const extensionId = 'a'.repeat(32)
const adopted = (at = noon) => petReducer(freshPet(at), { type: 'adopt' })
function connected(state = adopted(), at = noon): PetState {
  const reserved = petReducer(state, { type: 'sync-reserve', pairing: {
    extensionId, epochId: 'focus-energy-epoch', token: 'focus_energy_capability_'.padEnd(40, 'x'), origin: APP_ORIGIN, reservedAt: at,
  } })
  return petReducer(reserved, { type: 'sync-activate', epochId: 'focus-energy-epoch', extensionId, cutoffAt: at })
}
function summary(milliseconds: number, id = 'focus-one', at = noon, changes: Partial<SyncSummaryV2> = {}): SyncSummaryV2 {
  const date = new Date(at)
  return { schemaVersion: 2, source: 'extension', epochId: 'focus-energy-epoch', eventId: id, revision: 1,
    category: 'Focus', startedAtIso: date.toISOString(), endedAtIso: new Date(at + milliseconds).toISOString(), activeDurationMs: milliseconds,
    timeZone: 'Asia/Manila', localDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    finalized: false, ...changes }
}
const ingest = (snapshots: SyncSummaryV2[], now = noon + 11 * 60 * minute): PetAction => ({ type: 'sync-ingest', epochId: 'focus-energy-epoch', snapshots, now })
function v6(state: PetState) {
  const care = { ...state.care }
  Reflect.deleteProperty(care, 'focusEnergyPolicyAt')
  Reflect.deleteProperty(care, 'focusEnergyDays')
  return { ...state, version: 6, care }
}
function storageFixture(initial: unknown) {
  let raw = JSON.stringify(initial), failWrites = false, writes = 0
  let queue = Promise.resolve()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => key === STORAGE_KEY ? raw : null,
    setItem: (_key: string, value: string) => { if (failWrites) throw new Error('Storage unavailable'); raw = value; writes++ },
  } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: <T>(name: string, callback: () => T) => {
      assert.equal(name, 'mochi.progress.update')
      const result = queue.then(callback)
      queue = result.then(() => undefined, () => undefined)
      return result
    },
  } } })
  return { raw: () => raw, writes: () => writes, fail: (value: boolean) => { failWrites = value } }
}

test('automatic Focus combines 0.5 and 4.5 active minutes across entries with millisecond precision', () => {
  const first = petReducer(connected(), ingest([summary(30_000)]))
  assert.equal(first.care.energy, 80)
  assert.deepEqual(first.care.focusEnergyDays[day], { observedMs: 30_000, remainderMs: 30_000 })
  const second = petReducer(first, ingest([summary(270_000, 'focus-two', noon + minute)]))
  assert.equal(second.care.energy, 79)
  assert.deepEqual(second.care.focusEnergyDays[day], { observedMs: 5 * minute, remainderMs: 0 })
  assert.deepEqual([second.xp, second.foodCredits, second.care.fullness], [0, 0, 80])
  const thirty = petReducer(connected(), ingest([summary(30 * minute)]))
  assert.deepEqual([thirty.care.energy, thirty.xp, thirty.foodCredits], [74, 10, 4])
})

test('cumulative retries, duplicate batch entries, and old revisions never repeat automatic energy loss', () => {
  const partial = summary(30_000)
  const complete = summary(5 * minute, 'focus-one', noon, { revision: 2 })
  let state = petReducer(connected(), ingest([partial]))
  state = petReducer(state, ingest([complete, complete]))
  assert.equal(state.care.energy, 79)
  const care = state.care
  state = petReducer(state, ingest([partial, complete]))
  assert.equal(state.care, care)
  assert.equal(state.extensionSync.summaries[0].revision, 2)
  assert.equal(state.care.focusEnergyDays[day].observedMs, 5 * minute)
  assert.equal(petReducer(state, { type: 'care-tick', now: noon + 60 * minute }), state, 'wall time without a timer or Rest is not active Focus')
})

test('partial Focus energy blocks stay in their original local calendar day around midnight', () => {
  const late = new Date(2026, 10, 16, 23, 55).getTime()
  const midnight = new Date(2026, 10, 17, 0).getTime()
  let state = connected(adopted(late), late)
  state = petReducer(state, ingest([summary(270_000, 'late', late), summary(30_000, 'early', midnight)], midnight + minute))
  assert.equal(state.care.energy, 80)
  assert.equal(state.care.focusEnergyDays[day].remainderMs, 270_000)
  assert.equal(state.care.focusEnergyDays['2026-11-17'].remainderMs, 30_000)
  state = petReducer(state, ingest([summary(270_000, 'next-block', midnight + minute)], midnight + 6 * minute))
  assert.equal(state.care.energy, 79)
  assert.equal(state.care.focusEnergyDays['2026-11-17'].remainderMs, 0)
})

test('all accepted active Focus uses energy beyond the XP cap and zero energy never blocks rewards', () => {
  const long = summary(540 * minute)
  let state = petReducer(connected(), ingest([long]))
  assert.deepEqual([state.care.energy, state.xp, state.foodCredits], [0, 80, 32])
  state = petReducer(state, ingest([summary(545 * minute, 'focus-one', noon, { revision: 2 })]))
  assert.equal(state.care.focusEnergyDays[day].observedMs, 545 * minute)
  assert.equal(state.care.focusEnergyDays[day].remainderMs, 0)
  state = petReducer(state, { type: 'care-rest-start', id: 'rest-recover', now: noon + 550 * minute })
  state = petReducer(state, { type: 'care-wake', restId: 'rest-recover', now: noon + 555 * minute })
  assert.equal(state.care.energy, 5)
  state = petReducer(state, ingest([long], noon + 556 * minute))
  assert.equal(state.care.energy, 5, 'clamped previously consumed blocks cannot be replayed after Rest')
  assert.deepEqual([state.xp, state.foodCredits], [80, 32])
})

test('Leisure allowance edits do not reset the separate automatic Focus partial or cutoff', () => {
  let state = petReducer(connected(), ingest([summary(150_000)]))
  const policyAt = state.care.focusEnergyPolicyAt
  state = petReducer(state, { type: 'care-allowance', minutes: 0, now: noon + 3 * minute })
  assert.equal(state.care.focusEnergyPolicyAt, policyAt)
  assert.equal(state.care.focusEnergyDays[day].remainderMs, 150_000)
  state = petReducer(state, ingest([summary(150_000, 'second-half', noon + 4 * minute)]))
  assert.equal(state.care.energy, 79)
})

test('Neutral, Leisure, optional Manual Focus, and elapsed gaps do not invent automatic energy use', () => {
  let state = connected()
  state = petReducer(state, { type: 'log', activity: { id: 'optional-manual', source: 'Manual', category: 'Focus',
    duration: 240, note: '', timestamp: new Date(noon).toISOString() } })
  state = petReducer(state, ingest([summary(60 * minute, 'neutral', noon, { category: 'Neutral' }),
    summary(60 * minute, 'leisure', noon, { category: 'Leisure' })]))
  state = petReducer(state, ingest([summary(500, 'active-with-gap', noon, { endedAtIso: new Date(noon + 10 * 60 * minute).toISOString() })]))
  state = petReducer(state, { type: 'care-tick', now: noon + 20 * 24 * 60 * minute })
  assert.equal(state.care.energy, 80)
  assert.deepEqual(state.care.focusEnergyDays[day], { observedMs: 500, remainderMs: 500 })
})

test('sticky browser authority prevents optional timer energy from duplicating tracked Focus even while disconnected', () => {
  let state = petReducer(connected(), { type: 'timer-start', id: 'timer-optional', duration: 15, now: noon })
  state = petReducer(state, { type: 'timer-pause', id: 'timer-optional', now: noon + 5 * minute })
  assert.equal(state.care.energy, 80)
  assert.equal(state.care.timerEnergy?.accountedBlocks, 1)
  state = petReducer(state, { type: 'timer-resume', id: 'timer-optional', now: noon + 10 * minute })
  state = petReducer(state, ingest([summary(15 * minute)], noon + 20 * minute))
  assert.equal(state.care.energy, 77)
  state = petReducer(state, { type: 'timer-save', id: 'timer-optional', now: noon + 20 * minute })
  assert.deepEqual([state.care.energy, state.xp, state.foodCredits, state.activities.length], [77, 5, 2, 1])
  assert.equal(state.activities[0].source, 'Timer')
  const disconnected = { ...state, extensionSync: { ...state.extensionSync, pairing: null } }
  state = petReducer(disconnected, { type: 'timer-start', id: 'timer-offline-optional', duration: 10, now: noon + 30 * minute })
  state = petReducer(state, { type: 'timer-cancel', id: 'timer-offline-optional', now: noon + 40 * minute })
  assert.equal(state.care.energy, 77)
  assert.equal(state.extensionSync.authorityStartedAt, noon)
  assert.equal(isPetState(state), true)
  const localTimer = petReducer(adopted(), { type: 'timer-start', id: 'timer-local', duration: 10, now: noon })
  assert.equal(petReducer(localTimer, { type: 'care-tick', now: noon + 10 * minute }).care.energy, 78)
})

test('v6 migration preserves all saved care and progress, baselining accepted automatic Focus without replay', () => {
  let state = connected(adopted(noon - 60 * minute), noon - 60 * minute)
  state = petReducer(state, ingest([summary(30 * minute, 'existing-focus', noon - 50 * minute)], noon - 20 * minute))
  state = petReducer(state, { type: 'timer-start', id: 'timer-preserved', duration: 25, now: noon - 10 * minute })
  state = petReducer(state, { type: 'timer-pause', id: 'timer-preserved', now: noon - 4 * minute })
  state = petReducer(state, { type: 'care-rest-start', id: 'rest-preserved', now: noon - 3 * minute })
  state = { ...state, dailyFocusGoal: 90, foodCredits: 2, care: { ...state.care, fullness: 34, energy: 61 } }
  const old = v6(state), original = JSON.stringify(old)
  const migrated = migratePet(old, noon)!
  assert.equal(migrated.version, 7)
  const withoutNewFields = { ...migrated.care }
  Reflect.deleteProperty(withoutNewFields, 'focusEnergyPolicyAt')
  Reflect.deleteProperty(withoutNewFields, 'focusEnergyDays')
  assert.deepEqual(withoutNewFields, old.care)
  assert.deepEqual({ ...migrated, version: 6, care: old.care }, old)
  assert.deepEqual(migrated.care.focusEnergyDays[day], { observedMs: 30 * minute, remainderMs: 0 })
  assert.equal(migrated.care.focusEnergyPolicyAt, noon)
  assert.equal(JSON.stringify(old), original)
  assert.deepEqual(migratePet(migrated, noon + minute), migrated)
  assert.equal(isPetState(migrated), true)
})

test('an already connected v6 running timer retains its old cursor but cannot add a second energy debit', () => {
  const running = petReducer(connected(adopted(noon - 30 * minute), noon - 30 * minute), {
    type: 'timer-start', id: 'timer-old-connected', duration: 30, now: noon - 10 * minute,
  })
  const previous = { ...running, care: { ...running.care, energy: 67,
    timerEnergy: { timerId: 'timer-old-connected', baselineActiveMs: 0, accountedBlocks: 1 } } }
  let migrated = migratePet(v6(previous), noon)!
  assert.deepEqual(migrated.care.timerEnergy, previous.care.timerEnergy)
  assert.deepEqual(migrated.timer, previous.timer)
  migrated = petReducer(migrated, { type: 'care-tick', now: noon + 10 * minute })
  assert.equal(migrated.care.energy, 67)
  assert.equal(migrated.care.timerEnergy?.accountedBlocks, 4)
  migrated = petReducer(migrated, ingest([summary(5 * minute, 'new-real-focus')], noon + 10 * minute))
  assert.equal(migrated.care.energy, 66)
})

test('migration and unseen first mixed snapshots baseline ambiguous pre-policy Focus; later deltas charge once', () => {
  let state = connected(adopted(noon - 60 * minute), noon - 60 * minute)
  const old = summary(10 * minute, 'old-focus', noon - 30 * minute)
  state = petReducer(state, ingest([old], noon - 20 * minute))
  state = { ...state, care: { ...state.care, energy: 53 } }
  state = migratePet(v6(state), noon)!
  const crossing = summary(40 * minute, 'old-focus', noon - 30 * minute, { revision: 2 })
  const unseen = summary(20 * minute, 'unseen-buffer', noon - 5 * minute)
  state = petReducer(state, ingest([crossing, unseen], noon + 15 * minute))
  assert.equal(state.care.energy, 53)
  const precise = summary(45 * minute, 'old-focus', noon - 30 * minute, { revision: 3 })
  state = petReducer(state, ingest([precise], noon + 20 * minute))
  assert.equal(state.care.energy, 52)
  state = petReducer(state, ingest([crossing, unseen], noon + 20 * minute))
  assert.equal(state.care.energy, 52)
})

test('intentional Rest clears pending Focus fractions and baselines sleep time and a buffered wake crossing', () => {
  let state = { ...connected(), care: { ...connected().care, energy: 50 } }
  const partial = summary(270_000)
  state = petReducer(state, ingest([partial], noon + 5 * minute))
  state = petReducer(state, { type: 'care-rest-start', id: 'rest-focus-boundary', now: noon + 5 * minute })
  assert.equal(state.care.focusEnergyDays[day].remainderMs, 0)
  const asleep = summary(10 * minute, 'asleep-focus', noon + 5 * minute)
  state = petReducer(state, ingest([asleep], noon + 15 * minute))
  assert.equal(state.care.energy, 50)
  const xpDuringRest = state.xp
  state = petReducer(state, { type: 'care-wake', restId: 'rest-focus-boundary', now: noon + 15 * minute })
  assert.equal(state.care.energy, 60)
  assert.equal(state.xp, xpDuringRest, 'Rest and waking do not award Focus XP')
  assert.equal(state.care.focusEnergyPolicyAt, noon + 15 * minute)
  const buffered = summary(10 * minute, 'buffered-across-wake', noon + 10 * minute)
  state = petReducer(state, ingest([buffered], noon + 20 * minute))
  assert.equal(state.care.energy, 60)
  const precise = summary(15 * minute, 'buffered-across-wake', noon + 10 * minute, { revision: 2 })
  state = petReducer(state, ingest([precise], noon + 25 * minute))
  assert.equal(state.care.energy, 59)
  const exactWakeHalf = summary(150_000, 'wake-half', noon + 15 * minute)
  state = petReducer(state, ingest([exactWakeHalf], noon + 25 * minute))
  assert.equal(state.care.energy, 59, 'the discarded pre-Rest 4.5 minutes must not combine with new Focus')
  state = petReducer(state, ingest([summary(150_000, 'wake-other-half', noon + 20 * minute)], noon + 25 * minute))
  assert.equal(state.care.energy, 58)
})

test('no-op migration persists its Focus cutoff; failed writes and concurrent retries consume one energy delta', async () => {
  let previous = connected(adopted(noon - 60 * minute), noon - 60 * minute)
  previous = petReducer(previous, ingest([summary(30 * minute, 'old-accepted', noon - 50 * minute)], noon - 20 * minute))
  previous = { ...previous, care: { ...previous.care, energy: 45 } }
  const fixture = storageFixture(v6(previous))
  const migrated = await transactPet({ type: 'care-tick', now: noon })
  assert.equal(migrated.changed, false)
  assert.deepEqual([migrated.xpAwarded, migrated.creditsAwarded], [0, 0])
  assert.equal(JSON.parse(fixture.raw()).version, 7)
  assert.equal(fixture.writes(), 1)
  assert.equal(readPet(noon + minute).care.focusEnergyPolicyAt, noon)
  const action = ingest([summary(5 * minute, 'new-focus')], noon + 5 * minute)
  const before = fixture.raw()
  fixture.fail(true)
  await assert.rejects(transactPet(action), /cannot be saved/)
  assert.equal(fixture.raw(), before)
  fixture.fail(false)
  await Promise.all([transactPet(action), transactPet(action), transactPet(action)])
  assert.equal(readPet().care.energy, 44)
  assert.equal(readPet().care.focusEnergyDays[day].observedMs, 35 * minute)
  assert.equal(readPet().extensionSync.summaries.length, 2)
  assert.equal(readPet().care.focusEnergyPolicyAt, noon)
})

test('new Focus energy schema rejects malformed cursors without overwriting saved data', () => {
  const state = connected()
  for (const care of [{ ...state.care, focusEnergyPolicyAt: -1 }, { ...state.care, focusEnergyPolicyAt: Infinity },
    { ...state.care, focusEnergyDays: { [day]: { observedMs: 300_000, remainderMs: 300_000 } } },
    { ...state.care, focusEnergyDays: { [day]: { observedMs: 1, remainderMs: 2 } } },
    { ...state.care, focusEnergyDays: { [day]: { observedMs: 1.5, remainderMs: 0 } } },
    { ...state.care, focusEnergyDays: { '2026-11-31': { observedMs: 1, remainderMs: 0 } } }]) {
    assert.equal(isPetState({ ...state, care }), false)
    assert.equal(migratePet({ ...state, care }, noon), null)
  }
})
