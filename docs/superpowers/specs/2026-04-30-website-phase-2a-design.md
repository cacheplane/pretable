# Website Phase 2.A — Static Body Sections Design Spec

**Date:** 2026-04-30
**Status:** Draft for review
**Scope:** Phase 2.A of the website pivot — insert seven static "AI-startup landing" body sections between the existing `<PlaygroundSection />` and `<Footer />` on `apps/website`. Add a vertical page-level gradient base. No animations, no blobs, no MDX — those are Phase 2.B / 2.C.
**Parent context:**

- [`2026-04-24-website-phase-1-design.md`](./2026-04-24-website-phase-1-design.md) — Phase 1 design (token retune + scaffold + hero + live grid).
- Reference: `~/repos/dawn/apps/web/app/components/landing/` (12 sections), `~/repos/angular-agent-framework/apps/website/src/components/landing/` (~25 sections).
- Memory: [`project_website_pivot_after_b.md`](../../../../../.claude/projects/-Users-blove-repos-pretable/memory/project_website_pivot_after_b.md), [`project_ai_integrations_future.md`](../../../../../.claude/projects/-Users-blove-repos-pretable/memory/project_ai_integrations_future.md).
  **Dependencies shipped:** Phase 1 PR #18 (`@pretable/ui` cool-slate retune, `c29da2b → 7cf5ac0`), Phase 1 PR #19 (`apps/website` scaffold + Hero + PlaygroundSection, `2925929`).

---

## 1. Goal

Phase 1 shipped a deployable `apps/website` with a centered hero and a live interactive playground grid section directly below. That's two visual stops on the page; AI-startup landings have 8–14. The page reads as "incomplete" today — readers hit the Footer too soon and bounce.

Phase 2.A inserts the **seven body sections** between the existing `<PlaygroundSection />` and `<Footer />`, in this exact order:

1. **Problem** — the wedge claim against competitors.
2. **Solution** — pretable's perf + streaming answer.
3. **ReceiptsBand** — `*Receipts*, not claims.` (port + restyle from playground).
4. **ComparisonTable** — 4-adapter scorecard with pretable as the FASTEST column.
5. **FeatureGrid** — 6 receipts: perf, streaming, selection, text wrapping, deterministic engine, no-flash hydration.
6. **CodeExample** — minimal LLM-token-streaming snippet, prerendered syntax highlighting.
7. **CtaSection** — final ask, primary anchor up to the live grid + ghost-mono GitHub link.

Plus one foundational visual change:

8. **Page-level gradient base** — vertical CSS gradient on `<body>` implementing the **cool → warm → cool** emotional arc. Cold-indigo at the top (Hero / Problem), warming through navy-amber-undertone at the editorial heart (Receipts / Comparison / Features / Code), back to cool-cyan at the bottom (CTA). `background-attachment: fixed` so the arc is positional, not scroll-following.

Phase 2.A explicitly does **not** include the multi-blob ambient narrative, ScrollReveal entrance animations, MDX content, or revisions to the existing visual-system-design spec. Those are 2.B / 2.C.

## 2. Scope boundary

**Phase 2.A owns:**

- Seven new section components in `apps/website/app/components/`: `Problem.tsx`, `Solution.tsx`, `ReceiptsBand.tsx`, `ComparisonTable.tsx`, `FeatureGrid.tsx`, `CodeExample.tsx`, `CtaSection.tsx`.
- One CSS edit: `apps/website/app/globals.css` `body { background: ... }` rule replaced with the vertical gradient.
- One composition edit: `apps/website/app/page.tsx` imports the seven new sections and composes them in order.
- One `package.json` edit: add `shiki` as a runtime dep for compile-time syntax highlighting in `<CodeExample />` (server component renders pre-highlighted HTML; no client JS).
- All seven sections render as **server components**. No new `"use client"` directives.
- All seven sections render against `bg-transparent` (or no `bg-*` class) so the page gradient bleeds through. The future ambient blob layer (Phase 2.B) will bleed through the same way.
- Editorial copy as written in §5 below — concrete, voice-locked, "Receipts, not claims." threaded through.

