# SEO Discovery and Answer-Engine Legibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a canonical, crawlable 49-page site surface with honest sitemap dates, consistent metadata/JSON-LD, deliberate crawler access, and a static social image, while preserving an evidence-backed baseline.

**Architecture:** A single typed route registry feeds a build-time sitemap generator. A shared page descriptor feeds Next metadata and page JSON-LD so descriptions cannot drift between surfaces. Static crawler/image assets eliminate request-time failure modes; PostHog remains a separate credential-gated follow-up.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Vitest, Playwright, pnpm workspaces, Vercel, GitHub Actions.

---

## Scope and working rules

- Work only in `/Users/blove/repos/pretable/.worktrees/seo-discovery-foundation` on `blove/seo-discovery-foundation`.
- Read `docs/superpowers/specs/2026-08-27-seo-discovery-answer-engine-design.md` before starting.
- Use `@superpowers:test-driven-development` for each production-code task.
- Do not deploy, submit a sitemap, request indexing, or add PostHog code without the real project token and ingest host.
- Do not add `Person`, biography, employment, credential, award, education, client, or unsupported expertise claims.
- Do not author the bulk title/description changes until Task 6's one-value mechanism canary has been built and observed over HTTP.
- Keep the existing full-suite `eviction-gate-blip` timing failure separate. If it recurs but passes alone, record it as baseline; do not repair it here.

## File map

### New focused units

- `apps/website/lib/seo/routes.ts` — the 49 canonical HTML routes and their Git source paths.
- `apps/website/lib/seo/page.ts` — site constants, typed page descriptors, Next metadata resolver, and schema builders.
- `apps/website/lib/seo/JsonLd.tsx` — safe JSON-LD script rendering only.
- `apps/website/lib/seo/__tests__/routes.test.ts` — route/nav/content parity and source-map coverage.
- `apps/website/lib/seo/__tests__/page.test.tsx` — metadata, schema, breadcrumb, and escaping invariants.
- `apps/website/lib/seo/__tests__/crawler-assets.test.ts` — `robots.txt` and PNG validation.
- `apps/website/scripts/generate-sitemap.ts` — build-time XML generation with Git-history validation.
- `apps/website/scripts/__tests__/generate-sitemap.test.ts` — XML, date-distribution, and shallow-clone tests.
- `apps/website/public/robots.txt` — static deliberate allow policy.
- `apps/website/public/og/pretable.png` — committed 1200×630 social image.
- `scripts/generate-og-image.mjs` — deterministic, manually run renderer for the static PNG.

### Existing integration points

- `apps/website/package.json` — add sitemap generation to `predev`/`prebuild`.
- `apps/website/.gitignore` — ignore generated `public/sitemap.xml` only.
- `package.json` — add the manual OG renderer command.
- `.github/workflows/ci.yml` — give website build/deploy jobs full Git history.
- `apps/website/next.config.ts` — permanent duplicate URL redirects.
- `apps/website/app/layout.tsx` — metadata base and sitewide entity JSON-LD.
- `apps/website/app/page.tsx` — homepage page JSON-LD.
- `apps/website/app/bench/page.tsx` — shared bench metadata/page JSON-LD, then its description canary.
- `apps/website/app/docs/[[...slug]]/page.tsx` — shared docs metadata, `TechArticle`, and `BreadcrumbList`.
- `apps/website/app/docs/[[...slug]]/__tests__/page.test.tsx` — rendered docs schema assertions.
- `apps/website/app/components/docs/DocsBreadcrumb.tsx` and its test — expose the same ordered labels used by schema without changing the visible trail.
- `apps/website/e2e/smoke.spec.ts` — redirects, crawler files, canonical/schema, and OG HTTP behavior.
- Five long-description sources: `apps/website/app/bench/page.tsx` plus `apps/website/content/docs/server-data/{query-ownership,totals,windowing,eviction}.mdx`.
- Three duplicate-title sources: `apps/website/content/docs/{grid,headless,streaming}/api-reference.mdx`.

## Task 1: Create the canonical route registry

**Files:**

- Create: `apps/website/lib/seo/routes.ts`
- Create: `apps/website/lib/seo/__tests__/routes.test.ts`
- Reuse: `apps/website/app/docs/_nav.ts`
- Reuse: `apps/website/lib/docs/paths.ts`

