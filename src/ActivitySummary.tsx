import { ACTIVITY_CATEGORIES } from './rewards'
import { browserSummary, dashboardSummary, formatMinutes } from './integration/activityView'
import type { PetState } from './petState'
import { AppIcon } from './AppIcon'

const categoryIcon = { Focus: 'focus', Leisure: 'leisure', Rest: 'rest', Neutral: 'neutral' } as const

export function ActivitySummary({ pet, today }: { pet: PetState; today: Date }) {
  const authoritative = pet.extensionSync.authorityStartedAt !== null
  const saved = dashboardSummary(pet.activities, pet.extensionSync, today)
  const browser = browserSummary(pet.extensionSync, today)
  const totals = authoritative ? { ...browser, Rest: saved.Rest } : saved

  return (
    <section className="panel summary-card" aria-labelledby="summary-heading">
      <div className="card-heading"><h2 id="summary-heading">Today, at a glance</h2><span className="day-label">{today.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>
      <dl className="daily-summary">
        {ACTIVITY_CATEGORIES.map((category) => (
          <div key={category} data-category={category}>
            <dt><AppIcon name={categoryIcon[category]} />{category}</dt>
            <dd>{formatMinutes(totals[category])}<span> min</span></dd>
            <small>{category === 'Rest' ? 'Manual' : authoritative ? 'Browser' : category === 'Focus' ? 'Manual / timer' : 'Manual'}</small>
          </div>
        ))}
      </dl>
      <p className="help-text">{authoritative ? 'Browser totals and intentional manual Rest, shown separately. Optional records stay in Activity.' : 'Saved manual entries and timer sessions. Connect Brave in Settings for browser time.'}</p>
    </section>
  )
}
