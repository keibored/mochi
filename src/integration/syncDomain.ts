import { CREDITS_PER_REWARD, DAILY_REWARD_CAP, MINUTES_PER_REWARD, XP_PER_REWARD } from '../rewards.ts'
import type { Activity } from '../rewards.ts'
import { APP_ORIGIN } from './localConfig.ts'

export interface SyncSummaryV2 {
  schemaVersion: 2
  source: 'extension'
  epochId: string
  eventId: string
  revision: number
  category: 'Focus' | 'Leisure' | 'Neutral'
  startedAtIso: string
  endedAtIso: string
  activeDurationMs: number
  timeZone: string
  localDate: string
  finalized: boolean
}

export interface SyncPairing {
  extensionId: string
  epochId: string
  token: string
  origin: string
  reservedAt: number
  cutoffAt: number | null
}

export interface WebSyncState {
  /** Sticky local-tool reward cutoff, including while pairing is pending. */
  authorityStartedAt: number | null
  baselineFocusMinutes: Record<string, number>
  pairing: SyncPairing | null
  /** Accepted cumulative snapshots, retained across connection epochs. */
  summaries: SyncSummaryV2[]
  lastSuccessfulSyncAt: number | null
}

export const MAX_SYNC_BATCH = 256
const SUMMARY_KEYS = ['schemaVersion', 'source', 'epochId', 'eventId', 'revision', 'category', 'startedAtIso', 'endedAtIso', 'activeDurationMs', 'timeZone', 'localDate', 'finalized'] as const
const PAIRING_KEYS = ['extensionId', 'epochId', 'token', 'origin', 'reservedAt', 'cutoffAt']
const STATE_KEYS = ['authorityStartedAt', 'baselineFocusMinutes', 'pairing', 'summaries', 'lastSuccessfulSyncAt']
const fail = (message: string): never => { throw new RangeError(message) }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())

function isoTimestamp(value: unknown): number {
  if (typeof value !== 'string') return fail('Expected a UTC ISO timestamp.')
  const at = Date.parse(value)
  if (!timestamp(at) || new Date(at).toISOString() !== value) return fail('Expected a UTC ISO timestamp.')
  return at
}

function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function dayAt(at: number, formatter: Intl.DateTimeFormat): string {
  const parts = formatter.formatToParts(new Date(at))
  const part = (type: string) => parts.find((item) => item.type === type)?.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Strict runtime boundary: no URL, hostname, title, rule, or arbitrary field. */
export function parseSyncSummary(value: unknown): SyncSummaryV2 {
  if (!record(value) || !exactKeys(value, SUMMARY_KEYS) || value.schemaVersion !== 2 || value.source !== 'extension' ||
      !identifier(value.epochId) || !identifier(value.eventId) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
      typeof value.category !== 'string' || !['Focus', 'Leisure', 'Neutral'].includes(value.category) ||
      !Number.isSafeInteger(value.activeDurationMs) || (value.activeDurationMs as number) <= 0 ||
      typeof value.finalized !== 'boolean' || typeof value.timeZone !== 'string' || value.timeZone.length > 80 || !value.timeZone ||
      !calendarDay(value.localDate)) return fail('Invalid extension summary schema.')
  const start = isoTimestamp(value.startedAtIso), end = isoTimestamp(value.endedAtIso)
  if (end <= start || (value.activeDurationMs as number) > end - start) return fail('Invalid active duration or timestamp interval.')
  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en', { timeZone: value.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch { return fail('Invalid summary timezone.') }
  if (dayAt(start, formatter) !== value.localDate || dayAt(end - 1, formatter) !== value.localDate) return fail('Summary crosses a local-day boundary.')
  return { schemaVersion: 2, source: 'extension', epochId: value.epochId, eventId: value.eventId,
    revision: value.revision as number, category: value.category as SyncSummaryV2['category'],
    startedAtIso: value.startedAtIso as string, endedAtIso: value.endedAtIso as string,
    activeDurationMs: value.activeDurationMs as number, timeZone: value.timeZone, localDate: value.localDate, finalized: value.finalized }
}

function validOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 2048) return false
  try {
    const url = new URL(value)
    return value === APP_ORIGIN && !url.username && !url.password && url.origin === value
  } catch { return false }
}

