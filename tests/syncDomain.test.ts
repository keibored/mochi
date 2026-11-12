import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import type { Activity } from '../src/rewards.ts'
import { activateSync, freshWebSync, ingestSync, isWebSyncState, parseSyncSummary, reserveSync } from '../src/integration/syncDomain.ts'
import type { SyncPairing, SyncSummaryV2, WebSyncState } from '../src/integration/syncDomain.ts'

process.env.TZ = 'Asia/Manila'
const dayStart = new Date(2026, 10, 12, 0).getTime()
const noon = dayStart + 12 * 60 * 60_000
const extensionId = 'a'.repeat(32)
const reservation = (epochId = 'epoch-1', reservedAt = noon): Omit<SyncPairing, 'cutoffAt'> => ({
  extensionId, epochId, reservedAt, token: 'test_capability_'.padEnd(40, 'x'), origin: 'http://localhost:5173',
})
const activity = (duration: number, timestamp = noon - 60_000, category: Activity['category'] = 'Focus', source: Activity['source'] = 'Manual'): Activity => ({
  id: `${timestamp}-${source}-${category}`, duration, category, source, note: '', timestamp: new Date(timestamp).toISOString(),
})
function connected(activities: readonly Activity[] = [], at = noon): WebSyncState {
  const reserved = reserveSync(freshWebSync(), activities, reservation('epoch-1', at))
  return activateSync(reserved, { extensionId, epochId: 'epoch-1', cutoffAt: at + 1000 })
}
function snapshot(milliseconds: number, overrides: Partial<SyncSummaryV2> = {}): SyncSummaryV2 {
  return {
    schemaVersion: 2, source: 'extension', epochId: 'epoch-1', eventId: 'event-1', revision: 1,
    category: 'Focus', startedAtIso: new Date(noon + 1000).toISOString(),
    endedAtIso: new Date(noon + 1000 + milliseconds).toISOString(), activeDurationMs: milliseconds,
    timeZone: 'Asia/Manila', localDate: '2026-11-12', finalized: false, ...overrides,
  }
}
const later = noon + 10 * 60 * 60_000

test('reservation captures old Manual/Timer Focus once without replaying XP', () => {
  const activities = [activity(10), activity(5, noon - 30_000, 'Focus', 'Timer'),
    activity(50, noon - 20_000, 'Rest'), activity(40, noon + 20_000)]
  const reserved = reserveSync(freshWebSync(), activities, reservation())
  assert.equal(reserved.authorityStartedAt, noon)
  assert.deepEqual(reserved.baselineFocusMinutes, { '2026-11-12': 55 })
  assert.equal(reserved.pairing?.cutoffAt, null)
  assert.equal(isWebSyncState(reserved), true)
  const activated = activateSync(reserved, { extensionId, epochId: 'epoch-1', cutoffAt: noon + 1000 })
  const result = ingestSync(activated, [snapshot(60_000)], later)
  assert.deepEqual([result.xpDelta, result.creditsDelta], [0, 0])
})

test('partial millisecond focus combines with the historical baseline and revisions only reward differences', () => {
  const sync = connected([activity(10)])
  const almost = ingestSync(sync, [snapshot(5 * 60_000 - 1)], later)
  assert.deepEqual([almost.xpDelta, almost.creditsDelta], [0, 0])
  const earned = ingestSync(almost.sync, [snapshot(5 * 60_000, { revision: 2 })], later)
  assert.deepEqual([earned.xpDelta, earned.creditsDelta], [5, 2])
  assert.equal(earned.sync.summaries[0].activeDurationMs, 300_000)
  const nextBlock = ingestSync(earned.sync, [snapshot(20 * 60_000, { revision: 3 })], later)
  assert.deepEqual([nextBlock.xpDelta, nextBlock.creditsDelta], [5, 2])
})

test('identical retries and old revisions are safe, including reordered input fields', () => {
  const entry = snapshot(30 * 60_000, { revision: 3 })
  const saved = ingestSync(connected(), [entry], later)
  const reordered = Object.fromEntries(Object.entries(entry).reverse())
  const retry = ingestSync(saved.sync, [reordered], later + 1000)
  assert.deepEqual([retry.xpDelta, retry.creditsDelta], [0, 0])
  const old = ingestSync(retry.sync, [snapshot(15 * 60_000, { revision: 2 })], later + 2000)
  assert.deepEqual([old.xpDelta, old.creditsDelta], [0, 0])
  assert.equal(old.sync.summaries[0].activeDurationMs, 30 * 60_000)
})

