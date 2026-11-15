import assert from 'node:assert/strict'
import test from 'node:test'
import { callExtension, ExtensionConnectionError } from '../src/integration/extensionTransport.ts'
import type { ExtensionErrorCode } from '../src/integration/extensionTransport.ts'
import { APP_ORIGIN, MIN_SYNC_EXTENSION_VERSION, REQUIRED_SYNC_CAPABILITIES, SYNC_PROTOCOL, SYNC_PROTOCOL_VERSION } from '../src/integration/localConfig.ts'
import { WEBSITE_CATALOG_VERSION } from '../src/websiteCatalog.ts'

const extensionId = 'a'.repeat(32)
const info = () => ({ version: MIN_SYNC_EXTENSION_VERSION, catalogVersion: WEBSITE_CATALOG_VERSION, capabilities: [...REQUIRED_SYNC_CAPABILITIES] })
const envelope = (payload: unknown = { kind: 'pending', requestId: 'request-1' }, extensionInfo: unknown = info()) =>
  ({ protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, extensionInfo, ok: true, payload })
const request = { kind: 'pair-request', requestId: 'request-1', challenge: 'challenge-1234567890' } as const
const syncRequest = { kind: 'sync', token: 'x'.repeat(40), epochId: 'epoch' } as const
function fixture(origin = APP_ORIGIN, response: unknown = envelope()) {
  const calls: unknown[] = []
  let onTimeout: (() => void) | undefined
  let cleared = 0
  const runtime: {
    sendMessage: (id: string, message: unknown, callback: (reply: unknown) => void) => void
    lastError?: { message?: string }
  } = {
    sendMessage: (id, message, callback) => { calls.push({ id, message }); callback(response) },
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin },
    setTimeout: (callback: () => void, milliseconds: number) => { assert.equal(milliseconds, 5000); onTimeout = callback; return 1 },
    clearTimeout: () => { cleared++ },
  } })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime } })
  return { calls, runtime, timeout: () => onTimeout?.(), cleared: () => cleared }
}
function code(expected: ExtensionErrorCode) {
  return (error: unknown) => {
    assert.ok(error instanceof ExtensionConnectionError)
    assert.equal(error.code, expected)
    return true
  }
}

test('web transport uses the explicit ID and returns verified receiver metadata before approval', async () => {
  const h = fixture()
  assert.deepEqual(await callExtension(extensionId, request), { kind: 'pending', requestId: 'request-1', extensionInfo: info() })
  assert.deepEqual(h.calls, [{ id: extensionId, message: { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ...request } }])
  assert.equal(h.cleared(), 1)
})

test('wrong origin and invalid ID are actionable errors before any message is sent', async () => {
  for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5174', 'https://localhost:5173']) {
    const h = fixture(origin)
    await assert.rejects(callExtension(extensionId, syncRequest), code('wrong-origin'))
    assert.equal(h.calls.length, 0)
  }
  const h = fixture()
  await assert.rejects(callExtension('not-an-id', request), code('invalid-id'))
  assert.equal(h.calls.length, 0)
})

test('unavailable messaging gives precise rebuild, Brave reload, and exact-origin recovery steps', async () => {
  fixture()
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {} })
  await assert.rejects(callExtension(extensionId, syncRequest), (error: unknown) => {
    code('unavailable')(error)
    const message = (error as Error).message
    for (const text of ['npm.cmd run build:extension', 'brave://extensions', MIN_SYNC_EXTENSION_VERSION, `${APP_ORIGIN}/`, 'same extension ID']) assert.ok(message.includes(text), text)
    return true
  })
})

test('old protocol or missing automatic-classification/catalog capability fails before activation', async () => {
  let activations = 0
  for (const response of [
    { protocol: SYNC_PROTOCOL, version: 1, ok: true, payload: { kind: 'approved' } },
    { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ok: true, payload: { kind: 'pending', requestId: 'request-1' } },
    envelope(undefined, { ...info(), version: '0.2.0' }),
    envelope(undefined, { ...info(), version: 'not-a-version' }),
    envelope(undefined, { ...info(), catalogVersion: 'outdated' }),
    envelope(undefined, { ...info(), capabilities: ['revisioned-sync'] }),
    envelope(undefined, { ...info(), capabilities: ['revisioned-sync', 'revisioned-sync'] }),
    envelope(undefined, { ...info(), capabilities: [...REQUIRED_SYNC_CAPABILITIES, 'invented'] }),
    envelope(undefined, { ...info(), hostname: 'private.example' }),
  ]) {
    fixture(APP_ORIGIN, response)
    await assert.rejects(callExtension(extensionId, syncRequest).then(() => { activations++ }), code('incompatible'))
  }
  assert.equal(activations, 0)
})

