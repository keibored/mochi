import { completionTime, remainingMs } from './timer.ts'
import type { TimerSession } from './timer.ts'

/** A current-state view, never a remembered pause/wake success message. */
export function timerPresentation(session: TimerSession, now: number) {
  const kind = completionTime(session, now) !== null ? 'complete' : session.runningSince === null ? 'paused' : 'running'
  const seconds = Math.ceil(remainingMs(session, now) / 1000)
  return {
    kind,
    clock: `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`,
    label: kind === 'complete' ? 'Focus session complete ♡' : kind === 'paused' ? 'Focus timer paused.' : 'Focus timer running.',
    shortLabel: kind === 'complete' ? 'Focus session complete ♡' : kind === 'paused' ? 'Focus paused' : 'Focus in progress',
  }
}
