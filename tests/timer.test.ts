import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { freshPet, petReducer } from '../src/petState.ts'
import type { PetAction, PetState } from '../src/petState.ts'
import { completionTime, isTimerDuration, isTimerSession, remainingMs } from '../src/timer.ts'
import { isPetState, migratePet, readPet, STORAGE_KEY, transactPet } from '../src/storage.ts'

process.env.TZ = 'Asia/Manila'
const start = new Date(2026, 10, 11, 12).getTime()
const adopted = () => petReducer(freshPet(), { type: 'adopt' })
const begin = (duration = 25, now = start) => petReducer(adopted(), {
  type: 'timer-start', id: 'timer-test', duration, now,
})
const act = (state: PetState, type: 'timer-pause' | 'timer-resume' | 'timer-save' | 'timer-cancel', now: number) =>
  petReducer(state, { type, id: 'timer-test', now })

function storageFixture(initial: PetState) {
  let raw = JSON.stringify(initial)
  let rejectWrites = false
  let queue = Promise.resolve()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => key === STORAGE_KEY ? raw : null,
    setItem: (_key: string, value: string) => {
      if (rejectWrites) throw new Error('Quota exceeded')
      raw = value
    },
  } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: <T>(_name: string, callback: () => T) => {
      const result = queue.then(callback)
      queue = result.then(() => undefined, () => undefined)
      return result
    },
  } } })
  return { raw: () => raw, replace: (pet: PetState) => { raw = JSON.stringify(pet) },
    rejectWrites: () => { rejectWrites = true }, allowWrites: () => { rejectWrites = false } }
}

test('timer duration validation and single active session', () => {
  for (const minutes of [0, -1, 121, 1.5, NaN, Infinity]) {
    assert.equal(isTimerDuration(minutes), false)
    assert.equal(begin(minutes).timer, null)
  }
  assert.equal(isTimerDuration(1), true)
  assert.equal(isTimerDuration(120), true)
  const active = begin()
  assert.equal(isTimerSession(active.timer), true)
  assert.equal(petReducer(active, { type: 'timer-start', id: 'timer-other', duration: 1, now: start }), active)
})

test('pause and resume exclude paused time and use timestamp differences', () => {
  const initial = begin()
  const paused = act(initial, 'timer-pause', start + 120_000)
  assert.equal(paused.timer?.elapsedMs, 120_000)
  assert.equal(paused.timer?.runningSince, null)
  assert.equal(remainingMs(paused.timer!, start + 3_600_000), 23 * 60_000)
  assert.equal(completionTime(paused.timer!, start + 3_600_000), null)
  const resumed = act(paused, 'timer-resume', start + 3_600_000)
  assert.equal(remainingMs(resumed.timer!, start + 3_660_000), 22 * 60_000)
  const pausedAgain = act(resumed, 'timer-pause', start + 3_660_000)
  assert.equal(pausedAgain.timer?.elapsedMs, 180_000)
  assert.equal(initial.timer?.elapsedMs, 0, 'pure updates preserve previous state')
})

test('reload restores both running and paused sessions without counting ticks', () => {
  for (const state of [begin(), act(begin(), 'timer-pause', start + 10_000)]) {
    storageFixture(state)
    const restored = readPet()
    assert.deepEqual(restored, state)
    assert.equal(isPetState(restored), true)
    assert.equal(remainingMs(restored.timer!, start + 60_000), state.timer?.runningSince === null ? 1_490_000 : 1_440_000)
  }
})

test('completion remains unsaved until requested and integrates existing Focus rewards once', () => {
  const state = begin(30)
  assert.equal(completionTime(state.timer!, start + 30 * 60_000 - 1), null)
  assert.equal(remainingMs(state.timer!, start + 99 * 60_000), 0)
  assert.equal(completionTime(state.timer!, start + 99 * 60_000), start + 30 * 60_000)
  assert.deepEqual([state.xp, state.foodCredits, state.activities.length], [0, 0, 0])
  assert.equal(act(state, 'timer-save', start + 10_000), state)
  const saved = act(state, 'timer-save', start + 99 * 60_000)
  assert.deepEqual([saved.xp, saved.foodCredits, saved.activities.length], [10, 4, 1])
  assert.equal(saved.timer, null)
  assert.equal(saved.activities[0].id, 'timer-test')
  assert.equal(saved.activities[0].source, 'Timer')
  assert.equal(saved.activities[0].timestamp, new Date(start + 30 * 60_000).toISOString())
  assert.equal(act(saved, 'timer-save', start + 100 * 60_000), saved)
  storageFixture(saved)
  assert.equal(act(readPet(), 'timer-save', start + 100 * 60_000).activities.length, 1)
})

