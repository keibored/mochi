import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import type { ChromeApi } from '../src/chromeApi.ts'
import { TrackerController } from '../src/controller.ts'
import type { Response } from '../src/controller.ts'
import { registerWorker, CHECKPOINT_ALARM } from '../src/worker.ts'
import { freshState, isTrackingState, localDay, MAX_SUMMARIES, prune, RETENTION_MS, STORAGE_KEY } from '../src/model.ts'

process.env.TZ = 'Asia/Manila'
class Event<Args extends unknown[]> {
  listeners: ((...args: Args) => void)[] = []
  addListener(listener: (...args: Args) => void) { this.listeners.push(listener) }
  emit(...args: Args) { this.listeners.forEach((listener) => listener(...args)) }
}
function harness(at = new Date(2026, 10, 12, 12).getTime()) {
  let wall = at, mono = 0, sequence = 0, tabQueries = 0
  let focused = true, idle: 'active' | 'idle' | 'locked' = 'active'
  let url = 'https://study.example/path?q=private', incognito = false, loading = false
  let raw: unknown, failWrite = false
  const events = {
    activated: new Event<[{ tabId: number; windowId: number }]>(),
    updated: new Event<[number, { url?: string; status?: string }, { windowId: number; active: boolean; incognito: boolean }]>(),
    removed: new Event<[number, { windowId: number; isWindowClosing: boolean }]>(),
    focus: new Event<[number]>(), windowRemoved: new Event<[number]>(),
    idle: new Event<['active' | 'idle' | 'locked']>(), alarm: new Event<[{ name: string }]>(),
    startup: new Event<[]>(), installed: new Event<[{ reason: string }]>(),
  }
  let messageHandler: Parameters<ChromeApi['runtime']['onMessage']['addListener']>[0] | undefined
  const api: ChromeApi = {
    tabs: { query: async () => { tabQueries++; return [{ id: 2, windowId: 1, active: true, url, incognito, status: loading ? 'loading' : 'complete' }] },
      onActivated: events.activated, onUpdated: events.updated, onRemoved: events.removed },
    windows: { getAll: async () => [{ id: 1, focused, incognito }], onFocusChanged: events.focus, onRemoved: events.windowRemoved },
    idle: { queryState: async () => idle, setDetectionInterval: (seconds) => { assert.equal(seconds, 60) }, onStateChanged: events.idle },
    storage: { local: {
      get: async () => raw === undefined ? {} : { [STORAGE_KEY]: structuredClone(raw) },
      set: async (values) => { if (failWrite) throw new Error('Storage write failed'); raw = structuredClone(values[STORAGE_KEY]) },
    } },
    alarms: { get: async () => undefined, create: async (_name, info) => { assert.equal(info.periodInMinutes, 0.5) }, onAlarm: events.alarm },
    runtime: { id: 'mochi-test', getURL: (path) => `chrome-extension://mochi-test/${path}`,
      onStartup: events.startup, onInstalled: events.installed,
      onMessage: { addListener: (listener) => { messageHandler = listener } },
      sendMessage: async () => undefined, openOptionsPage: async () => undefined },
  }
  const clock = { now: () => wall, monotonic: () => mono, id: () => `summary-${++sequence}`,
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone }
  return {
    api, clock, events, tracker: () => new TrackerController(api, clock),
    advance: (ms: number, sleep = false) => { wall += ms; if (!sleep) mono += ms },
    set: (value: { url?: string; focused?: boolean; idle?: typeof idle; incognito?: boolean; loading?: boolean }) => {
      url = value.url ?? url; focused = value.focused ?? focused; idle = value.idle ?? idle
      incognito = value.incognito ?? incognito; loading = value.loading ?? loading
    },
    raw: () => structuredClone(raw), tabQueries: () => tabQueries,
    fail: (value: boolean) => { failWrite = value }, corrupt: (value: unknown) => { raw = value },
    send: (request: unknown, sender = { id: 'mochi-test', url: 'chrome-extension://mochi-test/popup.html' }) =>
      new Promise<unknown>((resolve) => { const accepted = messageHandler?.(request, sender, resolve); if (!accepted) resolve('rejected') }),
  }
}
function report(response: Response) { assert.equal(response.ok, true, !response.ok ? response.error : ''); if (!response.ok) throw new Error(response.error); return response.report }
async function configured(h: ReturnType<typeof harness>) {
  const tracker = h.tracker()
  report(await tracker.run({ kind: 'rule-save', hostname: 'study.example', category: 'Focus' }))
  report(await tracker.run({ kind: 'rule-save', hostname: 'play.example', category: 'Leisure' }))
  report(await tracker.run({ kind: 'enable' }))
  return tracker
}

