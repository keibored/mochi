import { completionTime } from './timer.ts'
import type { TimerSession } from './timer.ts'

export type PetExpression = 'sleeping' | 'under-the-weather' | 'hungry' | 'tired' | 'focusing' | 'happy' | 'cozy'

interface VisibleCare {
  fullness: number
  energy: number
  rest: unknown | null
}

/** One visible state, derived without changing stats or persisting a second mood.
 * Intentional rest > fullness below 20 > fullness below 40 > energy below 30 >
 * running unfinished Focus timer > genuine temporary happiness > cozy.
 * These are fictional companion states, never judgments about the person.
 */
export function petExpression(care: VisibleCare, timer: TimerSession | null, now: number, happy = false): PetExpression {
  if (care.rest != null) return 'sleeping'
  if (care.fullness < 20) return 'under-the-weather'
  if (care.fullness < 40) return 'hungry'
  if (care.energy < 30) return 'tired'
  if (timer !== null && timer.runningSince !== null && completionTime(timer, now) === null) return 'focusing'
  return happy ? 'happy' : 'cozy'
}