test('completed-but-unsaved sessions restore after reload with a stable completion time', () => {
  const state = begin(1)
  storageFixture(state)
  const restored = readPet()
  const later = start + 24 * 60 * 60_000
  assert.equal(completionTime(restored.timer!, later), start + 60_000)
  assert.equal(act(restored, 'timer-pause', later).timer?.runningSince, start)
  const saved = act(restored, 'timer-save', later)
  assert.equal(saved.activities[0].timestamp, new Date(start + 60_000).toISOString())
  assert.equal(saved.activities[0].duration, 1)
})

test('malformed timer state is rejected without overwriting saved data', async () => {
  const valid = begin(1)
  for (const timer of [{ ...valid.timer, duration: 121 }, { ...valid.timer, elapsedMs: -1 },
    { ...valid.timer, runningSince: 'yesterday' }, { ...valid.timer, startedAt: Infinity }]) {
    const malformed = { ...valid, timer }
    assert.equal(isPetState(malformed), false)
    assert.equal(migratePet(malformed), null)
  }
  storageFixture({ ...valid, version: 99 } as unknown as PetState)
  await assert.rejects(transactPet({ type: 'timer-save', id: 'timer-test', now: start + 60_000 }))
})

test('cancellation of running, paused and completed sessions awards nothing', () => {
  for (const state of [begin(1), act(begin(1), 'timer-pause', start + 10_000)]) {
    const cancelled = act(state, 'timer-cancel', start + 90_000)
    assert.equal(cancelled.timer, null)
    assert.deepEqual([cancelled.xp, cancelled.foodCredits, cancelled.activities.length], [0, 0, 0])
    assert.equal(act(cancelled, 'timer-save', start + 100_000), cancelled)
  }
})

test('sessions use their local completion day even when saved a day later', () => {
  const late = new Date(2026, 10, 11, 23, 50).getTime()
  const completedAt = new Date(2026, 10, 12, 0, 20)
  const state = begin(30, late)
  const saved = act(state, 'timer-save', new Date(2026, 10, 13, 9).getTime())
  assert.equal(saved.activities[0].timestamp, completedAt.toISOString())
  assert.deepEqual([saved.xp, saved.foodCredits], [10, 4])
})

test('timer rewards carry manual partial minutes and respect the shared daily cap', () => {
  for (const [manualMinutes, timerMinutes, expectedXP] of [[10, 5, 5], [230, 30, 80], [240, 30, 80]]) {
    const manual = petReducer(adopted(), { type: 'log', activity: {
      id: 'manual', source: 'Manual', category: 'Focus', duration: manualMinutes,
      note: '', timestamp: new Date(start).toISOString(),
    } })
    const running = petReducer(manual, { type: 'timer-start', id: 'timer-test', duration: timerMinutes, now: start })
    const saved = act(running, 'timer-save', start + timerMinutes * 60_000)
    assert.equal(saved.xp, expectedXP)
    assert.equal(saved.activities.reduce((total, entry) => total + entry.duration, 0), manualMinutes + timerMinutes)
  }
})

test('version-2 activities migrate to Manual preserving notes, balances and goals', () => {
  const old = { version: 2, adopted: true, name: 'Mochi', xp: 10, foodCredits: 2, dailyFocusGoal: 90,
    activities: [{ id: 'old-rest', category: 'Rest', duration: 10, note: 'Cozy break', timestamp: new Date(start).toISOString() }] }
  const migrated = migratePet(old)!
  assert.equal(migrated.version, 4)
  assert.equal(migrated.timer, null)
  assert.deepEqual([migrated.xp, migrated.foodCredits, migrated.dailyFocusGoal], [10, 2, 90])
  assert.deepEqual(migrated.activities, [{ ...old.activities[0], source: 'Manual' }])
  assert.deepEqual(migratePet(migrated), migrated)
})

test('concurrent tabs save the same completed timer exactly once, with no stale overwrite', async () => {
  storageFixture(begin(30))
  const action: PetAction = { type: 'timer-save', id: 'timer-test', now: start + 30 * 60_000 }
  const results = await Promise.all([transactPet(action), transactPet(action), transactPet(action)])
  assert.equal(results.filter((result) => result.changed).length, 1)
  await transactPet({ type: 'goal', minutes: 90 })
  await transactPet({ type: 'feed' })
  const saved = readPet()
  assert.deepEqual([saved.xp, saved.foodCredits, saved.activities.length, saved.dailyFocusGoal], [10, 2, 1, 90])
  assert.equal(saved.timer, null)
})

