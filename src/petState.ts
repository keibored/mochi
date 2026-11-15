import { DEFAULT_FOCUS_GOAL, FEED_COST, isActivity, isValidGoal, rewardsForEntry } from './rewards.ts'
import type { Activity } from './rewards.ts'
import { completionTime, isTimerDuration, pauseTimer, resumeTimer } from './timer.ts'
import type { TimerSession } from './timer.ts'
import { changeWebsiteRule } from './websiteRules.ts'
import type { WebsiteCategory, WebsiteRule } from './websiteRules.ts'
import { activateSync, freshWebSync, ingestSync, reserveSync } from './integration/syncDomain.ts'
import type { SyncPairing, WebSyncState } from './integration/syncDomain.ts'
import { accountCareTime, beginCareRest, careForManualLeisure, careForSyncedFocus, careForSyncedLeisure, changeLeisureAllowance, feedCare, freshCare, isCareTimestamp, resetFocusEnergyPolicy } from './petCare.ts'
import type { PetCare } from './petCare.ts'

export interface PetState {
  version: 7
  adopted: boolean
  name: string
  xp: number
  foodCredits: number
  activities: Activity[]
  dailyFocusGoal: number
  timer: TimerSession | null
  websiteRules: WebsiteRule[]
  extensionSync: WebSyncState
  care: PetCare
}

export function freshPet(now = 0): PetState {
  return { version: 7, adopted: false, name: 'Mochi', xp: 0, foodCredits: 0, activities: [], dailyFocusGoal: DEFAULT_FOCUS_GOAL, timer: null, websiteRules: [], extensionSync: freshWebSync(), care: freshCare(now) }
}

export type PetAction =
  | { type: 'adopt' }
  | { type: 'log'; activity: Activity }
  | { type: 'feed' }
  | { type: 'goal'; minutes: number }
  | { type: 'rule-save'; hostname: string; category: WebsiteCategory; originalHostname?: string }
  | { type: 'rule-remove'; hostname: string }
  | { type: 'sync-reserve'; pairing: Omit<SyncPairing, 'cutoffAt'> }
  | { type: 'sync-activate'; epochId: string; extensionId: string; cutoffAt: number }
  | { type: 'sync-ingest'; epochId: string; snapshots: unknown; now: number }
  | { type: 'care-rest-start'; id: string; now: number; pauseTimerId?: string }
  | { type: 'care-wake'; restId: string; now: number }
  | { type: 'care-tick'; now: number }
  | { type: 'care-allowance'; minutes: number; now: number }
  | { type: 'timer-start'; id: string; duration: number; now: number }
  | { type: 'timer-pause' | 'timer-resume' | 'timer-save' | 'timer-cancel'; id: string; now: number }

