import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { TrackerController } from '../extension/src/controller.ts'
import type { ChromeApi } from '../extension/src/chromeApi.ts'
import { callExtension } from '../src/integration/extensionTransport.ts'
import type { SyncReply } from '../src/integration/syncProtocol.ts'
import { APP_ORIGIN } from '../src/integration/localConfig.ts'
import { WEBSITE_CATALOG_VERSION } from '../src/websiteCatalog.ts'
import { freshPet, petReducer } from '../src/petState.ts'
import { petExpression } from '../src/petPresentation.ts'
import { isPetState, readPet, STORAGE_KEY, transactPet } from '../src/storage.ts'

process.env.TZ = 'Asia/Manila'
const minute = 60_000
const startedAt = new Date(2026, 10, 15, 9).getTime()
type Snapshot = Extract<SyncReply, { kind: 'snapshot' }>

/** Mocked browser APIs, actual tracker/transport/domain/storage, controlled time. */
function loop() {
  let now = startedAt, monotonic = 0, id = 0, requestSequence = 0
  let url = 'https://developer.mozilla.org/en-US/docs/Web'
  let focused = true, idle: 'active' | 'idle' | 'locked' = 'active'
  const extensionId = 'a'.repeat(32)
  let extensionRecord: Record<string, unknown> = {}
  let webRecord = JSON.stringify(petReducer(freshPet(now), { type: 'adopt' }))
  let lockQueue = Promise.resolve()
  const events = { addListener: () => undefined }
  const api: ChromeApi = {
    runtime: { id: extensionId, getURL: (path) => `chrome-extension://${extensionId}/${path}`, getManifest: () => ({ version: '0.4.0' }),
      onStartup: events, onInstalled: events, onMessage: events, sendMessage: async () => undefined, openOptionsPage: async () => undefined },
    tabs: { query: async () => [{ id: 1, windowId: 1, active: true, incognito: false, url, status: 'complete' }],
      onActivated: events, onUpdated: events, onRemoved: events },
    windows: { getAll: async () => [{ id: 1, focused, incognito: false }], onFocusChanged: events, onRemoved: events },
    idle: { queryState: async () => idle, setDetectionInterval: () => undefined, onStateChanged: events },
    alarms: { get: async () => undefined, create: async () => undefined, onAlarm: events },
    storage: { local: { get: async () => structuredClone(extensionRecord), set: async (values) => { extensionRecord = structuredClone(values) } } },
  }
  const clock = { now: () => now, monotonic: () => monotonic, id: () => String(++id).padStart(36, '0'), timeZone: () => 'Asia/Manila' }
  let tracker = new TrackerController(api, clock)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: APP_ORIGIN }, setTimeout, clearTimeout,
    localStorage: { getItem: (key: string) => key === STORAGE_KEY ? webRecord : null,
      setItem: (_key: string, value: string) => { webRecord = value } },
  } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: <T>(name: string, callback: () => T) => {
      assert.equal(name, 'mochi.progress.update')
      const result = lockQueue.then(callback)
      lockQueue = result.then(() => undefined, () => undefined)
      return result
    },
  } } })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
    sendMessage: (_id: string, message: unknown, callback: (reply: unknown) => void) => {
      void tracker.external(message, { url: `${APP_ORIGIN}/`, origin: APP_ORIGIN, frameId: 0 }).then(callback)
    },
  } } })

  const run = async (command: unknown = { kind: 'report' }) => {
    const response = await tracker.run(command)
    assert.equal(response.ok, true, response.ok ? '' : response.error)
    if (!response.ok) throw new Error(response.error)
    return response.report
  }
  const ingest = (snapshot: Snapshot) => transactPet({ type: 'sync-ingest', epochId: snapshot.epochId, snapshots: snapshot.summaries, now })
  const poll = async () => {
    const pair = readPet().extensionSync.pairing!
    const snapshot = await callExtension(extensionId, { kind: 'sync', token: pair.token, epochId: pair.epochId })
    assert.equal(snapshot.kind, 'snapshot')
    if (snapshot.kind !== 'snapshot') throw new Error('Expected snapshot')
    await ingest(snapshot)
    return snapshot
  }
  const connect = async () => {
    const savedEpoch = readPet().extensionSync.pairing?.epochId
    const requestId = `care-connection-${++requestSequence}`, challenge = `random_care_challenge_${requestSequence}_123456789`
    const pending = await callExtension(extensionId, { kind: 'pair-request', requestId, challenge, ...(savedEpoch ? { resumeEpochId: savedEpoch } : {}) })
    assert.equal(pending.kind, 'pending')
    assert.equal(pending.extensionInfo.version, '0.4.0')
    assert.equal(pending.extensionInfo.catalogVersion, WEBSITE_CATALOG_VERSION)
    assert.deepEqual(pending.extensionInfo.capabilities, ['automatic-classification', 'revisioned-sync'])
    await run({ kind: 'sync-approve', requestId })
    const approval = await callExtension(extensionId, { kind: 'pair-claim', requestId, challenge })
    if (approval.kind !== 'approved') throw new Error('Expected explicit approval')
    const reserved = await transactPet({ type: 'sync-reserve', pairing: {
      extensionId, epochId: approval.epochId, token: approval.token, origin: APP_ORIGIN, reservedAt: now,
    } })
    const activated = await callExtension(extensionId, { kind: 'activate', token: approval.token, epochId: approval.epochId,
      reservedAt: reserved.pet.extensionSync.pairing!.reservedAt })
    if (activated.kind !== 'snapshot') throw new Error('Expected activated snapshot')
    await transactPet({ type: 'sync-activate', epochId: activated.epochId, extensionId, cutoffAt: activated.cutoffAt })
    await ingest(activated)
    return { approval, activated }
  }
  return {
    now: () => now, run, poll, ingest, connect,
    jump: (milliseconds: number) => { now += milliseconds; monotonic += milliseconds },
    advance: async (milliseconds: number) => {
      for (let remaining = milliseconds; remaining > 0;) {
        const step = Math.min(30_000, remaining)
        now += step; monotonic += step; remaining -= step
        await run()
      }
    },
    navigate: async (nextUrl: string) => { url = nextUrl; return run() },
    observe: async (state: { focused?: boolean; idle?: typeof idle }) => {
      focused = state.focused ?? focused; idle = state.idle ?? idle
      return run()
    },
    restartWorker: () => { tracker = new TrackerController(api, clock) },
    replaceSavedPet: (value: unknown) => { webRecord = JSON.stringify(value) },
  }
}

