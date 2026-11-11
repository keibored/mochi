export const MIN_DURATION = 1
export const MAX_DURATION = 240
export const DAILY_REWARD_CAP = 240
export const MINUTES_PER_REWARD = 15
export const XP_PER_REWARD = 5
export const CREDITS_PER_REWARD = 2
export const FEED_COST = 2
export const FIRST_MILESTONE_XP = 100
export const DEFAULT_FOCUS_GOAL = 60
export const MIN_FOCUS_GOAL = 15
export const MAX_FOCUS_GOAL = 480
export const MAX_NOTE_LENGTH = 200
export const ACTIVITY_CATEGORIES = ['Focus', 'Leisure', 'Rest', 'Neutral'] as const
export type ActivityCategory = typeof ACTIVITY_CATEGORIES[number]

export interface Activity {
  id: string
  category: ActivityCategory
  duration: number
  note: string
  timestamp: string
}

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return ACTIVITY_CATEGORIES.some((category) => category === value)
}

export function isValidGoal(goal: number): boolean {
  return Number.isInteger(goal) && goal >= MIN_FOCUS_GOAL && goal <= MAX_FOCUS_GOAL
}

export function isActivity(value: unknown): value is Activity {
  if (typeof value !== 'object' || value === null) return false
  const activity = value as Partial<Activity>
  if (typeof activity.id !== 'string' || !activity.id.trim() ||
      !isActivityCategory(activity.category) || typeof activity.duration !== 'number' ||
      !isValidDuration(activity.duration) || typeof activity.note !== 'string' ||
      activity.note.length > MAX_NOTE_LENGTH || typeof activity.timestamp !== 'string') return false
  const date = new Date(activity.timestamp)
  return Number.isFinite(date.getTime()) && date.toISOString() === activity.timestamp
}

export function isValidDuration(duration: number): boolean {
  return Number.isInteger(duration) && duration >= MIN_DURATION && duration <= MAX_DURATION
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function dailySummary(activities: readonly Activity[], date: Date): Record<ActivityCategory, number> {
  const day = localDateKey(date)
  const totals = { Focus: 0, Leisure: 0, Rest: 0, Neutral: 0 }
  for (const activity of activities) {
    if (localDateKey(new Date(activity.timestamp)) === day) totals[activity.category] += activity.duration
  }
  return totals
}

export function dailyMinutes(activities: readonly Activity[], date: Date): number {
  return dailySummary(activities, date).Focus
}

export function rewardsForEntry(activities: readonly Activity[], duration: number, date: Date, category: ActivityCategory = 'Focus') {
  if (!isValidDuration(duration) || !Number.isFinite(date.getTime()) || !isActivityCategory(category)) {
    throw new RangeError('Enter a whole number of minutes from 1 to 240.')
  }
  if (category !== 'Focus') return { xp: 0, credits: 0 }
  const before = dailyMinutes(activities, date)
  const blocks = (minutes: number) => Math.floor(Math.min(minutes, DAILY_REWARD_CAP) / MINUTES_PER_REWARD)
  const earned = blocks(before + duration) - blocks(before)
  return { xp: earned * XP_PER_REWARD, credits: earned * CREDITS_PER_REWARD }
}
