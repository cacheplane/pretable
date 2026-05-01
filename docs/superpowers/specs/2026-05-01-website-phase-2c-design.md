# Website Phase 2.C — Living Doc + RSC Test Setup

**Date:** 2026-05-01
**Status:** Draft for review
**Scope:** `apps/website` only.

---

## 1. Goal

Close two gaps left after Phase 2.A/2.B shipped:

1. **Documentation drift.** The `2026-04-21-pretable-visual-system-design.md` spec describes a cream/amber editorial palette. The website pivoted to cool-slate AI-startup. Anyone consulting that spec is misled.
2. **Zero test coverage.** `apps/website` has no `vitest.config.ts`, no `__tests__/`, and no entry in CI's `test` step. Import-level breakage (typo in a component name, removed export, bad path) ships to `main` without surfacing.

Phase 2.C fixes both. Out of scope: MDX content support (deferred until a `/docs` or `/blog` route needs it), spec-rewriting the historical design doc, interaction or visual-regression testing.

## 2. Non-goals

- New routes or pages.
- MDX integration.
- Behavioral / interaction / visual-regression tests.
- Reworking `@pretable/ui` tokens or `globals.css`.
- Touching `apps/playground`, `apps/bench`, or `apps/streaming-demo` (Phase 3 retires playground separately).

## 3. Deliverables

### 3.1 Living visual-system doc — `apps/website/README.md`

Replace the current Next.js boilerplate README with a living document covering the website's visual system as it actually exists today.

Sections (in order):

1. **Overview** — one paragraph: what `apps/website` is (the marketing landing) and what it isn't (docs, app shell, demo).
2. **Tokens** — pointer to `@pretable/ui/tokens.css` as source of truth; brief table listing the `--pt-*` tokens used by the website (`bg-page`, `bg-card`, `bg-raised`, `text-primary/secondary/muted/dim`, `accent/accent-deep/accent-soft`, `rule/rule-soft`). Don't restate values — point at the package.
3. **Type stack** — Fraunces Variable (display, serif), Inter Variable (sans body), JetBrains Mono Variable (mono). Where each is used.
4. **Page gradient** — what `body` does (the linear-gradient with `background-attachment: fixed`), why `position: relative` matters (anchors `<LandingAmbient />`).
5. **Section anatomy** — list each top-level component in render order (`Hero`, `PlaygroundSection`, `Problem`, `Solution`, `ReceiptsBand`, `ComparisonTable`, `FeatureGrid`, `CodeExample`, `CtaSection`) with one-line description of what each section communicates.
6. **Narrative scaffolding** — the two systems that span the page:
   - `<ScrollReveal>` (client component, IntersectionObserver one-shot, opacity + 24px translateY, 700ms ease-out, respects `prefers-reduced-motion`). Wraps body sections, NOT Hero / PlaygroundSection.
   - `<LandingAmbient />` (server component, six absolute-positioned blurred radial-gradient blobs, cool→indigo→cyan→amber→amber→cyan arc, behind everything at `-z-40`). Re-tune comment block in the source explains how to adjust `top` values when sections change height.
7. **How to add a section** — short snippet showing the pattern: create `app/components/Foo.tsx`, render in `app/page.tsx` inside `<ScrollReveal>` if below the fold.
8. **Testing** — pointer to `__tests__/` and what's covered (smoke only, no interaction).

Tone: terse, factual, no marketing copy. Target reader: a contributor (or future-me) who needs to add a section without re-reading 1500 lines of source.

### 3.2 Supersede banner on the old spec

Prepend the existing `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` with a one-block status banner:

```markdown
> **Status: Superseded.** This spec described a cream/amber editorial palette. The website pivoted to a cool-slate AI-startup direction in Phase 2.A (2026-04-30). For the current visual system, see [`apps/website/README.md`](../../../apps/website/README.md). This document is preserved for design-history continuity.
```

No other edits to the file. Keep history.

### 3.3 RSC smoke tests — `apps/website/__tests__/`

Goal: catch import-level breakage in CI. NOT to assert visual correctness or behavior.

**Framework:** `vitest` + `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`. Matches the pattern in `packages/react/vitest.config.ts`.

**Scope:** one smoke test per top-level component plus one for the page:

- `__tests__/page.test.tsx` — renders `<HomePage />`, asserts the document body is non-empty and contains the hero heading text.
- `__tests__/components/Hero.test.tsx`
- `__tests__/components/PlaygroundSection.test.tsx`
- `__tests__/components/Problem.test.tsx`
- `__tests__/components/Solution.test.tsx`
- `__tests__/components/ReceiptsBand.test.tsx`
- `__tests__/components/ComparisonTable.test.tsx`
- `__tests__/components/FeatureGrid.test.tsx`
- `__tests__/components/CodeExample.test.tsx`
- `__tests__/components/CtaSection.test.tsx`
- `__tests__/components/ScrollReveal.test.tsx` — also asserts the IntersectionObserver mock is invoked.
- `__tests__/components/LandingAmbient.test.tsx` — asserts six blob divs render.

Each component test does the minimum: `render(<Component />)`, then a single assertion (e.g., `expect(container.firstChild).toBeInTheDocument()` or one stable text/tag check). No snapshots. No interaction. ~12 tests total.

