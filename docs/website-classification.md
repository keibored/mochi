# Automatic website categories

Tracking requires no category setup. Mochi uses a small, bundled catalog to estimate a website's usual purpose, not to prove the user's intent. No page contents, URL keywords, titles, browsing history, or remote/AI classification services are used. Unknown sites still accumulate Neutral time. Rest stays intentional and is never inferred from inactivity.

## Catalog and precedence

The source of truth is [`src/websiteCatalog.ts`](../src/websiteCatalog.ts). Each entry has a normalized hostname, category, an explicit subdomain scope, a rationale, and a primary-source link. The catalog favors dedicated learning, documentation, coding, and productivity services for Focus, and dedicated entertainment services for Leisure. Mixed-purpose platforms remain Neutral unless a dedicated hostname supports a narrower estimate: general GitHub and YouTube are Neutral, while `docs.github.com` is Focus and `music.youtube.com` is Leisure. Entertainment defaults for Netflix and Twitch cover only the root and `www` hosts; career/creator subdomains remain Unclassified Neutral unless separately listed or overridden. The dedicated `dev.twitch.tv` documentation host is Focus.

Both the extension and dashboard classification previews call the same resolver in [`src/websiteRules.ts`](../src/websiteRules.ts):

1. An explicit user override for the exact normalized hostname wins, including Neutral.
2. Otherwise, the most specific matching built-in hostname wins. A built-in matches itself, and matches child hostnames only if its `includeSubdomains` flag is true. Specificity is based on hostname boundaries, never array order or URL text.
3. Otherwise, the result is Neutral / Unclassified.

The popup shows **Automatic**, **Your override**, or **Unclassified** beside the current category. An explicitly cataloged mixed-purpose Neutral site is Automatic; an unknown Neutral site is Unclassified. Website category settings are now **Adjust website categories**: optional overrides rather than required setup. Removing an override restores the current catalog/fallback for that exact host.

`docs.github.com` can be a more specific match than `github.com`; `github.com.example.org` and `notgithub.com` cannot match `github.com`. Hostname normalization is unchanged: HTTP(S) URLs are accepted, but only canonical hostnames are used; paths, query strings, fragments, and ports cannot influence classification. Invalid inputs, unsupported protocols, and embedded credentials are rejected. User overrides remain exact-only to preserve the meaning of all existing saved rules.

## Existing data and integration

Existing persisted rules are already exact-hostname overrides. Their schema is unchanged, including old extension-version-1 and web records; no reset or replay migration is necessary. Adoption, XP, spent credits, activities, goals, timers, preferences, pairing tokens, and prior aggregates remain unchanged. Changing an override closes any active interval under its old category before the new category takes effect. Removing one affects only future time. Rebuilding/reloading starts fresh observations under the existing conservative recovery policy and never recategorizes old aggregates or recalculates prior rewards.

The connected dashboard receives the extension's already-classified category/time aggregates. It does not reclassify accepted time against today's catalog or its own overrides. The approved local sync protocol, strict validation, stable IDs/revisions, duplicate protection, and reward calculations are unchanged. Dashboard and extension overrides remain separate, as before; current tracking uses the extension's list. Both lists are preserved, and neither overwrites the other.

## Updating the catalog

1. Edit `src/websiteCatalog.ts`; choose a dedicated hostname and a conservative category. Cite an official source and explain the choice. Prefer Neutral for uncertain/mixed-purpose sites.
2. Set `includeSubdomains` deliberately. Do not include arbitrary user-hosted content, broad hosting domains, or unrelated service subdomains without a rationale. Add a more specific exception when a reliable hostname distinction exists.
3. Extend `tests/websiteClassification.test.ts` for the new default, relevant subdomains, a deceptive suffix, and override precedence. The catalog is checked for canonical unique hosts and documented scope. Changes to active classification should retain the extension accounting/sync regression tests.
4. Run `npm test`, `npm run test:extension`, `npm run lint`, `npm run build`, `npm run build:extension`, and `git diff --check` (`npm.cmd` in PowerShell if necessary).
5. Bump the extension package version when delivering a new catalog. Rebuild, reload the existing unpacked installation at `brave://extensions`, and refresh `http://localhost:5173/`. Existing overrides continue to win.

The catalog is intentionally incomplete and can become stale as services change. Automatic defaults are estimates and can be wrong for a particular person or visit; users can override any site. They provide convenience without expanding collection or claiming verified productive activity.
