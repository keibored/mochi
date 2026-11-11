import { freshPet, petReducer } from './petState.ts'
import type { PetAction, PetState } from './petState.ts'
import { DEFAULT_FOCUS_GOAL, isActivity, isValidGoal } from './rewards.ts'
import { isTimerSession } from './timer.ts'

export const STORAGE_KEY = 'mochi.progress'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPetState(value: unknown): value is PetState {
  if (!isRecord(value) || value.version !== 3 || typeof value.adopted !== 'boolean' ||
      value.name !== 'Mochi' || typeof value.xp !== 'number' || !Number.isSafeInteger(value.xp) || value.xp < 0 ||
      typeof value.foodCredits !== 'number' || !Number.isSafeInteger(value.foodCredits) || value.foodCredits < 0 ||
      typeof value.dailyFocusGoal !== 'number' || !isValidGoal(value.dailyFocusGoal) ||
      !Array.isArray(value.activities) || (value.timer !== null && !isTimerSession(value.timer))) return false
  const ids = new Set<string>()
  const validActivities = value.activities.every((activity: unknown) => {
    if (!isActivity(activity) || ids.has(activity.id)) return false
    ids.add(activity.id)
    return true
  })
  return validActivities && (value.timer === null || (value.adopted && !ids.has(value.timer.id)))
}

// Structural migration only: saved balances remain authoritative.
export function migratePet(value: unknown): PetState | null {
  if (!isRecord(value) || (value.version !== 1 && value.version !== 2 && value.version !== 3)) return null
  let activities = value.activities
  if (value.version === 1) {
    if (!Array.isArray(activities)) return null
    activities = activities.map((entry: unknown) => isRecord(entry)
      ? { ...entry, category: 'Focus', note: '' } : entry)
  }
  if (value.version !== 3) {
    if (!Array.isArray(activities)) return null
    activities = activities.map((entry: unknown) => isRecord(entry) ? { ...entry, source: 'Manual' } : entry)
  }
  const candidate = {
    ...value,
    version: 3,
    timer: value.version === 3 ? value.timer : null,
    dailyFocusGoal: value.dailyFocusGoal === undefined ? DEFAULT_FOCUS_GOAL : value.dailyFocusGoal,
    activities,
  }
  return isPetState(candidate) ? candidate : null
}

export function readPet(): PetState {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return freshPet()
  const pet = migratePet(JSON.parse(raw))
  if (!pet) throw new Error('Saved progress could not be read; it has been preserved.')
  return pet
}

export function loadPet(): { pet: PetState; notice: string } {
  try {
    return { pet: readPet(), notice: '' }
  } catch {
    return { pet: freshPet(), notice: 'Saved progress could not be read or is unavailable. Existing data is preserved; progress in this session cannot be saved.' }
  }
}

export function savePet(pet: PetState): boolean {
  try {
    if (!isPetState(pet)) return false
    const previous = window.localStorage.getItem(STORAGE_KEY)
    // Preserve malformed or unsupported records rather than overwriting them.
    if (previous !== null && !migratePet(JSON.parse(previous))) return false
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pet))
    return true
  } catch {
    return false
  }
}

// All app mutations share one lock and read the latest record inside it.
// Never write a stale React snapshot from an effect or another tab.
export async function transactPet(action: PetAction): Promise<{ pet: PetState; changed: boolean }> {
  if (!navigator.locks) throw new Error('Safe shared storage is unavailable.')
  const result = await navigator.locks.request('mochi.progress.update', () => {
    const previous = readPet()
    const next = petReducer(previous, action)
    if (next !== previous && !savePet(next)) throw new Error('Progress cannot be saved.')
    return { pet: next, changed: next !== previous }
  })
  // A different tab may have committed after releasing our lock but before
  // this response reached the UI. Do not replace its newer snapshot with ours.
  try {
    return { ...result, pet: readPet() }
  } catch {
    // The mutation already committed. A later read failure must not trigger
    // an in-memory replay of that action or report a successful save as failed.
    return result
  }
}
