# Mochi ♡

Mochi is a kawaii productivity companion: a little focus, a little rest, and a bunny by your side.

Mochi’s primary experience will be a pet that reacts to automatically tracked browser activity from a companion Chrome extension. Manual logging and the focus timer are optional tools. The main React + TypeScript web application is being prepared first, using Vite; automatic detection does not work yet. The Chrome extension and backend are not implemented.

## Working now

- A responsive pink-and-cream welcome screen, adoption flow, and emoji bunny dashboard.
- A primary activity area with honest disconnected browser-tracking status, today's summary and daily goal progress, and recent activities with accurate Manual/Timer source labels. There is no fake Connect button or extension download link.
- Local website category settings: add, edit, and remove an exact-hostname rule with Focus, Leisure, or Neutral. Unknown sites default to Neutral; no website categories are preselected. URLs normalize to hostnames, dropping paths, queries, fragments and ports. Subdomains need their own rules. Rule changes never reclassify old activity or replay rewards.
- Manual activity logging for Focus, Leisure, Rest, and Neutral: whole durations of 1–240 minutes and optional notes up to 200 characters.
- A persistent Focus Timer with 1–120 whole-minute sessions (default 25), Start, Pause, Resume, confirmed cancellation, and an explicit Save session action after completion. History distinguishes Manual and Timer entries.
- Today's local-calendar-day totals by category, plus the five most recent activities with local timestamps and notes. All entries are retained in storage.
- Focus rewards: each accumulated 15-minute block within a local calendar day earns 5 XP and 2 food credits. Partial minutes carry across entries that day. Only the first 240 focus minutes per day earn rewards; additional time still appears in totals. Other categories never subtract XP or credits.
- Feeding costs 2 food credits, preserves XP, and briefly makes Mochi happy. Insufficient credits disable feeding.
- Lifetime XP progress toward the first 100-XP milestone.
- A configurable daily focus goal, defaulting to 60 minutes, with a valid range of 15–480 whole minutes. Goal progress is separate from lifetime XP and the reward cap; changing the goal never awards rewards.
- Gentle activity reactions, inline validation, accessible feedback, and keyboard focus indicators.
- Local persistence with validation and migration of older focus-only entries.

Timer and manual logging live in the keyboard-accessible **Other ways to record time** disclosure. An active timer’s running, paused, or completed status remains visible when it is collapsed; **Open timer controls** reveals the controls. Rest stays intentional and is never inferred from browser inactivity.

For a fresh pet, logging 30 Focus minutes yields 10 XP and 4 credits. Feeding once leaves 10 XP and 2 credits. Refreshing retains those values when browser storage is available.

## Prepared for integration

The separate TypeScript contract in [extensionActivity.ts](src/integration/extensionActivity.ts) defines a proposed versioned extension aggregate with a stable event ID, literal `extension` source, category, start/end ISO timestamps, explicit active milliseconds, timezone and local date. It is not an implemented receiver or runtime validator.

Planned flow: **Extension → validated activity ingestion → existing reward logic → dashboard**. [Integration requirements](docs/extension-integration.md) specify active-tab/focused-window/active-user counting, stopping on idle or pause, atomic retry deduplication, local-midnight splitting, privacy-preserving category/time aggregates, and a future reward-authority cutoff to avoid overlapping manual/timer rewards. Current local tools keep their existing reward behavior until that integration is implemented.

## Not implemented yet

There is no Chrome extension, automatic browser detection, connection handshake, activity receiver, backend, authentication, or device sync. Website rules are saved locally for future tracking only. Saved activities, localStorage, and rule settings never imply a connected state. Future connected/tracking/paused status must come from the actual integration. Mochi does not read page contents, titles, full URLs, or browsing history.

## Branch dependency for this increment

