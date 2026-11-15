import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { accountCareTime, activeTimerMs, beginCareRest, careForManualLeisure, careForSyncedLeisure,
  changeLeisureAllowance, clampCareStat, feedCare, freshCare, isPetCare, isValidLeisureAllowance,
  LEISURE_STEP_MS, migrateCare } from '../src/petCare.ts'
import type { PetCare } from '../src/petCare.ts'
import { freshWebSync } from '../src/integration/syncDomain.ts'
import type { SyncSummaryV2 } from '../src/integration/syncDomain.ts'
import type { Activity } from '../src/rewards.ts'
import { pauseTimer, resumeTimer } from '../src/timer.ts'
import type { TimerSession } from '../src/timer.ts'
import { freshPet, petReducer } from '../src/petState.ts'
import { readPet, STORAGE_KEY, transactPet } from '../src/storage.ts'

process.env.TZ = 'Asia/Manila'
const minute = 60_000
const start = new Date(2026, 10, 15, 12).getTime()
const day = '2026-11-15'
const leisure = (duration: number, at = start, id = 'manual-leisure'): Activity => ({
  id, source: 'Manual', category: 'Leisure', duration, note: '', timestamp: new Date(at).toISOString(),
})
const summary = (milliseconds: number, changes: Partial<SyncSummaryV2> = {}): SyncSummaryV2 => ({
  schemaVersion: 2, source: 'extension', epochId: 'epoch-one', eventId: 'leisure-one', revision: 1,
  category: 'Leisure', startedAtIso: new Date(start).toISOString(), endedAtIso: new Date(start + milliseconds).toISOString(),
  activeDurationMs: milliseconds, timeZone: 'Asia/Manila', localDate: day, finalized: false, ...changes,
})
const timer = (duration = 30): TimerSession => ({ id: 'timer-energy', duration, startedAt: start, elapsedMs: 0, runningSince: start })
const timerCare = (session: TimerSession): PetCare => ({ ...freshCare(start),
  timerEnergy: { timerId: session.id, baselineActiveMs: 0, accountedBlocks: 0 } })

test('feeding clamps fullness, preserves inputs, and a full pet is a no-op', () => {
  const original = { ...freshCare(start), fullness: 95 }
  const fed = feedCare(original)
  assert.equal(fed.fullness, 100)
  assert.equal(original.fullness, 95)
  assert.equal(feedCare(fed), fed)
  assert.equal(feedCare({ ...original, fullness: 0 }).fullness, 20)
  assert.deepEqual([-10, 0, 19, 20, 39, 40, 100, 120].map(clampCareStat), [0, 0, 19, 20, 39, 40, 100, 100])
})

test('manual Leisure allowance carries partial excess within its local day and resets daily', () => {
  const first = careForManualLeisure(freshCare(start), leisure(70))
  assert.equal(first.fullness, 80)
  assert.equal(first.leisureDays[day].excessRemainderMs, 10 * minute)
  const next = careForManualLeisure(first, leisure(5, start, 'next'))
  assert.equal(next.fullness, 75)
  assert.equal(next.leisureDays[day].excessRemainderMs, 0)
  const tomorrow = careForManualLeisure(next, leisure(60, new Date(2026, 10, 16, 0, 1).getTime(), 'tomorrow'))
  assert.equal(tomorrow.fullness, 75)
  assert.deepEqual(Object.keys(tomorrow.leisureDays), [day, '2026-11-16'])
  assert.equal(first.leisureDays[day].observedMs, 70 * minute)
})

test('cumulative extension deltas retain millisecond precision and consume excess at zero fullness', () => {
  const initial = { ...freshCare(start), dailyLeisureAllowance: 0, fullness: 1 }
  const first = summary(LEISURE_STEP_MS - 1)
  const partial = careForSyncedLeisure(initial, [], [first])
  assert.equal(partial.fullness, 1)
  const block = summary(LEISURE_STEP_MS, { revision: 2 })
  const empty = careForSyncedLeisure(partial, [first], [block])
  assert.equal(empty.fullness, 0)
  const many = summary(5 * LEISURE_STEP_MS, { revision: 3 })
  const consumed = careForSyncedLeisure(empty, [block], [many])
  assert.equal(consumed.fullness, 0)
  assert.equal(consumed.leisureDays[day].excessRemainderMs, 0)
  const fed = feedCare(consumed)
  assert.equal(careForSyncedLeisure(fed, [many], [many]), fed)
  assert.equal(fed.fullness, 20)
})

