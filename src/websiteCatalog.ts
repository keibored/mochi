import type { WebsiteCategory } from './websiteRules.ts'

export interface AutomaticWebsiteRule {
  readonly hostname: string
  readonly category: WebsiteCategory
  /** Only true entries include descendant hosts, always at a dot boundary. */
  readonly includeSubdomains: boolean
  readonly rationale: string
  readonly source: string
}

/** Bundled estimates of a service's purpose, not evidence of a person's intent.
 * Sources checked 2026-11-13. Keep explicit Neutral parents for mixed services;
 * a more specific documented product hostname can supply a different default.
 * User overrides remain exact-hostname rules and always win.
 */
export const WEBSITE_CATALOG: readonly AutomaticWebsiteRule[] = [
  { hostname: 'developer.mozilla.org', category: 'Focus', includeSubdomains: false,
    rationale: 'MDN web development documentation and learning material.', source: 'https://developer.mozilla.org/en-US/' },
  { hostname: 'github.com', category: 'Neutral', includeSubdomains: true,
    rationale: 'Repositories, community discussions, and browsing do not establish work intent.', source: 'https://github.com/about' },
  { hostname: 'docs.github.com', category: 'Focus', includeSubdomains: false,
    rationale: 'Dedicated GitHub product and development documentation.', source: 'https://docs.github.com/en' },
  { hostname: 'github.dev', category: 'Focus', includeSubdomains: false,
    rationale: 'A dedicated browser-based code editor.', source: 'https://docs.github.com/en/codespaces/the-githubdev-web-based-editor' },
  { hostname: 'khanacademy.org', category: 'Focus', includeSubdomains: true,
    rationale: 'A dedicated educational learning platform.', source: 'https://www.khanacademy.org/about' },
  { hostname: 'coursera.org', category: 'Focus', includeSubdomains: true,
    rationale: 'Courses, projects, certificates, and degree study.', source: 'https://www.coursera.org/about' },
  { hostname: 'google.com', category: 'Neutral', includeSubdomains: true,
    rationale: 'Search and the wider service family have mixed purposes.', source: 'https://about.google/products/' },
  { hostname: 'docs.google.com', category: 'Focus', includeSubdomains: false,
    rationale: 'A dedicated document creation and collaboration tool.', source: 'https://workspace.google.com/products/docs/' },
  { hostname: 'notion.so', category: 'Focus', includeSubdomains: false,
    rationale: 'A workspace for notes, projects, and tasks; public notion.site pages are excluded.', source: 'https://www.notion.com/' },
  { hostname: 'notion.com', category: 'Focus', includeSubdomains: false,
    rationale: 'A productivity workspace; unlisted subdomains and public notion.site pages are excluded.', source: 'https://www.notion.com/' },
  { hostname: 'www.notion.com', category: 'Focus', includeSubdomains: false,
    rationale: 'The Notion productivity workspace website.', source: 'https://www.notion.com/' },
  { hostname: 'netflix.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'The movie and television streaming site; career and other subdomains are excluded.', source: 'https://www.netflix.com/' },
  { hostname: 'www.netflix.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'The movie and television streaming site; career and other subdomains are excluded.', source: 'https://www.netflix.com/' },
  { hostname: 'twitch.tv', category: 'Leisure', includeSubdomains: false,
    rationale: 'The live entertainment site; creator dashboards and other subdomains are excluded.', source: 'https://www.twitch.tv/p/en/about/' },
  { hostname: 'www.twitch.tv', category: 'Leisure', includeSubdomains: false,
    rationale: 'The live entertainment site; creator dashboards and other subdomains are excluded.', source: 'https://www.twitch.tv/p/en/about/' },
  { hostname: 'dev.twitch.tv', category: 'Focus', includeSubdomains: false,
    rationale: 'A dedicated developer API and extension documentation site.', source: 'https://dev.twitch.tv/docs/' },
  { hostname: 'youtube.com', category: 'Neutral', includeSubdomains: true,
    rationale: 'Video learning, news, creation, and entertainment share this service.', source: 'https://www.youtube.com/howyoutubeworks/' },
  { hostname: 'music.youtube.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'The dedicated music and podcast listening product, separate from general YouTube.', source: 'https://support.google.com/youtubemusic/answer/6313529?hl=en' },
  { hostname: 'spotify.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'A music and podcast streaming service; unlisted subdomains are excluded.', source: 'https://www.spotify.com/about-us/contact/' },
  { hostname: 'www.spotify.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'The music and podcast streaming service website.', source: 'https://www.spotify.com/about-us/contact/' },
  { hostname: 'open.spotify.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'The dedicated music and podcast web player.', source: 'https://www.spotify.com/about-us/contact/' },
  { hostname: 'store.steampowered.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'A dedicated video game storefront.', source: 'https://store.steampowered.com/about/' },
  { hostname: 'tiktok.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'Entertainment-oriented social video; business and other subdomains are excluded.', source: 'https://www.tiktok.com/about?lang=en' },
  { hostname: 'www.tiktok.com', category: 'Leisure', includeSubdomains: false,
    rationale: 'The entertainment-oriented social video website.', source: 'https://www.tiktok.com/about?lang=en' },
]
