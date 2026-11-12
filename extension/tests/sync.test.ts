import assert from 'node:assert/strict'
import test from 'node:test'
import process from 'node:process'
import { TrackerController } from '../src/controller.ts'
import type { ChromeApi } from '../src/chromeApi.ts'
import type { ExternalSender } from '../src/syncState.ts'
import { PAIRING_TTL_MS } from '../src/syncState.ts'
import { freshState, localDay, STORAGE_KEY } from '../src/model.ts'
import type { TrackingState } from '../src/model.ts'
import { APP_ORIGIN, SYNC_PROTOCOL, SYNC_PROTOCOL_VERSION } from '../../src/integration/localConfig.ts'
import type { SyncReply, SyncRequest } from '../../src/integration/syncProtocol.ts'
import { parseSyncSummary } from '../../src/integration/syncDomain.ts'
import { registerWorker } from '../src/worker.ts'

process.env.TZ = 'Asia/Manila'
const initialTime = new Date(2026, 10, 12, 12).getTime()
const extensionId = 'a'.repeat(32)
const webSender: ExternalSender = { url: `${APP_ORIGIN}/`, origin: APP_ORIGIN, frameId: 0, tab: { incognito: false } }
const challenge = 'test_challenge_1234567890'
const requestId = 'pair-request-1'

function harness(initial?: unknown) {
  let raw = initial === undefined ? undefined : structuredClone(initial)
  let now = initialTime, monotonic = 0, sequence = 0, failWrites = false
  let externalHandler: ((message: unknown, sender: ExternalSender, reply: (response: unknown) => void) => boolean) | undefined
  const event = { addListener: () => undefined }
  const api: ChromeApi = {
    tabs: { query: async () => [{ id: 2, windowId: 1, active: true, incognito: false, url: 'https://study.example/path?private=x', status: 'complete' }],
      onActivated: event, onUpdated: event, onRemoved: event },
    windows: { getAll: async () => [{ id: 1, focused: true, incognito: false }], onFocusChanged: event, onRemoved: event },
    idle: { queryState: async () => 'active', setDetectionInterval: () => undefined, onStateChanged: event },
    storage: { local: {
      get: async () => raw === undefined ? {} : { [STORAGE_KEY]: structuredClone(raw) },
      set: async (values) => { if (failWrites) throw new Error('Storage write failed'); raw = structuredClone(values[STORAGE_KEY]) },
    } },
    alarms: { get: async () => undefined, create: async () => undefined, onAlarm: event },
    runtime: { id: extensionId, getURL: (path) => `chrome-extension://${extensionId}/${path}`,
      onStartup: event, onInstalled: event, onMessage: event,
      onMessageExternal: { addListener: (listener) => { externalHandler = listener } },
      sendMessage: async () => undefined, openOptionsPage: async () => undefined },
  }
  const clock = { now: () => now, monotonic: () => monotonic,
    id: () => String(++sequence).padStart(36, '0'), timeZone: () => 'Asia/Manila' }
  return { tracker: () => new TrackerController(api, clock), clock, api, listener: () => externalHandler,
    advance: (milliseconds: number) => { now += milliseconds; monotonic += milliseconds },
    state: () => structuredClone(raw) as TrackingState | undefined,
    fail: (value: boolean) => { failWrites = value } }
}

const envelope = (request: SyncRequest) => ({ protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ...request })
async function ask<K extends SyncReply['kind']>(tracker: TrackerController, request: SyncRequest, kind: K) {
  const response = await tracker.external(envelope(request), webSender)
  assert.equal(response.protocol, SYNC_PROTOCOL)
  assert.equal(response.version, SYNC_PROTOCOL_VERSION)
  assert.equal(response.ok, true, !response.ok ? response.error : '')
  if (!response.ok) throw new Error(response.error)
  assert.equal(response.payload.kind, kind)
  return response.payload as Extract<SyncReply, { kind: K }>
}
async function approve(tracker: TrackerController, id = requestId) {
  const result = await tracker.run({ kind: 'sync-approve', requestId: id })
  assert.equal(result.ok, true, !result.ok ? result.error : '')
  return result
}
async function pair(tracker: TrackerController, id = requestId, resumeEpochId?: string) {
  await ask(tracker, { kind: 'pair-request', requestId: id, challenge, ...(resumeEpochId ? { resumeEpochId } : {}) }, 'pending')
  await approve(tracker, id)
  return ask(tracker, { kind: 'pair-claim', requestId: id, challenge }, 'approved')
}
async function startTracking(tracker: TrackerController) {
  assert.equal((await tracker.run({ kind: 'rule-save', hostname: 'study.example', category: 'Focus' })).ok, true)
  assert.equal((await tracker.run({ kind: 'enable' })).ok, true)
}

