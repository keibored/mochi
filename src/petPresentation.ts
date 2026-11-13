import { completionTime } from './timer.ts'
import type { TimerSession } from './timer.ts'

export type PetExpression = 'cozy' | 'happy' | 'sleepy' | 'focusing'

/** Presentation follows real reactions and timer state without changing progress. */
export function petExpression(reaction: 'happy' | 'sleepy' | null, timer: TimerSession | null, now: number): PetExpression {
  if (reaction !== null) return reaction
  return timer !== null && timer.runningSince !== null && completionTime(timer, now) === null ? 'focusing' : 'cozy'
}