**RSC handling.** Server components in this codebase contain no async I/O — they render synchronously. `@testing-library/react`'s `render()` works directly. The `"use client"` boundary on `ScrollReveal` and `PlaygroundSection` is irrelevant at test time (`render` doesn't traverse the RSC boundary).

**IntersectionObserver shim.** jsdom does not implement `IntersectionObserver`. Add a global stub in a setup file (`__tests__/setup.ts`):

```ts
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
globalThis.IntersectionObserver =
  MockIntersectionObserver as unknown as typeof IntersectionObserver;
```

Wired into `vitest.config.ts` via `test.setupFiles`.

### 3.4 Vitest config — `apps/website/vitest.config.ts`

Pattern to follow: `packages/react/vitest.config.ts`. Differences:

- `test.environment: "jsdom"` (DOM access required).
- `test.setupFiles: ["__tests__/setup.ts"]`.
- `test.globals: true` (matches monorepo convention).
- `resolve.alias` only if `next/font` or similar imports need shimming (resolve at implementation time — likely not needed since the website uses `@fontsource-variable/*`, plain CSS).

### 3.5 Package additions — `apps/website/package.json`

Add to `devDependencies`:

- `vitest` — version pinned to monorepo.
- `@testing-library/react` — version compatible with React 19.
- `@testing-library/jest-dom` — for the `toBeInTheDocument` matcher.
- `jsdom`.
- `@vitejs/plugin-react` — required by vitest config to handle JSX/TSX.

Add scripts:

- `"test": "vitest run"`
- `"test:watch": "vitest"`

### 3.6 CI wiring — automatic via root `pnpm test`

Root `package.json` already runs `pnpm -r --workspace-concurrency=1 --filter './apps/*' test`. This picks up any app that defines a `test` script — no root or workflow changes needed. Adding `"test": "vitest run"` to `apps/website/package.json` is sufficient. CI's existing `test` job will run the new tests on its next run.

## 4. Architecture

```
apps/website/
├── README.md                         (REPLACE boilerplate with living doc)
├── package.json                      (+ test scripts, + 5 devDeps)
├── vitest.config.ts                  (NEW — jsdom + setup file)
├── __tests__/
│   ├── setup.ts                      (NEW — IntersectionObserver shim)
│   ├── page.test.tsx                 (NEW)
│   └── components/
│       ├── Hero.test.tsx             (NEW)
│       ├── PlaygroundSection.test.tsx
│       ├── Problem.test.tsx
│       ├── Solution.test.tsx
│       ├── ReceiptsBand.test.tsx
│       ├── ComparisonTable.test.tsx
│       ├── FeatureGrid.test.tsx
│       ├── CodeExample.test.tsx
│       ├── CtaSection.test.tsx
│       ├── ScrollReveal.test.tsx
│       └── LandingAmbient.test.tsx
└── app/                              (unchanged)

docs/superpowers/specs/
└── 2026-04-21-pretable-visual-system-design.md   (PREPEND superseded banner)
```

## 5. Testing strategy

- Smoke tests for every top-level component and the page.
- No snapshot tests (high-noise, low-signal at this maturity).
- No interaction tests (user clicks, scroll triggers) — those belong to a Phase 3+ E2E suite if/when it exists.
- No visual regression — out of scope.
- Each test asserts at least one concrete thing (a tag exists, specific text present), not just "didn't throw."

## 6. Out of scope (explicit)

- MDX support
- New routes
- Snapshot testing
- E2E / browser tests (Playwright, Cypress)
- Visual regression (Percy, Chromatic)
- Rewriting historical specs
- Token changes
- Component refactors
- `apps/playground` retirement (Phase 3)

## 7. Rollback

All changes are additive. Rollback by reverting the PR. The supersede banner on the old spec is a documentation prepend; reverting removes it cleanly.

## 8. Risks

- **`@testing-library/react` + React 19 compatibility.** Verify version at implementation time. Mitigation: pin to a known-good version; if blocked, scope this to a smaller test surface and document.
- **`next/font` or `next/image` imports in components.** Currently the website uses `@fontsource-variable/*` (plain CSS) and no `next/image` usage observed in section components, so vitest should not need to shim Next-specific modules. Verify at implementation; add shims only if needed.
- **`@vitejs/plugin-react` SWC vs Babel.** The package's ecosystem is well-established; either works for these tests. Use `@vitejs/plugin-react` (Babel-based) for stability.
- **CI test discovery.** Confirmed: root `pnpm test` already filters `./apps/*` and picks up any app with a `test` script. No root or workflow changes required.

## 9. Success criteria

- [ ] `pnpm --filter @pretable/app-website test` runs all 12 smoke tests, all pass.
- [ ] Root `pnpm test` includes `apps/website` and stays green.
- [ ] CI's `test` job runs `apps/website` tests and reports SUCCESS.
- [ ] `apps/website/README.md` describes the website's visual system without restating token values; a contributor can add a new section by reading only the README.
- [ ] `2026-04-21-pretable-visual-system-design.md` opens with a one-line superseded banner pointing at the README.
- [ ] Single PR, no breakage of existing CI checks (typecheck, lint, format, build).