export function petReducer(state: PetState, action: PetAction): PetState {
  if (action.type === 'adopt') return { ...state, adopted: true }
  if (!state.adopted) return state
  if (action.type === 'care-tick') {
    const care = accountCareTime(state.care, state.timer, action.now, state.extensionSync.authorityStartedAt === null)
    return care === state.care ? state : { ...state, care }
  }
  if (action.type === 'care-allowance') {
    const care = changeLeisureAllowance(state.care, action.minutes, action.now)
    return care === state.care ? state : { ...state, care }
  }
  if (action.type === 'care-rest-start') {
    const started = beginCareRest(state.care, action.id, action.now)
    if (started === state.care) return state
    const unfinished = state.timer?.runningSince !== null && state.timer !== null && completionTime(state.timer, action.now) === null
    if (unfinished && action.pauseTimerId !== state.timer?.id) return state
    const care = accountCareTime(state.care, state.timer, action.now, state.extensionSync.authorityStartedAt === null)
    return { ...state, timer: unfinished ? pauseTimer(state.timer!, action.now) : state.timer,
      care: beginCareRest(care, action.id, action.now) }
  }
  if (action.type === 'care-wake') {
    if (!state.care.rest || state.care.rest.id !== action.restId || !isCareTimestamp(action.now)) return state
    const care = accountCareTime(state.care, state.timer, action.now, state.extensionSync.authorityStartedAt === null)
    return { ...state, care: { ...resetFocusEnergyPolicy(care, action.now), rest: null } }
  }
  if (action.type === 'sync-reserve') {
    if (state.extensionSync.authorityStartedAt === null && state.timer) return state
    return { ...state, extensionSync: reserveSync(state.extensionSync, state.activities, action.pairing) }
  }
  if (action.type === 'sync-activate') {
    const extensionSync = activateSync(state.extensionSync, action)
    return extensionSync === state.extensionSync ? state : { ...state, extensionSync }
  }
  if (action.type === 'sync-ingest') {
    if (state.extensionSync.pairing?.epochId !== action.epochId) throw new RangeError('The synchronization epoch changed in another tab.')
    const result = ingestSync(state.extensionSync, action.snapshots, action.now)
    const leisureCare = careForSyncedLeisure(state.care, state.extensionSync.summaries, result.sync.summaries)
    const care = careForSyncedFocus(leisureCare, state.extensionSync.summaries, result.sync.summaries)
    return { ...state, extensionSync: result.sync, care, xp: state.xp + result.xpDelta, foodCredits: state.foodCredits + result.creditsDelta }
  }
  if (action.type === 'rule-save') {
    const result = changeWebsiteRule(state.websiteRules, action.hostname, action.category, action.originalHostname)
    return result.error ? state : { ...state, websiteRules: [...result.rules] }
  }
  if (action.type === 'rule-remove') {
    const websiteRules = state.websiteRules.filter((rule) => rule.hostname !== action.hostname)
    return websiteRules.length === state.websiteRules.length ? state : { ...state, websiteRules }
  }
  if (action.type === 'timer-start') {
    if (state.timer || state.care.rest || !isTimerDuration(action.duration) || !action.id.startsWith('timer-') ||
        action.id.length <= 6 || !Number.isSafeInteger(action.now) || action.now < 0 ||
        !Number.isFinite(new Date(action.now + action.duration * 60_000).getTime()) ||
        state.activities.some((activity) => activity.id === action.id)) return state
    return { ...state, timer: { id: action.id, duration: action.duration,
      startedAt: action.now, elapsedMs: 0, runningSince: action.now },
    care: { ...state.care, timerEnergy: { timerId: action.id, baselineActiveMs: 0, accountedBlocks: 0 } } }
  }
  if (action.type === 'timer-pause' || action.type === 'timer-resume' ||
      action.type === 'timer-save' || action.type === 'timer-cancel') {
    const timer = state.timer
    if (!timer || timer.id !== action.id || !Number.isSafeInteger(action.now) || action.now < 0) return state
    if (!isCareTimestamp(action.now) || (action.type === 'timer-resume' && state.care.rest)) return state
    // A stale/premature Save must not look like a successful saved activity.
    if (action.type === 'timer-save' && completionTime(timer, action.now) === null) return state
    const care = accountCareTime(state.care, timer, action.now, state.extensionSync.authorityStartedAt === null)
    const accounted = care === state.care ? state : { ...state, care }
    if (action.type === 'timer-cancel') return { ...accounted, timer: null, care: { ...care, timerEnergy: null } }
    if (action.type === 'timer-pause' || action.type === 'timer-resume') {
      const next = action.type === 'timer-pause' ? pauseTimer(timer, action.now) : resumeTimer(timer, action.now)
      return next === timer ? accounted : { ...accounted, timer: next }
    }
    const completedAt = completionTime(timer, action.now)
    if (completedAt === null) return state
    const logged = petReducer(accounted, { type: 'log', activity: {
      id: timer.id, source: 'Timer', category: 'Focus', duration: timer.duration,
      note: '', timestamp: new Date(completedAt).toISOString(),
    } })
    return { ...logged, timer: null, care: { ...logged.care, timerEnergy: null } }
  }
  if (action.type === 'goal') {
    return isValidGoal(action.minutes) ? { ...state, dailyFocusGoal: action.minutes } : state
  }
  if (action.type === 'feed') {
    if (state.foodCredits < FEED_COST) return state
    const care = feedCare(state.care)
    return care === state.care ? state : { ...state, foodCredits: state.foodCredits - FEED_COST, care }
  }
  if (action.type !== 'log') return state
  const { activity } = action
  if (!isActivity(activity) ||
      state.activities.some((entry) => entry.id === activity.id)) return state
  const reward = state.extensionSync.authorityStartedAt === null
    ? rewardsForEntry(state.activities, activity.duration, new Date(activity.timestamp), activity.category)
    : { xp: 0, credits: 0 }
  return {
    ...state,
    care: state.extensionSync.authorityStartedAt === null ? careForManualLeisure(state.care, activity) : state.care,
    xp: state.xp + reward.xp,
    foodCredits: state.foodCredits + reward.credits,
    activities: [...state.activities, activity],
  }
}
