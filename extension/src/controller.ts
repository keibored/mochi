import type { ChromeApi } from './chromeApi.ts'
import { changeWebsiteRule, isWebsiteCategory } from '../../src/websiteRules.ts'
import type { WebsiteRule } from '../../src/websiteRules.ts'
import { addTime, classify, CLOCK_TOLERANCE_MS, freshState, hostnameFromTab, IDLE_SECONDS, isTrackingState,
  MAX_GAP_MS, MAX_RULES, prune, statusFor, STORAGE_KEY, todayTotals } from './model.ts'
import type { Observation, TrackingState, TrackingStatus } from './model.ts'

export interface Clock { now(): number; monotonic(): number; id(): string; timeZone(): string }
export interface Report { state: TrackingState; status: TrackingStatus; hostname: string | null; category: string; totalsMs: ReturnType<typeof todayTotals>; checkedAt: number }
export type Response = { ok: true; report: Report } | { ok: false; error: string }
type Command = { kind: 'report' | 'enable' | 'pause' | 'resume' | 'disable' }
  | { kind: 'rule-save'; hostname: string; category: 'Focus' | 'Leisure' | 'Neutral'; originalHostname?: string }
  | { kind: 'rule-remove'; hostname: string }
export interface Hint { idle?: 'active' | 'idle' | 'locked'; unfocused?: boolean; recovery?: boolean }

function commandFrom(value: unknown): Command {
  if (typeof value !== 'object' || value === null) throw new Error('Unsupported request.')
  const command = value as Record<string, unknown>
  if (typeof command.kind === 'string' && ['report', 'enable', 'pause', 'resume', 'disable'].includes(command.kind)) return command as Command
  if (command.kind === 'rule-remove' && typeof command.hostname === 'string') return command as Command
  if (command.kind === 'rule-save' && typeof command.hostname === 'string' && command.hostname.length <= 4096 &&
      isWebsiteCategory(command.category) && (command.originalHostname === undefined || typeof command.originalHostname === 'string')) return command as Command
  throw new Error('Unsupported request.')
}

export class TrackerController {
  private queue: Promise<unknown> = Promise.resolve()
  private last: { wall: number; mono: number; observation: Observation; checkpoint: number; tracking: boolean } | null = null
  private api: ChromeApi
  private clock: Clock

  constructor(api: ChromeApi, clock: Clock) { this.api = api; this.clock = clock }

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
        if (raw !== undefined && !isTrackingState(raw)) throw new Error('Saved extension data is unreadable and has been preserved.')
        let state = raw === undefined ? freshState() : raw as TrackingState
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
        const changed = command.kind !== 'report'
        const nextObservation = changed ? await this.observe(state.enabled && !state.paused, state.rules, hint) : observed
        const at = this.clock.now()
        state = prune({ ...state, checkpointAt: Math.max(state.checkpointAt, at) }, at, nextObservation.timeZone)
        if (!isTrackingState(state)) throw new Error('Extension state validation failed; existing data has been preserved.')
        await this.api.storage.local.set({ [STORAGE_KEY]: state })
        this.last = { wall: at, mono: this.clock.monotonic(), observation: nextObservation,
          checkpoint: state.checkpointAt, tracking: statusFor(state, nextObservation) === 'Tracking' }
        return { ok: true, report: { state, status: statusFor(state, nextObservation), hostname: nextObservation.hostname,
          category: nextObservation.category, totalsMs: todayTotals(state, at), checkedAt: at } }
      } catch (error) {
        this.last = null // Never replay an uncommitted tail after a failed write.
        return { ok: false, error: error instanceof Error ? error.message : 'Chrome storage or activity APIs are unavailable.' }
      }
    })
    this.queue = task
    return task
  }
}