test('daily cap includes old focus and preserves uncapped actual totals', () => {
  const result = ingestSync(connected([activity(230)]), [snapshot(30 * 60_000)], later)
  assert.deepEqual([result.xpDelta, result.creditsDelta], [5, 2])
  assert.equal(result.sync.summaries[0].activeDurationMs, 30 * 60_000)
  const capped = ingestSync(result.sync, [snapshot(60 * 60_000, { revision: 2 })], later)
  assert.deepEqual([capped.xpDelta, capped.creditsDelta], [0, 0])
})

test('Leisure and Neutral do not reward or change focus block totals', () => {
  let sync = connected([activity(10)])
  for (const category of ['Leisure', 'Neutral'] as const) {
    const result = ingestSync(sync, [snapshot(60 * 60_000, { category, eventId: category })], later)
    assert.deepEqual([result.xpDelta, result.creditsDelta], [0, 0])
    sync = result.sync
  }
  const focus = ingestSync(sync, [snapshot(5 * 60_000)], later)
  assert.deepEqual([focus.xpDelta, focus.creditsDelta], [5, 2])
})

test('separate local days earn independently, including midnight boundaries', () => {
  const start = dayStart + 23 * 60 * 60_000 + 45 * 60_000
  const end = dayStart + 24 * 60 * 60_000
  const day1 = snapshot(15 * 60_000, { startedAtIso: new Date(start).toISOString(), endedAtIso: new Date(end).toISOString() })
  const day2 = snapshot(15 * 60_000, { eventId: 'day-2', localDate: '2026-11-13',
    startedAtIso: new Date(end).toISOString(), endedAtIso: new Date(end + 15 * 60_000).toISOString() })
  const result = ingestSync(connected(), [day1, day2], end + 60 * 60_000)
  assert.deepEqual([result.xpDelta, result.creditsDelta], [10, 4])
  assert.throws(() => parseSyncSummary({ ...day1, endedAtIso: new Date(end + 1).toISOString() }), /local-day/)
})

test('a new epoch preserves baseline and accepted totals and cannot replay prior IDs', () => {
  const old = ingestSync(connected([activity(10)]), [snapshot(5 * 60_000)], later)
  const nextReserved = reserveSync(old.sync, [activity(200)], reservation('epoch-2', later))
  assert.deepEqual(nextReserved.baselineFocusMinutes, { '2026-11-12': 10 })
  assert.equal(nextReserved.authorityStartedAt, noon)
  assert.equal(nextReserved.summaries.length, 1)
  const next = activateSync(nextReserved, { extensionId, epochId: 'epoch-2', cutoffAt: later + 1000 })
  const newEntry = snapshot(15 * 60_000, { epochId: 'epoch-2', eventId: 'new-event',
    startedAtIso: new Date(later + 1000).toISOString(), endedAtIso: new Date(later + 1000 + 15 * 60_000).toISOString() })
  const added = ingestSync(next, [newEntry], later + 60 * 60_000)
  assert.deepEqual([added.xpDelta, added.creditsDelta], [5, 2])
  assert.equal(added.sync.summaries.length, 2)
  assert.throws(() => ingestSync(next, [{ ...newEntry, eventId: 'event-1' }], later + 60 * 60_000), /immutable/)
})

test('same-epoch reapproval rotates metadata while preserving cutoff, baseline and pending tail eligibility', () => {
  const saved = ingestSync(connected([activity(10)]), [snapshot(60_000)], later)
  const rotated = reserveSync(saved.sync, [activity(200)], {
    ...reservation('epoch-1', later), token: 'new_capability_'.padEnd(40, 'y'), extensionId: 'b'.repeat(32),
  })
  assert.equal(rotated.pairing?.reservedAt, noon)
  assert.equal(rotated.pairing?.cutoffAt, noon + 1000)
  assert.equal(rotated.pairing?.extensionId, 'b'.repeat(32))
  assert.deepEqual(rotated.baselineFocusMinutes, saved.sync.baselineFocusMinutes)
  assert.deepEqual(rotated.summaries, saved.sync.summaries)
  const activated = activateSync(rotated, { extensionId: 'b'.repeat(32), epochId: 'epoch-1', cutoffAt: noon + 1000 })
  const pending = ingestSync(activated, [snapshot(5 * 60_000, { revision: 2 })], later + 1000)
  assert.deepEqual([pending.xpDelta, pending.creditsDelta], [5, 2])
})

