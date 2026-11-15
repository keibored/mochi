import assert from 'node:assert/strict'
import test from 'node:test'
import { petLevel } from '../src/petLevels.ts'

test('levels follow lifetime XP thresholds without changing or awarding XP', () => {
  assert.deepEqual(petLevel(0), { level: 1, progressXp: 0, requiredXp: 100 })
  assert.deepEqual(petLevel(99), { level: 1, progressXp: 99, requiredXp: 100 })
  assert.deepEqual(petLevel(100), { level: 2, progressXp: 0, requiredXp: 100 })
  assert.deepEqual(petLevel(250), { level: 3, progressXp: 50, requiredXp: 100 })
})
