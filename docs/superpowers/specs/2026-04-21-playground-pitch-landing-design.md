# Playground Pitch Landing — Design Spec

**Date:** 2026-04-21
**Status:** Draft for review
**Scope:** direction A of the four-direction website initiative — build the single-page pitch at `apps/playground` per visual-system-design spec §5.
**Parent spec:** [`2026-04-21-pretable-visual-system-design.md`](./2026-04-21-pretable-visual-system-design.md)
**Dependencies shipped:** `@pretable/ui` (PR #7, commit `3d8c57a`) providing `<Nav>`, `<Footer>`, `<Receipt>`, `<CodeBlock>`, `<Callout>`, design tokens.

---

## 1. Goal

`apps/playground` today renders a bare `<InspectionDemo />` inside a `<main>` element — no nav, no hero, no editorial chrome. Direction A replaces that with the five-section pitch landing defined in visual-system-design §5: **Nav → Hero → Full-bleed dark grid → Receipts band → Footer**, bracketing a dark grid between two cream bands per the competitive-gap argument in visual-system-design §2.

The goal is structural and editorial coherence at parity with shipped spec copy. A lands a page that reads as a real artifact — not a wireframe. Direction D later swaps hardcoded numbers for a live bench source and finalizes voice.

## 2. Scope boundary (A vs D)

**A owns:**
- All five sections rendered, in order, with full editorial chrome.
- Spec copy verbatim (eyebrow, headline with italic amber emphasis, dek, CTAs, receipts band header, caption).
- Receipts band numbers sourced from a **real bench snapshot** taken during implementation — four hardcoded `{value, caption}` pairs. D swaps to live source.
- Real telemetry from `InspectionGrid` piped to the chrome strip: `rendered N · sel <id>` plus scale selector. No `frame p50` — not instrumented yet.
- Copy-to-clipboard for the `$ npm i @pretable/react` CTA.
- Deletion of `apps/playground/src/inspection-demo.tsx` and its associated styles in `app.css`.

**D owns (later):**
- Live bench numbers wired to a build-time or runtime source.
- Copy voice polish.
- Real GitHub star count.
- Social/meta tags and favicon.
- Anything editorial that depends on seeing the page live first.

## 3. Architecture

### Component tree

```
<App>                          apps/playground/src/app.tsx
  <Nav active="playground" />  @pretable/ui              (unchanged)
  <main>
    <PitchHero />              apps/playground/src/pitch-hero.tsx       (new)
    <PitchGrid />              apps/playground/src/pitch-grid.tsx       (new)
      └─ <InspectionGrid />    @pretable/react/internal  (unchanged)
    <ReceiptsBand />           apps/playground/src/receipts-band.tsx    (new)
  </main>
  <Footer />                   @pretable/ui              (unchanged)
</App>

// deleted: apps/playground/src/inspection-demo.tsx
// deleted: app.css rules for .inspection-demo, .inspection-controls, .inspection-sidebar, etc.
```

### Cream/dark alternation

Four of five sections are cream (`--pt-cream`); only `<PitchGrid />` is terminal-dark (`--pt-grid-bg`). The grid section is full-bleed with no card chrome — the grid *is* the page. This rhythm honors visual-system-design §2 gap #3 ("no competitor contrasts editorial light chrome against dark terminal product surfaces").

### State ownership

Every piece of state is encapsulated inside the component that owns it. No prop-drilling, no context, no router.

**`<PitchHero />`** — stateless. Renders eyebrow, headline with italic amber emphasis, dek, and two CTAs. CTA 1 is an `<a href="#grid">` anchor; CTA 2 is a copy-to-clipboard command.

**`<PitchGrid />`** — owns grid state:
- `scale: InspectionDatasetScale` — drives dropdown in chrome strip
- `interactionState: { sort, filters, selectedRowId }` — drives filter row and selection
- `telemetry: PretableTelemetry | null` — populated via `onTelemetryChange`
- Dataset and rows memoized on `scale` (pattern identical to current `InspectionDemo`)
- Wraps itself in `<section id="grid">` so the hero CTA anchor resolves.

**`<ReceiptsBand />`** — stateless. Four hardcoded `{value, caption}` pairs + section header + link to bench.

**`<App />`** — dumb composition root. Module-level constant for `APP_VERSION`. `<Nav>` owns its own links internally (current API; see §5.1). `<Footer>` takes a `links` array; for A we pass a minimal list (see §5.5).

### Type contracts

All library-facing types consumed exactly as today — no new exports needed:

- `InspectionGrid`, `PretableTelemetry` — from `@pretable/react/internal`
- `createInspectionDataset`, `inspectionColumns`, `inspectionDatasetScaleOptions`, `InspectionDatasetScale` — from `@pretable-internal/scenario-data`
- `Nav`, `Footer` — from `@pretable/ui`
- `CodeBlock` from `@pretable/ui` is **not** a fit for the hero's ghost-monospace CTA — `<CodeBlock>` is block-shaped with a head bar, the CTA is a pill. A uses a local `<CopyCommand>` helper for the CTA (see §5.2); `<CodeBlock>` may still appear elsewhere on the page if a multi-line install snippet is desired later

## 4. Styling integration

### Approach

`apps/playground` adopts **Tailwind v4** for new markup. `@pretable/ui` components continue to render through their shipped vanilla CSS (unchanged). Tailwind theme is a thin mapping layer over `@pretable/ui` design tokens so utility classes (`bg-cream`, `text-ink-dim`, `border-cream-rule`) map 1:1 to the token set.

This follows the monorepo convention: **`packages/*` are vanilla CSS; `apps/*` may use Tailwind.**

### Dependencies added

- `tailwindcss@^4` (workspace dev dep or app dep — pick app dep during implementation)
- `@tailwindcss/vite`
- `@fontsource-variable/fraunces` (satisfies the optional peer on `@pretable/ui`)

### Vite config

`apps/playground/vite.config.ts` gets one line: add `tailwindcss()` plugin alongside existing `react()`.

### `apps/playground/src/app.css` (rewritten from scratch)

```css
@import "@fontsource-variable/fraunces/wght.css";
@import "@fontsource-variable/fraunces/wght-italic.css";
@import "@pretable/ui/tokens.css";
@import "@pretable/ui/components.css";
@import "tailwindcss";

@theme inline {
  --color-cream: var(--pt-cream);
  --color-cream-hi: var(--pt-cream-hi);
  --color-cream-rule: var(--pt-cream-rule);
  --color-ink: var(--pt-ink);
  --color-ink-dim: var(--pt-ink-dim);
  --color-ink-softer: var(--pt-ink-softer);
  --color-amber-ink: var(--pt-amber-ink);
  --color-amber: var(--pt-amber);
  --color-amber-soft: var(--pt-amber-soft);
  --color-grid-bg: var(--pt-grid-bg);
  --color-grid-raised: var(--pt-grid-raised);
  --color-grid-rule: var(--pt-grid-rule);
  --color-grid-text: var(--pt-grid-text);
  --color-grid-dim: var(--pt-grid-dim);
  --color-sev-info: var(--pt-sev-info);
  --color-sev-warn: var(--pt-sev-warn);
  --color-sev-err: var(--pt-sev-err);
  --color-sev-ok: var(--pt-sev-ok);

  --font-display: "Fraunces Variable", Georgia, "Times New Roman", serif;
  --font-sans: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", "Roboto Mono", monospace;
}

body {
  font-family: var(--font-sans);
  color: var(--pt-ink);
  background: var(--pt-cream);
}
```

The existing `.inspection-demo`, `.inspection-controls`, `.inspection-sidebar`, `.inspection-grid-shell`, etc. rules are **deleted wholesale** — the component that used them is deleted too.

### JSX usage pattern

```tsx
<section className="bg-cream text-ink px-7 py-16 border-b border-cream-rule">
  <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-amber-ink">
    $ pretable — read-heavy wedge · vol. 1 · no. 4
  </p>
  <h1 className="font-display text-[60px] leading-none tracking-tight mt-3">
    the grid that treats <em className="text-amber-ink">scroll</em> as a first-class feature.
  </h1>
</section>
```

Where the type scale doesn't fit a Tailwind-idiomatic name (display-xl at 60/60, +12% eyebrow tracking, Fraunces 44/46 display-md), use arbitrary values (`text-[60px]`, `tracking-[0.12em]`). The spec's scale is small enough that the added utility-name overhead isn't worth it.

### Grid section palette flip

One wrapping section flips to terminal palette: `<section id="grid" className="bg-grid-bg text-grid-text">`. Tokens handle the rest.

## 5. Section specs

Section-by-section, matching visual-system-design §5.

### 5.1 `<Nav>` (from `@pretable/ui`)

- Render as `<Nav active="playground" version={APP_VERSION} />`.
- Links are owned by `<Nav>` internally (shipped `LINKS` array covers `playground` / `bench` / `docs` / `github`; the github href is already `https://github.com/cacheplane/pretable`). No `NAV_LINKS` prop is needed or accepted today.
- `githubStars` omitted (A doesn't fetch live stars; D's concern).
- `cta` omitted on playground (the shipped `cta` slot is for the docs "Try playground →" button; playground doesn't need a secondary nav CTA).
- `onSearchClick` omitted (search modal is docs-only per visual-system-design §4; direction C).

### 5.2 `<PitchHero />`

- Cream background, 64px top/bottom padding (`py-16`), horizontal padding matching the page gutter.
- Eyebrow: monospace 11px, uppercase, tracking +8–12%, amber-ink.
  - Copy: `$ pretable — read-heavy wedge · vol. 1 · no. 4`
- Headline: Fraunces 400, 60/60, tracking −2.5%, ink.
  - Italic amber emphasis on `scroll` (inside a larger sentence — exact wording per visual-system-design §5; no paraphrasing).
- Dek: Fraunces 400, 18/26, ink-dim. Contains inline `<Receipt>` tags from `@pretable/ui` for numeric call-outs (e.g., `60fps`).
- CTA pair, horizontally adjacent, spaced ~12px:
  - Primary: solid ink button, cream-hi label: `Try the live playground ↓` → `<a href="#grid">`.
  - Ghost monospace: a new **local `<CopyCommand />` helper** in `apps/playground` renders a pill-shaped button showing `$ npm i @pretable/react` that writes the command (without the `$ `) to the clipboard on click, flashing `✓ copied` briefly. Same UX pattern `<CodeBlock>` already uses, inline-button shape instead of block.
- No state (the copy-feedback flash lives inside `<CopyCommand />`).

### 5.3 `<PitchGrid />`

- Full-bleed (ignores page gutter), dark palette (`bg-grid-bg`).
- Wrapping element: `<section id="grid">`.
- Three internal regions stacked vertically:
  1. **Chrome strip** (padding ~12px × 28px, border-bottom `grid-rule`):
     - Left: file-tab-styled label showing current scenario name plus scale selector. Format: `inspection.log · scale: <select>` where `<select>` cycles through `inspectionDatasetScaleOptions` (`tiny` / `dev` / `stress` / etc — whatever the shipped option list contains).
     - Right: telemetry string. Format: `rendered {telemetry.renderedRowCount} · sel {telemetry.selectedRowId ?? "none"}`. Monospace, `grid-dim` color.
  2. **Filter row** (padding ~10px × 28px, border-bottom `grid-rule`, bg `grid-raised`):
     - One filter input per `dataset.filterableColumnIds`, same layout the current `InspectionDemo` uses. Mono 12px.
  3. **Grid itself**: `<InspectionGrid>` with:
     - `viewportHeight={420}` (keeps current demo's value; revisit in implementation if visually too short)
     - `overscan={5}`
     - `interactionState` and `onSelectedRowIdChange` / `onSortChange` wired as in current demo
     - `onTelemetryChange` wired to local state
- Owns `scale`, `interactionState`, `telemetry`. Identical memoization pattern to current `InspectionDemo` (shallow `rows` copy, `selectedRow` derived from `interactionState.selectedRowId`).

### 5.4 `<ReceiptsBand />`

- Cream background, 52px top/bottom padding.
- Section header: Fraunces 32/36, weight 500, tracking −2%. Format: `<em class="text-amber-ink">Receipts</em>, not claims.` (italic amber on `Receipts`).
- 4-column grid (`grid-cols-4`, gap ~24px):
  - Each column: top hairline rule (`border-t border-ink`), then Fraunces 44/46 number, then 12px caption (`text-ink-dim`).
  - Initial values: `{value: "500k", caption: "rows rendered"}`, `{value: "2.4ms", caption: "frame p50"}`, `{value: "0", caption: "jank events"}`, `{value: "4.1×", caption: "vs gridalpha"}`. Replace during implementation with numbers pulled from a real bench run on the local machine; values above are spec placeholders.
- Mono 12px subtext below the grid: link to bench (`See them re-run in the bench →`), href `/bench` (relative — works once domain routing is in place; meanwhile points to the bench app dev URL or a placeholder).
- No state.

### 5.5 `<Footer>` (from `@pretable/ui`)

- `<Footer version={APP_VERSION} ciStatus="green" links={[...]} />`
- `ciStatus` hardcoded `"green"` for A; TODO-comment references the consumer-theming/CI-signal follow-up so we don't silently lie about status.
- `links` are minimal on playground: the `<Nav>` already surfaces `playground` / `bench` / `docs` / `github`. Footer right-side links include only context that isn't in Nav: `MIT license` (links to `LICENSE` file or `https://github.com/cacheplane/pretable/blob/main/LICENSE`) and `Changelog` (placeholder href until docs has one). If in doubt during implementation, ship Footer with `links=[]` — the spec's "one line, CI status visible" target is already met by the component's default layout.

### 5.6 Version plumbing

`APP_VERSION` sourced from Vite's `define` config reading `package.json`:

```ts
// vite.config.ts
import pkg from "./package.json" with { type: "json" };
export default defineConfig({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version) },
  plugins: [react(), tailwindcss()],
});
```

Then `const APP_VERSION = import.meta.env.VITE_APP_VERSION as string;`. No runtime `fetch` of `package.json`, no hardcoded string.

## 6. Data flow

```
<App>
  └ <PitchGrid>
      ├ useState<scale>               → inspection dataset re-derived
      ├ useState<interactionState>    → filters + selection
      ├ useState<telemetry>           → drives chrome strip right side
      └ <InspectionGrid>
          ├ onTelemetryChange         → setTelemetry
          ├ onSelectedRowIdChange     → updates interactionState
          └ onSortChange              → updates interactionState
```

No state crosses component boundaries upward. No global listeners. No router.

## 7. Testing plan

Unit tests (vitest + jsdom) under `apps/playground/src/__tests__/`:

- **`pitch-hero.test.tsx`** — renders eyebrow, headline, dek, two CTAs; CTA 1 has `href="#grid"`; CTA 2 presents the `npm i @pretable/react` string and is actuated by a copy button.
- **`receipts-band.test.tsx`** — renders four stats in the expected order with the currently-hardcoded values and captions; the "See them re-run in the bench →" anchor has a non-empty href.
- **`pitch-grid.test.tsx`** — renders the chrome strip (scale select + formatted telemetry), filter row, and an `InspectionGrid`. Changing the scale select re-invokes `createInspectionDataset` with the new scale (assert via dataset row-count change). Telemetry callback updates the `rendered N` text.
- **`app.test.tsx`** — `<App>` renders sections in order: Nav, then hero, grid, receipts band in `<main>`, then Footer.

Accessibility assertions inlined into the tests above:
- Single `<main>` landmark.
- Heading order: one `<h1>` (hero), one `<h2>` (receipts), no skipped levels.
- Grid section has `id="grid"` so hero CTA anchor resolves.

Not tested:
- Visual fidelity (no screenshot/Percy)
- `InspectionGrid` behavior (covered upstream in `@pretable/react`)
- Tailwind output (compile-time)
- Font loading (trust `@fontsource-variable/fraunces`)

Manual verification before opening the PR:
- `pnpm dev:playground` → page loads; all five sections visible.
- Tab through: sensible focus order; CTA 1 scrolls to `#grid`.
- Change scale → dataset + `rendered N` update.
- Select a row → amber highlight; `sel <id>` updates.
- Resize to mobile → hero reflows; receipts band stacks; grid keeps internal scroll.

CI acceptance: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`, `pnpm build` all green. No new warnings in touched files.

## 8. Out of scope / related follow-ups

**Out of scope for A (owned by D or later):**
- Live / dynamic receipts band numbers — A hardcodes a snapshot, D wires a source.
- `frame p50` telemetry instrumentation — would require changes inside `@pretable/react`. Separate PR.
- Final copy voice / real GitHub star fetch / OG meta tags / favicon refresh.
- Mobile-first polish beyond "readable."
- Dark-mode toggle (visual-system-design §9 explicitly cuts from v1).

**Follow-ups surfaced during brainstorming:**
- **`<Nav>` link customization** — today's shipped `<Nav>` owns `LINKS` at module scope. A doesn't need customization, but once we have more surfaces (C's docs, maybe a changelog page) a consumer likely wants to pass in links. Don't address during A; revisit as a dedicated `@pretable/ui` PR when the second consumer of `<Nav>` actually needs it.
- **`<CodeBlock>` inline/button variant** — if a future page wants a compact copyable command in the same visual family as the hero CTA, either extract the pill from `<CopyCommand />` into `@pretable/ui` or add a `variant="inline"` to `<CodeBlock>`. Not A's problem; local helper ships.
- **Dev-tool "selected event" sidebar** — deleted with `<InspectionDemo />`. Not restored. If later needed for internal grid debugging, rebuild against the shared primitive rather than resurrect the old file.
- **Footer `ciStatus` source** — hardcoded `"green"` in A. Real wiring (to CI-run JSON or a status endpoint) is D's concern.

**Out of scope for the whole A→D arc, flagged separately:**
- **Consumer theming architecture for `@pretable/*`.** The broader story for how external consumers override tokens, handle dark mode, interact with `@pretable/react` grid styles, and compose (or not) with `@pretable/ui` is an open design question. Current token model (global CSS custom properties under `:root`) works for internal surfaces but has no documented override story. Needs its own brainstorm → spec → plan before external consumers depend on it. Recorded in memory and here so it doesn't get lost.

## 9. Rollback

A is a single-branch, single-squash-merge unit scoped to `apps/playground` plus one workspace dep addition.

- **After ship:** `git revert` the squash commit restores the bare `<InspectionDemo />` landing. No migration.
- **Before ship:** `git branch -D feat/website-surfaces` — the worktree is expendable.

No data migrations, no external config changes, no effect on `@pretable/*` packages.

## 10. Risks

| Risk                                                   | Mitigation                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tailwind v4 is new tooling in the repo                 | Isolated to `apps/playground`; no package code affected; CI jobs catch build-config misfire before merge.                                                                             |
| `@theme inline` map drifts from `@pretable/ui` tokens  | Small risk in A; we mirror the current set. Future added tokens pulled in via deliberate PRs. C/D can revisit if it becomes painful (e.g., a shared utility or code-gen from tokens). |
| Fraunces weight/italic not preloaded → first-paint CLS | `font-display: swap` + serif fallback (`Georgia`). If CLS observable in manual verification, add preload hints for the two weights used.                                              |
| `<CodeBlock>` variant uncertainty                      | Decided at implementation time; the fallback (local helper) is cheap.                                                                                                                 |
| Receipts band numbers drift between A ship and D land  | D's job. A accepts the snapshot may be stale by the time D touches it.                                                                                                                |

## 11. Success criteria

A is successful if:
1. `apps/playground` renders the five-section pitch landing per visual-system-design §5 on `pnpm dev:playground`.
2. The grid section is full-bleed, terminal-dark, and shows real telemetry (`rendered N · sel <id>`) driven by `InspectionGrid`.
3. The receipts band shows four real numbers sourced from a bench run done during implementation, with captions that describe what they measure.
4. CTA 1 scroll-anchors to the grid section.
5. `InspectionDemo.tsx` and its associated `app.css` rules are deleted from the tree.
6. CI green across test, typecheck, lint, format, build.
7. Manual verification passes at desktop and at a mobile viewport (readable, not broken).

---

**End of spec.** Implementation plan follows via `superpowers:writing-plans` after user approval.