test('external sync rejects wrong origin, port, frame, incognito and extension senders', async () => {
  const h = harness(), tracker = h.tracker()
  const request = envelope({ kind: 'pair-request', requestId, challenge })
  const rejected: ExternalSender[] = [
    { url: 'http://localhost:5174/', origin: 'http://localhost:5174', frameId: 0 },
    { url: 'http://127.0.0.1:5173/', origin: 'http://127.0.0.1:5173', frameId: 0 },
    { url: 'https://localhost:5173/', origin: 'https://localhost:5173', frameId: 0 },
    { ...webSender, origin: 'https://evil.example' }, { ...webSender, frameId: 1 },
    { ...webSender, tab: { incognito: true } }, { ...webSender, id: 'foreign-extension' },
    { url: 'not a URL' }, {},
  ]
  for (const sender of rejected) assert.equal((await tracker.external(request, sender)).ok, false)
  assert.equal(h.state(), undefined, 'unauthorized requests must not initialize or rewrite storage')
  assert.equal((await tracker.external({ ...request, version: 99 }, webSender)).ok, false)
  assert.equal((await tracker.external({ ...request, protocol: 'another.protocol' }, webSender)).ok, false)
})

test('pairing requires explicit extension approval and the matching challenge', async () => {
  const h = harness(), tracker = h.tracker()
  await ask(tracker, { kind: 'pair-request', requestId, challenge }, 'pending')
  assert.equal(h.state()?.pairing, null)
  const unapproved = await tracker.external(envelope({ kind: 'pair-claim', requestId, challenge }), webSender)
  assert.notEqual(unapproved.ok ? unapproved.payload.kind : 'error', 'approved')
  assert.equal((await tracker.run({ kind: 'sync-approve', requestId: 'wrong-request' })).ok, false)
  await approve(tracker)
  assert.equal((await tracker.external(envelope({ kind: 'pair-claim', requestId, challenge: 'wrong_challenge_123456' }), webSender)).ok, false)
  const approved = await ask(tracker, { kind: 'pair-claim', requestId, challenge }, 'approved')
  assert.equal(approved.origin, APP_ORIGIN)
  assert.equal(approved.extensionId, extensionId)
  assert.equal(approved.cutoffAt, null)
  assert.ok(approved.token.length >= 36)
  assert.ok(approved.epochId.length > 0)
})

test('expired approval requests and malformed IDs or challenges cannot authorize sync', async () => {
  const h = harness(), tracker = h.tracker()
  for (const invalid of [
    { kind: 'pair-request', requestId: '', challenge },
    { kind: 'pair-request', requestId: 'x'.repeat(129), challenge },
    { kind: 'pair-request', requestId, challenge: 'short' },
  ]) assert.equal((await tracker.external({ protocol: SYNC_PROTOCOL, version: 1, ...invalid }, webSender)).ok, false)
  await ask(tracker, { kind: 'pair-request', requestId, challenge }, 'pending')
  h.advance(PAIRING_TTL_MS + 1)
  assert.equal((await tracker.run({ kind: 'sync-approve', requestId })).ok, false)
  const claim = await tracker.external(envelope({ kind: 'pair-claim', requestId, challenge }), webSender)
  assert.notEqual(claim.ok ? claim.payload.kind : 'error', 'approved')
  assert.equal(h.state()?.pairing, null)
})

