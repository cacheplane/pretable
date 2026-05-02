# Pretable Docs Architecture Design

> **Date:** 2026-05-02
> **Status:** Design — awaiting implementation plans (4 PRs decomposed below)
> **Scope:** Public-facing documentation at `pretable.ai/docs`
> **Related:** Builds on the theming arc completed via PRs #46/#50/#54/#55/#56. The `@pretable/ui` README is the existing baseline; this spec lifts that content into a structured docs site and expands it.

## Goal

Replace the current 1-page `/docs` (install + first grid only) with a 25-page documentation site covering theming, the grid engine API, streaming, an examples gallery, and a complete API reference. Resolve the asymmetry where the `@pretable/ui` package README is currently more thorough than the website docs — `/docs` becomes the canonical home; package READMEs redirect to it.

## Audience

External React developers adopting `@pretable/react` and `@pretable/ui`. They land on `pretable.ai/docs` after seeing the marketing site or finding the package on npm. They expect:

- A short tutorial path (install → working grid in 5 minutes)
- Recipes for common customization tasks (override tokens, switch themes, switch density)
- A grep-able API reference for `PretableGrid` props, theme tokens, density helpers
- Live, copy-pasteable examples for non-trivial patterns

The docs are NOT aimed at internal contributors (those use `docs/superpowers/specs/` and `docs/superpowers/plans/`).

## Why now

The 5-PR theming arc (PRs 1-5 of `@pretable/ui`) shipped a complete public theming surface — Excel + Material 3 themes, runtime density, light/dark switching, Tailwind v4 bridge, custom-theme authoring. The package README documents seven recipes covering this. But `pretable.ai/docs` only has one install guide. A consumer browsing the website docs gets a fraction of what an npm reader gets — that's the wrong asymmetry. The docs surface needs to catch up to what shipped.

## Information architecture

Topical IA with a Diátaxis-hybrid shape per section: each top-level section follows **Concept → Recipes → Reference**. This pattern matches the user's other repos (`angular-agent-framework`, `dawn`) and aligns with field conventions (AG Grid's per-feature concept→reference depth, Tailwind's "concept hub + token reference + recipes + escape hatch", shadcn's CSS-variable contract pattern).

**Top-level sections (5) + Examples gallery:**

```
Getting Started
  • Install + first grid             [recipe — existing, expand]
  • Concepts                         [concept — new, mental-model overview]

Theming
  • Overview                         [concept — the theming model]
  • Pick a theme                     [recipe]
  • Override tokens                  [recipe — the override story]
  • Light / dark switching           [recipe]
  • Density switching                [recipe]
  • Custom themes                    [recipe — author your own]
  • Tailwind v4 + CSS-in-JS          [recipe]
  • Token reference                  [reference — searchable 24-token table]

Grid
  • Overview                         [concept]
  • Columns                          [recipe + reference inline]
  • Rows, selection, focus           [recipe + reference inline]
  • Sort + filter                    [recipe]
  • Density helpers                  [reference]

Streaming
  • Overview                         [stub — "API in flux for v0.0.x"]

API Reference
  • PretableGrid props
  • Column type
  • Theme token contract             [mirror of Theming → Token reference]
  • getDensityHeights / useResolvedHeights

Examples
  • Basic table
  • Material light/dark switcher
  • Density picker
```

**Total: 25 pages** for v0.0.x (3 + 8 + 5 + 1 + 4 + 3 examples + Custom theme example + Streaming example deferred). Sized between `dawn`'s 8 pages and `angular-agent-framework`'s 216 pages — appropriate for pretable's pre-1.0 surface.

### URL structure

Flat within each section, nested under section root:

```
/docs                              (hub — section cards)
/docs/getting-started              (Install + first grid)
/docs/getting-started/concepts     (Concepts)
/docs/theming                      (Overview)
/docs/theming/pick-a-theme
/docs/theming/override-tokens
/docs/theming/light-dark
/docs/theming/density
/docs/theming/custom-themes
/docs/theming/tailwind-css-in-js
/docs/theming/token-reference
/docs/grid                         (Overview)
/docs/grid/columns
/docs/grid/rows-selection-focus
/docs/grid/sort-filter
/docs/grid/density-helpers
/docs/streaming                    (Overview / stub)
/docs/api-reference                (Hub or PretableGrid props)
/docs/api-reference/pretable-grid-props
/docs/api-reference/column-type
/docs/api-reference/theme-token-contract
/docs/api-reference/density-helpers
/docs/examples                     (Gallery hub)
/docs/examples/basic-table
/docs/examples/material-light-dark-switcher
/docs/examples/density-picker
```

