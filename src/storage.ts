import { freshPet, petReducer } from './petState.ts'
import type { PetAction, PetState } from './petState.ts'
import { DEFAULT_FOCUS_GOAL, isActivity, isValidGoal } from './rewards.ts'
import { isTimerSession } from './timer.ts'
import { areWebsiteRules } from './websiteRules.ts'
import { freshWebSync, isWebSyncState } from './integration/syncDomain.ts'
import { isPetCare, migrateCare } from './petCare.ts'

export const STORAGE_KEY = 'mochi.progress'
export class ProgressValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isPetState(value: unknown): value is PetState {
  if (!isRecord(value) || value.version !== 6 || typeof value.adopted !== 'boolean' ||
      value.name !== 'Mochi' || typeof value.xp !== 'number' || !Number.isSafeInteger(value.xp) || value.xp < 0 ||
      typeof value.foodCredits !== 'number' || !Number.isSafeInteger(value.foodCredits) || value.foodCredits < 0 ||
      typeof value.dailyFocusGoal !== 'number' || !isValidGoal(value.dailyFocusGoal) ||
      !Array.isArray(value.activities) || !areWebsiteRules(value.websiteRules) || !isWebSyncState(value.extensionSync) ||
      (!value.adopted && value.extensionSync.authorityStartedAt !== null) ||
      (value.timer !== null && !isTimerSession(value.timer))) return false
  if (!isPetCare(value.care, value.timer as PetState['timer']) || (!value.adopted && value.care.rest !== null)) return false
  const ids = new Set<string>()
  const validActivities = value.activities.every((activity: unknown) => {
    if (!isActivity(activity) || ids.has(activity.id)) return false
    ids.add(activity.id)
    return true
  })
  return validActivities && (value.timer === null || (value.adopted && !ids.has(value.timer.id)))
}

// Structural migration only: saved balances remain authoritative.
export function migratePet(value: unknown, now = Date.now()): PetState | null {
  if (!isRecord(value) || ![1, 2, 3, 4, 5, 6].includes(value.version as number)) return null
  let activities = value.activities
  if (value.version === 1) {
    if (!Array.isArray(activities)) return null
    activities = activities.map((entry: unknown) => isRecord(entry)
      ? { ...entry, category: 'Focus', note: '' } : entry)
  }
  if (value.version === 1 || value.version === 2) {
    if (!Array.isArray(activities)) return null
    activities = activities.map((entry: unknown) => isRecord(entry) ? { ...entry, source: 'Manual' } : entry)
  }
  const timer = (value.version as number) >= 3 ? value.timer : null
  const extensionSync = (value.version as number) >= 5 ? value.extensionSync : freshWebSync()
  if (!Array.isArray(activities) || !activities.every(isActivity) || !isWebSyncState(extensionSync) ||
      (timer !== null && !isTimerSession(timer))) return null
  let care: unknown = value.care
  if (value.version !== 6) {
    try { care = migrateCare(activities, extensionSync, timer, now) } catch { return null }
  }
  const candidate = {
    ...value,
    version: 6,
    timer,
    websiteRules: (value.version as number) >= 4 ? value.websiteRules : [],
    extensionSync,
    care,
    dailyFocusGoal: value.dailyFocusGoal === undefined ? DEFAULT_FOCUS_GOAL : value.dailyFocusGoal,
    activities,
  }
  return isPetState(candidate) ? candidate : null
}

function readRecord(now = Date.now()): { pet: PetState; needsMigration: boolean } {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return { pet: freshPet(now), needsMigration: false }
  const value: unknown = JSON.parse(raw)
  const pet = migratePet(value, now)
  if (!pet) throw new Error('Saved progress could not be read; it has been preserved.')
  return { pet, needsMigration: isRecord(value) && value.version !== 6 }
}

export function readPet(now = Date.now()): PetState {
  return readRecord(now).pet
}

export function loadPet(): { pet: PetState; notice: string } {
  try {
    return { pet: readPet(), notice: '' }
  } catch {
    return { pet: freshPet(Date.now()), notice: 'Saved progress could not be read or is unavailable. Existing data is preserved; progress in this session cannot be saved.' }
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
export async function transactPet(action: PetAction): Promise<{ pet: PetState; changed: boolean; xpAwarded: number; creditsAwarded: number }> {
  if (!navigator.locks) throw new Error('Safe shared storage is unavailable.')
  const result = await navigator.locks.request('mochi.progress.update', () => {
    const { pet: previous, needsMigration } = readRecord('now' in action ? action.now : Date.now())
    let next: PetState
    try { next = petReducer(previous, action) } catch (error) {
      throw new ProgressValidationError(error instanceof Error ? error.message : 'Invalid progress update.')
    }
    // A structural migration must become durable even when the first tick or
    // stale control has no gameplay effect. Otherwise each read would establish
    // a new timer baseline and indefinitely forgive all future active time.
    if ((next !== previous || needsMigration) && !savePet(next)) throw new Error('Progress cannot be saved.')
    return { pet: next, changed: next !== previous,
      xpAwarded: Math.max(0, next.xp - previous.xp), creditsAwarded: Math.max(0, next.foodCredits - previous.foodCredits) }
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
