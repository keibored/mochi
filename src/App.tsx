import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { FocusTimer } from './FocusTimer'
import { ActiveTimerNotice } from './ActiveTimerNotice'
import { WebsiteRulesSettings } from './WebsiteRulesSettings'
import { ExtensionConnection, TrackingCard } from './ExtensionConnection'
import { useExtensionSync } from './useExtensionSync'
import { useProgress } from './useProgress'
import { ACTIVITY_CATEGORIES, FEED_COST, isActivityCategory, isValidDuration, isValidGoal, localDateKey, MAX_NOTE_LENGTH, MIN_FOCUS_GOAL, MAX_FOCUS_GOAL } from './rewards'
import type { ActivityCategory } from './rewards'
import { dashboardSummary, focusBaselineForDate, formatMinutes, recentActivityView } from './integration/activityView'
import { ActivityHistory } from './ActivityHistory'
import { ActivitySummary } from './ActivitySummary'
import { PetCard } from './PetCard'
import type { PetReaction } from './PetCard'
import { MochiBunny } from './MochiBunny'
import { AppIcon } from './AppIcon'
import './App.css'

type View = 'Home' | 'Activity' | 'Settings'
const navigation = [{ name: 'Home', icon: 'home' }, { name: 'Activity', icon: 'activity' }, { name: 'Settings', icon: 'settings' }] as const

