import { APP_ORIGIN } from '../../src/integration/localConfig.ts'

export interface PendingPairing {
  requestId: string
  challenge: string
  origin: string
  requestedAt: number
  expiresAt: number
  resumeEpochId: string | null
}
export interface ApprovedPairing {
  requestId: string
  challenge: string
  origin: string
  epochId: string
  token: string
  approvedAt: number
  cutoffAt: number | null
}
export const PAIRING_TTL_MS = 120_000
export const opaqueId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const instant = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime())

export function isPendingPairing(value: unknown): value is PendingPairing {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Partial<PendingPairing>
  return opaqueId(pair.requestId) && opaqueId(pair.challenge) && pair.challenge.length >= 16 && pair.origin === APP_ORIGIN &&
    instant(pair.requestedAt) && instant(pair.expiresAt) && pair.expiresAt > pair.requestedAt &&
    pair.expiresAt - pair.requestedAt <= PAIRING_TTL_MS && (pair.resumeEpochId === null || opaqueId(pair.resumeEpochId))
}

export function isApprovedPairing(value: unknown): value is ApprovedPairing {
  if (typeof value !== 'object' || value === null) return false
  const pair = value as Partial<ApprovedPairing>
  return opaqueId(pair.requestId) && opaqueId(pair.challenge) && pair.challenge.length >= 16 && pair.origin === APP_ORIGIN &&
    opaqueId(pair.epochId) && opaqueId(pair.token) && pair.token.length >= 36 && instant(pair.approvedAt) &&
    (pair.cutoffAt === null || instant(pair.cutoffAt))
}

export interface ExternalSender { id?: string; url?: string; origin?: string; frameId?: number; tab?: { incognito?: boolean } }
export function isAllowedWebSender(sender: ExternalSender): boolean {
  if (sender.id || sender.tab?.incognito || (sender.frameId !== undefined && sender.frameId !== 0)) return false
  try {
    return typeof sender.url === 'string' && new URL(sender.url).origin === APP_ORIGIN &&
      (sender.origin === undefined || sender.origin === APP_ORIGIN)
  } catch { return false }
}
