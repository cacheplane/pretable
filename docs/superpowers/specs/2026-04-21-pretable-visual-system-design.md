# Pretable Visual System — Design Spec

**Date:** 2026-04-21
**Status:** Draft for review
**Target:** staff engineers and VP-tech decision makers evaluating React data-grid libraries; explicit goal of taking market share from AG Grid.
**Scope:** unified visual system covering `apps/playground` (the pitch), `apps/bench` (the adversarial receipts), and a new `apps/docs` (Mintlify-equivalent reference) plus the shared package that powers them.

---

## 1. Goal

Pretable's product story is "the grid that's both fast AND beautiful." The code is defensible but every visible surface currently reads as an internal dev tool. We ship a cohesive visual system — "editorial chrome around technical content" — across three surfaces that share one palette, one type scale, one nav, one footer, and one set of component primitives. Each surface has exactly one job.

The goal is not a full corporate brand. It is a visual identity distinctive enough that a staff engineer who saw pretable once remembers it by sight, and a VP-tech feels the product has craft and longevity.

## 2. Competitive positioning (evidence-backed)

From competitor research conducted 2026-04-21 (see `/private/tmp/claude-501/.../a5739ef0321dde6ab.output` for the raw report — will be cited in PR, not committed):

| Competitor | Visual posture | The opening they leave us |
| --- | --- | --- |
| **AG Grid** (`ag-grid.com`) | Corporate, feature-matrix, `/performance` page returned 404 on fetch | Looks tired. Removed their own benchmark page. "Best in the world" without adjacent proof. |
| **TanStack Table** (`tanstack.com/table`) | Dark, cyan `#05BDBA`, sponsor-wall, no live product | Headless — nothing to see on landing. Reads as "solo project scaled up." |
| **MUI X DataGrid** (`mui.com/x/react-data-grid`) | Docs-shell, Material blue, version pill `v9.0.2` | Reads as reference page, not pitch. No independent identity. |

**Gaps worth owning, concretely:**

1. No competitor uses **serif display type**. We use Fraunces.
2. No competitor uses **warm amber accent**. TanStack owns cyan; AG Grid and MUI use cool blues. We own `#8a5d0f` on cream / `#c68a1e` on dark.
3. No competitor **contrasts editorial light chrome against dark terminal product surfaces**. MUI and AG Grid are uniformly light-doc; TanStack is uniformly dark-dev. We bracket a dark grid between two cream bands.
4. No competitor **treats the grid as a craft object worth looking at on the landing page**. They treat it as a reference component, a headless primitive, or enterprise capability.
5. AG Grid has no live benchmark page. We make the bench our second surface.

## 3. Visual system (tokens)

### Palette (CSS custom properties)

```css
/* editorial — marketing / playground chrome / docs prose */
--cream:       #ede5d4;  /* chrome, receipts band */
--cream-hi:    #f5eedd;  /* raised surface, callouts */
--cream-rule:  #cdc3aa;  /* hairline dividers */
--ink:         #1a1815;  /* primary text, CTA fill */
--ink-dim:     #4a443b;  /* secondary text */
--ink-softer:  #7a7468;  /* tertiary text */
--amber-ink:   #8a5d0f;  /* accent on cream surfaces */
--amber:       #c68a1e;  /* accent on dark surfaces */
--amber-soft:  #f5e8ca;  /* search match, NEW pill fill */

/* terminal — grid surface, bench, code blocks */
--dark:        #0f0e0c;  /* page background under grid */
--grid-bg:     #0b0a09;  /* table surface, code block bg */
--grid-raised: #151310;  /* focus / sticky elevated */
--grid-rule:   #1f1c18;  /* cell dividers */
--grid-text:   #d8d2c3;  /* cell text */
--grid-dim:    #8f8a7d;  /* column headers, labels */

/* severity — only saturated color in the system */
--sev-info:    #6fa9c9;  /* desaturated blue */
--sev-warn:    #d9a44f;  /* amber family */
--sev-err:     #d3615a;  /* muted red */
--sev-ok:      #7ea86f;  /* moss green */
```

### Contrast audit (WCAG)

All pairings target AA minimum (4.5:1 body, 3:1 large text). AAA where cheap.

