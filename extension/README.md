# Mochi Chrome extension — local Brave tracking and sync

This Manifest V3 extension estimates active HTTP(S) website time locally and shows a popup report. After explicit approval, it sends category/time summaries to the Mochi dashboard at **`http://localhost:5173`**, where validated ingestion awards Focus rewards. There are no accounts, backend, analytics, content scripts, or remote sync service. Extension category rules stay separate from dashboard rules.

## Rebuild and reload the existing installation

From `C:\Users\keish\OneDrive\Documents\mochi`, using Node.js 24 and PowerShell:

```powershell
npm.cmd run build:extension
npm.cmd run build
```

The exact extension output folder is:

```text
C:\Users\keish\OneDrive\Documents\mochi\extension\dist
```

1. Open **`brave://extensions`** and enable **Developer mode**.
2. Click **Reload** on your **existing unpacked Mochi extension**. Keep that installation so its rules, preferences, and saved totals remain available. Rebuilding/reloading uses the same folder; do not load a duplicate.
3. Keep the web dev server running, or start it with `npm.cmd run dev`. Refresh **`http://localhost:5173/`** in **Brave**. Vite is fixed to 5173 with `strictPort`; another port, `127.0.0.1`, HTTPS, or production preview does not match this bridge.
4. Save or cancel any active timer before first connection. Copy the 32-letter ID from Mochi's popup or `brave://extensions`, paste it into the dashboard, and click **Connect in Brave**.
5. Open the existing Mochi popup and explicitly approve **`http://localhost:5173`**. Return to the app. Requests expire after two minutes; if expired, request again.
6. Use **Enable tracking** or **Resume** in the popup if needed. Connection approval preserves the existing enabled/paused preference; it never enables or resumes tracking by itself. A connected app may correctly report **Tracking off**, **Paused**, **Idle**, **Browser unfocused**, or **No supported website**.

For an initial installation only, choose **Load unpacked** and select the folder above, containing the generated `manifest.json`. The implementation requires a Chromium version supporting the extension's Chrome 120+ APIs. Pin/open Mochi through Brave's Extensions menu. Loading alone does not enable tracking.

**Website categories** opens the extension's own settings. Add exact-hostname Focus, Leisure, or Neutral rules there. Unknown websites are Neutral; subdomains need explicit rules. No site intent is assumed. Existing web rules are preserved but are not copied into the extension.

Normal dashboard refresh automatically reuses the saved token. If reconnection is needed, use the exact origin and the same installation's ID, then approve again. Same-epoch reapproval rotates the token without resetting its cutoff or buffer. There is no need to clear browser data.

## Build and test commands

From the repository root:

```sh
npm ci
npm test
npm run test:extension
npm run lint
npm run build
npm run build:extension
git diff --check
```

Use `npm.cmd` in PowerShell if `npm.ps1` is blocked. The extension build separately type-checks TypeScript and bundles the worker, popup, and options page with Vite. Output is ignored by Git. The web app's `npm run dev` and `npm run preview` remain available; the preview origin is not allowlisted for the local sync bridge.

## Permissions and official API choices