**Phase 2.A does NOT own:**

- Multi-blob ambient narrative (5+ positioned absolute blobs at scroll-height milestones) — Phase 2.B.
- ScrollReveal entrance animations / IntersectionObserver triggers — Phase 2.B.
- MDX content support, content collections, dynamic snippet loading — Phase 2.C.
- Updating `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` to reflect cool-slate — Phase 2.C.
- New unit / e2e tests — deferred until a Next.js + RSC-aware test setup lands (likely Phase 2.C).
- Real-time bench data feeds for `<ComparisonTable />` numbers — hardcoded snapshots in 2.A; D may wire later.
- Vercel project / domain wiring — manual deploy when ready.
- Retiring `apps/playground` — Phase 3.
- Broader AI integrations beyond LLM-token-streaming — separate future brainstorming session (memory-tracked).
- Visual elements inside FeatureGrid cards (icons, mini-screenshots, animated SVG) — Phase 2.B may add; 2.A ships text-only cards.
- GitHub stars counter on Nav — `<Nav>` already supports it; wiring requires a real-time fetch or build-time fetch we don't have. Defer.

## 3. Architecture

### File structure

**Created:**

```
apps/website/app/components/
  Problem.tsx               // server, ~50 lines
  Solution.tsx              // server, ~55 lines
  ReceiptsBand.tsx          // server, ~60 lines (port + restyle from playground)
  ComparisonTable.tsx       // server, ~120 lines (semantic <table>, hardcoded data)
  FeatureGrid.tsx           // server, ~80 lines (3×2 grid, 6 hardcoded cards)
  CodeExample.tsx           // server, ~70 lines (shiki highlight at module load)
  CtaSection.tsx            // server, ~45 lines
```

**Modified:**

```
apps/website/app/globals.css       // body { background: linear-gradient(...) } + background-attachment: fixed
apps/website/app/page.tsx          // import + compose 7 new sections
apps/website/package.json          // + shiki@^3 (server-only highlight)
```

**No new tests.** No new directories beyond `components/` (already exists from Phase 1).

### Component conventions

