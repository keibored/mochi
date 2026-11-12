import { useState } from 'react'
import type { FormEvent } from 'react'
import { APP_ORIGIN } from './integration/localConfig'
import { useExtensionSync } from './useExtensionSync'
import type { ExtensionSyncProps } from './useExtensionSync'

export function ExtensionConnection(props: ExtensionSyncProps) {
  const sync = useExtensionSync(props)
  const [extensionId, setExtensionId] = useState(() => props.pet.extensionSync.pairing?.extensionId ?? '')
  const lastSync = props.pet.extensionSync.lastSuccessfulSyncAt
  const authorityStarted = props.pet.extensionSync.authorityStartedAt !== null
  const originAllowed = window.location.origin === APP_ORIGIN

  function requestConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void sync.connect(extensionId.trim())
  }

  return (
    <section className="panel tracking-status" aria-labelledby="tracking-heading">
      <p className="welcome-label">BROWSER ACTIVITY · BRAVE</p>
      <div role="status" aria-live="polite" aria-atomic="true">
        <h2 id="tracking-heading">{sync.connected ? `Browser connected · ${sync.liveStatus}` : sync.pending ? 'Approve your connection in Brave.' : 'Browser tracking isn’t connected yet.'}</h2>
      </div>
      <p>{sync.connected ? 'Your extension is sending real activity totals. Tracking pauses when you are idle, the browser loses focus, or you pause it in the popup.' : 'Once connected, Mochi will summarize time on your active websites using your categories.'}</p>
      {lastSync !== null && <p className="help-text">Last successful sync: <time dateTime={new Date(lastSync).toISOString()}>{new Date(lastSync).toLocaleString()}</time>. {sync.connected ? '' : 'These are saved totals; the current tracking state is unverified.'}</p>}
      {!sync.connected && (
        <form className="extension-connection-form" onSubmit={requestConnection} noValidate>
          <label htmlFor="extension-id">Mochi extension ID</label>
          <input id="extension-id" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={32}
            value={extensionId} onChange={(event) => setExtensionId(event.target.value)} disabled={sync.pending || sync.requesting}
            aria-describedby="extension-id-help connection-consent" />
          <p className="help-text" id="extension-id-help">In brave://extensions, enable Developer mode and copy the ID beneath the unpacked Mochi extension.</p>
          <p className="help-text" id="connection-consent">Request a connection, then open Mochi’s extension popup and explicitly approve <strong>{APP_ORIGIN}</strong>. Only activity after the first connection is imported; earlier pet progress and extension rules are kept.</p>
          {!authorityStarted && <p className="help-text">After first connecting, browser Focus supplies new rewards and goal progress. Manual and timer entries remain in history without extra rewards, including while tracking is paused or disconnected. This prevents overlapping rewards.</p>}
          <button className="adopt-button" type="submit" disabled={!props.canPersist || !originAllowed || sync.pending || sync.requesting}>
            {sync.pending ? 'Waiting for approval…' : sync.requesting ? 'Requesting connection…' : props.pet.extensionSync.pairing ? 'Reconnect in Brave' : 'Connect in Brave'}
          </button>
          {!originAllowed && <p className="field-error">Open this app at {APP_ORIGIN}. Other origins and ports are not allowed.</p>}
          {!props.canPersist && <p className="help-text">Connecting requires available local storage and safe coordination between app tabs.</p>}
          {!authorityStarted && props.pet.timer && <p className="help-text">Save or cancel your active focus timer before first connecting.</p>}
        </form>
      )}
      {sync.pending && <p className="connection-pending">Open Mochi’s popup in Brave now and approve the exact origin above. This request expires after two minutes.</p>}
      <p className="help-text" role="status" aria-live="polite" aria-atomic="true">{sync.notice}</p>
      <p className="help-text">Local connection only: no accounts or remote service. Category rules are managed in the extension’s settings; dashboard rules are kept separately.</p>
      {authorityStarted && <p className="tracking-authority-note">Browser tracking is the source for new Focus rewards and daily totals. Manual and timer entries still save to history, but do not add extra Focus XP, food credits, or focus progress—even while tracking is paused or disconnected. Intentional Rest entries still count.</p>}
    </section>
  )
}
