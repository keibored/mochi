import { DEFAULT_FOCUS_GOAL, FEED_COST, isActivity, isValidGoal, rewardsForEntry } from './rewards.ts'
import type { Activity } from './rewards.ts'
import { completionTime, isTimerDuration, pauseTimer, resumeTimer } from './timer.ts'
import type { TimerSession } from './timer.ts'
import { changeWebsiteRule } from './websiteRules.ts'
import type { WebsiteCategory, WebsiteRule } from './websiteRules.ts'
import { activateSync, freshWebSync, ingestSync, reserveSync } from './integration/syncDomain.ts'
import type { SyncPairing, WebSyncState } from './integration/syncDomain.ts'

export interface PetState {
  version: 5
  adopted: boolean
  name: string
  xp: number
  foodCredits: number
  activities: Activity[]
  dailyFocusGoal: number
  timer: TimerSession | null
  websiteRules: WebsiteRule[]
  extensionSync: WebSyncState
}

export function freshPet(): PetState {
  return { version: 5, adopted: false, name: 'Mochi', xp: 0, foodCredits: 0, activities: [], dailyFocusGoal: DEFAULT_FOCUS_GOAL, timer: null, websiteRules: [], extensionSync: freshWebSync() }
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
  | { type: 'timer-start'; id: string; duration: number; now: number }
  | { type: 'timer-pause' | 'timer-resume' | 'timer-save' | 'timer-cancel'; id: string; now: number }

export function petReducer(state: PetState, action: PetAction): PetState {
  if (action.type === 'adopt') return { ...state, adopted: true }
  if (!state.adopted) return state
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
    return { ...state, extensionSync: result.sync, xp: state.xp + result.xpDelta, foodCredits: state.foodCredits + result.creditsDelta }
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
    if (state.timer || !isTimerDuration(action.duration) || !action.id.startsWith('timer-') ||
        action.id.length <= 6 || !Number.isSafeInteger(action.now) || action.now < 0 ||
        !Number.isFinite(new Date(action.now + action.duration * 60_000).getTime()) ||
        state.activities.some((activity) => activity.id === action.id)) return state
    return { ...state, timer: { id: action.id, duration: action.duration,
      startedAt: action.now, elapsedMs: 0, runningSince: action.now } }
  }
  if (action.type === 'timer-pause' || action.type === 'timer-resume' ||
      action.type === 'timer-save' || action.type === 'timer-cancel') {
    const timer = state.timer
    if (!timer || timer.id !== action.id || !Number.isSafeInteger(action.now) || action.now < 0) return state
    if (action.type === 'timer-cancel') return { ...state, timer: null }
    if (action.type === 'timer-pause' || action.type === 'timer-resume') {
      const next = action.type === 'timer-pause' ? pauseTimer(timer, action.now) : resumeTimer(timer, action.now)
      return next === timer ? state : { ...state, timer: next }
    }
    const completedAt = completionTime(timer, action.now)
    if (completedAt === null) return state
    const logged = petReducer(state, { type: 'log', activity: {
      id: timer.id, source: 'Timer', category: 'Focus', duration: timer.duration,
      note: '', timestamp: new Date(completedAt).toISOString(),
    } })
    return { ...logged, timer: null }
  }
  if (action.type === 'goal') {
    return isValidGoal(action.minutes) ? { ...state, dailyFocusGoal: action.minutes } : state
  }
  if (action.type === 'feed') {
    return state.foodCredits < FEED_COST ? state : { ...state, foodCredits: state.foodCredits - FEED_COST }
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
    xp: state.xp + reward.xp,
    foodCredits: state.foodCredits + reward.credits,
    activities: [...state.activities, activity],
  }
}