- [ ] **Step 1: Write the failing route-registry tests**

Test these exact invariants:

```ts
expect(routes).toHaveLength(49);
expect(routes.map((route) => route.path)).toEqual([
  "/",
  "/bench",
  ...docsNav.flatMap((section) => section.items.map((item) => item.href)),
]);
expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length);
expect(routes.some((route) => route.path === "/docs")).toBe(false);
expect(routes.every((route) => route.sources.length > 0)).toBe(true);
```

For every docs route, parse the slug from its nav href, call
`slugToContentPath(slug)`, and assert the resulting MDX file exists. Reuse the
existing navigation tests rather than copying their resolver.

- [ ] **Step 2: Run the test and verify it fails for the missing module**

Run:

```bash
pnpm --filter @pretable/app-website exec vitest run lib/seo/__tests__/routes.test.ts
```

Expected: FAIL because `lib/seo/routes.ts` does not exist.

- [ ] **Step 3: Implement the minimal registry**

Export a `SeoRoute` containing `path`, `kind`, and repository-root-relative
`sources`. Build docs entries directly from `docsNav`.

Use these source sets:

- `/`: `apps/website/app/page.tsx`, `apps/website/app/layout.tsx`,
  `apps/website/app/globals.css`, `apps/website/app/styles`, and
  `apps/website/app/components`, excluding `apps/website/app/components/docs`.
- `/bench`: `apps/website/app/bench`, `apps/website/app/globals.css`, and the
  four `status/milestones/*.json` files read by `app/bench/page.tsx`.
- each docs route: its single resolved file under
  `apps/website/content/docs/`.

Represent the homepage exclusion as Git pathspec
`:(exclude)apps/website/app/components/docs`; do not emulate exclusion after
asking Git for a date.

- [ ] **Step 4: Run the focused test**

Expected: one test file passes and reports 49 unique routes.

- [ ] **Step 5: Commit**

```bash
git add apps/website/lib/seo/routes.ts apps/website/lib/seo/__tests__/routes.test.ts
git commit -m "feat(website): define canonical SEO routes"
```

## Task 2: Generate an honest sitemap from Git history

**Files:**

- Create: `apps/website/scripts/generate-sitemap.ts`
- Create: `apps/website/scripts/__tests__/generate-sitemap.test.ts`
- Modify: `apps/website/package.json`
- Modify: `apps/website/.gitignore`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write failing pure-generator tests**

Design the generator around injected boundaries:

```ts
interface GenerateSitemapOptions {
  routes: readonly SeoRoute[];
  isShallow: () => Promise<boolean>;
  lastModified: (sources: readonly string[]) => Promise<string | null>;
}
```

Assert that it:

- rejects when `isShallow()` is true;
- rejects a route whose source has no Git timestamp;
- emits 49 absolute `https://pretable.ai/...` locations;
- emits one `lastmod` per location;
- XML-escapes values;
- preserves different injected dates instead of replacing them with one date;
- rejects duplicate paths; and
- never emits `/docs`.

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm --filter @pretable/app-website exec vitest run scripts/__tests__/generate-sitemap.test.ts
```

Expected: FAIL because the generator does not exist.

- [ ] **Step 3: Implement the pure XML builder and Git adapter**

Use `execFile`/`promisify`, never a shell command string. The real adapter must
run:

```text
git rev-parse --is-shallow-repository
git log -1 --format=%cI -- <all source pathspecs for one route>
```

The latter command returns the newest commit touching any source in that
route's source set; that is the aggregation rule for homepage and bench dates.
Validate every timestamp with `Date.parse` and preserve the original ISO value.

Resolve the repository root from `import.meta.url` (the script lives at
`apps/website/scripts/generate-sitemap.ts`, so the root is three directories
above its containing directory). Pass that absolute root as `cwd` to every Git
call. Resolve the output as
`<repo-root>/apps/website/public/sitemap.xml`, then write atomically through a
temporary file in the same directory followed by rename. Do not depend on the
caller's working directory: the filtered package command below starts in
`apps/website`, while every route source is repository-root-relative.

- [ ] **Step 4: Wire generation into development/build only**

Add `seo:sitemap` using the workspace's root `tsx` binary. Run it in `predev`
and `prebuild` after dependency preparation and before `next dev`/`next build`.
Do not add it to `pretest` or typecheck.

Ignore only `/public/sitemap.xml` in `apps/website/.gitignore`. Do not ignore
all of `public`.

- [ ] **Step 5: Give only website-building CI jobs full history**

Add `with: { fetch-depth: 0 }` to `actions/checkout@v7` in these jobs:

- `build`;
- `dev-smoke`;
- `deploy-prod`; and
- `deploy-preview`.

Do not mechanically change unrelated checkout steps.

- [ ] **Step 6: Verify focused tests and a real local generation**

```bash
pnpm --filter @pretable/app-website exec vitest run scripts/__tests__/generate-sitemap.test.ts lib/seo/__tests__/routes.test.ts
pnpm --filter @pretable/app-website seo:sitemap
rg -c '<url>' apps/website/public/sitemap.xml
rg -o '<lastmod>[^<]+' apps/website/public/sitemap.xml | sort -u | wc -l
```

Expected: tests pass; URL count is 49; distinct-date count is greater than 1.

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/ci.yml apps/website/.gitignore apps/website/package.json apps/website/scripts
git commit -m "feat(website): generate sitemap from page history"
```

