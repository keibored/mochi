import { APP_ORIGIN, MIN_SYNC_EXTENSION_VERSION, REQUIRED_SYNC_CAPABILITIES, SYNC_PROTOCOL, SYNC_PROTOCOL_VERSION } from './localConfig.ts'
import { WEBSITE_CATALOG_VERSION } from '../websiteCatalog.ts'
import { parseSyncSummary } from './syncDomain.ts'
import type { ExtensionBuildInfo, SyncReply, SyncRequest } from './syncProtocol'

export type { ExtensionBuildInfo, SyncReply, SyncRequest } from './syncProtocol'
export type ExtensionErrorCode = 'wrong-origin' | 'invalid-id' | 'unavailable' | 'timeout' | 'incompatible' | 'rejected' | 'invalid-response' | 'approval-expired' | 'storage' | 'lost'

export class ExtensionConnectionError extends Error {
  readonly code: ExtensionErrorCode
  constructor(code: ExtensionErrorCode, message: string) {
    super(message)
    this.name = 'ExtensionConnectionError'
    this.code = code
  }
}

export const EXTENSION_RELOAD_HELP = `Run npm.cmd run build:extension in the Mochi project, reload the existing Mochi extension at brave://extensions (version ${MIN_SYNC_EXTENSION_VERSION} or newer), then refresh ${APP_ORIGIN}/. Keep the same extension ID and saved data.`

interface ChromiumRuntime {
  sendMessage(extensionId: string, message: unknown, callback: (response: unknown) => void): void
  lastError?: { message?: string }
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())
const incompatible = (reason: string) => new ExtensionConnectionError('incompatible', `${reason} ${EXTENSION_RELOAD_HELP}`)
const invalid = () => new ExtensionConnectionError('invalid-response', 'Mochi returned an invalid response. No progress was imported. Rebuild and reload the extension, then refresh this app.')