function App() {
  const { pet, dispatch, commitSync, storageNotice, canPersist, busy } = useProgress()
  // One controller stays active across views; presentational cards share it.
  const sync = useExtensionSync({ pet, commitSync, canPersist })
  const [view, setView] = useState<View>('Home')
  const [duration, setDuration] = useState('')
  const [category, setCategory] = useState<ActivityCategory>('Focus')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [goal, setGoal] = useState(String(pet.dailyFocusGoal))
  const [goalError, setGoalError] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [reaction, setReaction] = useState<PetReaction | null>(null)
  const [today, setToday] = useState(() => new Date())
  const [historyLimit, setHistoryLimit] = useState(20)

  useEffect(() => {
    function refreshDay() {
      const now = new Date()
      setToday((previous) => localDateKey(previous) === localDateKey(now) ? previous : now)
    }
    const interval = window.setInterval(refreshDay, 1000)
    window.addEventListener('focus', refreshDay)
    document.addEventListener('visibilitychange', refreshDay)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshDay)
      document.removeEventListener('visibilitychange', refreshDay)
    }
  }, [])

  useEffect(() => {
    if (!reaction) return
    const timeout = window.setTimeout(() => setReaction(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [reaction])

  function navigate(next: View, focusTimer = false) {
    setView(next)
    window.requestAnimationFrame(() => {
      document.getElementById(focusTimer ? 'timer-heading' : `${next.toLowerCase()}-heading`)?.focus()
    })
  }

  async function logActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minutes = Number(duration)
    const validDuration = /^\d+$/.test(duration.trim()) && isValidDuration(minutes)
    setError(validDuration ? '' : 'Enter a whole number of minutes from 1 to 240.')
    setNoteError(note.length <= MAX_NOTE_LENGTH ? '' : 'Keep your note to 200 characters or fewer.')
    if (!validDuration || note.length > MAX_NOTE_LENGTH) return
    const changed = await dispatch({ type: 'log', activity: {
      id: crypto.randomUUID(), source: 'Manual', category, duration: minutes, note: note.trim(), timestamp: new Date().toISOString(),
    } })
    if (!changed) { setFeedback('This activity could not be added. Please try again.'); return }
    setDuration('')
    setNote('')
    setError('')
    const messages = {
      Focus: 'Every little step counts ♡',
      Rest: 'Mochi is settling in for a cozy little rest with you.',
      Leisure: 'A little fun belongs in your day, too.',
      Neutral: 'Your time has been recorded.',
    }
    setReaction({ mood: category === 'Rest' ? 'Feeling sleepy and cozy ♡' : category === 'Focus' ? 'Feeling encouraged ♡' : 'Feeling cozy.',
      expression: category === 'Rest' ? 'sleepy' : category === 'Focus' || category === 'Leisure' ? 'happy' : null })
    setFeedback(`${minutes} ${category.toLowerCase()} minutes saved. ${messages[category]}`)
  }

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minutes = Number(goal)
    if (!/^\d+$/.test(goal.trim()) || !isValidGoal(minutes)) {
      setGoalError('Enter a whole number of minutes from 15 to 480.')
      return
    }
    const changed = await dispatch({ type: 'goal', minutes })
    if (!changed) { setFeedback('The goal could not be updated. Please try again.'); return }
    setGoalError('')
    setFeedback(`Daily focus goal saved: ${minutes} minutes. XP and food credits are unchanged.`)
  }

  async function feed() {
    if (pet.foodCredits < FEED_COST) return
    const changed = await dispatch({ type: 'feed' })
    if (!changed) { setFeedback('Mochi needs 2 available food credits for a treat.'); return }
    setReaction({ mood: 'Feeling happy ♡', expression: 'happy' })
    setFeedback('Yum! Mochi loved that little treat ♡')
  }

  const summary = dashboardSummary(pet.activities, pet.extensionSync, today)
  const todayMinutes = summary.Focus
  const history = recentActivityView(pet.activities, pet.extensionSync, historyLimit + 1)
  const browserAuthoritative = pet.extensionSync.authorityStartedAt !== null
  const earlierFocus = focusBaselineForDate(pet.extensionSync, today)

  if (!pet.adopted) {
    return (
      <main className="welcome-page">
        <section className="welcome-card" aria-labelledby="welcome-heading">
          <p className="eyebrow">Your little productivity companion</p>
          <div className="welcome-bunny"><MochiBunny expression="cozy" /></div>
          <div className="welcome-message"><h1 id="welcome-heading">Meet Mochi.</h1><p className="welcome-description">A little focus, a little rest, and a bunny by your side.</p></div>
          <button className="adopt-button" type="button" disabled={busy} onClick={() => void dispatch({ type: 'adopt' })}>Adopt Mochi ♡</button>
          {storageNotice && <p className="storage-notice" role="status">{storageNotice}</p>}
        </section>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="app-header">
        <div className="brand"><span className="brand-symbol" aria-hidden="true">♡</span><span className="brand-name">mochi<small className="brand-tagline">A little progress, together.</small></span></div>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map((item) => <button key={item.name} type="button" aria-current={view === item.name ? 'page' : undefined} aria-controls={`${item.name.toLowerCase()}-view`} onClick={() => navigate(item.name)}><span className="nav-icon"><AppIcon name={item.icon} /></span>{item.name}</button>)}
        </nav>
      </header>
      <main className="app-main" id="main-content" tabIndex={-1}>
        {storageNotice && <p className="storage-notice" role="status">{storageNotice}</p>}
        {pet.timer && view !== 'Activity' && <ActiveTimerNotice session={pet.timer} openTools={() => navigate('Activity', true)} />}
        <p className="app-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
        {/* Keep every view mounted so navigation preserves unsaved fields and timer controls. */}
        <section id="home-view" className="app-view" hidden={view !== 'Home'} aria-labelledby="home-heading">
          <div className="view-heading"><div><p className="eyebrow">Make yourself at home</p><h1 id="home-heading" tabIndex={-1}>A little focus. A little joy.</h1><p>One small step, with {pet.name} by your side.</p></div></div>
          <div className="home-grid">
            <PetCard pet={pet} reaction={reaction} busy={busy} onFeed={() => void feed()} />
            <div className="home-aside">
              <TrackingCard pet={pet} sync={sync} openSettings={() => navigate('Settings')} />
              <ActivitySummary pet={pet} today={today} />
              <section className="panel goal-card" aria-labelledby="goal-heading">
                <div className="card-heading"><h2 id="goal-heading">Your daily focus goal</h2><span className="goal-symbol"><AppIcon name="focus" /></span></div>
                <div className="goal-topline"><label htmlFor="goal-progress"><strong>{formatMinutes(todayMinutes)}</strong> / {pet.dailyFocusGoal} focus minutes</label><button className="text-button" type="button" onClick={() => navigate('Settings')}>Adjust</button></div>
                <progress id="goal-progress" max={pet.dailyFocusGoal} value={Math.min(todayMinutes, pet.dailyFocusGoal)} />
                <p className={todayMinutes >= pet.dailyFocusGoal ? 'goal-complete' : 'help-text'}>{todayMinutes >= pet.dailyFocusGoal ? 'Your focus goal is complete. Make room for a little rest ♡' : 'A personal target. Every little bit counts.'}</p>
                {browserAuthoritative && earlierFocus > 0 && <p className="help-text">Includes {formatMinutes(earlierFocus)} Focus minutes saved before tracking was connected.</p>}
              </section>
            </div>
          </div>
          <section className="panel recent-preview" aria-labelledby="recent-heading"><div className="section-heading"><h2 id="recent-heading">Recent moments</h2><button className="text-button" type="button" onClick={() => navigate('Activity')}>View activity <AppIcon name="arrow" /></button></div><ActivityHistory activities={history.slice(0, 3)} /></section>
        </section>

        <section id="activity-view" className="app-view" hidden={view !== 'Activity'} aria-labelledby="activity-heading">
          <div className="view-heading"><div><p className="eyebrow">Room for every kind of day</p><h1 id="activity-heading" tabIndex={-1}>Your activity</h1><p>Real records, little moments, and optional ways to add time.</p></div></div>
          <section className="panel history-card" aria-labelledby="history-heading"><div className="section-heading"><h2 id="history-heading">Activity history</h2><span className="day-label">Newest first</span></div><p className="help-text history-help">Browser summaries, Manual entries, and Timer sessions keep their source labels. Records can overlap; this list is not a combined time total.</p><ActivityHistory activities={history.slice(0, historyLimit)} />{history.length > historyLimit && <button className="adopt-button secondary-button" type="button" onClick={() => setHistoryLimit((limit) => limit + 20)}>Show more activities</button>}</section>
          <div className="optional-tools-intro"><h2>Other ways to record time</h2><p>Optional tools for a little structure, or a moment away from the browser.</p></div>
          {browserAuthoritative && <p className="optional-tools-notice">These entries stay in history without extra Focus rewards or goal progress, including while tracking is paused or disconnected. Browser Focus supplies new rewards. Intentional manual Rest still counts.</p>}
          <div className="tools-grid">
            <FocusTimer session={pet.timer} dispatch={dispatch} canPersist={canPersist} busy={busy} />
            <section className="panel focus-card" aria-labelledby="manual-heading">
              <div className="card-heading"><h2 id="manual-heading">Log an activity</h2><span className="source-badge">Manual</span></div>
              <p className="help-text">Record time you have already spent. This is manual logging.</p>
              <form onSubmit={logActivity} noValidate>
                <div className="form-row"><div><label htmlFor="activity-category">Category</label><select id="activity-category" value={category} onChange={(event) => { if (isActivityCategory(event.target.value)) setCategory(event.target.value) }}>{ACTIVITY_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
                  <div><label htmlFor="focus-duration">Minutes</label><input id="focus-duration" type="number" inputMode="numeric" min="1" max="240" step="1" value={duration} onChange={(event) => { setDuration(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={`duration-help${error ? ' duration-error' : ''}`} /></div></div>
                <p id="duration-help" className="help-text">Whole minutes, from 1 to 240.</p>
                {error && <p id="duration-error" className="field-error" role="alert">{error}</p>}
                <label htmlFor="activity-note">A little note <span className="label-optional">(optional)</span></label>
                <textarea id="activity-note" rows={2} maxLength={MAX_NOTE_LENGTH} value={note} onChange={(event) => { setNote(event.target.value); setNoteError('') }} aria-invalid={Boolean(noteError)} aria-describedby={`note-help${noteError ? ' note-error' : ''}`} />
                <p id="note-help" className="help-text">{note.length} / {MAX_NOTE_LENGTH} characters</p>
                {noteError && <p id="note-error" className="field-error" role="alert">{noteError}</p>}
                <div className="form-actions"><button className="adopt-button" type="submit" disabled={busy}>Save activity ♡</button></div>
              </form>
              <details className="help-disclosure"><summary>Rewards &amp; overlapping time</summary><p>{browserAuthoritative ? 'Manual and timer entries are saved without extra Focus rewards or goal progress, including while tracking is paused or disconnected. Only browser Focus earns new XP and credits. Intentional manual Rest still appears separately in your summary.' : 'Every 15 accumulated Focus minutes in a local day earns 5 XP and 2 food credits, up to 240 reward-eligible minutes. Partial Focus entries add up. Other categories never subtract rewards.'}</p></details>
            </section>
          </div>
        </section>

        <section id="settings-view" className="app-view" hidden={view !== 'Settings'} aria-labelledby="settings-heading">
          <div className="view-heading"><div><p className="eyebrow">A little space for your preferences</p><h1 id="settings-heading" tabIndex={-1}>Make it your own</h1><p>A gentle goal and a browser companion, on your terms.</p></div></div>
          <div className="settings-grid">
            <section className="panel settings-card" aria-labelledby="daily-goal-heading">
              <div className="card-heading"><h2 id="daily-goal-heading">Daily focus goal</h2><span className="goal-symbol"><AppIcon name="focus" /></span></div>
              <p className="help-text" id="goal-help">Your personal target. Changing it never changes XP or food credits.</p>
              <form onSubmit={saveGoal} noValidate>
                <label htmlFor="daily-goal">Focus minutes per day</label>
                <input id="daily-goal" type="number" inputMode="numeric" min={MIN_FOCUS_GOAL} max={MAX_FOCUS_GOAL} step="1" value={goal} onChange={(event) => { setGoal(event.target.value); setGoalError('') }} aria-invalid={Boolean(goalError)} aria-describedby={`goal-help goal-range${goalError ? ' goal-error' : ''}`} />
                <p id="goal-range" className="help-text">15–480 whole minutes. Default: 60.</p>
                {goalError && <p id="goal-error" className="field-error" role="alert">{goalError}</p>}
                <div className="form-actions"><button className="adopt-button" type="submit" disabled={busy}>Save daily goal ♡</button></div>
              </form>
              <p className="help-text">The reward cap stays separate: 240 Focus minutes per day.</p>
            </section>
            <ExtensionConnection pet={pet} sync={sync} canPersist={canPersist} />
            <WebsiteRulesSettings rules={pet.websiteRules} dispatch={dispatch} busy={busy} canPersist={canPersist} />
          </div>
        </section>
      </main>
      <footer className="app-footer">A little focus, a little rest, and a bunny by your side. <span aria-hidden="true">♡</span></footer>
    </div>
  )
}

export default App