Do not add the ignored generated XML.

## Task 3: Publish deliberate crawler rules and remove duplicate URLs

**Files:**

- Create: `apps/website/public/robots.txt`
- Create: `apps/website/lib/seo/__tests__/crawler-assets.test.ts`
- Modify: `apps/website/next.config.ts`
- Modify: `apps/website/e2e/smoke.spec.ts`

- [ ] **Step 1: Write failing crawler-policy and redirect tests**

The file-level test must require explicit `Allow: /` groups for GPTBot,
ClaudeBot, PerplexityBot, Google-Extended, and CCBot; a wildcard allow group;
and exactly this sitemap URL:

```text
Sitemap: https://pretable.ai/sitemap.xml
```

Add Playwright request assertions with redirects disabled:

```ts
expect((await request.get("/docs", { maxRedirects: 0 })).status()).toBe(308);
expect((await request.get("/docs.md", { maxRedirects: 0 })).status()).toBe(308);
```

Also assert the `location` targets are `/docs/getting-started` and
`/docs/getting-started.md`, then follow each and require 200.

- [ ] **Step 2: Run focused tests and observe failure**

```bash
pnpm --filter @pretable/app-website exec vitest run lib/seo/__tests__/crawler-assets.test.ts
```

Expected: FAIL because `public/robots.txt` does not exist. The redirect portion
will be exercised after the next production build in Step 4.

- [ ] **Step 3: Add the static file and permanent redirects**

Use explicit named groups followed by:

```text
User-agent: *
Allow: /
```

Add two entries to `next.config.ts`'s `redirects()` and preserve its existing
headers configuration. Do not change the markdown proxy.

- [ ] **Step 4: Build, start, and verify over local HTTP**

```bash
pnpm --filter @pretable/app-website build
pnpm --filter @pretable/app-website exec next start -p 3101
curl -sS -o /dev/null -D - http://127.0.0.1:3101/docs
curl -sS -o /dev/null -D - http://127.0.0.1:3101/docs.md
curl -sS http://127.0.0.1:3101/robots.txt
```

