import assert from 'node:assert/strict'
import test from 'node:test'
import { petExpression } from '../src/petPresentation.ts'
import { pauseTimer, resumeTimer } from '../src/timer.ts'
import type { TimerSession } from '../src/timer.ts'

const startedAt = new Date(2026, 10, 15, 12).getTime()
const session: TimerSession = { id: 'timer-presentation', duration: 25, startedAt, elapsedMs: 0, runningSince: startedAt }
const cozyCare = { fullness: 80, energy: 80, rest: null }

test('fullness thresholds derive gentle fictional states at their exact boundaries', () => {
  for (const fullness of [0, 19, 19.9]) {
    assert.equal(petExpression({ ...cozyCare, fullness }, null, startedAt), 'under-the-weather')
  }
  for (const fullness of [20, 39, 39.9]) {
    assert.equal(petExpression({ ...cozyCare, fullness }, null, startedAt), 'hungry')
  }
  for (const fullness of [40, 80, 100]) {
    assert.equal(petExpression({ ...cozyCare, fullness }, null, startedAt), 'cozy')
  }
})

test('energy below 30 looks tired without preventing the timer or changing it', () => {
  const before = structuredClone(session)
  assert.equal(petExpression({ ...cozyCare, energy: 29 }, session, startedAt), 'tired')
  assert.equal(petExpression({ ...cozyCare, energy: 30 }, session, startedAt), 'focusing')
  assert.deepEqual(session, before)
})

test('care, Focus and happiness follow one documented priority order', () => {
  assert.equal(petExpression({ fullness: 0, energy: 0, rest: { startedAt } }, session, startedAt, true), 'sleeping')
  assert.equal(petExpression({ fullness: 19, energy: 0, rest: null }, session, startedAt, true), 'under-the-weather')
  assert.equal(petExpression({ fullness: 39, energy: 0, rest: null }, session, startedAt, true), 'hungry')
  assert.equal(petExpression({ fullness: 40, energy: 29, rest: null }, session, startedAt, true), 'tired')
  assert.equal(petExpression(cozyCare, session, startedAt, true), 'focusing')
  assert.equal(petExpression(cozyCare, null, startedAt, true), 'happy')
  assert.equal(petExpression(cozyCare, null, startedAt), 'cozy')
})

test('pet focuses only during a running unfinished session', () => {
  assert.equal(petExpression(cozyCare, null, startedAt), 'cozy')
  assert.equal(petExpression(cozyCare, session, startedAt + 60_000), 'focusing')
  assert.equal(petExpression(cozyCare, session, startedAt + 25 * 60_000), 'cozy')
  assert.equal(petExpression(cozyCare, session, startedAt + 60 * 60_000, true), 'happy')
})

test('pausing and resuming use real active-session state rather than wall time alone', () => {
  const paused = pauseTimer(session, startedAt + 60_000)
  assert.equal(petExpression(cozyCare, paused, startedAt + 60 * 60_000), 'cozy')
  const resumed = resumeTimer(paused, startedAt + 60 * 60_000)
  assert.equal(petExpression(cozyCare, resumed, startedAt + 61 * 60_000), 'focusing')
})

test('derivation never writes care values, timers or a persisted mood', () => {
  const care = Object.freeze({ fullness: 50, energy: 65, rest: null })
  const timer = Object.freeze({ ...session })
  const before = JSON.stringify({ care, timer })
  for (let index = 0; index < 3; index++) petExpression(care, timer, startedAt + index * 30_000, index === 0)
  assert.equal(JSON.stringify({ care, timer }), before)
  assert.equal(Object.hasOwn(care, 'mood'), false)
})
