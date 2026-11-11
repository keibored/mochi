import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { dailyMinutes, dailySummary, isValidDuration, isValidGoal, localDateKey, rewardsForEntry } from '../src/rewards.ts'
import type { Activity, ActivityCategory } from '../src/rewards.ts'
import { freshPet, petReducer } from '../src/petState.ts'
import { isPetState, loadPet, migratePet, savePet, STORAGE_KEY } from '../src/storage.ts'

process.env.TZ = 'Asia/Manila'
const noon = new Date(2026, 10, 11, 12)
const entry = (duration: number, date = noon, id = 'entry-1', category: ActivityCategory = 'Focus'): Activity =>
  ({ id, source: 'Manual', category, duration, note: '', timestamp: date.toISOString() })

test('10 minutes followed by 5 minutes carries the partial block', () => {
  assert.deepEqual(rewardsForEntry([], 10, noon), { xp: 0, credits: 0 })
  assert.deepEqual(rewardsForEntry([entry(10)], 5, noon), { xp: 5, credits: 2 })
})

test('a single 30-minute entry earns 10 XP and 4 credits', () => {
  assert.deepEqual(rewardsForEntry([], 30, noon), { xp: 10, credits: 4 })
})

test('daily rewards stop at 240 minutes while logged totals continue', () => {
  assert.deepEqual(rewardsForEntry([], 240, noon), { xp: 80, credits: 32 })
  assert.deepEqual(rewardsForEntry([entry(230)], 30, noon), { xp: 5, credits: 2 })
  const activities = [entry(240), entry(30, noon, 'entry-2')]
  assert.deepEqual(rewardsForEntry(activities, 15, noon), { xp: 0, credits: 0 })
  assert.equal(dailyMinutes(activities, noon), 270)
})

test('separate local days do not share partial minutes or reward caps', () => {
  const beforeMidnight = new Date(2026, 10, 11, 23, 55)
  const afterMidnight = new Date(2026, 10, 12, 0, 5)
  // These timestamps share a UTC date, but belong to separate local days.
  assert.equal(beforeMidnight.toISOString().slice(0, 10), afterMidnight.toISOString().slice(0, 10))
  assert.notEqual(localDateKey(beforeMidnight), localDateKey(afterMidnight))
  assert.deepEqual(rewardsForEntry([entry(10, beforeMidnight)], 5, afterMidnight), { xp: 0, credits: 0 })
  assert.deepEqual(rewardsForEntry([entry(240, beforeMidnight)], 30, afterMidnight), { xp: 10, credits: 4 })
})

test('entries on the same local day accumulate across UTC midnight', () => {
  const early = new Date(2026, 10, 11, 0, 5)
  assert.notEqual(early.toISOString().slice(0, 10), noon.toISOString().slice(0, 10))
  assert.deepEqual(rewardsForEntry([entry(10, early)], 5, noon), { xp: 5, credits: 2 })
})

test('invalid durations are rejected', () => {
  for (const duration of [0, -1, 241, 1.5, NaN, Infinity]) {
    assert.equal(isValidDuration(duration), false)
    assert.throws(() => rewardsForEntry([], duration, noon), RangeError)
  }
  assert.equal(isValidDuration(1), true)
  assert.equal(isValidDuration(240), true)
})

test('adoption, logging and repeated feeds use immutable updates and never negative credits', () => {
  const initial = freshPet()
  const adopted = petReducer(initial, { type: 'adopt' })
  const logged = petReducer(adopted, { type: 'log', activity: entry(30) })
  const fed = petReducer(logged, { type: 'feed' })
  assert.equal(initial.adopted, false)
  assert.equal(adopted.activities.length, 0)
  assert.deepEqual([logged.xp, logged.foodCredits], [10, 4])
  assert.deepEqual([fed.xp, fed.foodCredits], [10, 2])
  let repeated = fed
  for (let click = 0; click < 20; click++) repeated = petReducer(repeated, { type: 'feed' })
  assert.deepEqual([repeated.xp, repeated.foodCredits], [10, 0])
  assert.equal(petReducer(logged, { type: 'log', activity: entry(30) }), logged)
})

test('saved record validates activity IDs, durations, timestamps and balances', () => {
  const valid = { ...freshPet(), adopted: true, activities: [entry(30)], xp: 10, foodCredits: 2 }
  assert.equal(isPetState(valid), true)
  for (const invalid of [null, {}, { ...valid, version: 4 }, { ...valid, foodCredits: -1 },
    { ...valid, xp: 1.5 }, { ...valid, activities: [entry(0)] },
    { ...valid, activities: [entry(30), entry(30)] },
    { ...valid, activities: [{ ...entry(30), timestamp: 'invalid' }] },
    { ...valid, activities: [{ ...entry(30), category: 'Unknown' }] },
    { ...valid, activities: [{ ...entry(30), note: 'a'.repeat(201) }] },
    { ...valid, dailyFocusGoal: 14 }, { ...valid, dailyFocusGoal: 481 }]) {
    assert.equal(isPetState(invalid), false)
  }
})

test('storage round trip preserves adoption, activities, XP and spent credits', () => {
  const records = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: {
      getItem: (key: string) => records.get(key) ?? null,
      setItem: (key: string, value: string) => records.set(key, value),
    },
  } })
  const saved = petReducer(petReducer(petReducer(freshPet(), { type: 'adopt' }),
    { type: 'log', activity: entry(30) }), { type: 'feed' })
  assert.equal(savePet(saved), true)
  assert.deepEqual(loadPet().pet, saved)
  records.set(STORAGE_KEY, '{broken')
  assert.deepEqual(loadPet().pet, freshPet())
  assert.match(loadPet().notice, /could not be read/)
  assert.equal(savePet(freshPet()), false)
  assert.equal(records.get(STORAGE_KEY), '{broken', 'unreadable progress must not be overwritten')
})