- Every section is a server component (no `"use client"`).
- Every section renders an outer `<section>` with these conventions:
  - No `bg-*` class on the section itself (transparent — page gradient bleeds through).
  - Inner container: `<div className="mx-auto max-w-[1240px] px-7 py-24 md:px-10 md:py-28">` (consistent rhythm; matches Hero's existing `py-24 md:py-32` order of magnitude but tighter to differentiate body from hero).
  - Eyebrow: mono, 11px, uppercase, tracking-[0.14em], `text-accent` cyan. Numbered (`01 · the wedge`).
  - Headline: Fraunces 32-44px display, italic accent emphasis on the rhetorical pivot word.
  - Dek: Inter 16-17px, `text-text-secondary`, max-width ~56ch.
  - Footer-line (where present): mono 11px `text-text-muted`, often a "→ receipt" backlink.
- Each section component has zero props (Phase 2.A is editorially-locked content). If a future caller needs to inject copy, that's Phase 2.C MDX work.

### State ownership

None. Every Phase 2.A section is stateless. No new client components, no new state hooks.

### Type contracts

No new exported types from `@pretable/ui` or `@pretable/react`. All copy and structure is owned by `apps/website`. The `CodeExample` component imports `shiki` (server-only) and the syntax-highlight call happens at module load — the resulting HTML is shipped pre-rendered in the React tree. No runtime client highlighting.

## 4. Page gradient base

The `body { ... }` rule in `apps/website/app/globals.css` changes from a flat token reference to a vertical gradient:

```css
body {
  font-family: var(--font-sans);
  color: var(--pt-text-primary);
  background: linear-gradient(
    180deg,
    var(--pt-bg-page) 0%,
    #0d1426 35%,
    #0f1518 60%,
    var(--pt-bg-page) 100%
  );
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}
```

The four stops:

- **0%** — `--pt-bg-page` (cool navy, the page baseline). Anchors Hero + PlaygroundSection.
- **35%** — `#0d1426` (cooler navy, slightly deeper). Anchors Problem (the cold beat).
- **60%** — `#0f1518` (subtle warm undertone — barely off the navy axis, slightly green-shifted). Anchors the proof stretch (Receipts / Comparison / Features / Code).
- **100%** — `--pt-bg-page` (cool navy returns). Anchors CTA + Footer.

`background-attachment: fixed` keeps the gradient anchored to the viewport, so the warm-cool-warm transition is positional in the page layout — not a scroll-follower. As the user scrolls, sections move past the static gradient and pick up its color where they sit.

The hex values for the middle two stops are **not** added as `--pt-*` tokens — they're page-decoration-specific, not design-system colors. If Phase 2.B's blobs need to reference them, they get inlined in the blob style attributes too.

## 5. Section-by-section content

Each entry: outer markup pattern + concrete eyebrow / headline / dek / closing line. Tailwind classes inline; full files in §6.

### 5.1 `<Problem />`

- **Eyebrow:** `01 · the wedge`
- **H2 (Fraunces, italic-indigo `wedge`):** `Other grids stall on the read-heavy *wedge*.`
- **Dek:** `AG Grid took down their performance page. TanStack is headless. MUI X reads as a docs shell. Every competitor has stopped letting you watch the grid render.`
- **Closing line:** `Read it for yourself: their landing pages.` (mono, `text-text-muted`)

Indigo-italic is intentional — the only place on the entire site that uses indigo accent (Phase 2.B's blob anchor will reinforce). Everywhere else the italic accent is `text-accent` cyan. The indigo here marks the "cold" emotional beat.

```tsx
<em className="italic text-[#818cf8]">wedge</em>
```

The `#818cf8` hex is inlined deliberately — it's a one-time editorial color (Tailwind indigo-400). Doesn't earn a token slot.

### 5.2 `<Solution />`

- **Eyebrow:** `02 · the answer`
- **H2:** `Pretable renders the wedge at *60fps* — and lets you stream tokens into it.` (italic-cyan `60fps`)
- **Dek:** `A deterministic engine you can read. Wrapped text without jank. Selection that survives filters and updates. Three claims; three receipts below.`
- **Three-bullet row** (mono, accent dots, single line):
  - `▸ deterministic` — no opaque virtualization
  - `▸ streaming-aware` — token-by-token rendering
  - `▸ stable selection` — row-id keys survive every chunk

### 5.3 `<ReceiptsBand />`

Direct port of `apps/playground/src/receipts-band.tsx` (which Phase 1 PR #18 already restyled to cool-slate). The Phase 2.A copy lives at:

```tsx
import { Receipt } from "@pretable/ui";
```

Same component shape: section header `*Receipts*, not claims.` (italic-cyan `Receipts`), 4-stat grid, bench backlink. Same `STATS` provenance comment about which numbers are live vs spec placeholders. The CSS class strings are already migrated to new tokens (`text-accent-deep`, `bg-bg-page`, `border-rule`). No code changes from playground's version — this is a copy-paste with a single-import diff (`./copy-command` → `../components/CopyCommand` if needed; turns out CopyCommand is a sibling, so import stays `./CopyCommand`).

Wait — playground's `<ReceiptsBand />` doesn't import `<CopyCommand />`. It just renders text + numbers + bench link. The port is straightforward. Implementation simply copies the file content into `apps/website/app/components/ReceiptsBand.tsx`.

### 5.4 `<ComparisonTable />`

- **Eyebrow:** `03 · cell-by-cell receipts`
- **H2:** `Cell-by-cell receipts.`
- **Dek:** `Every metric, every adapter, the same scenario. Pretable's column is amber-italic; numbers come from the latest \`pnpm bench:matrix\` run.`

Markup: a semantic `<table>` with `<thead>` + `<tbody>`. NOT a CSS-grid hack — this is genuinely tabular data, accessibility wants `<table>`.

Columns: `Metric | Pretable | AG Grid | TanStack | MUI X | Budget`
Rows (hardcoded snapshots in 2.A — same provenance comment as `ReceiptsBand`):

- `frame p95 (ms)` | `9` | `28` | `21` | `34` | `≤ 16ms`
- `interact p99 (ms)` | `4` | `18` | `15` | `26` | `≤ 32ms`
- `rendered rows @ S7` | `500k` | `n/a` | `8k` | `n/a` | `target`
- `jank events` | `0` | `47` | `12` | `61` | `0`
- `vs ag-grid` | `4.1×` | `1×` | `1.3×` | `0.8×` | `>1×`

(Numbers are placeholder-realistic for 2.A. Real numbers replace these in the actual implementation when the bench output is parsed; if not available at impl time, ship with a `TODO(bench-numbers): refresh from latest matrix run` provenance comment same shape as `<ReceiptsBand />` already uses.)

Visual treatment:

- Pretable column heading: italic Fraunces, `text-accent` cyan, with a small `FASTEST` badge (mono 9px uppercase, `bg-accent-soft text-accent` rounded-[2px]).
- Win cells: `text-accent` cyan.
- Loss cells: `text-text-muted` (slate-500ish).
- `n/a` cells: `text-text-dim` (slate-600ish), italic.
- Budget column: mono `text-text-secondary`.
- Table border: 1px `border-rule` outer; inner row dividers same.

Closing line: `Re-run the comparison → /bench` (mono `text-accent-deep`).

### 5.5 `<FeatureGrid />`

- **Eyebrow:** `04 · what's in the box`
- **H2:** `Six receipts.`
- **Dek:** `Each feature backed by a bench scenario or demo. No claim without a click-to-prove.`

Layout: `<ul role="list">` with `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`. Six `<li>` cards.

Each card:

- Mono number eyebrow: `01` … `06`, `text-accent` cyan, mono 11px tracking.
- Title: Fraunces 22px display, `text-text-primary`.
- Caption: Inter 14px `text-text-secondary`, max 2 lines.
- Footer link: mono 11px `text-accent-deep`, format `→ receipt: <target>`.

The six cards (titles + captions + receipt targets):

1. **`60fps performance`** / `500k rows render at frame p95 ≤ 16ms on the S7 stress scenario.` / `→ receipt: /bench?s=S7&scale=stress`
2. **`Stream-aware`** / `Token-by-token rendering for OpenAI / Anthropic / your own SSE — at 1k updates/sec sustained.` / `→ receipt: /streaming-demo`
3. **`Selection survives filters`** / `Row-id keys persist across filter, sort, and live updates. Click a row, filter the grid, the selection sticks.` / `→ receipt: #grid` (anchor to the live demo)
4. **`Wrapped text, no jank`** / `Multi-line cell content with auto-height — no layout shift on scroll, no row-jump on hover.` / `→ receipt: /bench?s=S2`
5. **`Deterministic engine`** / `The render path is read-able. <code>packages/grid-core</code> ships fewer than 3,000 lines.` / `→ receipt: github.com/cacheplane/pretable`
6. **`No-flash hydration`** / `SSR-safe initial paint. Selection state survives hydration. Works in Next.js App Router.` / `→ receipt: this page` (no link — implicit; the website itself is the proof)

If you'd rather swap card #6 for `Accessibility-first` (keyboard nav, ARIA roles, focus management — also true), flag it during spec review and I'll update.

### 5.6 `<CodeExample />`

- **Eyebrow:** `05 · the import`
- **H2:** `One import. Stream tokens into a stable grid.`
- **Dek:** `Connect any token-streaming source — OpenAI Responses, Anthropic, your own SSE — to a pretable grid. Selection survives every chunk.`

Code block (server-rendered via `shiki`, copyable, monospace, `bg-grid-bg` terminal palette):

```tsx
import { connectStream } from "@pretable/stream-adapter";
import { PretableGrid } from "@pretable/react";
import OpenAI from "openai";

export function ChatGrid() {
  const [rows, setRows] = useState([]);
  const stream = await openai.responses.stream({ ... });

  connectStream(stream, {
    onRow: (row) => setRows((r) => [...r, row]),
  });

  return <PretableGrid rows={rows} columns={columns} />;
}
```

(Specific snippet content is editorial — adjust during impl if `connectStream` is named differently in `@pretable-internal/stream-adapter`. Goal: 12-15 lines, the smallest realistic LLM-streaming example. If shiki rendering is fussy, fall back to a plain `<pre><code>` with manual `<span>` color spans — both render identically server-side.)

Closing line: `Full example: \`apps/streaming-demo\`` (mono link to that source on GitHub).

### 5.7 `<CtaSection />`

- **Eyebrow:** `06 · check the receipts`
- **H2:** `Check the receipts.`
- **Dek:** `The grid is in your hands at the top of this page. The numbers are reproducible at \`/bench\`. The source reads cleanly. Star, install, ship.`
- **Two CTAs** (matching the Hero's pattern):
  - Primary `Try the playground ↑` — solid `bg-accent text-bg-page`, anchors to `#grid`.
  - Ghost-mono `View on GitHub →` — pill-shaped, `border-text-primary`, links to `https://github.com/cacheplane/pretable`.
- **Closing line:** `MIT licensed · Built in the open · No telemetry.` (mono 11px, `text-text-muted`)

## 6. Composition + page.tsx

`apps/website/app/page.tsx` becomes:

```tsx
import { Hero } from "./components/Hero";
import { PlaygroundSection } from "./components/PlaygroundSection";
import { Problem } from "./components/Problem";
import { Solution } from "./components/Solution";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ComparisonTable } from "./components/ComparisonTable";
import { FeatureGrid } from "./components/FeatureGrid";
import { CodeExample } from "./components/CodeExample";
import { CtaSection } from "./components/CtaSection";

export default function HomePage() {
  return (
    <>
      <Hero />
      <PlaygroundSection />
      <Problem />
      <Solution />
      <ReceiptsBand />
      <ComparisonTable />
      <FeatureGrid />
      <CodeExample />
      <CtaSection />
    </>
  );
}
```

`<Hero />` and `<PlaygroundSection />` stay byte-identical to Phase 1 — no edits.

## 7. Testing & verification

### Phase 2.A explicitly does NOT add tests

- Next.js + RSC unit-test setup is Phase 2.C (when MDX rendering also needs test coverage).
- All seven sections are stateless render-once server components — there's no behavior to test beyond "renders the expected text content," which Next's build catches automatically (no React errors → render succeeded).

### Repo-wide CI checks must pass

- `pnpm install --frozen-lockfile` — clean (only `shiki` added to website's deps).
- `pnpm test` — green (no test changes; no behavior changes outside website).
- `pnpm typecheck` — clean across 16 workspaces.
- `pnpm lint` — clean. The two false-positive warnings on `layout.tsx`'s `metadata` / `viewport` exports persist (not new).
- `pnpm format` — clean (apply `format:write` if needed).
- `pnpm build` — website builds; static prerender succeeds for `/`.

### Manual visual smoke (before merge)

- `pnpm --filter @pretable/app-website dev` boots; landing renders end-to-end.
- Page gradient visible: scroll from top to bottom, the warm undertone is subtly visible around the Receipts / Comparison / Features stretch.
- Section reading order: Hero → Playground → Problem → Solution → Receipts → Comparison → Features → Code → CTA.
- Editorial voice consistent: every section has eyebrow + Fraunces headline + Inter dek; "receipts" thread present in headlines (Receipts / cell-by-cell / Six receipts / check the receipts).
- ComparisonTable: Pretable column visually distinct (italic-amber, FASTEST badge), numbers populated.
- CodeExample: syntax highlighting visible (purple keywords, yellow strings, cyan function names, etc.).
- CtaSection's primary CTA scrolls back up to the live grid section.
- No client-only errors in console; no hydration warnings.
- Mobile (<640px): every section reflows cleanly. ComparisonTable scrolls horizontally inside its container if it can't fit; cards stack to 1 column.

## 8. Out of scope / handoff to 2.B + 2.C

**Phase 2.B (next):**

- Multi-blob ambient narrative (5+ absolute-positioned blobs at scroll-height milestones, indigo → cyan → amber → cyan).
- ScrollReveal entrance animations via IntersectionObserver.
- Optional: visual elements inside FeatureGrid cards (icons, mini-screenshots, animated SVG).
- Tune the page gradient hex values once blobs land — they may compete; either reduce gradient intensity or shift blob alpha.

**Phase 2.C:**

- MDX content support — convert section copy to MDX so it's edit-without-redeploy.
- Update `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` to reflect the cool-slate AI-startup pivot (or replace it with a new spec).
- Next.js + RSC unit-test setup; backfill tests for sections.
- Real-time bench data feed for `<ComparisonTable />` (build-time JSON read from `status/runsets/`).

**Phase 3 (later):**

- Retire `apps/playground` — its hero + grid pattern lives in `apps/website` now.
- Drop `"playground"` from `NavPage` union; remove `apps/playground/src/__tests__/app.test.tsx`'s transitional banner-filter pattern.

## 9. Rollback

Single-PR squash-merge. Revertable atomically:

- `git revert` the squash commit removes all seven section components, restores `globals.css` body rule, restores `page.tsx` to Phase 1 shape, removes `shiki` from `package.json` + lockfile.
- No data migrations, no external config, no published artifacts touched.

If the visual change is judged off after merge, the body sections can be retired without affecting Phase 1's hero + playground.

## 10. Risks

| Risk                                                              | Mitigation                                                                                                                                                                         |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shiki` is heavy (server bundle size)                             | shiki@^3 ESM tree-shakes well; we only import the languages we use (`tsx`). Server-rendered HTML output is tiny; no client JS impact.                                              |
| Hardcoded numbers in `<ComparisonTable />` go stale               | Provenance comment in source; same pattern playground's ReceiptsBand uses. Phase 2.C wires real bench output.                                                                      |
| Page gradient + Phase 2.B blobs visually compete                  | Gradient stops are deliberately subtle; blobs ship in a separate PR where they can be tuned against the live gradient.                                                             |
| FeatureGrid item #6 (`No-flash hydration`) is hard to demonstrate | Card text is descriptive; no explicit "→ receipt" link — implicit (the website itself proves it).                                                                                  |
| Editorial copy lands too dry / too marketing                      | Voice is locked at "editorial-confident" — engineering claims with one rhetorical move per section. Spec author reads the page aloud post-merge to catch register drift.           |
| ComparisonTable hardcoded loss numbers exaggerate vs reality      | Numbers are placeholder-realistic per existing bench output; if real bench shows pretable losing on a metric, the row gets dropped or reframed during impl. The page must not lie. |

## 11. Success criteria

Phase 2.A is successful if:

1. The seven new section components ship and render in the order specified in §6.
2. The page-level gradient is visible (not so subtle that it's invisible, not so heavy that it competes with Phase 2.B's blobs).
3. The "receipts" thread is editorially intact: every section's copy gestures at a measurable receipt (bench scenario, demo link, source link).
4. ComparisonTable numbers are credible (pretable wins where it actually wins; no fabricated metrics).
5. CodeExample syntax-highlights server-side; copy-able; valid TypeScript that compiles in isolation.
6. CtaSection's primary "Try the playground ↑" anchor scrolls back up to `#grid`.
7. Repo-wide CI green.
8. Manual visual review: the landing reads as a complete AI-startup landing, not "hero + grid + tail end of a page."

---

**End of spec.** Implementation plan follows via `superpowers:writing-plans` after user approval.
