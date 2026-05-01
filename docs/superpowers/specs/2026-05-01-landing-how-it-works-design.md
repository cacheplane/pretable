# Landing — How It Works section (Design Spec)

**Date:** 2026-05-01
**Status:** Draft for review
**Scope:** Add a new `<HowItWorks>` section to `apps/website` landing between `<ComparisonTable>` and `<CodeExample>`. Surfaces the architectural decisions behind Pretable's performance for technically-credible buyers (and to give product/business decision makers an "ask your engineers" page they can point at).

---

## 1. Goal

Pretable's landing currently shows numbers (ReceiptsBand) and a vs-competitors grid (ComparisonTable). It doesn't explain **how** those numbers are achieved. AG Grid, the dominant incumbent, also doesn't — they say "we use virtualization" without specifics. This is an opening.

The new section answers "how is Pretable fastest?" with a deterministic-pipeline visual: a layered stack (kernel-poster style) showing the five render stages, their package ownership, their output types, and three concrete design choices each. Engine + Viewport are accent-colored — those are the two pure functions Pretable controls end-to-end.

Why now: the current landing makes claims a senior engineer wants to verify before recommending a buy. This section gives them the architectural narrative to do that without leaving the page.

Out of scope: visual-system token changes, MDX docs, theming, new routes, retitling other sections.

## 2. Audience and tone

**Primary:** technical decision makers (principal engineers, eng directors, founders) and the engineers product/business buyers will route this to.

**Tone:** confident, structural, no-magic. Headline reads _"A deterministic pipeline. No magic."_ — not aggressive, not marketing-explainer. Matches Pretable's receipts-led voice. Engineering credibility is earned with concrete signatures (`(rows, columns, sort, filter, selection) → Snapshot`), not adjectives.

## 3. Section structure

Three blocks within the section:

1. **Header**: eyebrow `04 · how it works` + headline _"A deterministic pipeline. No magic."_ + lead paragraph framing the five stages.
2. **Layered stack**: 5 rows, each with number, accent dot, name, responsibility, sub-bullet list (3 design choices), output-type chip, and package badge. Engine + Viewport rows are accent-colored.
3. **Callouts row**: 4 horizontally-arranged callout cards reinforcing the design choices (DOM/math, pure-function engine, RAF batching, off-DOM telemetry).
4. **Source link footer**: mono-text link to the actual packages on GitHub.

Each layer card has the layout:

```
[ num + dot ]   [ name (Georgia 18px)            ]   [ → output-type chip ]
                [ responsibility (Georgia 13px)  ]   [ package badge      ]
                [ ▸ design choice 1              ]
                [ ▸ design choice 2              ]
                [ ▸ design choice 3              ]
```

On mobile (<720px) the right column drops below the middle column with package + output displayed inline.

## 4. Content (final copy)

### 4.1 Header

- **Eyebrow:** `04 · how it works`
- **Headline:** `A deterministic pipeline. ` + italic accent: `No magic.`
- **Lead:** _"The benchmarks aren't a coincidence. They follow from a render path designed around five stages — each one readable, each one verifiable in source. Engine and viewport are pure functions; data flows one way; the DOM is touched exactly once per frame."_

### 4.2 Five layers (data-driven)

Each layer is `{ num, name, responsibility, bullets, output, pkg, accent }`. Order is render order.

**Layer 01 — Source** (no accent)

- Responsibility: _"Streaming patches and static rows treated identically."_
- Bullets:
  - Token-by-token patches via SSE, WebSocket, or any async iterable
  - Static `Row[]` arrays use the same input shape
  - No "streaming mode" toggle — adapters convert both to engine input
- Output: `Row[] | Patch`
- Package: `stream-adapter`

**Layer 02 — Engine** (accent)

- Responsibility: _"Pure reducer. Sort, filter, selection, row-id stability."_
- Bullets:
  - `(rows, columns, sort, filter, selection) → Snapshot`
  - Deterministic — same inputs always produce the same output, every frame
  - Row-id keys are first-class — selection survives filters, sorts, and live patches
  - Under 3,000 lines. Read it end-to-end in one sitting.
- Output: `Snapshot`
- Package: `grid-core`

**Layer 03 — Viewport** (accent)

- Responsibility: _"Row-height plan + virtualization range. Off-DOM measurement."_
- Bullets:
  - Wrapped row heights computed with character-width tables and font metrics — pure arithmetic
  - No `getBoundingClientRect`, no forced reflow, no measure-on-mount
  - Virtualization range derived from scroll position + total planned height
  - Off-screen rows excluded from the plan — no phantom DOM
- Output: `RenderPlan`
- Package: `layout-core + text-core`

**Layer 04 — Renderer** (no accent)

- Responsibility: _"The only stage that touches the DOM."_
- Bullets:
  - Diffs the previous `RenderPlan` against the new one
  - Patches affected rows; reuses unchanged DOM nodes
  - Selection, sort indicators, filter chips all data-driven from the snapshot — no imperative state
- Output: `Element[]`
- Package: `renderer-dom`

**Layer 05 — Frame** (no accent)

