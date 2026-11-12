import { APP_ORIGIN, SYNC_PROTOCOL, SYNC_PROTOCOL_VERSION } from './localConfig.ts'
import { parseSyncSummary } from './syncDomain.ts'
import type { SyncReply, SyncRequest } from './syncProtocol'

export type { SyncReply, SyncRequest } from './syncProtocol'

interface ChromiumRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void
  lastError?: { message?: string }
}

function parseReply(value: unknown, extensionId: string): SyncReply {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid extension response.')
  const envelope = value as Record<string, unknown>
  if (envelope.protocol !== SYNC_PROTOCOL || envelope.version !== SYNC_PROTOCOL_VERSION) throw new Error('Extension protocol mismatch. Rebuild and reload Mochi in Brave.')
  if (envelope.ok !== true) throw new Error(typeof envelope.error === 'string' ? envelope.error : 'Extension rejected the request.')
  if (typeof envelope.payload !== 'object' || envelope.payload === null) throw new Error('Missing extension response.')
  const reply = envelope.payload as Record<string, unknown>
  if (reply.kind === 'pending' && typeof reply.requestId === 'string') return { kind: 'pending', requestId: reply.requestId }
  if (reply.kind === 'approved' && reply.extensionId === extensionId && reply.origin === APP_ORIGIN &&
      typeof reply.epochId === 'string' && typeof reply.token === 'string' && reply.token.length >= 36 &&
      (reply.cutoffAt === null || (Number.isSafeInteger(reply.cutoffAt) && (reply.cutoffAt as number) >= 0))) {
    return { kind: 'approved', extensionId, epochId: reply.epochId, token: reply.token, origin: APP_ORIGIN, cutoffAt: reply.cutoffAt as number | null }
  }
  const statuses = ['Tracking off', 'Tracking', 'Paused', 'Idle', 'Browser unfocused', 'No supported website']
  if (reply.kind === 'snapshot' && typeof reply.epochId === 'string' && Number.isSafeInteger(reply.cutoffAt) &&
      (reply.cutoffAt as number) >= 0 && Number.isSafeInteger(reply.checkedAt) && (reply.checkedAt as number) >= (reply.cutoffAt as number) &&
      typeof reply.liveStatus === 'string' && statuses.includes(reply.liveStatus) && Array.isArray(reply.summaries) && reply.summaries.length <= 64) {
    return { kind: 'snapshot', epochId: reply.epochId, cutoffAt: reply.cutoffAt as number,
      liveStatus: reply.liveStatus as Extract<SyncReply, { kind: 'snapshot' }>['liveStatus'], checkedAt: reply.checkedAt as number,
      summaries: reply.summaries.map(parseSyncSummary) }
  }
  throw new Error('Invalid extension response. No progress was imported.')
}

/** Direct Chromium external messaging. No window-message listener, content
 * script bridge, network endpoint, or browser-global discovery of extension IDs.
 */
export function callExtension(extensionId: string, request: SyncRequest): Promise<SyncReply> {
  if (window.location.origin !== APP_ORIGIN) return Promise.reject(new Error(`Open Mochi at ${APP_ORIGIN}. Other origins and ports are not allowed.`))
  if (!/^[a-p]{32}$/.test(extensionId)) return Promise.reject(new Error('Copy the 32-letter Mochi extension ID from brave://extensions.'))
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: ChromiumRuntime } }).chrome?.runtime
  if (!runtime?.sendMessage) return Promise.reject(new Error('Brave extension messaging is unavailable here. Rebuild and reload the extension, then refresh this exact app tab.'))
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The Brave extension did not respond. Reload it and reconnect.')), 5000)
    try {
      runtime.sendMessage(extensionId, { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ...request }, (response) => {
        window.clearTimeout(timeout)
        if (runtime.lastError) { reject(new Error('Could not reach Mochi in Brave. Verify its extension ID, reload it, and refresh this tab.')); return }
        try { resolve(parseReply(response, extensionId)) } catch (error) { reject(error) }
      })
    } catch { window.clearTimeout(timeout); reject(new Error('Brave could not send the extension request. Reload the extension and refresh this tab.')) }
  })
}
