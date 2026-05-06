# Landing Content Rewrite — Design Spec

**Date:** 2026-05-01
**Status:** Draft for review
**Scope:** Rewrite the copy and structure of `apps/website/app/page.tsx` and its body sections. Drop the "wedge" / developer-jargon framing. Reposition for product/business decision makers (key ICP: financial-services teams). Keep all existing technical credibility (live grid, receipts, comparison table, code example) — restructure and reframe.

---

## 1. Goal

The current landing reads as developer-confidence copy aimed at engineers who already know what a "read-heavy wedge" benchmark is. The audience that actually decides "buy or build" — Heads of Product, COOs, principal engineers who own architecture and ship calls — bounces off this language.

This spec rewrites the landing to:

- Lead with **performance as the #1 claim** (Pretable is genuinely fastest; receipts back it).
- Position **AI-native architecture as the #2 claim** (the engine was designed around streaming and partial data, not retrofitted).
- Surface **financial-services credibility** via a trust strip naming the cacheplane team's existing engagement footprint (Santander, M&T Bank, The Motley Fool, Grid Alpha).
- Eliminate internal jargon ("wedge", "p95 streaming", "the answer", "S5 hypothesis scenario") from above the fold.
- Keep the existing live-grid playground, receipts band, comparison table, and code example — relocated and reframed.

Out of scope: visual system tokens, MDX docs surface (already shipped), theming architecture, new technical features.

## 2. Audience and positioning thesis

**Primary audience:** product/business decision makers — Heads of Product, COOs, founders, principal engineers — evaluating buy-vs-build for AI-driven analytics, agent UIs, or real-time dashboards. Technical literacy varies; outcome literacy is uniform.

**Positioning thesis (priority order):**

1. **Performance is item #1.** Pretable is the fastest grid in independent benchmarks. Lead with this; earn it with the existing receipts and comparison table.
2. **AI-native architecture is item #2.** AI isn't a feature retrofitted onto Pretable; the engine was designed around streaming and partial data — the data shape AI agents and live feeds actually produce. Grid Alpha and others were built before the streaming / AI era.
3. **Wrapped-text + variable-height is item #3.** Multi-line cells with auto-height under streaming load — concrete differentiation, especially vs Grid Alpha Community and GridGamma X.
4. **Ecosystem fit is item #4.** Drops into the AI SDKs the audience already uses: Vercel AI SDK, OpenAI Responses, Anthropic streams, LangGraph, your own SSE.

**Dropped from headline positioning:**

- Open-source / MIT (becomes a footer note; will eventually have paid Enterprise tier).
- Lock-in / TCO / buy-vs-build framing (avoided — Pretable will have paid features too).
- "Predictable / row selection survives" as a positioning card (still a feature, but not a top-4 differentiator).
- "Wedge" / "p95" / "S5" / "S7" — internal benchmark jargon. Receipts still cite specific numbers; don't lead with the scenario name.

## 3. Final structure (11 sections)

| #   | Section           | Status             | Note                                                                                 |
| --- | ----------------- | ------------------ | ------------------------------------------------------------------------------------ |
| 1   | Hero              | rewrite            | New copy. Performance + AI-era headline.                                             |
| 2   | PositioningStrip  | **NEW**            | 4 differentiation cards.                                                             |
| 3   | PlaygroundSection | keep as-is         | Live grid demo. No copy change.                                                      |
| 4   | Problem           | rewrite            | Architectural-history narrative + timeline + 3 pain-point cards.                     |
| 5   | UseCases          | **NEW**            | 3 use cases with chips. Financial card flagged as key ICP.                           |
| 6   | TrustStrip        | **NEW**            | cacheplane / GDE attribution + financial logos + Grid Alpha cheeky.                  |
| 7   | ReceiptsBand      | keep               | Same 4 stats. Same headline ("Receipts, not claims.").                               |
| 8   | ComparisonTable   | reframe            | Header → "How we compare." Body copy refreshed; drop "S5 hypothesis" jargon.         |
| 9   | CodeExample       | reframe + relocate | Move below ComparisonTable. Header → "For engineers: how it looks in your codebase." |
| 10  | FeatureGrid       | trim to 4          | Drop two cards that overlap with PositioningStrip.                                   |
| 11  | CtaSection        | reframe            | Headline → "Run the benchmarks. Then ship."                                          |

Render order in `app/page.tsx` reflects the table.