| Pair | Ratio | Grade |
|---|---|---|
| ink on cream | 14.1:1 | AAA |
| ink-dim on cream | 7.8:1 | AAA |
| amber-ink on cream | 5.1:1 | AA |
| grid-text on grid-bg | 11.9:1 | AAA |
| grid-dim on grid-bg | 5.8:1 | AA |
| amber on grid-bg | 6.6:1 | AAA |
| sev-info on grid-bg | 7.3:1 | AAA |
| sev-warn on grid-bg | 9.8:1 | AAA |
| sev-err on grid-bg | 5.4:1 | AA |

No AAA strict requirement; the one AA-not-AAA pair (sev-err) is consciously accepted — darkening red reduces severity readability at the small mono size we use.

### Typography

Single web-font download (~35KB gzipped):

- **Fraunces** (variable: wght 400–700, italic, opsz, SOFT axis) — display headlines, editorial emphasis, big receipts numbers, docs page titles
- **System sans stack** — UI, buttons, body prose
  - `ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- **System mono stack** — code, data, eyebrows, telemetry, key caps
  - `ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", "Roboto Mono", monospace`
- **Serif fallback** — `Georgia, "Times New Roman", serif` (if Fraunces fails to load, the page still reads as respectable)

### Type scale (name · stack · size/line-height · usage)

| Name | Stack | Size/LH | Tracking | Used for |
|---|---|---|---|---|
| display-xl | Fraunces 400 | 60/60 | -2.5% | playground hero |
| display-lg | Fraunces 500 | 32/36 | -2% | section heads |
| display-md | Fraunces 400 | 44/46 | -2.5% | bench + docs titles |
| dek | Fraunces 400 | 18/26 | — | hero subhead |
| body | system sans | 15/24 | — | long-form prose |
| ui | system sans 500 | 13.5/20 | — | buttons, labels |
| eyebrow | system mono | 11/16 | +12% UPPER | category labels |
| data | system mono | 12.5/19 | — | grid cells, code |

Italics in Fraunces carry the accent: **headline emphasis** (italic amber on cream) and **bench `FASTEST` badge wordmark** (italic amber on dark).

## 4. Information architecture

Three surfaces, one job each. No `/pricing`, no `/about`, no `/blog` for v1.

```
pretable.ai               pretable.ai/bench         pretable.ai/docs
THE PITCH                 THE RECEIPTS              THE ONRAMP
apps/playground           apps/bench                apps/docs (new)

Hero → grid → receipts    4-col compare →           Mintlify-layout:
→ footer                  scorecard → CI history    sidebar + prose + TOC
                          → methodology             + search modal
                                                    + API split-pane
```

Cross-links:
- Playground receipts → Bench permalink
- Docs bottom nav → Playground ("see it live") and Bench ("see it measured")
- Bench methodology → Docs (how we measure is also in docs)

Shared across all three surfaces:
- Nav (60px, wordmark + links + version pill + status dot)
- Footer (monospaced, one line, CI status visible)
- Cmd+K search (v1 only in docs; v2 in all surfaces)

## 5. Playground page — `apps/playground` / `pretable.ai`

**Role:** single-page pitch. The grid itself is the hero.

**Scroll sections (top → bottom):**

1. **Nav** — shared, `playground` active.
2. **Hero (cream)** — 64px padding top/bottom. Eyebrow (`$ pretable — read-heavy wedge · vol. 1 · no. 4`), Fraunces headline with italic amber emphasis, Fraunces dek with inline `<receipt>60fps</receipt>` tags, two CTAs (primary "Try the live playground ↓", ghost monospace `$ npm i @pretable/react`).
3. **Live grid (terminal, full-bleed)** — edge-to-edge under hero. Chrome strip on top with file-tab label + scale selector (`tiny`/`dev`/`stress`) + live telemetry (`rendered 8 · frame 2.4ms · sel evt-001`). Inline filter row below. 52px header row (single line, no more backdrop bug). 7+ wrapped body rows with severity color. Selected row highlighted with amber timestamp.
4. **Receipts band (cream)** — 52px padding. "*Receipts*, not claims." H2 with italic amber. 4-column grid of big Fraunces numbers (`500k`, `2.4ms`, `0`, `4.1× ag-grid`) with top hairline rules + caption ("on S7 stress scenario, 2 pinned"). Link to bench: "See them re-run in the bench →".
5. **Footer** — shared.