Expected: both redirects are 308 with the intended one-hop locations; robots
is 200 text/plain and includes the absolute sitemap URL. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add apps/website/public/robots.txt apps/website/next.config.ts apps/website/e2e/smoke.spec.ts apps/website/lib/seo/__tests__/crawler-assets.test.ts
git commit -m "feat(website): publish crawler policy and canonical redirects"
```

## Task 4: Add a static, testable social image

**Files:**

- Create: `scripts/generate-og-image.mjs`
- Create: `apps/website/public/og/pretable.png`
- Modify: `package.json`
- Modify: `apps/website/lib/seo/__tests__/crawler-assets.test.ts`

- [ ] **Step 1: Extend the asset test and verify it fails**

Read the PNG as bytes. Assert the eight-byte PNG signature, width 1200 from
IHDR bytes 16–19, height 630 from bytes 20–23, and file size greater than
10 KB.

- [ ] **Step 2: Add the deterministic manual renderer**

Use Chromium from the root `@playwright/test` dependency. Render a 1200×630
HTML card using Pretable's existing cool-slate palette, display/mono typography,
and code-native trail/stream mark. Include only the product name, site URL, and
the already-published homepage value proposition. Screenshot directly to the
target PNG with animations disabled.

Add root command:

```json
"seo:og": "node ./scripts/generate-og-image.mjs"
```

The image is generated manually and committed; do not run a browser during the
production build.

- [ ] **Step 3: Generate and inspect the image**

```bash
pnpm seo:og
file apps/website/public/og/pretable.png
```

Open the PNG in the app and verify that the mark/text are not cropped and the
smallest text is legible. If visual correction is needed, change the renderer
and regenerate; do not hand-edit the bitmap.

- [ ] **Step 4: Run the asset test**

Expected: the crawler-assets test passes with 1200×630.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/generate-og-image.mjs apps/website/public/og/pretable.png apps/website/lib/seo/__tests__/crawler-assets.test.ts
git commit -m "feat(website): add static social preview image"
```

## Task 5: Unify metadata and structured data

**Files:**

- Create: `apps/website/lib/seo/page.ts`
- Create: `apps/website/lib/seo/JsonLd.tsx`
- Create: `apps/website/lib/seo/__tests__/page.test.tsx`
- Modify: `apps/website/app/layout.tsx`
- Modify: `apps/website/app/page.tsx`
- Modify: `apps/website/app/bench/page.tsx`
- Modify: `apps/website/app/docs/[[...slug]]/page.tsx`
- Modify: `apps/website/app/docs/[[...slug]]/__tests__/page.test.tsx`
- Modify: `apps/website/app/components/docs/DocsBreadcrumb.tsx`
- Modify: `apps/website/app/components/docs/__tests__/DocsBreadcrumb.test.tsx`

- [ ] **Step 1: Write failing resolver and schema tests**

Define test fixtures for homepage, bench, and docs descriptors. Require:

- absolute self-canonical URLs under `https://pretable.ai`;
- absolute `https://pretable.ai/og/pretable.png` Open Graph/Twitter images;
- `summary_large_image` Twitter cards;
- exact equality among meta, Open Graph, Twitter, and page-schema descriptions;
- `WebPage` for home/bench;
- `TechArticle` and ordered `BreadcrumbList` for docs;
- sitewide `Organization` and `WebSite` with name/site/repository only and no
  description or `Person`;
- JSON serialization that replaces `<` with `\\u003c`; and
- visible breadcrumb labels exported through the same helper used to build
  structured breadcrumbs.

- [ ] **Step 2: Run focused tests and observe missing exports**

```bash
pnpm --filter @pretable/app-website exec vitest run lib/seo/__tests__/page.test.tsx app/components/docs/__tests__/DocsBreadcrumb.test.tsx
```

- [ ] **Step 3: Implement the page descriptor and metadata resolver**

Use a single typed descriptor containing the full rendered title, description,
canonical path, schema headline, kind, optional markdown alternate, and optional
breadcrumb. `resolvePageMetadata(descriptor)` must be the only function that
copies a description into meta/Open Graph/Twitter fields.

Keep these facts centralized:

```ts
export const SITE_ORIGIN = "https://pretable.ai";
export const SITE_NAME = "Pretable";
export const REPOSITORY_URL = "https://github.com/cacheplane/pretable";
export const OG_IMAGE_PATH = "/og/pretable.png";
```

The page-schema builder receives the same descriptor. Omit dates and authors.
The sitewide graph omits descriptions.

- [ ] **Step 4: Implement safe JSON-LD rendering**

`JsonLd` accepts plain JSON data, uses `JSON.stringify(data).replace(/</g,
"\\u003c")`, and renders a script with `type="application/ld+json"`. Do not
accept raw JSON strings from callers.

- [ ] **Step 5: Integrate each template without editing content values**

- Root layout: set `metadataBase`, resolve current homepage title/description,
  and render the sitewide graph.
- Homepage: render its page-level `WebPage` node.
- Bench: move its current title/description into a descriptor and render
  `WebPage`.
