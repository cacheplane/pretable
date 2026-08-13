/**
 * Public origin of the docs site. Deliberately not derived from `VERCEL_URL`
 * or any other deploy-time env var: a canonical `Source:` url must point at
 * production from every preview deploy and from localhost alike, since
 * that's the one place the cited url is actually reachable. Known,
 * invisible consequence: on a preview deploy of a brand-new example, the
 * `Source:` line cites a production url that 404s until the branch merges —
 * that is expected, not a bug to "fix" by wiring this to the deploy's own
 * origin.
 */
export const SITE_ORIGIN = "https://pretable.ai";

/**
 * Public path for an example's markdown. `proxy.ts` rewrites this to the
 * `/examples-md/<id>` route, mirroring how `/docs/<slug>.md` reaches
 * `/docs-md/<slug>`.
 */
export function examplePath(id: string): string {
  return `/examples/${id}.md`;
}

export function exampleCanonicalUrl(id: string): string {
  return SITE_ORIGIN + examplePath(id);
}