## 4. Section copy — final

### 4.1 Hero (`apps/website/app/components/Hero.tsx`)

- **Eyebrow:** `$ pretable — vol. 2 · no. 1` (unchanged — keeps the editorial signature)
- **Headline:** `The fastest data grid for React. Built for the AI era.` ("fastest" italic accent; "AI era" emphasized)
- **Subhead:** `60fps under streaming load. Zero row drift. A deterministic engine designed for live data, agent output, and real-time telemetry — not retrofitted from a batch-era grid.`
- **CTAs:** Primary `See the receipts ↓` (anchors to ReceiptsBand). Secondary `Try it live ↓` (anchors to `#grid` PlaygroundSection).
- **Footer note (small mono):** `MIT licensed · open source` (de-emphasized — note, not claim).

### 4.2 PositioningStrip (NEW — `apps/website/app/components/PositioningStrip.tsx`)

Four cards, each with eyebrow + headline + body. Render in a 2×2 grid on `md+`, single-column on mobile.

```
01  PERFORMANCE
    The fastest grid in independent benchmarks.
    9 ms frame p95 under 1,000 patches/sec streaming load. Zero long
    tasks. Zero row drift. Verifiable: `pnpm bench:matrix` against
    Grid Alpha, GridBeta Virtual, GridGamma X.

02  AI-NATIVE
    AI isn't a feature. It's the data model.
    Pretable's engine was designed around streaming and partial data —
    the shape AI agents and live feeds actually produce. Most grids
    retrofit a streaming adapter onto a batch-era data model.
    Pretable doesn't.

03  WRAPPED TEXT
    Multi-line cells, no layout thrash.
    Auto-height rows with wrapped content — at 60fps under streaming.
    No row-jump on hover, no layout shift on scroll, no row-height
    recalc churn when an agent writes longer text mid-stream.
    Most grids force fixed heights to avoid this.

04  ECOSYSTEM
    Drops into the AI SDKs you already use.
    Vercel AI SDK · OpenAI Responses · Anthropic streams · LangGraph ·
    your own SSE. One import. The streaming pipeline is purpose-built —
    every other grid leaves it to you.
```

Numbering shown as small mono in a top-right corner of each card. Eyebrow color: accent. Card background: subtle raised surface.

### 4.3 PlaygroundSection (unchanged)

Existing component renders the live `@pretable/react` grid. No copy change.

### 4.4 Problem (rewrite — `apps/website/app/components/Problem.tsx`)

- **Eyebrow:** `01 · why now` (replaces `01 · the wedge`)
- **Headline:** `Data grids were built for the batch era. Then AI showed up.` ("batch" italic accent)
- **Body (lead paragraph):** `Every popular React data grid was designed when data arrived in one shape: a complete array, fetched once, rendered. AI agents, streaming APIs, and live telemetry don't work that way. They produce data over time — token by token, patch by patch, partial first.`
- **Timeline (4 cells, top + bottom rule):**
  - `1995 — Spreadsheet`
  - `2010 — Data grid (batch)`
  - `2024 — Streaming AI`
  - `NOW — Pretable` (accent color, bold)
- **Body (closing paragraph):** `Three failure modes every team building AI-driven dashboards has watched ship — symptoms of the same root cause: a render path that assumed data arrives all at once.`
- **Three pain-point cards (small grid below the closing paragraph):**
  1. _Row vanishes mid-stream._ "Selection breaks on the first patch. Trust evaporates with it."
  2. _Stream speeds up, frames drop._ "Demos handle 100/sec. Production at 1k breaks. Users notice."
  3. _Wrapped text jumps on update._ "Row heights recalc, viewport shifts. No reading rhythm survives."

### 4.5 UseCases (NEW — `apps/website/app/components/UseCases.tsx`)

- **Eyebrow:** `02 · built for`
- **Headline:** `If you're shipping live data, you're shipping this.` ("live data" italic accent)
- **Three cards, each with icon + eyebrow + headline + body + chips row.**

Card 01 — `AI-driven analytics dashboards.`

> Your product asks an LLM to summarize, classify, or rank data. Results stream into a table users actually scroll, sort, and filter. Selection survives the next streaming patch.
> Chips: `OpenAI Responses · Vercel AI SDK · Anthropic`

Card 02 — `Agent traces and tool-call output.`

> LangGraph or your own agent runtime emits structured events — node transitions, tool calls, intermediate state. Pretable renders the live trace as it happens.
> Chips: `LangGraph · CrewAI · your own SSE`