test('Focus, Neutral, intentional Rest logs, and Timer sources do not decrease fullness', () => {
  const care = freshCare(start)
  for (const category of ['Focus', 'Neutral', 'Rest'] as const) {
    assert.equal(careForManualLeisure(care, { ...leisure(240), category }), care)
    if (category !== 'Rest') assert.equal(careForSyncedLeisure(care, [], [summary(4 * 60 * minute, { category })]), care)
  }
  assert.equal(careForManualLeisure(care, { ...leisure(240), source: 'Timer' }), care)
  assert.equal(accountCareTime(care, null, start + 100 * 24 * 60 * minute), care, 'time away has no care cost')
})

test('migration baselines historical Leisure and already elapsed timer time without retroactive changes', () => {
  const session = timer()
  const migrated = migrateCare([leisure(120)], freshWebSync(), session, start + 12 * minute)
  assert.deepEqual([migrated.fullness, migrated.energy], [80, 80])
  assert.equal(migrated.leisureDays[day].observedMs, 120 * minute)
  assert.deepEqual(migrated.timerEnergy, { timerId: session.id, baselineActiveMs: 12 * minute, accountedBlocks: 0 })
  assert.equal(accountCareTime(migrated, session, start + 16 * minute), migrated)
  const later = accountCareTime(migrated, session, start + 17 * minute)
  assert.equal(later.energy, 79)
  assert.equal(careForManualLeisure(migrated, leisure(15, start + 12 * minute)).fullness, 75)
})

test('buffered first/mixed snapshots are baseline-only; only later precise deltas can charge', () => {
  const cutoff = start + 10 * minute
  const initial = { ...freshCare(cutoff), dailyLeisureAllowance: 0 }
  const before = summary(5 * minute)
  const mixed = summary(20 * minute, { revision: 2 })
  const seeded = careForSyncedLeisure(initial, [], [before])
  const firstMixed = careForSyncedLeisure(seeded, [before], [mixed])
  assert.equal(firstMixed.fullness, 80)
  assert.equal(firstMixed.leisureDays[day].observedMs, 20 * minute)
  const later = summary(35 * minute, { revision: 3 })
  assert.equal(careForSyncedLeisure(firstMixed, [mixed], [later]).fullness, 75)
  const firstAlreadyMixed = careForSyncedLeisure(initial, [], [mixed])
  assert.equal(firstAlreadyMixed.fullness, 80)
  assert.equal(careForSyncedLeisure(firstAlreadyMixed, [mixed], [later]).fullness, 75)
})

test('same-batch historical baselines consume allowance before eligible deltas regardless of snapshot order', () => {
  const cutoff = start + 60 * minute
  const care = freshCare(cutoff)
  const historical = summary(60 * minute, { eventId: 'historical-baseline' })
  const eligible = summary(60 * minute, { eventId: 'eligible-new',
    startedAtIso: new Date(cutoff).toISOString(), endedAtIso: new Date(cutoff + 60 * minute).toISOString() })
  const chronological = careForSyncedLeisure(care, [], [historical, eligible])
  const reversed = careForSyncedLeisure(care, [], [eligible, historical])
  assert.deepEqual(reversed, chronological)
  assert.equal(chronological.fullness, 60)
  assert.deepEqual(chronological.leisureDays[day], { observedMs: 120 * minute, excessRemainderMs: 0 })
  const earlierCommit = careForSyncedLeisure(care, [], [eligible])
  const lateBaseline = careForSyncedLeisure(earlierCommit, [eligible], [eligible, historical])
  assert.equal(lateBaseline.fullness, 80, 'a separate later baseline must not retroactively change committed fullness')
  assert.equal(lateBaseline.leisureDays[day].observedMs, 120 * minute)
})

