import type { ChromeApi } from './chromeApi.ts'
import { changeWebsiteRule, classificationForHostname, isWebsiteCategory } from '../../src/websiteRules.ts'
import type { ClassificationOrigin, WebsiteCategory, WebsiteRule } from '../../src/websiteRules.ts'
import { addTime, classify, CLOCK_TOLERANCE_MS, freshState, hostnameFromTab, IDLE_SECONDS, isTrackingState,
  MAX_GAP_MS, MAX_RULES, migrateTrackingState, prune, statusFor, STORAGE_KEY, todayTotals } from './model.ts'
import type { Observation, TrackingState, TrackingStatus } from './model.ts'
import { APP_ORIGIN, SYNC_PROTOCOL, SYNC_PROTOCOL_VERSION } from '../../src/integration/localConfig.ts'
import type { SyncReply, SyncRequest } from '../../src/integration/syncProtocol.ts'
import { parseSyncSummary } from '../../src/integration/syncDomain.ts'
import { isAllowedWebSender, opaqueId, PAIRING_TTL_MS } from './syncState.ts'
import type { ExternalSender } from './syncState.ts'

export interface Clock { now(): number; monotonic(): number; id(): string; timeZone(): string }
export interface Report { state: TrackingState; status: TrackingStatus; hostname: string | null; category: WebsiteCategory; classificationOrigin: ClassificationOrigin; totalsMs: ReturnType<typeof todayTotals>; checkedAt: number }
export type Response = { ok: true; report: Report; syncReply?: SyncReply } | { ok: false; error: string }
type Command = { kind: 'report' | 'enable' | 'pause' | 'resume' | 'disable' }
  | { kind: 'rule-save'; hostname: string; category: 'Focus' | 'Leisure' | 'Neutral'; originalHostname?: string }
  | { kind: 'rule-remove'; hostname: string }
  | { kind: 'sync-pair-request'; requestId: string; challenge: string; resumeEpochId?: string }
  | { kind: 'sync-claim'; requestId: string; challenge: string }
  | { kind: 'sync-approve' | 'sync-reject'; requestId: string }
  | { kind: 'sync-activate'; token: string; epochId: string; reservedAt: number }
  | { kind: 'sync-read'; token: string; epochId: string }
export interface Hint { idle?: 'active' | 'idle' | 'locked'; unfocused?: boolean; recovery?: boolean }

function commandFrom(value: unknown): Command {
  if (typeof value !== 'object' || value === null) throw new Error('Unsupported request.')
  const command = value as Record<string, unknown>
  if (typeof command.kind === 'string' && ['report', 'enable', 'pause', 'resume', 'disable'].includes(command.kind)) return command as Command
  if (command.kind === 'rule-remove' && typeof command.hostname === 'string') return command as Command
  if (command.kind === 'rule-save' && typeof command.hostname === 'string' && command.hostname.length <= 4096 &&
      isWebsiteCategory(command.category) && (command.originalHostname === undefined || typeof command.originalHostname === 'string')) return command as Command
  if ((command.kind === 'sync-pair-request' || command.kind === 'sync-claim') && opaqueId(command.requestId) &&
      opaqueId(command.challenge) && command.challenge.length >= 16 &&
      (command.resumeEpochId === undefined || opaqueId(command.resumeEpochId))) return command as Command
  if ((command.kind === 'sync-approve' || command.kind === 'sync-reject') && opaqueId(command.requestId)) return command as Command
  if ((command.kind === 'sync-read' || command.kind === 'sync-activate') && opaqueId(command.token) && command.token.length >= 36 &&
      opaqueId(command.epochId) && (command.kind !== 'sync-activate' || (Number.isSafeInteger(command.reservedAt) && (command.reservedAt as number) >= 0))) return command as Command
  throw new Error('Unsupported request.')
}

export class TrackerController {
  private queue: Promise<unknown> = Promise.resolve()
  private last: { wall: number; mono: number; observation: Observation; checkpoint: number; tracking: boolean } | null = null
  private api: ChromeApi
  private clock: Clock

  constructor(api: ChromeApi, clock: Clock) { this.api = api; this.clock = clock }

