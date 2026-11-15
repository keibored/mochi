import { useState } from 'react'
import type { FormEvent } from 'react'
import { isValidLeisureAllowance, MAX_LEISURE_ALLOWANCE, MIN_LEISURE_ALLOWANCE } from './petCare'
import type { PetAction } from './petState'

export function CareSettings({ allowance, busy, canPersist, dispatch }: { allowance: number; busy: boolean; canPersist: boolean; dispatch: (action: PetAction) => Promise<boolean> }) {
  const [minutes, setMinutes] = useState(String(allowance))
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(minutes)
    if (!/^\d+$/.test(minutes.trim()) || !isValidLeisureAllowance(value)) { setError('Enter whole minutes from 0 to 1440.'); return }
    const changed = await dispatch({ type: 'care-allowance', minutes: value, now: Date.now() })
    setError('')
    setFeedback(changed ? 'Allowance saved for future activity. Existing fullness is unchanged.' : 'That allowance is already saved, or no change could be saved. Your care progress is preserved.')
  }
  return <section className="panel care-settings" aria-labelledby="care-settings-heading"><h2 id="care-settings-heading">A gentle care rhythm</h2><p className="help-text">Leisure has room in your day. Beyond this allowance, each new 15 minutes uses 5 fullness.</p><form onSubmit={save} noValidate><label htmlFor="leisure-allowance">Daily Leisure allowance (minutes)</label><input id="leisure-allowance" type="number" inputMode="numeric" min={MIN_LEISURE_ALLOWANCE} max={MAX_LEISURE_ALLOWANCE} step="1" value={minutes} onChange={(event) => { setMinutes(event.target.value); setError('') }} aria-invalid={Boolean(error)} aria-describedby={`allowance-help${error ? ' allowance-error' : ''}`} /><p id="allowance-help" className="help-text">Default: 60. Changes do not recalculate past care; the partial excess-minute buffer starts fresh.</p>{error && <p className="field-error" id="allowance-error" role="alert">{error}</p>}<div className="form-actions"><button className="adopt-button" type="submit" disabled={busy || !canPersist}>Save allowance</button></div></form><p className="help-text" role="status" aria-live="polite">{feedback}</p><details className="help-disclosure"><summary>How Mochi’s care works</summary><p>Fullness and energy describe a fictional bunny, never your health or worth. Only newly accepted eligible Leisure uses fullness. Unknown sites, Focus, idle, and missing tracking data do not.</p><p>Feeding costs 2 credits and restores 20 fullness. Intentional rest restores 5 energy every 5 minutes. After the first connection, accepted browser Focus uses 1 energy per 5 minutes; optional timers do not deduct again. Before connection, active timer time uses that rate, excluding pauses. Low energy never blocks Focus.</p><p>After browser reward authority is reserved, optional Manual/Timer records do not add overlapping Leisure costs or Focus rewards, even while disconnected. Automatic Focus energy pauses during intentional Rest; waking applies only future eligible deltas. Rest gives no Focus rewards. Care is gentle and reversible; XP and levels are never lost.</p></details></section>
}