function compatibleVersion(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/.test(value)) return false
  const parts = value.split('.').map(Number)
  if (parts.some((part) => part > 65535)) return false
  const minimum = MIN_SYNC_EXTENSION_VERSION.split('.').map(Number)
  for (let index = 0; index < 4; index++) {
    const difference = (parts[index] ?? 0) - (minimum[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return true
}

/** Fail closed before approval can reserve reward authority or activate sync.
 * A version label alone is insufficient: require the bundled catalog revision
 * and both implemented capabilities, with no arbitrary metadata fields.
 */
function parseBuildInfo(value: unknown): ExtensionBuildInfo {
  const capabilities = record(value) ? value.capabilities : null
  if (!record(value) || !exactKeys(value, ['version', 'catalogVersion', 'capabilities']) ||
      !compatibleVersion(value.version) || value.catalogVersion !== WEBSITE_CATALOG_VERSION ||
      !Array.isArray(capabilities) || capabilities.length !== REQUIRED_SYNC_CAPABILITIES.length ||
      !REQUIRED_SYNC_CAPABILITIES.every((capability) => capabilities.includes(capability))) {
    throw incompatible('The extension build does not support this dashboard’s automatic classification and revisioned sync.')
  }
  return { version: value.version, catalogVersion: WEBSITE_CATALOG_VERSION, capabilities: [...REQUIRED_SYNC_CAPABILITIES] }
}

function parseReply(value: unknown, extensionId: string): SyncReply {
  if (!record(value)) throw invalid()
  if (value.protocol !== SYNC_PROTOCOL || value.version !== SYNC_PROTOCOL_VERSION) {
    throw incompatible('The installed receiver uses an older or incompatible Mochi sync protocol.')
  }
  const extensionInfo = parseBuildInfo(value.extensionInfo)
  if (value.ok === false && exactKeys(value, ['protocol', 'version', 'extensionInfo', 'ok', 'error']) && typeof value.error === 'string') {
    throw new ExtensionConnectionError('rejected', value.error.slice(0, 500))
  }
  if (value.ok !== true || !exactKeys(value, ['protocol', 'version', 'extensionInfo', 'ok', 'payload']) || !record(value.payload)) throw invalid()
  const reply = value.payload
  if (reply.kind === 'pending' && exactKeys(reply, ['kind', 'requestId']) && identifier(reply.requestId)) {
    return { kind: 'pending', requestId: reply.requestId, extensionInfo }
  }
  if (reply.kind === 'approved' && exactKeys(reply, ['kind', 'extensionId', 'epochId', 'token', 'origin', 'cutoffAt']) &&
      reply.extensionId === extensionId && reply.origin === APP_ORIGIN && identifier(reply.epochId) &&
      typeof reply.token === 'string' && /^[A-Za-z0-9_-]{36,256}$/.test(reply.token) &&
      (reply.cutoffAt === null || timestamp(reply.cutoffAt))) {
    return { kind: 'approved', extensionId, epochId: reply.epochId, token: reply.token, origin: APP_ORIGIN, cutoffAt: reply.cutoffAt, extensionInfo }
  }
  const statuses = ['Tracking off', 'Tracking', 'Paused', 'Idle', 'Browser unfocused', 'No supported website']
  if (reply.kind === 'snapshot' && exactKeys(reply, ['kind', 'epochId', 'cutoffAt', 'liveStatus', 'checkedAt', 'summaries']) &&
      identifier(reply.epochId) && timestamp(reply.cutoffAt) && timestamp(reply.checkedAt) && reply.checkedAt >= reply.cutoffAt &&
      typeof reply.liveStatus === 'string' && statuses.includes(reply.liveStatus) && Array.isArray(reply.summaries) && reply.summaries.length <= 64) {
    return { kind: 'snapshot', epochId: reply.epochId, cutoffAt: reply.cutoffAt,
      liveStatus: reply.liveStatus as Extract<SyncReply, { kind: 'snapshot' }>['liveStatus'], checkedAt: reply.checkedAt,
      summaries: reply.summaries.map(parseSyncSummary), extensionInfo }
  }
  throw invalid()
}

/** Direct Chromium external messaging. No window-message listener, content
 * script bridge, network endpoint, or browser-global discovery of extension IDs.
 */
export function callExtension(extensionId: string, request: SyncRequest): Promise<SyncReply> {
  if (window.location.origin !== APP_ORIGIN) return Promise.reject(new ExtensionConnectionError('wrong-origin', `Open Mochi at ${APP_ORIGIN}/. Other origins and ports are not allowed; return to that exact Brave tab before connecting.`))
  if (!/^[a-p]{32}$/.test(extensionId)) return Promise.reject(new ExtensionConnectionError('invalid-id', 'Copy the 32-letter Mochi extension ID from brave://extensions in the same Brave profile.'))
  const runtime = (globalThis as typeof globalThis & { chrome?: { runtime?: ChromiumRuntime } }).chrome?.runtime
  if (!runtime?.sendMessage) return Promise.reject(new ExtensionConnectionError('unavailable', `Brave extension messaging is unavailable in this tab. ${EXTENSION_RELOAD_HELP}`))
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      reject(new ExtensionConnectionError('timeout', `Mochi’s extension did not respond within five seconds. ${EXTENSION_RELOAD_HELP}`))
    }, 5000)
    function finish(error: unknown, reply?: SyncReply) {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      if (error) reject(error)
      else resolve(reply!)
    }
    try {
      runtime.sendMessage(extensionId, { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ...request }, (response) => {
        // Read lastError even for a late callback, so Chromium considers it handled.
        const runtimeError = runtime.lastError
        if (settled) return
        if (runtimeError) { finish(new ExtensionConnectionError('unavailable', `Could not reach Mochi in Brave. Check the exact extension ID in the same profile. ${EXTENSION_RELOAD_HELP}`)); return }
        try { finish(null, parseReply(response, extensionId)) } catch (error) { finish(error) }
      })
    } catch { finish(new ExtensionConnectionError('unavailable', `Brave could not send the extension request. ${EXTENSION_RELOAD_HELP}`)) }
  })
}