| API or permission | Purpose |
| --- | --- |
| [`tabs`](https://developer.chrome.com/docs/extensions/reference/api/tabs) | Read the active URL transiently to extract a hostname. `activeTab` requires user invocation and cannot provide this continuous opt-in behavior. No title, favicon, page contents, screenshot, or full URL is persisted. Chromium may display broad browsing-history permission wording; the `history` API is not requested or used. |
| [`idle`](https://developer.chrome.com/docs/extensions/reference/api/idle) | Receive active/idle/locked changes with a 60-second idle threshold; no keystroke or input contents are observed. |
| [`storage`](https://developer.chrome.com/docs/extensions/reference/api/storage) | Save local preferences, user rules, aggregates, pairing metadata, and the accounting checkpoint. No `storage.sync` is used. |
| [`alarms`](https://developer.chrome.com/docs/extensions/reference/api/alarms) | Request a 30-second checkpoint alarm. Alarms can be delayed and do not wake sleeping devices; missing alarms are recreated on worker load. |
| [`windows`](https://developer.chrome.com/docs/extensions/reference/api/windows) | Find the actually focused normal browser window; the popup sender or last-focused window is not proof of focus. |
| [`runtime` messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging#external-webpage) | Receive direct, explicitly approved local web requests through `onMessageExternal`. Callback `sendResponse` uses a literal `return true` to retain the asynchronous response channel. |
| [`externally_connectable`](https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable) | Expose messaging to the local host. Manifest match patterns cannot restrict a port; the worker independently requires the exact `http://localhost:5173` origin. |

There are no host permissions, `scripting`, `history`, `webNavigation`, `unlimitedStorage`, content scripts, public `window.postMessage` bridge, or remote JavaScript. All scripts/styles are bundled and CSP blocks network connections. Incognito is disallowed and filtered defensively. Only validated category/time DTOs leave the extension; rules, hostname metadata, full URLs, titles, and page contents are excluded from external replies. See [the complete security boundary](../docs/extension-integration.md).

## Accounting and recovery

The worker registers event listeners synchronously. Tab/window/idle/alarm events, internal UI commands, and external sync requests join one serialized queue; only the worker writes extension storage. Each successful single-record write commits both totals and checkpoint. The in-memory accounting cursor never advances before a successful write. A failure is surfaced; the uncommitted tail is discarded on the next successful observation rather than replayed. Malformed data is preserved rather than reset.

Time uses timestamp differences in milliseconds, not interval ticks. A previous eligible observation closes at the next observation before changed tab/category/focus/idle/preferences take effect. Eligibility requires enabled, unpaused tracking, active idle state, a focused non-incognito normal window, and a loaded active HTTP(S) tab. Internal, extension, unsupported, incognito, and loading pages are ignored. Opening a popup queries the actual focused window rather than selecting a website from its sender.

Recovery deliberately favors undercounting:

- Fresh workers, startup, and reload never backfill the previous checkpoint. A stored enabled preference does not credit browser-closed or unknown-gap time.
- During a continuous worker lifetime, gaps over **45 seconds**, backwards clocks, or wall/monotonic disagreement over **2 seconds** drop the unconfirmed interval. The high-water checkpoint avoids recounting after rollback. Large sleep gaps are dropped.
- Quiet-site time can be undercounted when the worker is suspended or alarms are delayed. The 30-second alarm neither keeps it alive nor guarantees delivery.
- Idle is reported after **60 seconds** without input; that grace period may count as active. API/event latency and short clock/sleep changes introduce uncertainty. These estimates do not verify work or precisely measure all OS sleep.
- Idle/locked, unfocused, paused, and off states stop accumulation. Returning to active/focused or resuming begins a new observation without backfilling gaps. Rest is never inferred.

The popup samples its report every five seconds while open; the visible dashboard also requests snapshots about every five seconds. These requests checkpoint accounting, not tick-counting timers. Popup seconds round down while stored totals keep milliseconds.

## Aggregation, synchronization, and retention

Only explicit user-authored rules persist hostnames. Current hostname metadata is transient worker/UI state. There is no stored tab/window ID, full URL, hostname-visit list, page title/content, query, fragment, or fine-grained site history.

Extension data is a **version-2 record under the unchanged `mochi.extension.v1` key**. Migration preserves version-1 preferences, rules, event IDs, totals, and checkpoint without clearing data. The extension never writes the app's `mochi.progress` record itself; the dashboard validates and commits received summaries under its own Web Lock.

Aggregates are keyed by category, IANA timezone, local date, and synchronization epoch. They carry stable event IDs, cumulative milliseconds, first/last bounds, monotonic revisions, and finalized state. Bounds may contain inactive gaps; only eligible segments enter `activeDurationMs`. Same-category sites merge, so aggregates do not reveal individual site switches. Rule edits close old eligible time and affect only future observations.

Local-midnight splitting uses calendar arithmetic and respects DST. A timezone change drops the uncertain tail and starts a new timezone/day aggregate. Old totals retain their original local date and timezone. Closed aggregates are finalized; revisiting a closed day creates a new ID. Revisioned version-2 wire summaries safely support current-day updates instead of pretending mutable drafts are immutable version-1 events.

First connection requires approval in the popup, then a durable web reward reservation, then extension activation. Activation seals old drafts and begins a new epoch cutoff. **Earlier popup totals remain local and are never imported or retroactively rewarded.** Current-epoch summaries sync to the dashboard with stable IDs and revisions; repeated or stale valid snapshots cannot add time or rewards again. Reapproval of the same epoch preserves its buffer and cutoff. A new epoch preserves already accepted web progress but does not backfill prior popup-only time.

The dashboard captures existing Focus as a baseline and grants only the increase in completed 15-minute blocks, capped at 240 minutes/day including that baseline. Manual/Timer entries still save after reservation but cannot add extra Focus rewards or inflate primary goal progress, including while paused/disconnected. Intentional manual Rest still counts. This avoids double rewards from overlapping self-reports without inventing manual start/end intervals.

Retention is a rolling **seven days based on aggregate end time**, at most **64 aggregates** and **200 rules**. Pruning occurs on successful checkpoints; old unsynced time can expire before the app returns. The dashboard keeps its accepted ledger independently, so extension pruning does not undo accepted progress. Corruption/write failures are reported; no server backup or reset tool exists.

## Manual Brave checks

1. Rebuild/reload/approve using the steps above. If paused/off, confirm connection does not change that preference, then explicitly resume/enable.
2. Assign `example.com` to Focus and `example.org` to Leisure in extension settings. Browse each actively about 30 seconds, then open the popup and return to the dashboard. Both categories should increase approximately; new post-activation browser entries should be labeled **Extension**. Earlier popup totals need not equal the dashboard.
3. Switch to another application for 20 seconds; that unfocused time should not be added. Pause, wait, Resume, and confirm paused time is excluded. Changing tabs must count only one active tab.
4. Leave input idle over 60 seconds; the grace period may count, but later idle time should not. Generate input to resume. No automatic Rest should appear.
5. Change a site rule: old category totals stay unchanged and future time uses the new category. Unknown sites remain Neutral.
6. Refresh the app and reopen/reload the extension. Preferences, rules, accepted progress, and pairing should persist; normal app refresh should reconnect without approval. Closing Brave must not credit closed time.
7. Verify a completed 15-minute Focus block earns 5 XP/2 credits once, subject to baseline/cap. Refresh, retry, and use a second app tab: no duplicate reward. Feed once to spend exactly 2 credits. Optional Manual/Timer Focus saves must not add extra rewards after connection.

The user manually confirmed earlier Focus/Leisure/Neutral tracking and paused popup behavior in Brave. **The new synchronization bridge remains unverified in a real Brave session in this environment.** Deterministic unit and mocked browser-API tests do not prove external message delivery, popup approval, or end-to-end UI behavior. Report actual test runs separately from this checklist.

## Branch dependency

`feature/extension-dashboard-sync` targets `feature/browser-tracking` while [PR #3](https://github.com/keibored/mochi/pull/3) is open and unmerged. PR #3 targets `feature/tracking-dashboard` and depends on [PR #2](https://github.com/keibored/mochi/pull/2), which depends on [timer PR #1](https://github.com/keibored/mochi/pull/1). Leave existing PRs unmerged. Retarget/reconcile dependent bases against `main` after their parents merge.
