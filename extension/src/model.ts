import { areWebsiteRules, categoryForHostname, normalizeHostname } from '../../src/websiteRules.ts'
import type { WebsiteCategory, WebsiteRule } from '../../src/websiteRules.ts'
import type { ExtensionActivitySummaryV1 } from '../../src/integration/extensionActivity.ts'

export const STORAGE_KEY = 'mochi.extension.v1'
export const IDLE_SECONDS = 60
export const MAX_GAP_MS = 45_000
export const CLOCK_TOLERANCE_MS = 2_000
export const RETENTION_MS = 7 * 24 * 60 * 60_000
export const MAX_SUMMARIES = 64
export const MAX_RULES = 200
export type LocalSummary = ExtensionActivitySummaryV1 & { finalized: boolean }
export interface TrackingState {
  version: 1
  enabled: boolean
  paused: boolean
  rules: WebsiteRule[]
  summaries: LocalSummary[]
  checkpointAt: number
}
export interface Observation {
  focused: boolean
  idle: 'active' | 'idle' | 'locked'
  hostname: string | null
  category: WebsiteCategory
  timeZone: string
}
export type TrackingStatus = 'Tracking off' | 'Tracking' | 'Paused' | 'Idle' | 'Browser unfocused' | 'No supported website'
export const freshState = (): TrackingState => ({ version: 1, enabled: false, paused: false, rules: [], summaries: [], checkpointAt: 0 })

export function localDay(at: number): string {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function hostnameFromTab(url: string | undefined, incognito: boolean): string | null {
  if (incognito || !url || !/^https?:\/\//i.test(url)) return null
  try { return normalizeHostname(url) } catch { return null }
}

export function statusFor(state: TrackingState, observation: Observation): TrackingStatus {
  if (!state.enabled) return 'Tracking off'
  if (state.paused) return 'Paused'
  if (!observation.focused) return 'Browser unfocused'
  if (observation.idle !== 'active') return 'Idle'
  return observation.hostname ? 'Tracking' : 'No supported website'
}

export function classify(rules: readonly WebsiteRule[], hostname: string | null): WebsiteCategory {
  return hostname ? categoryForHostname(rules, hostname) : 'Neutral'
}

export function isTrackingState(value: unknown): value is TrackingState {
  if (typeof value !== 'object' || value === null) return false
  const state = value as Partial<TrackingState>
  if (state.version !== 1 || typeof state.enabled !== 'boolean' || typeof state.paused !== 'boolean' ||
      !areWebsiteRules(state.rules) || state.rules.length > MAX_RULES ||
      !Number.isSafeInteger(state.checkpointAt) || state.checkpointAt! < 0 || !Number.isFinite(new Date(state.checkpointAt!).getTime()) ||
      !Array.isArray(state.summaries) || state.summaries.length > MAX_SUMMARIES) return false
  const ids = new Set<string>()
  return state.summaries.every((item: unknown) => {
    if (typeof item !== 'object' || item === null) return false
    const entry = item as Partial<LocalSummary>
    if (entry.schemaVersion !== 1 || entry.source !== 'extension' || typeof entry.eventId !== 'string' ||
        !entry.eventId || ids.has(entry.eventId) || !['Focus', 'Leisure', 'Neutral'].includes(entry.category!) ||
        typeof entry.startedAtIso !== 'string' || typeof entry.endedAtIso !== 'string' ||
        typeof entry.timeZone !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(entry.localDate ?? '') ||
        typeof entry.finalized !== 'boolean' || !Number.isSafeInteger(entry.activeDurationMs) || entry.activeDurationMs! <= 0) return false
    const start = Date.parse(entry.startedAtIso), end = Date.parse(entry.endedAtIso)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || entry.activeDurationMs! > end - start) return false
    try {
      if (new Date(start).toISOString() !== entry.startedAtIso || new Date(end).toISOString() !== entry.endedAtIso) return false
      const formatter = new Intl.DateTimeFormat('en', { timeZone: entry.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      const dayInZone = (at: number) => {
        const parts = formatter.formatToParts(new Date(at))
        const part = (name: string) => parts.find((item) => item.type === name)?.value
        return `${part('year')}-${part('month')}-${part('day')}`
      }
      if (dayInZone(start) !== entry.localDate || dayInZone(end - 1) !== entry.localDate) return false
    } catch { return false }
    ids.add(entry.eventId)
    return true
  })
}

/** Immutable category/day aggregates; no hostname or tab history is stored.
 * Local midnight comes from calendar arithmetic, including DST days.
 */
export function addTime(state: TrackingState, start: number, end: number, category: WebsiteCategory, timeZone: string, id: () => string): TrackingState {
  const summaries = state.summaries.map((summary) => ({ ...summary }))
  let cursor = start
  while (cursor < end) {
    const date = new Date(cursor)
    const midnight = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
    const boundary = Math.min(end, midnight)
    const day = localDay(cursor)
    const existing = summaries.find((entry) => !entry.finalized && entry.category === category && entry.localDate === day && entry.timeZone === timeZone)
    if (existing) {
      existing.activeDurationMs += boundary - cursor
      existing.endedAtIso = new Date(boundary).toISOString()
    } else {
      summaries.push({ schemaVersion: 1, eventId: id(), source: 'extension', category,
        startedAtIso: new Date(cursor).toISOString(), endedAtIso: new Date(boundary).toISOString(),
        activeDurationMs: boundary - cursor, timeZone, localDate: day, finalized: false })
    }
    cursor = boundary
  }
  return { ...state, summaries }
}

export function prune(state: TrackingState, now: number, timeZone: string): TrackingState {
  return { ...state, summaries: state.summaries
    .filter((entry) => Date.parse(entry.endedAtIso) >= now - RETENTION_MS)
    .map((entry) => entry.localDate !== localDay(now) || entry.timeZone !== timeZone ? { ...entry, finalized: true } : entry)
    .sort((a, b) => Date.parse(a.endedAtIso) - Date.parse(b.endedAtIso)).slice(-MAX_SUMMARIES) }
}

export function todayTotals(state: TrackingState, now: number): Record<WebsiteCategory, number> {
  const totals = { Focus: 0, Leisure: 0, Neutral: 0 }
  for (const entry of state.summaries) if (entry.localDate === localDay(now)) totals[entry.category] += entry.activeDurationMs
  return totals
}