**Notable design decisions:**
- Grid is full-bleed under the hero — no card chrome around it. Signals "the grid IS the page."
- Headline ends with period (editorial voice). Italic amber `scroll` in `treats scroll as a first-class feature`.
- Periodical framing: `vol. 1 · no. 4 · april`. Each release is an "issue." This is pretable's voice.

## 6. Bench page — `apps/bench` / `pretable.ai/bench`

**Role:** the adversarial proof surface. Less marketing chrome, more lab report.

**Scroll sections:**

1. **Nav** — shared, `bench` active.
2. **Compact hero (cream, 40px padding)** — "*Receipts*, reproducible." + methodology one-liner. Smaller than playground's hero (40px vs 64px) — signals tool over pitch.
3. **Control strip (cream-hi)** — segmented pills for scenario (`S1` / `S2` / `S7`), scale (`tiny` / `dev` / `stress`), adapters (multi-select: `pretable` / `ag-grid` / `tanstack` / `mui-x`). Amber-fill on active state. Live permalink `/bench?s=S2&v=all&scale=dev` auto-updates as you click. Run button right-aligned with green status dot.
4. **Adversarial 4-column grid (terminal)** — one column per selected adapter, border-right between columns. Each column:
   - Col head: Fraunces adapter name, version pill. Winner (pretable) gets an italicized name + amber `FASTEST` badge + subtle top-gradient.
   - Live telemetry block: `frame p50 / p99 / interact p99 / rendered rows / jank (>16ms)` color-coded green (`<sev-ok>`) / amber (`<sev-warn>`) / red (`<sev-err>`).
   - Mini-grid snapshot: same 4 rows of data rendered through each adapter. Only pretable lights up severity color; others render plain monochrome — visual signal of the "craft object" gap.
5. **Scorecard table (cream-hi)** — monospace table: metric × adapter matrix. pretable column heading amber-ink filled. Each cell green if won, ink-dim if lost, n/a for untestable. Final column shows the pass/fail budget (`≤4ms`, `≤16ms`, `≤32ms`, `0 target`).
6. **CI history chart (dark)** — 30-bar chart (one bar per CI run over last 30 days), color-coded by budget status (`<sev-ok>` / `<sev-warn>` / `<sev-err>`). Clickable: each bar links to the commit + flame graph.
7. **Methodology (cream)** — 2-column: editorial prose on left ("*How* we measure."), dark reproduce-locally code block on right with real `pnpm bench:matrix` command.
8. **Footer** — shared.

**Permalink as conversion vector:** `/bench?s=S7&v=pretable,ag-grid&scale=stress` — senior engineer pastes into Slack, team clicks, they see the exact result. This is the "staff eng shares with VP" moment.

## 7. Docs — `apps/docs` / `pretable.ai/docs`

**Role:** onramp. v1 ships Getting Started populated; other sections stubbed with `SOON` badges.

### Layout tokens (Mintlify-standard, pretable-themed)

| Token | Value | Note |
|---|---|---|
| page max width | 1440px | center on ultrawide |
| header height | 60px | sticky |
| left sidebar | 260px | fixed; hamburger below `md` |
| right TOC | 224px | sticky scrollspy; hidden below `lg` and on API-ref pages |
| main prose max | 720px | readable line length |
| code/demo max | 900px | breaks out of prose column |
| API-ref split | 50/50 | right pane sticky; no TOC |
| search modal | 560px wide, `Cmd+K` | keyboard navigable |

### Chrome elements

**Header (60px, sticky)**
- Left (260px region): `pretable.` wordmark + amber period + `v0.4` pill (MUI-style)
- Center (flex): search bar with `⌘K` kbd, ~520px max-width, cream-hi background, border outline
- Right: GitHub star counter pill (`★ 1.2k`), theme toggle (`☾`), amber "Try playground →" CTA

