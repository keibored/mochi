import type { SyncSummaryV2 } from './syncDomain.ts'
import type { REQUIRED_SYNC_CAPABILITIES } from './localConfig.ts'

/** Receiver identity comes from runtime.getManifest and bundled code, never
 * saved preferences. This metadata is not evidence of an approved connection.
 */
export interface ExtensionBuildInfo {
  version: string
  catalogVersion: string
  capabilities: (typeof REQUIRED_SYNC_CAPABILITIES)[number][]
}

export type LiveTrackingStatus = 'Tracking off' | 'Tracking' | 'Paused' | 'Idle' | 'Browser unfocused' | 'No supported website'
export type SyncRequest =
  | { kind: 'pair-request'; requestId: string; challenge: string; resumeEpochId?: string }
  | { kind: 'pair-claim'; requestId: string; challenge: string }
  | { kind: 'activate'; token: string; epochId: string; reservedAt: number }
  | { kind: 'sync'; token: string; epochId: string }

export type SyncPayload =
  | { kind: 'pending'; requestId: string }
  | { kind: 'approved'; extensionId: string; epochId: string; token: string; origin: string; cutoffAt: number | null }
  | { kind: 'snapshot'; epochId: string; cutoffAt: number; liveStatus: LiveTrackingStatus; checkedAt: number; summaries: SyncSummaryV2[] }

/** The web transport attaches validated envelope metadata to every reply. */
export type SyncReply = SyncPayload & { extensionInfo: ExtensionBuildInfo }
