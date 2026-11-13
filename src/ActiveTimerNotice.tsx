import { useEffect, useState } from 'react'
import { completionTime, remainingMs } from './timer'
import type { TimerSession } from './timer'

export function ActiveTimerNotice({ session, openTools }: { session: TimerSession; openTools: () => void }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    function refresh() { setNow(Date.now()) }
    const interval = window.setInterval(refresh, 1000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  const complete = completionTime(session, now) !== null
  const seconds = Math.ceil(remainingMs(session, now) / 1000)
  const clock = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  return (
    <section className="active-timer-notice" aria-label="Active focus timer">
      <div>
        <p role="status" aria-live="polite" aria-atomic="true">{complete ? 'Focus session complete ♡' : session.runningSince === null ? 'Focus paused' : 'Focus in progress'}</p>
        <p aria-live="off">{clock} remaining</p>
      </div>
      <button className="adopt-button secondary-button" type="button" aria-controls="activity-view" onClick={openTools}>View timer</button>
    </section>
  )
}