`feature/tracking-dashboard` starts from timer commit `233bb7d` and depends on the still-unmerged [focus timer PR #1](https://github.com/keibored/mochi/pull/1). Its PR targets `feature/focus-timer` to show only this increment, preserving timer changes without duplicating their diff. Neither PR is merged automatically. After PR #1 is merged, retarget this PR to `main` and reconcile the base before merging.

## Local development

Use Node.js 24 LTS and npm. The test script runs TypeScript directly through Node's built-in test runner; Node.js 24 is the verified runtime for this project.

Install the locked dependencies:

```sh
npm ci
```

Start the Vite development server and open the local URL printed in the terminal:

```sh
npm run dev
```

Available checks and build commands:

```sh
npm test
npm run lint
npm run build
```

`npm test` runs the focused domain and storage tests in `tests/`. `npm run lint` runs ESLint. `npm run build` runs TypeScript checks and produces the Vite production build in `dist/`.

Preview a completed production build locally:

```sh
npm run preview
```

On Windows PowerShell, if execution policy blocks `npm.ps1`, use `npm.cmd` in place of `npm`, for example `npm.cmd run dev` and `npm.cmd test`.

No environment variables are currently required. Local `.env` files are ignored by Git; a future `.env.example` may contain placeholders only. Never place secrets in frontend environment variables: values used by browser code can be exposed in the built app.

## Persistence and limitations

The app stores one version-4 JSON record under `mochi.progress` in `localStorage`. It includes adoption, pet name, XP, food credits, activities (IDs, sources, categories, durations, notes, and ISO timestamps), the daily focus goal, the active timer session, and website category rules. Version-1 focus-only records migrate to Focus entries with empty notes and a default goal. Version-1 and version-2 entries become Manual entries. Version-3 timer records gain an empty website-rule list, preserving Manual/Timer sources and the entire active session. Migration preserves IDs, timestamps, adoption, notes, goals, XP, and spent food credits without replaying rewards. Website-rule edits use the existing shared lock and never change past entries or balances.

Progress belongs to the current browser profile and origin (scheme, host, and port). Different devices, browsers, or local server ports do not share it. Clearing site data removes it; private browsing or browser policies may prevent persistence. There is no server backup, account sync, or export. Activity history grows in the record and can eventually reach browser storage limits.

Unavailable storage shows a warning and leaves the app usable for the session. Malformed or unsupported records are preserved rather than overwritten; the app shows a fresh session and cannot save it over that unreadable data. Daily grouping uses the device's current local calendar and timezone. There is no automatic time tracking, and saved data is not protected against manual editing.

### Timer behavior and safety

A running timer continues while the page is closed, the device sleeps, or the tab is in the background. Remaining time is calculated from wall-clock timestamps, not by counting interval ticks. Pause stores only the elapsed running time; paused time never counts. Reloading restores running, paused, and completed-but-unsaved sessions. Changing the device clock can affect elapsed time. This is a personal elapsed-time tool, not verification that you were working; it does not inspect browser activity.

Completion displays **Focus session complete ♡**. Time and rewards are added only when you choose **Save session**. Saving creates one Focus activity through the same partial-minute and daily-cap reward calculations used for manual entries. Cancel asks for confirmation and adds no activity or rewards, including for completed-but-unsaved sessions.

For this increment, the entire saved session is attributed to its calculated **completion date in the current local timezone**, rather than its start date or the date you click Save. A session that crosses midnight belongs entirely to the day it finishes; it is not split between days. Returning the next day to save it does not move it to that later day. Manual entries continue to use their logging timestamp.

Each timer has a stable ID, also used as its saved activity ID. All progress mutations (including manual logs, feeding, goals, and timer actions) run under a shared Web Lock and read the newest record before writing. This prevents concurrent Mochi tabs from starting multiple active timers, resurrecting a saved session from stale state, or saving/rewarding one session twice. Tabs refresh from storage events and when brought back into view. Clearing or manually editing browser storage and unrelated older app versions are outside this guarantee.

The timer requires available `localStorage` and Web Locks support in a secure context, such as localhost or HTTPS. If either is unavailable, timer controls are disabled with an explanation and manual logging remains usable in memory. After a storage failure, the tab stays session-only until reload to avoid overwriting saved progress with unsaved changes. Reload when storage is available again to restore the last successfully saved record.

To try the flow locally, adopt Mochi if needed, set a 1-minute timer, Start, Pause, refresh, Resume, and wait for completion. Save once and confirm a Timer entry appears, then refresh or open another Mochi tab to verify it stays a single entry. One minute alone earns no reward; a fresh 30-minute saved session earns 10 XP and 4 credits. Try Cancel and Keep session, then confirm cancellation on another session and verify no activity is added. Manual logging and feeding remain available alongside the timer.

### Tracking-dashboard manual checks

1. Run `npm run dev` and adopt Mochi if needed. Confirm the primary status reads “Browser tracking isn’t connected yet.” and no connection action is offered.
2. Save `https://EXAMPLE.com/work?private=value#part` as a Focus rule. The saved hostname should be `example.com`; adding it again should show a duplicate error. Edit its category or hostname, refresh, then remove it. Balances and old activities should not change.
3. Confirm `example.com` does not include `www.example.com`; each needs its own explicit rule. Invalid hosts and non-HTTP(S) protocols should show an inline error.
4. Tab to **Other ways to record time** and use Enter or Space to expand/collapse it. Start a 1-minute timer, collapse the section, and confirm the active notice remains visible. Open its controls, pause, refresh, resume, complete and save once. Manual logging remains available in the same section.
5. Check the layout at desktop and narrow mobile widths, keyboard focus outlines, accurate source labels and persisted rules in another tab. Browser layout/keyboard checks require a real browser and are not covered by domain tests.

## Git and GitHub workflow

The existing GitHub remote is `origin`: <https://github.com/keibored/mochi>. GitHub repository visibility and remote configuration must only change with the owner's direction.

- `main` is the stable baseline.
- Create a feature branch for each next increment.
- Make focused commits, run tests, lint, and build, and review the diff before committing.
- Push the feature branch and merge through a pull request when GitHub is connected. Keep `main` passing checks.
- Complete the main web app before starting the Chrome extension. Backend work is also a later phase.
- Never commit secrets, `node_modules/`, build output, or logs. Never force-push or discard others' changes to resolve divergence.

Once the baseline is pushed, start a new increment from a clean working tree:

```sh
git switch main
git pull --ff-only origin main
git switch -c feature/next-increment
```

After implementing a focused change:

```sh
npm test
npm run lint
npm run build
git diff --check
git diff
git status --short
```

Stage only the intended paths with `git add`, review `git diff --cached`, and make a focused commit. Then push the feature branch:

```sh
git push -u origin feature/next-increment
```

Open a pull request against `main`, review it, and merge after checks pass. If the remote has unexpected history or a push is rejected, inspect and reconcile the histories without overwriting either side.
