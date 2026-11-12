# Local Brave activity integration

Mochi's main experience is a web pet reacting to browser activity from its companion extension. This increment implements a local connection between the existing Manifest V3 extension in **Brave** and the app at the exact origin **`http://localhost:5173`**. Manual logging and the focus timer remain optional. There is no backend, account, content-script bridge, or remote sync service.

Implemented flow:

**Extension → authenticated, validated category/time ingestion → existing reward rules → dashboard.**

The earlier version-1 shape in `src/integration/extensionActivity.ts` is a legacy/proposed immutable summary boundary. Live synchronization uses the separate **`SyncSummaryV2`** runtime-validated contract in `src/integration/syncDomain.ts` and request/reply types in `syncProtocol.ts`. Mutable current-day drafts are not retried as immutable version-1 events.

## Connection and lifecycle

1. The user enters the existing unpacked extension's `[a-p]{32}` ID in the dashboard and requests a connection. The extension ID is also displayed in its popup. The app uses direct callback-style `chrome.runtime.sendMessage(extensionId, request, callback)`.
2. A random request ID and challenge bind the request. Pending requests expire after **120 seconds**. The extension popup displays the exact origin and requires explicit approval or rejection. Its approval capability is available only to bundled extension pages, not the web request.
3. Approval alone does not activate ingestion, enable tracking, or resume a paused tracker. The enabled/paused preference stays unchanged. A real connection can correctly report Tracking off or Paused.
4. Before first activation, the user saves or cancels any active timer. Under the existing Web Lock, the app durably reserves reward authority and captures all already-present Focus totals as the one-time baseline. Existing balances remain authoritative and are never replayed or reduced.
5. The app requests activation using its durable reservation. The extension seals old drafts, establishes the synchronization cutoff, and starts new epoch-tagged aggregates. Pre-activation totals remain in the popup but are not sent for retroactive reward ingestion.
6. The app validates the activated cutoff and ingests current-epoch snapshots under its progress lock. Only an actual response followed by successful durable ingestion creates a live connected state and updates last successful sync.
7. While visible, the app requests snapshots about every **five seconds**; returning to the tab triggers a check. Normal reload reuses the saved token and can recover reservation/activation interrupted by a refresh. No new approval is required for an intact pairing.

Same-epoch explicit reapproval rotates the token while keeping the original cutoff, buffered summaries, accepted ledger, and reward baseline. A new epoch preserves previously accepted web progress and the baseline, but imports only its own post-cutoff summaries. The previous popup-only history is not replayed.

Live state is ephemeral and becomes unverified after an error, when the app is hidden, or when its verified response is older than **15 seconds**. Last successful sync is historical, not evidence of a currently running tracker. Stored pairings, activity, rules, or a user-controlled toggle never establish connection status.

## Transport and validation boundary