Card 03 — `Real-time financial dashboards.` (key ICP — visually distinguished)

> Trading floors, portfolio analytics, risk monitors — thousands of patches/sec, multi-line annotations, no row drift when the market moves. The dashboards capital-markets and asset-management teams already need.
> Chips: `Market data feeds · WebSocket · Server-Sent Events`
> Visual treatment: stronger accent border (`rgba(56,189,248,0.4)`) and slightly elevated background — signals "this is the one" without explicit "key ICP" tag in production (decoration only, not copy).

### 4.6 TrustStrip (NEW — `apps/website/app/components/TrustStrip.tsx`)

Sits between UseCases and ReceiptsBand. Single-column section with three rows: badge pills, attribution headline, logo row, cheeky Grid Alpha line.

- **Pills (top row):** `Google Developer Experts` (with G/Google color treatment) + `cacheplane, Inc.`
- **Attribution headline (Fraunces serif, ~17px):** `Pretable is built by cacheplane — Google Developer Experts behind production data and analytics interfaces at:`
- **Logo row** (horizontal, wrap on mobile, 28px gap):
  - `Santander` — brand red `#ec0000`, semibold
  - `M&T Bank` — brand green `#00834e`, semibold
  - `The Motley Fool` — italic serif
  - `Grid Alpha` — accent cyan, dotted underline (carries the cheeky callout below)
  - `+ Google · FedEx · ClickUp · Runway` — small mono, muted
- **Cheeky line (mono, accent):** `↳ yes, that Grid Alpha. We helped build the grid we're now competing with.`

Implementation notes:

- Logo rendering uses styled text by default. Replace with sourced SVGs in a future polish pass; SVGs out of scope for this spec (would extend timeline).
- Border treatment: 1px rule with a 2px accent top border to set off the strip.
- Background: subtle raised surface (`bg-card` with reduced opacity).

### 4.7 ReceiptsBand (keep — minor only)

- Headline unchanged: `Receipts, not claims.`
- Stats unchanged: `500k rows · 9ms frame p95 · 0 long tasks · 25k/s max sustained rate`
- "See them re-run in the bench →" link unchanged.

### 4.8 ComparisonTable (reframe — `apps/website/app/components/ComparisonTable.tsx`)

