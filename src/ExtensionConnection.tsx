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
    case 'Tracking': return 'Active browser time is syncing with Mochi.'
    case 'Paused': return 'Resume in Mochi’s Brave popup whenever you’re ready.'
    case 'Tracking off': return 'Enable tracking in Mochi’s Brave popup to begin.'
    case 'Idle': return 'Waiting until you’re active again.'
    case 'Browser unfocused': return 'Counting resumes when Brave is focused.'
    case 'No supported website': return 'Open an HTTP(S) website in Brave to record time.'
    case 'Approval needed': return 'Approve the connection in Mochi’s Brave popup.'
    case 'Requesting approval': return 'Requesting permission from your extension…'
    case 'Connection lost': return 'Your saved progress is safe. Review your connection.'
    case 'Checking connection': return 'Verifying your connection with Brave…'
    default: return 'Bring your browser activity into Mochi.'
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
        <li><strong>Counting:</strong> only the active tab in focused Brave counts. Pause, idle, or loss of focus stops counting. Estimates include a 60-second idle grace period.</li>
        <li><strong>Categories:</strong> website defaults are estimates, with optional overrides. Unknown sites stay Neutral; Rest is intentional.</li>
        <li><strong>Privacy:</strong> only category/time summaries sync. Website details stay in the popup; page contents and full URLs do not reach this app.</li>
        <li><strong>Rewards:</strong> 15 Focus minutes earns 5 XP and 2 credits, capped at 240 eligible minutes per local day. {authorityStarted ? 'Browser Focus supplies new rewards and goal progress; optional manual/timer records do not add extra rewards, even while disconnected.' : 'Connecting preserves your progress and imports future time. Browser Focus then supplies new rewards; optional manual/timer records do not add extra rewards.'} This avoids overlapping rewards. Your personal goal is separate.</li>
      </ul>
    </details>
  )
}

export function HomeTrackingStatus({ pet, sync, openSettings }: Pick<ConnectionProps, 'pet' | 'sync'> & { openSettings: () => void }) {
  const status = connectionStatus(pet, sync)
  const lastSync = pet.extensionSync.lastSuccessfulSyncAt
  const feedback = sync.notice === 'Connection approved. Browser activity is now syncing automatically.' ? '' : sync.notice
  return (
    <div className="home-tracking-status" role="group" aria-label="Browser tracking">
      <span className="status-badge" data-connected={sync.connected} role="status" aria-live="polite" aria-atomic="true">
        <span className="tracking-dot" aria-hidden="true" />{status}
      </span>
      <button className="adopt-button secondary-button" type="button" onClick={openSettings}>{sync.pending ? 'Approval steps' : pet.extensionSync.pairing ? 'Settings' : 'Set up tracking'}</button>
      {lastSync !== null && <span className="home-tracking-sync">Synced <time dateTime={new Date(lastSync).toISOString()}>{new Date(lastSync).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })}</time></span>}
      <p className="home-tracking-feedback" role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
    </div>
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
          <p className="help-text" id="extension-id-help">Copy it from Mochi’s popup or brave://extensions with Developer mode on.</p>
          <p className="help-text" id="connection-consent">Request access, then approve <strong>{APP_ORIGIN}</strong> in Mochi’s Brave popup.</p>
          <div className="form-actions">
            <button className="adopt-button" type="submit" disabled={!canPersist || !originAllowed || sync.pending || sync.requesting}>
              {sync.pending ? 'Waiting for approval…' : sync.requesting ? 'Requesting…' : pet.extensionSync.pairing ? 'Reconnect in Brave' : 'Connect in Brave'}
            </button>
          </div>
          {!originAllowed && <p className="field-error">Open this app at {APP_ORIGIN} to connect.</p>}
          {!canPersist && <p className="help-text">Local storage and safe sharing between tabs must be available to connect.</p>}
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