test('activation seals pre-cutoff time and only exposes future epoch summaries', async () => {
  const h = harness(), tracker = h.tracker()
  await startTracking(tracker)
  h.advance(5000)
  assert.equal((await tracker.run()).ok, true)
  const approved = await pair(tracker)
  const reservedAt = h.clock.now()
  h.advance(2000)
  const activated = await ask(tracker, { kind: 'activate', token: approved.token, epochId: approved.epochId, reservedAt }, 'snapshot')
  assert.equal(activated.cutoffAt, h.clock.now())
  assert.deepEqual(activated.summaries, [])
  assert.equal(h.state()?.summaries[0].activeDurationMs, 7000)
  assert.equal(h.state()?.summaries[0].finalized, true)
  assert.equal(h.state()?.summaries[0].epochId, null)
  h.advance(3000)
  const synced = await ask(tracker, { kind: 'sync', token: approved.token, epochId: approved.epochId }, 'snapshot')
  assert.equal(synced.liveStatus, 'Tracking')
  assert.equal(synced.summaries.length, 1)
  assert.equal(synced.summaries[0].activeDurationMs, 3000)
  assert.equal(synced.summaries[0].startedAtIso, new Date(activated.cutoffAt).toISOString())
  assert.deepEqual(parseSyncSummary(synced.summaries[0]), synced.summaries[0])
  assert.equal(h.state()?.rules[0].hostname, 'study.example')
})

test('capability and epoch checks protect snapshots and activation', async () => {
  const h = harness(), tracker = h.tracker()
  const approved = await pair(tracker)
  assert.equal((await tracker.external(envelope({ kind: 'sync', token: 'wrong_token_123456789012345678901234567890', epochId: approved.epochId }), webSender)).ok, false)
  assert.equal((await tracker.external(envelope({ kind: 'activate', token: approved.token, epochId: 'wrong-epoch', reservedAt: h.clock.now() }), webSender)).ok, false)
  assert.equal((await tracker.external(envelope({ kind: 'sync', token: approved.token, epochId: approved.epochId }), webSender)).ok, false, 'an approved but unactivated pairing cannot sync')
  await ask(tracker, { kind: 'activate', token: approved.token, epochId: approved.epochId, reservedAt: h.clock.now() }, 'snapshot')
  assert.equal((await tracker.external(envelope({ kind: 'sync', token: approved.token, epochId: 'wrong-epoch' }), webSender)).ok, false)
})

test('successive snapshots keep event IDs and increase revisions/cumulative milliseconds without duplicate time', async () => {
  const h = harness(), tracker = h.tracker()
  await startTracking(tracker)
  const approved = await pair(tracker)
  await ask(tracker, { kind: 'activate', token: approved.token, epochId: approved.epochId, reservedAt: h.clock.now() }, 'snapshot')
  h.advance(2000)
  const first = await ask(tracker, { kind: 'sync', token: approved.token, epochId: approved.epochId }, 'snapshot')
  h.advance(3000)
  const second = await ask(tracker, { kind: 'sync', token: approved.token, epochId: approved.epochId }, 'snapshot')
  assert.equal(first.summaries[0].eventId, second.summaries[0].eventId)
  assert.ok(second.summaries[0].revision > first.summaries[0].revision)
  assert.equal(second.summaries[0].activeDurationMs, 5000)
  const retry = await ask(tracker, { kind: 'sync', token: approved.token, epochId: approved.epochId }, 'snapshot')
  assert.deepEqual(retry.summaries, second.summaries)
  const restored = h.tracker()
  h.advance(10_000)
  const afterRestart = await ask(restored, { kind: 'sync', token: approved.token, epochId: approved.epochId }, 'snapshot')
  assert.equal(afterRestart.summaries[0].activeDurationMs, 5000, 'fresh worker must not backfill the unknown tail')
})

test('reapproval of the known epoch rotates token but preserves cutoff and buffered summaries', async () => {
  const h = harness(), tracker = h.tracker()
  await startTracking(tracker)
  const original = await pair(tracker)
  const activated = await ask(tracker, { kind: 'activate', token: original.token, epochId: original.epochId, reservedAt: h.clock.now() }, 'snapshot')
  h.advance(3000)
  const before = await ask(tracker, { kind: 'sync', token: original.token, epochId: original.epochId }, 'snapshot')
  assert.equal((await tracker.run({ kind: 'pause' })).ok, true)
  h.advance(5000)
  const renewed = await pair(tracker, 'pair-renewal', original.epochId)
  assert.equal(renewed.epochId, original.epochId)
  assert.equal(renewed.cutoffAt, activated.cutoffAt)
  assert.notEqual(renewed.token, original.token)
  assert.equal((await tracker.external(envelope({ kind: 'sync', token: original.token, epochId: original.epochId }), webSender)).ok, false)
  const reactivated = await ask(tracker, { kind: 'activate', token: renewed.token, epochId: renewed.epochId, reservedAt: h.clock.now() }, 'snapshot')
  assert.equal(reactivated.cutoffAt, activated.cutoffAt)
  assert.deepEqual(reactivated.summaries, before.summaries)
  assert.equal((await tracker.run({ kind: 'resume' })).ok, true)
  h.advance(2000)
  const after = await ask(tracker, { kind: 'sync', token: renewed.token, epochId: renewed.epochId }, 'snapshot')
  assert.equal(after.summaries[0].eventId, before.summaries[0].eventId)
  assert.equal(after.summaries[0].activeDurationMs, 5000)
})