test('non-focus categories grant no rewards and never subtract existing balances', () => {
  const base = petReducer(petReducer(freshPet(), { type: 'adopt' }), { type: 'log', activity: entry(30) })
  for (const category of ['Leisure', 'Rest', 'Neutral'] as const) {
    assert.deepEqual(rewardsForEntry([], 240, noon, category), { xp: 0, credits: 0 })
    const next = petReducer(base, { type: 'log', activity: { ...entry(30, noon, category, category), note: 'A little time' } })
    assert.deepEqual([next.xp, next.foodCredits], [10, 4])
    assert.equal(next.activities.at(-1)?.note, 'A little time')
  }
})

test('mixed categories do not inflate partial focus rewards or the reward cap', () => {
  const activities = [entry(10), entry(240, noon, 'rest', 'Rest'), entry(30, noon, 'fun', 'Leisure'), entry(20, noon, 'neutral', 'Neutral')]
  assert.deepEqual(dailySummary(activities, noon), { Focus: 10, Leisure: 30, Rest: 240, Neutral: 20 })
  assert.deepEqual(rewardsForEntry(activities, 5, noon), { xp: 5, credits: 2 })
  assert.deepEqual(rewardsForEntry([...activities, entry(230, noon, 'focus-2')], 30, noon), { xp: 0, credits: 0 })
})

test('goal changes preserve rewards and activities, and reject invalid goals', () => {
  const base = petReducer(petReducer(freshPet(), { type: 'adopt' }), { type: 'log', activity: entry(30) })
  assert.equal(base.dailyFocusGoal, 60)
  for (const minutes of [15, 30, 60, 480]) {
    const changed = petReducer(base, { type: 'goal', minutes })
    assert.equal(changed.dailyFocusGoal, minutes)
    assert.deepEqual([changed.xp, changed.foodCredits], [10, 4])
    assert.equal(changed.activities, base.activities)
    const next = petReducer(changed, { type: 'log', activity: entry(15, noon, 'next') })
    assert.deepEqual([next.xp, next.foodCredits], [15, 6])
  }
  for (const minutes of [0, 14, 481, 30.5, NaN, Infinity]) {
    assert.equal(isValidGoal(minutes), false)
    assert.equal(petReducer(base, { type: 'goal', minutes }), base)
  }
})

test('version-1 migration preserves progress without replaying rewards', () => {
  const legacyEntry = { id: 'old-id', duration: 30, timestamp: noon.toISOString() }
  const legacy = { version: 1, adopted: true, name: 'Mochi', xp: 10, foodCredits: 2, activities: [legacyEntry] }
  const snapshot = JSON.stringify(legacy)
  const migrated = migratePet(legacy)!
  assert.equal(migrated.version, 3)
  assert.equal(migrated.timer, null)
  assert.equal(migrated.dailyFocusGoal, 60)
  assert.equal(migrated.adopted, true)
  assert.deepEqual([migrated.xp, migrated.foodCredits], [10, 2])
  assert.deepEqual(migrated.activities, [{ ...legacyEntry, source: 'Manual', category: 'Focus', note: '' }])
  assert.equal(JSON.stringify(legacy), snapshot)
  assert.deepEqual(migratePet(migrated), migrated)
  const next = petReducer(migrated, { type: 'log', activity: entry(15, noon, 'new-id') })
  assert.deepEqual([next.xp, next.foodCredits], [15, 4])
  assert.equal(migratePet({ ...legacy, version: 99 }), null)
  assert.equal(migratePet({ ...migrated, dailyFocusGoal: undefined })?.dailyFocusGoal, 60)
})

test('migration through storage retains spent credits and writes the updated version', () => {
  let raw = JSON.stringify({ version: 1, adopted: true, name: 'Mochi', xp: 10, foodCredits: 2,
    activities: [{ id: 'legacy', duration: 30, timestamp: noon.toISOString() }] })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: () => raw,
    setItem: (_key: string, value: string) => { raw = value },
  } } })
  const loaded = loadPet()
  assert.equal(loaded.notice, '')
  assert.equal(savePet(loaded.pet), true)
  assert.deepEqual(loadPet().pet, loaded.pet)
  assert.deepEqual([loadPet().pet.xp, loadPet().pet.foodCredits], [10, 2])
  assert.equal(JSON.parse(raw).version, 3)
})

test('daily category summaries switch at local midnight', () => {
  const before = new Date(2026, 10, 11, 23, 59)
  const after = new Date(2026, 10, 12, 0, 1)
  const activities = [entry(20, before), entry(10, before, 'rest', 'Rest'),
    entry(15, after, 'focus-new'), entry(30, after, 'fun-new', 'Leisure'), entry(5, after, 'neutral-new', 'Neutral')]
  assert.deepEqual(dailySummary(activities, before), { Focus: 20, Leisure: 0, Rest: 10, Neutral: 0 })
  assert.deepEqual(dailySummary(activities, after), { Focus: 15, Leisure: 30, Rest: 0, Neutral: 5 })
})

test('unavailable storage does not crash', () => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    get localStorage() { throw new Error('Storage unavailable') },
  } })
  assert.equal(savePet(freshPet()), false)
  assert.deepEqual(loadPet().pet, freshPet())
  assert.match(loadPet().notice, /cannot be saved/)
})
