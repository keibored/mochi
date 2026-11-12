import assert from 'node:assert/strict'
import test from 'node:test'
import { WEBSITE_CATALOG } from '../src/websiteCatalog.ts'
import { categoryForHostname, changeWebsiteRule, classificationForHostname, normalizeHostname } from '../src/websiteRules.ts'
import { freshPet, petReducer } from '../src/petState.ts'
import { migratePet } from '../src/storage.ts'

test('bundled work, study, entertainment and game hosts classify without user rules', () => {
  for (const hostname of ['developer.mozilla.org', 'docs.github.com', 'github.dev', 'www.khanacademy.org',
    'www.coursera.org', 'docs.google.com', 'notion.so']) {
    assert.equal(categoryForHostname([], hostname), 'Focus', hostname)
    assert.equal(classificationForHostname([], hostname).origin, 'Automatic', hostname)
  }
  for (const hostname of ['www.netflix.com', 'www.twitch.tv', 'music.youtube.com', 'open.spotify.com',
    'store.steampowered.com', 'www.tiktok.com']) {
    assert.equal(categoryForHostname([], hostname), 'Leisure', hostname)
    assert.equal(classificationForHostname([], hostname).origin, 'Automatic', hostname)
  }
})

test('unknown, unsupported and unlisted mixed-purpose hosts fall back to Neutral', () => {
  for (const hostname of ['unknown.example', 'reddit.com', 'www.reddit.com', 'notion.site', 'creator.notion.site',
    'ads.tiktok.com', 'developer.spotify.com', 'jobs.netflix.com', 'dashboard.twitch.tv',
    'localhost', '127.0.0.1', 'ftp://netflix.com', 'not a hostname']) {
    assert.deepEqual(classificationForHostname([], hostname), { category: 'Neutral', origin: 'Unclassified' }, hostname)
  }
  for (const hostname of ['github.com', 'www.github.com', 'youtube.com', 'www.youtube.com', 'google.com', 'mail.google.com']) {
    assert.equal(categoryForHostname([], hostname), 'Neutral', hostname)
    assert.equal(classificationForHostname([], hostname).origin, 'Automatic', hostname)
  }
})

test('exact overrides win including Neutral and removal restores automatic classification', () => {
  let rules = changeWebsiteRule([], 'https://Developer.Mozilla.org/en-US/docs/?q=secret', 'Leisure').rules
  assert.deepEqual(classificationForHostname(rules, 'developer.mozilla.org'), {
    category: 'Leisure', origin: 'Your override', matchedHostname: 'developer.mozilla.org',
  })
  rules = changeWebsiteRule(rules, 'developer.mozilla.org', 'Neutral', 'developer.mozilla.org').rules
  assert.equal(classificationForHostname(rules, 'developer.mozilla.org').origin, 'Your override')
  assert.equal(categoryForHostname(rules, 'developer.mozilla.org'), 'Neutral')
  const removed = rules.filter((rule) => rule.hostname !== 'developer.mozilla.org')
  assert.deepEqual(classificationForHostname(removed, 'developer.mozilla.org'), {
    category: 'Focus', origin: 'Automatic', matchedHostname: 'developer.mozilla.org',
  })
  // Existing parent overrides remain exact: no silent expansion to subdomains.
  const parent = [{ hostname: 'twitch.tv', category: 'Neutral' as const }]
  assert.equal(categoryForHostname(parent, 'www.twitch.tv'), 'Leisure')
  assert.equal(categoryForHostname(parent, 'dev.twitch.tv'), 'Focus')
})

test('most-specific documented subdomain beats automatic parent regardless of category', () => {
  assert.equal(categoryForHostname([], 'twitch.tv'), 'Leisure')
  assert.deepEqual(classificationForHostname([], 'dev.twitch.tv'), {
    category: 'Focus', origin: 'Automatic', matchedHostname: 'dev.twitch.tv',
  })
  assert.equal(categoryForHostname([], 'docs.github.com'), 'Focus')
  assert.equal(categoryForHostname([], 'music.youtube.com'), 'Leisure')
  assert.equal(categoryForHostname([], 'sub.music.youtube.com'), 'Neutral')
  assert.deepEqual(classificationForHostname([], 'sub.dev.twitch.tv'), { category: 'Neutral', origin: 'Unclassified' })
})

test('deceptive suffixes, prefixes, path keywords and credentials cannot match a catalog host', () => {
  for (const hostname of ['github.com.example.org', 'docs.github.com.example.org', 'netflix.com.example.org',
    'notnetflix.com', 'developer.mozilla.org.evil.test', 'notdeveloper.mozilla.org', 'wwwtwitch.tv',
    'https://example.org/github.com/developer.mozilla.org?site=netflix.com#twitch.tv',
    'https://netflix.com@example.org/', 'https://example.org@netflix.com/']) {
    assert.deepEqual(classificationForHostname([], hostname), { category: 'Neutral', origin: 'Unclassified' }, hostname)
  }
  assert.equal(categoryForHostname([], 'HTTPS://WWW.NETFLIX.COM./watch?q=x'), 'Leisure')
})

test('catalog hosts are canonical, unique, explicitly scoped, documented and offline data', () => {
  const seen = new Set<string>()
  for (const entry of WEBSITE_CATALOG) {
    assert.equal(normalizeHostname(entry.hostname), entry.hostname)
    assert.equal(seen.has(entry.hostname), false, entry.hostname)
    assert.equal(typeof entry.includeSubdomains, 'boolean')
    assert.ok(entry.rationale.length > 20)
    assert.equal(new URL(entry.source).protocol, 'https:')
    seen.add(entry.hostname)
  }
})

test('existing saved rules remain exact overrides through web migration with progress unchanged', () => {
  const at = new Date(2026, 10, 13, 12).toISOString()
  let pet = petReducer(freshPet(), { type: 'adopt' })
  pet = petReducer(pet, { type: 'log', activity: {
    id: 'existing-focus', source: 'Manual', category: 'Focus', duration: 30, note: '', timestamp: at,
  } })
  pet = petReducer(pet, { type: 'feed' })
  pet = petReducer(pet, { type: 'rule-save', hostname: 'developer.mozilla.org', category: 'Leisure' })
  const previous = { ...pet, version: 4 }
  Reflect.deleteProperty(previous, 'extensionSync')
  const original = JSON.stringify(previous)
  const migrated = migratePet(previous)!
  assert.equal(JSON.stringify(previous), original)
  assert.deepEqual(migrated.websiteRules, pet.websiteRules)
  assert.deepEqual(migrated.activities, pet.activities)
  assert.deepEqual([migrated.xp, migrated.foodCredits, migrated.adopted], [10, 2, true])
  assert.equal(categoryForHostname(migrated.websiteRules, 'developer.mozilla.org'), 'Leisure')
  assert.equal(classificationForHostname(migrated.websiteRules, 'developer.mozilla.org').origin, 'Your override')
})