test('v1 storage migration preserves extension preferences, category rules and real recorded totals', async () => {
  const legacySummary = { schemaVersion: 1, eventId: 'legacy-id', source: 'extension', category: 'Focus',
    startedAtIso: new Date(initialTime - 5000).toISOString(), endedAtIso: new Date(initialTime).toISOString(),
    activeDurationMs: 5000, timeZone: 'Asia/Manila', localDate: localDay(initialTime), finalized: false }
  const legacy = { version: 1, enabled: true, paused: true, rules: [{ hostname: 'study.example', category: 'Focus' }],
    summaries: [legacySummary], checkpointAt: initialTime }
  const h = harness(legacy), tracker = h.tracker()
  const response = await tracker.run()
  assert.equal(response.ok, true, !response.ok ? response.error : '')
  const saved = h.state()!
  assert.equal(saved.version, 2)
  assert.equal(saved.enabled, true)
  assert.equal(saved.paused, true)
  assert.deepEqual(saved.rules, legacy.rules)
  assert.deepEqual(saved.summaries, [{ ...legacySummary, revision: 1, epochId: null }])
  assert.equal(saved.pairing, null)
  assert.equal(saved.pendingPairing, null)
})

test('failed storage writes cannot approve or authorize a pairing', async () => {
  const h = harness(freshState()), tracker = h.tracker()
  h.fail(true)
  assert.equal((await tracker.external(envelope({ kind: 'pair-request', requestId, challenge }), webSender)).ok, false)
  assert.equal(h.state()?.pendingPairing, null)
  h.fail(false)
  await ask(tracker, { kind: 'pair-request', requestId, challenge }, 'pending')
  h.fail(true)
  assert.equal((await tracker.run({ kind: 'sync-approve', requestId })).ok, false)
  assert.equal(h.state()?.pairing, null)
  h.fail(false)
  const notApproved = await tracker.external(envelope({ kind: 'pair-claim', requestId, challenge }), webSender)
  assert.notEqual(notApproved.ok ? notApproved.payload.kind : 'error', 'approved')
  await approve(tracker)
  const approved = await ask(tracker, { kind: 'pair-claim', requestId, challenge }, 'approved')
  await ask(tracker, { kind: 'activate', token: approved.token, epochId: approved.epochId, reservedAt: h.clock.now() }, 'snapshot')
  const before = h.state()
  h.fail(true)
  assert.equal((await tracker.external(envelope({ kind: 'sync', token: approved.token, epochId: approved.epochId }), webSender)).ok, false)
  assert.deepEqual(h.state(), before)
})

test('external messages reject unsupported fields and prototype property names without throwing', async () => {
  const h = harness(), tracker = h.tracker()
  for (const kind of ['__proto__', 'toString', 'report', 'sync-approve']) {
    const response = await tracker.external({ protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, kind }, webSender)
    assert.equal(response.ok, false)
  }
  assert.equal((await tracker.external({ ...envelope({ kind: 'pair-request', requestId, challenge }), fullUrl: 'https://private.example/' }, webSender)).ok, false)
  assert.equal(h.state(), undefined)
})

test('worker external messaging keeps the callback channel open with literal true for Brave', async () => {
  const h = harness(), tracker = registerWorker(h.api, h.clock)
  await tracker.run()
  let accepted: boolean | undefined
  const response = await new Promise<unknown>((resolve) => {
    accepted = h.listener()!(envelope({ kind: 'pair-request', requestId, challenge }), webSender, resolve)
  }) as { ok: boolean; payload: SyncReply }
  assert.equal(accepted, true)
  assert.equal(response.ok, true)
  assert.equal(response.payload.kind, 'pending')
})
