import { AppIcon } from './AppIcon'
import { formatMinutes } from './integration/activityView'
import type { RecentActivity } from './integration/activityView'

const categoryIcon = { Focus: 'focus', Leisure: 'leisure', Rest: 'rest', Neutral: 'neutral' } as const

export function ActivityHistory({ activities }: { activities: readonly RecentActivity[] }) {
  if (!activities.length) return (
    <div className="empty-state">
      <span className="empty-icon"><AppIcon name="activity" /></span>
      <div><strong>A fresh little start</strong><p>Browser summaries and saved activities will appear here.</p></div>
    </div>
  )
  return (
    <ul className="activity-list">
      {activities.map((activity) => (
        <li className="activity-row" key={activity.id}>
          <span className="activity-icon" data-category={activity.category}><AppIcon name={categoryIcon[activity.category]} /></span>
          <div className="activity-details">
            <strong>{activity.category} <span className="activity-duration">· {formatMinutes(activity.duration)} min</span></strong>
            <div className="activity-meta"><span className="source-badge">{activity.source}</span>{activity.source === 'Extension' && <span>Cumulative browser summary</span>}</div>
            {activity.note && <p className="activity-note">{activity.note}</p>}
          </div>
          <time dateTime={activity.timestamp}>{new Date(activity.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time>
        </li>
      ))}
    </ul>
  )
}
