import type { Activity } from './rewards.ts'
import type { SyncSummaryV2, WebSyncState } from './integration/syncDomain.ts'
import { completionTime, remainingMs } from './timer.ts'
import type { TimerSession } from './timer.ts'

export const MAX_CARE_STAT = 100
export const DEFAULT_FULLNESS = 80
export const DEFAULT_ENERGY = 80
export const FEED_FULLNESS = 20
export const DEFAULT_LEISURE_ALLOWANCE = 60
export const MIN_LEISURE_ALLOWANCE = 0
export const MAX_LEISURE_ALLOWANCE = 1440
export const LEISURE_STEP_MS = 15 * 60_000
export const FULLNESS_PER_LEISURE_STEP = 5
export const REST_STEP_MS = 5 * 60_000
export const ENERGY_PER_REST_STEP = 5
export const FOCUS_ENERGY_STEP_MS = 5 * 60_000
export const ENERGY_PER_FOCUS_STEP = 1

export interface LeisureDayCare {
  /** Eligible Leisure already observed, including historical/buffered baselines. */
  observedMs: number
  /** New excess since the last allowance edit; consumed even at zero fullness. */
  excessRemainderMs: number
}

export interface RestSession {
  id: string
  startedAt: number
  accountedBlocks: number
}

export interface TimerEnergyCursor {
  timerId: string
  /** Existing active time at migration is deliberately never charged again. */
  baselineActiveMs: number
  accountedBlocks: number
}