test('tracking is opt-in, does not inspect tab URLs while off, and persists preferences', async () => {
  const h = harness(), tracker = h.tracker()
  assert.equal(report(await tracker.run()).status, 'Tracking off')
  assert.equal(h.tabQueries(), 0)
  report(await tracker.run({ kind: 'enable' }))
  report(await tracker.run({ kind: 'pause' }))
  assert.equal(report(await h.tracker().run()).status, 'Paused')
  assert.equal(isTrackingState(h.raw()), true)
})

test('automatic categories count Focus, Leisure and unknown Neutral without saved rules', async () => {
  const h = harness(), tracker = h.tracker()
  h.set({ url: 'https://developer.mozilla.org/en-US/docs/Web' })
  const enabled = report(await tracker.run({ kind: 'enable' }))
  assert.deepEqual(enabled.state.rules, [])
  assert.equal(enabled.category, 'Focus')
  assert.equal(enabled.classificationOrigin, 'Automatic')
  h.advance(4000); h.set({ url: 'https://www.netflix.com/watch/123' })
  const leisure = report(await tracker.run())
  assert.equal(leisure.category, 'Leisure')
  assert.equal(leisure.classificationOrigin, 'Automatic')
  h.advance(3000); h.set({ url: 'https://unlisted.example/private' })
  const unknown = report(await tracker.run())
  assert.equal(unknown.category, 'Neutral')
  assert.equal(unknown.classificationOrigin, 'Unclassified')
  h.advance(2000)
  const result = report(await tracker.run())
  assert.deepEqual(result.totalsMs, { Focus: 4000, Leisure: 3000, Neutral: 2000 })
  assert.deepEqual(result.state.rules, [], 'classification must not manufacture saved overrides')
  assert.deepEqual(report(await tracker.run()).totalsMs, result.totalsMs, 'repeated reports cannot duplicate elapsed time')
})

test('overriding and removing an automatic category only changes future active time', async () => {
  const h = harness(), tracker = h.tracker()
  h.set({ url: 'https://developer.mozilla.org/en-US/docs/Web' })
  report(await tracker.run({ kind: 'enable' }))
  h.advance(9000)
  const overridden = report(await tracker.run({ kind: 'rule-save', hostname: 'developer.mozilla.org', category: 'Neutral' }))
  assert.deepEqual(overridden.totalsMs, { Focus: 9000, Leisure: 0, Neutral: 0 })
  assert.equal(overridden.category, 'Neutral')
  assert.equal(overridden.classificationOrigin, 'Your override')
  const focus = structuredClone(overridden.state.summaries[0])
  h.advance(4000)
  const removed = report(await tracker.run({ kind: 'rule-remove', hostname: 'developer.mozilla.org' }))
  assert.equal(removed.category, 'Focus')
  assert.equal(removed.classificationOrigin, 'Automatic')
  assert.deepEqual(removed.totalsMs, { Focus: 9000, Leisure: 0, Neutral: 4000 })
  assert.deepEqual(removed.state.summaries.find((entry) => entry.eventId === focus.eventId), focus,
    'a rule change must not rewrite existing time or its revision')
  h.advance(2000)
  const result = report(await tracker.run())
  assert.deepEqual(result.totalsMs, { Focus: 11_000, Leisure: 0, Neutral: 4000 })
  assert.equal(result.state.summaries.find((entry) => entry.category === 'Focus')?.eventId, focus.eventId)
  assert.deepEqual(report(await tracker.run()).totalsMs, result.totalsMs)
})

