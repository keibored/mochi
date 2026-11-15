# Mochi’s first care loop

Mochi is a fictional virtual pet whose care reacts to activity. These values never describe a person's health, worth, or intent. Consequences are reversible, and never remove XP, levels, or saved progress. There is no death, evolution artwork, backend, or account system.

## Rules and state priority

Configurable code constants live in `src/petCare.ts`; XP rates remain in `src/rewards.ts`. Fullness and energy are integers from 0 to 100. Existing and fresh pets start at **80 / 80**. A meal costs the existing **2 credits** and restores **20 fullness**, capped at 100. Feeding at 100 is a no-op and spends nothing, including rapid/concurrent clicks.

The default local-day Leisure allowance is **60 minutes**, editable in Settings from 0 to 1440 whole minutes. Only newly accepted eligible Leisure beyond it accumulates excess milliseconds. Every completed **15 excess minutes** uses **5 fullness**; partial minutes carry within that original local day. A new day gets a new allowance and remainder. Focus, Neutral, idle, time away, and missing messages never trigger wall-clock fullness decay.

Rest is an explicit ongoing session, separate from manually logging Rest history. Every completed **5 minutes** of that session restores **5 energy**, capped at 100. Wake settles completed blocks and ends rest. Newly accepted automatic Focus uses **1 energy per completed 5 active minutes**, carrying exact partial milliseconds within the original local day. This care cost is independent of the 240-minute XP cap. Low energy changes appearance only and never blocks rewards.

Before browser authority is reserved, the optional Focus timer supplies the energy clock instead, capped at its duration and excluding pauses. Its partial time carries across pauses within that session. Cancel/save settle its energy once and clear its cursor; cancellation still earns no XP. After browser authority, timer cursors advance without another energy debit, even while disconnected, so overlapping records cannot charge twice.

`src/petPresentation.ts` derives exactly one visible state, in this order:

1. Sleeping while intentional Rest is active.
2. Under the weather at fullness below 20.
3. Hungry at fullness below 40.
4. Tired at energy below 30.
5. Focusing while a running, unfinished Focus timer exists.
6. Happy temporarily after a genuine meal or newly committed XP reward.
7. Cozy otherwise.

No mood is persisted. Under-the-weather is a stylized bunny expression with a recovery heart, not a health judgment about the user. Feeding can improve fullness gradually even when a higher-priority hungry/tired expression still takes precedence over temporary happiness.

Every **100 lifetime XP** gives the next displayed level: level 1 at 0, level 2 at 100, level 3 at 200, and so on. The 15-minute daily quest uses existing eligible Focus progress, including the captured pre-connection baseline and daily cap. It has **no additional bonus or claim action**. Reward notifications use the actual before/after delta inside the storage lock; hydration/retries do not replay them.

## Source ownership and prospective changes

Before browser reward authority is reserved, newly accepted Manual Leisure entries use the allowance. After reservation, only accepted extension Leisure deltas do; optional manual/timer history is not a second care source, even while sync is paused or disconnected. The same sticky ownership applies to Focus energy: only accepted browser Focus can add new costs after reservation. Existing Focus XP rules and the 240-minute daily reward cap are unchanged.

Migration initializes care at 80/80 and baselines all existing eligible Leisure without losses. Those historical minutes can already consume that day's allowance. A running/paused old timer baselines its already elapsed active time so it is not charged retroactively. A first lock-protected care tick persists migration even if no stat block is due, keeping that baseline stable after reload.

Version 6 already has care. Its version-7 migration preserves every existing care value, allowance, rest session, timer cursor, and all progress; it only adds a separate automatic Focus cutoff and accepted-history baseline. It never resets an existing pet to 80/80. A first buffered Focus delta spanning the new cutoff is baseline-only; later precise deltas use energy. Leisure setting changes never reset Focus partials or its cutoff.

Changing the allowance never changes fullness immediately. Already observed minutes remain consumed, the old excess remainder is cleared, and a monotonic policy cutoff advances. Saving the same allowance preserves the cutoff and remainder. Queued Manual entries older than that cutoff are baseline-only. For cumulative extension data crossing an unknown cutoff, the first ambiguous increment is baseline-only; later validated increments can count. Old buffered data is never guessed into a retroactive penalty. This conservative policy can undercount one crossing increment.