Section root pages (e.g., `/docs/theming`) are concept overviews. Sub-pages are recipes/reference. URL pattern matches `dawn`'s simple slug-per-page convention.

### Navigation

Extend `apps/website/app/docs/_nav.ts` from one section to six. The existing `DocsSidebar` and `DocsSidebarLink` components render the structure without changes — sections become collapsible groups, active-link styling already handled.

```ts
export const docsNav: DocsNavSection[] = [
  { title: "Getting Started", items: [...] },
  { title: "Theming", items: [...] },
  { title: "Grid", items: [...] },
  { title: "Streaming", items: [...] },
  { title: "API Reference", items: [...] },
  { title: "Examples", items: [...] },
];
```

## Per-page content outlines

### Getting Started (3 pages)

**Install + first grid** _(recipe — existing, expand)_

- `npm install @pretable/react @pretable/ui`
- Pick a theme; Excel as default; Material as one-line callout
- Minimal `<PretableGrid rows={…} columns={…} />` example
- Link to next: Concepts page for the bigger picture, Theming for customization

**Concepts** _(concept — new)_

- Headless engine + theming layer model: `@pretable/react` is structurally pure; `@pretable/ui` provides the look
- Two CSS-variable namespaces: `--pretable-*` for the grid, your own for the rest of the app
- Three runtime axes: theme (Excel / Material light / Material dark) × density (compact / standard / spacious) × consumer overrides at `:root`
- Brief mention of streaming (link to Streaming Overview)
- Link to Architecture spec in `docs/superpowers/specs/2026-05-01-pretable-theming-architecture-design.md` for those who want the _why_

**(Existing /docs index)** _(redirect / hub)_

- Becomes a section directory with cards linking to the 6 top-level sections
- Replaces the current 8-line stub

### Theming (8 pages)

**Overview** _(concept)_

- The mental model: theme files own colors/fonts/density values; `grid.css` owns chrome selectors; engine owns 2 CSS vars (`--pretable-row-height`, `--pretable-header-height`); your CSS owns overrides
- The 24-token contract (link to Token reference)
- The two attribute axes: `data-theme="dark"` and `data-density="compact|standard|spacious"`
- The composition order: theme → grid.css → consumer overrides (cascade specificity)
- One inline SVG architecture diagram (layered model)

**Pick a theme** _(recipe — short)_

- Side-by-side excel.css vs material.css visual + when to use each
- Excel for technical/data-dense apps; Material for consumer-facing apps
- One paragraph each on visual identity (Aptos Narrow, Excel green vs Roboto Flex, M3 purple)
- Code: drop-in `@import` for each

**Override tokens** _(recipe — the override story you flagged)_

- Why CSS variables: cascade-driven, no rebuild, consumer's stylesheet wins via load order
- The basic pattern: `:root { --pretable-accent: #ff5722; }`
- Worked examples: tweak one accent, swap the entire color palette, change radius to match brand
- Token groups (surfaces / text / lines / state / accent / density / typography) — link to Token reference

**Light / dark switching** _(recipe)_

- Material has `[data-theme="dark"]` overrides (Excel is light-only — explain why)
- Wire up: React state → `documentElement.dataset.theme`
- OS-respect: `matchMedia('(prefers-color-scheme: dark)')`
- Composes with density independently
- Code samples for both patterns

**Density switching** _(recipe)_

- Three tiers: compact / standard / spacious. Each theme's natural default is at `:root`.
- Wire up: `documentElement.dataset.density`
- Why density is theme-coupled (Excel-compact ≠ Material-compact)
- Engine bridge: `useResolvedHeights` reads heights into JS automatically; you don't pass props
- Code sample for a density picker

**Custom themes** _(recipe — author your own)_

- Start by copying excel.css or material.css as a template
- Required: define all 24 tokens at `:root`
- Optional: add `[data-density="..."]` blocks for non-default tiers, `[data-theme="dark"]` for dark variant
- The contract test pattern (link to apps/website if we publish the test as an example)

