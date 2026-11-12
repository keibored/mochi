import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { PetAction } from './petState'
import { changeWebsiteRule, isWebsiteCategory, WEBSITE_CATEGORIES } from './websiteRules'
import type { WebsiteCategory, WebsiteRule } from './websiteRules'

interface Props {
  rules: readonly WebsiteRule[]
  dispatch: (action: PetAction) => Promise<boolean>
  busy: boolean
  canPersist: boolean
}

export function WebsiteRulesSettings({ rules, dispatch, busy, canPersist }: Props) {
  const [hostname, setHostname] = useState('')
  const [category, setCategory] = useState<WebsiteCategory>('Neutral')
  const [editing, setEditing] = useState<string | undefined>()
  const [error, setError] = useState('')
  const [feedback, setFeedback] = useState('')
  const hostnameField = useRef<HTMLInputElement>(null)

  function reset() {
    setHostname('')
    setCategory('Neutral')
    setEditing(undefined)
    setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = changeWebsiteRule(rules, hostname, category, editing)
    if (result.error) { setError(result.error); return }
    const changed = await dispatch({ type: 'rule-save', hostname, category, originalHostname: editing })
    if (!changed) { setError('Rules changed in another tab. Review them and try again.'); return }
    setFeedback('Website rule updated. Past activities and rewards are unchanged.')
    reset()
    hostnameField.current?.focus()
  }

  async function remove(rule: WebsiteRule) {
    const changed = await dispatch({ type: 'rule-remove', hostname: rule.hostname })
    setFeedback(changed ? `Rule removed for ${rule.hostname}. Past activities and rewards are unchanged.` : 'This rule was already removed in another tab.')
    if (editing === rule.hostname) reset()
    hostnameField.current?.focus()
  }

  return (
    <section className="panel website-settings" aria-labelledby="website-settings-heading">
      <h2 id="website-settings-heading">Website categories</h2>
      <p id="website-rules-help">These are your saved dashboard rules. Active browser tracking uses the rules in Mochi’s Brave extension settings. The two rule lists are kept separately and never overwrite each other.</p>
      <p className="help-text">You decide what each site means for your day. Unknown websites default to Neutral. Rules match exact hostnames only: example.com does not include www.example.com or other subdomains. Rest is an intentional activity; browser inactivity will not count as rest.</p>
      <form onSubmit={save} noValidate>
        <label htmlFor="website-hostname">Website hostname or HTTP(S) URL</label>
        <input id="website-hostname" ref={hostnameField} type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
          value={hostname} onChange={(event) => { setHostname(event.target.value); setError('') }}
          aria-invalid={Boolean(error)} aria-describedby={`website-rules-help hostname-help${error ? ' hostname-error' : ''}`} />
        <p className="help-text" id="hostname-help">Only the hostname is saved. Paths, query strings, fragments, and URL ports are discarded. Use a full HTTP(S) URL when including a port.</p>
        {error && <p id="hostname-error" className="field-error" role="alert">{error}</p>}
        <label htmlFor="website-category">Website category</label>
        <select id="website-category" value={category} onChange={(event) => {
          if (isWebsiteCategory(event.target.value)) setCategory(event.target.value)
        }}>
          {WEBSITE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <div className="rule-actions">
          <button className="adopt-button" type="submit" disabled={busy}>{editing ? 'Save rule changes ♡' : 'Save website rule ♡'}</button>
          {editing && <button className="adopt-button secondary-button" type="button" onClick={() => { reset(); hostnameField.current?.focus() }}>Cancel edit</button>}
        </div>
      </form>
      <p className="help-text" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
      {!canPersist && <p className="help-text">Saving is unavailable. Rule changes are session-only and will not survive a refresh.</p>}
      {rules.length === 0 ? <p className="empty-state">No website rules yet. Unlisted sites will be Neutral.</p> : (
        <ul className="website-rule-list">
          {[...rules].sort((a, b) => a.hostname.localeCompare(b.hostname)).map((rule) => (
            <li key={rule.hostname}>
              <div><strong>{rule.hostname}</strong><span>{rule.category} · exact hostname</span></div>
              <div className="rule-actions">
                <button className="adopt-button secondary-button" type="button" disabled={busy} aria-label={`Edit rule for ${rule.hostname}`}
                  onClick={() => { setEditing(rule.hostname); setHostname(rule.hostname); setCategory(rule.category); setError(''); setFeedback(`Editing ${rule.hostname}.`); hostnameField.current?.focus() }}>Edit</button>
                <button className="adopt-button secondary-button" type="button" disabled={busy} aria-label={`Remove rule for ${rule.hostname}`} onClick={() => void remove(rule)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