- Docs: after loading frontmatter, construct one descriptor for both metadata
  and page schema; preserve markdown alternates and `x-llms-txt`.
- Breadcrumbs: derive ordered `{ name, path }` values from the nav section and
  title while preserving the visible `group › title` output.

Do not add new titles or descriptions in this task.

- [ ] **Step 6: Run focused tests and the website build**

```bash
pnpm --filter @pretable/app-website exec vitest run lib/seo/__tests__/page.test.tsx 'app/docs/[[...slug]]/__tests__/page.test.tsx' app/components/docs/__tests__/DocsBreadcrumb.test.tsx
pnpm --filter @pretable/app-website build
```

Expected: tests and build pass; existing Next filesystem warnings remain.

- [ ] **Step 7: Commit**

```bash
git add apps/website/lib/seo apps/website/app/layout.tsx apps/website/app/page.tsx apps/website/app/bench/page.tsx 'apps/website/app/docs/[[...slug]]' apps/website/app/components/docs/DocsBreadcrumb.tsx apps/website/app/components/docs/__tests__/DocsBreadcrumb.test.tsx
git commit -m "feat(website): add canonical metadata and structured data"
```

## Task 6: Prove the content pipeline, then fix demonstrated copy defects

**Files:**

- Modify first: `apps/website/content/docs/server-data/windowing.mdx`
- Then modify: `apps/website/app/bench/page.tsx`
- Then modify: `apps/website/content/docs/server-data/query-ownership.mdx`
- Then modify: `apps/website/content/docs/server-data/totals.mdx`
- Then modify: `apps/website/content/docs/server-data/eviction.mdx`
- Then modify: `apps/website/content/docs/{grid,headless,streaming}/api-reference.mdx`
- Create: `apps/website/lib/seo/__tests__/content-metadata.test.ts`

- [ ] **Step 1: Author exactly one final description as the mechanism canary**

Replace only the windowing frontmatter description. It must be one complete
sentence, at most 155 characters, answer what the page explains, and contain
only behavior stated in that page. Do not edit any other title or description
yet.

The exact sentence is intentionally authored during this step, not in this
plan: the project rule forbids writing dependent content before the mechanism
has been proved. Record the chosen sentence in the execution notes.

- [ ] **Step 2: Build, serve, and prove the authored value traversed the real pipeline**

```bash
pnpm --filter @pretable/app-website build
pnpm --filter @pretable/app-website exec next start -p 3101
curl -sS http://127.0.0.1:3101/docs/server-data/windowing > /tmp/pretable-windowing.html
rg -o '<meta name="description" content="[^"]+"' /tmp/pretable-windowing.html
rg -o '<script type="application/ld\+json"[^>]*>[^<]+' /tmp/pretable-windowing.html
```

Expected: both outputs contain the exact authored sentence. If either does not,
stop and debug the resolver before writing more content. Stop the server after
the check.

- [ ] **Step 3: Add the failing corpus-level metadata test**

Read all 47 docs frontmatter records with `gray-matter`, include the homepage
and bench descriptors, and assert:

- every description is nonempty and at most 155 characters;
- the three API page titles are distinct;
- each API title begins with the package or surface term visibly documented on
  its page; and
- no frontmatter field outside `title`, `description`, and `nav` is introduced.

Run the test. Expected: FAIL on the four remaining long descriptions—bench,
query ownership, totals, and eviction—and on the duplicate API titles; the
windowing canary must no longer fail.

- [ ] **Step 4: Author only the remaining demonstrated fixes**

Shorten the four remaining overlong descriptions to complete, factual,
query-answering sentences under 155 characters. Front-load each API title with
its distinctive package/surface term while leaving sidebar labels unchanged.

Use only claims already stated on the same page. Do not add promotional
superlatives, performance numbers, author claims, or expertise lists.

- [ ] **Step 5: Run the corpus test and rendered-HTML audit locally**

Build and serve, then fetch all 49 routes with `curl`. Report:

- status;
- title;
- description length;
- canonical;
- Open Graph image; and
- page JSON-LD description.

Assert no duplicate title and exact meta/JSON-LD description equality. Keep the
audit command/output in the execution record; do not replace the curl evidence
with a unit-test claim.

- [ ] **Step 6: Commit the canary and subsequent copy fixes together only after proof**

