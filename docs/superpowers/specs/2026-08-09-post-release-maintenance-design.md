# Post-release website maintenance design

Date: 2026-08-09
Status: proposed for written review

## Goal

Close the small, confirmed gaps found while smoke-testing the `0.0.10` release:

- serve a branded favicon instead of returning `404` on every cold page load;
- correct public documentation that no longer matches the published React and
  headless APIs; and
- protect both corrections with proportionate automated checks.

This is a website and documentation maintenance change. It does not change a
published package, runtime grid behavior, or public API.

## Confirmed problems

### Missing favicon

The website has no favicon, icon, or manifest under `apps/website/app` or
`apps/website/public`. Both a local production build and the deployed site
return `404` for `/favicon.ico`; a clean browser load consequently records one
console error even though the page itself works.

Next.js App Router treats `app/favicon.ico` as a special metadata file and
emits the corresponding icon link automatically. The site therefore needs a
real asset at `apps/website/app/favicon.ico`, not custom request handling or a
manual metadata URL.

### Documentation drift

The published `@pretable/react@0.0.10` package and current source establish
three contracts that the docs currently misstate:

1. `@pretable/react` has peer dependencies on both `react ^19.0.0` and
   `react-dom ^19.0.0`; the root README mentions only React and the website's
   getting-started page mentions neither prerequisite.
2. The lower-level React hook is `usePretable`; `usePretableModel` is not a
   published export, despite the root README recommending it.
3. `snapshot.visibleRows` is a discriminated union of data rows and group
   header rows. The headless starter destructures `row` without narrowing, and
   the headless state model plus React API reference still describe a
   data-only shape.

The third mismatch is not only imprecise prose: copying the documented
headless example into a grouped grid fails TypeScript because group entries do
not have a `row` property.

## Approaches considered

### 1. One focused website/docs maintenance change — selected

Add the conventional favicon, one direct browser regression, and the smallest
coherent documentation corrections. This fixes every confirmed user-facing
gap without publishing another package version or mixing in unrelated build
cleanup.

### 2. Fix only the missing asset

This would remove the visible browser error but leave install instructions and
copyable headless code inconsistent with the package that was just released.
Rejected because the documentation mismatches are confirmed and equally small
to correct.

### 3. Fold all post-release warnings into the same change

The successful production build still reports pre-existing Turbopack
filesystem-tracing warnings from the benchmark page and generic docs loader.
Resolving them safely requires a separate packaging design: the current APIs
deliberately compute repository and content paths at runtime. Rewriting those
paths in a favicon/docs patch would expand both scope and deployment risk.

Rejected for this maintenance change; the warnings remain tracked follow-up
work rather than release blockers.

## Design

### Branded favicon

Add a square multi-size ICO file at `apps/website/app/favicon.ico`, using a
simple mark that remains legible at 16px:

- dark cool-slate background (`#0b1120`, the website page surface);
- lowercase `p` in the primary text color (`#e2e8f0`); and
- a small period in the live wordmark accent (`#0284c7`).

The mark mirrors the existing `pretable.` wordmark rather than introducing a
new logo. It has no transparency-dependent detail, fine linework, or text
beyond the single glyph. The implementation plan will require rendering and
visually inspecting the actual 16px and 32px outputs before accepting it.

Do not add a web manifest, alternate icon formats, hand-authored `<link>` tags,
or a custom route. The Next.js file convention is sufficient for the current
browser request and keeps metadata ownership in one place.

### Favicon regression

Add a focused Playwright assertion to the website smoke coverage:

1. request `/favicon.ico` and assert status `200`;
2. assert an icon/image content type and a non-empty response body; and
3. cold-load a representative route with error listeners installed before
   navigation and assert no failed favicon response or favicon console error.

The request assertion must first be observed failing against the current
branch with the existing `404`. The browser assertion protects the integration
between the App Router convention and page metadata; it should not duplicate
the broad visual-validation matrix.

Run the focused regression in both Chromium and WebKit. The asset itself is
browser-neutral, but both engines are already part of the website smoke gate
and the earlier clean release smoke covered both.

### Install and hook documentation

Update the root `README.md` to:

- state both React peer dependencies; and
- recommend `usePretable` for lower-level rendering and state control.

Update `apps/website/content/docs/getting-started/index.mdx` so the install step
names `react@^19` and `react-dom@^19` as peer prerequisites. Keep the primary
package command focused on `@pretable/react` and `@pretable/ui`; do not imply
that an existing React application must reinstall its framework packages.

### Headless visible-row documentation

Update the starter example to narrow on `visibleRow.kind` before reading
`visibleRow.row`. The example will render data rows and deliberately skip group
headers because teaching custom tree-row markup is outside a first-grid guide.
Adjacent prose will say that grouping inserts group entries and that consumers
which render grouping must handle both union members.

Update the corresponding type descriptions in:

- `apps/website/content/docs/headless/state-model.mdx`; and
- `apps/website/content/docs/grid/api-reference.mdx`.

Use the exported `PretableDataRow<TRow> | PretableGroupRow` names rather than
maintaining another hand-written data-only object type. Document the
discriminant and the useful group fields (`id`, `depth`, `columnId`, `value`,
`childCount`, and `aggregates`) without expanding this patch into a complete
grouping tutorial.

### Release record

Do not add a Changeset. The diff changes only the private website, repository
README, tests, and a static asset; none of the four published packages changes.
The pull request release-notes section will state that explicitly.

## Verification

Implementation follows red-green verification:

1. Add the focused favicon request test and record its expected `404` failure.
2. Add the icon and prove the focused Chromium and WebKit tests pass.
3. Visually inspect the generated 16px and 32px favicon renditions.
4. Run website unit tests, typecheck, lint, and production build.
5. Run the website browser suite in Chromium and WebKit against the local
   production build.
6. Run root formatting and diff checks, plus Changesets status against
   `origin/main` to confirm no package bump is scheduled.

Documentation examples should use real exported names from the current package
source. If the repository has no executable documentation-snippet checker, the
implementation review will compare the snippets directly with the exported
types and record that limitation rather than introducing a new docs compiler in
this maintenance patch.

## Deferred follow-ups

The following observations predate the release work and remain out of scope:

- Turbopack whole-project tracing warnings in
  `apps/website/app/bench/page.tsx` and `apps/website/lib/docs/load.ts`;
- the existing React hooks lint warning in `pretable-surface.tsx`;
- Vite native-loader and large-chunk warnings;
- API Extractor's TypeScript-version warning; and
- optional package-hardening suggestions for `engines.node` and
  `sideEffects`.

They do not fail the release, consumer install, typecheck, build, browser
matrix, publish preflight, or package validation. Each can be prioritized
separately with a scope appropriate to its risk.

## Acceptance criteria

- `/favicon.ico` returns `200` locally with an icon/image content type and no
  cold-load browser error.
- The favicon is recognizable and visually clean at both 16px and 32px.
- Root and website install guidance states both React 19 peer dependencies.
- The README names the real `usePretable` export.
- Headless visible-row examples and type descriptions accurately represent the
  data/group discriminated union and never read `row` without narrowing.
- Focused and full website checks pass in Chromium and WebKit.
- The production website build and static checks pass with only the explicitly
  deferred pre-existing warnings.
- Changesets reports no public package release for this maintenance diff.
