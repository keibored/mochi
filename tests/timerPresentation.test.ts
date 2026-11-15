import assert from 'node:assert/strict'
import test from 'node:test'
import { freshPet, petReducer } from '../src/petState.ts'
import { timerPresentation } from '../src/timerPresentation.ts'
import { pauseTimer, resumeTimer } from '../src/timer.ts'
import type { TimerSession } from '../src/timer.ts'

const startedAt = new Date(2026, 10, 15, 12).getTime()
const session: TimerSession = { id: 'timer-notice', duration: 15, startedAt, elapsedMs: 0, runningSince: startedAt }

test('persistent notices follow the actual running, paused and completed session after reload', () => {
  const paused = pauseTimer(session, startedAt + 4 * 60_000)
  assert.equal(timerPresentation(paused, startedAt + 60 * 60_000).kind, 'paused')
  assert.equal(timerPresentation(paused, startedAt + 60 * 60_000).clock, '11:00')
  const resumed = resumeTimer(paused, startedAt + 60 * 60_000)
  assert.equal(timerPresentation(resumed, startedAt + 61 * 60_000).kind, 'running')
  const restored = JSON.parse(JSON.stringify(resumed)) as TimerSession
  const complete = timerPresentation(restored, startedAt + 71 * 60_000)
  assert.equal(complete.kind, 'complete')
  assert.equal(complete.clock, '00:00')
  assert.equal(complete.label, 'Focus session complete ♡')
})

test('Rest and Wake keep completed sessions complete and saveable exactly once', () => {
  let pet = petReducer(freshPet(startedAt), { type: 'adopt' })
  pet = petReducer(pet, { type: 'timer-start', id: session.id, duration: 15, now: startedAt })
  pet = petReducer(pet, { type: 'care-rest-start', id: 'rest-notice', now: startedAt + 15 * 60_000 })
  pet = petReducer(pet, { type: 'care-wake', restId: 'rest-notice', now: startedAt + 20 * 60_000 })
  assert.equal(timerPresentation(pet.timer!, startedAt + 20 * 60_000).kind, 'complete')
  assert.equal(timerPresentation(pet.timer!, startedAt + 20 * 60_000).shortLabel.includes('paused'), false)
  pet = petReducer(pet, { type: 'timer-save', id: session.id, now: startedAt + 20 * 60_000 })
  assert.deepEqual([pet.activities.length, pet.xp, pet.foodCredits], [1, 5, 2])
  assert.equal(petReducer(pet, { type: 'timer-save', id: session.id, now: startedAt + 21 * 60_000 }), pet)
})

test('Wake leaves a genuinely paused session paused until explicit Resume', () => {
  let pet = petReducer(petReducer(freshPet(startedAt), { type: 'adopt' }), { type: 'timer-start', id: session.id, duration: 15, now: startedAt })
  pet = petReducer(pet, { type: 'care-rest-start', id: 'rest-paused', pauseTimerId: session.id, now: startedAt + 2 * 60_000 })
  pet = petReducer(pet, { type: 'care-wake', restId: 'rest-paused', now: startedAt + 7 * 60_000 })
  assert.equal(timerPresentation(pet.timer!, startedAt + 7 * 60_000).kind, 'paused')
  pet = petReducer(pet, { type: 'timer-resume', id: session.id, now: startedAt + 7 * 60_000 })
  assert.equal(timerPresentation(pet.timer!, startedAt + 7 * 60_000).kind, 'running')
})