- Responsibility: _"RAF coalesces patches per animation frame."_
- Bullets:
  - 100 to 25,000 patches/sec all collapse to one snapshot per frame
  - Long tasks: zero across the operating envelope
  - Selection, cursor, scroll position never lost mid-frame
- Output: `60fps`
- Package: `browser`

### 4.3 Callouts (4 cards, 2×2 grid on `md+`, single column on mobile)

Each callout: heading + body. Border-left accent.

1. **DOM is expensive. We use math instead.**
   _"Wrapped row heights computed with character-width tables and font metrics — pure arithmetic. No `getBoundingClientRect`, no forced reflow, no measure-on-mount. The DOM is touched exactly once per frame, at commit."_

2. **Engine is a pure function.**
   _"`(rows, columns, sort, filter, selection) → Snapshot`. No imperative DOM. Streaming patches and batch arrays hit the same reducer — that's why selection survives every update."_

3. **RAF batches the stream.**
   _"100 to 25,000 patches/sec all collapse to one snapshot per animation frame. Long tasks: zero across the operating envelope."_

4. **Telemetry stays off-DOM.**
   _"Render counts, viewport range, planned height — all data emitted by the engine, never read from the DOM. Zero measurement-induced thrash."_

### 4.4 Footer source link

Mono text. Single line:

_"↳ Read the source: [packages/grid-core, layout-core, text-core, renderer-dom](https://github.com/cacheplane/pretable/tree/main/packages) — under 3,000 lines combined."_

The dotted-underline accent matches the AG Grid trust-strip treatment for visual consistency.

## 5. Animation

Layers cascade in on scroll-reveal:

- 70ms stagger between rows (5 rows × 70ms = 280ms reveal cascade)
- Easing: `cubic-bezier(.2, .8, .2, 1)`
- Initial state: `opacity: 0; transform: translateX(-12px)`
- Final state: `opacity: 1; transform: translateX(0)`
- Triggered by `<ScrollReveal>` wrapping the section AND a small in-section observer for the per-row stagger
- **Reduced motion:** under `prefers-reduced-motion: reduce`, all layers fade in together with no translate, ~200ms total

The callouts use the existing `<ScrollReveal>` opacity+translateY pattern (no per-card stagger needed — visual rhythm is set by the layered-stack cascade above).

## 6. Section placement and renumbering

New page order (11 sections → 12):

1. Hero
2. PositioningStrip
3. PlaygroundSection
4. Problem (eyebrow stays `01 · why now`)
5. UseCases (`02 · built for`)
6. TrustStrip (unnumbered)
7. ReceiptsBand (unnumbered)
8. ComparisonTable (`03 · how we compare`) — unchanged
9. **HowItWorks (NEW)** — eyebrow `04 · how it works`
10. CodeExample — eyebrow renumber `04 · for engineers` → `05 · for engineers`
11. FeatureGrid — eyebrow renumber `05 · what's in the box` → `06 · what's in the box`
12. CtaSection — eyebrow renumber `06 · ready to ship` → `07 · ready to ship`

Renumbering is mechanical: 4 string changes across 4 existing files.

## 7. File structure

**Created:**

- `apps/website/app/components/HowItWorks.tsx` — new server component (data-driven layer + callout arrays).
- `apps/website/app/components/HowItWorksLayer.tsx` — _(only if file size becomes a concern; otherwise inline)_. Decision deferred to implementation; default is inline in `HowItWorks.tsx`.
- `apps/website/__tests__/components/HowItWorks.test.tsx` — smoke tests.

**Modified:**

- `apps/website/app/page.tsx` — import `HowItWorks`; insert `<ScrollReveal><HowItWorks /></ScrollReveal>` between ComparisonTable and CodeExample.
- `apps/website/app/components/CodeExample.tsx` — eyebrow text only: `04 · for engineers` → `05 · for engineers`.
- `apps/website/app/components/FeatureGrid.tsx` — eyebrow text only: `05 · what's in the box` → `06 · what's in the box`.
- `apps/website/app/components/CtaSection.tsx` — eyebrow text only: `06 · ready to ship` → `07 · ready to ship`.

**Untouched:**

- `Hero`, `PositioningStrip`, `PlaygroundSection`, `Problem`, `UseCases`, `TrustStrip`, `ReceiptsBand`, `ComparisonTable` — no copy or markup change.
- All `@pretable/ui` package code.

## 8. Component shape

`HowItWorks.tsx` is a server component. Two data tables drive the rendering:

```tsx
interface Layer {
  num: string;
  name: string;
  responsibility: string;
  bullets: readonly string[];
  output: string;
  pkg: string;
  accent: boolean;
}

interface Callout {
  heading: string;
  body: React.ReactNode;
}

const LAYERS: readonly Layer[] = [
  /* 5 entries per §4.2 */
];
const CALLOUTS: readonly Callout[] = [
  /* 4 entries per §4.3 */
];
```

Bullets that contain inline `<code>` (Layer 02 signature, Layer 03 `getBoundingClientRect`, Layer 04 `RenderPlan`) use `React.ReactNode` so JSX literals can be embedded. The simplest path: each `bullets` entry is `string | React.ReactNode`, mapped to `<li>` elements in render.