**Tailwind v4 + CSS-in-JS** _(recipe — combined for v0.0.x; can split later)_

- Tailwind v4: import `@pretable/ui/tailwind.css` for `bg-pt-*`, `text-pt-*` utilities
- CSS-in-JS: `var(--pretable-*)` works in any CSS-emitting tool
- Code samples for both

**Token reference** _(reference — searchable table)_

- Full 24-token table grouped: Surfaces (5), Text (3), Lines (3), State (4), Accent (1), Density (6), Typography (2)
- Each row: token name, description, type (color / length / font), example value in Excel + Material
- Engine-read tokens (`row-height`, `header-height`) flagged
- Plain markdown table for v0.0.x

### Grid (5 pages)

**Overview** _(concept)_

- Virtualization: only visible rows render; row heights measured per-row
- Column model: `widthPx`, `wrap`, `pinned: "left"`, `valueGetter`
- Interaction: focus and selection live in the engine; sort/filter via `interactionState` prop
- Engine bridge: where it reads CSS vars; what's structural vs themed

**Columns** _(recipe + reference inline)_

- Define columns with the `PretableColumn<TRow>` type
- Width, wrap, pinning recipes
- Reference table: every column field documented

**Rows, selection, focus** _(recipe + reference inline)_

- Row keying via `getRowId`
- Focus model (keyboard nav)
- Selection (single — currently single per spec)
- Reference: `interactionState` prop shape

**Sort + filter** _(recipe)_

- Controlled vs uncontrolled
- Sort direction lifecycle
- Filter input shape (`Record<string, string>`)
- Worked example with a search input

**Density helpers** _(reference — narrow)_

- `useResolvedHeights(rowHeightProp?, headerHeightProp?)` from `@pretable/react` — React hook, reactive
- `getDensityHeights()` from `@pretable/ui` — plain JS snapshot
- When to use which (React reactive vs vanilla snapshot)
- SSR safety notes

### Streaming (1 stub page)

**Overview** _(stub)_

- Streaming is shipped (transactions API, JSON streaming) — link to bench's stream-adapter source
- "API in flux for v0.0.x; full docs land when API stabilizes"
- Pointers: `apps/streaming-demo/` for working code, `packages/json-stream/` for protocol
- 2 paragraphs of high-level overview

### API Reference (4 pages)

**PretableGrid props** _(reference)_

- Every prop with type signature + 1-line description + link back to the recipe page
- Hand-authored for v0.0.x (not auto-generated)

**Column type** _(reference)_

- `PretableColumn<TRow>` shape
- All optional fields documented

**Theme token contract** _(reference — mirrors Theming → Token reference)_

- Same content as Theming → Token reference, accessible from API ref via direct link

**getDensityHeights / useResolvedHeights** _(reference)_

- `getDensityHeights(): { rowHeight, headerHeight }`
- `useResolvedHeights(rowHeightProp?, headerHeightProp?): { rowHeight, headerHeight }`
- Fallback values, SSR behavior

### Examples gallery (3 pages for v0.0.x)

**Basic table** — minimal `<PretableGrid />`, drop-in Excel
**Material light/dark switcher** — runtime theme picker
**Density picker** — compact/standard/spacious toggle

Each example: a single MDX page with:

1. A working `<DemoComponent />` rendering a real grid
2. The source code via `<CodeBlock>` shown beside or below the demo

Demo components live in `apps/website/app/docs/examples/_components/` (private — leading underscore prevents Next.js from routing). Pattern reuses the existing landing-page `<PlaygroundSection>` approach.

**Deferred to later:** Custom theme example (waits for community demand), Streaming example (waits for API stabilization).

## Cross-cutting concerns

### MDX components (v0.0.x)

| Component                | Source                                                                                 | Used by                                        |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `<Callout type="note     | warn                                                                                   | deprecated                                     | new">` | reuse `apps/website/app/components/Callout.tsx` (already moved out of `@pretable/ui` in PR 1) | scattered across all pages — type signals (`warn` for "API in flux"), tip blocks, version notes |
| `<CodeBlock>`            | reuse `apps/website/app/components/CodeBlock.tsx` (shiki-based async server component) | every recipe and example                       |
| Plain markdown tables    | MDX native                                                                             | Token reference, prop tables in API Reference  |
| Inline SVG (single file) | hand-rolled                                                                            | the architecture diagram on Theming → Overview |