Within one accepted batch, baseline-only deltas are accounted before eligible ones, independently of array order. A historical baseline arriving in a later batch consumes allowance for future deltas but never revises already committed fullness. This deliberately favors a conservative undercount over retroactive care losses.

Disconnection itself causes no penalty. Genuine activity actually recorded by the extension can be accepted later; it is not invented from the disconnected wall-clock gap. Old pre-policy buffered activity is baselined as above. Pausing/off/idle/unfocused states produce no eligible tracked time. Classification edits never rewrite old categories.

## Rest, timers, and persistence

Rest with a running unfinished timer asks for explicit **Pause timer & rest** confirmation. Both changes commit atomically and keep the timer. Wake never resumes it automatically. A paused or completed-but-unsaved timer remains intact during rest. Starting/resuming Focus while asleep requires Wake first; saving/cancelling a completed session remains available.

Intentional Rest baselines incoming Focus without charging energy. Rest and Wake advance the independent automatic energy cutoff and clear its fractional carry. A buffered crossing increment is conservatively baseline-only, avoiding charges for sleep time; only future eligible deltas cost energy. Rewards retain their existing accepted-time rules. Persistent timer notices derive from actual timestamps/state; transient care/timer feedback expires after five seconds and Wake makes no assumption about the current timer phase.

The version-7 `mochi.progress` record stores care with the original progress. Per-day Leisure and automatic Focus counters, independent policy cutoffs, timer baseline/accounted blocks, and Rest ID/start/accounted blocks are committed together under the existing Web Lock. Each accepted sync revision, rewards, and care delta share one atomic write. Care uses explicit timestamps and pure functions, not render-time mutations or tick counting. A lightweight 15-second foreground reconciliation and focus/visibility checks settle completed blocks; wake/pause/save/cancel also reconcile. A running timer and intentional Rest continue while the page is closed. Device-clock changes can affect elapsed sessions, but persisted high-water block counts prevent replay within a session.

Caps consume their accounting blocks even at 0/100, so later feeding or Focus cannot replay old losses/gains. Retries, stale IDs, out-of-order snapshots, and other tabs read the newest atomic record. Failed writes leave care, accepted activity, and balances unchanged. Feeding/timed care/settings require available durable storage. Corrupt records are preserved. There is no cross-device backup, and local history/ledgers can reach storage limits.

## Safe verification without altering real progress

Run the tests with controlled clocks and isolated in-memory storage:

```powershell
npm.cmd test
node --test tests/petCare.test.ts tests/careIntegration.test.ts tests/petPresentation.test.ts tests/petLevels.test.ts
npm.cmd run test:extension
npm.cmd run lint
npm.cmd run build
npm.cmd run build:extension
git diff --check
```

Fixtures exercise 0/19/20/39/40 fullness, 29/30 energy, all priorities, genuine rewards, migration, repeated clicks, idle/no-data behavior, milliseconds, midnight, allowance edits, pause/resume, rest, storage failure, and concurrent tabs. They run in separate Node test processes and never read/write the browser's real `mochi.progress`. No production threshold changes, fake real-history entries, or debug stat buttons are needed.

For actual UI checks, use normal actions and only time you actually spend. At 80 fullness with earned credits, Feed once reaches 100 and disables further meals. Rest for five real minutes restores five energy; refresh and Wake should not restore it again. After connection, five newly eligible active browser Focus minutes use one energy; an overlapping timer adds no second cost. Before connection, only the optional timer supplies that energy clock. Try Rest during a running timer and confirm it asks before pausing. Completed timers must remain saveable once through Rest/Wake. With a fresh local day, no earlier allowance use, and no meals, 195 actual Leisure minutes puts fullness at 35 (hungry), and 255 at 15 (under the weather). The fast automated fixtures cover those long-duration states without polluting real progress. `tests/trackingCareLoop.test.ts` exercises the actual controller, callback transport, domain, and locked storage with mocked browser APIs and a controlled clock; it does not prove real Brave delivery.

Use the same Brave profile at `http://localhost:5173/` to retain your progress. Browser visual/layout/keyboard verification is reported separately; unit/mocked tests do not prove real-browser delivery or visuals.
