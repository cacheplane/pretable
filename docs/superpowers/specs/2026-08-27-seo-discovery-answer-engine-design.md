# SEO Discovery and Answer-Engine Legibility — Design

**Status:** approved direction; production measurement complete; implementation
not started.

## Goal

Make Pretable's public pages discoverable and unambiguous to search crawlers and
answer engines, then improve the metadata defects that can be established from
live evidence. Keep server-side PostHog measurement as a separate follow-up
until a real project token and ingest host are available.

The order is deliberate: discovery and canonicalization first, machine-readable
page meaning second, presentation defects third, and analytics delivery only
when it can be proved against the real destination.

## Ground truth recorded before the change

### Production

The live audit used `curl` against `https://pretable.ai`, not build output.

- `robots.txt` and `sitemap.xml` each return `404 text/html`.
- `llms.txt` returns `200 text/plain`; all 88 URLs it advertises return 200.
- All 49 intended canonical HTML routes return 200: the homepage, `/bench`,
  and 47 docs routes.
- None of those 49 responses contains a canonical link, JSON-LD, or an Open
  Graph image.
- Five rendered descriptions exceed 155 characters: `/bench`, query ownership,
  totals, windowing, and eviction.
- The three API-reference pages render the same title.
- `/docs` duplicates `/docs/getting-started`, and the alternate advertised on
  `/docs` points to a missing `/docs.md` response.
- Plain HTTP permanently redirects to HTTPS in one hop.
- The homepage is prerendered. Docs are server-rendered because their loader
  reads MDX from the filesystem.

### Search Console

The OAuth grant is read-only. The property is `sc-domain:pretable.ai`, and the
signed-in user has Owner permission.

The requested reporting window was May 27–August 24, 2026. Search Console had
data only for August 9–24. The window ends three days before this design date,
so it contains no outcome from work performed after August 24.

- Total: 3 clicks, 109 impressions, 2.8% CTR, average position 2.3.
- Query `pretable`: 3 clicks, 45 impressions, 6.7% CTR, position 3.7.
- Query `site:pretable.ai`: 0 clicks, 5 impressions, position 1.0.
- Page rows expose HTTPS and HTTP variants, but Search Console dimensions are
  privacy-filtered and must not be summed as if they were totals.
- No query/page combination has at least 100 impressions while ranking 5–20.
  There is therefore no statistically defensible CTR-driven rewrite target.
- No sitemap is submitted, so `lastDownloaded` does not exist yet.
- URL Inspection reports only the homepage as indexed. Its last crawl was
  August 22, 2026; Google chose the HTTPS homepage canonical while the page
  declared none.
- The other 48 inspected HTML URLs are `URL is unknown to Google`. They have no
  crawl record or Google-selected canonical, so canonical agreement cannot yet
  be assessed for them.

The small query counts are binomial noise. They are preserved as a baseline,
not used to justify title or description copy.

### Repository baseline on latest `origin/main`

The isolated worktree starts at `a29298a0`.

- `pnpm lint`: passes with one existing TanStack `useVirtualizer` compiler
  warning in the private bench app.
- `pnpm typecheck`: passes.
- `pnpm build`: passes with the existing large Vite chunk warning and two Next
  filesystem-tracing warnings.
- `pnpm test`: the full run has one pre-existing timing-sensitive failure in
  `packages/react/src/__tests__/eviction-gate-blip.test.tsx` after 1,468 tests
  pass. The same file passes all four tests when rerun alone. This is baseline,
  not part of the SEO change, and will not be fixed here.

The first worktree run failed earlier because dependencies were not linked at
all; forced relinking corrected that setup condition before the baseline above
was recorded.

## Scope boundary

This specification covers discovery, canonical URLs, sitemap dates, metadata,
structured data, and a static social image. It also records the PostHog contract
and why implementation is deferred.

It does not submit a sitemap, request indexing, deploy or publish, invent an
author biography, introduce unsupported expertise claims, or attempt to read
Google's Generative AI report programmatically. Those are either human actions
or unavailable through the relevant APIs.

## Architecture

### 1. One canonical route registry

A small SEO route module will expose exactly 49 public HTML routes: `/`,
`/bench`, and the 47 hrefs already owned by `app/docs/_nav.ts`. Navigation
remains the authority for docs URLs; the sitemap must not invent a second docs
catalog.

Fixtures, API endpoints, markdown alternates, search indexes, `llms.txt`, and
example-source routes are excluded. Tests will fail on duplicate URLs, a nav
entry without content, a content page without a nav entry, or an accidental
`/docs` entry.

### 2. Static crawler files and honest `lastmod`

`robots.txt` will be a committed static file. It will explicitly allow the AI
crawlers the owner approved—GPTBot, ClaudeBot, PerplexityBot, Google-Extended,
and CCBot—and retain a wildcard allow rule so new crawlers are not accidentally
blocked. It will advertise the absolute sitemap URL.

The sitemap will be generated into `public/sitemap.xml` before local development
and production builds. A focused generator will:

1. read the canonical route registry;
2. resolve each docs href to the same MDX file the route loader uses;
3. obtain the latest Git commit timestamp for that page's source;
4. use the relevant page/template sources for the homepage and bench page;
5. emit absolute HTTPS locations with per-route ISO dates; and
6. reject a shallow repository instead of substituting the build date.

CI jobs that build the website or a Vercel deployment will check out full Git
history. The generated sitemap is a build artifact rather than committed
content. Tests will exercise generation with injected timestamps, and a
post-build check will assert 49 locations, 49 `lastmod` values, and more than
one distinct date. This prevents a silently collapsed build-date distribution.

