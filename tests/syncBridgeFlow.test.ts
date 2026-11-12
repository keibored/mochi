import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { TrackerController } from '../extension/src/controller.ts'
import type { ChromeApi } from '../extension/src/chromeApi.ts'
import { callExtension } from '../src/integration/extensionTransport.ts'
import { APP_ORIGIN } from '../src/integration/localConfig.ts'
import { freshPet, petReducer } from '../src/petState.ts'
import { readPet, STORAGE_KEY, transactPet } from '../src/storage.ts'

process.env.TZ = 'Asia/Manila'

test('approved callback transport imports real producer revisions into durable web rewards once across reloads', async () => {
  let now = new Date(2026, 10, 12, 12).getTime(), monotonic = 0, id = 0
  const extensionId = 'a'.repeat(32)
  let extensionRecord: Record<string, unknown> = {}
  const events = { addListener: () => undefined }
  const api: ChromeApi = {
    runtime: { id: extensionId, getURL: (path) => `chrome-extension://${extensionId}/${path}`,
      onStartup: events, onInstalled: events, onMessage: events, sendMessage: async () => undefined, openOptionsPage: async () => undefined },
    tabs: { query: async () => [{ id: 1, windowId: 1, active: true, incognito: false, url: 'https://study.example/private?q=not-synced', status: 'complete' }],
      onActivated: events, onUpdated: events, onRemoved: events },
    windows: { getAll: async () => [{ id: 1, focused: true, incognito: false }], onFocusChanged: events, onRemoved: events },
    idle: { queryState: async () => 'active', setDetectionInterval: () => undefined, onStateChanged: events },
    alarms: { get: async () => undefined, create: async () => undefined, onAlarm: events },
    storage: { local: { get: async () => structuredClone(extensionRecord), set: async (values) => { extensionRecord = structuredClone(values) } } },
  }
  const clock = { now: () => now, monotonic: () => monotonic, id: () => String(++id).padStart(36, '0'), timeZone: () => 'Asia/Manila' }
  let tracker = new TrackerController(api, clock)
  const historical = petReducer(petReducer(freshPet(), { type: 'adopt' }), { type: 'log', activity: {
    id: 'old-focus', source: 'Manual', category: 'Focus', duration: 10, note: '', timestamp: new Date(now - 60_000).toISOString(),
  } })
  historical.websiteRules = [{ hostname: 'study.example', category: 'Neutral' }]
  let webRecord = JSON.stringify(historical)
  let lockQueue = Promise.resolve()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin: APP_ORIGIN }, setTimeout, clearTimeout,
    localStorage: { getItem: (key: string) => key === STORAGE_KEY ? webRecord : null,
      setItem: (_key: string, value: string) => { webRecord = value } },
  } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: <T>(_name: string, callback: () => T) => {
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
  await tracker.run({ kind: 'rule-save', hostname: 'study.example', category: 'Focus' })
  await tracker.run({ kind: 'enable' })
  now += 5000; monotonic += 5000
  await tracker.run()

  const requestId = 'connection-request', challenge = 'random_test_challenge_123456789'
  assert.equal((await callExtension(extensionId, { kind: 'pair-request', requestId, challenge })).kind, 'pending')
  assert.equal(readPet().extensionSync.authorityStartedAt, null, 'a request alone grants no authority')
  await tracker.run({ kind: 'sync-approve', requestId })
  const approval = await callExtension(extensionId, { kind: 'pair-claim', requestId, challenge })
  assert.equal(approval.kind, 'approved')
  if (approval.kind !== 'approved') throw new Error('Approval missing')
  const reserved = await transactPet({ type: 'sync-reserve', pairing: {
    extensionId, epochId: approval.epochId, token: approval.token, origin: APP_ORIGIN, reservedAt: now,
  } })
  const first = await callExtension(extensionId, { kind: 'activate', token: approval.token, epochId: approval.epochId, reservedAt: reserved.pet.extensionSync.pairing!.reservedAt })
  if (first.kind !== 'snapshot') throw new Error('Snapshot missing')
  await transactPet({ type: 'sync-activate', epochId: first.epochId, extensionId, cutoffAt: first.cutoffAt })
  await transactPet({ type: 'sync-ingest', epochId: first.epochId, snapshots: first.summaries, now })
  assert.deepEqual([readPet().xp, readPet().foodCredits], [0, 0], 'pre-connection extension time is not retroactively rewarded')

  for (let tick = 0; tick < 10; tick++) { now += 30_000; monotonic += 30_000; await tracker.run() }
  const snapshot = await callExtension(extensionId, { kind: 'sync', token: approval.token, epochId: approval.epochId })
  if (snapshot.kind !== 'snapshot') throw new Error('Snapshot missing')
  assert.equal(snapshot.summaries[0].activeDurationMs, 5 * 60_000)
  await Promise.all([1, 2, 3].map(() => transactPet({ type: 'sync-ingest', epochId: snapshot.epochId, snapshots: snapshot.summaries, now })))
  assert.deepEqual([readPet().xp, readPet().foodCredits], [5, 2], 'historical 10 + new browser 5 earns exactly one block')
  assert.deepEqual(readPet().websiteRules, historical.websiteRules)
  assert.equal(readPet().activities.length, 1)
  await transactPet({ type: 'log', activity: { id: 'optional-overlap', source: 'Manual', category: 'Focus', duration: 30, note: '', timestamp: new Date(now).toISOString() } })
  assert.deepEqual([readPet().xp, readPet().foodCredits], [5, 2])
  await transactPet({ type: 'feed' })
  tracker = new TrackerController(api, clock) // Same extension storage, fresh worker.
  const restored = await callExtension(extensionId, { kind: 'sync', token: approval.token, epochId: approval.epochId })
  if (restored.kind !== 'snapshot') throw new Error('Restored snapshot missing')
  await transactPet({ type: 'sync-ingest', epochId: restored.epochId, snapshots: restored.summaries, now })
  assert.deepEqual([readPet().xp, readPet().foodCredits, readPet().extensionSync.summaries.length], [5, 0, 1])
})
