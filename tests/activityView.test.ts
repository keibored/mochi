import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { browserSummary, dashboardSummary, focusBaselineForDate, formatMinutes, recentActivityView } from '../src/integration/activityView.ts'
import { freshWebSync } from '../src/integration/syncDomain.ts'
import type { SyncSummaryV2 } from '../src/integration/syncDomain.ts'
import type { Activity } from '../src/rewards.ts'

process.env.TZ = 'Asia/Manila'
const before = new Date(2026, 10, 12, 10).getTime()
const after = before + 60_000
const activity = (id: string, category: Activity['category'], at = after, source: Activity['source'] = 'Manual'): Activity => ({
  id, source, category, duration: 30, note: '', timestamp: new Date(at).toISOString(),
})
const summary = (id: string, category: SyncSummaryV2['category'], activeDurationMs: number): SyncSummaryV2 => ({
  schemaVersion: 2, source: 'extension', epochId: 'epoch', eventId: id, revision: 1, category,
  startedAtIso: new Date(after).toISOString(), endedAtIso: new Date(after + activeDurationMs).toISOString(),
  activeDurationMs, timeZone: 'Asia/Manila', localDate: '2026-11-12', finalized: false,
})

test('unconnected activity totals retain the existing manual and timer behavior', () => {
  const entries = [activity('focus', 'Focus'), activity('timer', 'Focus', after, 'Timer'), activity('rest', 'Rest')]
  assert.deepEqual(dashboardSummary(entries, freshWebSync(), new Date(after)), { Focus: 60, Leisure: 0, Rest: 30, Neutral: 0 })
})

test('primary totals exclude post-authority optional overlap while preserving intentional Rest', () => {
  const entries = [activity('old-focus', 'Focus', before - 1), activity('old-fun', 'Leisure', before - 1),
    activity('new-focus', 'Focus'), activity('new-timer', 'Focus', after, 'Timer'),
    activity('new-fun', 'Leisure'), activity('new-neutral', 'Neutral'), activity('rest', 'Rest')]
  const sync = { ...freshWebSync(), authorityStartedAt: before, baselineFocusMinutes: { '2026-11-12': 30 }, summaries: [summary('browser-focus', 'Focus', 90_000), summary('browser-neutral', 'Neutral', 30_000)] }
  assert.deepEqual(dashboardSummary(entries, sync, new Date(after)), { Focus: 31.5, Leisure: 30, Rest: 30, Neutral: 0.5 })
  assert.equal(entries.length, 7, 'optional entries stay in the original history')
})

test('browser-only totals exclude prior baseline and overlapping optional records', () => {
  const entries = [activity('manual-focus', 'Focus'), activity('timer-focus', 'Focus', after, 'Timer'), activity('manual-rest', 'Rest')]
  const sync = { ...freshWebSync(), authorityStartedAt: before, baselineFocusMinutes: { '2026-11-12': 30 },
    summaries: [summary('tracked-focus', 'Focus', 90_000), summary('tracked-fun', 'Leisure', 30_000), summary('tracked-neutral', 'Neutral', 15_000)] }
  assert.deepEqual(browserSummary(sync, new Date(after)), { Focus: 1.5, Leisure: 0.5, Rest: 0, Neutral: 0.25 })
  assert.equal(dashboardSummary(entries, sync, new Date(after)).Focus, 31.5, 'goal retains the already-rewarded Focus baseline')
  assert.equal(dashboardSummary(entries, sync, new Date(after)).Rest, 30, 'intentional Rest stays a separate manual total')
  assert.deepEqual(sync.baselineFocusMinutes, { '2026-11-12': 30 })
})

test('browser totals and baseline use padded local dates for single-digit months and days', () => {
  const at = new Date(2026, 0, 9, 12)
  const tracked = { ...summary('january-focus', 'Focus', 90_000),
    startedAtIso: at.toISOString(), endedAtIso: new Date(at.getTime() + 90_000).toISOString(), localDate: '2026-01-09' }
  const sync = { ...freshWebSync(), authorityStartedAt: at.getTime(), baselineFocusMinutes: { '2026-01-09': 45 }, summaries: [tracked] }
  assert.equal(browserSummary(sync, at).Focus, 1.5)
  assert.equal(focusBaselineForDate(sync, at), 45)
  assert.equal(focusBaselineForDate(sync, new Date(2026, 0, 10, 12)), 0)
})

test('browser totals and baseline switch at local midnight rather than the UTC day', () => {
  const midnight = new Date(2026, 0, 10)
  const prior = { ...summary('before-midnight', 'Focus', 60_000),
    startedAtIso: new Date(midnight.getTime() - 60_000).toISOString(), endedAtIso: midnight.toISOString(), localDate: '2026-01-09' }
  const next = { ...summary('after-midnight', 'Leisure', 30_000),
    startedAtIso: midnight.toISOString(), endedAtIso: new Date(midnight.getTime() + 30_000).toISOString(), localDate: '2026-01-10' }
  const sync = { ...freshWebSync(), authorityStartedAt: before,
    baselineFocusMinutes: { '2026-01-09': 15, '2026-01-10': 5 }, summaries: [prior, next] }
  assert.deepEqual(browserSummary(sync, new Date(midnight.getTime() - 1)), { Focus: 1, Leisure: 0, Rest: 0, Neutral: 0 })
  assert.deepEqual(browserSummary(sync, midnight), { Focus: 0, Leisure: 0.5, Rest: 0, Neutral: 0 })
  assert.equal(focusBaselineForDate(sync, new Date(midnight.getTime() - 1)), 15)
  assert.equal(focusBaselineForDate(sync, midnight), 5)
})

test('captured Focus baseline preserves already-saved entries at the reservation timestamp or after clock changes', () => {
  const entries = [activity('equal', 'Focus', before), activity('future', 'Focus', after), activity('later-unrewarded', 'Focus', after + 1000)]
  const sync = { ...freshWebSync(), authorityStartedAt: before, baselineFocusMinutes: { '2026-11-12': 60 } }
  assert.equal(dashboardSummary(entries, sync, new Date(after)).Focus, 60)
})

test('browser summaries use their original local day, including around midnight', () => {
  const midnight = new Date(2026, 10, 13, 0, 1)
  const sync = { ...freshWebSync(), authorityStartedAt: before, summaries: [summary('previous-day', 'Focus', 60_000)] }
  assert.equal(dashboardSummary([], sync, midnight).Focus, 0)
  assert.equal(dashboardSummary([], sync, new Date(2026, 10, 12, 23, 59)).Focus, 1)
})

test('recent history preserves Manual and Timer labels and includes real fractional Extension minutes newest first', () => {
  const entries = [activity('old', 'Focus', before, 'Timer'), activity('new', 'Rest', after)]
  const sync = { ...freshWebSync(), summaries: [summary('browser', 'Leisure', 30_000)] }
  const recent = recentActivityView(entries, sync)
  assert.deepEqual(recent.map((entry) => entry.source), ['Extension', 'Manual', 'Timer'])
  assert.equal(recent[0].duration, 0.5)
  assert.equal(recent[0].timestamp, sync.summaries[0].endedAtIso)
  assert.equal(recentActivityView(entries, sync, 1).length, 1)
  assert.equal(entries[0].id, 'old', 'building a view does not reorder persisted entries')
})

test('minute labels preserve partial time and do not show tiny tracked intervals as zero', () => {
  assert.equal(formatMinutes(0), '0')
  assert.equal(formatMinutes(0.5), (0.5).toLocaleString(undefined, { maximumFractionDigits: 2 }))
  assert.equal(formatMinutes(1 / 60_000), '<0.01')
})