test('missing build metadata is incompatible even if a payload claims successful approval', async () => {
  fixture(APP_ORIGIN, { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ok: true, payload: {
    kind: 'approved', extensionId, epochId: 'epoch', token: 'x'.repeat(40), origin: APP_ORIGIN, cutoffAt: null,
  } })
  await assert.rejects(callExtension(extensionId, request), code('incompatible'))
})

test('valid approval and compatible newer receiver versions retain strict identity and origin', async () => {
  const payload = { kind: 'approved', extensionId, epochId: 'epoch', token: 'x'.repeat(40), origin: APP_ORIGIN, cutoffAt: null }
  const newer = { ...info(), version: '0.4.1' }
  fixture(APP_ORIGIN, envelope(payload, newer))
  assert.deepEqual(await callExtension(extensionId, request), { ...payload, extensionInfo: newer })
  for (const invalidPayload of [{ ...payload, extensionId: 'b'.repeat(32) }, { ...payload, origin: 'http://localhost:5174' }, { ...payload, token: 'bad token' }]) {
    fixture(APP_ORIGIN, envelope(invalidPayload))
    await assert.rejects(callExtension(extensionId, request), code('invalid-response'))
  }
})

test('malformed snapshots and arbitrary fields cannot expose hostname data or pretend tracking', async () => {
  const snapshot = { kind: 'snapshot', epochId: 'epoch', cutoffAt: 10, checkedAt: 20, liveStatus: 'Tracking', summaries: [] }
  fixture(APP_ORIGIN, envelope(snapshot))
  assert.equal((await callExtension(extensionId, syncRequest)).kind, 'snapshot')
  for (const payload of [{ ...snapshot, liveStatus: 'Fake tracking' }, { ...snapshot, hostname: 'private.example' },
    { ...snapshot, checkedAt: 9 }, { ...snapshot, epochId: '' }, { ...snapshot, summaries: Array(65).fill({}) }]) {
    fixture(APP_ORIGIN, envelope(payload))
    await assert.rejects(callExtension(extensionId, syncRequest), code('invalid-response'))
  }
  fixture(APP_ORIGIN, { ...envelope(snapshot), hostname: 'private.example' })
  await assert.rejects(callExtension(extensionId, syncRequest), code('invalid-response'))
})

test('runtime.lastError and thrown sendMessage failures do not look like a connected receiver', async () => {
  const h = fixture()
  h.runtime.lastError = { message: 'Could not establish connection. Receiving end does not exist.' }
  await assert.rejects(callExtension(extensionId, request), code('unavailable'))
  assert.equal(h.cleared(), 1)
  h.runtime.sendMessage = () => { throw new Error('No runtime') }
  await assert.rejects(callExtension(extensionId, request), code('unavailable'))
  assert.equal(h.cleared(), 2)
})

test('a five-second timeout rejects reliably and late callbacks cannot succeed or reprocess data', async () => {
  const h = fixture()
  let callback: ((reply: unknown) => void) | undefined
  h.runtime.sendMessage = (_id, _message, reply) => { callback = reply }
  const pending = callExtension(extensionId, request)
  h.timeout()
  await assert.rejects(pending, code('timeout'))
  assert.doesNotThrow(() => callback?.(envelope()))
  assert.equal(h.cleared(), 0)
})

test('a callback settles once and consumes late runtime errors without changing its result', async () => {
  const h = fixture()
  let callback: ((reply: unknown) => void) | undefined
  h.runtime.sendMessage = (_id, _message, reply) => { callback = reply; reply(envelope()) }
  const reply = await callExtension(extensionId, request)
  h.runtime.lastError = { message: 'Late callback failure' }
  assert.doesNotThrow(() => callback?.(undefined))
  assert.equal(reply.kind, 'pending')
  assert.equal(h.cleared(), 1)
})

test('a validated extension rejection is readable and never treated as a successful snapshot', async () => {
  fixture(APP_ORIGIN, { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, extensionInfo: info(), ok: false, error: 'Connection approval is missing. Reconnect in Brave.' })
  await assert.rejects(callExtension(extensionId, syncRequest), code('rejected'))
})
