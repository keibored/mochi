export const DEFAULT_TIMER_MINUTES = 25
export const MIN_TIMER_MINUTES = 1
export const MAX_TIMER_MINUTES = 120

export interface TimerSession {
  id: string
  duration: number
  startedAt: number
  elapsedMs: number
  runningSince: number | null
}

export function isTimerDuration(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= MIN_TIMER_MINUTES && minutes <= MAX_TIMER_MINUTES
}

export function isTimerSession(value: unknown): value is TimerSession {
  if (typeof value !== 'object' || value === null) return false
  const timer = value as Partial<TimerSession>
  return typeof timer.id === 'string' && timer.id.startsWith('timer-') && timer.id.length > 6 &&
    typeof timer.duration === 'number' && isTimerDuration(timer.duration) &&
    typeof timer.startedAt === 'number' && Number.isSafeInteger(timer.startedAt) && timer.startedAt >= 0 &&
    Number.isFinite(new Date(timer.startedAt).getTime()) &&
    typeof timer.elapsedMs === 'number' && Number.isSafeInteger(timer.elapsedMs) &&
    timer.elapsedMs >= 0 && timer.elapsedMs < timer.duration * 60_000 &&
    (timer.runningSince === null || (typeof timer.runningSince === 'number' &&
      Number.isSafeInteger(timer.runningSince) && timer.runningSince >= timer.startedAt &&
      Number.isFinite(new Date(timer.runningSince + timer.duration * 60_000).getTime())))
}

export function remainingMs(timer: TimerSession, now: number): number {
  const runningMs = timer.runningSince === null ? 0 : Math.max(0, now - timer.runningSince)
  return Math.max(0, timer.duration * 60_000 - timer.elapsedMs - runningMs)
}

// Reopening a tab later does not change the session's completion date.
export function completionTime(timer: TimerSession, now: number): number | null {
  if (timer.runningSince === null || remainingMs(timer, now) > 0) return null
  return timer.runningSince + timer.duration * 60_000 - timer.elapsedMs
}

export function pauseTimer(timer: TimerSession, now: number): TimerSession {
  if (timer.runningSince === null || completionTime(timer, now) !== null) return timer
  return { ...timer, elapsedMs: timer.duration * 60_000 - remainingMs(timer, now), runningSince: null }
}

export function resumeTimer(timer: TimerSession, now: number): TimerSession {
  return timer.runningSince !== null ? timer : { ...timer, runningSince: Math.max(now, timer.startedAt) }
}
