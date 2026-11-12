# Mochi ♡

Mochi is a kawaii productivity companion: a little focus, a little rest, and a bunny by your side.

The React + TypeScript web app is the main pet dashboard. A companion Manifest V3 extension estimates active website time in Brave and can sync category totals to the local dashboard after explicit approval. Manual logging and the focus timer remain optional tools. This integration is local; there is no backend or account service.

## Working now

- A responsive pink-and-cream welcome screen, adoption, emoji bunny, feeding, lifetime XP, and a first milestone of 100 XP.
- Extension tracking of the active HTTP(S) tab in the focused browser window while the user is active, with Enable, Pause, Resume, idle handling, and a popup showing real local Focus, Leisure, and Neutral totals.
- An explicitly approved Brave-to-dashboard connection at **`http://localhost:5173`**. The dashboard shows a freshly verified tracking state and last successfully saved sync; saved data alone never means connected.
- Today's category summary, a separate daily Focus goal, and recent activities labeled **Manual**, **Timer**, or **Extension**. Browser totals retain fractional minutes. Rest stays intentional, never inferred from inactivity.
- Exact-hostname category rules with unknown sites defaulting to Neutral. Tracking uses the extension's rules. Existing dashboard rules remain editable and separate; connecting never overwrites either list.
- Manual Focus, Leisure, Rest, and Neutral entries: 1–240 whole minutes and an optional note of up to 200 characters.
- A persistent Focus Timer: 1–120 whole minutes, default 25, with Start, Pause, Resume, confirmed cancellation, and Save session after completion. An active timer stays visible when **Other ways to record time** is collapsed.
- Focus rewards of **5 XP and 2 food credits per accumulated 15 minutes**, limited to the first **240 Focus minutes per local day**. Partial browser minutes remain exact milliseconds in reward calculations. Other categories never subtract rewards.
- Feeding for exactly 2 credits without changing XP. A daily Focus goal defaults to 60 minutes and accepts 15–480 whole minutes; changing it never awards rewards.
- Validated versioned persistence and cross-tab coordination preserving adoption, activities, goals, timer state, XP, and spent credits.

Before first connecting, the existing manual/timer reward rules apply: a fresh 30-minute Focus entry earns 10 XP and 4 credits; feeding once leaves 10 XP and 2 credits. After first connecting, browser Focus supplies new rewards and Focus goal progress. Optional Manual/Timer entries still save to history without extra rewards, including while paused or disconnected. Intentional manual Rest still counts in the daily summary. This prevents overlapping entries from earning twice.

## Rebuild, reload, and connect in Brave

From **`C:\Users\keish\OneDrive\Documents\mochi`**, in PowerShell:

```powershell
npm.cmd run build:extension
npm.cmd run build
```

The exact unpacked extension output folder is:

```text
C:\Users\keish\OneDrive\Documents\mochi\extension\dist
```

1. Use the same **Brave profile** that contains your pet progress and existing extension. Keep the current dev server running, or start it with `npm.cmd run dev`. Open **`http://localhost:5173/`**. Vite uses port 5173 with `strictPort`: it exits if occupied rather than changing origin. The production preview's different port is not allowlisted.
2. Open **`brave://extensions`**, enable **Developer mode**, and click **Reload** on the **existing unpacked Mochi extension**. Its card should show version **0.2.0**. Keep the same installation and its saved rules/preferences.
3. Refresh the web app. Save or cancel an existing active timer before the **first** connection; the app never resolves it automatically.
4. Copy Mochi's 32-letter extension ID from its popup or `brave://extensions`. Enter it in the dashboard's **Mochi extension ID** field and click **Connect in Brave**.
5. Open that extension's popup and explicitly approve **`http://localhost:5173`** within two minutes. Return to the dashboard; a real response and successful local save establish the connected state.
6. If tracking is off or paused, use the popup's existing **Enable tracking** or **Resume** control. Approval does **not** enable or resume tracking automatically. **Connected · Tracking off** and **Connected · Paused** are valid states.

The dashboard requests totals about every five seconds while visible; returning to the tab triggers a check. Refreshing the same origin reuses its saved token without another approval. If connection fails, check the exact origin and ID, reload the existing extension, refresh the app, and request approval again if needed. Do not clear site data to reconnect.

For a first installation only, use **Load unpacked** in `brave://extensions` and select the output folder containing `manifest.json`. Existing users should reload their installation rather than load a duplicate. See [the extension guide](extension/README.md).

## Local development and checks

Use Node.js 24 LTS and npm. Node 24 runs the TypeScript tests directly with its built-in test runner. Install locked dependencies with `npm ci`.

```sh
npm run dev
npm test
npm run test:extension
npm run lint
npm run build
npm run build:extension
git diff --check
```

`npm test` covers web domain, migration, storage, ingestion, and presentation calculations in `tests/`. `npm run test:extension` runs deterministic accounting and messaging tests with mocked browser APIs. Lint runs ESLint. The web build checks TypeScript and outputs `dist/`; the extension build separately checks TypeScript and outputs `extension/dist/`. Build output is ignored. `npm run preview` previews the web production build but does not change the bridge's allowed origin.

In PowerShell, use `npm.cmd` instead of `npm` if execution policy blocks `npm.ps1`, for example `npm.cmd test`. No environment variables are required. Local `.env` files are ignored; a future `.env.example` may contain placeholders only. Browser-bundled environment values are not secrets.

## Persistence and limitations

The web app stores one **version-5** JSON record under `mochi.progress` in `localStorage`: pet progress, Manual/Timer entries, goal, active timer, dashboard rules, pairing metadata, accepted extension summaries, the pre-sync Focus baseline, and last successful sync. Earlier records migrate structurally without replaying rewards. Old focus-only entries become Focus/Manual; existing source labels and timers remain accurate. Version-4 progress gains empty sync state. XP and spent credits remain unchanged.