### 3. Duplicate URL resolution

`/docs` will permanently redirect to `/docs/getting-started`, the URL already
used by navigation and `llms.txt`. The historical `/docs.md` alternate will
permanently redirect to `/docs/getting-started.md`; that target continues
through the existing markdown rewrite.

Every indexable HTML route will declare an absolute self-referencing canonical.
No redirected URL enters the sitemap.

### 4. Shared page metadata contract

A focused SEO module will hold the production origin, shared site identity, and
a typed page descriptor. One resolver will produce Next metadata and the
page-level JSON-LD input from that descriptor. The resolver is the only place
that copies a description onto metadata surfaces.

This creates a testable invariant: whenever a page-level JSON-LD node has a
`description`, it is byte-for-byte identical to the rendered meta description.
Open Graph and Twitter descriptions use that same value. URLs and images are
absolute through a single `metadataBase`/site-origin constant.

Before editing the five long descriptions or three duplicate titles, one docs
frontmatter value will be changed as a canary. The production build will be
started locally and queried over HTTP. Only after that authored value appears
in rendered HTML through the expected pipeline will the remaining factual copy
edits be made. The new copy will describe only behavior already present on the
corresponding page.

### 5. Structured data

The root layout will publish sitewide `Organization` and `WebSite` entities with
only demonstrable facts: Pretable's name, canonical site URL, and the public
repository URL already linked by the site. These entity nodes will omit a
description so they cannot conflict with a route's page description.

Page templates will add:

- `WebPage` for the homepage;
- `WebPage` for `/bench`; and
- `TechArticle` plus `BreadcrumbList` for docs pages.

The breadcrumb labels and order will match the visible `group › title` trail.
No `Person`, author, employer, credential, award, education, client, or expertise
claim will be added because the site currently publishes no evidence for one.

JSON serialization will escape `<` to prevent script termination. Schema tests
will parse every emitted block as JSON and assert canonical URLs, types,
breadcrumb order, and description equality.

### 6. Static social image

One 1200×630 PNG will be created from Pretable's existing code-native brand
mark, colors, and typography, committed under `public`, and referenced by all
page descriptors. It is intentionally a static file: there is no request-time
image component that can begin returning 500s after deployment.

Tests will validate the PNG signature and dimensions. Local and production
HTTP checks will require `200 image/png`.

### 7. PostHog measurement boundary

PostHog is the selected destination, but there is no project token or ingest
host yet. This change will not add a silent no-op analytics path and will not
claim events are delivered.

When credentials are available, a separate specification will cover:

- a pure user-agent/referrer classifier;
- server-side capture for crawler requests and human arrivals from AI engines;
- an explicit PostHog host and project token supplied only through deployment
  environment variables;
- timeouts and failure behavior that never break page delivery; and
- an end-to-end production check that sends controlled requests, waits for
  ingest lag, and queries the real PostHog project.

No credential file, OAuth token, or PostHog key will be committed. The repo's
`/keys/` directory is ignored as a separate security change.

## Error handling

SEO generation fails closed when its output would be misleading: shallow Git
history, a route with no content source, a source with no Git date, a duplicate
canonical, or malformed output stops the build. It never replaces unknown
dates with one build timestamp.

A missing docs page continues to 404. Metadata generation may use its current
not-found fallback internally, but no nonexistent route is added to the
sitemap. Structured-data serialization accepts plain data only and produces no
HTML from content.

Redirects are permanent and one-hop. Canonical generation never infers an
origin from a request header.

## Testing and verification

Implementation follows test-first steps and keeps discovery, metadata/schema,
copy, and image changes in separate commits.

### Automated and local HTTP checks

- route-registry parity with docs navigation/content;
- sitemap XML escaping, absolute URLs, distinct Git dates, and shallow-clone
  rejection;
- explicit crawler rules and sitemap declaration in `robots.txt`;
- permanent redirects for `/docs` and `/docs.md`;
- canonical metadata for homepage, bench, and docs templates;
- parseable JSON-LD with exact meta/JSON-LD description equality;
- visible and structured breadcrumbs with the same labels;
- no duplicate rendered titles and no description over 155 characters among
  the 49 canonical pages;
- static OG image signature, dimensions, and HTTP content type; and
- existing lint, typecheck, build, and tests, compared with the recorded flaky
  test baseline rather than reported as newly green.

### Production checks after the owner deploys

Every live-site claim will be backed by a fresh `curl`. The verification report
will include the command and output for:

- `robots.txt`, `sitemap.xml`, redirects, and all canonical route statuses;
- rendered description text and length;
- canonical links;
- parsed JSON-LD and description equality by route type;
- sitemap URL count and `lastmod` distribution;
- `200 image/png` for the social image; and
- representative markup regression checks.

One deployed URL per template will then be run through Google's Rich Results
Test. PostHog arrival cannot be tested in this release without its real
credentials and will be listed as unverified, not passed.

## Human actions

After deployment, the owner must:

1. submit or resubmit `https://pretable.ai/sitemap.xml` in Search Console and
   record `lastDownloaded` once Google fetches it;
2. perform any desired URL-indexing requests;
3. read AI Overview/AI Mode visibility from Google's UI if that baseline is
   wanted; and
4. provide the PostHog project token and ingest host for the analytics
   follow-up.

The earliest honest read on CTR change is roughly one week after deployment,
once Search Console's lagging data window actually contains post-deploy days.
Given the current impression volume, copy-level conclusions may require much
longer and still require roughly 100 impressions for an actionable row.
