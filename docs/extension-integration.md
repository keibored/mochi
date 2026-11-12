# Future browser activity integration

This is a design boundary, not an implemented connection. Mochi's primary experience will be a pet that reacts to browser activity from a companion Chrome extension. The main web dashboard is being prepared first; the optional timer and manual logger remain useful independent tools. There is no extension, receiver, backend, connect action, or automatic detection in this increment.

## Planned flow

Extension → validated activity ingestion → existing reward logic → dashboard.

The proposed TypeScript wire contract is `src/integration/extensionActivity.ts`. Each version-1 event contains a globally unique stable `eventId`, literal source `extension`, category (Focus, Leisure, Neutral), UTC ISO start/end timestamps for a half-open interval, integer `activeDurationMs` in milliseconds, IANA `timeZone`, and `localDate` in YYYY-MM-DD form. Events aggregate time by category, not individual page visits. Rest remains intentional and must never be inferred from idle browser time.

## Collection and privacy requirements

- Count only the active tab in the focused browser window while the user is active. Multiple windows must never multiply counted time.
- Stop accumulation immediately when idle, paused, or the browser loses focus. Do not label those gaps Rest.
- Apply user-defined exact-hostname rules inside the extension; unknown sites are Neutral. Subdomains require separate rules. Do not hard-code website intent.
- Split aggregates at local calendar midnight using the event's IANA timezone, including daylight-saving transitions. Flush/restart the aggregate when timezone or category changes. Ingestion must verify that each event belongs to one local day; do not use UTC date slicing or fixed 24-hour arithmetic for local midnight.
- Sync only category/time aggregates. Do not transmit page contents, page titles, full URLs, hostname visit lists, or browsing history. Website-category rules are explicit user settings, separate from activity telemetry.

## Ingestion requirements before enabling a connection

- Build an authenticated, origin- and sender-validated transport. Do not add an unauthenticated public `message` listener. A local toggle, stored activities, or rule settings must never establish connection/tracking/paused state; those states require a real integration handshake and live lifecycle messages.
- Validate the schema version and exact source, category, stable event ID, ISO timestamps, positive integer millisecond duration (no greater than the interval), valid IANA timezone, and consistent local date. Reject unsupported fields/versions and implausible or inconsistent intervals. A TypeScript interface alone is not runtime validation.
- Persist an accepted-event ledger and activity/reward updates atomically under the existing shared progress lock (or a server transaction in a later backend). Retrying the same event ID must never add time or rewards again. The same ID with different contents is a conflict, not another event.
- Retain sub-minute millisecond remainders per local day; never round each incoming event up. Adapt accumulated eligible Focus time to the existing 15-minute reward blocks and 240-minute daily cap without losing remainders or re-awarding earlier blocks. Current manual/timer reward behavior remains unchanged until ingestion is implemented.

## Overlap and reward authority policy to implement

Current Manual entries describe self-reported minutes, not reliable start/end intervals, so their timestamps must not be treated as proof that they do or do not overlap tracked time. Existing saved balances must never be replayed or reduced.

Before accepting the first tracked event, establish a persisted, verified reward-authority cutoff. Resolve any active timer (save or cancel it with the user's direction) before activating that cutoff. Accept extension events only at or after it. Prior activities and balances remain intact.

During the extension-authoritative period, only validated extension Focus aggregates earn new focus rewards. Manual and Timer tools may record time, but must clearly explain that they do not add reward-eligible focus during this period. This conservative policy prevents double rewards without inventing intervals for manual entries. Source totals must stay distinguishable so overlapping self-reports do not inflate the primary tracked summary or goal progress.

Pausing, losing a connection, or having buffered events must not automatically switch reward authority back to manual/timer. Any future transition back needs an explicit persisted cutoff and reconciliation of buffered event IDs before local tools can earn rewards again. Document and test those transitions before connecting the extension. None of this authority switching or ingestion is implemented now; current manual/timer entries continue earning their existing rewards.

## Current hostname settings

Users can add, edit, and remove rules in the web app. They are saved in the existing versioned progress record using the same cross-tab coordination as the timer. Normalization accepts a hostname or HTTP(S) URL, canonicalizes case and internationalized domain names, removes a trailing DNS dot, and discards paths, query strings, fragments and URL ports. Credentials, unsupported protocols, invalid DNS labels, and duplicate normalized hostnames are rejected. IP literals and localhost are supported; a port requires a full HTTP(S) URL. No seeded website rules are supplied.

Rules match exact normalized hostnames only. `example.com` does not include `www.example.com`, `work.example.com`, or `notexample.com`; no parent-domain precedence is needed. Unknown sites are Neutral. Rule edits affect only future categorization, never existing activities, XP, spent credits, goals, or active timers.

## Branch dependency

`feature/tracking-dashboard` is stacked on `feature/focus-timer` at commit `233bb7d` and depends on timer PR [#1](https://github.com/keibored/mochi/pull/1), which was open and unmerged when this branch was created. Its PR targets `feature/focus-timer` so the diff contains only the tracking-dashboard increment. Leave both PRs unmerged for review. After PR #1 is merged, retarget the tracking-dashboard PR to `main` and reconcile its base before merging; do not duplicate the timer changes or silently discard them.
