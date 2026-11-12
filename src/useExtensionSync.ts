import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import type { PetAction, PetState } from './petState'
import { callExtension } from './integration/extensionTransport'
import type { SyncReply } from './integration/extensionTransport'
import { APP_ORIGIN } from './integration/localConfig'

type Snapshot = Extract<SyncReply, { kind: 'snapshot' }>
type Approval = Extract<SyncReply, { kind: 'approved' }>
interface CommitResult { pet: PetState; changed: boolean }
interface PendingConnection { extensionId: string; requestId: string; challenge: string; expiresAt: number }
interface LiveConnection { epochId: string; status: Snapshot['liveStatus']; receivedAt: number }

export interface ExtensionSyncProps {
  pet: PetState
  canPersist: boolean
  commitSync: (action: PetAction) => Promise<CommitResult>
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The connection could not be completed. Your saved progress is preserved.'

export function useExtensionSync({ pet, canPersist, commitSync }: ExtensionSyncProps) {
  const [pending, setPending] = useState<PendingConnection | null>(null)
  const [requesting, setRequesting] = useState(false)
  const [notice, setNotice] = useState('')
  const [live, setLive] = useState<LiveConnection | null>(null)
  const pairing = pet.extensionSync.pairing

  const acceptSnapshot = useCallback(async (extensionId: string, snapshot: Snapshot) => {
    const activated = await commitSync({ type: 'sync-activate', epochId: snapshot.epochId, extensionId, cutoffAt: snapshot.cutoffAt })
    if (activated.pet.extensionSync.pairing?.epochId !== snapshot.epochId ||
        activated.pet.extensionSync.pairing.extensionId !== extensionId ||
        activated.pet.extensionSync.pairing.cutoffAt !== snapshot.cutoffAt) throw new Error('The connection changed in another tab. Reconnect to continue safely.')
    const now = Date.now()
    const saved = await commitSync({ type: 'sync-ingest', epochId: snapshot.epochId, snapshots: snapshot.summaries, now })
    if (saved.pet.extensionSync.pairing?.epochId !== snapshot.epochId || saved.pet.extensionSync.lastSuccessfulSyncAt === null ||
        saved.pet.extensionSync.lastSuccessfulSyncAt < now) throw new Error('This synchronization could not be saved. Your previous progress is preserved.')
    return { epochId: snapshot.epochId, status: snapshot.liveStatus, receivedAt: Date.now() }
  }, [commitSync])

  const finishApproval = useEffectEvent(async (approval: Approval) => {
    if (!canPersist) throw new Error('Available local storage is required before connecting. Existing progress is preserved.')
    if (approval.origin !== APP_ORIGIN) throw new Error('The approved origin does not match this app.')
    const previous = pet.extensionSync.pairing
    const reservedAt = previous?.epochId === approval.epochId && previous.extensionId === approval.extensionId
      ? previous.reservedAt : Date.now()
    const reserved = await commitSync({ type: 'sync-reserve', pairing: {
      extensionId: approval.extensionId, epochId: approval.epochId, token: approval.token,
      origin: approval.origin, reservedAt,
    } })
    const durable = reserved.pet.extensionSync.pairing
    if (!durable || durable.epochId !== approval.epochId || durable.extensionId !== approval.extensionId || durable.token !== approval.token) {
      throw new Error('Save or cancel your existing timer before connecting. The connection was not activated.')
    }
    const snapshot = await callExtension(durable.extensionId, { kind: 'activate', token: durable.token, epochId: durable.epochId, reservedAt: durable.reservedAt })
    if (snapshot.kind !== 'snapshot' || snapshot.epochId !== durable.epochId) throw new Error('The extension did not activate this connection.')
    return acceptSnapshot(durable.extensionId, snapshot)
  })

  async function connect(extensionId: string) {
    if (requesting || pending) return
    setNotice('')
    if (window.location.origin !== APP_ORIGIN) { setNotice(`Open Mochi at ${APP_ORIGIN} to connect. This exact origin is required.`); return }
    if (!/^[a-p]{32}$/.test(extensionId)) { setNotice('Copy the 32-letter Mochi extension ID from brave://extensions.'); return }
    if (!canPersist) { setNotice('The connection needs available local storage and safe sharing between tabs.'); return }
    if (pet.extensionSync.authorityStartedAt === null && pet.timer) { setNotice('Save or cancel your active focus timer before first connecting.'); return }
    setRequesting(true)
    setLive(null)
    const requestId = crypto.randomUUID(), challenge = crypto.randomUUID()
    try {
      const reply = await callExtension(extensionId, { kind: 'pair-request', requestId, challenge,
        ...(pairing?.extensionId === extensionId ? { resumeEpochId: pairing.epochId } : {}),
      })
      if (reply.kind !== 'pending' || reply.requestId !== requestId) throw new Error('The extension did not accept this connection request.')
      setPending({ extensionId, requestId, challenge, expiresAt: Date.now() + 120_000 })
    } catch (error) { setNotice(errorMessage(error)) }
    finally { setRequesting(false) }
  }

  useEffect(() => {
    if (!pending) return
    let cancelled = false
    let timeout: number | undefined
    async function claim() {
      try {
        if (Date.now() > pending!.expiresAt) throw new Error('The approval request expired. Request a connection again, then approve it in the Brave extension popup.')
        const reply = await callExtension(pending!.extensionId, { kind: 'pair-claim', requestId: pending!.requestId, challenge: pending!.challenge })
        if (cancelled) return
        if (reply.kind === 'pending' && reply.requestId === pending!.requestId) {
          timeout = window.setTimeout(() => void claim(), 2000)
          return
        }
        if (reply.kind !== 'approved') throw new Error('The extension returned an unexpected approval response.')
        const verified = await finishApproval(reply)
        if (cancelled) return
        setLive(document.hidden ? null : verified)
        setNotice('Connection approved. Browser activity is now syncing automatically.')
        setPending(null)
      } catch (error) {
        if (!cancelled) { setNotice(errorMessage(error)); setPending(null); setLive(null) }
      }
    }
    void claim()
    return () => { cancelled = true; window.clearTimeout(timeout) }
  }, [pending])

  const extensionId = pairing?.extensionId, epochId = pairing?.epochId, token = pairing?.token, reservedAt = pairing?.reservedAt, cutoffAt = pairing?.cutoffAt
  useEffect(() => {
    if (!canPersist || !pet.adopted || pending || requesting || !extensionId || !epochId || !token || reservedAt === undefined) return
    let cancelled = false
    let inFlight = false
    let timeout: number | undefined
    async function sync() {
      if (cancelled || document.hidden || inFlight) return
      inFlight = true
      try {
        // Activation is idempotent and recovers a refresh between reservation and activation.
        const reply = await callExtension(extensionId!, cutoffAt === null
          ? { kind: 'activate', epochId: epochId!, token: token!, reservedAt: reservedAt! }
          : { kind: 'sync', epochId: epochId!, token: token! })
        if (cancelled) return
        if (reply.kind !== 'snapshot' || reply.epochId !== epochId) throw new Error('This extension connection is no longer active. Reconnect for approval.')
        const verified = await acceptSnapshot(extensionId!, reply)
        if (!cancelled) { setLive(document.hidden ? null : verified); setNotice('') }
      } catch (error) {
        if (!cancelled) { setLive(null); setNotice(errorMessage(error)) }
      } finally {
        inFlight = false
        if (!cancelled && !document.hidden) timeout = window.setTimeout(() => void sync(), 5000)
      }
    }
    function visibility() {
      window.clearTimeout(timeout)
      if (document.hidden) setLive(null)
      else void sync()
    }
    void sync()
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('focus', visibility)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('focus', visibility)
    }
  }, [acceptSnapshot, canPersist, pet.adopted, pending, requesting, extensionId, epochId, token, reservedAt, cutoffAt])

  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now()
      setLive((previous) => previous && now - previous.receivedAt > 15_000 ? null : previous)
    }, 1000)
    return () => window.clearInterval(interval)
  }, [])

  const connected = Boolean(canPersist && !requesting && !pending && live && live.epochId === pairing?.epochId)
  return { connected, liveStatus: connected ? live!.status : null, pending: Boolean(pending), requesting, notice, connect }
}
