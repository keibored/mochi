import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { FocusTimer } from './FocusTimer'
import { ActiveTimerNotice } from './ActiveTimerNotice'
import { WebsiteRulesSettings } from './WebsiteRulesSettings'
import { useProgress } from './useProgress'
import { ACTIVITY_CATEGORIES, dailySummary, FEED_COST, FIRST_MILESTONE_XP, isActivityCategory, isValidDuration, isValidGoal, localDateKey, MAX_NOTE_LENGTH, MIN_FOCUS_GOAL, MAX_FOCUS_GOAL } from './rewards'
import type { ActivityCategory } from './rewards'
import './App.css'

function App() {
  const { pet, dispatch, storageNotice, canPersist, busy } = useProgress()
  const recordingTools = useRef<HTMLDetailsElement>(null)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [duration, setDuration] = useState('')
  const [category, setCategory] = useState<ActivityCategory>('Focus')
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState('')
  const [goal, setGoal] = useState(String(pet.dailyFocusGoal))
  const [goalError, setGoalError] = useState('')
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const [reaction, setReaction] = useState<{ mood: string } | null>(null)
  const [today, setToday] = useState(() => new Date())

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
      Focus: 'Every little step counts. You and Mochi are growing together!',
      Rest: 'Mochi is settling in for a cozy little rest with you.',
      Leisure: 'A little fun belongs in your day, too.',
      Neutral: 'Your time has been recorded.',
    }
    setReaction({ mood: category === 'Rest' ? 'Feeling sleepy and cozy ♡' : category === 'Focus' ? 'Feeling encouraged ♡' : 'Feeling cozy.' })
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
    setFeedback(`Daily focus goal saved: ${minutes} minutes. Your XP and food credits are unchanged.`)
  }

  async function feed() {
    if (pet.foodCredits < FEED_COST) return
    const changed = await dispatch({ type: 'feed' })
    if (!changed) { setFeedback('Mochi needs 2 available food credits for a treat.'); return }
    setReaction({ mood: 'Feeling happy ♡' })
    setFeedback('Yum! Mochi loved that little treat. Thank you for taking care of me!')
  }

  const summary = dailySummary(pet.activities, today)
  const todayMinutes = summary.Focus
  const recentActivities = [...pet.activities].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 5)

  if (!pet.adopted) {
    return (
      <main className="welcome-page">
        <section className="welcome-card" aria-labelledby="welcome-heading">
          <p className="welcome-label">YOUR LITTLE PRODUCTIVITY COMPANION</p>
          <div className="mascot" role="img" aria-label="Mochi the bunny">🐰</div>
          <div className="welcome-message">
            <h1 id="welcome-heading">Meet Mochi.</h1>
            <p className="welcome-description">A little focus, a little rest, and a bunny by your side.</p>
          </div>
          <button className="adopt-button" type="button" disabled={busy} onClick={() => void dispatch({ type: 'adopt' })}>
            Adopt Mochi ♡
          </button>
          {storageNotice && <p className="storage-notice" role="status">{storageNotice}</p>}
        </section>
      </main>
    )
  }

  return (
    <div className="dashboard-page">
      <header className="brand">mochi ♡</header>
      <main className="dashboard">
        <div className="dashboard-intro">
          <p className="welcome-label">A LITTLE PROGRESS, TOGETHER</p>
          <h1>Welcome home, {pet.name}!</h1>
          <p>A little focus. A happy bunny. One step at a time.</p>
        </div>
        {storageNotice && <p className="storage-notice" role="status">{storageNotice}</p>}
        <div className="dashboard-grid">
          <section className="panel pet-card" aria-labelledby="pet-heading">
            <div className="mascot" role="img" aria-label="Mochi the bunny">🐰</div>
            <h2 id="pet-heading">{pet.name}</h2>
            <p className="mood">{reaction?.mood ?? 'Feeling cozy.'}</p>
            <dl className="pet-stats">
              <div><dt>Total XP</dt><dd>{pet.xp}</dd></div>
              <div><dt>Food credits</dt><dd>{pet.foodCredits}</dd></div>
            </dl>
            <label className="milestone-label" htmlFor="xp-progress">First milestone · 100 XP</label>
            <progress id="xp-progress" max={FIRST_MILESTONE_XP} value={Math.min(pet.xp, FIRST_MILESTONE_XP)} />
            <p className="help-text">{pet.xp >= FIRST_MILESTONE_XP ? 'First milestone reached! Look at you two grow.' : `${FIRST_MILESTONE_XP - pet.xp} XP to your first milestone.`}</p>
            <button className="adopt-button" type="button" disabled={busy || pet.foodCredits < FEED_COST} onClick={() => void feed()} aria-describedby="feeding-help">
              Feed Mochi · {FEED_COST} credits
            </button>
            <p id="feeding-help" className="help-text">Log 15 minutes of focus to earn 2 food credits for a treat.</p>
            <p className="feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
          </section>
          <div className="focus-column">
            <section className="panel tracking-status" aria-labelledby="tracking-heading">
              <p className="welcome-label">BROWSER ACTIVITY</p>
              <h2 id="tracking-heading">Browser tracking isn’t connected yet.</h2>
              <p>Once connected, Mochi will summarize time on your active websites using your categories.</p>
              <p className="help-text">The local Chrome extension proof of concept is not connected to this dashboard. Current totals contain only activities you have saved.</p>
            </section>
            {pet.timer && !toolsOpen && <ActiveTimerNotice session={pet.timer} openTools={() => {
              if (recordingTools.current) {
                recordingTools.current.open = true
                recordingTools.current.querySelector('summary')?.focus()
              }
            }} />}
            <section className="panel summary-card" aria-labelledby="summary-heading">
              <h2 id="summary-heading">Today’s activity</h2>
              <p className="help-text">Saved activity minutes · your local calendar day</p>
              <dl className="daily-summary">
                {ACTIVITY_CATEGORIES.map((item) => <div key={item}><dt>{item}</dt><dd>{summary[item]} <span>min</span></dd></div>)}
              </dl>
              <label className="milestone-label" htmlFor="goal-progress">{todayMinutes} / {pet.dailyFocusGoal} focus minutes</label>
              <progress id="goal-progress" max={pet.dailyFocusGoal} value={Math.min(todayMinutes, pet.dailyFocusGoal)} />
              {todayMinutes >= pet.dailyFocusGoal && <p className="goal-complete">Your focus goal is complete. Make room for a little rest ♡</p>}
            </section>
            <section className="panel activity-card" aria-labelledby="activity-heading">
              <h2 id="activity-heading">Recent activities</h2>
              {pet.activities.length === 0 ? <p className="empty-state">A fresh little start. Your saved activities will appear here.</p> : (
                <ul className="activity-list">
                  {recentActivities.map((activity) => (
                    <li key={activity.id}>
                      <div><strong>{activity.category} · {activity.duration} minutes</strong><span>{activity.source}</span>{activity.note && <p className="activity-note">{activity.note}</p>}</div>
                      <time dateTime={activity.timestamp}>{new Date(activity.timestamp).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <details id="recording-tools" className="recording-tools" ref={recordingTools} onToggle={(event) => setToolsOpen(event.currentTarget.open)}>
              <summary>Other ways to record time<span>Optional focus timer and manual logging</span></summary>
              <div className="optional-tools-content">
                <FocusTimer session={pet.timer} dispatch={dispatch} canPersist={canPersist} busy={busy} />
                <section className="panel focus-card" aria-labelledby="focus-heading">
                  <p className="welcome-label">YOUR LITTLE STEPS</p>
                  <h2 id="focus-heading">Log an activity</h2>
                  <p>Add time you have already spent. Entries are manually logged time; Mochi does not track your activity.</p>
                  <form onSubmit={logActivity} noValidate>
                    <label htmlFor="activity-category">Category</label>
                    <select id="activity-category" value={category} onChange={(event) => {
                      if (isActivityCategory(event.target.value)) setCategory(event.target.value)
                    }}>
                      {ACTIVITY_CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <label htmlFor="focus-duration">Duration (minutes)</label>
                    <input id="focus-duration" type="number" inputMode="numeric" min="1" max="240" step="1" value={duration}
                      onChange={(event) => { setDuration(event.target.value); setError('') }}
                      aria-invalid={Boolean(error)} aria-describedby={`duration-help${error ? ' duration-error' : ''}`} />
                    <p id="duration-help" className="help-text">Whole minutes, from 1 to 240 per entry.</p>
                    {error && <p id="duration-error" className="field-error" role="alert">{error}</p>}
                    <label htmlFor="activity-note">Note (optional)</label>
                    <textarea id="activity-note" rows={3} maxLength={MAX_NOTE_LENGTH} value={note}
                      onChange={(event) => { setNote(event.target.value); setNoteError('') }}
                      aria-invalid={Boolean(noteError)} aria-describedby={`note-help${noteError ? ' note-error' : ''}`} />
                    <p id="note-help" className="help-text">{note.length} / {MAX_NOTE_LENGTH} characters</p>
                    {noteError && <p id="note-error" className="field-error" role="alert">{noteError}</p>}
                    <button className="adopt-button" type="submit" disabled={busy}>Save activity ♡</button>
                  </form>
                  <p className="reward-note">Only Focus earns rewards: every 15 minutes in a local calendar day earns 5 XP + 2 food credits. Partial focus minutes add up across entries. Rewards cover the first 240 focus minutes each day; all logged time still counts. Leisure, Rest, and Neutral never subtract XP or credits.</p>
                </section>
              </div>
            </details>
            <WebsiteRulesSettings rules={pet.websiteRules} dispatch={dispatch} busy={busy} canPersist={canPersist} />
            <section className="panel settings-card" aria-labelledby="settings-heading">
              <h2 id="settings-heading">A goal for your day</h2>
              <p className="help-text" id="goal-help">A personal focus target, separate from lifetime XP. Changing it never awards rewards. The reward cap stays at 240 focus minutes per day.</p>
              <form onSubmit={saveGoal} noValidate>
                <label htmlFor="daily-goal">Daily focus goal (minutes)</label>
                <input id="daily-goal" type="number" inputMode="numeric" min={MIN_FOCUS_GOAL} max={MAX_FOCUS_GOAL} step="1" value={goal}
                  onChange={(event) => { setGoal(event.target.value); setGoalError('') }}
                  aria-invalid={Boolean(goalError)} aria-describedby={`goal-help goal-range${goalError ? ' goal-error' : ''}`} />
                <p id="goal-range" className="help-text">Whole minutes, from 15 to 480. Default: 60.</p>
                {goalError && <p id="goal-error" className="field-error" role="alert">{goalError}</p>}
                <button className="adopt-button" type="submit" disabled={busy}>Save daily goal ♡</button>
              </form>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}

export default App
