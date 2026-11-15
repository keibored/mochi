# Mochi ♡

Mochi is a kawaii productivity companion: a little focus, a little rest, and a bunny by your side.

Mochi is a virtual pet powered by activity. The React + TypeScript web app is Mochi’s room; a companion Manifest V3 extension estimates active website time in Brave and syncs category totals after explicit approval. Focus earns treats and lifetime XP. Newly recorded Leisure beyond a daily allowance gently uses fullness, and intentional Rest restores energy. Manual logging and the focus timer remain optional tools. Everything stays local; there is no backend or account service.

## Working now

- A strawberry-glass room scene with an original SVG bunny, window, rug, cushion, bowl, readable care HUD, and Feed / Rest / Wake / Focus actions. Fullness, energy, and real session state derive cozy, happy, hungry, under-the-weather, tired, sleeping, or focusing expressions. These are fictional pet states, never health judgments about you.
- Extension tracking of the active HTTP(S) tab in the focused browser window while the user is active, with Enable, Pause, Resume, idle handling, and a popup showing real local Focus, Leisure, and Neutral totals.
- An explicitly approved Brave-to-dashboard connection at **`http://localhost:5173`**. The dashboard shows a freshly verified tracking state and last successfully saved sync; saved data alone never means connected.
- Today's category summary, a separate daily Focus goal, and recent activities labeled **Manual**, **Timer**, or **Extension**. Browser totals retain fractional minutes. Rest stays intentional, never inferred from inactivity.
- Bundled automatic website categories, with optional exact-hostname overrides. Clear learning/work tools default to Focus, entertainment services to Leisure, and unknown or mixed-purpose sites to Neutral. The popup shows Automatic, Your override, or Unclassified. Tracking uses the extension's overrides; dashboard overrides remain separate and never overwrite them.
- Manual Focus, Leisure, Rest, and Neutral entries: 1–240 whole minutes and an optional note of up to 200 characters.
- A persistent Focus Timer: 1–120 whole minutes, default 25, with Start, Pause, Resume, confirmed cancellation, and Save session after completion. Optional tools live in Activity; a compact timer indicator stays visible when you navigate elsewhere.
- Focus rewards of **5 XP and 2 food credits per accumulated 15 minutes**, limited to the first **240 Focus minutes per local day**. Partial browser minutes remain exact milliseconds in reward calculations. Other categories never subtract rewards.
- Feeding costs exactly 2 credits and restores 20 fullness, capped at 100; a full pet cannot spend credits on another meal. Intentional Rest restores 5 energy per completed 5 minutes. Newly accepted browser Focus uses 1 energy per completed 5 active minutes, with partial milliseconds carried within each local day. Before first connecting, the optional timer supplies this energy clock instead. Once browser authority is reserved, optional timers never add another energy deduction, including while disconnected. Low energy never blocks Focus or earning treats.
- A daily Leisure allowance defaults to 60 minutes. Each new accumulated 15 minutes beyond it uses 5 fullness. Settings accepts 0–1440 whole minutes; edits apply prospectively, preserving past care. There is no wall-clock hunger or penalty for missing/idle time.
- Levels derive from lifetime XP: level 1 starts at 0, level 2 at 100, level 3 at 200, continuing every 100 XP. A small 15-minute daily Focus quest uses existing eligible progress and gives no duplicate bonus. Genuine reward notifications use the committed XP/credit delta, never restored totals.
- A daily Focus goal defaults to 60 minutes and accepts 15–480 whole minutes; changing it never awards rewards.
- Validated versioned persistence and cross-tab coordination preserving adoption, activities, goals, timer state, XP, and spent credits.

Before first connecting, the existing manual/timer reward rules apply: a fresh 30-minute Focus entry earns 10 XP and 4 credits; feeding once leaves 10 XP and 2 credits. After first connecting, browser Focus supplies new rewards and Focus goal progress. Optional Manual/Timer entries still save to history without extra rewards, including while paused or disconnected. Intentional manual Rest still counts in the daily summary. This prevents overlapping entries from earning twice.