test('allowance edits retain observed use, clear old carry, and baseline a crossing buffered revision', () => {
  const old = summary(70 * minute)
  const accrued = careForSyncedLeisure(freshCare(start), [], [old])
  assert.equal(accrued.leisureDays[day].excessRemainderMs, 10 * minute)
  const editAt = start + 75 * minute
  const unchanged = changeLeisureAllowance(accrued, 60, editAt)
  assert.equal(unchanged, accrued, 'saving an unchanged allowance cannot erase partial excess')
  assert.equal(unchanged.policyStartedAt, start)
  assert.equal(unchanged.leisureDays[day].excessRemainderMs, 10 * minute)
  const edited = changeLeisureAllowance(accrued, 0, editAt)
  assert.equal(edited.fullness, 80)
  assert.equal(edited.leisureDays[day].observedMs, 70 * minute)
  assert.equal(edited.leisureDays[day].excessRemainderMs, 0)
  const crossing = summary(80 * minute, { revision: 2 })
  const baseline = careForSyncedLeisure(edited, [old], [crossing])
  assert.equal(baseline.fullness, 80)
  const later = summary(95 * minute, { revision: 3 })
  assert.equal(careForSyncedLeisure(baseline, [crossing], [later]).fullness, 75)
  assert.equal(changeLeisureAllowance(edited, -1, editAt), edited)
  assert.equal(changeLeisureAllowance(edited, 60, editAt - minute).policyStartedAt, editAt)
})

test('queued Manual Leisure from before migration or an allowance edit is baseline-only', () => {
  const policyAt = start + 10 * minute
  const migrated = freshCare(policyAt)
  const queuedBeforeMigration = careForManualLeisure(migrated, leisure(120, policyAt - 1, 'queued-before-migration'))
  assert.equal(queuedBeforeMigration.fullness, 80)
  assert.deepEqual(queuedBeforeMigration.leisureDays[day], { observedMs: 120 * minute, excessRemainderMs: 0 })
  const edited = changeLeisureAllowance(queuedBeforeMigration, 0, policyAt + minute)
  const queuedBeforeEdit = careForManualLeisure(edited, leisure(15, policyAt, 'queued-before-edit'))
  assert.equal(queuedBeforeEdit.fullness, 80)
  assert.deepEqual(queuedBeforeEdit.leisureDays[day], { observedMs: 135 * minute, excessRemainderMs: 0 })
  const afterEdit = careForManualLeisure(queuedBeforeEdit, leisure(15, policyAt + minute, 'new-policy'))
  assert.equal(afterEdit.fullness, 75)
  assert.equal(afterEdit.leisureDays[day].excessRemainderMs, 0)
})

test('Focus energy uses completed active blocks, excludes pauses, caps duration, and never replays blocks', () => {
  const session = timer()
  const initial = timerCare(session)
  assert.equal(accountCareTime(initial, session, start + 5 * minute - 1), initial)
  const first = accountCareTime(initial, session, start + 7 * minute)
  assert.equal(first.energy, 79)
  const paused = pauseTimer(session, start + 7 * minute)
  assert.equal(accountCareTime(first, paused, start + 100 * minute), first)
  const resumed = resumeTimer(paused, start + 100 * minute)
  assert.equal(activeTimerMs(resumed, start + 103 * minute), 10 * minute)
  const next = accountCareTime(first, resumed, start + 103 * minute)
  assert.equal(next.energy, 78)
  assert.equal(accountCareTime(next, resumed, start + 101 * minute), next, 'rollback cannot replay debit')
  const completed = accountCareTime(next, resumed, start + 1000 * minute)
  assert.equal(completed.energy, 74)
  assert.equal(completed.timerEnergy?.accountedBlocks, 6)
  assert.equal(accountCareTime(completed, resumed, start + 2000 * minute), completed)
})

test('intentional Rest uses timestamp blocks across reload and consumes capped gains before a rollback', () => {
  const sleeping = beginCareRest({ ...freshCare(start), energy: 98 }, 'rest-sleep', start)
  const restored = JSON.parse(JSON.stringify(sleeping)) as PetCare
  assert.equal(accountCareTime(restored, null, start + 5 * minute - 1), restored)
  const capped = accountCareTime(restored, null, start + 30 * minute)
  assert.equal(capped.energy, 100)
  assert.equal(capped.rest?.accountedBlocks, 6)
  const changedEnergy = { ...capped, energy: 50 }
  assert.equal(accountCareTime(changedEnergy, null, start + 20 * minute), changedEnergy)
  assert.equal(accountCareTime(changedEnergy, null, start + 30 * minute), changedEnergy)
  const later = accountCareTime(changedEnergy, null, start + 35 * minute)
  assert.equal(later.energy, 55)
  assert.equal(beginCareRest(later, 'rest-second', start + 36 * minute), later)
})

