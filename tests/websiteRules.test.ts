import assert from 'node:assert/strict'
import test from 'node:test'
import { areWebsiteRules, categoryForHostname, changeWebsiteRule, normalizeHostname } from '../src/websiteRules.ts'
import { freshPet, petReducer } from '../src/petState.ts'
import { isPetState, migratePet, readPet, savePet, transactPet } from '../src/storage.ts'

const now = new Date(2026, 10, 12, 12).getTime()
const adopted = () => petReducer(freshPet(), { type: 'adopt' })

function existingProgress() {
  const manual = petReducer(adopted(), { type: 'log', activity: {
    id: 'old-manual', source: 'Manual', category: 'Focus', duration: 30,
    note: 'Already saved', timestamp: new Date(now).toISOString(),
  } })
  const started = petReducer(manual, { type: 'timer-start', id: 'timer-finished', duration: 1, now })
  const completed = petReducer(started, { type: 'timer-save', id: 'timer-finished', now: now + 60_000 })
  const fed = petReducer(completed, { type: 'feed' })
  const goal = petReducer(fed, { type: 'goal', minutes: 90 })
  return petReducer(goal, { type: 'timer-start', id: 'timer-active', duration: 25, now: now + 120_000 })
}

function storageFixture(initial: unknown) {
  let raw = JSON.stringify(initial)
  let queue = Promise.resolve()
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: () => raw,
    setItem: (_key: string, value: string) => { raw = value },
  } } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks: {
    request: <T>(_name: string, callback: () => T) => {
      const result = queue.then(callback)
      queue = result.then(() => undefined, () => undefined)
      return result
    },
  } } })
  return () => raw
}

test('normalizes hostnames and HTTP(S) URLs and discards extra URL data', () => {
  for (const input of [' Example.COM ', 'https://EXAMPLE.com/work?q=private#part', 'http://example.com:8080/path', 'example.com.', 'example.com/path?q=x#fragment']) {
    assert.equal(normalizeHostname(input), 'example.com')
  }
  assert.equal(normalizeHostname('https://bücher.example/path'), 'xn--bcher-kva.example')
  assert.equal(normalizeHostname('https://127.0.0.1:8080/a'), '127.0.0.1')
  assert.equal(normalizeHostname('https://[::1]:8080/a'), '[::1]')
  assert.equal(normalizeHostname('LOCALHOST'), 'localhost')
})

test('rejects invalid hosts, unsupported protocols, credentials and malformed input', () => {
  for (const input of ['', '   ', 'not-a-host', '123', '/example.com', '.example.com', 'bad host.com',
    'https://', 'ftp://example.com', 'file:///tmp/x', 'javascript:alert(1)', 'mailto:test@example.com',
    'https:example.com', 'https://user:password@example.com', 'user@example.com',
    'https://example..com', '-bad.example', 'bad-.example', 'https://exa_mple.com',
    'https://example.com:99999', 'example.com:8080', 'https://example.com\\evil', `${'a'.repeat(64)}.example`]) {
    assert.throws(() => normalizeHostname(input), RangeError, input)
  }
})

test('rules match exact hostnames without implicit subdomains or website assumptions', () => {
  const rules = [{ hostname: 'example.com', category: 'Focus' as const },
    { hostname: 'work.example.com', category: 'Leisure' as const }]
  assert.equal(categoryForHostname(rules, 'https://EXAMPLE.com/page'), 'Focus')
  assert.equal(categoryForHostname(rules, 'work.example.com'), 'Leisure')
  for (const hostname of ['www.example.com', 'other.work.example.com', 'notexample.com', 'example.com.evil.test', 'youtube.com', 'github.com']) {
    assert.equal(categoryForHostname(rules, hostname), 'Neutral')
  }
})

test('duplicate normalized hosts are rejected on add and rename', () => {
  const rules = changeWebsiteRule([], 'Example.com', 'Focus').rules
  const duplicate = changeWebsiteRule(rules, 'https://EXAMPLE.COM./path?x=1', 'Neutral')
  assert.match(duplicate.error, /already exists/)
  assert.equal(duplicate.rules, rules)
  const two = changeWebsiteRule(rules, 'work.example.com', 'Leisure').rules
  assert.match(changeWebsiteRule(two, 'example.com', 'Neutral', 'work.example.com').error, /already exists/)
  assert.match(changeWebsiteRule(two, 'new.example.com', 'Neutral', 'removed.example.com').error, /another tab/)
})

