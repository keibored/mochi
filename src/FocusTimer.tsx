import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { PetAction } from './petState'
import { completionTime, DEFAULT_TIMER_MINUTES, isTimerDuration, MAX_TIMER_MINUTES, MIN_TIMER_MINUTES, remainingMs } from './timer'
import type { TimerSession } from './timer'

interface Props {
  session: TimerSession | null
  dispatch: (action: PetAction) => Promise<boolean>
  canPersist: boolean
  busy: boolean
}

export function FocusTimer({ session, dispatch, canPersist, busy }: Props) {
  const [duration, setDuration] = useState(String(DEFAULT_TIMER_MINUTES))
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [now, setNow] = useState(Date.now)
  const [cancelId, setCancelId] = useState<string | null>(null)

  useEffect(() => {
    function refreshClock() { setNow(Date.now()) }
    const interval = window.setInterval(refreshClock, 250)
    window.addEventListener('focus', refreshClock)
    document.addEventListener('visibilitychange', refreshClock)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshClock)
      document.removeEventListener('visibilitychange', refreshClock)
    }
  }, [])

  // Only this short state label is live; the countdown is never announced.
  const completed = session !== null && completionTime(session, now) !== null
  const stateLabel = session ? (completed ? 'Focus session complete ♡' : session.runningSince === null ? 'Focus timer paused.' : 'Focus timer running.') : ''
  const seconds = session ? Math.ceil(remainingMs(session, now) / 1000) : Number(duration) * 60
  const display = Number.isFinite(seconds) && seconds >= 0
    ? `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}` : '00:00'

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minutes = Number(duration)
    if (!/^\d+$/.test(duration.trim()) || !isTimerDuration(minutes)) {
      setError('Enter a whole number of minutes from 1 to 120.')
      return
    }
    setError('')
    setFeedback('')
    setNow(Date.now())
    const changed = await dispatch({ type: 'timer-start', id: `timer-${crypto.randomUUID()}`, duration: minutes, now: Date.now() })
    if (!changed) setFeedback('The timer could not start. Another tab may already have a session, or saving is unavailable.')
  }

  async function act(type: 'timer-pause' | 'timer-resume' | 'timer-save' | 'timer-cancel') {
    if (!session) return
    const changed = await dispatch({ type, id: session.id, now: Date.now() })
    setNow(Date.now())
    setCancelId(null)
    setFeedback(changed ? type === 'timer-save' ? 'Session saved as Focus. Every little step counts ♡'
      : type === 'timer-cancel' ? 'Session cancelled. No time or rewards were added.' : ''
      : 'No change was saved. This session may have changed in another tab, or saving is unavailable.')
  }

  return (
    <section className="panel timer-card" aria-labelledby="timer-heading">
      <h2 id="timer-heading" tabIndex={-1}>Focus timer</h2>
      <p id="timer-help" className="help-text">An optional elapsed-time session, not verified activity.</p>
      <p className="timer-countdown" role="timer" aria-label="Time remaining" aria-live="off">{display}</p>
      <p className="timer-status" role="status" aria-live="polite" aria-atomic="true">{stateLabel || feedback || 'Ready for a little focus?'}</p>
      {!session ? (
        <form onSubmit={start} noValidate>
          <label htmlFor="timer-duration">Session duration (minutes)</label>
          <input id="timer-duration" type="number" inputMode="numeric" min={MIN_TIMER_MINUTES} max={MAX_TIMER_MINUTES} step="1" value={duration}
            onChange={(event) => { setDuration(event.target.value); setError('') }}
            aria-invalid={Boolean(error)} aria-describedby={`timer-help timer-range${error ? ' timer-error' : ''}`} />
          <p id="timer-range" className="help-text">1–120 whole minutes.</p>
          {error && <p id="timer-error" className="field-error" role="alert">{error}</p>}
          <button className="adopt-button" type="submit" disabled={busy || !canPersist}>Start</button>
        </form>
      ) : (
        <div className="timer-controls">
          {completed ? <button className="adopt-button" type="button" disabled={busy || !canPersist} onClick={() => void act('timer-save')}>Save session</button>
            : <button className="adopt-button" type="button" disabled={busy || !canPersist}
              onClick={() => void act(session.runningSince === null ? 'timer-resume' : 'timer-pause')}>
              {session.runningSince === null ? 'Resume' : 'Pause'}
            </button>}
          <button className="adopt-button secondary-button" type="button" disabled={busy || !canPersist}
            aria-expanded={cancelId === session.id} aria-controls={cancelId === session.id ? 'timer-cancel-confirmation' : undefined}
            onClick={() => setCancelId(session.id)}>Cancel</button>
        </div>
      )}
      {session && cancelId === session.id && (
        <div id="timer-cancel-confirmation" className="timer-cancel" role="group" aria-labelledby="cancel-question">
          <p id="cancel-question" role="alert">Cancel this session? No time or rewards will be added.</p>
          <div className="timer-controls">
            <button className="adopt-button" type="button" disabled={busy || !canPersist} onClick={() => void act('timer-cancel')}>Yes, cancel session</button>
            <button className="adopt-button secondary-button" type="button" onClick={() => setCancelId(null)}>Keep session</button>
          </div>
        </div>
      )}
      {session && feedback && <p role="status">{feedback}</p>}
      {!canPersist && <p className="help-text">The timer needs available storage and safe tab coordination. You can still log time manually for this visit.</p>}
      <details className="help-disclosure timer-details">
        <summary>About this timer</summary>
        <p>A running timer continues while the page is closed. Paused time does not count. Complete a session, then save it to your activity history.</p>
        <p>Sessions use the local date they finished, even if saved later. Only one timer can be active across your Mochi tabs.</p>
      </details>
    </section>
  )
}
