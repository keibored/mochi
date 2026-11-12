import type { WebsiteCategory } from '../websiteRules.ts'

/** Proposed immutable wire contract; reused for extension-local aggregates.
 * Current-day drafts must not be sent as immutable events. No web receiver,
 * connection state, or reward ingestion is implemented. See docs/extension-integration.md for validation, privacy,
 * local-day splitting and reward-authority requirements before accepting data.
 */
export interface ExtensionActivitySummaryV1 {
  schemaVersion: 1
  /** Globally unique, stable across retries; never regenerate on delivery. */
  eventId: string
  source: 'extension'
  /** Rest is intentional, not inferred from idle browser time. */
  category: WebsiteCategory
  /** UTC ISO-8601 strings delimiting a half-open interval [start, end). */
  startedAtIso: string
  endedAtIso: string
  /** Integer milliseconds, > 0 and <= the interval's wall-clock duration. */
  activeDurationMs: number
  /** IANA timezone used to split this aggregate at local midnight. */
  timeZone: string
  /** YYYY-MM-DD within timeZone. Each event belongs to exactly one local day. */
  localDate: string
}
