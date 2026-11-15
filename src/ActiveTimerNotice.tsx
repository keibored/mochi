import { useEffect, useState } from 'react'
import type { TimerSession } from './timer'
import { timerPresentation } from './timerPresentation'

export function ActiveTimerNotice({ session, openTools, compact = false }: { session: TimerSession; openTools: () => void; compact?: boolean }) {
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
  const notice = timerPresentation(session, now)
  return (
    <section className={`active-timer-notice${compact ? ' timer-context-notice' : ''}`} aria-label="Active focus timer">
      <div className={compact ? 'timer-context-copy' : undefined}>
        <p className={compact ? 'timer-context-state' : undefined} role="status" aria-live="polite" aria-atomic="true">{notice.shortLabel}</p>
        <p className={compact ? 'timer-context-clock' : undefined} aria-live="off">{compact && notice.kind === 'complete' ? 'Ready to save' : `${notice.clock} ${compact ? 'left' : 'remaining'}`}</p>
      </div>
      <button className="adopt-button secondary-button" type="button" aria-controls="activity-view" onClick={openTools}>View timer</button>
    </section>
  )
}