  /** Chrome validates the route; we independently enforce the exact origin,
   * port, frame, protocol, and capability. External pages cannot approve pairs,
   * change tracking preferences, or obtain hostnames/category rules.
   */
  async external(request: unknown, sender: ExternalSender) {
    const wrap = (result: { ok: true; payload: SyncReply } | { ok: false; error: string }) =>
      ({ protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ...result })
    if (!isAllowedWebSender(sender)) return wrap({ ok: false, error: 'This app origin is not allowed.' })
    if (typeof request !== 'object' || request === null) return wrap({ ok: false, error: 'Invalid synchronization request.' })
    const envelope = request as Record<string, unknown>
    if (envelope.protocol !== SYNC_PROTOCOL || envelope.version !== SYNC_PROTOCOL_VERSION) return wrap({ ok: false, error: 'Synchronization protocol mismatch.' })
    const message = envelope as unknown as SyncRequest
    const fields: Record<string, string[]> = {
      'pair-request': ['requestId', 'challenge', 'resumeEpochId'], 'pair-claim': ['requestId', 'challenge'],
      activate: ['token', 'epochId', 'reservedAt'], sync: ['token', 'epochId'],
    }
    const allowedFields = typeof envelope.kind === 'string' && Object.hasOwn(fields, envelope.kind) ? fields[envelope.kind] : null
    if (!allowedFields || Object.keys(envelope).some((key) => !['protocol', 'version', 'kind', ...allowedFields].includes(key))) {
      return wrap({ ok: false, error: 'Unsupported synchronization message fields.' })
    }
    let command: unknown
    if (message.kind === 'pair-request') command = { ...message, kind: 'sync-pair-request' }
    else if (message.kind === 'pair-claim') command = { ...message, kind: 'sync-claim' }
    else if (message.kind === 'activate') command = { ...message, kind: 'sync-activate' }
    else if (message.kind === 'sync') command = { ...message, kind: 'sync-read' }
    else return wrap({ ok: false, error: 'Unsupported synchronization request.' })
    const response = await this.run(command)
    return response.ok && response.syncReply ? wrap({ ok: true, payload: response.syncReply })
      : wrap({ ok: false, error: response.ok ? 'Missing synchronization response.' : response.error })
  }

  private async observe(collect: boolean, rules: TrackingState['rules'], hint: Hint): Promise<Observation> {
    const observation: Observation = { focused: false, idle: 'active', hostname: null, category: 'Neutral', timeZone: this.clock.timeZone() }
    if (!collect) return observation // Do not inspect tab URLs until explicitly enabled.
    observation.idle = hint.idle ?? await this.api.idle.queryState(IDLE_SECONDS)
    if (hint.unfocused) return observation
    const windows = await this.api.windows.getAll({ windowTypes: ['normal'] })
    const focused = windows.find((window) => window.focused && !window.incognito)
    if (focused?.id === undefined) return observation
    observation.focused = true
    const [tab] = await this.api.tabs.query({ active: true, windowId: focused.id })
    if (tab && !tab.incognito && tab.status !== 'loading') observation.hostname = hostnameFromTab(tab.url, tab.incognito)
    observation.category = classify(rules, observation.hostname)
    return observation
  }

