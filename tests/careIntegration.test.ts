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
const noon = new Date(2026, 10, 15, 12).getTime()
const extensionId = 'a'.repeat(32)
const adopted = (now = noon) => petReducer(freshPet(now), { type: 'adopt' })

function log(state: PetState, category: 'Focus' | 'Leisure' | 'Rest' | 'Neutral', duration: number, id: string, at = noon): PetState {
  return petReducer(state, { type: 'log', activity: {
    id, category, duration, source: 'Manual', note: '', timestamp: new Date(at).toISOString(),
  } })
}

function connected(state = adopted(), at = noon) {
  const reserved = petReducer(state, { type: 'sync-reserve', pairing: {
    extensionId, epochId: 'care-epoch', token: 'care-test-capability_'.padEnd(40, 'x'), origin: APP_ORIGIN, reservedAt: at,
  } })
  return petReducer(reserved, { type: 'sync-activate', epochId: 'care-epoch', extensionId, cutoffAt: at })
}

function summary(category: SyncSummaryV2['category'], durationMs: number, id = 'care-event', start = noon, revision = 1): SyncSummaryV2 {
  const date = new Date(start)
  return { schemaVersion: 2, source: 'extension', epochId: 'care-epoch', eventId: id, revision, category,
    startedAtIso: date.toISOString(), endedAtIso: new Date(start + durationMs).toISOString(), activeDurationMs: durationMs,
    timeZone: 'Asia/Manila', localDate: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`, finalized: false }
}

const ingest = (snapshots: SyncSummaryV2[], now = noon + 4 * 60 * minute): PetAction => ({ type: 'sync-ingest', epochId: 'care-epoch', snapshots, now })

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

test('v5 care migration preserves balances, sources, goal, sync baseline, and paused timer without replay', () => {
  let existing = log(adopted(noon - 120 * minute), 'Focus', 30, 'prior-focus', noon - 110 * minute)
  existing = petReducer(existing, { type: 'feed' })
  existing = log(existing, 'Leisure', 120, 'prior-leisure', noon - 100 * minute)
  existing = petReducer(existing, { type: 'goal', minutes: 90 })
  existing = petReducer(existing, { type: 'rule-save', hostname: 'study.example', category: 'Focus' })
  existing = connected(existing, noon - 60 * minute)
  const oldFocus = summary('Focus', 15 * minute, 'prior-browser', noon - 50 * minute)
  existing = petReducer(existing, ingest([oldFocus], noon - 30 * minute))
  existing = petReducer(existing, { type: 'timer-start', id: 'timer-before-care', duration: 25, now: noon - 10 * minute })
  existing = petReducer(existing, { type: 'timer-pause', id: 'timer-before-care', now: noon - 7 * minute })
  const legacy = { ...existing, version: 5 }
  Reflect.deleteProperty(legacy, 'care')
  const serialized = JSON.stringify(legacy)
  const migrated = migratePet(legacy, noon)!
  assert.equal(migrated.version, 6)
  assert.deepEqual([migrated.care.fullness, migrated.care.energy, migrated.care.dailyLeisureAllowance], [80, 80, 60])
  const preserved = { ...migrated }
  Reflect.deleteProperty(preserved, 'care')
  assert.deepEqual(preserved, { ...legacy, version: 6 })
  assert.deepEqual([migrated.xp, migrated.foodCredits], [15, 4])
  assert.deepEqual(migrated.extensionSync.baselineFocusMinutes, { '2026-11-15': 30 })
  assert.equal(JSON.stringify(legacy), serialized)
  storageFixture(migrated)
  assert.deepEqual(readPet(), migrated)
  const later = petReducer(readPet(), { type: 'care-tick', now: noon + 24 * 60 * minute })
  assert.deepEqual([later.care.fullness, later.care.energy], [80, 80], 'paused and away time must not consume care')
})

test('a running pre-care timer charges only future active time after migration', () => {
  const running = petReducer(adopted(noon - 10 * minute), { type: 'timer-start', id: 'timer-migrating-running', duration: 30, now: noon - 10 * minute })
  const legacy = { ...running, version: 5 }
  Reflect.deleteProperty(legacy, 'care')
  let state = migratePet(legacy, noon)!
  assert.deepEqual(state.timer, running.timer)
  assert.equal(state.care.timerEnergy?.baselineActiveMs, 10 * minute)
  state = petReducer(state, { type: 'care-tick', now: noon + 5 * minute - 1 })
  assert.equal(state.care.energy, 80)
  state = petReducer(state, { type: 'care-tick', now: noon + 5 * minute })
  assert.equal(state.care.energy, 79)
  state = petReducer(state, { type: 'timer-save', id: 'timer-migrating-running', now: noon + 20 * minute })
  assert.deepEqual([state.care.energy, state.xp, state.foodCredits], [76, 10, 4])
  assert.equal(state.activities[0].duration, 30, 'preserving the timer still preserves its full activity and existing reward rules')
})

test('feeding caps fullness and rapid cross-tab clicks spend only one available meal', async () => {
  const initial = log(adopted(), 'Focus', 30, 'food-funds')
  storageFixture(initial)
  const results = await Promise.all(Array.from({ length: 12 }, () => transactPet({ type: 'feed' })))
  assert.equal(results.filter((result) => result.changed).length, 1)
  assert.deepEqual([readPet().care.fullness, readPet().xp, readPet().foodCredits], [100, 10, 2])
  assert.equal((await transactPet({ type: 'feed' })).changed, false)
  const almostFull = { ...initial, care: { ...initial.care, fullness: 95 } }
  assert.deepEqual([petReducer(almostFull, { type: 'feed' }).care.fullness, petReducer(almostFull, { type: 'feed' }).foodCredits], [100, 2])
  const noFood = { ...initial, foodCredits: 1, care: { ...initial.care, fullness: 0 } }
  assert.equal(petReducer(noFood, { type: 'feed' }), noFood)
})

test('manual leisure accumulates partial excess and starts a separate allowance at local midnight', () => {
  const late = new Date(2026, 10, 15, 23, 50).getTime()
  let state = log(adopted(late), 'Leisure', 60, 'allowance', late)
  state = log(state, 'Leisure', 14, 'partial', late)
  assert.equal(state.care.fullness, 80)
  state = log(state, 'Leisure', 1, 'block', late)
  assert.equal(state.care.fullness, 75)
  assert.equal(log(state, 'Leisure', 1, 'block', late), state, 'retrying a Manual entry cannot consume fullness twice')
  const nextDay = new Date(2026, 10, 16, 0, 1).getTime()
  state = log(state, 'Leisure', 74, 'tomorrow-partial', nextDay)
  assert.equal(state.care.fullness, 75)
  state = log(state, 'Leisure', 1, 'tomorrow-block', nextDay)
  assert.equal(state.care.fullness, 70)
  assert.deepEqual([state.xp, state.foodCredits], [0, 0])
})

test('extension leisure retains millisecond partials and retries or old revisions cannot repeat a loss', () => {
  let state = connected()
  const partial = summary('Leisure', 75 * minute - 1)
  state = petReducer(state, ingest([partial]))
  assert.equal(state.care.fullness, 80)
  const completed = summary('Leisure', 75 * minute, 'care-event', noon, 2)
  state = petReducer(state, ingest([completed]))
  assert.equal(state.care.fullness, 75)
  const retried = petReducer(state, ingest([completed, completed]))
  assert.equal(retried.care.fullness, 75)
  assert.equal(petReducer(retried, ingest([partial])).care.fullness, 75)
  assert.deepEqual([state.xp, state.foodCredits], [0, 0])
})

test('manual overlap after browser authority is not penalized in addition to browser leisure', () => {
  let state = log(adopted(), 'Leisure', 60, 'local-allowance')
  state = connected(state)
  state = log(state, 'Leisure', 120, 'overlapping-optional', noon + minute)
  assert.equal(state.care.fullness, 80)
  state = petReducer(state, ingest([summary('Leisure', 15 * minute)]))
  assert.equal(state.care.fullness, 75)
  assert.equal(state.activities.length, 2, 'optional history is retained without additional penalties')
})

test('allowance edits never apply old excess retroactively', () => {
  let state = log(adopted(), 'Leisure', 70, 'before-edit')
  state = petReducer(state, { type: 'care-allowance', minutes: 0, now: noon + minute })
  assert.equal(state.care.fullness, 80)
  state = log(state, 'Leisure', 14, 'new-partial', noon + 2 * minute)
  assert.equal(state.care.fullness, 80)
  state = log(state, 'Leisure', 1, 'new-completed', noon + 3 * minute)
  assert.equal(state.care.fullness, 75)
  state = petReducer(state, { type: 'care-allowance', minutes: 120, now: noon + 4 * minute })
  assert.equal(state.care.fullness, 75, 'raising an allowance must not replay or reverse historical losses')
})

test('clamped hunger consumes excess blocks so feeding cannot replay an old loss', () => {
  const initial = connected(log(adopted(), 'Focus', 30, 'earned-food'))
  let state = { ...initial, care: { ...initial.care, fullness: 5 } }
  const oldLeisure = summary('Leisure', 105 * minute)
  state = petReducer(state, ingest([oldLeisure]))
  assert.equal(state.care.fullness, 0)
  state = petReducer(state, { type: 'feed' })
  assert.deepEqual([state.care.fullness, state.foodCredits], [20, 2])
  state = petReducer(state, ingest([oldLeisure]))
  assert.equal(state.care.fullness, 20)
  state = petReducer(state, ingest([summary('Leisure', 120 * minute, 'care-event', noon, 2)]))
  assert.equal(state.care.fullness, 15, 'only the next newly completed excess block costs fullness')
})

test('buffered pre-care summaries establish a baseline rather than causing retroactive hunger', () => {
  let existing = connected(log(adopted(noon - 120 * minute), 'Leisure', 120, 'old-manual', noon - 110 * minute), noon - 60 * minute)
  const legacy = { ...existing, version: 5 }
  Reflect.deleteProperty(legacy, 'care')
  existing = migratePet(legacy, noon)!
  const buffered = summary('Leisure', 30 * minute, 'buffered-before-care', noon - 10 * minute)
  const first = petReducer(existing, ingest([buffered], noon + 20 * minute))
  assert.equal(first.care.fullness, 80)
  const revised = summary('Leisure', 45 * minute, 'buffered-before-care', noon - 10 * minute, 2)
  const next = petReducer(first, ingest([revised], noon + 35 * minute))
  assert.equal(next.care.fullness, 75, 'subsequent genuinely new delta uses the already-consumed daily allowance')
  assert.equal(petReducer(next, ingest([buffered], noon + 35 * minute)).care.fullness, 75)
})

test('rest explicitly pauses the matching running timer and both energy cursors remain duplicate-free', () => {
  let state = petReducer(adopted(), { type: 'timer-start', id: 'timer-rest-conflict', duration: 25, now: noon })
  const restAt = noon + 6 * minute
  assert.equal(petReducer(state, { type: 'care-rest-start', id: 'rest-1', now: restAt }), state)
  assert.equal(petReducer(state, { type: 'care-rest-start', id: 'rest-1', now: restAt, pauseTimerId: 'timer-other' }), state)
  state = petReducer(state, { type: 'care-rest-start', id: 'rest-1', now: restAt, pauseTimerId: 'timer-rest-conflict' })
  assert.equal(state.timer?.runningSince, null)
  assert.equal(state.timer?.elapsedMs, 6 * minute)
  assert.equal(state.care.energy, 79)
  const resting = state
  assert.equal(petReducer(resting, { type: 'timer-resume', id: 'timer-rest-conflict', now: restAt + minute }), resting)
  state = petReducer(state, { type: 'care-tick', now: restAt + 5 * minute - 1 })
  assert.equal(state.care.energy, 79)
  state = petReducer(state, { type: 'care-tick', now: restAt + 5 * minute })
  assert.equal(state.care.energy, 84)
  storageFixture(state)
  state = petReducer(readPet(), { type: 'care-tick', now: restAt + 5 * minute })
  assert.equal(state.care.energy, 84)
  state = petReducer(state, { type: 'care-tick', now: restAt + 25 * minute })
  assert.equal(state.care.energy, 100)
  assert.equal(state.care.rest?.accountedBlocks, 5, 'completed blocks are consumed even when energy reaches its cap')
  state = petReducer(state, { type: 'care-wake', restId: 'rest-1', now: restAt + 25 * minute })
  assert.equal(state.care.rest, null)
  state = petReducer(state, { type: 'timer-resume', id: 'timer-rest-conflict', now: restAt + 25 * minute })
  state = petReducer(state, { type: 'care-tick', now: restAt + 30 * minute })
  assert.equal(state.care.energy, 99, 'rest already capped at 100 cannot be credited again after focusing')
  assert.equal(petReducer(state, { type: 'care-wake', restId: 'rest-1', now: restAt + 40 * minute }), state,
    'a stale rest control cannot advance any care cursor')
  assert.deepEqual([state.xp, state.foodCredits], [0, 0])
})

test('Focus energy excludes paused time and cancellation or duplicate saving cannot replay consumption', () => {
  let state = petReducer(adopted(), { type: 'timer-start', id: 'timer-energy', duration: 30, now: noon })
  state = petReducer(state, { type: 'care-tick', now: noon + 5 * minute })
  assert.equal(state.care.energy, 79)
  state = petReducer(state, { type: 'timer-pause', id: 'timer-energy', now: noon + 8 * minute })
  state = petReducer(state, { type: 'care-tick', now: noon + 60 * minute })
  assert.equal(state.care.energy, 79)
  state = petReducer(state, { type: 'timer-resume', id: 'timer-energy', now: noon + 60 * minute })
  state = petReducer(state, { type: 'care-tick', now: noon + 62 * minute })
  assert.equal(state.care.energy, 78)
  state = petReducer(state, { type: 'timer-cancel', id: 'timer-energy', now: noon + 63 * minute })
  const cancelled = state
  assert.equal(petReducer(state, { type: 'timer-cancel', id: 'timer-energy', now: noon + 90 * minute }), cancelled)
  assert.deepEqual([state.xp, state.foodCredits, state.activities.length], [0, 0, 0])
  state = petReducer(state, { type: 'timer-start', id: 'timer-save-once', duration: 15, now: noon + 90 * minute })
  state = petReducer(state, { type: 'timer-save', id: 'timer-save-once', now: noon + 105 * minute })
  assert.deepEqual([state.care.energy, state.xp, state.foodCredits, state.activities.length], [75, 5, 2, 1])
  assert.equal(petReducer(state, { type: 'timer-save', id: 'timer-save-once', now: noon + 120 * minute }), state)
})

test('premature save does not masquerade as a saved session when energy is due', async () => {
  const running = petReducer(adopted(), { type: 'timer-start', id: 'timer-too-early', duration: 25, now: noon })
  storageFixture(running)
  const result = await transactPet({ type: 'timer-save', id: 'timer-too-early', now: noon + 5 * minute })
  assert.equal(result.changed, false, 'the save action must report success only when the completed session is actually saved')
  assert.deepEqual(readPet(), running)
  const accounted = await transactPet({ type: 'care-tick', now: noon + 5 * minute })
  assert.equal(accounted.pet.care.energy, 79, 'the next ordinary tick still accounts elapsed Focus energy once')
  assert.equal(accounted.pet.activities.length, 0)
})

test('rest preserves completed unsaved Focus sessions and grants no Focus reward itself', () => {
  let state = petReducer(adopted(), { type: 'timer-start', id: 'timer-complete-rest', duration: 15, now: noon })
  state = petReducer(state, { type: 'care-rest-start', id: 'rest-after-focus', now: noon + 15 * minute })
  assert.equal(state.timer?.id, 'timer-complete-rest')
  assert.equal(state.care.energy, 77)
  assert.deepEqual([state.xp, state.foodCredits], [0, 0])
  state = petReducer(state, { type: 'timer-save', id: 'timer-complete-rest', now: noon + 20 * minute })
  assert.deepEqual([state.care.energy, state.xp, state.foodCredits], [82, 5, 2])
  assert.equal(state.care.rest?.id, 'rest-after-focus')
})

test('time away, Neutral, ordinary Focus, and manual Rest never cause hunger or simulated rest energy', () => {
  let state = adopted()
  state = log(state, 'Neutral', 240, 'neutral')
  state = log(state, 'Focus', 240, 'work')
  state = log(state, 'Rest', 240, 'recorded-rest')
  state = petReducer(state, { type: 'care-tick', now: noon + 7 * 24 * 60 * minute })
  assert.deepEqual([state.care.fullness, state.care.energy], [80, 80])
  assert.equal(state.care.rest, null)
})

test('failed writes preserve care cursors and balances; concurrent retry commits one Leisure delta', async () => {
  const prior = connected(log(adopted(), 'Focus', 30, 'starting-food'))
  const initial = petReducer(prior, { type: 'feed' })
  const fixture = storageFixture(initial)
  const action = ingest([summary('Leisure', 75 * minute)])
  fixture.fail(true)
  await assert.rejects(transactPet(action), /cannot be saved/)
  assert.equal(fixture.raw(), JSON.stringify(initial))
  fixture.fail(false)
  await Promise.all([transactPet(action), transactPet(action), transactPet(action)])
  assert.deepEqual([readPet().care.fullness, readPet().xp, readPet().foodCredits], [95, 10, 2])
  assert.equal(readPet().extensionSync.summaries.length, 1)
  assert.equal(isPetState(readPet()), true)
})

test('rest tick retries and concurrent tabs restore only completed timestamp blocks', async () => {
  const resting = petReducer(adopted(), { type: 'care-rest-start', id: 'rest-persisted', now: noon })
  const fixture = storageFixture(resting)
  const tick: PetAction = { type: 'care-tick', now: noon + 5 * minute }
  fixture.fail(true)
  await assert.rejects(transactPet(tick), /cannot be saved/)
  assert.equal(fixture.raw(), JSON.stringify(resting))
  fixture.fail(false)
  await Promise.all([transactPet(tick), transactPet(tick), transactPet(tick)])
  assert.equal(readPet().care.energy, 85)
  await transactPet({ type: 'care-wake', restId: 'rest-persisted', now: noon + 9 * minute })
  assert.equal(readPet().care.energy, 85)
  assert.equal((await transactPet({ type: 'care-wake', restId: 'rest-persisted', now: noon + 30 * minute })).changed, false)
  assert.equal(readPet().care.energy, 85)
})

test('transaction reward metadata describes genuine new rewards rather than saved totals or feeding', async () => {
  storageFixture(adopted())
  const action: PetAction = { type: 'log', activity: {
    id: 'reward-notification', source: 'Manual', category: 'Focus', duration: 15, note: '', timestamp: new Date(noon).toISOString(),
  } }
  const saved = await transactPet(action)
  assert.deepEqual([saved.xpAwarded, saved.creditsAwarded], [5, 2])
  const retry = await transactPet(action)
  assert.deepEqual([retry.xpAwarded, retry.creditsAwarded], [0, 0])
  const fed = await transactPet({ type: 'feed' })
  assert.deepEqual([fed.xpAwarded, fed.creditsAwarded], [0, 0])
})
