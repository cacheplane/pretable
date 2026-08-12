/** Public origin of the docs site. */
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
