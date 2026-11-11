# Mochi ♡

Mochi is a kawaii productivity companion: a little focus, a little rest, and a bunny by your side.

The main React + TypeScript web application is being built first, using Vite. Complete the main web app before starting the Chrome extension. The Chrome extension and backend are later phases; neither is implemented. There is currently no authentication, timer, automatic activity tracking, or external service integration.

## Current features

- A responsive pink-and-cream welcome screen, adoption flow, and emoji bunny dashboard.
- Manual activity logging for Focus, Leisure, Rest, and Neutral: whole durations of 1–240 minutes and optional notes up to 200 characters.
- Today's local-calendar-day totals by category, plus the five most recent activities with local timestamps and notes. All entries are retained in storage.
- Focus rewards: each accumulated 15-minute block within a local calendar day earns 5 XP and 2 food credits. Partial minutes carry across entries that day. Only the first 240 focus minutes per day earn rewards; additional time still appears in totals. Other categories never subtract XP or credits.
- Feeding costs 2 food credits, preserves XP, and briefly makes Mochi happy. Insufficient credits disable feeding.
- Lifetime XP progress toward the first 100-XP milestone.
- A configurable daily focus goal, defaulting to 60 minutes, with a valid range of 15–480 whole minutes. Goal progress is separate from lifetime XP and the reward cap; changing the goal never awards rewards.
- Gentle activity reactions, inline validation, accessible feedback, and keyboard focus indicators.
- Local persistence with validation and migration of older focus-only entries.

For a fresh pet, logging 30 Focus minutes yields 10 XP and 4 credits. Feeding once leaves 10 XP and 2 credits. Refreshing retains those values when browser storage is available.

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

The app stores one version-2 JSON record under `mochi.progress` in `localStorage`. It includes adoption, pet name, XP, food credits, activities (IDs, categories, durations, notes, and ISO timestamps), and the daily focus goal. Version-1 focus-only records migrate to Focus entries with empty notes and a default goal without replaying rewards or changing saved balances.

Progress belongs to the current browser profile and origin (scheme, host, and port). Different devices, browsers, or local server ports do not share it. Clearing site data removes it; private browsing or browser policies may prevent persistence. There is no server backup, account sync, export, or multi-tab conflict resolution. Simultaneous tabs may overwrite each other's valid progress. Activity history grows in the record and can eventually reach browser storage limits.

Unavailable storage shows a warning and leaves the app usable for the session. Malformed or unsupported records are preserved rather than overwritten; the app shows a fresh session and cannot save it over that unreadable data. Daily grouping uses the device's current local calendar and timezone. There is no automatic time tracking, and saved data is not protected against manual editing.

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