**Deferred:** `<Tabs>`, `<LiveGrid>`, `<TokenTable>` filterable component, Mermaid diagram-as-code. Add if specific pages need them.

### Code snippet conventions

- **Language tags:** `tsx`, `ts`, `css`, `bash`, `json`, `diff`
- **File path label:** in a code-block comment at the top: `// apps/website/app/globals.css` or `// app/components/MyGrid.tsx`
- **Multi-step snippets:** sequential blocks with descriptive prose between them (no `<Tabs>` ceremony)
- **Diffs for migrations:** use `diff` language tag with `+`/`-` prefixes
- **Recipe shape:** every recipe page leads with code, then explains. Code-first.

### Frontmatter schema

```yaml
---
title: Override individual tokens
description: Customize @pretable/ui's appearance by redefining --pretable-* CSS variables in your stylesheet.
type: recipe
---
```

Fields:

- `title` (required) — sidebar label, page heading
- `description` (required) — SEO / OG meta
- `type` (optional) — `concept` | `recipe` | `reference` | `stub` | `example` (used for visual sidebar tags later if we want them; not visually rendered yet for v0.0.x)

### Live demo pattern (Examples gallery)

Each example MDX file imports a private demo component and renders it inline. Pattern:

````tsx
import { BasicTableDemo } from "./_components/BasicTableDemo";

# Basic table

<BasicTableDemo />

```tsx
// apps/your-app/components/MyGrid.tsx
import { PretableGrid } from "@pretable/react";
import "@pretable/ui/themes/excel.css";
import "@pretable/ui/grid.css";
// ... rest
````

```

Demo components live in `apps/website/app/docs/examples/_components/`. The leading underscore prevents Next.js from routing to them; they're private to the docs route.

### Authoring approach

- **Hand-authored MDX.** No auto-generation from TypeScript for v0.0.x. The 25-page surface is small enough to maintain by hand; matches `dawn`'s pattern over `angular-agent-framework`'s scale-driven Claude-API generation.
- **Voice:** third-person conversational, matches existing package README. Direct second-person at the reader, third-person about the library. No "Let's create" or "we'll".
- **Length per page:** concept pages 500-800 words; recipe pages 200-400 words (code-heavy); reference pages whatever the table needs.
- **Tone:** honest about pre-1.0 status. The Streaming stub's "API in flux" callout is the template for any unstable surface.
- **Cross-references:** every page links to siblings (next/prev within section) and parent (section overview). The DocsSidebar handles spatial navigation; in-prose links handle conceptual bridging.

### What we explicitly skip for v0.0.x

| Skipped | Why | Add when |
|---|---|---|
| Search (Algolia / Pagefind) | 25 pages — keyboard CMD-F is fine | docs grow past ~50 pages |
| Versioned docs | one version exists | first non-internal consumer |
| Auto-gen API ref from TypeScript | small surface, manual is fine | maintenance pain hits |
| Localization | English only | external demand |
| Claude-API narrative auto-gen | YAGNI for hand-authored docs | docs at scale (100+ pages) |
| Custom theme + Streaming examples | Custom-theme authoring story not yet stable; streaming API in flux | their respective stories settle |

## Implementation decomposition

Four PRs, shipping in priority order. Each PR ships a complete user-facing improvement to `/docs` and is independently reviewable.

| PR | Scope | New pages | Why this slice |
|---|---|---|---|
| **1** | Theming section + Concepts page + nav extension + /docs index hub | 9 (8 theming + 1 concepts) | Ships the override story. Concepts is bundled because Theming pages reference its vocabulary. The /docs hub gets refreshed since nav is changing. |
| **2** | Grid section | 5 (Overview, Columns, Rows/selection/focus, Sort+filter, Density helpers) | Documents the engine surface. Doesn't depend on PR 1 content but builds on its nav extension pattern. |
| **3** | API Reference + Streaming stub + Examples gallery | 8 (4 reference + 1 stub + 3 examples) | Closes out the documented surface. Examples need PR 1 + PR 2 content so they can cross-link. |
| **4** | Polish + cross-references + package README updates | — | Visual audit, fix broken links, update `packages/ui/README.md` to point at the new docs, create `packages/react/README.md` (currently missing), update `apps/website/README.md` cross-reference. |

