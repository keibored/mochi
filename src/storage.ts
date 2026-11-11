import { freshPet } from './petState.ts'
import type { PetState } from './petState.ts'
import { DEFAULT_FOCUS_GOAL, isActivity, isValidGoal } from './rewards.ts'

export const STORAGE_KEY = 'mochi.progress'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPetState(value: unknown): value is PetState {
  if (!isRecord(value) || value.version !== 2 || typeof value.adopted !== 'boolean' ||
      value.name !== 'Mochi' || typeof value.xp !== 'number' || !Number.isSafeInteger(value.xp) || value.xp < 0 ||
      typeof value.foodCredits !== 'number' || !Number.isSafeInteger(value.foodCredits) || value.foodCredits < 0 ||
      typeof value.dailyFocusGoal !== 'number' || !isValidGoal(value.dailyFocusGoal) ||
      !Array.isArray(value.activities)) return false
  const ids = new Set<string>()
  return value.activities.every((activity: unknown) => {
    if (!isActivity(activity) || ids.has(activity.id)) return false
    ids.add(activity.id)
    return true
  })
}

// Migrate structure only. Existing balances are authoritative; never replay rewards.
export function migratePet(value: unknown): PetState | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2)) return null
  let activities = value.activities
  if (value.version === 1) {
    if (!Array.isArray(activities)) return null
    activities = activities.map((entry: unknown) => isRecord(entry)
      ? { ...entry, category: 'Focus', note: '' } : entry)
  }
  const candidate = {
    ...value,
    version: 2,
    dailyFocusGoal: value.dailyFocusGoal === undefined ? DEFAULT_FOCUS_GOAL : value.dailyFocusGoal,
    activities,
  }
  return isPetState(candidate) ? candidate : null
}

export function loadPet(): { pet: PetState; notice: string } {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return { pet: freshPet(), notice: '' }
    const migrated = migratePet(JSON.parse(raw))
    if (migrated) return { pet: migrated, notice: '' }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      return { pet: freshPet(), notice: 'Progress cannot be saved on this device right now.' }
    }
  }
  return { pet: freshPet(), notice: 'Saved progress could not be read and has been preserved. Progress in this session cannot be saved.' }
}

export function savePet(pet: PetState): boolean {
  try {
    if (!isPetState(pet)) return false
    const previous = window.localStorage.getItem(STORAGE_KEY)
    // Preserve malformed or unsupported records rather than overwriting user data.
    if (previous !== null && !migratePet(JSON.parse(previous))) return false
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pet))
    return true
  } catch {
    return false
  }
}
