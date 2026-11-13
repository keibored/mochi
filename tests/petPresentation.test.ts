import assert from 'node:assert/strict'
import test from 'node:test'
import { petExpression } from '../src/petPresentation.ts'
import { pauseTimer, resumeTimer } from '../src/timer.ts'
import type { TimerSession } from '../src/timer.ts'

const startedAt = new Date(2026, 10, 13, 12).getTime()
const session: TimerSession = { id: 'timer-presentation', duration: 25, startedAt, elapsedMs: 0, runningSince: startedAt }

test('pet focuses only during a running unfinished session', () => {
  assert.equal(petExpression(null, null, startedAt), 'cozy')
  assert.equal(petExpression(null, session, startedAt + 60_000), 'focusing')
  assert.equal(petExpression(null, session, startedAt + 25 * 60_000), 'cozy')
  assert.equal(petExpression(null, session, startedAt + 60 * 60_000), 'cozy')
})

test('pausing and resuming a session change the expression with its real state', () => {
  const paused = pauseTimer(session, startedAt + 60_000)
  assert.equal(petExpression(null, paused, startedAt + 5 * 60_000), 'cozy')
  const resumed = resumeTimer(paused, startedAt + 5 * 60_000)
  assert.equal(petExpression(null, resumed, startedAt + 6 * 60_000), 'focusing')
})

test('temporary happy and sleepy reactions take precedence over timer expressions', () => {
  assert.equal(petExpression('happy', session, startedAt), 'happy')
  assert.equal(petExpression('sleepy', session, startedAt), 'sleepy')
  assert.equal(petExpression('happy', null, startedAt), 'happy')
  assert.equal(petExpression('sleepy', session, startedAt + 25 * 60_000), 'sleepy')
})