function validPairing(value: unknown): value is SyncPairing {
  if (!record(value) || !exactKeys(value, PAIRING_KEYS) || typeof value.extensionId !== 'string' || !/^[a-p]{32}$/.test(value.extensionId) ||
      !identifier(value.epochId) || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(value.token) ||
      !validOrigin(value.origin) || !timestamp(value.reservedAt)) return false
  return value.cutoffAt === null || (timestamp(value.cutoffAt) && value.cutoffAt >= value.reservedAt)
}

export function freshWebSync(): WebSyncState {
  return { authorityStartedAt: null, baselineFocusMinutes: {}, pairing: null, summaries: [], lastSuccessfulSyncAt: null }
}

export function isWebSyncState(value: unknown): value is WebSyncState {
  if (!record(value) || !exactKeys(value, STATE_KEYS) ||
      (value.authorityStartedAt !== null && !timestamp(value.authorityStartedAt)) ||
      !record(value.baselineFocusMinutes) || !Array.isArray(value.summaries) ||
      (value.lastSuccessfulSyncAt !== null && !timestamp(value.lastSuccessfulSyncAt)) ||
      (value.pairing !== null && !validPairing(value.pairing))) return false
  if (!Object.entries(value.baselineFocusMinutes).every(([day, minutes]) => calendarDay(day) &&
      typeof minutes === 'number' && Number.isSafeInteger(minutes) && minutes >= 0)) return false
  const ids = new Set<string>()
  for (const summary of value.summaries) {
    let parsed: SyncSummaryV2
    try { parsed = parseSyncSummary(summary) } catch { return false }
    if (ids.has(parsed.eventId) || value.authorityStartedAt === null || Date.parse(parsed.startedAtIso) < value.authorityStartedAt) return false
    if (value.pairing !== null && parsed.epochId === value.pairing.epochId &&
        (value.pairing.cutoffAt === null || Date.parse(parsed.startedAtIso) < value.pairing.cutoffAt)) return false
    ids.add(parsed.eventId)
  }
  if (value.authorityStartedAt === null) {
    return value.pairing === null && value.lastSuccessfulSyncAt === null && value.summaries.length === 0 && Object.keys(value.baselineFocusMinutes).length === 0
  }
  return value.pairing === null || value.pairing.reservedAt >= value.authorityStartedAt
}

/** Capture historical local-tool Focus exactly once; never replay its rewards.
 * Reservation immediately and permanently switches local-tool reward authority.
 */
export function reserveSync(previous: WebSyncState, activities: readonly Activity[], reservation: Omit<SyncPairing, 'cutoffAt'>): WebSyncState {
  if (!isWebSyncState(previous)) return fail('Invalid saved synchronization state.')
  const pairing = { ...reservation, cutoffAt: null }
  if (!validPairing(pairing)) return fail('Invalid pairing reservation.')
  if (previous.pairing?.epochId === pairing.epochId) {
    // Explicit reapproval may rotate its capability or unpacked extension ID.
    // Resume the same accounting epoch with the original reservation/cutoff,
    // so buffered unsynced snapshots are not discarded by a newer request time.
    const resumed = { ...pairing, reservedAt: previous.pairing.reservedAt, cutoffAt: previous.pairing.cutoffAt }
    return { ...previous, pairing: resumed }
  }
  if (previous.summaries.some((entry) => entry.epochId === pairing.epochId) ||
      (previous.authorityStartedAt !== null && pairing.reservedAt < previous.authorityStartedAt) ||
      (previous.pairing !== null && pairing.reservedAt < previous.pairing.reservedAt)) return fail('Pairing epoch cannot be reused or moved backwards.')
  if (previous.authorityStartedAt !== null) return { ...previous, pairing }
  const baselineFocusMinutes: Record<string, number> = {}
  for (const activity of activities) {
    if (activity.category !== 'Focus' || (activity.source !== 'Manual' && activity.source !== 'Timer')) continue
    const at = isoTimestamp(activity.timestamp)
    // Every entry already in the state has already received its old rewards,
    // including entries stamped in the same millisecond or by a changed clock.
    if (!Number.isSafeInteger(activity.duration) || activity.duration <= 0) return fail('Invalid historical Focus duration.')
    const date = new Date(at)
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const total = (baselineFocusMinutes[day] ?? 0) + activity.duration
    if (!Number.isSafeInteger(total)) return fail('Historical Focus total is too large.')
    baselineFocusMinutes[day] = total
  }
  return { ...previous, authorityStartedAt: pairing.reservedAt, baselineFocusMinutes, pairing }
}