  /** Only the worker owns writes. All Chrome events and UI commands join this
   * queue, and a summary plus its checkpoint commit in one storage.set call.
   */
  run(request: unknown = { kind: 'report' }, hint: Hint = {}): Promise<Response> {
    const task = this.queue.then(async (): Promise<Response> => {
      try {
        const command = commandFrom(request)
        const raw = (await this.api.storage.local.get(STORAGE_KEY))[STORAGE_KEY]
        const migrated = raw === undefined ? freshState() : migrateTrackingState(raw)
        if (!migrated) throw new Error('Saved extension data is unreadable and has been preserved.')
        let state = migrated
        const requestedAt = this.clock.now()
        if (command.kind === 'sync-claim') {
          const approved = state.pairing?.requestId === command.requestId && state.pairing.challenge === command.challenge
          const pending = state.pendingPairing?.requestId === command.requestId && state.pendingPairing.challenge === command.challenge && state.pendingPairing.expiresAt > requestedAt
          if (!approved && !pending) return { ok: false, error: 'Connection request expired or was replaced. Request approval again.' }
        }
        if (command.kind === 'sync-approve' || command.kind === 'sync-reject') {
          if (!state.pendingPairing || state.pendingPairing.requestId !== command.requestId || state.pendingPairing.expiresAt <= requestedAt) return { ok: false, error: 'This connection request has expired.' }
        }
        if (command.kind === 'sync-read' || command.kind === 'sync-activate') {
          const pair = state.pairing
          if (!pair || pair.origin !== APP_ORIGIN || pair.token !== command.token || pair.epochId !== command.epochId) return { ok: false, error: 'Connection approval is missing or has changed. Reconnect in Brave.' }
          if (command.kind === 'sync-read' && pair.cutoffAt === null) return { ok: false, error: 'Reserve dashboard reward authority before activating sync.' }
          if (command.kind === 'sync-activate' && pair.cutoffAt === null && (command.reservedAt > requestedAt || command.reservedAt < pair.approvedAt - 2000)) return { ok: false, error: 'Invalid synchronization cutoff. Refresh the dashboard and reconnect.' }
        }
        let nextRules: WebsiteRule[] | undefined
        if (command.kind === 'rule-save') {
          const result = changeWebsiteRule(state.rules, command.hostname, command.category, command.originalHostname)
          // Invalid settings input must not interrupt a healthy active interval.
          if (result.error) return { ok: false, error: result.error }
          if (result.rules.length > MAX_RULES) return { ok: false, error: `Keep at most ${MAX_RULES} website rules.` }
          nextRules = [...result.rules]
        }
        const observed = await this.observe(state.enabled && !state.paused, state.rules, hint)
        const now = this.clock.now(), mono = this.clock.monotonic()
        const last = hint.recovery ? null : this.last
        const gap = now - state.checkpointAt
        if (last && last.checkpoint === state.checkpointAt && last.tracking &&
            gap > 0 && gap <= MAX_GAP_MS && mono >= last.mono &&
            Math.abs((now - last.wall) - (mono - last.mono)) <= CLOCK_TOLERANCE_MS &&
            last.observation.timeZone === observed.timeZone) {
          state = addTime(state, state.checkpointAt, now, last.observation.category, observed.timeZone, () => this.clock.id())
        }
        // Fresh workers, long gaps, clock discontinuities and timezone changes
        // deliberately drop the unconfirmed tail instead of guessing activity.
        if (command.kind === 'enable') state = { ...state, enabled: true, paused: false }
        if (command.kind === 'disable') state = { ...state, enabled: false, paused: false }
        if (command.kind === 'pause') state = { ...state, paused: true }
        if (command.kind === 'resume') {
          if (!state.enabled) throw new Error('Enable tracking first.')
          state = { ...state, paused: false }
        }
        if (nextRules) state = { ...state, rules: nextRules }
        if (command.kind === 'rule-remove') state = { ...state, rules: state.rules.filter((rule) => rule.hostname !== command.hostname) }
        if (command.kind === 'sync-pair-request') {
          state = { ...state, pendingPairing: { requestId: command.requestId, challenge: command.challenge,
            origin: APP_ORIGIN, requestedAt: now, expiresAt: now + PAIRING_TTL_MS, resumeEpochId: command.resumeEpochId ?? null } }
        }
        if (command.kind === 'sync-approve') {
          const pending = state.pendingPairing!
          const previous = state.pairing && pending.resumeEpochId === state.pairing.epochId ? state.pairing : null
          state = { ...state, pendingPairing: null, pairing: {
            requestId: pending.requestId, challenge: pending.challenge, origin: APP_ORIGIN,
            epochId: previous?.epochId ?? this.clock.id(), token: this.clock.id() + this.clock.id(),
            approvedAt: now, cutoffAt: previous?.cutoffAt ?? null,
          } }
        }
        if (command.kind === 'sync-reject') state = { ...state, pendingPairing: null }
        if (command.kind === 'sync-activate' && state.pairing!.cutoffAt === null) {
          state = { ...state, pairing: { ...state.pairing!, cutoffAt: now }, summaries: state.summaries.map((entry) =>
            entry.finalized ? entry : { ...entry, finalized: true, revision: entry.revision + 1 }) }
        }
        const changed = command.kind !== 'report' && command.kind !== 'sync-read' && command.kind !== 'sync-claim'
        const nextObservation = changed ? await this.observe(state.enabled && !state.paused, state.rules, hint) : observed
        const at = this.clock.now()
        state = prune({ ...state, checkpointAt: Math.max(state.checkpointAt, at) }, at, nextObservation.timeZone)
        if (!isTrackingState(state)) throw new Error('Extension state validation failed; existing data has been preserved.')
        await this.api.storage.local.set({ [STORAGE_KEY]: state })
        this.last = { wall: at, mono: this.clock.monotonic(), observation: nextObservation,
          checkpoint: state.checkpointAt, tracking: statusFor(state, nextObservation) === 'Tracking' }
        let syncReply: SyncReply | undefined
        if (command.kind === 'sync-pair-request') syncReply = { kind: 'pending', requestId: command.requestId }
        if (command.kind === 'sync-claim') {
          const pair = state.pairing
          syncReply = pair && pair.requestId === command.requestId && pair.challenge === command.challenge
            ? { kind: 'approved', extensionId: this.api.runtime.id, epochId: pair.epochId, token: pair.token, origin: APP_ORIGIN, cutoffAt: pair.cutoffAt }
            : { kind: 'pending', requestId: command.requestId }
        }
        if (command.kind === 'sync-read' || command.kind === 'sync-activate') {
          const pair = state.pairing!
          syncReply = { kind: 'snapshot', epochId: pair.epochId, cutoffAt: pair.cutoffAt!, liveStatus: statusFor(state, nextObservation), checkedAt: at,
            summaries: state.summaries.filter((entry) => entry.epochId === pair.epochId).map((entry) => parseSyncSummary({
              schemaVersion: 2, source: 'extension', epochId: pair.epochId, eventId: entry.eventId, revision: entry.revision,
              category: entry.category, startedAtIso: entry.startedAtIso, endedAtIso: entry.endedAtIso, activeDurationMs: entry.activeDurationMs,
              timeZone: entry.timeZone, localDate: entry.localDate, finalized: entry.finalized,
            })) }
        }
        return { ok: true, syncReply, report: { state, status: statusFor(state, nextObservation), hostname: nextObservation.hostname,
          category: nextObservation.category, classificationOrigin: classificationForHostname(state.rules, nextObservation.hostname ?? '').origin,
          totalsMs: todayTotals(state, at), checkedAt: at } }
      } catch (error) {
        this.last = null // Never replay an uncommitted tail after a failed write.
        return { ok: false, error: error instanceof Error ? error.message : 'Chrome storage or activity APIs are unavailable.' }
      }
    })
    this.queue = task
    return task
  }
}