The [Chrome external-webpage messaging API](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#external-webpage) is used directly. The worker registers `runtime.onMessageExternal` synchronously and retains asynchronous callback replies with a literal `return true` plus `sendResponse`. There is no public `window` message listener, injected script, content script, HTTP receiver, or extension discovery endpoint.

The manifest's [`externally_connectable`](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable) pattern permits `http://localhost/*`; match patterns do not encode the port. Therefore the worker separately validates **`http://localhost:5173`** from the browser-supplied sender URL/origin. Other hostnames, schemes, and ports are rejected. The app transport also checks its own exact origin. Vite uses `port: 5173` and `strictPort: true` so development cannot silently move to a different origin.

External validation rejects other extension senders, incognito senders, child-frame sender information, unsupported protocol/version/kind/fields, expired or mismatched request challenges, and missing or incorrect pairing tokens/epochs. Popup commands use the existing bundled-page sender checks and the popup-only approval capability. Internal report/settings commands are not exposed externally. Public failures do not include saved tokens or raw progress records.

Only explicit category/time DTOs are returned to the app. External replies never include hostname metadata, full URLs, page titles, page contents, website rules, or visit history. The extension's bundled-only CSP and `connect-src 'none'` remain in force. Authentication here scopes the local bridge to the approved origin/installation; it is not a server account or a defense against malicious code already running in that trusted app origin or manual editing of browser storage.

## Version-2 summary contract

| Field | Meaning |
| --- | --- |
| `schemaVersion: 2` | Version of the transmitted summary schema. |
| `source: 'extension'` | Literal browser source, distinct from existing Manual/Timer activities. |
| `epochId` | Approved activation epoch. Only the currently active epoch may ingest new summaries. |
| `eventId` | Stable aggregate identity for retry/refresh/cross-tab deduplication. |
| `revision` | Positive monotonic cumulative revision for that event. |
| `category` | Focus, Leisure, or Neutral. Rest is intentionally logged, never inferred. |
| `startedAtIso`, `endedAtIso` | Canonical UTC ISO bounds of a half-open aggregate interval. Bounds can include inactive gaps. |
| `activeDurationMs` | Positive safe integer milliseconds of counted eligible time, no greater than the enclosing interval. |
| `timeZone` | IANA timezone used when the aggregate was created. |
| `localDate` | Original local calendar date in `YYYY-MM-DD` form. |
| `finalized` | Whether the aggregate is closed and immutable. |

Runtime validation checks exact keys, literals, IDs, integer ranges, ISO timestamps, timezone validity, local-day consistency, cutoff/epoch membership, and bounds not extending past ingestion. Unsupported fields and versions are rejected rather than ignored. The whole batch succeeds atomically or leaves prior data unchanged.

For an existing event ID:

- An identical revision is a no-op; conflicting contents at that revision are rejected.
- A consistent older revision cannot reduce or add accepted totals.
- A newer revision must retain identity/category/start/day/timezone, and may only increase duration/end bounds or finalize the aggregate.
- A finalized aggregate cannot subsequently change. Reopening a previously closed local day creates a new ID.

The accepted ledger is retained across reconnects and written with XP/credit changes in one versioned web record under the shared Web Lock. A late response from another pairing epoch is rejected even when its snapshot list is empty. Extension event processing and storage writes also use one serialized worker queue.

## Collection, calendar, and privacy rules

- Count only the active tab in the actually focused normal browser window while tracking is enabled, unpaused, and the user is active. Multiple windows/tabs never multiply counted time.
- Stop accumulation on idle/locked, pause, or lost browser focus. Internal, unsupported, loading, and incognito pages do not count. No gap is automatically labeled Rest.
- Apply user-authored exact-hostname categories in the extension. Unknown sites are Neutral. Do not assume that any named website always implies Focus or Leisure.
- Split intervals at local midnight with calendar arithmetic, respecting DST rather than slicing UTC dates or assuming 24-hour local days. Timezone changes drop the uncertain tail and start a new timezone/day aggregate. Ingestion verifies one original local day per summary.
- Aggregate by category/day/timezone, not page visits. Only user-authored rules persist hostnames. Sync sends no rule list, URL, hostname visit list, title, page contents, or browsing history.

Worker restarts and unconfirmed gaps are not proof of ongoing activity. The current implementation deliberately drops unconfirmed restart tails, gaps over 45 seconds, backwards clocks, and wall/monotonic discrepancies over two seconds. Idle has a 60-second grace period, and alarms may be delayed. These are local activity estimates, not verified work. See [extension accounting details](../extension/README.md).

## Reward authority and overlap policy

Manual entries describe self-reported minutes, not reliable start/end intervals. Their timestamps do not prove that they avoid tracked time. Existing XP and spent credits must not be recalculated during migration or pairing.

The first durable reservation captures **all already-saved Focus activities** as the baseline, including equality at the reservation millisecond or timestamps affected by clock changes. The initial active timer must be resolved by the user first. Extension acceptance begins no earlier than its activated cutoff; the short reserve-to-activate gap is not backfilled.

Reward calculations use the captured Focus baseline plus accepted extension Focus milliseconds per original local date. They award only the difference in completed **15-minute blocks**, at **5 XP and 2 credits** each, capped at **240 Focus minutes/day**, including the baseline. Millisecond remainders carry across revisions and summaries without rounding. Leisure and Neutral grant no rewards and never subtract them. Feeding still subtracts exactly 2 credits without changing XP.

Once authority is reserved, Manual and Timer entries remain available and save accurately labeled history, but cannot add extra Focus rewards or inflate primary Focus goal progress. The dashboard's primary Focus total is the captured baseline plus accepted browser Focus. Other primary category totals combine earlier saved entries with synced categories; intentional manual Rest continues to count. Goal edits never recalculate rewards.

Pause, disconnect, missing messages, and buffered activity **never switch reward authority back** to local tools. This remains true if activation was interrupted after reservation. There is no automatic or implicit reset. A future switch back would need a separately specified persisted cutoff and buffered-event reconciliation before local tools could earn again.

## Persistence, compatibility, and rule ownership

The web record migrates from version 4 to **version 5** under `mochi.progress`, preserving adoption, XP, spent credits, activities/IDs/timestamps/notes/source labels, goals, rules, and the entire timer session. Older supported versions still use their structural migrations. The new fields hold pairing, authority/baseline, accepted summaries, and last successful sync. Migration never imports extension time or replays rewards.

Extension state migrates from version 1 to **version 2** under the unchanged `mochi.extension.v1` key. Existing enable/pause preferences, rules, aggregates, event IDs, and checkpoint survive. Older extension aggregates stay local until retention; first activation cannot retroactively reward them.

Both surfaces validate storage and preserve malformed/unsupported records rather than overwriting them. Sync requires durable storage and Web Locks. A failed durable save cannot establish a successful sync or fall back to in-memory rewards. The extension retains seven days/64 aggregates/200 rules, so unsynced activity can expire. Already accepted web progress is independent of extension retention. The web ledger can eventually reach localStorage limits; there is no backend backup or cross-device sync.

Dashboard rules and extension rules intentionally remain separate. Normalization accepts a hostname or HTTP(S) URL; it canonicalizes case/IDNs, removes trailing DNS dots, and discards paths, queries, fragments, and URL ports. Unsupported protocols, credentials, invalid DNS labels, and normalized duplicates are rejected. IP literals/localhost are supported; a port requires a full HTTP(S) URL. Rules match exact hostnames only: `example.com` does not include `www.example.com`, `work.example.com`, or `notexample.com`. No parent-domain precedence or default website intent is assumed. Edits affect only future classification and never reclassify old entries or replay rewards.

## Reproduction and verification

Exact commands, folder, and approval steps are in [README.md](../README.md#rebuild-reload-and-connect-in-brave) and the [extension guide](../extension/README.md). Rebuild with `npm.cmd run build:extension`, reload the **existing** installation at `brave://extensions`, refresh `http://localhost:5173/`, enter its ID, request the connection, and approve that exact origin in the popup. Explicitly enable/resume tracking if needed; approval preserves that preference.

Test two user-classified sites, actual tracking states, refresh/token restoration, concurrent tabs/retries, baseline/cap rewards, intentional Rest, optional-tool overlap, and persisted category rules. Relevant commands are `npm test`, `npm run test:extension`, `npm run lint`, `npm run build`, `npm run build:extension`, and `git diff --check` (use `npm.cmd` in PowerShell when needed).

The user has verified the earlier extension's categories and paused popup manually in Brave. The **new local sync bridge has no real-browser verification in this environment**. Unit and mocked API tests cannot prove actual Brave external delivery, popup approval, keyboard/layout behavior, or end-to-end reward updates. Do not present this documentation's manual checklist as completed testing.

## Branch dependency and later scope

`feature/extension-dashboard-sync` is based on `feature/browser-tracking` and targets it while [PR #3](https://github.com/keibored/mochi/pull/3) remains unmerged. That branch depends on [tracking dashboard PR #2](https://github.com/keibored/mochi/pull/2) and [timer PR #1](https://github.com/keibored/mochi/pull/1). Leave all existing PRs unmerged for review; reconcile/retarget after parent merges instead of duplicating or discarding their changes.

Backend/accounts, device sync, automatic rule synchronization, production-origin configuration, and distribution remain later work. This increment implements only the local approved Brave-to-main-web-app connection.