### What each PR ships standalone

- **After PR 1:** `/docs` has a real Theming section with the override story. Asymmetry between npm README and website is gone for theming.
- **After PR 2:** `/docs` documents the engine API surface.
- **After PR 3:** `/docs` is a complete consumer reference. Examples gallery showcases live patterns.
- **After PR 4:** `/docs` is polished and the package READMEs redirect to it as the canonical home.

### Per-PR brainstorm-plan-implement cycle

Each PR follows the same pattern as the theming arc:

1. This spec is the source of truth for IA + content outlines.
2. Each PR gets its own writing-plans cycle when its turn comes (lightweight — content writing, not architecture decisions).
3. Each PR follows subagent-driven-development with worktree, prettier discipline, auto-merge.
4. The conventions (front-matter, voice, MDX components) are inherited from this design.

PR 1 starts immediately after this spec lands.

## Open risks & non-goals

| # | Risk / non-goal | Mitigation |
|---|---|---|
| 1 | Streaming docs are a stub — consumers land there expecting depth | Honest "API in flux" callout, link to `apps/streaming-demo` working code, defer fleshing out until streaming API stabilizes |
| 2 | Token reference appears in two places (Theming → Token reference, API Reference → Theme token contract) | Designate Theming → Token reference as canonical; API Reference page is a thin pointer, not a duplicate |
| 3 | Examples gallery only ships 3 of the 5 originally outlined; Custom theme + Streaming examples deferred | Document the deferral; revisit after one external consumer asks |
| 4 | `packages/react/README.md` doesn't exist; PR 4 creates it from scratch | Scope PR 4 carefully — README authoring is its own writing task |
| 5 | Diátaxis-purists may push back on the topical-with-embedded-reference structure | Documented rationale: matches user's other repos + 4 of 5 competitors. Topical wins for UX even when not Diátaxis-pure. |
| 6 | Voice consistency across 25 hand-authored pages drifts | Style guide in this spec (third-person conversational, code-first); each PR's review checks voice |

## Non-goals (explicit)

- **No version 1.0 readiness signal** — docs ship pre-1.0 with explicit instability disclaimers; v1.0 graduation is a separate decision
- **No marketing copy in /docs** — the landing page (Hero, Problem, Solution, FeatureGrid, etc.) handles marketing; /docs is technical
- **No competitor-migration guides** — speculative until a real consumer files an issue. The bench's adapter implementations serve as worked cross-library comparisons
- **No interactive playground (full IDE / sandbox)** — defer to v1.0 or external (StackBlitz, CodeSandbox) when demand emerges
- **No video content** — text + code samples only

## Appendix A: alignment with reference patterns

This IA sits at the intersection of three reference patterns:

1. **User's own repos** (`angular-agent-framework`, `dawn`) — both use Getting Started → Concepts → Guides → Reference shape; both Next.js + MDX. Pretable inherits this shape.
2. **Tailwind CSS docs** — the gold standard for token-system documentation. "Theme variables" concept hub + per-utility token tables + `@theme` customization examples = the triad pretable's Theming section emulates (Overview + Token reference + Override tokens).
3. **shadcn/ui docs** — the "you own the tokens" model documented as a CSS-variable contract. Pretable's `--pretable-*` namespace and the Token reference table mirror this convention.

Diverges from:
- **AG Grid** — too deep (~150 pages) for pretable's pre-1.0 surface
- **MUI X** — fragmented theming docs (no token reference); pretable explicitly avoids this
- **TanStack Table** — pure Diátaxis with Guides ↔ APIs mirroring; pretable uses topical-with-embedded-reference instead

## Appendix B: cited sources

- User's repos: `/Users/blove/repos/angular-agent-framework`, `/Users/blove/repos/dawn`
- AG Grid docs: https://www.ag-grid.com/react-data-grid/
- TanStack Table docs: https://tanstack.com/table/latest/docs/introduction
- MUI X DataGrid docs: https://mui.com/x/react-data-grid/
- Tailwind CSS docs: https://tailwindcss.com/docs
- shadcn/ui docs: https://ui.shadcn.com/docs
- Diátaxis methodology: https://diataxis.fr (referenced for taxonomy framing; not strictly applied)
```