The extension keeps a **version-2** record under the existing `mochi.extension.v1` key. Version-1 data migrates without clearing preferences, rules, event IDs, or totals. Pairing seals earlier drafts and starts a new synchronization epoch. Activity from **before first activation stays in the popup and is never imported or retroactively rewarded**. The popup can therefore show more time than the dashboard.

Before activation, the dashboard durably captures all existing Focus totals as a baseline and reserves reward authority. Browser Focus adds only newly completed reward blocks above that baseline, sharing the 240-minute daily cap. Stable event IDs and cumulative revisions prevent retries, refreshes, reconnects, and concurrent tabs from adding time or rewards twice. Same-epoch reapproval rotates the token while retaining the cutoff, buffer, and ledger. A new epoch preserves accepted progress and the original baseline without replaying old popup totals.

Live connection state is temporary: errors, hiding the app tab, or a response older than 15 seconds invalidate it. Last successful sync is saved only after an actual response is durably ingested. Stored tokens and old entries never prove current tracking. Reward authority remains reserved while paused, disconnected, or waiting for activation; it never automatically switches back to Manual/Timer rewards.

Data belongs to the browser profile and exact origin. Other browsers, devices, and ports do not share progress. There is no server backup, account sync, or export. Unavailable storage is reported; ordinary manual actions may remain session-only, while timer and sync require durable storage and Web Locks. Malformed/unsupported records are preserved rather than overwritten. After a storage failure, reload when storage is available to restore the last saved record.

Extension retention is a rolling seven days, at most 64 aggregates and 200 rules. Unsynced time can expire before the next dashboard connection. Web history grows and can reach storage limits. Tracking estimates activity rather than verifying work: worker restarts drop unconfirmed tails, long gaps/clock discontinuities are discarded, alarms can be delayed, and the 60-second idle grace period may count. See [accounting limitations](extension/README.md).

Manual entries use their logging date. A timer belongs entirely to its calculated **completion date** in the current local timezone, even if saved later; it is not split across days. Browser aggregates split at local midnight and retain their original local date and IANA timezone. Browser minutes display to 0.01 minute; rewards use exact milliseconds.

### Timer safety

A running timer continues while the page is closed, backgrounded, or the device sleeps. It uses timestamps rather than counting ticks; paused time does not count. Clock changes can affect it. Completion shows **Focus session complete ♡**; only **Save session** creates an activity. Cancel requires confirmation and adds nothing. Each timer's stable ID is also its saved activity ID.

All app mutations read the newest record under a shared Web Lock, preventing duplicate saves, multiple active timers, and stale-tab writes. Tabs refresh on storage events and when brought into view. Clearing/manually editing data and unrelated older app versions are outside these guarantees.

## Manual verification

1. Rebuild, reload the existing Brave extension, refresh the exact app origin, and connect as above. Confirm a fresh state and last successful sync. Off/paused must stay off/paused until enabled/resumed.
2. In **extension** settings, assign `example.com` to Focus and `example.org` to Leisure. Actively browse each about 30 seconds, then return to Mochi and wait for sync. Both categories should increase, labeled **Extension**. These are your choices, not built-in classifications.
3. Pause in the popup, wait, then return to the dashboard. Confirm the actual paused state and no added paused time. Resume and test tab switches, window focus, and idle handling using the extension guide. Rest must never be inferred.
4. Accumulate a new 15-minute browser Focus block: it earns 5 XP and 2 credits, subject to today's baseline/cap. Refresh or open another app tab; the same summaries must not reward again. Feeding spends 2 credits without changing XP.
5. Save each Manual category and a Timer session. After connection they stay in history without extra Focus rewards or goal progress; intentional Rest updates the summary. Change the goal and confirm balances do not change.
6. Refresh both surfaces and verify pet progress, extension rules, and pairing persist. Check desktop/mobile layout, keyboard controls, focus outlines, and the collapsed active-timer notice.

The user manually confirmed the earlier extension's Focus/Leisure/Neutral accounting and paused popup in Brave. **The new sync bridge has not been verified in a real browser in this environment.** Unit and mocked API tests do not prove Brave external-message delivery, popup approval, or page integration end to end. Check results for a particular change are reported separately.

## Integration boundary and remaining work

The implemented flow is **Extension → validated ingestion → reward calculation → dashboard**. Version-2 summaries carry stable IDs, epoch, cumulative revision, category, ISO bounds, exact milliseconds, timezone/local date, and finalized state. They contain no hostname, rules, full URLs, titles, page contents, or visit history. Direct Chromium messaging avoids a public page-message bridge. See [protocol/security details](docs/extension-integration.md).

Backend services, account authentication, remote/device sync, automatic rule synchronization, and Chrome Web Store distribution remain unimplemented. Production origins require explicit configuration and security review.

## Git and GitHub workflow

`origin` is <https://github.com/keibored/mochi>. `main` is the stable baseline. Use a feature branch per increment, focused commits, relevant tests/lint/builds and `git diff --check`, a reviewed diff, and pull requests. Never force-push, discard others' work, or commit secrets, dependencies, build output, or logs. Visibility and remotes change only at the owner's direction.

`feature/extension-dashboard-sync` targets `feature/browser-tracking` while [PR #3](https://github.com/keibored/mochi/pull/3) is open and unmerged. PR #3 depends on [tracking dashboard PR #2](https://github.com/keibored/mochi/pull/2), which depends on [timer PR #1](https://github.com/keibored/mochi/pull/1). Keep these PRs unmerged for review. Once parents merge, retarget/reconcile dependent branches against `main` without duplicating their changes. Continue the main web experience and companion integration in focused increments; backend work remains a later phase.
