import assert from 'node:assert/strict'
import test from 'node:test'
import { callExtension } from '../src/integration/extensionTransport.ts'
import { APP_ORIGIN, SYNC_PROTOCOL, SYNC_PROTOCOL_VERSION } from '../src/integration/localConfig.ts'

const extensionId = 'a'.repeat(32)
function fixture(origin = APP_ORIGIN, response: unknown = { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION,
  ok: true, payload: { kind: 'pending', requestId: 'request-1' } }) {
  const calls: unknown[] = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { origin }, setTimeout, clearTimeout,
  } })
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: { runtime: {
    sendMessage: (id: string, message: unknown, callback: (reply: unknown) => void) => { calls.push({ id, message }); callback(response) },
  } } })
  return calls
}

test('web transport uses the explicit extension ID and versioned direct messaging', async () => {
  const calls = fixture()
  assert.deepEqual(await callExtension(extensionId, { kind: 'pair-request', requestId: 'request-1', challenge: 'challenge-1234567890' }), { kind: 'pending', requestId: 'request-1' })
  assert.deepEqual(calls, [{ id: extensionId, message: { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION,
    kind: 'pair-request', requestId: 'request-1', challenge: 'challenge-1234567890' } }])
})

test('web transport refuses a different origin or invalid extension ID before sending', async () => {
  const calls = fixture('http://127.0.0.1:5173')
  await assert.rejects(callExtension(extensionId, { kind: 'sync', token: 'x'.repeat(40), epochId: 'epoch' }), /Other origins/)
  assert.equal(calls.length, 0)
  fixture()
  await assert.rejects(callExtension('not-an-id', { kind: 'pair-request', requestId: 'x', challenge: 'x' }), /32-letter/)
})

test('web transport rejects missing Brave messaging and malformed protocol/status payloads', async () => {
  fixture()
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {} })
  await assert.rejects(callExtension(extensionId, { kind: 'sync', token: 'x'.repeat(40), epochId: 'epoch' }), /Brave extension messaging/)
  for (const response of [{}, { protocol: SYNC_PROTOCOL, version: 99, ok: true },
    { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ok: true, payload: { kind: 'snapshot', liveStatus: 'Fake tracking', summaries: [] } },
    { protocol: SYNC_PROTOCOL, version: SYNC_PROTOCOL_VERSION, ok: true, payload: { kind: 'approved', extensionId: 'b'.repeat(32), origin: APP_ORIGIN, epochId: 'epoch', token: 'x'.repeat(40), cutoffAt: null } }]) {
    fixture(APP_ORIGIN, response)
    await assert.rejects(callExtension(extensionId, { kind: 'sync', token: 'x'.repeat(40), epochId: 'epoch' }))
  }
})
