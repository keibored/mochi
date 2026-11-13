import { localDateKey } from '../rewards.ts'
import type { Activity, ActivityCategory } from '../rewards.ts'
import type { WebSyncState } from './syncDomain.ts'

/** Browser aggregates keep the local date/timezone established when tracked. */
function extensionDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Only actual browser aggregates; optional records and baseline stay separate. */
export function browserSummary(sync: WebSyncState, date: Date): Record<ActivityCategory, number> {
  const totals = { Focus: 0, Leisure: 0, Rest: 0, Neutral: 0 }
  const day = extensionDay(date)
  for (const summary of sync.summaries) {
    if (summary.localDate === day) totals[summary.category] += summary.activeDurationMs / 60_000
  }
  return totals
}

export function focusBaselineForDate(sync: WebSyncState, date: Date): number {
  return sync.baselineFocusMinutes[extensionDay(date)] ?? 0
}

export function dashboardSummary(activities: readonly Activity[], sync: WebSyncState, date: Date): Record<ActivityCategory, number> {
  const totals = { Focus: 0, Leisure: 0, Rest: 0, Neutral: 0 }
  const day = extensionDay(date)
  if (sync.authorityStartedAt !== null) totals.Focus = sync.baselineFocusMinutes[day] ?? 0
  for (const activity of activities) {
    if (localDateKey(new Date(activity.timestamp)) !== localDateKey(date)) continue
    // The captured baseline includes all previously rewarded Focus, even if its
    // timestamp equals the reservation or the device clock had moved backwards.
    if (sync.authorityStartedAt !== null && activity.category === 'Focus') continue
    // Intentional rest stays useful after browser tracking becomes authoritative.
    if (sync.authorityStartedAt === null || Date.parse(activity.timestamp) < sync.authorityStartedAt || activity.category === 'Rest') {
      totals[activity.category] += activity.duration
    }
  }
  for (const summary of sync.summaries) {
    if (summary.localDate === day) totals[summary.category] += summary.activeDurationMs / 60_000
  }
  return totals
}

export interface RecentActivity {
  id: string
  source: 'Manual' | 'Timer' | 'Extension'
  category: ActivityCategory
  duration: number
  note: string
  timestamp: string
}

export function recentActivityView(activities: readonly Activity[], sync: WebSyncState, limit = 5): RecentActivity[] {
  return [...activities, ...sync.summaries.map((summary): RecentActivity => ({
    id: `extension:${summary.epochId}:${summary.eventId}`,
    source: 'Extension', category: summary.category, duration: summary.activeDurationMs / 60_000,
    note: '', timestamp: summary.endedAtIso,
  }))].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, limit)
}

/** Do not round small, real browser intervals down to a misleading zero. */
export function formatMinutes(minutes: number): string {
  if (minutes > 0 && minutes < 0.01) return '<0.01'
  return minutes.toLocaleString(undefined, { maximumFractionDigits: 2 })
}