test('care validation rejects malformed counters, out-of-range settings, and simultaneous unfinished Focus/Rest', () => {
  const care = freshCare(start)
  assert.equal(isPetCare(care, null), true)
  for (const value of [-1, 1441, 1.5, NaN, Infinity, '60']) assert.equal(isValidLeisureAllowance(value), false)
  assert.equal(isValidLeisureAllowance(0), true)
  assert.equal(isValidLeisureAllowance(1440), true)
  for (const invalid of [{ ...care, fullness: -1 }, { ...care, energy: 101 }, { ...care, energy: 1.5 },
    { ...care, policyStartedAt: Infinity }, { ...care, mood: 'cozy' },
    { ...care, leisureDays: { [day]: { observedMs: 10, excessRemainderMs: 11 } } },
    { ...care, leisureDays: { [day]: { observedMs: LEISURE_STEP_MS, excessRemainderMs: LEISURE_STEP_MS } } },
    { ...care, rest: { id: 'bad', startedAt: start, accountedBlocks: 0 } }]) assert.equal(isPetCare(invalid, null), false)
  const session = timer()
  const sleeping = beginCareRest(timerCare(session), 'rest-sleep', start + 5 * minute)
  assert.equal(isPetCare(sleeping, session), false)
  assert.equal(isPetCare(sleeping, pauseTimer(session, start + 5 * minute)), true)
  const completeRest = beginCareRest(timerCare(session), 'rest-completed', start + 30 * minute)
  assert.equal(isPetCare(completeRest, session), true)
  assert.equal(isPetCare({ ...timerCare(session), timerEnergy: { timerId: session.id, baselineActiveMs: 0, accountedBlocks: 7 } }, session), false)
})

test('a no-op first care tick durably migrates a running timer once without announcing gameplay changes', async () => {
  const adopted = petReducer(freshPet(start), { type: 'adopt' })
  const running = petReducer(adopted, { type: 'timer-start', id: 'timer-migration', duration: 30, now: start })
  const legacy = { ...running, version: 5 }
  Reflect.deleteProperty(legacy, 'care')
  let raw = JSON.stringify(legacy), writes = 0
  let queue = Promise.resolve()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => key === STORAGE_KEY ? raw : null,
    setItem: (_key: string, value: string) => { raw = value; writes++ },
  } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: <T>(_name: string, callback: () => T) => {
      const result = queue.then(callback)
      queue = result.then(() => undefined, () => undefined)
      return result
    },
  } } })
  const baselineAt = start + 12 * minute
  const first = await transactPet({ type: 'care-tick', now: baselineAt })
  assert.equal(first.changed, false, 'migration is not an activity-save success')
  assert.deepEqual([first.xpAwarded, first.creditsAwarded], [0, 0])
  assert.equal(writes, 1)
  assert.equal(JSON.parse(raw).version, 6)
  assert.equal(readPet(baselineAt + minute).care.timerEnergy?.baselineActiveMs, 12 * minute)
  assert.equal(readPet(baselineAt + minute).care.energy, 80)
  await transactPet({ type: 'care-tick', now: baselineAt + minute })
  assert.equal(writes, 1, 'a current-schema no-op must not write')
  await Promise.all([transactPet({ type: 'care-tick', now: baselineAt + 5 * minute }),
    transactPet({ type: 'care-tick', now: baselineAt + 5 * minute })])
  const reloaded = readPet(baselineAt + 10 * minute)
  assert.equal(reloaded.care.timerEnergy?.baselineActiveMs, 12 * minute)
  assert.equal(reloaded.care.timerEnergy?.accountedBlocks, 1)
  assert.equal(reloaded.care.energy, 79)
  assert.equal(writes, 2, 'the earned debit is committed once across retries and reload')
})