test('v1 and v2 saved category rules remain overrides without reclassifying recorded totals', async () => {
  for (const version of [1, 2]) {
    const h = harness()
    const legacySummary = { schemaVersion: 1, eventId: 'already-recorded-focus', source: 'extension', category: 'Focus',
      startedAtIso: new Date(h.clock.now() - 5000).toISOString(), endedAtIso: new Date(h.clock.now()).toISOString(),
      activeDurationMs: 5000, timeZone: h.clock.timeZone(), localDate: localDay(h.clock.now()), finalized: false }
    const summary = version === 1 ? legacySummary : { ...legacySummary, revision: 3, epochId: null }
    const rules = [{ hostname: 'developer.mozilla.org', category: 'Leisure' }]
    h.corrupt({ version, enabled: true, paused: false, rules, summaries: [summary], checkpointAt: h.clock.now(),
      ...(version === 2 ? { pairing: null, pendingPairing: null } : {}) })
    h.set({ url: 'https://developer.mozilla.org/en-US/' })
    const tracker = h.tracker(), restored = report(await tracker.run())
    assert.equal(restored.category, 'Leisure', `v${version} saved choice must beat automatic Focus`)
    assert.equal(restored.classificationOrigin, 'Your override')
    assert.deepEqual(restored.state.rules, rules)
    assert.deepEqual(restored.totalsMs, { Focus: 5000, Leisure: 0, Neutral: 0 })
    assert.equal(restored.state.summaries[0].eventId, legacySummary.eventId)
    assert.equal(restored.state.summaries[0].category, 'Focus')
    assert.equal(restored.state.summaries[0].revision, version === 1 ? 1 : 3)
    h.advance(2000)
    const after = report(await tracker.run())
    assert.deepEqual(after.totalsMs, { Focus: 5000, Leisure: 2000, Neutral: 0 })
    assert.deepEqual(after.state.summaries[0], restored.state.summaries[0])
  }
})

test('tab switches and category navigation do not overlap and retain sub-minute time', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(10_125); h.set({ url: 'https://play.example/watch?secret=x' })
  report(await tracker.run())
  h.advance(5000); h.set({ url: 'https://study.example/other' })
  report(await tracker.run())
  h.advance(750)
  const result = report(await tracker.run())
  assert.deepEqual(result.totalsMs, { Focus: 10_875, Leisure: 5000, Neutral: 0 })
  const persisted = JSON.stringify(h.raw())
  assert.equal(persisted.includes('watch'), false)
  assert.equal(persisted.includes('secret'), false)
  assert.equal(persisted.includes('study.example/path'), false)
})

test('browser blur/focus closes the previous interval and excludes time in other apps', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(5000); h.set({ focused: false })
  assert.equal(report(await tracker.run()).status, 'Browser unfocused')
  h.advance(20_000); h.set({ focused: true }); report(await tracker.run())
  h.advance(3000)
  assert.equal(report(await tracker.run()).totalsMs.Focus, 8000)
})

test('idle, locked, and resume exclude inactive intervals', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(8000); h.set({ idle: 'idle' }); assert.equal(report(await tracker.run()).status, 'Idle')
  h.advance(20_000); h.set({ idle: 'locked' }); report(await tracker.run())
  h.advance(20_000); h.set({ idle: 'active' }); report(await tracker.run())
  h.advance(2000)
  assert.equal(report(await tracker.run()).totalsMs.Focus, 10_000)
})

test('pause/resume and disabling never count paused or off time', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(4000); assert.equal(report(await tracker.run({ kind: 'pause' })).status, 'Paused')
  h.advance(20_000); report(await tracker.run({ kind: 'resume' }))
  h.advance(2000); report(await tracker.run({ kind: 'disable' }))
  h.advance(20_000)
  const result = report(await tracker.run())
  assert.equal(result.status, 'Tracking off'); assert.equal(result.totalsMs.Focus, 6000)
})

test('worker recovery drops unconfirmed tails and cannot count checkpoints twice', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(12_000); const first = report(await tracker.run())
  const id = first.state.summaries[0].eventId
  h.advance(20_000); const recovered = h.tracker()
  assert.equal(report(await recovered.run()).totalsMs.Focus, 12_000)
  h.advance(4000)
  const result = report(await recovered.run())
  assert.equal(result.totalsMs.Focus, 16_000)
  assert.equal(result.state.summaries[0].eventId, id)
  assert.equal(report(await recovered.run()).totalsMs.Focus, 16_000)
})

test('browser restart and long sleep gaps are never backfilled', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(5000); report(await tracker.run())
  h.advance(8 * 60 * 60_000, true)
  const restarted = h.tracker()
  assert.equal(report(await restarted.run()).totalsMs.Focus, 5000)
  h.advance(120_000)
  assert.equal(report(await restarted.run()).totalsMs.Focus, 5000, 'even matching wall/monotonic long gaps are uncertain')
  h.advance(30_000, true)
  assert.equal(report(await restarted.run()).totalsMs.Focus, 5000, 'monotonic/wall divergence drops short sleep')
  h.advance(2000)
  assert.equal(report(await restarted.run()).totalsMs.Focus, 7000)
})