test('shrinking, conflicting and finalized updates fail atomically without altering prior state', () => {
  const base = ingestSync(connected(), [snapshot(30 * 60_000, { revision: 2 })], later).sync
  const serialized = JSON.stringify(base)
  for (const changed of [snapshot(20 * 60_000, { revision: 3 }), snapshot(30 * 60_000, { revision: 2, finalized: true }),
    snapshot(30 * 60_000, { revision: 3, category: 'Neutral' }),
    snapshot(40 * 60_000, { revision: 1 }), snapshot(30 * 60_000, { revision: 3, timeZone: 'Asia/Singapore' })]) {
    assert.throws(() => ingestSync(base, [snapshot(60_000, { eventId: 'new-valid' }), changed], later))
    assert.equal(JSON.stringify(base), serialized)
  }
  const finalized = ingestSync(base, [snapshot(30 * 60_000, { revision: 3, finalized: true })], later).sync
  assert.throws(() => ingestSync(finalized, [snapshot(40 * 60_000, { revision: 4, finalized: true })], later), /Finalized/)
  assert.deepEqual(ingestSync(finalized, [snapshot(30 * 60_000, { revision: 3, finalized: true })], later).xpDelta, 0)
})

test('strict schema rejects URLs, rules, unsupported source/category/version, invalid timestamps and local days', () => {
  const valid = snapshot(60_000)
  for (const invalid of [null, {}, { ...valid, hostname: 'example.com' }, { ...valid, fullUrl: 'https://example.com/?private=x' },
    { ...valid, rules: [] }, { ...valid, schemaVersion: 1 }, { ...valid, source: 'Manual' }, { ...valid, category: 'Rest' },
    { ...valid, eventId: 'x'.repeat(129) }, { ...valid, epochId: '' }, { ...valid, revision: 1.5 },
    { ...valid, activeDurationMs: 0 }, { ...valid, activeDurationMs: 60_001 }, { ...valid, activeDurationMs: 1.5 },
    { ...valid, timeZone: 'Not/AZone' }, { ...valid, localDate: '2026-02-30' },
    { ...valid, startedAtIso: '2026-11-12' }, { ...valid, endedAtIso: valid.startedAtIso },
    { ...valid, startedAtIso: new Date(noon - 1000).toISOString(), localDate: '2026-11-13' }]) {
    assert.throws(() => parseSyncSummary(invalid), RangeError)
  }
  assert.deepEqual(parseSyncSummary(valid), valid)
})

test('activation and ingestion reject a wrong epoch, sender, cutoff or pre-cutoff/future interval', () => {
  const reserved = reserveSync(freshWebSync(), [], reservation())
  assert.throws(() => ingestSync(reserved, [snapshot(60_000)], later), /activated/)
  assert.throws(() => activateSync(reserved, { extensionId, epochId: 'wrong', cutoffAt: noon + 1000 }))
  assert.throws(() => activateSync(reserved, { extensionId: 'b'.repeat(32), epochId: 'epoch-1', cutoffAt: noon + 1000 }))
  assert.throws(() => activateSync(reserved, { extensionId, epochId: 'epoch-1', cutoffAt: noon - 1 }))
  const sync = connected()
  assert.throws(() => activateSync(sync, { extensionId, epochId: 'epoch-1', cutoffAt: noon + 2000 }), /cutoff/)
  assert.throws(() => ingestSync(sync, [snapshot(60_000, { epochId: 'other' })], later))
  assert.throws(() => ingestSync(sync, [snapshot(60_000, { startedAtIso: new Date(noon).toISOString() })], later))
  assert.throws(() => ingestSync(sync, [snapshot(60_000)], noon + 2000))
})

test('saved-state validation rejects malformed pairings, ledgers and baseline totals', () => {
  assert.equal(isWebSyncState(freshWebSync()), true)
  const sync = ingestSync(connected([activity(10)]), [snapshot(60_000)], later).sync
  assert.equal(isWebSyncState(JSON.parse(JSON.stringify(sync))), true)
  for (const invalid of [{ ...sync, extra: true }, { ...sync, authorityStartedAt: null },
    { ...sync, baselineFocusMinutes: { '2026-11-12': -1 } }, { ...sync, baselineFocusMinutes: { invalid: 10 } },
    { ...sync, pairing: { ...sync.pairing, origin: 'http://localhost:5173/' } },
    { ...sync, pairing: { ...sync.pairing, origin: 'http://localhost:5174' } },
    { ...sync, pairing: { ...sync.pairing, extensionId: 'invalid' } },
    { ...sync, pairing: { ...sync.pairing, token: 'short' } },
    { ...sync, summaries: [sync.summaries[0], sync.summaries[0]] }]) assert.equal(isWebSyncState(invalid), false)
})

test('already rewarded Focus stamped at the reservation remains in the daily cap baseline', () => {
  const sync = connected([activity(230, noon)])
  assert.equal(sync.baselineFocusMinutes['2026-11-12'], 230)
  const result = ingestSync(sync, [snapshot(30 * 60_000)], later)
  assert.deepEqual([result.xpDelta, result.creditsDelta], [5, 2])
})