Website setup is optional. Classification uses **your exact-hostname override → the most specific bundled default → Neutral**. Categories estimate a website's usual purpose; they do not prove what you are doing. General GitHub and YouTube stay Neutral, while dedicated documentation/music hostnames can differ. **Adjust website categories** lets you override any default, including with Neutral; removing an override restores the bundled default or the Neutral fallback. Existing rules remain overrides. Changes apply only to future time, without changing history or rewards. See [catalog scope, matching, and maintenance](docs/website-classification.md).

## Around your Mochi home

- **Home:** one dominant room, with name/level/XP/fullness/energy above, the bunny and contextual speech in the center, and compact care actions below. Say hello with the keyboard-accessible bunny. Real connection status and active timer access remain visible. Rest with a running timer asks to pause it first; Wake never resumes it silently.
- **Activity:** detailed source-labeled category totals, your personal daily goal, and full history shown 20 entries at a time. Focus timer and manual logging remain available. Records can overlap and are not presented as a combined accurate time total. A manual Rest history entry does not put Mochi to sleep or restore energy; use Home’s Rest action.
- **Settings:** daily Focus goal, daily Leisure allowance, actual Brave connection, and optional website settings. Existing dashboard overrides remain accessible; live tracking overrides still belong to the extension.

Navigation keeps forms mounted, preserving drafts while switching views. One sync controller continues across all views. Tracking and care explanations live in accessible disclosures. See [the care model and safe testing guide](docs/pet-care.md) for exact thresholds, prospective accounting, migration, and overlap rules. No death, permanent damage, lost XP, or lost levels are implemented.

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
2. Open **`brave://extensions`**, enable **Developer mode**, and click **Reload** on the **existing unpacked Mochi extension**. Its card should show version **0.4.0**. Keep the same installation and its saved rules/preferences.
3. Refresh the web app. Save or cancel an existing active timer before the **first** connection; the app never resolves it automatically.
4. Copy Mochi's 32-letter extension ID from its popup or `brave://extensions`. Open **Settings → Browser connection**, enter it in **Mochi extension ID**, and click **Connect in Brave**.
5. Open that extension's popup and explicitly approve **`http://localhost:5173`** within two minutes. Return to the dashboard; a real response and successful local save establish the connected state. Settings shows the verified extension version and catalog revision (`2026-11-13.1`) from that receiver. An intact existing pairing reconnects automatically after refresh and does not need repeated approval.
6. If tracking is off or paused, use the popup's existing **Enable tracking** or **Resume** control. Approval does **not** enable or resume tracking automatically. **Connected · Tracking off** and **Connected · Paused** are valid states.

The dashboard requests totals about every five seconds while visible; returning to the tab triggers a check. Refreshing the same origin reuses its saved token without another approval. **Not connected** means this app has no approved saved pairing; it does not mean the popup tracker is broken. Settings/Home distinguish unavailable messaging, wrong app origin, pending/expired approval, incompatible build, and a lost connection, with recovery instructions. Protocol 2 requires extension 0.4.0 or newer and the matching bundled classifier; rebuild/reload an old receiver before connecting. Do not clear site data to reconnect.

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

The web app stores one **version-7** JSON record under `mochi.progress` in `localStorage`: existing progress/history/goals/timer/rules/sync plus care values, per-local-day Leisure and automatic Focus ledgers, separate policy cutoffs, intentional Rest state, and a timer energy cursor. The version-6 migration preserves current fullness/energy and all previous progress, baselining already accepted Focus without replaying care or rewards. Earlier pre-care records still start at 80/80 with historical time baselined. Migration is persisted under the existing lock, even when no gameplay block is due. XP, spent credits, IDs, timestamps, timer, and both rule lists are preserved.

