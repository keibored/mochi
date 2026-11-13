import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { PetAction } from './petState'
import { changeWebsiteRule, classificationForHostname, isWebsiteCategory, normalizeHostname, WEBSITE_CATEGORIES } from './websiteRules'
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
  let preview = 'Enter a website to preview its category.'
  if (hostname.trim()) {
    try {
      const host = normalizeHostname(hostname)
      const current = classificationForHostname(rules, host)
      const automatic = classificationForHostname([], host)
      preview = `${host}: ${current.category} · ${current.origin}. Without an override: ${automatic.category} · ${automatic.origin}.`
    } catch { preview = 'Enter a valid hostname or HTTP(S) URL to preview its category.' }
  }

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
    setFeedback('Dashboard override saved. Past activities and rewards are unchanged.')
    reset()
    hostnameField.current?.focus()
  }

  async function remove(rule: WebsiteRule) {
    const changed = await dispatch({ type: 'rule-remove', hostname: rule.hostname })
    setFeedback(changed ? `Override removed for ${rule.hostname}. This list now uses its automatic category or Neutral fallback.` : 'This override was already removed in another tab.')
    if (editing === rule.hostname) reset()
    hostnameField.current?.focus()
  }

  return (
    <section className="panel website-settings" aria-labelledby="website-settings-heading">
      <div className="section-heading"><h2 id="website-settings-heading">Website categories</h2></div>
      <p>Mochi sorts supported websites automatically. Adjust a category whenever you need.</p>
      <p className="help-text">For live tracking, use <strong>Adjust website categories</strong> in Mochi’s Brave popup. Unknown and mixed-purpose sites stay Neutral; categories estimate website purpose, not your intent.</p>
      <details className="website-overrides">
        <summary>Saved dashboard overrides <span>({rules.length})</span></summary>
        <p className="help-text" id="website-rules-help">This separate dashboard list is preserved for you. Changes here do not update the extension’s live rules or past activities. Removing an override restores its automatic category or Neutral fallback in this list.</p>
        <form onSubmit={save} noValidate>
          <div className="form-row">
            <div className="field">
              <label htmlFor="website-hostname">Hostname or HTTP(S) URL</label>
              <input id="website-hostname" ref={hostnameField} type="text" maxLength={4096} autoCapitalize="none" autoCorrect="off" spellCheck={false}
                value={hostname} onChange={(event) => { setHostname(event.target.value); setError('') }}
                aria-invalid={Boolean(error)} aria-describedby={`website-rules-help hostname-help website-classification-preview${error ? ' hostname-error' : ''}`} />
            </div>
            <div className="field">
              <label htmlFor="website-category">Your override</label>
              <select id="website-category" value={category} onChange={(event) => {
                if (isWebsiteCategory(event.target.value)) setCategory(event.target.value)
              }}>
                {WEBSITE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}
              </select>
            </div>
          </div>
          <p className="help-text" id="hostname-help">Exact hostnames only; subdomains need their own override. Only the hostname is saved, with paths and queries discarded.</p>
          <p className="help-text" id="website-classification-preview">{preview}</p>
          {error && <p id="hostname-error" className="field-error" role="alert">{error}</p>}
          <div className="rule-actions">
            <button className="adopt-button" type="submit" disabled={busy}>{editing ? 'Save changes ♡' : 'Save dashboard override ♡'}</button>
            {editing && <button className="adopt-button secondary-button" type="button" onClick={() => { reset(); hostnameField.current?.focus() }}>Cancel edit</button>}
          </div>
        </form>
        <p className="help-text" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
        {!canPersist && <p className="help-text">Saving is unavailable. These changes will not survive a refresh.</p>}
        {rules.length === 0 ? <p className="empty-state">No dashboard overrides saved. Automatic categories need no setup.</p> : (
          <ul className="website-rule-list">
            {[...rules].sort((a, b) => a.hostname.localeCompare(b.hostname)).map((rule) => (
              <li key={rule.hostname}>
                <div><strong>{rule.hostname}</strong><span>{rule.category} · Your override</span></div>
                <div className="rule-actions">
                  <button className="adopt-button secondary-button" type="button" disabled={busy} aria-label={`Edit override for ${rule.hostname}`}
                    onClick={() => { setEditing(rule.hostname); setHostname(rule.hostname); setCategory(rule.category); setError(''); setFeedback(`Editing ${rule.hostname}.`); hostnameField.current?.focus() }}>Edit</button>
                  <button className="adopt-button secondary-button" type="button" disabled={busy} aria-label={`Remove override for ${rule.hostname}`} onClick={() => void remove(rule)}>Remove</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  )
}