export function activateSync(sync: WebSyncState, activation: { epochId: string; extensionId: string; cutoffAt: number }): WebSyncState {
  if (!isWebSyncState(sync) || !sync.pairing || activation.epochId !== sync.pairing.epochId ||
      activation.extensionId !== sync.pairing.extensionId || !timestamp(activation.cutoffAt) ||
      activation.cutoffAt < sync.pairing.reservedAt) return fail('Pairing activation does not match the reservation.')
  if (sync.pairing.cutoffAt !== null) {
    if (sync.pairing.cutoffAt !== activation.cutoffAt) return fail('Pairing cutoff conflict.')
    return sync
  }
  return { ...sync, pairing: { ...sync.pairing, cutoffAt: activation.cutoffAt } }
}

function earnedBlocks(sync: WebSyncState): number {
  const capMs = DAILY_REWARD_CAP * 60_000
  const dayTotals = new Map<string, number>()
  for (const [day, minutes] of Object.entries(sync.baselineFocusMinutes)) dayTotals.set(day, Math.min(minutes, DAILY_REWARD_CAP) * 60_000)
  for (const entry of sync.summaries) if (entry.category === 'Focus') {
    dayTotals.set(entry.localDate, Math.min(capMs, (dayTotals.get(entry.localDate) ?? 0) + entry.activeDurationMs))
  }
  return [...dayTotals.values()].reduce((total, milliseconds) => total + Math.floor(milliseconds / (MINUTES_PER_REWARD * 60_000)), 0)
}

const immutableHeaders = (entry: SyncSummaryV2) => [entry.schemaVersion, entry.source, entry.epochId, entry.eventId, entry.category, entry.startedAtIso, entry.timeZone, entry.localDate]
const identical = (a: SyncSummaryV2, b: SyncSummaryV2) => SUMMARY_KEYS.every((key) => a[key] === b[key])

/** Accept an entire batch atomically or throw without mutating any prior data. */
export function ingestSync(sync: WebSyncState, snapshots: unknown, syncedAt: number): { sync: WebSyncState; xpDelta: number; creditsDelta: number } {
  if (!isWebSyncState(sync) || !sync.pairing || sync.pairing.cutoffAt === null) return fail('An activated pairing is required.')
  if (!timestamp(syncedAt) || syncedAt < sync.pairing.cutoffAt || !Array.isArray(snapshots) || snapshots.length > MAX_SYNC_BATCH) return fail('Invalid synchronization batch.')
  const summaries = [...sync.summaries]
  for (const snapshot of snapshots) {
    const incoming = parseSyncSummary(snapshot)
    if (incoming.epochId !== sync.pairing.epochId || Date.parse(incoming.startedAtIso) < sync.pairing.cutoffAt ||
        Date.parse(incoming.endedAtIso) > syncedAt) return fail('Summary does not belong to the active pairing interval.')
    const index = summaries.findIndex((entry) => entry.eventId === incoming.eventId)
    if (index < 0) { summaries.push(incoming); continue }
    const old = summaries[index]
    if (JSON.stringify(immutableHeaders(old)) !== JSON.stringify(immutableHeaders(incoming))) return fail('Summary identity or immutable fields changed.')
    if (incoming.revision < old.revision) {
      if (incoming.activeDurationMs > old.activeDurationMs || Date.parse(incoming.endedAtIso) > Date.parse(old.endedAtIso)) return fail('Old revision conflicts with accepted totals.')
      continue
    }
    if (incoming.revision === old.revision) {
      if (!identical(old, incoming)) return fail('Conflicting contents for the same summary revision.')
      continue
    }
    if (old.finalized || incoming.activeDurationMs < old.activeDurationMs || Date.parse(incoming.endedAtIso) < Date.parse(old.endedAtIso)) return fail('Finalized or cumulative summary cannot be changed or reduced.')
    summaries[index] = incoming
  }
  const next = { ...sync, summaries, lastSuccessfulSyncAt: Math.max(sync.lastSuccessfulSyncAt ?? 0, syncedAt) }
  const blocks = earnedBlocks(next) - earnedBlocks(sync)
  const xpDelta = blocks * XP_PER_REWARD, creditsDelta = blocks * CREDITS_PER_REWARD
  if (!Number.isSafeInteger(xpDelta) || !Number.isSafeInteger(creditsDelta) || blocks < 0) return fail('Invalid reward difference.')
  return { sync: next, xpDelta, creditsDelta }
}