test('automatic Focus through the approved callback bridge earns one reward and three energy points in 15 active minutes', async () => {
  const h = loop()
  const { approval, activated } = await h.connect()
  assert.equal(activated.liveStatus, 'Tracking off', 'approval must preserve the actual tracking preference')
  const enabled = await h.run({ kind: 'enable' })
  assert.deepEqual([enabled.category, enabled.classificationOrigin, enabled.state.rules.length], ['Focus', 'Automatic', 0])
  await h.advance(30_000)
  await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [0, 0, 80])
  await h.advance(4.5 * minute)
  const firstBlock = await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [0, 0, 79])
  await h.advance(10 * minute)
  const completed = await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [5, 2, 77])
  assert.equal(completed.summaries[0].activeDurationMs, 15 * minute)
  await Promise.all([h.ingest(completed), h.ingest(completed), h.ingest(firstBlock)])
  const persisted = readPet()
  assert.deepEqual([persisted.xp, persisted.foodCredits, persisted.care.energy], [5, 2, 77])
  assert.equal(isPetState(persisted), true)
  h.restartWorker()
  assert.deepEqual(await h.poll().then(() => readPet()), persisted, 'fresh worker and re-read do not replay accepted time')
  const renewed = await h.connect()
  assert.equal(renewed.approval.epochId, approval.epochId)
  assert.equal(renewed.activated.cutoffAt, activated.cutoffAt)
  assert.notEqual(renewed.approval.token, approval.token)
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [5, 2, 77])
  await h.advance(5 * minute)
  await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [5, 2, 76])
})