The component renders the section, header, layer-stack `<ol role="list">`, and callouts grid. Per-layer animation uses Tailwind's arbitrary delay variant: `[transition-delay:0ms]` through `[transition-delay:280ms]` applied per index, paired with a parent `data-revealed` attribute toggled by a single client-side IntersectionObserver wrapper (or via `<ScrollReveal>` with a custom child selector — implementation can pick whichever is cleaner).

Recommended: a small client-side wrapper component `HowItWorksReveal.tsx` (`"use client"`) that takes children + a per-child stagger and applies the transform/opacity classes. Keeps the section a server component overall; only the wrapper crosses the boundary.

## 9. Testing strategy

Three smoke tests in `__tests__/components/HowItWorks.test.tsx`:

1. **Renders header** — eyebrow text `/how it works/i` + h2 with text `/deterministic pipeline/i` present.
2. **Renders 5 layers** — `container.querySelectorAll("h3")` length === 5; each layer name (Source / Engine / Viewport / Renderer / Frame) is in the document text.
3. **Renders 4 callouts** — count of callout-h headings === 4; the DOM/math callout text `/dom is expensive/i` is present (regression guard for callout #1, the one explicitly tweaked from spec to spec).

Existing tests stay green:

- `Hero.test.tsx`, `Problem.test.tsx`, `CtaSection.test.tsx`, `CodeExample.test.tsx`, `FeatureGrid.test.tsx`, `ComparisonTable.test.tsx` — all assert structural presence (`<h1>`, `<h2>`, `<a>`, `<pre>`, etc.); the eyebrow renumbering doesn't change DOM structure, just text.
- `page.test.tsx` — content-length and `firstChild` assertions; new section adds content, so length grows but still passes.

Total website tests after change: existing 38 + 3 new = **41**.

## 10. Verification

- `pnpm --filter @pretable/app-website test` — 41 passing.
- `pnpm --filter @pretable/app-website typecheck` — clean.
- `pnpm --filter @pretable/app-website lint` — 0 errors.
- `pnpm --filter @pretable/app-website build` — clean. New section renders in the prerendered `/` route.
- `pnpm format` — clean.
- Visual smoke at desktop (1440px) and mobile (390px iframe sim): 5 layers visible, callouts render, animation plays on scroll-reveal, mobile collapse works.
- Playwright smoke (post-deploy): the existing structural assertions cover the new section without modification — they assert h1/grid/docs presence, not section count.

## 11. Out of scope

- New CSS tokens — uses existing `bg-bg-card`, `border-rule`, `text-accent`, `text-accent-deep`, etc.
- Real architecture diagrams beyond the layered stack (no SVG flow chart, no 3D isometric).
- Code samples in this section — code lives in CodeExample (next section); HowItWorks is structural narrative.
- Animation polish beyond the 70ms-stagger cascade.
- Per-layer source-link buttons (deferred — single footer link is enough; per-layer would add visual noise).
- Pricing / paid-feature signaling (Pretable is pre-monetization; this section stays neutral).

## 12. Risks

- **Performance claim audit risk.** If a senior engineer reads the source and disagrees with a sub-bullet (e.g., "row-id keys first-class" — they might want to see the API), the page becomes a vector for criticism. Mitigation: every bullet is grounded in actual code in `packages/`; the source link makes verification trivial. Anything we can't defend should be cut now.
- **Layer 03 character-width-tables claim.** The implementation in `text-core` should match this description. If `text-core` actually uses canvas-based measurement (not character tables), the bullet needs to be tweaked at impl time. Verify by reading `packages/text-core/src/` before committing copy.
- **"Under 3,000 lines" claim** in Layer 02 — needs to be verified at impl time. Recommended check: `wc -l packages/grid-core/src/**/*.ts` excluding tests. If it's over 3,000, soften to "small enough to read end-to-end" or similar.
- **Animation timing in production.** The 70ms stagger across 5 rows totals 280ms, which is short but visible. If it feels "too jumpy" at desktop framerates, easing can be softened. Adjust at visual-smoke step.
- **Eyebrow renumbering** breaks any hard-coded test or doc that references the old numbers (e.g., a Playwright test asserting `04 · for engineers`). The post-PR-#38 Playwright smoke is structural-only (per PR #40), so this is safe — but a grep at impl time is prudent.

## 13. Rollback

Single squash-merge revert. New file deletions + 4 string edits revert cleanly.

## 14. Success criteria

- [ ] HowItWorks section renders between ComparisonTable and CodeExample at desktop and mobile.
- [ ] 5 layers visible with correct names, responsibilities, bullets, output chips, package badges.
- [ ] Engine + Viewport layers visually distinguished (accent treatment).
- [ ] 4 callouts visible with correct copy (DOM/math callout matches the rewritten direction).
- [ ] Source link footer points at `packages/` on GitHub.
- [ ] Eyebrow renumbering applied: CodeExample = 05, FeatureGrid = 06, CtaSection = 07.
- [ ] Scroll-reveal animation cascades layers (or fades them in together under reduced-motion).
- [ ] 41 website tests pass.
- [ ] CI green.
- [ ] Single PR.