test('concurrent starts produce one session, and stale controls cannot change a replacement', async () => {
  storageFixture(adopted())
  const results = await Promise.all(['timer-first', 'timer-second'].map((id) =>
    transactPet({ type: 'timer-start', id, duration: 1, now: start })))
  assert.equal(results.filter((result) => result.changed).length, 1)
  await transactPet({ type: 'timer-cancel', id: 'timer-first', now: start + 500 })
  await transactPet({ type: 'timer-start', id: 'timer-new', duration: 1, now: start + 1000 })
  assert.equal((await transactPet({ type: 'timer-save', id: 'timer-first', now: start + 100_000 })).changed, false)
  assert.equal(readPet().timer?.id, 'timer-new')
  assert.equal(readPet().activities.length, 0)
})

test('failed storage writes retain the unsaved timer and never grant rewards', async () => {
  const fixture = storageFixture(begin(30))
  const before = fixture.raw()
  fixture.rejectWrites()
  await assert.rejects(transactPet({ type: 'timer-save', id: 'timer-test', now: start + 30 * 60_000 }))
  assert.equal(fixture.raw(), before)
  assert.equal(readPet().activities.length, 0)
  fixture.allowWrites()
  assert.equal((await transactPet({ type: 'timer-save', id: 'timer-test', now: start + 30 * 60_000 })).changed, true)
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().activities.length], [10, 4, 1])
})

test('timer saving fails safely without cross-tab locks', async () => {
  storageFixture(begin(1))
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
  await assert.rejects(transactPet({ type: 'timer-save', id: 'timer-test', now: start + 60_000 }))
  assert.equal(readPet().activities.length, 0)
})

test('delayed lock responses return newer other-tab progress instead of stale snapshots', async () => {
  const fixture = storageFixture(begin(30))
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: async <T>(_name: string, callback: () => T) => {
      const response = callback()
      // Simulate another tab taking the released lock before our response is
      // delivered. Its storage event could already have refreshed our UI.
      fixture.replace(petReducer(readPet(), { type: 'feed' }))
      return response
    },
  } } })
  const result = await transactPet({ type: 'timer-save', id: 'timer-test', now: start + 30 * 60_000 })
  assert.equal(result.changed, true)
  assert.deepEqual([result.pet.xp, result.pet.foodCredits, result.pet.activities.length], [10, 2, 1])
  assert.deepEqual(result.pet, readPet())
})

test('stale timer actions are read-only even when storage refuses writes', async () => {
  const saved = act(begin(30), 'timer-save', start + 30 * 60_000)
  const fixture = storageFixture(saved)
  const before = fixture.raw()
  fixture.rejectWrites()
  for (const type of ['timer-save', 'timer-cancel', 'timer-pause', 'timer-resume'] as const) {
    const result = await transactPet({ type, id: 'timer-test', now: start + 30 * 60_000 })
    assert.equal(result.changed, false)
    assert.deepEqual(result.pet, saved)
  }
  assert.equal(fixture.raw(), before)
})

test('repeated pause/resume and pausing a completed session do not rewrite progress', async () => {
  const running = begin(1)
  const paused = act(running, 'timer-pause', start + 10_000)
  assert.equal(act(running, 'timer-resume', start + 10_000), running)
  assert.equal(act(paused, 'timer-pause', start + 20_000), paused)
  assert.equal(act(running, 'timer-pause', start + 60_000), running)
  const fixture = storageFixture(paused)
  fixture.rejectWrites()
  const result = await transactPet({ type: 'timer-pause', id: 'timer-test', now: start + 20_000 })
  assert.equal(result.changed, false)
  assert.deepEqual(result.pet, paused)
})

test('a read failure after a committed save must not report failure or replay rewards', async () => {
  const initial = begin(30)
  let raw = JSON.stringify(initial)
  let failRead = false
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: () => {
      if (failRead) throw new Error('Read blocked after commit')
      return raw
    },
    setItem: (_key: string, value: string) => { raw = value; failRead = true },
  } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: async <T>(_name: string, callback: () => T) => callback(),
  } } })
  const result = await transactPet({ type: 'timer-save', id: 'timer-test', now: start + 30 * 60_000 })
  assert.equal(result.changed, true)
  assert.deepEqual([result.pet.xp, result.pet.foodCredits, result.pet.activities.length], [10, 4, 1])
  assert.deepEqual(JSON.parse(raw), result.pet)
})