test('splits actual milliseconds at local midnight and finalizes immutable day summaries', async () => {
  const midnight = new Date(2026, 10, 13).getTime()
  const h = harness(midnight - 10_000), tracker = await configured(h)
  h.advance(20_000)
  const result = report(await tracker.run())
  assert.equal(result.state.summaries.length, 2)
  assert.deepEqual(result.state.summaries.map((item) => item.activeDurationMs), [10_000, 10_000])
  assert.equal(result.state.summaries[0].localDate, '2026-11-12')
  assert.equal(result.state.summaries[0].finalized, true)
  const finalized = structuredClone(result.state.summaries[0])
  h.advance(3000)
  assert.deepEqual(report(await tracker.run()).state.summaries[0], finalized)
  assert.equal(result.totalsMs.Focus, 10_000)
})

test('unknown sites are Neutral; incognito, loading and unsupported pages are ignored', async () => {
  const h = harness(), tracker = await configured(h)
  h.set({ url: 'https://unknown.example' }); report(await tracker.run())
  h.advance(1500); h.set({ url: 'chrome://newtab/' }); report(await tracker.run())
  h.advance(1500); h.set({ url: 'chrome-extension://mochi-test/options.html' }); report(await tracker.run())
  h.advance(1500); h.set({ url: 'https://study.example', incognito: true }); report(await tracker.run())
  h.advance(1500); h.set({ incognito: false, loading: true }); report(await tracker.run())
  h.advance(1500)
  const result = report(await tracker.run())
  assert.deepEqual(result.totalsMs, { Focus: 0, Leisure: 0, Neutral: 1500 })
})

test('category rule changes close the old category before applying future rules', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(9000)
  report(await tracker.run({ kind: 'rule-save', hostname: 'study.example', category: 'Leisure', originalHostname: 'study.example' }))
  h.advance(3000)
  assert.deepEqual(report(await tracker.run()).totalsMs, { Focus: 9000, Leisure: 3000, Neutral: 0 })
  h.advance(1000); report(await tracker.run({ kind: 'rule-remove', hostname: 'study.example' }))
  h.advance(2000)
  assert.deepEqual(report(await tracker.run()).totalsMs, { Focus: 9000, Leisure: 4000, Neutral: 2000 })
})

test('failed storage writes leave the last saved record intact and never replay the failed tail', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(5000); report(await tracker.run())
  const saved = h.raw()
  h.advance(5000); h.fail(true)
  assert.equal((await tracker.run()).ok, false)
  assert.deepEqual(h.raw(), saved)
  h.advance(3000); h.fail(false)
  assert.equal(report(await tracker.run()).totalsMs.Focus, 5000)
  h.advance(2000); assert.equal(report(await tracker.run()).totalsMs.Focus, 7000)
})

test('serialized simultaneous events never multiply a single interval', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(10_000)
  const results = await Promise.all([tracker.run(), tracker.run(), tracker.run()])
  assert.equal(report(results[2]).totalsMs.Focus, 10_000)
})

test('Chrome event wiring checkpoints real state and popup senders cannot select a different tab', async () => {
  const h = harness(), tracker = registerWorker(h.api, h.clock)
  await tracker.run()
  report(await tracker.run({ kind: 'rule-save', hostname: 'study.example', category: 'Focus' }))
  report(await tracker.run({ kind: 'rule-save', hostname: 'play.example', category: 'Leisure' }))
  report(await tracker.run({ kind: 'enable' }))
  h.advance(2000); h.set({ url: 'https://play.example' }); h.events.activated.emit({ tabId: 2, windowId: 1 })
  await tracker.run()
  h.advance(3000); h.events.alarm.emit({ name: CHECKPOINT_ALARM })
  const result = await h.send({ kind: 'report', tabId: 999 }) as Response
  assert.deepEqual(report(result).totalsMs, { Focus: 2000, Leisure: 3000, Neutral: 0 })
  assert.equal(report(result).hostname, 'play.example')
  assert.equal(await h.send({ kind: 'enable' }, { id: 'external', url: 'https://evil.example' }), 'rejected')
  h.advance(2000); h.set({ focused: false }); h.events.removed.emit(2, { windowId: 1, isWindowClosing: true }); h.events.windowRemoved.emit(1)
  const closed = report(await tracker.run())
  assert.equal(closed.status, 'Browser unfocused')
  assert.deepEqual(closed.totalsMs, { Focus: 2000, Leisure: 5000, Neutral: 0 })
  h.advance(20_000)
  assert.deepEqual(report(await tracker.run()).totalsMs, closed.totalsMs)
})

