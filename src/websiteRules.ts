import { WEBSITE_CATALOG } from './websiteCatalog.ts'

export const WEBSITE_CATEGORIES = ['Focus', 'Leisure', 'Neutral'] as const
export type WebsiteCategory = typeof WEBSITE_CATEGORIES[number]
export type ClassificationOrigin = 'Automatic' | 'Your override' | 'Unclassified'

export interface WebsiteClassification {
  category: WebsiteCategory
  origin: ClassificationOrigin
  matchedHostname?: string
}

export interface WebsiteRule {
  hostname: string
  category: WebsiteCategory
}

export function isWebsiteCategory(value: unknown): value is WebsiteCategory {
  return WEBSITE_CATEGORIES.some((category) => category === value)
}

/** Exact-host rules only. URL parsing canonicalizes case, IDNs and IP literals.
 * Paths, queries, fragments and ports are discarded; credentials are rejected.
 */
export function normalizeHostname(input: string): string {
  const raw = input.trim()
  const invalid = () => new RangeError('Enter a valid hostname or HTTP(S) URL, without login details.')
  if (!raw || /[\s\\]/.test(raw) || /^[/?#.]/.test(raw)) throw invalid()
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw)
  if (hasScheme && !/^https?:\/\//i.test(raw)) throw invalid()
  const bareHost = raw.split(/[/?#]/, 1)[0].toLowerCase().replace(/\.$/, '')
  if (!hasScheme && !bareHost.includes('.') && bareHost !== 'localhost' && !bareHost.startsWith('[')) throw invalid()
  let url: URL
  try { url = new URL(hasScheme ? raw : `https://${raw}`) } catch { throw invalid() }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid()
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (hostname.startsWith('[') && hostname.endsWith(']')) return hostname
  if (hostname.length > 253 || (hostname !== 'localhost' && !hostname.includes('.')) ||
      !hostname.split('.').every((label) => label.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label))) throw invalid()
  return hostname
}

export function isWebsiteRule(value: unknown): value is WebsiteRule {
  if (typeof value !== 'object' || value === null) return false
  const rule = value as Partial<WebsiteRule>
  if (typeof rule.hostname !== 'string' || !isWebsiteCategory(rule.category)) return false
  try { return normalizeHostname(rule.hostname) === rule.hostname } catch { return false }
}

export function areWebsiteRules(value: unknown): value is WebsiteRule[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<string>()
  return value.every((rule: unknown) => {
    if (!isWebsiteRule(rule) || seen.has(rule.hostname)) return false
    seen.add(rule.hostname)
    return true
  })
}

export function changeWebsiteRule(rules: readonly WebsiteRule[], input: string, category: WebsiteCategory, originalHostname?: string) {
  let hostname: string
  try { hostname = normalizeHostname(input) } catch (error) {
    return { rules, error: error instanceof Error ? error.message : 'Enter a valid hostname.' }
  }
  if (!isWebsiteCategory(category)) return { rules, error: 'Choose Focus, Leisure, or Neutral.' }
  if (originalHostname !== undefined && !rules.some((rule) => rule.hostname === originalHostname)) {
    return { rules, error: 'This rule changed in another tab. Review the current rules and try again.' }
  }
  if (rules.some((rule) => rule.hostname === hostname && rule.hostname !== originalHostname)) {
    return { rules, error: 'A rule for this hostname already exists. Edit the existing rule instead.' }
  }
  const updated = rules.filter((rule) => rule.hostname !== originalHostname)
  return { rules: [...updated, { hostname, category }], error: '' }
}

/** Exact user override > most-specific configured automatic match > Neutral.
 * Only catalog entries marked includeSubdomains match descendants. Paths and
 * queries never participate, and suffix checks require a hostname boundary.
 */
export function classificationForHostname(rules: readonly WebsiteRule[], input: string): WebsiteClassification {
  try {
    const hostname = normalizeHostname(input)
    const override = rules.find((rule) => rule.hostname === hostname)
    if (override) return { category: override.category, origin: 'Your override', matchedHostname: hostname }
    let matched: typeof WEBSITE_CATALOG[number] | undefined
    for (const entry of WEBSITE_CATALOG) {
      const matches = hostname === entry.hostname || (entry.includeSubdomains && hostname.endsWith(`.${entry.hostname}`))
      if (matches && (!matched || entry.hostname.length > matched.hostname.length)) matched = entry
    }
    if (matched) return { category: matched.category, origin: 'Automatic', matchedHostname: matched.hostname }
  } catch { /* Invalid or unsupported input cannot earn an automatic category. */ }
  return { category: 'Neutral', origin: 'Unclassified' }
}

export function categoryForHostname(rules: readonly WebsiteRule[], input: string): WebsiteCategory {
  return classificationForHostname(rules, input).category
}