**Sidebar (260px)**
- Collapsible groups: Getting Started, Concepts, Recipes, API reference, Changelog
- Active item: 2px amber-ink left border + weight-bump + `cream-hi` fill — no saturated background
- Badges: `NEW` (solid amber), `SOON` (outline only). Both monospace 9px +8% tracking UPPER.
- Group heads: mono eyebrow with collapsible chevron.

**Main (720px prose, 900px breakout)**
- Breadcrumb row (mono, amber emphasis on terminal crumb)
- Page title: Fraunces 44px with italic amber emphasis
- Dek: Fraunces 18px
- Body: system sans 15px
- H2: Fraunces 26px, H3: Fraunces 18px
- Inline code: `cream-hi` fill with `cream-rule` border
- Code blocks: terminal dark (`grid-bg`) with language-tab row (`npm`/`pnpm`/`yarn`/`bun` for shell; `TypeScript`/`JavaScript` for source) + copy button + optional line highlighting (`inset 3px 0 0 amber` + `#1c1a15` fill)
- Callouts: cream-hi fill, amber-ink (or sev-warn for warnings) left border, monospace tag + italic Fraunces body
- Bottom: "Was this page helpful?" thumbs + "Edit on GitHub ↗" link + prev/next cards

**Right TOC (224px)**
- Mono eyebrow "On this page"
- Scrollspy with 2px amber left border on active
- Nested items indented 14px
- Bottom stub: `<a>Edit on GitHub ↗</a>` for convenience

**Search modal (`Cmd+K`)**
- 560px wide, 80px from top when open
- Cream fill + shadow over `rgba(26,24,21,0.55)` backdrop with `blur(3px)`
- Input row: search icon + input + blinking amber caret
- Results grouped by category (Pages / API reference / Recipes)
- Each hit: icon (page type glyph) + bold title + small dimmed subtitle + right-aligned type tag (mono 9.5px)
- `<mark>`-highlighted matches in amber-soft fill
- Selected row: cream-hi background + 2px amber-ink left border
- Footer strip with kbd hints (`↑↓` navigate, `↵` open, `esc` close)

### API reference (Stripe-style split)

Only on `/docs/api-reference/*` pages. Replaces the 3-col layout with 2-col:

- **Left pane (cream, scrolls)** — breadcrumb → Fraunces title → lead paragraph → prop tables (Name / Type / Description columns, required props marked with red `*`, type values in amber-ink mono on cream-hi)
- **Right pane (dark, sticky)** — language tabs (TypeScript / JavaScript / Preview ↗) at top → code block showing exact example → `▸ Live preview` divider → rendered mini-grid below showing the 4-row example from the prop table

No right TOC on API reference pages — the split pane IS the "at a glance" surface.

### Content plan (v1 vs later)

**v1 populated:**
- `/docs` → redirect to `/docs/getting-started/quickstart`
- `/docs/getting-started/quickstart` — full page (the mockup)
- `/docs/getting-started/install` — minimal, absorbed into quickstart but routed
- `/docs/getting-started/first-grid` — extends quickstart
- `/docs/api-reference/inspection-grid` — populated split-pane page for `<InspectionGrid />`

**v1 stubbed** (present in sidebar with `SOON` badge, 404-equivalent content that matches the design system):
- Concepts (all sub-pages)
- Recipes (all sub-pages)
- API reference — other components
- Changelog

**Explicitly cut from v1:**
- Multi-framework switching (React-only for now; adding Vue later is a pure sidebar change, not a layout change)
- Dark-mode toggle on docs (theme is a follow-up; the design system is dark-in-places-already)
- OpenAPI-driven API reference (manual TypeScript prop tables for now)
- Internationalization

## 8. Implementation surfaces

### New workspace packages

**`packages/ui` — new**

Shared design-system primitives. Exports:

- CSS tokens file with all the `--cream` / `--ink` / `--amber` / `--grid-*` / `--sev-*` variables
- Fraunces font setup (preload `<link>`, `@font-face` declarations pointing at Google Fonts CSS2 or a self-hosted WOFF2)
- React components: `<Nav />`, `<Footer />`, `<Receipt />` (inline receipt tag), `<CodeBlock />` (with tabs + copy), `<Callout />`, `<SearchModal />` (opens on `Cmd+K`, listens at document level)
- Tailwind preset (if we choose Tailwind; see Open Questions) — or vanilla CSS modules, to be decided in implementation plan.

