# Mochi Chrome extension — local proof of concept

This Manifest V3 extension estimates active HTTP(S) website time locally and shows a popup report. It does **not** connect to the Mochi dashboard, synchronize rules, or award pet XP or food credits. The web dashboard correctly continues to say tracking is not connected. No backend, accounts, analytics, content scripts, or network sync are included.

## Build and load

From the repository root, with Node.js 24 and npm installed:

```sh
npm ci
npm run test:extension
npm run build:extension
```

In Windows PowerShell, use `npm.cmd` if `npm.ps1` is blocked. The web app's existing `npm run dev`, `npm test`, `npm run lint`, and `npm run build` commands are unchanged. The new extension build separately type-checks its TypeScript and uses Vite to bundle three local entries. Build output is ignored by Git.

1. Open **chrome://extensions** in Chrome 120 or newer.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select **`C:\Users\keish\OneDrive\Documents\mochi\extension\dist`** (the `extension/dist` folder containing the generated `manifest.json`, not the repository root or the web app's `dist`).
4. Pin Mochi through Chrome's Extensions menu, then open its popup.
5. Choose **Enable tracking**. Installation and loading alone do not enable tracking. The enabled/paused preference persists across browser restarts.
6. Choose **Website categories** to add exact-hostname Focus, Leisure, or Neutral rules. Rules belong to this extension's `chrome.storage.local`; they are not synchronized with web-app localStorage rules. Unlisted sites are Neutral. Subdomains require explicit rules. No default site intent is assumed.

After source changes, rebuild and click the extension's **Reload** button in chrome://extensions. Reloading drops any unconfirmed tail but preserves saved local aggregates/preferences/rules. No Chrome Web Store listing or installable download is offered.

## Permissions and official API choices

The implementation was checked against current official Chrome docs:

| Permission | Why it is necessary |
| --- | --- |
| [`tabs`](https://developer.chrome.com/docs/extensions/reference/api/tabs) | Read the active tab's URL transiently to extract a hostname automatically across sites. `activeTab` is temporary and user-invocation-based, so it does not support this continuous opt-in use case. No titles, favicons, page contents, screenshots, or full URLs are stored. This permission can produce Chrome's broad browsing-history wording; no `history` API is requested or used. |
| [`idle`](https://developer.chrome.com/docs/extensions/reference/api/idle) | Query active/idle/locked state and receive transitions with a 60-second idle threshold. No keystrokes or input contents are observed. |
| [`storage`](https://developer.chrome.com/docs/extensions/reference/api/storage) | Persist local preferences, explicit category rules, category/day duration aggregates and the last accounting checkpoint. No `storage.sync` is used. |
| [`alarms`](https://developer.chrome.com/docs/extensions/reference/api/alarms) | Request a supported 30-second checkpoint alarm. Chrome can delay alarms and does not wake sleeping devices for them. Missing alarms are recreated on worker load. |

The [Windows API](https://developer.chrome.com/docs/extensions/reference/api/windows) identifies the actually focused normal browser window; the popup's sender or last-focused window is never treated as proof of focus. No host permissions, `scripting`, `history`, `webNavigation`, `unlimitedStorage`, content scripts, external message listener, or remote JavaScript are requested. All scripts/styles are bundled; CSP also blocks network connections. Incognito is disallowed in the manifest and filtered defensively in code.

## Accounting and recovery

The service worker registers tab activation/navigation/removal, window focus/removal, idle, alarm, startup, installation and bundled-page message listeners synchronously. Events and popup/settings requests join one serialized queue; only the worker writes storage. Each successful single-record storage write includes both category totals and the checkpoint. It never advances the in-memory accounting cursor before a successful write. Failure is reported to the UI; the uncommitted tail is discarded on the next successful observation rather than replayed. Malformed data is preserved and reported, not silently reset.

Time uses timestamp differences in milliseconds, not background interval ticks. A previous eligible observation is closed at the next observation before changes in tab/category/focus/idle/preference take effect. Eligibility requires tracking enabled and not paused, Chrome idle state active, a focused non-incognito normal browser window, and a loaded active HTTP(S) tab. Browser-internal, extension, unsupported, incognito and loading pages are ignored. Opening the popup queries that actual focused window and does not select a website based on the popup sender.

Recovery deliberately favors undercounting:

- A fresh worker, startup or extension reload does **not** backfill from the previous checkpoint. This prevents a persisted active preference from crediting browser-closed time or an unknown worker gap.
- In a continuously running worker, a gap over **45 seconds**, a backwards clock, or wall-clock/monotonic-clock disagreement over **2 seconds** drops the entire unconfirmed interval. The high-water checkpoint prevents counting wall-clock intervals twice after clock rollback. Large sleep gaps are discarded rather than credited.
- Even short unknown gaps on worker restart are dropped. Quiet-site time can be undercounted when Chrome repeatedly suspends the worker or delays alarms. A 30-second alarm requests checkpoints but does not keep the worker alive or guarantee exact delivery.
- Chrome reports idle only after **60 seconds** without input; that grace period can still be classified active. Tab/API/event latency and short sleep/clock changes within the tolerance can introduce small errors. Chrome does not expose a universal sleep-start event here, so these are conservative local estimates, not proof of work or exact OS sleep measurement.
- Idle/locked, browser blur, pause and off states stop future accumulation. Returning to active/focused state or resuming starts a new observation; inactive gaps are not backfilled. Rest is never inferred.

The popup refreshes its report every five seconds while open. This is UI sampling, not a per-second background accounting interval. Displayed seconds round down, but all milliseconds remain in stored totals.

## Aggregation, privacy, timezone and retention

Only user-authored rules contain hostnames. Current hostnames are transient in worker/UI memory. There is no persisted tab/window ID, URL, hostname-visit list, page title/content, query string, fragment, or fine-grained site history. Storage is a separate version-1 record under `mochi.extension.v1`; it never touches `mochi.progress` or web-app pet rewards.

Daily aggregates are keyed by category, IANA timezone and local date, with an active millisecond total and first/last counted timestamps. The interval can contain inactive gaps; `activeDurationMs` records only eligible segments. Same-category sites are merged, so the stored aggregates do not reveal individual site switches. Rules are normalized and exact-host matched using the web app's pure rule module. Category edits first close any old eligible time, then classify future observations with the new rule.

Intervals crossing local midnight are split using local calendar arithmetic rather than UTC date slicing or fixed 24-hour days; DST is respected. On a timezone change, discard the uncertain tail and start a new timezone/day aggregate. Prior aggregates keep their original local-date attribution, and today's report sums aggregates bearing today's local date rather than reclassifying history.

Each aggregate receives a random stable event ID on creation. Current-day aggregates are **mutable drafts**, not delivery events. When the day/timezone closes, they become immutable finalized summaries suitable for the proposed `ExtensionActivitySummaryV1` contract after removing the local-only `finalized` marker. If a closed day is revisited after timezone/clock changes, a new aggregate ID is used. No receiver or export/sync is implemented, and drafts must never be retried as immutable events. Future ingestion still needs authenticated validation, a retry ledger and the documented reward-overlap policy before it can award anything.

Retention is bounded to a rolling **seven days based on aggregate end time**, a maximum of **64 aggregates** (oldest first if unusual timezone changes fill the cap), and **200 category rules**. A still-open daily aggregate can include older portions of that local day. Pruning runs on successful checkpoints; closed-browser data is pruned on the next wake. Uninstalling or clearing extension data removes local progress. Corruption/write failures are surfaced; no data reset tool or server backup exists.

## Manual two-site check

1. In extension settings, assign `example.com` to Focus and `example.org` to Leisure. These are your explicit choices, not built-in classifications.
2. Enable tracking, visit https://example.com, generate normal user input, and stay about 20 seconds. Switch to https://example.org for about 10 seconds. Open the popup: Focus and Leisure should each increase roughly by those durations, with no overlapping totals. Checkpoint/recovery uncertainty means exact seconds are not guaranteed.
3. Switch to another application for 20 seconds. Return and open the popup; that unfocused interval should not be added. Pause, wait, then Resume; paused time should not increase totals.
4. Leave input idle for over 60 seconds: Chrome should report Idle (or locked). The first idle-threshold grace period may be counted; further idle time should not be. Generate input to resume.
5. Change a site's category. Its existing totals remain in the old category; subsequent time goes to the new category. Unknown sites are Neutral.
6. Close Chrome, wait, reopen it, then inspect the popup. Saved totals/preferences/rules should remain, and closed time must not be credited. Worker restarts may lose the final unconfirmed tail.
7. Verify the web dashboard is still **not connected** and its XP/credits do not change from extension activity.

Mocked deterministic tests cover event accounting and recovery, but do not prove Chrome integration works. Real unpacked-browser verification must be performed separately if browser tooling is unavailable.

## Branch dependency

`feature/browser-tracking` starts from tracking-dashboard commit `ae440d7` and targets `feature/tracking-dashboard` while PR [#2](https://github.com/keibored/mochi/pull/2) is unmerged. That PR in turn depends on timer PR [#1](https://github.com/keibored/mochi/pull/1). Neither is merged automatically. After the parent PRs are merged, retarget/reconcile the base against `main` before merging this extension increment.