test('automatic Leisure beyond the allowance makes a snack meaningful without duplicating Focus or hunger', async () => {
  const h = loop()
  await h.connect(); await h.run({ kind: 'enable' })
  await h.advance(15 * minute); await h.poll()
  const leisure = await h.navigate('https://www.netflix.com/browse')
  assert.deepEqual([leisure.category, leisure.classificationOrigin], ['Leisure', 'Automatic'])
  await h.advance(60 * minute); await h.poll()
  assert.equal(readPet().care.fullness, 80)
  await h.advance(15 * minute - 1); await h.poll()
  assert.equal(readPet().care.fullness, 80)
  await h.advance(1)
  const snapshot = await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.fullness, readPet().care.energy], [5, 2, 75, 77])
  await Promise.all([h.ingest(snapshot), h.ingest(snapshot)])
  const fed = await transactPet({ type: 'feed' })
  assert.equal(fed.changed, true)
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.fullness, readPet().care.energy], [5, 0, 95, 77])
  h.restartWorker(); await h.poll()
  assert.deepEqual([readPet().foodCredits, readPet().care.fullness, readPet().care.energy], [0, 95, 77])
})

test('Neutral, idle, unfocused, paused and unobserved browser time do not change care or invent rewards', async () => {
  const h = loop()
  await h.connect(); await h.run({ kind: 'enable' })
  await h.advance(5 * minute); await h.poll()
  const neutral = await h.navigate('https://unclassified.example/path')
  assert.deepEqual([neutral.category, neutral.classificationOrigin], ['Neutral', 'Unclassified'])
  await h.advance(10 * minute); await h.poll()
  await h.navigate('https://developer.mozilla.org/en-US/')
  assert.equal((await h.observe({ idle: 'idle' })).status, 'Idle')
  await h.advance(10 * minute); await h.poll()
  assert.equal((await h.observe({ idle: 'active', focused: false })).status, 'Browser unfocused')
  await h.advance(10 * minute); await h.poll()
  await h.observe({ focused: true })
  await h.run({ kind: 'pause' })
  await h.advance(10 * minute)
  assert.equal((await h.poll()).liveStatus, 'Paused')
  await h.run({ kind: 'resume' })
  h.jump(5 * minute) // Deliberately no event/checkpoint: the tracker must discard this uncertain gap.
  await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.fullness, readPet().care.energy], [0, 0, 80, 79])
  await h.advance(5 * minute); await h.poll()
  assert.deepEqual([readPet().xp, readPet().care.energy], [0, 78])
})

test('actual automatic Focus keeps the 240-minute reward cap while energy still reflects new active time', async () => {
  const h = loop()
  await h.connect(); await h.run({ kind: 'enable' })
  await h.advance(240 * minute); await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [80, 32, 32])
  await h.advance(30 * minute); const capped = await h.poll()
  assert.equal(capped.summaries[0].activeDurationMs, 270 * minute)
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [80, 32, 26])
  assert.equal(petExpression(readPet().care, readPet().timer, h.now()), 'tired')
})

test('actual synced care derives hungry and sleeping expressions and feeding recovers fullness', async () => {
  const h = loop()
  await h.connect(); await h.run({ kind: 'enable' })
  await h.advance(15 * minute); await h.poll()
  await h.navigate('https://www.netflix.com/browse')
  await h.advance(195 * minute); await h.poll()
  assert.equal(readPet().care.fullness, 35)
  assert.equal(petExpression(readPet().care, readPet().timer, h.now()), 'hungry')
  await transactPet({ type: 'feed' })
  assert.deepEqual([readPet().care.fullness, readPet().foodCredits], [55, 0])
  assert.equal(petExpression(readPet().care, readPet().timer, h.now()), 'cozy')
  await transactPet({ type: 'care-rest-start', id: 'rest-expression-loop', now: h.now() })
  assert.equal(petExpression(readPet().care, readPet().timer, h.now()), 'sleeping')
  await transactPet({ type: 'care-wake', restId: 'rest-expression-loop', now: h.now() })
  assert.equal(petExpression(readPet().care, readPet().timer, h.now()), 'cozy')
})

