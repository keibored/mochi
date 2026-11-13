import { ACTIVITY_CATEGORIES } from './rewards'
import { browserSummary, dashboardSummary, focusBaselineForDate, formatMinutes } from './integration/activityView'
import type { PetState } from './petState'
import { AppIcon } from './AppIcon'

const categoryIcon = { Focus: 'focus', Leisure: 'leisure', Rest: 'rest', Neutral: 'neutral' } as const

export function ActivitySummary({ pet, today, onAdjustGoal }: { pet: PetState; today: Date; onAdjustGoal: () => void }) {
  const authoritative = pet.extensionSync.authorityStartedAt !== null
  const saved = dashboardSummary(pet.activities, pet.extensionSync, today)
  const browser = browserSummary(pet.extensionSync, today)
  const totals = authoritative ? { ...browser, Rest: saved.Rest } : saved
  const earlierFocus = focusBaselineForDate(pet.extensionSync, today)

  return (
    <section className="panel summary-card" aria-labelledby="summary-heading">
      <div className="card-heading"><h2 id="summary-heading">Today’s time</h2><span className="day-label">{today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
      <dl className="daily-summary">
        {ACTIVITY_CATEGORIES.map((category) => (
          <div key={category} data-category={category}>
            <dt><AppIcon name={categoryIcon[category]} />{category}</dt>
            <dd>{formatMinutes(totals[category])}<span> min</span></dd>
            <small>{category === 'Rest' ? 'Manual' : authoritative ? 'Browser' : category === 'Focus' ? 'Manual / timer' : 'Manual'}</small>
          </div>
        ))}
      </dl>
      <p className="help-text summary-provenance">{authoritative ? 'Browser totals · manual Rest shown separately.' : 'Saved manual entries and timer sessions.'}</p>
      <div className="daily-goal" aria-labelledby="goal-heading">
        <div className="section-heading"><h3 id="goal-heading">Daily focus goal</h3><button className="text-button" type="button" onClick={onAdjustGoal}>Adjust</button></div>
        <div className="goal-topline"><label htmlFor="goal-progress"><strong>{formatMinutes(saved.Focus)}</strong> / {pet.dailyFocusGoal} <span>focus minutes</span></label></div>
        <progress id="goal-progress" max={pet.dailyFocusGoal} value={Math.min(saved.Focus, pet.dailyFocusGoal)} />
        {saved.Focus >= pet.dailyFocusGoal && <p className="goal-complete">Your focus goal is complete. Make room for a little rest ♡</p>}
        {authoritative && earlierFocus > 0 && <p className="help-text">Includes {formatMinutes(earlierFocus)} Focus minutes saved before tracking was connected.</p>}
      </div>
    </section>
  )
}