### Modified apps

**`apps/playground`**
- Replace current cream-light theme with new system
- Restructure into hero + full-bleed grid + receipts band + footer per Section 5
- Pull in `<Nav />` + `<Footer />` from `packages/ui`
- Remove the existing gradient-heavy `:root` background; replace with cream solid

**`apps/bench`**
- Replace current dark-gradient theme with new system (keep dark where grid content lives, use cream chrome for hero/scorecard/methodology)
- Build new 4-column comparison layout and control strip per Section 6
- Permalink handling: parse URL query params on load, update on interaction (via `history.replaceState` so no reload)
- CI history chart: read from `status/runsets/*.json` (already produced by `pnpm bench:matrix`)

**`apps/docs` — new**
- Vite + React app matching the other two
- File-based routing via `@generouted/react-router` or simple manual `react-router-dom` setup
- MDX support for content pages
- Search: client-side Fuse.js index built from MDX frontmatter at build time (no server needed for v1; ~50KB payload acceptable)
- Initial content: 4 pages populated, rest stubbed

### Shared migrations

- `apps/bench/src/app.css` and `apps/playground/src/app.css` **both get gutted** and rebuilt from tokens.
- Existing brand gradient backgrounds are removed. Pure `--cream` (editorial) and `--dark` (terminal) surfaces only.
- Domain setup (out of scope for this spec, but noted): `pretable.ai` → playground build, `pretable.ai/bench` → bench build, `pretable.ai/docs` → docs build. Host-agnostic; implementation can use Vercel/Netlify/Cloudflare Pages rewrites.

## 9. Out of scope

Explicitly not in this spec or its implementation plan:

- Logo mark (only wordmark + amber period for v1; a mark can follow)
- Dark-mode toggle on any surface (the system IS intentionally warm-dark in places already)
- Multi-language SDK support (we are React-only)
- Marketing outside these three surfaces (no landing subsites, no blog, no `/about`, no `/pricing`, no newsletter)
- Analytics / telemetry beyond what already exists in bench
- Authenticated areas / user accounts
- Mobile-first UX for the grid itself (mobile readable, but desktop-optimized — engineers don't evaluate grids on phones)

## 10. Open questions for implementation

These are decisions the implementation plan will resolve, not blockers to approval:

1. **Styling approach:** vanilla CSS modules with a shared `tokens.css` (minimal dependencies) vs. Tailwind with a custom preset (faster iteration but bigger build tooling). Recommendation in the plan will propose vanilla CSS modules for v1 — the system is small enough that Tailwind overhead isn't justified.
2. **Font hosting:** Google Fonts CDN vs self-hosted. Recommendation: self-hosted `.woff2` subset (~35KB) under `packages/ui/fonts/` for reliability and no third-party requests.
3. **MDX toolchain for docs:** `@mdx-js/rollup` with Vite vs a thin wrapper. Recommendation: `@mdx-js/rollup` directly, no Docusaurus/Nextra layer.
4. **Search index:** Fuse.js client-side vs a simple grep-through-JSON approach. Recommendation: Fuse.js, already battle-tested for docs search.
5. **CI history chart:** build-time from JSON vs live API. v1: build-time only (rebuilds on every CI green).

## 11. Success criteria

Shipping this system is successful if:

1. A staff engineer who sees `pretable.ai` for 10 seconds can describe the visual identity without squinting (cream + warm-dark + serif).
2. The live grid on the playground renders correctly with the fixed column layout (no regression of the `display: flex` + `top: 0` fix).
3. Bench permalinks round-trip: clicking pills updates the URL; pasting the URL into a new tab restores the same state.
4. Docs search returns relevant results for at least the 4 populated pages within 150ms (local Fuse.js).
5. Lighthouse "Best Practices" ≥95 on all three surfaces; CLS = 0 on initial load (font-display: swap with sized fallback to prevent layout shift).
6. The header row readability bug reported 2026-04-21 is resolved (already done in PR #4; this spec adopts that fix).
7. WCAG AA contrast across all specified pairings (Section 3 audit).

---

**End of spec.** Implementation plan follows (writing-plans skill).
