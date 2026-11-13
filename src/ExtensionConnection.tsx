import { useState } from 'react'
import type { FormEvent } from 'react'
import { APP_ORIGIN } from './integration/localConfig'
import type { PetState } from './petState'
import type { useExtensionSync } from './useExtensionSync'

export interface ConnectionProps {
  pet: PetState
  canPersist: boolean
  sync: ReturnType<typeof useExtensionSync>
}

function connectionStatus(pet: PetState, sync: ConnectionProps['sync']) {
  if (sync.connected) return sync.liveStatus ?? 'Checking connection'
  if (sync.pending) return 'Approval needed'
  if (sync.requesting) return 'Requesting approval'
  if (pet.extensionSync.pairing) {
    // The hook's only non-error notice is its successful approval message.
    const issue = sync.notice && sync.notice !== 'Connection approved. Browser activity is now syncing automatically.'
    return issue ? 'Connection lost' : 'Checking connection'
  }
  return 'Not connected'
}

function statusGuidance(status: string) {
  switch (status) {
    case 'Tracking': return 'Your active browser time is syncing with Mochi.'
    case 'Paused': return 'Take your time. Resume in Mochi’s Brave popup when you’re ready.'
    case 'Tracking off': return 'Turn on tracking in Mochi’s Brave popup to begin.'
    case 'Idle': return 'Counting waits while you’re away.'
    case 'Browser unfocused': return 'Counting waits until Brave is focused again.'
    case 'No supported website': return 'Open an HTTP(S) website in Brave to record time.'
    case 'Approval needed': return 'Open Mochi’s Brave popup to approve your connection.'
    case 'Requesting approval': return 'Asking your extension for connection approval…'
    case 'Connection lost': return 'Your saved progress is safe. Check your connection in Settings.'
    case 'Checking connection': return 'Checking your saved connection with Brave…'
    default: return 'Connect Mochi’s Brave extension to bring your day here.'
  }
}

function LastSync({ pet }: Pick<ConnectionProps, 'pet'>) {
  const lastSync = pet.extensionSync.lastSuccessfulSyncAt
  return lastSync === null ? <p className="help-text">No activity synced yet.</p> : (
    <p className="help-text">Last synced <time dateTime={new Date(lastSync).toISOString()}>{new Date(lastSync).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })}</time></p>
  )
}

function TrackingDetails({ authorityStarted }: { authorityStarted: boolean }) {
  return (
    <details className="tracking-details">
      <summary>How tracking works</summary>
      <ul>
        <li>Only the active tab in focused Brave counts. Paused, idle, and unfocused time stops counting. Timing is an estimate, with a 60-second idle threshold.</li>
        <li>Automatic categories estimate website purpose. Optional extension overrides take priority; unknown sites stay Neutral. Rest is always intentional.</li>
        <li>Only category and time summaries reach this app. Current website details stay in the extension popup; page contents and full URLs are not synced.</li>
        <li>{authorityStarted ? 'Browser Focus supplies new rewards and goal progress. Manual and timer entries stay in history without extra rewards, including while disconnected, to avoid counting overlapping time twice.' : 'First connection keeps existing progress and starts importing future browser time. Browser Focus then supplies new rewards; manual and timer tools remain available without extra rewards.'}</li>
        <li>Every 15 accumulated Focus minutes earns 5 XP and 2 food credits, up to 240 reward-eligible minutes per local day. Your personal goal is separate.</li>
      </ul>
    </details>
  )
}

export function TrackingCard({ pet, sync, openSettings }: Pick<ConnectionProps, 'pet' | 'sync'> & { openSettings: () => void }) {
  const status = connectionStatus(pet, sync)
  return (
    <section className="panel tracking-card" aria-labelledby="tracking-heading">
      <div className="card-heading">
        <h2 id="tracking-heading">Browser activity</h2>
        <span className="status-badge" data-connected={sync.connected} role="status" aria-live="polite" aria-atomic="true">
          <span className="tracking-dot" aria-hidden="true" />{status}
        </span>
      </div>
      <p className="tracking-summary">{statusGuidance(status)}</p>
      <LastSync pet={pet} />
      <div className="tracking-actions">
        <button className="adopt-button secondary-button" type="button" onClick={openSettings}>{sync.connected ? 'Connection settings' : 'Set up connection'}</button>
      </div>
      <TrackingDetails authorityStarted={pet.extensionSync.authorityStartedAt !== null} />
    </section>
  )
}

export function ExtensionConnection({ pet, canPersist, sync }: ConnectionProps) {
  const [extensionId, setExtensionId] = useState(() => pet.extensionSync.pairing?.extensionId ?? '')
  const authorityStarted = pet.extensionSync.authorityStartedAt !== null
  const originAllowed = window.location.origin === APP_ORIGIN
  const status = connectionStatus(pet, sync)

  function requestConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sync.connect(extensionId.trim())
  }

  return (
    <section className="panel tracking-card" aria-labelledby="connection-heading">
      <div className="card-heading">
        <h2 id="connection-heading">Browser connection</h2>
        <span className="status-badge" data-connected={sync.connected}>{status}</span>
      </div>
      <p className="tracking-summary">{statusGuidance(status)}</p>
      <LastSync pet={pet} />
      {!sync.connected && (
        <form className="extension-connection-form" onSubmit={requestConnection} noValidate>
          <label htmlFor="extension-id">Mochi extension ID</label>
          <input id="extension-id" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32}
            value={extensionId} onChange={(event) => setExtensionId(event.target.value)} disabled={sync.pending || sync.requesting}
            aria-describedby="extension-id-help connection-consent" />
          <p className="help-text" id="extension-id-help">Copy the ID from Mochi’s popup or brave://extensions with Developer mode on.</p>
          <p className="help-text" id="connection-consent">Request access, then approve <strong>{APP_ORIGIN}</strong> in Mochi’s Brave popup.</p>
          <div className="form-actions">
            <button className="adopt-button" type="submit" disabled={!canPersist || !originAllowed || sync.pending || sync.requesting}>
              {sync.pending ? 'Waiting for approval…' : sync.requesting ? 'Requesting…' : pet.extensionSync.pairing ? 'Reconnect in Brave' : 'Connect in Brave'}
            </button>
          </div>
          {!originAllowed && <p className="field-error">Open this app at {APP_ORIGIN} to connect.</p>}
          {!canPersist && <p className="help-text">Connecting needs available local storage and safe sharing between app tabs.</p>}
          {!authorityStarted && pet.timer && <p className="help-text">Save or cancel your active timer before first connecting.</p>}
        </form>
      )}
      {sync.connected && <p className="help-text">Pause, resume, or turn tracking off in Mochi’s Brave popup.</p>}
      {sync.pending && <p className="connection-pending">Open Mochi’s popup and approve within two minutes.</p>}
      <p className="help-text" role="status" aria-live="polite" aria-atomic="true">{sync.notice}</p>
      <TrackingDetails authorityStarted={authorityStarted} />
    </section>
  )
}
