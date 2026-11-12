import type { SyncSummaryV2 } from './syncDomain.ts'

export type LiveTrackingStatus = 'Tracking off' | 'Tracking' | 'Paused' | 'Idle' | 'Browser unfocused' | 'No supported website'
export type SyncRequest =
  | { kind: 'pair-request'; requestId: string; challenge: string; resumeEpochId?: string }
  | { kind: 'pair-claim'; requestId: string; challenge: string }
  | { kind: 'activate'; token: string; epochId: string; reservedAt: number }
  | { kind: 'sync'; token: string; epochId: string }

export type SyncReply =
  | { kind: 'pending'; requestId: string }
  | { kind: 'approved'; extensionId: string; epochId: string; token: string; origin: string; cutoffAt: number | null }
  | { kind: 'snapshot'; epochId: string; cutoffAt: number; liveStatus: LiveTrackingStatus; checkedAt: number; summaries: SyncSummaryV2[] }