test('optional Timer sessions save once without adding overlapping browser energy costs or rewards', async () => {
  const h = loop()
  await transactPet({ type: 'timer-start', id: 'timer-before-connection', duration: 5, now: h.now() })
  h.jump(5 * minute)
  await transactPet({ type: 'timer-save', id: 'timer-before-connection', now: h.now() })
  assert.equal(readPet().care.energy, 79, 'before browser authority, a real timer uses energy')
  await h.connect(); await h.run({ kind: 'enable' })
  await transactPet({ type: 'timer-start', id: 'timer-optional-overlap', duration: 15, now: h.now() })
  await h.advance(15 * minute)
  await transactPet({ type: 'care-tick', now: h.now() })
  assert.equal(readPet().care.energy, 79, 'optional timer cursor advances without a second energy debit')
  await h.poll()
  const saved = await transactPet({ type: 'timer-save', id: 'timer-optional-overlap', now: h.now() })
  assert.deepEqual([saved.xpAwarded, saved.creditsAwarded], [0, 0])
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy, readPet().activities.length], [5, 2, 76, 2])
  assert.equal((await transactPet({ type: 'timer-save', id: 'timer-optional-overlap', now: h.now() })).changed, false)
})

test('intentional Rest restores energy and Wake baselines buffered Focus before charging only future deltas', async () => {
  const h = loop()
  await h.connect(); await h.run({ kind: 'enable' })
  await h.advance(4 * minute); await h.poll()
  await transactPet({ type: 'care-rest-start', id: 'rest-browser-loop', now: h.now() })
  await h.advance(5 * minute) // Real browser Focus accumulates but has not been ingested during this rest.
  await transactPet({ type: 'care-tick', now: h.now() })
  assert.equal(readPet().care.energy, 85)
  await transactPet({ type: 'care-wake', restId: 'rest-browser-loop', now: h.now() })
  await h.poll()
  assert.equal(readPet().care.energy, 85, 'buffered Focus from the rest interval cannot undo its recovery')
  await h.advance(5 * minute); await h.poll()
  assert.equal(readPet().care.energy, 84)
  await h.advance(minute); await h.poll()
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().care.energy], [5, 2, 84])
})

test('v6 migration preserves current care and all saved progress without charging accepted browser Focus again', async () => {
  const h = loop()
  await h.connect(); await h.run({ kind: 'enable' })
  await h.advance(30 * minute); await h.poll()
  await transactPet({ type: 'feed' })
  await h.navigate('https://www.netflix.com/browse')
  await h.advance(135 * minute); await h.poll()
  await transactPet({ type: 'goal', minutes: 90 })
  await transactPet({ type: 'rule-save', hostname: 'work.example', category: 'Focus' })
  await transactPet({ type: 'timer-start', id: 'timer-v6-paused', duration: 25, now: h.now() })
  h.jump(minute)
  await transactPet({ type: 'timer-pause', id: 'timer-v6-paused', now: h.now() })
  const previous = readPet()
  const oldCare = { ...previous.care }
  Reflect.deleteProperty(oldCare, 'focusEnergyPolicyAt')
  Reflect.deleteProperty(oldCare, 'focusEnergyDays')
  const legacy = { ...previous, version: 6, care: oldCare }
  h.replaceSavedPet(legacy)
  const migrated = (await transactPet({ type: 'care-tick', now: h.now() })).pet
  assert.equal(migrated.version, 7)
  const preserved = { ...migrated.care }
  Reflect.deleteProperty(preserved, 'focusEnergyPolicyAt')
  Reflect.deleteProperty(preserved, 'focusEnergyDays')
  assert.deepEqual(preserved, oldCare)
  for (const key of ['adopted', 'xp', 'foodCredits', 'activities', 'dailyFocusGoal', 'timer', 'websiteRules', 'extensionSync'] as const) {
    assert.deepEqual(migrated[key], previous[key], key)
  }
  assert.deepEqual([migrated.care.fullness, migrated.care.energy, migrated.foodCredits], [75, 74, 2])
  await h.poll()
  assert.deepEqual([readPet().care.fullness, readPet().care.energy, readPet().foodCredits], [75, 74, 2])
  assert.equal(isPetState(readPet()), true)
})