test('malformed storage is preserved, and retention is bounded', async () => {
  const h = harness(), tracker = h.tracker()
  h.corrupt({ version: 999, enabled: true })
  assert.equal((await tracker.run()).ok, false)
  assert.deepEqual(h.raw(), { version: 999, enabled: true })
  const state = freshState()
  for (let i = 0; i < MAX_SUMMARIES + 5; i++) state.summaries.push({
    schemaVersion: 1, eventId: String(i), source: 'extension', category: 'Focus',
    startedAtIso: new Date(h.clock.now() - 1000).toISOString(), endedAtIso: new Date(h.clock.now()).toISOString(),
    activeDurationMs: 1000, timeZone: h.clock.timeZone(), localDate: localDay(h.clock.now()), finalized: true, revision: 1, epochId: null,
  })
  assert.equal(prune(state, h.clock.now(), h.clock.timeZone()).summaries.length, MAX_SUMMARIES)
  assert.equal(prune(state, h.clock.now() + RETENTION_MS + 1, h.clock.timeZone()).summaries.length, 0)
})

test('invalid rule input does not discard an otherwise healthy active interval', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(10_000)
  assert.equal((await tracker.run({ kind: 'rule-save', hostname: 'ftp://bad.example', category: 'Focus' })).ok, false)
  h.advance(5000)
  assert.equal(report(await tracker.run()).totalsMs.Focus, 15_000)
})

test('startup and installation events discard even short recovery gaps', async () => {
  const h = harness(), tracker = registerWorker(h.api, h.clock)
  await tracker.run()
  report(await tracker.run({ kind: 'enable' }))
  h.advance(10_000); h.events.startup.emit(); await tracker.run()
  h.advance(3000); h.events.installed.emit({ reason: 'update' }); await tracker.run()
  assert.equal(report(await tracker.run()).totalsMs.Neutral, 0)
  h.advance(2000)
  assert.equal(report(await tracker.run()).totalsMs.Neutral, 2000)
})

test('clock rollback cannot credit the same wall-clock interval again', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(10_000); report(await tracker.run())
  h.advance(-5000); report(await tracker.run())
  h.advance(5000); report(await tracker.run())
  assert.equal(report(await tracker.run()).totalsMs.Focus, 10_000)
  h.advance(2000)
  assert.equal(report(await tracker.run()).totalsMs.Focus, 12_000)
})

test('timezone changes drop the uncertain tail and preserve original aggregate attribution', async () => {
  const h = harness(), tracker = await configured(h)
  h.advance(5000); const before = report(await tracker.run()).state.summaries[0]
  h.advance(3000)
  process.env.TZ = 'America/New_York'
  try {
    const changed = report(await tracker.run())
    assert.equal(changed.state.summaries[0].activeDurationMs, 5000)
    assert.equal(changed.state.summaries[0].timeZone, before.timeZone)
    assert.equal(changed.state.summaries[0].finalized, true)
    h.advance(2000)
    const after = report(await tracker.run())
    assert.equal(after.state.summaries.length, 2)
    assert.equal(after.state.summaries[1].timeZone, 'America/New_York')
    assert.equal(after.state.summaries[1].activeDurationMs, 2000)
  } finally { process.env.TZ = 'Asia/Manila' }
})

test('navigation, focus and idle Chrome listeners gate future accumulation', async () => {
  const h = harness(), tracker = registerWorker(h.api, h.clock)
  await tracker.run()
  await tracker.run({ kind: 'enable' })
  h.advance(2000); h.set({ url: 'https://new.example' })
  h.events.updated.emit(2, { url: 'https://new.example' }, { windowId: 1, active: true, incognito: false }); await tracker.run()
  h.advance(1000); h.set({ focused: false }); h.events.focus.emit(-1); await tracker.run()
  h.advance(10_000); h.set({ focused: true }); h.events.focus.emit(1); await tracker.run()
  h.advance(1000); h.set({ idle: 'idle' }); h.events.idle.emit('idle'); await tracker.run()
  h.advance(10_000); h.set({ idle: 'active' }); h.events.idle.emit('active'); await tracker.run()
  h.advance(1000)
  assert.equal(report(await tracker.run()).totalsMs.Neutral, 5000)
})