Automatic Focus energy is separate from the 240-minute XP reward cap: actual new Focus beyond the cap can still use energy. Intentional Rest suspends automatic energy costs; Rest/Wake clear the pending energy fraction and move its prospective cutoff. A buffered aggregate crossing an unknown migration/rest boundary is conservatively baselined on its first increment, rather than charged retroactively. Idle, Neutral, unobserved gaps, and disconnection itself never consume energy.

The extension keeps a **version-2** record under the existing `mochi.extension.v1` key. Version-1 data migrates without clearing preferences, rules, event IDs, or totals. Pairing seals earlier drafts and starts a new synchronization epoch. Activity from **before first activation stays in the popup and is never imported or retroactively rewarded**. The popup can therefore show more time than the dashboard.

Before activation, the dashboard durably captures all existing Focus totals as a baseline and reserves reward authority. Browser Focus adds only newly completed reward blocks above that baseline, sharing the 240-minute daily cap. Stable event IDs and cumulative revisions prevent retries, refreshes, reconnects, and concurrent tabs from adding time or rewards twice. Same-epoch reapproval rotates the token while retaining the cutoff, buffer, and ledger. A new epoch preserves accepted progress and the original baseline without replaying old popup totals.

Live connection state is temporary: errors, hiding the app tab, or a response older than 15 seconds invalidate it. Last successful sync is saved only after an actual response is durably ingested. Stored tokens and old entries never prove current tracking. Reward authority remains reserved while paused, disconnected, or waiting for activation; it never automatically switches back to Manual/Timer rewards.

Data belongs to the browser profile and exact origin. Other browsers, devices, and ports do not share progress. There is no server backup, account sync, or export. Unavailable storage is reported; ordinary manual actions may remain session-only, while feeding, timed care, care settings, timer, and sync require durable storage and Web Locks. Malformed/unsupported records are preserved rather than overwritten. After a storage failure, reload when storage is available to restore the last saved record.

Extension retention is a rolling seven days, at most 64 aggregates and 200 rules. Unsynced time can expire before the next dashboard connection. Web history grows and can reach storage limits. Tracking estimates activity rather than verifying work: worker restarts drop unconfirmed tails, long gaps/clock discontinuities are discarded, alarms can be delayed, and the 60-second idle grace period may count. See [accounting limitations](extension/README.md).

Manual entries use their logging date. A timer belongs entirely to its calculated **completion date** in the current local timezone, even if saved later; it is not split across days. Browser aggregates split at local midnight and retain their original local date and IANA timezone. Browser minutes display to 0.01 minute; rewards use exact milliseconds.

### Timer safety

A running timer continues while the page is closed, backgrounded, or the device sleeps. It uses timestamps rather than counting ticks; paused time does not count. Clock changes can affect it. Completion shows **Focus session complete ♡**; only **Save session** creates an activity. Cancel requires confirmation and adds no activity or rewards; before browser authority, actual active time still settles its energy cost. Each timer's stable ID is also its saved activity ID. Persistent notices derive from current timer state; transient action feedback expires after five seconds. Rest/Wake never turn a completed unsaved timer into a paused timer or remove its Save action.

All app mutations read the newest record under a shared Web Lock, preventing duplicate saves, multiple active timers, and stale-tab writes. Tabs refresh on storage events and when brought into view. Clearing/manually editing data and unrelated older app versions are outside these guarantees.

## Manual verification

