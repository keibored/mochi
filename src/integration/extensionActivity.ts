import type { WebsiteCategory } from '../websiteRules.ts'

/** Legacy category-summary header retained in extension-local storage.
 * The implemented live bridge uses cumulative SyncSummaryV2 revisions from
 * syncDomain.ts instead of replaying these mutable drafts as immutable events.
 * See docs/extension-integration.md for validation and reward-authority rules.
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