export interface PetCare {
  fullness: number
  energy: number
  dailyLeisureAllowance: number
  /** New/edited policy boundary; ambiguous older aggregates are baselined. */
  policyStartedAt: number
  leisureDays: Record<string, LeisureDayCare>
  rest: RestSession | null
  timerEnergy: TimerEnergyCursor | null
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const isCareTimestamp = (value: unknown): value is number => integer(value) && Number.isFinite(new Date(value).getTime())
export const isValidLeisureAllowance = (value: unknown): value is number => integer(value) && value >= MIN_LEISURE_ALLOWANCE && value <= MAX_LEISURE_ALLOWANCE
const isStat = (value: unknown): value is number => integer(value) && value <= MAX_CARE_STAT
const isRestId = (value: unknown): value is string => typeof value === 'string' && /^rest-[A-Za-z0-9_-]{1,123}$/.test(value)
const dayKey = (at: number) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
export const clampCareStat = (value: number): number => Math.max(0, Math.min(MAX_CARE_STAT, value))

export function freshCare(now = 0): PetCare {
  if (!isCareTimestamp(now)) throw new RangeError('Invalid care timestamp.')
  return { fullness: DEFAULT_FULLNESS, energy: DEFAULT_ENERGY,
    dailyLeisureAllowance: DEFAULT_LEISURE_ALLOWANCE, policyStartedAt: now,
    leisureDays: {}, rest: null, timerEnergy: null }
}

export function activeTimerMs(timer: TimerSession, now: number): number {
  return timer.duration * 60_000 - remainingMs(timer, now)
}

/** Migration changes no balances: previously accepted time only consumes allowance. */
export function migrateCare(activities: readonly Activity[], sync: WebSyncState, timer: TimerSession | null, now: number): PetCare {
  const care = freshCare(now)
  const baseline = (day: string, milliseconds: number) => {
    const observedMs = (care.leisureDays[day]?.observedMs ?? 0) + milliseconds
    if (!Number.isSafeInteger(observedMs)) throw new RangeError('Historical Leisure total is too large.')
    care.leisureDays[day] = { observedMs, excessRemainderMs: 0 }
  }
  for (const activity of activities) {
    if (activity.category !== 'Leisure' || activity.source !== 'Manual') continue
    const at = Date.parse(activity.timestamp)
    // Saved optional logs after extension authority are not a second care source.
    if (sync.authorityStartedAt !== null && at >= sync.authorityStartedAt) continue
    baseline(dayKey(at), activity.duration * 60_000)
  }
  for (const summary of sync.summaries) if (summary.category === 'Leisure') baseline(summary.localDate, summary.activeDurationMs)
  if (timer) care.timerEnergy = { timerId: timer.id, baselineActiveMs: activeTimerMs(timer, now), accountedBlocks: 0 }
  return care
}

/** Validate persisted counters as well as the relationship with an optional timer. */
export function isPetCare(value: unknown, timer: TimerSession | null): value is PetCare {
  if (!record(value) || !exactKeys(value, ['fullness', 'energy', 'dailyLeisureAllowance', 'policyStartedAt', 'leisureDays', 'rest', 'timerEnergy']) ||
      !isStat(value.fullness) || !isStat(value.energy) || !isValidLeisureAllowance(value.dailyLeisureAllowance) ||
      !isCareTimestamp(value.policyStartedAt) || !record(value.leisureDays)) return false
  for (const [day, ledger] of Object.entries(value.leisureDays)) {
    if (!isDay(day) || !record(ledger) || !exactKeys(ledger, ['observedMs', 'excessRemainderMs']) ||
        !integer(ledger.observedMs) || !integer(ledger.excessRemainderMs) || ledger.excessRemainderMs >= LEISURE_STEP_MS ||
        ledger.excessRemainderMs > ledger.observedMs) return false
  }
  if (value.rest !== null) {
    const rest = value.rest
    if (!record(rest) || !exactKeys(rest, ['id', 'startedAt', 'accountedBlocks']) || !isRestId(rest.id) ||
        !isCareTimestamp(rest.startedAt) || !integer(rest.accountedBlocks) ||
        !Number.isFinite(new Date(rest.startedAt + rest.accountedBlocks * REST_STEP_MS).getTime())) return false
    if (timer?.runningSince !== null && timer !== null && completionTime(timer, rest.startedAt) === null) return false
  }
  if (timer === null) return value.timerEnergy === null
  const cursor = value.timerEnergy
  return record(cursor) && exactKeys(cursor, ['timerId', 'baselineActiveMs', 'accountedBlocks']) &&
    cursor.timerId === timer.id && integer(cursor.baselineActiveMs) && cursor.baselineActiveMs <= timer.duration * 60_000 &&
    integer(cursor.accountedBlocks) && cursor.accountedBlocks <= Math.floor((timer.duration * 60_000 - cursor.baselineActiveMs) / FOCUS_ENERGY_STEP_MS)
}

export function feedCare(care: PetCare): PetCare {
  return care.fullness >= MAX_CARE_STAT ? care : { ...care, fullness: clampCareStat(care.fullness + FEED_FULLNESS) }
}

/** Every delta is committed with its originating activity/revision in one transaction. */
function observeLeisure(care: PetCare, day: string, milliseconds: number, eligible: boolean): PetCare {
  if (milliseconds === 0) return care
  if (!integer(milliseconds) || !isDay(day)) throw new RangeError('Invalid Leisure delta.')
  const previous = care.leisureDays[day] ?? { observedMs: 0, excessRemainderMs: 0 }
  const observedMs = previous.observedMs + milliseconds
  if (!Number.isSafeInteger(observedMs)) throw new RangeError('Leisure total is too large.')
  const allowanceMs = care.dailyLeisureAllowance * 60_000
  const excess = eligible ? Math.max(0, observedMs - allowanceMs) - Math.max(0, previous.observedMs - allowanceMs) : 0
  const accumulated = previous.excessRemainderMs + excess
  const loss = Math.floor(accumulated / LEISURE_STEP_MS) * FULLNESS_PER_LEISURE_STEP
  return { ...care, fullness: clampCareStat(care.fullness - loss), leisureDays: { ...care.leisureDays,
    [day]: { observedMs, excessRemainderMs: accumulated % LEISURE_STEP_MS } } }
}

/** Call only after a new valid Manual entry has passed the existing ID guard. */
export function careForManualLeisure(care: PetCare, activity: Activity): PetCare {
  if (activity.source !== 'Manual' || activity.category !== 'Leisure') return care
  const at = Date.parse(activity.timestamp)
  // A queued log may have been created before migration or an allowance edit.
  // Observe its allowance use, but never charge that older policy interval.
  return observeLeisure(care, dayKey(at), activity.duration * 60_000, at >= care.policyStartedAt)
}

/** Compare validated accepted ledgers, never an untrusted incoming batch.
 * A first aggregate spanning an unknown policy boundary is baseline-only;
 * subsequent cumulative deltas are precise and may use its original local day.
 */
export function careForSyncedLeisure(care: PetCare, previous: readonly SyncSummaryV2[], next: readonly SyncSummaryV2[]): PetCare {
  const accepted = new Map(previous.map((summary) => [summary.eventId, summary]))
  const deltas: { summary: SyncSummaryV2; milliseconds: number; eligible: boolean }[] = []
  for (const summary of next) {
    if (summary.category !== 'Leisure') continue
    const old = accepted.get(summary.eventId)
    const delta = summary.activeDurationMs - (old?.activeDurationMs ?? 0)
    if (delta <= 0) continue
    const eligible = old
      ? Date.parse(old.endedAtIso) >= care.policyStartedAt
      : Date.parse(summary.startedAtIso) >= care.policyStartedAt
    deltas.push({ summary, milliseconds: delta, eligible })
  }
  // Establish all historical allowance use before charging this batch's new
  // activity. Equivalent validated batches must not depend on arrival order.
  // A baseline arriving in a later transaction remains conservative: it never
  // revisits already committed fullness or charges previously accepted time.
  deltas.sort((a, b) => Number(a.eligible) - Number(b.eligible) ||
    a.summary.localDate.localeCompare(b.summary.localDate) || a.summary.eventId.localeCompare(b.summary.eventId))
  let result = care
  for (const { summary, milliseconds, eligible } of deltas) result = observeLeisure(result, summary.localDate, milliseconds, eligible)
  return result
}

/** Editing never charges the past. Already observed allowance use stays used. */
export function changeLeisureAllowance(care: PetCare, minutes: number, now: number): PetCare {
  if (!isValidLeisureAllowance(minutes) || !isCareTimestamp(now) || minutes === care.dailyLeisureAllowance) return care
  const policyStartedAt = Math.max(care.policyStartedAt, now)
  const leisureDays = Object.fromEntries(Object.entries(care.leisureDays).map(([day, ledger]) =>
    [day, { observedMs: ledger.observedMs, excessRemainderMs: 0 }]))
  return { ...care, dailyLeisureAllowance: minutes, policyStartedAt, leisureDays }
}

/** Explicit timestamps make reload, retry and clock rollback safe; no render writes. */
export function accountCareTime(care: PetCare, timer: TimerSession | null, now: number): PetCare {
  if (!isCareTimestamp(now)) return care
  let result = care
  if (timer && care.timerEnergy?.timerId === timer.id) {
    const cursor = care.timerEnergy
    const blocks = Math.max(cursor.accountedBlocks, Math.floor(Math.max(0, activeTimerMs(timer, now) - cursor.baselineActiveMs) / FOCUS_ENERGY_STEP_MS))
    if (blocks > cursor.accountedBlocks) result = { ...result,
      energy: clampCareStat(result.energy - (blocks - cursor.accountedBlocks) * ENERGY_PER_FOCUS_STEP),
      timerEnergy: { ...cursor, accountedBlocks: blocks } }
  }
  if (care.rest) {
    const rest = care.rest
    const blocks = Math.max(rest.accountedBlocks, Math.floor(Math.max(0, now - rest.startedAt) / REST_STEP_MS))
    if (blocks > rest.accountedBlocks) result = { ...result,
      energy: clampCareStat(result.energy + (blocks - rest.accountedBlocks) * ENERGY_PER_REST_STEP),
      rest: { ...rest, accountedBlocks: blocks } }
  }
  return result
}

export function beginCareRest(care: PetCare, id: string, now: number): PetCare {
  return care.rest || !isRestId(id) || !isCareTimestamp(now) ? care
    : { ...care, rest: { id, startedAt: now, accountedBlocks: 0 } }
}