- **Eyebrow:** `03 · how we compare` (was `03 · cell-by-cell receipts`. Renumbered linearly: TrustStrip + ReceiptsBand are intentionally unnumbered "proof breaks" between sections, so eyebrow numbering goes 01 Problem → 02 UseCases → 03 ComparisonTable → 04 CodeExample → 05 FeatureGrid → 06 CtaSection.)
- **Headline:** `How we compare.` (was `Cell-by-cell receipts.`)
- **Body intro:** `Streaming workload at 1,000 patches/sec, 3 repeats on Chromium. Pretable's column is amber-italic. Numbers come from \`pnpm bench:matrix\`; full sweep at docs/streaming-rate-envelope.` (Drops the "S5 streaming-updates scenario at hypothesis scale" jargon.)
- **Table rows unchanged** (same metrics, same numbers — they're real).
- **Footer link unchanged.**

### 4.9 CodeExample (reframe + relocate — `apps/website/app/components/CodeExample.tsx`)

- Move below ComparisonTable in `app/page.tsx` (currently above the comparison; flip the order).
- **Eyebrow:** `04 · for engineers` (was `05 · the import`)
- **Headline:** `For engineers: how it looks in your codebase.` (was `One import. Stream tokens into a stable grid.`)
- **Body intro:** unchanged (already reasonable).
- **Code snippet:** unchanged.
- **Footer link to streaming-demo:** unchanged.

### 4.10 FeatureGrid (trim to 4 — `apps/website/app/components/FeatureGrid.tsx`)

- **Eyebrow:** `05 · what's in the box` (was `04 · what's in the box`; renumbered linearly per §4.8)
- **Headline:** `Engineering credibility points.` (was `Six receipts.` — trim to 4 means the count claim is wrong)
- **Body intro:** `Each feature backed by a bench scenario or demo. No claim without a click-to-prove.` (unchanged)
- **Cards (drop 2, keep 4):**

  KEEP:
  - 60fps performance — receipt: `/bench?s=S7&scale=stress`
  - Selection survives filters — receipt: live demo above
  - Deterministic engine — receipt: `github.com/cacheplane/pretable`
  - No-flash hydration — receipt: this page

  DROP:
  - Stream-aware (now covered by PositioningStrip card 02 + UseCases)
  - Wrapped text, no jank (now covered by PositioningStrip card 03)

### 4.11 CtaSection (reframe — `apps/website/app/components/CtaSection.tsx`)

- **Eyebrow:** `06 · ready to ship` (was `06 · check the receipts`; renumbered linearly per §4.8)
- **Headline:** `Run the benchmarks. Then ship.` (was `Check the receipts.`)
- **Body:** `The grid is in your hands at the top of this page. The numbers are reproducible at \`/bench\`. The source reads cleanly. Star, install, ship.` (unchanged — reads well)
- **CTAs unchanged:** `Try it live ↑` + `View on GitHub →`
- **Footer note unchanged:** `MIT licensed · Built in the open · No telemetry.`

## 5. File structure

**Created:**

- `apps/website/app/components/PositioningStrip.tsx` — 4-card section with eyebrow/headline/body markup.
- `apps/website/app/components/UseCases.tsx` — 3-card use-cases section, financial card visually distinguished.
- `apps/website/app/components/TrustStrip.tsx` — cacheplane/GDE attribution + financial logos.
- `apps/website/__tests__/components/PositioningStrip.test.tsx`
- `apps/website/__tests__/components/UseCases.test.tsx`
- `apps/website/__tests__/components/TrustStrip.test.tsx`

**Modified:**

- `apps/website/app/page.tsx` — new section order (Hero → PositioningStrip → PlaygroundSection → Problem → UseCases → TrustStrip → ReceiptsBand → ComparisonTable → CodeExample → FeatureGrid → CtaSection). Wrap new sections in `<ScrollReveal>` to match Phase 2.B pattern.
- `apps/website/app/components/Hero.tsx` — new copy (headline, subhead, CTAs).
- `apps/website/app/components/Problem.tsx` — full rewrite (timeline + pain cards).
- `apps/website/app/components/ComparisonTable.tsx` — eyebrow + headline + body intro reframe; table rows untouched.
- `apps/website/app/components/CodeExample.tsx` — eyebrow + headline reframe; snippet untouched.
- `apps/website/app/components/FeatureGrid.tsx` — drop 2 cards from `FEATURES` array; update headline.
- `apps/website/app/components/CtaSection.tsx` — eyebrow + headline reframe.
- `apps/website/__tests__/components/Hero.test.tsx` — assertion updates if heading text is asserted (currently asserts only `<h1>` exists; safe).
- `apps/website/__tests__/components/Problem.test.tsx` — assertion updates if heading text is asserted (currently asserts only `<h2>` exists; safe).
- `apps/website/__tests__/components/CtaSection.test.tsx` — same; currently asserts `<a>` exists.

**Untouched:**

- `apps/website/app/components/PlaygroundSection.tsx` — live grid demo.
- `apps/website/app/components/ReceiptsBand.tsx` — stats + headline unchanged.
- `apps/website/app/components/Hero.tsx` snippet code (only copy changes).
- `apps/website/app/components/{LandingAmbient,ScrollReveal,RouteAwareNav,DocsSidebar,DocsSidebarLink,CodeBlock,AmbientBlob,CopyCommand}.tsx` — no functional change.
- All `@pretable/ui` package code.

## 6. Testing strategy

Three new smoke tests (one per new component) following the established pattern (render + concrete assertion, no snapshots, no interaction):

- **`PositioningStrip.test.tsx`** — renders 4 `<h3>` (one per card); each has eyebrow text matching `/performance|ai-native|wrapped|ecosystem/i` (case-insensitive across the 4).
- **`UseCases.test.tsx`** — renders 3 cards (3 `<h3>`); financial card identifiable via specific text (`/financial|trading/i`).
- **`TrustStrip.test.tsx`** — renders the GDE pill text, the cacheplane attribution, all four named financial-tier logos (Santander, M&T Bank, The Motley Fool, Grid Alpha), and the cheeky Grid Alpha line.

Existing tests stay green:

- `Hero.test.tsx` — asserts only `<h1>` exists. Copy change doesn't break.
- `Problem.test.tsx` — asserts only `<h2>` exists.
- `CtaSection.test.tsx` — asserts at least one `<a>` exists.
- `ComparisonTable.test.tsx`, `CodeExample.test.tsx`, `FeatureGrid.test.tsx` — all assert structural presence (`<table>`, `<pre>`, `<h3>` count).
- `FeatureGrid.test.tsx` asserts `headings.length >= 2`. Trimming to 4 keeps this satisfied.

Total website tests after change: 24 (current) + 3 new = **27**.

## 7. Verification

- `pnpm --filter @pretable/app-website test` — 27 passing.
- `pnpm --filter @pretable/app-website typecheck` — clean.
- `pnpm --filter @pretable/app-website lint` — 0 errors.
- `pnpm --filter @pretable/app-website build` — clean.
- `pnpm format` — clean.
- Manual smoke at desktop (1440px) and mobile (390px iframe sim) for all 11 sections.

## 8. Out of scope

- Real logo SVGs for trust strip (styled text in this PR; SVG sourcing in a follow-up polish PR).
- Animation polish on Problem timeline (static markup; if we want animated reveal, future PR).
- New ambient blob tuning (existing `LandingAmbient` blob arc still works for the new section count; verify in build, retune in a follow-up if needed).
- Visual regression / Playwright tests (not part of website's existing test surface).
- A/B testing infrastructure.
- Footer changes.

## 9. Risks

- **Trust strip naming risk.** Listing Santander, M&T Bank, The Motley Fool, Grid Alpha as "production data and analytics interfaces" — this is true of cacheplane's engagements per priorstudio.com (cacheplane's predecessor consultancy). Phrasing avoids claiming those companies use Pretable today. If any client objects, the strip can be edited without other code changes.
- **Grid Alpha cheeky line risk.** "We helped build the grid we're now competing with" is bold. If the team prefers a softer tone, swap to "yes, Grid Alpha. We know what we're up against." Single-string change.
- **Financial-services specificity.** Card 03's chips ("Market data feeds · WebSocket · SSE") are honest but generic. If Pretable lands a real financial-services design partner, swap a chip for their logo.
- **Timeline visual.** "1995 → 2010 → 2024 → NOW" is a bold category claim. If anyone disputes the framing (e.g., a competitor blog asserts "we've supported streaming since 2018"), the dates can be adjusted to focus on architectural shifts (batch → push) rather than years.
- **`LandingAmbient` blob positions.** The blob arc was tuned for 9 sections; adding 2 may shift alignment. The component file has a re-tune workflow comment. Verify visually after build; adjust if needed (out of scope for this spec; flagged as a likely follow-up).
- **Code example feels orphaned below ComparisonTable.** With `for engineers: how it looks` framing, it now reads as "for the engineering audience." If product leaders read past the comparison, the code might break their flow. Acceptable trade-off; the alternative (drop entirely) loses real engineering credibility.

## 10. Rollback

Single squash commit revert. All changes are JSX/copy-level; no schema or build changes.

## 11. Success criteria

- [ ] All "wedge" / "p95" / "S5 hypothesis" / "the answer" jargon is gone from above the fold.
- [ ] Hero, PositioningStrip, Problem, UseCases, TrustStrip render correctly at desktop and mobile.
- [ ] Trust strip names cacheplane, Google Developer Experts, and the financial-services logos (Santander, M&T Bank, The Motley Fool, Grid Alpha).
- [ ] All 27 website tests pass.
- [ ] CI green.
- [ ] Single PR.
- [ ] Visually verified across desktop (1440px) and mobile (390px iframe sim).

## 12. Appendix — competitor research summary

Sources cited from the brainstorm-phase research subagent. Key gaps Pretable can claim:

1. **No incumbent owns "built for the streaming/AI data model"** as primary positioning. Grid Alpha, GridGamma X, Kendo all retrofitted AI assistants onto batch-era cores; none redesigned the data model. This is Pretable's structural opening.
2. **Saturated positions to avoid:** "fastest grid" alone (everyone claims it), "open-source / MIT" (table stakes), "natural-language AI assistant" (GridGamma X Premium / Kendo / Syncfusion own this), "headless / full control" (GridBeta owns).
3. **Pricing landscape:** Grid Alpha Enterprise $999/dev/yr (gates AI features); GridGamma X Pro $299, Premium $599; Handsontable $999+/yr non-MIT for commercial; GridBeta free, sponsorship-funded; Glide free MIT. Pretable will eventually have a paid tier; the spec deliberately avoids anchoring to "free / open / MIT" as a differentiator.