test('rule CRUD preserves adoption, saved balances, activity sources, goals and active timer', () => {
  const base = existingProgress()
  const saved = petReducer(base, { type: 'rule-save', hostname: 'https://EXAMPLE.com/path', category: 'Focus' })
  assert.deepEqual(saved.websiteRules, [{ hostname: 'example.com', category: 'Focus' }])
  const edited = petReducer(saved, { type: 'rule-save', hostname: 'study.example.com', category: 'Neutral', originalHostname: 'example.com' })
  assert.deepEqual(edited.websiteRules, [{ hostname: 'study.example.com', category: 'Neutral' }])
  const removed = petReducer(edited, { type: 'rule-remove', hostname: 'study.example.com' })
  assert.deepEqual(removed.websiteRules, [])
  for (const state of [saved, edited, removed]) {
    assert.deepEqual({ ...state, websiteRules: [] }, base)
    assert.deepEqual(state.activities.map((activity) => activity.source), ['Manual', 'Timer'])
    assert.deepEqual([state.xp, state.foodCredits, state.dailyFocusGoal], [10, 2, 90])
  }
  assert.equal(petReducer(saved, { type: 'rule-save', hostname: 'EXAMPLE.COM', category: 'Leisure' }), saved)
})

test('version-3 migration preserves running, paused and completed timers and progress', () => {
  const base = existingProgress()
  const paused = petReducer(base, { type: 'timer-pause', id: 'timer-active', now: now + 180_000 })
  for (const state of [base, paused]) {
    const old = { ...state, version: 3 }
    Reflect.deleteProperty(old, 'websiteRules')
    const serialized = JSON.stringify(old)
    const migrated = migratePet(old)
    assert.deepEqual(migrated, { ...state, version: 4, websiteRules: [] })
    assert.equal(JSON.stringify(old), serialized)
    storageFixture(old)
    assert.equal(savePet(migrated!), true)
    assert.deepEqual(readPet(), migrated)
  }
  // A timer can finish while closed; migration keeps its deadline untouched.
  const legacy = { ...base, version: 3 }
  Reflect.deleteProperty(legacy, 'websiteRules')
  const migrated = migratePet(legacy)!
  const saved = petReducer(migrated, { type: 'timer-save', id: 'timer-active', now: now + 60 * 60_000 })
  assert.equal(saved.activities.at(-1)?.source, 'Timer')
  assert.equal(saved.activities.at(-1)?.timestamp, new Date(now + 27 * 60_000).toISOString())
})

test('storage rejects duplicate or malformed rules and preserves unreadable records', () => {
  assert.equal(areWebsiteRules([{ hostname: 'example.com', category: 'Rest' }]), false)
  assert.equal(areWebsiteRules([{ hostname: 'EXAMPLE.COM', category: 'Focus' }]), false)
  assert.equal(areWebsiteRules([{ hostname: 'example.com', category: 'Focus' }, { hostname: 'example.com', category: 'Leisure' }]), false)
  const invalid = { ...adopted(), websiteRules: [{ hostname: 'https://example.com/path', category: 'Focus' }] }
  assert.equal(isPetState(invalid), false)
  const raw = storageFixture(invalid)
  const before = raw()
  assert.equal(savePet(adopted()), false)
  assert.equal(raw(), before)
})

test('concurrent duplicate rules use the existing shared storage lock', async () => {
  const base = existingProgress()
  storageFixture(base)
  const results = await Promise.all(['Example.com', 'https://example.com/path'].map((hostname) =>
    transactPet({ type: 'rule-save', hostname, category: 'Focus' })))
  assert.equal(results.filter((result) => result.changed).length, 1)
  const saved = readPet()
  assert.deepEqual(saved.websiteRules, [{ hostname: 'example.com', category: 'Focus' }])
  assert.deepEqual({ ...saved, websiteRules: [] }, base)
})
