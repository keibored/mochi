import { DEFAULT_FOCUS_GOAL, FEED_COST, isActivity, isValidGoal, rewardsForEntry } from './rewards.ts'
import type { Activity } from './rewards.ts'

export interface PetState {
  version: 2
  adopted: boolean
  name: string
  xp: number
  foodCredits: number
  activities: Activity[]
  dailyFocusGoal: number
}

export function freshPet(): PetState {
  return { version: 2, adopted: false, name: 'Mochi', xp: 0, foodCredits: 0, activities: [], dailyFocusGoal: DEFAULT_FOCUS_GOAL }
}

export type PetAction =
  | { type: 'adopt' }
  | { type: 'log'; activity: Activity }
  | { type: 'feed' }
  | { type: 'goal'; minutes: number }

export function petReducer(state: PetState, action: PetAction): PetState {
  if (action.type === 'adopt') return { ...state, adopted: true }
  if (!state.adopted) return state
  if (action.type === 'goal') {
    return isValidGoal(action.minutes) ? { ...state, dailyFocusGoal: action.minutes } : state
  }
  if (action.type === 'feed') {
    return state.foodCredits < FEED_COST ? state : { ...state, foodCredits: state.foodCredits - FEED_COST }
  }
  const { activity } = action
  if (!isActivity(activity) ||
      state.activities.some((entry) => entry.id === activity.id)) return state
  const reward = rewardsForEntry(state.activities, activity.duration, new Date(activity.timestamp), activity.category)
  return {
    ...state,
    xp: state.xp + reward.xp,
    foodCredits: state.foodCredits + reward.credits,
    activities: [...state.activities, activity],
  }
}