```bash
git add apps/website/app/bench/page.tsx apps/website/content/docs/server-data apps/website/content/docs/grid/api-reference.mdx apps/website/content/docs/headless/api-reference.mdx apps/website/content/docs/streaming/api-reference.mdx apps/website/lib/seo/__tests__/content-metadata.test.ts
git commit -m "docs(website): improve distinct search snippets"
```

## Task 7: Extend end-to-end SEO coverage

**Files:**

- Modify: `apps/website/e2e/smoke.spec.ts`

- [ ] **Step 1: Add one representative assertion per template**

For `/`, `/bench`, and `/docs/grid/filtering`, assert over HTTP/DOM:

- 200 status;
- one self-canonical link;
- one page-level JSON-LD node with the expected type;
- meta and JSON-LD descriptions exactly equal; and
- absolute OG image URL whose direct response is `200 image/png`.

Also request `/robots.txt` and `/sitemap.xml`, asserting content types and 49
sitemap `<url>` nodes.

- [ ] **Step 2: Run the production-mode smoke subset**

Build once, start `next start`, and run only the new/affected smoke tests against
that server. Expected: all new checks pass.

- [ ] **Step 3: Commit**

```bash
git add apps/website/e2e/smoke.spec.ts
git commit -m "test(website): cover crawler-visible SEO output"
```

## Task 8: Full local verification and review

**Files:** no new production files expected.

- [ ] **Step 1: Run formatting and static checks**

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm build
```

Expected: format, lint, typecheck, and build pass. Compare warnings with the
baseline rather than describing them as new.

- [ ] **Step 2: Run the full test suite**

```bash
pnpm test
```

If `eviction-gate-blip` is the only failure, rerun exactly:

```bash
pnpm --filter @pretable/react exec vitest run src/__tests__/eviction-gate-blip.test.tsx --environment jsdom
```

Record both outputs. Any additional failure is a regression and must be
debugged before proceeding.

- [ ] **Step 3: Inspect the complete diff and secret safety**

```bash
git diff origin/main...HEAD --check
git status --short
git check-ignore -v /Users/blove/repos/pretable/keys/*
git ls-files keys
```

Expected: no whitespace errors; only intentional files; credential files are
ignored; `git ls-files keys` prints nothing. Never print credential contents or
filenames in the report.

- [ ] **Step 4: Request code review**

Use `@superpowers:requesting-code-review` against the full branch diff. Resolve
only findings within this plan's scope, rerun relevant verification after every
change, and keep unrelated failures separate.

## Task 9: Owner deploy and production verification

**Files:** no repository change unless verification finds an in-scope defect.

- [ ] **Step 1: Hand the reviewed branch to the owner**

Use `@superpowers:finishing-a-development-branch`. Do not publish or deploy.
Tell the owner that PostHog server delivery is still blocked on credentials.

- [ ] **Step 2: After the owner deploys, verify the real site with curl**

Use fresh commands against `https://pretable.ai`, including:

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://pretable.ai/robots.txt
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://pretable.ai/sitemap.xml
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://pretable.ai/docs
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://pretable.ai/docs.md
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://pretable.ai/og/pretable.png
```

Curl all 49 canonical HTML routes and parse the saved responses. Require one
self-canonical per route, descriptions at most 155 characters, absolute OG
images, parseable route-type JSON-LD, and exact meta/JSON-LD description
equality. Report the sitemap URL count and the complete distinct-date
distribution, not merely the number of dates.

- [ ] **Step 3: Run Rich Results Test without Search Console mutations**

Test one deployed URL per template: homepage, bench, and one docs page. Record
the result. Do not submit a sitemap or request indexing.

- [ ] **Step 4: Produce the required evidence report**

Report in this order:

1. what changed;
2. what was verified, with each command and relevant output;
3. what degraded relative to the baseline;
4. what could not be verified, including PostHog ingestion;
5. what requires a human: sitemap submission, optional indexing requests,
   Google's UI-only Generative AI report, and PostHog credentials; and
6. the original Search Console measurement window and metrics.

State plainly that the earliest honest CTR read is about one week after deploy,
once Search Console's window includes post-deploy data, and that current
small-impression rows are not actionable.