1. Rebuild, reload the existing Brave extension, refresh the exact app origin, and connect as above. Confirm a fresh state and last successful sync. Off/paused must stay off/paused until enabled/resumed.
2. Without adding rules, actively browse `developer.mozilla.org` and `www.netflix.com` about 30 seconds each. The popup should show **Focus · Automatic** and **Leisure · Automatic**, respectively, unless an existing override takes precedence. After returning to Mochi, both categories should increase, labeled **Extension**. Unknown sites such as `example.org` should accumulate **Neutral · Unclassified**.
3. Pause in the popup, wait, then return to the dashboard. Confirm the actual paused state and no added paused time. Resume and test tab switches, window focus, and idle handling using the extension guide. Rest must never be inferred.
4. Accumulate a new 15-minute browser Focus block: it earns 5 XP and 2 credits, subject to today's baseline/cap, and uses 3 energy (1 per five active minutes). Check partial accumulation across visits. Refresh or open another app tab; accepted summaries must not apply care or rewards again. At 80 fullness, feeding spends 2 credits and reaches 100 without changing XP. A further meal is disabled and spends nothing.
5. In **Activity**, save each Manual category and a Timer session. After connection they stay in history without extra Focus rewards or goal progress; intentional Rest updates the summary. In **Settings**, change the goal and confirm balances do not change.
6. Switch views with unfinished form values and an active timer. Drafts should remain, and the timer indicator should open Activity controls. Use Home’s Rest action during a timer: it asks before pausing, preserves the session, and shows sleeping. After five real minutes, energy rises by five; refresh and Wake must not add the same blocks again. Wake never resumes Focus silently. After connection, overlapping timer time must not add a second energy cost. Rest/Wake with a completed timer must leave it completed and saveable once. Feed shows an eating reaction; higher-priority care states can override the happy face. For fast threshold checks without fake real data, run [the isolated care tests](docs/pet-care.md#safe-verification-without-altering-real-progress). Check desktop/mobile, keyboard access, and reduced motion. Drafts survive navigation, not reloads.
7. In the extension's **Adjust website categories**, override `developer.mozilla.org` to Neutral. New time should use **Neutral · Your override**, while earlier Focus totals and balances remain unchanged. Remove the override to restore **Focus · Automatic** for future time. Existing exact-hostname rules do not implicitly include subdomains.

The user manually confirmed the earlier extension's Focus/Leisure/Neutral accounting and paused popup in Brave. **The new sync bridge and redesigned layouts/interactions have not been verified in a real browser in this environment.** Unit and mocked API tests do not prove Brave external-message delivery, popup approval, navigation, visual layout, or page integration end to end. Check results for a particular change are reported separately.

## Integration boundary and remaining work

The implemented flow is **Extension → validated ingestion → reward calculation → dashboard**. Version-2 summaries carry stable IDs, epoch, cumulative revision, category, ISO bounds, exact milliseconds, timezone/local date, and finalized state. They contain no hostname, rules, full URLs, titles, page contents, or visit history. Direct Chromium messaging avoids a public page-message bridge. See [protocol/security details](docs/extension-integration.md).

Backend services, account authentication, remote/device sync, automatic rule synchronization, and Chrome Web Store distribution remain unimplemented. Production origins require explicit configuration and security review.

## Git and GitHub workflow

`origin` is <https://github.com/keibored/mochi>. `main` is the stable baseline. Use a feature branch per increment, focused commits, relevant tests/lint/builds and `git diff --check`, a reviewed diff, and pull requests. Never force-push, discard others' work, or commit secrets, dependencies, build output, or logs. Visibility and remotes change only at the owner's direction.

`feature/pet-care-gameplay` targets `feature/home-layout` while [Home PR #8](https://github.com/keibored/mochi/pull/8) remains open and unmerged. That branch depends on [glass PR #7](https://github.com/keibored/mochi/pull/7), [UI PR #6](https://github.com/keibored/mochi/pull/6), [classification PR #5](https://github.com/keibored/mochi/pull/5), [sync PR #4](https://github.com/keibored/mochi/pull/4), and earlier PRs #3/#2/#1. Keep the stack unmerged for review. Retarget/reconcile after parents merge without duplicating or discarding work. Backend work remains a later phase.

`feature/tracking-care-integration` builds on `feature/pet-care-gameplay` and targets that branch while [care PR #9](https://github.com/keibored/mochi/pull/9) remains unmerged. It preserves the room design and existing branch stack.
