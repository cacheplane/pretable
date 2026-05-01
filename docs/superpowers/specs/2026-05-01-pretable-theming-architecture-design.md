# Pretable Theming Architecture Design

> **Date:** 2026-05-01
> **Status:** Design — awaiting implementation plan
> **Scope:** Public theming architecture for `@pretable/ui` v0.0.1+
> **Related:** Supersedes `docs/superpowers/specs/2026-04-21-pretable-visual-system-design.md` for theming concerns

## Goal

Ship a public theming package (`@pretable/ui`) that lets consumers apply a coherent look-and-feel to the Pretable React grid — covering the table itself plus its immediate UI surroundings (toolbar, status bar, tooltip, popover, etc.) — without forking, without learning a JS theme builder, and without inheriting the cool-slate AI-startup palette currently baked into the monorepo.

The default theme is **Excel-like** — gray, technical, dense. A second prebuilt theme is **Material 3** — light + dark, ready to drop in. Consumers override individual tokens via cascade (Tailwind v4 spirit). Density (compact / standard / spacious) is runtime-switchable via a single attribute toggle.

## Audience

External React developers adopting `@pretable/react` for their app. They use vanilla CSS, Tailwind v4, or CSS-in-JS. They expect themes to be CSS files — not JS configuration.

## Why now

Today's `@pretable/ui` is internal — it ships marketing components (Receipt, Callout, CodeBlock, Nav, Footer) plus the cool-slate brand tokens used by `apps/website` and `apps/bench`. It is `private: true` and has never been published. Before any external consumer adopts the React grid, we need a deliberate theming surface that doesn't paint their app in cool-slate AI-startup colors.

The rename frees the `@pretable/ui` package name for the public theming layer. Internal-only marketing components move into `apps/website` (and a small duplicate into `apps/bench`).

---

## Decisions log

These decisions were settled during the brainstorming phase and inform the entire design.

| # | Decision | Rationale |
|---|---|---|
| **D1** | Move current `@pretable/ui` code (Receipt, Callout, CodeBlock + cool-slate `tokens.css`/`components.css`) to `apps/website/app/components/` and `apps/website/app/styles/`. **Duplicate** Nav and Footer into both `apps/website/app/components/` and `apps/bench/src/components/` (each app owns its chrome going forward). Delete `packages/ui/` and recreate as the new public theming package. | The existing components are website chrome, not data-grid theming surface. Both `apps/website` and `apps/bench` use Nav/Footer; duplicating two simple components is cheaper than maintaining a shared internal package, and lets each app's nav diverge naturally. |
| **D2** | Pure CSS variables as the theming substrate. Ship one CSS file per theme. Ship an opt-in `tailwind.css` bridge file with a `@theme inline` block aliasing tokens to Tailwind v4 utility shortcuts. No JS theme builder. | "Tailwind v4 spirit" — CSS-first, override by redefining variables, themes are just CSS files. Consumer DX is `@import` and forget. |
| **D3** | Theming surface = grid + immediate surroundings. Tokens cover header row, body cells, gridlines, row striping, selection, hover, focus, sort indicator, resize handles, scrollbars, toolbar, pagination/status bar, empty/loading/error states, container border + radius, tooltip, column menu, filter popover, density (row height, header height, cell padding, font size). Page background, body text, headings, syntax highlighting, and other page-chrome tokens are explicitly out of scope. | Stops short of being a full design system. The cool-slate-pivot pain came from claiming page-level brand decisions on every consumer's behalf; we don't repeat that. |
| **D4** | Light/dark via `[data-theme="dark"]` attribute selector on `<html>`. Combined-file model — light at `:root`, dark overrides at `[data-theme="dark"]` inside the same theme CSS file. Consumer toggles the attribute to switch. | Composes with React state; matches shadcn/Radix convention that consumers will already know; the attribute (vs class) is less likely to collide with consumer's existing utility classes. |
| **D5** | Density via `[data-density]` attribute. Three tiers: **compact**, **standard**, **spacious**. Density values are coupled to theme — each theme file defines its own three density tiers, so Excel-compact and Material-compact have different row heights, preserving each theme's identity. `:root` value in each theme file is the theme's natural default (Excel = compact, Material = standard). | Composes with `[data-theme]` independently. Each theme's identity is preserved at every tier — Excel-compact stays tighter than Material-compact, which is honest to each theme's design language. |
| **D6** | `@pretable/react` becomes structurally pure: `packages/react/src/internal/styles.ts` is stripped to layout-only inline styles (position, top/left/width/height, z-index, sticky, overflow, contain, box-sizing). No colors, no border-radius, no fonts, no padding amounts. `@pretable/ui` ships `grid.css` targeting the existing `[data-pretable-*]` data-attribute selector contract. | Headless engine + skin package pattern. The current inline-RGBA values in `styles.ts` are dead code (apps always override them) — this cleanup formalizes what reality already is. |
| **D7** | Engine internalizes a CSS-variable bridge for `--pretable-row-height` and `--pretable-header-height` (~30 LOC, `useSyncExternalStore` + `MutationObserver`). Default DX: `<PretableGrid rows={…} columns={…} />` with no extra props or hooks. Numeric props win when passed. Drop `--pt-*` namespace; use `--pretable-*` throughout — single namespace owned by `@pretable/react`'s public contract, parallel to `[data-pretable-*]` data attributes. `@pretable/ui` JS surface trimmed to one export: `getDensityHeights()` snapshot. React hook deferred. | The verbose-prop-threading DX of an external hook was unacceptable. Engine reads two named CSS variables; that's a normal extension of its API alongside its data-attribute contract. Third-party theme packages can plug in by writing the same variable namespace. |
| **D8** | Pre-1.0 phase, no version graduation. The 0.0.x patch series continues indefinitely (`0.0.1` → `0.0.2` → …). Each patch release can rename or remove tokens freely. CHANGELOG entries describe each release's deltas. No formal stability promise. | We're iterating; we don't yet know what should be stable. Locking a contract early would force us into deprecation aliases for cleanups we haven't earned the right to lock. |
| **D9** | Token contract smoke test in vitest + jsdom asserts (a) every documented `--pretable-*` token resolves to a non-empty value when each theme CSS is loaded, (b) all density tiers resolve, (c) Material's dark mode overrides change at least one color, (d) no `var(--pretable-*)` reference inside `grid.css` is unresolved. Visual regression deferred. | Catches the most common class of theming bug (forgot to define a token); cheap, fast, ships on day one. Visual regression awaits a stable reference scene and a non-internal consumer. |

---

## Architecture

### Two packages, one-way dependency

**`@pretable/react`** (existing engine, modified): structurally pure. Inline styles in `packages/react/src/internal/styles.ts` are stripped to layout primitives only. The engine's public API gains:
- A CSS-variable bridge inside the grid component (~30 LOC) reading `--pretable-row-height` and `--pretable-header-height` from `<html>` via `useSyncExternalStore` + `MutationObserver`, with prop overrides winning when passed.
- Documentation that those two CSS variable names are part of the engine's public contract, alongside the existing `[data-pretable-*]` data attributes.

**`@pretable/ui`** (new public theming package, takes over the freed name): ships
- Theme CSS files: `themes/excel.css`, `themes/material.css`
- Grid skin: `grid.css` (selectors target `[data-pretable-*]` attributes; values reference `var(--pretable-*)` tokens)
- Opt-in Tailwind v4 bridge: `tailwind.css`
- One JS export: `getDensityHeights()` — synchronous snapshot for tests, non-React consumers, power users

Pure CSS substrate with a thin JS shim. No `<PretableThemeProvider>`. No React hooks in v0.0.x.

### Namespace

Single namespace `--pretable-*` everywhere — parallel to the existing `[data-pretable-*]` data-attribute convention. The engine reads from this namespace (just two variables: `--pretable-row-height`, `--pretable-header-height`). The theme files write to this namespace (~24 tokens at `:root` plus density-tier overrides). The grid skin references this namespace.

No `--pt-*` shorthand exists in the new package. (`apps/website` retains `--pt-*` for its local cool-slate marketing chrome — that namespace is local to the website, not part of the public theming package.)

### One-way dependency

| Direction | What flows |
|---|---|
| `@pretable/ui` → `@pretable/react` | nothing imported; `@pretable/ui` references the engine's public contracts (data attributes + CSS variable names) |
| `@pretable/react` → `@pretable/ui` | nothing — the engine doesn't know `@pretable/ui` exists |

A third-party theming package (`@brand-co/pretable-theme-acme`, hypothetical) can ship by writing to the same `--pretable-*` namespace and targeting the same data-attribute selectors. No engine fork, no special integration. The theming layer is genuinely pluggable.

---

## Token contract (v0.0.1)

The v0.0.1 token contract is intentionally lean — 24 tokens covering the table + immediate surroundings (per D3). The 0.0.x patch series lets us add or rename freely; we ship MVP and grow as real consumer needs surface.

| Token | What it controls | Engine reads? |
|---|---|---|
| **Surfaces** | | |
| `--pretable-bg-grid` | Body cell background | — |
| `--pretable-bg-grid-alt` | Alternate (zebra) row background; can equal `--pretable-bg-grid` for no striping | — |
| `--pretable-bg-header` | Header row background; pinned cells reuse this | — |
| `--pretable-bg-toolbar` | Toolbar + status/pagination bar background | — |
| `--pretable-bg-tooltip` | Tooltip / column menu / filter popover background | — |
| **Text** | | |
| `--pretable-text-cell` | Body cell text color | — |
| `--pretable-text-header` | Header text color | — |
| `--pretable-text-dim` | Secondary text (toolbar labels, empty-state body, status text) | — |
| **Lines** | | |
| `--pretable-rule` | Gridline color (between cells) | — |
| `--pretable-rule-strong` | Container outer edge + header bottom border | — |
| `--pretable-radius` | Container border radius | — |
| **State** | | |
| `--pretable-bg-hover` | Row hover background (set to `transparent` in Excel) | — |
| `--pretable-bg-selected` | Selected cell/row background | — |
| `--pretable-text-selected` | Selected cell/row text color | — |
| `--pretable-focus-ring` | Focus outline color (cell focus, kbd nav) | — |
| **Accent** | | |
| `--pretable-accent` | Sort indicator, active filter tag, focus highlights, drag indicators | — |
| **Density** | | |
| `--pretable-row-height` | Body row height in px | **yes** |
| `--pretable-header-height` | Header row height in px | **yes** |
| `--pretable-cell-padding-x` | Body cell horizontal padding | — |
| `--pretable-cell-padding-y` | Body cell vertical padding | — |
| `--pretable-font-size-cell` | Body cell font size | — |
| `--pretable-font-size-header` | Header font size | — |
| **Typography** | | |
| `--pretable-font-sans` | Primary sans-serif family stack | — |
| `--pretable-font-mono` | Monospace family stack (numeric cells, code) | — |

**24 tokens. Engine reads 2. Grid CSS references all 24.**

### Deliberately deferred to 0.0.2+

- **Severity tokens** (`--pretable-sev-info/warn/err/ok`) — useful for status cells; deferred until a real consumer asks.
- **Scrollbar tokens** (`--pretable-scrollbar-thumb/track`) — deferred; browser support uneven.
- **Pinned-cell distinction** (`--pretable-bg-pinned`) — currently reuses `--pretable-bg-header`.
- **Resize-handle / drag-indicator** tokens — currently reuse `--pretable-accent`.
- **Box-shadow / elevation** tokens — Material wants elevation; deferred until Material proves it needs them. Likely the first 0.0.x addition.
- **Frozen-pane heavy divider** (`--pretable-rule-frozen`) — Excel feature; defer until pretable supports frozen panes.

### Stability note

In the 0.0.x series, every token is experimental. Any of these names can be renamed or removed in any patch release. CHANGELOG entries describe each release's token changes. We do not promise external override stability.

The token contract smoke test (D9) lives in `packages/ui/src/__tests__/contract.test.ts` and asserts every token in this list resolves to a non-empty `var(...)` in each theme file.

---

## Theme files

Concrete values are research-informed (see Appendix A). Sources cited inline.

### `themes/excel.css` (default theme, light-only)

```css
/**
 * Excel — gray, technical, dense.
 * Aptos Narrow at 11pt (15px), green active-cell border, no row hover.
 * Light-only by design. Default density: compact.
 *
 * Override any token at :root or a more specific scope:
 *   :root { --pretable-accent: hotpink; }
 */

:root {
  /* Surfaces */
  --pretable-bg-grid: #ffffff;
  --pretable-bg-grid-alt: #ffffff;        /* No striping by default — Excel doesn't band */
  --pretable-bg-header: #f3f3f3;          /* Excel-for-web header strip */
  --pretable-bg-toolbar: #f3f3f3;
  --pretable-bg-tooltip: #ffffff;

  /* Text */
  --pretable-text-cell: #1f1f1f;
  --pretable-text-header: #5c5c5c;        /* Softer than body; Excel chrome convention */
  --pretable-text-dim: #5c5c5c;

  /* Lines */
  --pretable-rule: #d4d4d4;               /* Excel desktop default RGB 211,211,211 ≈ #D3D3D3 */
  --pretable-rule-strong: #a6a6a6;
  --pretable-radius: 0;                   /* Sharp edges — Excel never rounds */

  /* State */
  --pretable-bg-hover: transparent;       /* No row hover — iconic Excel; consumers opt in */
  --pretable-bg-selected: rgba(16, 124, 65, 0.10);  /* Excel green range tint */
  --pretable-text-selected: #1f1f1f;      /* Don't invert selection text */
  --pretable-focus-ring: #107c41;         /* Excel app brand green active-cell border */

  /* Accent */
  --pretable-accent: #107c41;             /* Excel brand green */

  /* Density — natural default = compact (Excel "Compact" tier) */
  --pretable-row-height: 20px;            /* 15pt at 96 DPI */
  --pretable-header-height: 24px;
  --pretable-cell-padding-x: 6px;
  --pretable-cell-padding-y: 2px;
  --pretable-font-size-cell: 15px;        /* Aptos Narrow 11pt */
  --pretable-font-size-header: 13px;

  /* Typography */
  --pretable-font-sans: "Aptos Narrow", "Aptos", "Segoe UI",
    -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  --pretable-font-mono: ui-monospace, "Cascadia Mono", "SF Mono",
    Consolas, monospace;
}

/* :root is already compact; only non-default tiers need explicit selectors. */

[data-density="standard"] {
  --pretable-row-height: 24px;
  --pretable-header-height: 32px;
  --pretable-cell-padding-x: 8px;
  --pretable-cell-padding-y: 4px;
  --pretable-font-size-cell: 15px;
  --pretable-font-size-header: 14px;
}

[data-density="spacious"] {
  --pretable-row-height: 32px;
  --pretable-header-height: 40px;
  --pretable-cell-padding-x: 12px;
  --pretable-cell-padding-y: 8px;
  --pretable-font-size-cell: 15px;
  --pretable-font-size-header: 14px;
}
```

### `themes/material.css` (Material 3 light + dark)

```css
/**
 * Material 3 — baseline scheme (seed #6750A4).
 * Light at :root; dark at [data-theme="dark"]. Default density: standard.
 * Surface tier: light grid uses `surface`; dark grid uses `surface-container-low`
 * (raw `surface` reads as a void in dark mode per M3 guidance).
 */

:root {
  /* Surfaces — M3 baseline light */
  --pretable-bg-grid: #fef7ff;          /* surface */
  --pretable-bg-grid-alt: #fef7ff;      /* No striping by default — Material list pattern */
  --pretable-bg-header: #f3edf7;        /* surface-container — one tonal step up */
  --pretable-bg-toolbar: #f3edf7;
  --pretable-bg-tooltip: #f3edf7;

  /* Text */
  --pretable-text-cell: #1d1b20;        /* on-surface */
  --pretable-text-header: #49454f;      /* on-surface-variant */
  --pretable-text-dim: #49454f;

  /* Lines */
  --pretable-rule: #cac4d0;             /* outline-variant — decorative dividers */
  --pretable-rule-strong: #79747e;      /* outline */
  --pretable-radius: 12px;              /* M3 medium shape scale (matches Card) */

  /* State */
  --pretable-bg-hover: rgba(29, 27, 32, 0.08);   /* on-surface @ 8% — M3 hover state layer */
  --pretable-bg-selected: #e8def8;               /* secondary-container */
  --pretable-text-selected: #1d192b;             /* on-secondary-container */
  --pretable-focus-ring: #6750a4;                /* primary */

  /* Accent */
  --pretable-accent: #6750a4;                    /* primary */

  /* Density — natural default = standard */
  --pretable-row-height: 48px;                   /* 12 × 4dp grid */
  --pretable-header-height: 52px;
  --pretable-cell-padding-x: 16px;
  --pretable-cell-padding-y: 12px;
  --pretable-font-size-cell: 14px;               /* body-medium */
  --pretable-font-size-header: 14px;             /* label-large (px equal; weight differs in grid.css) */

  /* Typography */
  --pretable-font-sans: "Roboto Flex", "Roboto", system-ui,
    -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --pretable-font-mono: "Roboto Mono", ui-monospace, monospace;
}

/* :root is already standard; only non-default tiers need explicit selectors. */

[data-density="compact"] {
  --pretable-row-height: 40px;
  --pretable-header-height: 44px;
  --pretable-cell-padding-x: 12px;
  --pretable-cell-padding-y: 6px;
  --pretable-font-size-cell: 12px;     /* body-small */
  --pretable-font-size-header: 12px;
}

[data-density="spacious"] {
  --pretable-row-height: 56px;
  --pretable-header-height: 64px;
  --pretable-cell-padding-x: 24px;
  --pretable-cell-padding-y: 16px;
  --pretable-font-size-cell: 14px;
  --pretable-font-size-header: 14px;
}

/* Dark mode — M3 baseline dark; color-only overrides; density inherits from light. */

[data-theme="dark"] {
  --pretable-bg-grid: #1d1b20;          /* surface-container-low */
  --pretable-bg-grid-alt: #1d1b20;
  --pretable-bg-header: #211f26;        /* surface-container */
  --pretable-bg-toolbar: #211f26;
  --pretable-bg-tooltip: #211f26;

  --pretable-text-cell: #e6e0e9;        /* on-surface (dark) */
  --pretable-text-header: #cac4d0;      /* on-surface-variant (dark) */
  --pretable-text-dim: #cac4d0;

  --pretable-rule: #49454f;             /* outline-variant (dark) */
  --pretable-rule-strong: #938f99;      /* outline (dark) */

  --pretable-bg-hover: rgba(230, 224, 233, 0.08);  /* on-surface @ 8% — dark */
  --pretable-bg-selected: #4a4458;                 /* secondary-container (dark) */
  --pretable-text-selected: #e8def8;               /* on-secondary-container (dark) */
  --pretable-focus-ring: #d0bcff;                  /* primary (dark) */

  --pretable-accent: #d0bcff;
}
```

### Density-variant deduplication trick

Each theme's natural-default density values live at `:root`. Only the *non-default* density tiers need explicit `[data-density="…"]` selectors. When the consumer sets `data-density="<the-natural-default>"` on a page, no rule matches that selector and the `:root` values stay in effect. When they remove the attribute, the explicit-tier selector unmatches and `:root` reasserts. CSS handles all of it through normal cascade dynamics. This saves ~6 lines per theme and avoids the "density values listed twice" trap.

### How the cascade resolves (worked example)

Consumer uses Material with dark + spacious at runtime:

```html
<html data-theme="dark" data-density="spacious">
```

Cascade for `--pretable-row-height`:
1. `:root` defines `48px` (Material standard)
2. `[data-density="spacious"]` matches → `56px` wins (more specific selector)
3. `[data-theme="dark"]` doesn't redefine row height → `56px` stands
4. Engine's `useResolvedHeights` reads `56`, virtualizer uses it.

Cascade for `--pretable-bg-grid`:
1. `:root` defines `#fef7ff`
2. `[data-density="spacious"]` doesn't define bg-grid → `#fef7ff` stands
3. `[data-theme="dark"]` redefines as `#1d1b20` → wins
4. `grid.css` resolves `var(--pretable-bg-grid)` to `#1d1b20`.

All four axes (theme file × density variant × dark mode × consumer override at `:root`) compose through normal CSS specificity. No build step. No JS coordination.

---

## Engine integration

### `packages/react/src/internal/density.ts` (new file)

```ts
import { useSyncExternalStore } from "react";

const FALLBACK_ROW_HEIGHT = 32;
const FALLBACK_HEADER_HEIGHT = 36;

function readVar(name: string, fallback: number): number {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name);
  const match = value.trim().match(/^([\d.]+)px$/);
  return match ? parseFloat(match[1]) : fallback;
}

function subscribe(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-density", "data-theme", "class", "style"],
  });
  return () => observer.disconnect();
}

export function useResolvedHeights(
  rowHeightProp?: number,
  headerHeightProp?: number,
): { rowHeight: number; headerHeight: number } {
  return useSyncExternalStore(
    subscribe,
    () => ({
      rowHeight:
        rowHeightProp ?? readVar("--pretable-row-height", FALLBACK_ROW_HEIGHT),
      headerHeight:
        headerHeightProp ?? readVar("--pretable-header-height", FALLBACK_HEADER_HEIGHT),
    }),
    () => ({
      rowHeight: rowHeightProp ?? FALLBACK_ROW_HEIGHT,
      headerHeight: headerHeightProp ?? FALLBACK_HEADER_HEIGHT,
    }),
  );
}
```

### `packages/react/src/internal/styles.ts` skin strip

Illustrative diff (the actual edit may touch more functions; the pattern is "remove all colors, padding, border-radius; keep positioning"):

```diff
 export function getViewportStyle(): CSSProperties {
   return {
-    height: 460,
     overflow: "auto",
     position: "relative",
-    border: "1px solid rgba(255, 255, 255, 0.08)",
-    borderRadius: 16,
   };
 }

 export function getHeaderRowStyle(): CSSProperties {
   return {
     position: "sticky",
     top: 0,
     zIndex: 3,
-    background: "rgba(18, 18, 18, 0.94)",
-    borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
-    backdropFilter: "blur(8px)",
   };
 }

 export function getRowStyle(top: number, height: number): CSSProperties {
   return {
     position: "absolute",
     top,
     height,
     left: 0,
     right: 0,
-    borderBottom: "1px solid rgba(255, 255, 255, 0.06)",
   };
 }

 export function getCellStyle(left: number, width: number): CSSProperties {
   return {
     position: "absolute",
     left,
     width,
     boxSizing: "border-box",
     height: "100%",
-    padding: "0 12px",
   };
 }

 export function getPinnedCellStyle(side: "left" | "right", offset: number): CSSProperties {
   return {
     position: "sticky",
     [side]: offset,
     zIndex: 2,
-    background: "rgba(18, 18, 18, 0.96)",
   };
 }
```

The hardcoded viewport `height: 460` is also gone — that was a demo-grid leak. Container height now comes from the consumer's container CSS or the grid's `style` prop.

### `packages/ui/grid.css` (sketch)

The exact data-attribute and class-name selectors are reconciled with what `@pretable/react` actually exposes during plan-writing — see "Plan-time reconciliation" below.

```css
/**
 * @pretable/ui/grid.css
 * Selector-based grid skin. Targets data attributes exposed by @pretable/react;
 * values reference --pretable-* tokens defined by theme files.
 */

/* Outer viewport (scrollable container) */
[data-pretable-scroll-viewport] {
  background: var(--pretable-bg-grid);
  border: 1px solid var(--pretable-rule-strong);
  border-radius: var(--pretable-radius);
  font-family: var(--pretable-font-sans);
  color: var(--pretable-text-cell);
}

/* Header row */
[data-pretable-header-row] {
  background: var(--pretable-bg-header);
  border-bottom: 1px solid var(--pretable-rule-strong);
  height: var(--pretable-header-height);
}

[data-pretable-header-cell] {
  display: flex;
  align-items: center;
  padding: 0 var(--pretable-cell-padding-x);
  font-size: var(--pretable-font-size-header);
  font-weight: 500;
  color: var(--pretable-text-header);
  border-right: 1px solid var(--pretable-rule);
  box-sizing: border-box;
}

[data-pretable-header-cell]:last-of-type {
  border-right: none;
}

/* Body cells */
[data-pretable-cell] {
  display: flex;
  align-items: center;
  box-sizing: border-box;
  padding: var(--pretable-cell-padding-y) var(--pretable-cell-padding-x);
  font-size: var(--pretable-font-size-cell);
  color: var(--pretable-text-cell);
  background: var(--pretable-bg-grid);
  border-right: 1px solid var(--pretable-rule);
  border-bottom: 1px solid var(--pretable-rule);
}

[data-pretable-cell]:last-of-type {
  border-right: none;
}

/* Zebra striping — only effective when --pretable-bg-grid-alt differs */
[data-pretable-row]:nth-child(even) [data-pretable-cell] {
  background: var(--pretable-bg-grid-alt);
}

/* Hover */
[data-pretable-row]:hover [data-pretable-cell] {
  background: var(--pretable-bg-hover);
}

/* Pinned cells (sticky left/right) — reuse header background */
[data-pretable-cell][data-pinned="left"],
[data-pretable-cell][data-pinned="right"] {
  background: var(--pretable-bg-header);
  z-index: 1;
}

/* Selection */
[data-pretable-cell][data-selected="true"] {
  background: var(--pretable-bg-selected);
  color: var(--pretable-text-selected);
}

/* Focus */
[data-pretable-cell][data-focused="true"] {
  outline: 2px solid var(--pretable-focus-ring);
  outline-offset: -2px;
}

/* Numeric cells (opt-in via [data-pretable-numeric="true"]) */
[data-pretable-cell][data-pretable-numeric="true"] {
  font-family: var(--pretable-font-mono);
  text-align: right;
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

/* Toolbar / status bar — applied if engine wraps in named data attribute */
[data-pretable-toolbar],
[data-pretable-status-bar] {
  background: var(--pretable-bg-toolbar);
  color: var(--pretable-text-dim);
  font-family: var(--pretable-font-sans);
  font-size: var(--pretable-font-size-cell);
}

/* Tooltip / popover */
[data-pretable-popover] {
  background: var(--pretable-bg-tooltip);
  color: var(--pretable-text-cell);
  border: 1px solid var(--pretable-rule);
  border-radius: var(--pretable-radius);
}
```

### Plan-time reconciliation list

The sketch references some selectors I'm guessing at. The implementation plan must verify and reconcile:

- `[data-pretable-header-row]`, `[data-pretable-header-cell]` — confirm these attributes exist on what `@pretable/react` actually renders; if not, add them in a small engine PR.
- `[data-pretable-toolbar]`, `[data-pretable-status-bar]`, `[data-pretable-popover]` — likely don't exist yet; add as engine grows toolbar/popover features, or defer those grid.css rules to a later 0.0.x.
- `[data-pretable-numeric="true"]` — depends on whether the column-config API lets a column declare itself numeric; if not, this rule waits.

Plan-time decision per attribute: (a) add to engine in this plan, or (b) defer the corresponding grid.css rule to a follow-up patch release.

### How a single visual change flows end-to-end

Consumer sets `data-density="spacious"` on `<html>`:

1. CSS cascade re-applies. `[data-density="spacious"]` rules in the active theme file win for density tokens.
2. `MutationObserver` inside `useResolvedHeights` fires.
3. `useSyncExternalStore` calls the snapshot function — reads new computed values — returns `{ rowHeight: <new>, headerHeight: <new> }`.
4. React re-renders the grid component.
5. Virtualizer math uses the new `rowHeight` to compute `top` for each row; row inline `style={{height: <new>}}` updates.
6. Pure CSS handles cell padding, font-size, header height growth.

End-to-end: one attribute toggle, two CSS-variable reads in JS, full visual update.

---

## Tailwind v4 bridge

`@pretable/ui/tailwind.css` is **opt-in**. Consumers who don't use Tailwind never import it.

```css
/**
 * @pretable/ui/tailwind.css
 * Opt-in Tailwind v4 bridge. Aliases --pretable-* tokens to --color-* / --font-*
 * shortcuts under the `pt-` prefix to avoid collisions with consumer's colors.
 */

@theme inline {
  /* Surfaces */
  --color-pt-bg-grid: var(--pretable-bg-grid);
  --color-pt-bg-grid-alt: var(--pretable-bg-grid-alt);
  --color-pt-bg-header: var(--pretable-bg-header);
  --color-pt-bg-toolbar: var(--pretable-bg-toolbar);
  --color-pt-bg-tooltip: var(--pretable-bg-tooltip);

  /* Text */
  --color-pt-text-cell: var(--pretable-text-cell);
  --color-pt-text-header: var(--pretable-text-header);
  --color-pt-text-dim: var(--pretable-text-dim);

  /* Lines */
  --color-pt-rule: var(--pretable-rule);
  --color-pt-rule-strong: var(--pretable-rule-strong);

  /* State */
  --color-pt-bg-hover: var(--pretable-bg-hover);
  --color-pt-bg-selected: var(--pretable-bg-selected);
  --color-pt-text-selected: var(--pretable-text-selected);
  --color-pt-focus-ring: var(--pretable-focus-ring);

  /* Accent */
  --color-pt-accent: var(--pretable-accent);

  /* Typography */
  --font-pt-sans: var(--pretable-font-sans);
  --font-pt-mono: var(--pretable-font-mono);
}
```

Generates utilities: `bg-pt-bg-grid`, `text-pt-text-cell`, `border-pt-rule`, `text-pt-accent`, `font-pt-mono`.

---

## Consumer integration recipes

### Recipe 1 — vanilla CSS, drop-in

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";
```

```tsx
<PretableGrid rows={rows} columns={columns} />
```

### Recipe 2 — override individual tokens

```css
@import "@pretable/ui/themes/excel.css";
@import "@pretable/ui/grid.css";

:root {
  --pretable-accent: #ff5722;
  --pretable-rule: #cccccc;
}
```

### Recipe 3 — Material with runtime light/dark

```css
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";
```

```tsx
function App() {
  const [mode, setMode] = useState<"light" | "dark">("light");
  useEffect(() => {
    document.documentElement.dataset.theme = mode === "dark" ? "dark" : "";
  }, [mode]);
  // …
}
```

OS-respect variant: derive `mode` from `matchMedia('(prefers-color-scheme: dark)')`.

### Recipe 4 — Tailwind v4

```css
@import "tailwindcss";
@import "@pretable/ui/themes/material.css";
@import "@pretable/ui/grid.css";
@import "@pretable/ui/tailwind.css";
```

```tsx
<aside className="bg-pt-bg-toolbar text-pt-text-dim p-4 border-b border-pt-rule">
  <p className="font-pt-mono text-pt-accent">Filter active</p>
</aside>
```

### Recipe 5 — CSS-in-JS

```tsx
const Toolbar = styled.div`
  background: var(--pretable-bg-toolbar);
  color: var(--pretable-text-dim);
  border-bottom: 1px solid var(--pretable-rule);
`;
```

CSS custom properties work in any CSS-emitting tool because they're a runtime feature.

### Recipe 6 — read density values in JS

```tsx
import { getDensityHeights } from "@pretable/ui";

const { rowHeight, headerHeight } = getDensityHeights();
const visibleRows = Math.floor(viewportHeight / rowHeight);
```

For tests, custom virtualizers, vanilla-JS consumers, pagination math.

---

## Internal-app migration

### `apps/website`

The current `apps/website/app/globals.css` (192 lines) does three things, only one of which moves:

| Block | Current | Migration |
|---|---|---|
| `@import "@pretable/ui/tokens.css"` (cool-slate brand) | from old `@pretable/ui` | → `@import "./styles/cool-slate-tokens.css"` (local) |
| `@import "@pretable/ui/components.css"` (marketing chrome) | from old `@pretable/ui` | → `@import "./styles/marketing-components.css"` (local) |
| `@theme inline` block (21 `--pt-*` → `--color-*` aliases) | works as-is | **stays unchanged** — `--pt-*` is the website's local namespace; doesn't collide with `--pretable-*` |
| `#grid [data-pretable-scroll-viewport]` etc. (~110 lines) | hand-rolled grid skin | → **deleted entirely**; replaced by `@import "@pretable/ui/themes/material.css"` + `@import "@pretable/ui/grid.css"` |
| `import { Footer } from "@pretable/ui"` (`app/layout.tsx`) | from old `@pretable/ui` | → `import { Footer } from "./components/Footer"` (local) |
| `import { Nav } from "@pretable/ui"` (`app/components/RouteAwareNav.tsx`) | from old `@pretable/ui` | → `import { Nav } from "./Nav"` (local) |
| `apps/website/app/docs/getting-started/page.mdx` references `@pretable/ui` CSS via `globals.css` cascade | works through `globals.css` | unchanged once `globals.css` updates |

The website ends up with **two non-conflicting token namespaces on the same page**:
- `--pt-*` (cool-slate, owned by `apps/website/app/styles/cool-slate-tokens.css`, drives marketing chrome)
- `--pretable-*` (the theming package, drives the embedded live grid)

The embedded grid on the landing page should use **Material** rather than Excel — it lets us demonstrate dark mode to visitors and advertises the prebuilt-Material story. Excel can still be referenced in `/docs/getting-started` as the default consumer recipe.

Marketing components moved into website:
- `apps/website/app/components/Receipt.tsx` (+ test)
- `apps/website/app/components/Callout.tsx` (+ test)
- `apps/website/app/components/CodeBlock.tsx` (+ test) — note: a `CodeBlock.tsx` already exists in `apps/website/app/components/`, extracted from CodeExample in PR #30. Reconcile during plan-writing — likely the new one wins, or they merge.
- `apps/website/app/components/Nav.tsx` (+ test)
- `apps/website/app/components/Footer.tsx` (+ test)

### `apps/bench`

| Block | Migration |
|---|---|
| `@import "@pretable/ui/tokens.css"` | → `@import "./styles/cool-slate-tokens.css"` (copy of website's; can diverge later) |
| `@import "@pretable/ui/components.css"` | → `@import "./styles/marketing-components.css"` (copy) |
| Bench-specific grid CSS (if any) | → `@import "@pretable/ui/themes/excel.css"` + `@import "@pretable/ui/grid.css"` (Excel suits a benchmarking tool — dense, technical) |
| `import { Nav, Footer } from "@pretable/ui"` (`apps/bench/src/app.tsx`) | → import from local `./components/{Nav,Footer}` (D1 X — duplicated copies) |

Bench gets local `Nav.tsx` and `Footer.tsx`; the cross-app duplication is intentional per D1.

---

## PR decomposition

The migration breaks into independent shippable PRs (per the user's "small-PR cycle" constraint):

| PR | Scope | Depends on |
|---|---|---|
| **1** | Create new `@pretable/ui`: themes, grid.css, density.ts, tailwind.css, contract test. Old package stays where it is. Publishable as 0.0.1 from this PR. | — |
| **2** | Add `useResolvedHeights` bridge to `@pretable/react`; strip skin from `internal/styles.ts`. Apps still override via their own CSS, so nothing visually breaks. Engine bridge tests added. | PR 1 (for the contract conventions) — but technically independent if we publish the data-attribute contract first |
| **3** | Move marketing components + cool-slate CSS out of old `@pretable/ui` into `apps/website/app/components/` and `apps/website/app/styles/`. Wire `apps/website` to consume new `@pretable/ui` for the embedded grid. Delete old `packages/ui/` directory. | PR 1 |
| **4** | Migrate `apps/bench` to its own local Nav/Footer + new `@pretable/ui` for the bench grid. | PR 1, PR 3 (because PR 3 deletes the old package) |

PR 1 unlocks everything. PRs 2 and 3 are independent of each other. PR 4 trails PR 3 because it can't import from a package that no longer exists.

Each PR is independently testable: PR 1 ships a CSS package nobody uses yet but with passing contract tests; PR 2 ships an engine bridge with no visual change for app consumers (their CSS still wins); PR 3 ships a working website with a Material grid; PR 4 ships a working bench.

---

## Testing

### Token contract smoke test (D9)

File: `packages/ui/src/__tests__/contract.test.ts`. Stack: vitest + jsdom. Runs in <1s.

```ts
import { test, expect, describe } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TOKENS = [
  "pretable-bg-grid", "pretable-bg-grid-alt", "pretable-bg-header",
  "pretable-bg-toolbar", "pretable-bg-tooltip",
  "pretable-text-cell", "pretable-text-header", "pretable-text-dim",
  "pretable-rule", "pretable-rule-strong", "pretable-radius",
  "pretable-bg-hover", "pretable-bg-selected", "pretable-text-selected",
  "pretable-focus-ring", "pretable-accent",
  "pretable-row-height", "pretable-header-height",
  "pretable-cell-padding-x", "pretable-cell-padding-y",
  "pretable-font-size-cell", "pretable-font-size-header",
  "pretable-font-sans", "pretable-font-mono",
];

const THEMES_DIR = path.resolve(__dirname, "../../themes");

function loadCSS(filename: string) {
  const css = fs.readFileSync(path.join(THEMES_DIR, filename), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  return () => document.head.removeChild(style);
}

describe("token contract", () => {
  for (const theme of ["excel.css", "material.css"]) {
    test(`${theme} defines every public token at :root`, () => {
      const cleanup = loadCSS(theme);
      const computed = getComputedStyle(document.documentElement);
      for (const token of TOKENS) {
        expect(
          computed.getPropertyValue(`--${token}`).trim(),
          `${theme}: --${token} is empty`,
        ).not.toBe("");
      }
      cleanup();
    });

    test(`${theme} resolves all density tiers`, () => {
      const cleanup = loadCSS(theme);
      for (const density of ["compact", "standard", "spacious"]) {
        document.documentElement.setAttribute("data-density", density);
        const computed = getComputedStyle(document.documentElement);
        expect(
          computed.getPropertyValue("--pretable-row-height").trim(),
        ).toMatch(/^\d+(\.\d+)?px$/);
        expect(
          computed.getPropertyValue("--pretable-header-height").trim(),
        ).toMatch(/^\d+(\.\d+)?px$/);
      }
      document.documentElement.removeAttribute("data-density");
      cleanup();
    });
  }

  test("material.css resolves dark mode", () => {
    const cleanup = loadCSS("material.css");
    document.documentElement.setAttribute("data-theme", "dark");
    const computed = getComputedStyle(document.documentElement);
    const lightBg = "#fef7ff";
    expect(
      computed.getPropertyValue("--pretable-bg-grid").trim().toLowerCase(),
    ).not.toBe(lightBg);
    document.documentElement.removeAttribute("data-theme");
    cleanup();
  });

  test("grid.css has no unresolved var() references", () => {
    const themeCleanup = loadCSS("excel.css");
    const gridCss = fs.readFileSync(
      path.resolve(__dirname, "../../grid.css"),
      "utf8",
    );
    const refs = new Set(
      [...gridCss.matchAll(/var\((--pretable-[a-z-]+)/g)].map((m) => m[1]),
    );
    const computed = getComputedStyle(document.documentElement);
    for (const ref of refs) {
      expect(
        computed.getPropertyValue(ref).trim(),
        `grid.css references unresolved ${ref}`,
      ).not.toBe("");
    }
    themeCleanup();
  });
});
```

What this catches:
- Theme file forgot to define a token in the contract list
- Token name typo (`--pretable-bgrid` vs `--pretable-bg-grid`)
- `grid.css` references a token no theme defines
- Density tier resolves to non-px value (a unit typo)
- Material's dark mode forgot to override at least one color

What this does **not** catch (deferred to visual regression):
- Token resolves to the *wrong* value (e.g., Material light bg accidentally `#000000` — contract passes, page looks wrong)
- Theme combinations look broken visually
- Cross-browser rendering quirks

### Engine bridge tests in `@pretable/react`

`packages/react/src/internal/__tests__/density.test.ts` — vitest + jsdom.

Coverage targets:
- `useResolvedHeights(48)` returns `{rowHeight: 48, ...fallback}` even when CSS var is set (props win)
- `useResolvedHeights()` with `--pretable-row-height: 22px` set returns `22`
- `useResolvedHeights()` with no var set returns fallbacks
- Re-renders on `data-density` attribute change (MutationObserver fires; new computed value reads through)
- Server snapshot returns fallbacks (SSR safety)

### Visual regression — explicit deferral

The package README carries this passage:

> Visual regression testing is deferred. The token contract smoke test catches most contract violations (missing tokens, unresolved `var()` references, non-px density tiers). It does not catch tokens resolving to wrong values or unintended visual differences. When we onboard a non-internal consumer or otherwise need stronger guarantees, we add a Playwright reference scene: a 10-row × 5-column grid (mix of text + numeric columns, one pinned-left, one selected, one focused) rendered in each (theme × density × mode) combo — up to 18 PNGs at the maximum matrix.

Tracked as a TODO in the package README.

---

## Versioning

Per D8: pre-1.0, no graduation criterion. The 0.0.x patch series continues indefinitely.

- **0.0.1** ships the contract above with Excel + Material themes, `grid.css`, `density.ts` (in `@pretable/react`), `tailwind.css`.
- **0.0.x** is a freeform patch series. Tokens may be added, renamed, removed in any patch release. CHANGELOG entries describe each release's token deltas.
- Token names are explicitly NOT stable. Override at your own risk.

The package README states clearly: "Pre-1.0 experimental. Override at your own risk."

---

## Open risks & mitigations

| # | Risk / non-goal | Mitigation |
|---|---|---|
| 1 | Density tokens cascade through `<html>`. Multiple grid instances can't run different densities concurrently via tokens. | Pass numeric `rowHeight`/`headerHeight` props per instance — engine prop wins over CSS var. Document in `/docs/getting-started`. |
| 2 | Some sketched data-attribute selectors in `grid.css` (`[data-pretable-header-row]`, `[data-pretable-toolbar]`, `[data-pretable-popover]`) may not exist on the engine. | Plan-time reconciliation list. Each missing attribute gets either an engine PR to expose it, or the corresponding grid.css rule defers to a 0.0.x patch. |
| 3 | Material default density is "standard" (48px). Data-grid users often expect compact-by-default. | Documented. Consumers set `data-density="compact"` once or override `:root` tokens. |
| 4 | Two namespaces coexist on `apps/website` pages: `--pt-*` (cool-slate marketing) and `--pretable-*` (theming package, embedded grid). Two systems for contributors to learn. | Tolerable; future consolidation possible but out of scope. README on `apps/website/app/styles/` explains. |
| 5 | 18 visual configurations (3 themes × 3 densities × 2 modes for Material — though Excel is light-only so really 12) untested at the rendering level. | Contract smoke test in 0.0.x; visual regression deferred. |
| 6 | The `useResolvedHeights` MutationObserver fires on any attribute mutation on `<html>`, not just density-affecting ones. Possible needless re-renders if app heavily mutates `<html>` attributes. | Filter narrowed to `data-density`/`data-theme`/`class`/`style`. React's reconciler is cheap when computed values don't change; only triggers actual re-render if `getDensityHeights` returns a different snapshot via `Object.is` shallow-compare in `useSyncExternalStore`. |
| 7 | `getComputedStyle` reads on every snapshot can be slow if called in tight loops. | `useSyncExternalStore` calls the snapshot function only when subscribers exist and only on observed changes — not in hot paths. |
| 8 | Aptos Narrow ships only with Office and Windows 11 23H2+. macOS / Linux / older Windows fall back to Segoe UI / system-ui — Excel theme on those platforms doesn't look "Excel-authentic." | Documented as a caveat. The fallback chain is sensible; the look is recognizably Excel-spirit even when Aptos isn't available. Future opt-in webfont package possible. |
| 9 | Roboto Flex must be loaded by the consumer for Material theme to render correctly. We don't bundle webfonts in `@pretable/ui` (no `@fontsource-variable` peer deps). | Documented. Material recipe in `/docs` includes the `@fontsource-variable/roboto-flex` import. Fallback to Roboto / system-ui is graceful but loses Material's visual identity. |

## Non-goals (explicit)

- No `<PretableThemeProvider>` React component
- No JS theme builder (`createTheme({...})`)
- No dynamic per-instance theming (multiple grids, different themes simultaneously)
- No CSS-in-JS first-class API (works via cascade but isn't a featured path)
- No more than 2 themes shipped initially (Excel + Material)
- No light variant of Excel — Excel is light-only by design
- No dark variant of Excel — by user decision

---

## Appendix A: research-informed theme values

The hex codes and density numbers in the theme files are research-derived. Sources are cited inline in the theme CSS files; this appendix documents methodology and gaps.

### Excel theme — value sources

**Typography**
- Aptos Narrow at 11pt is the default in Excel for Microsoft 365 since build 2403 (March 2024). [Microsoft Design — A change of typeface](https://medium.com/microsoft-design/a-change-of-typeface-microsofts-new-default-font-has-arrived-f200eb16718d), [Wikipedia — Aptos](https://en.wikipedia.org/wiki/Aptos_(typeface)).
- 11pt at 96 DPI = 14.67px → rounded to 15px in CSS.
- Numeric cells need `font-variant-numeric: tabular-nums` because proportional Aptos has tabular figures by default but explicit declaration handles fallback fonts.

**Colors**
- `#107C41` (Excel app brand green) — public Microsoft 365 brand color, used for Excel's iconic active-cell border and current selection range tint.
- `#0078D4` (Office communication blue) — kept as a reference but NOT the Excel-grid focus color; this is Office system accent, not Excel-grid accent.
- Gridline `#D4D4D4` — Excel desktop reports RGB 211,211,211 (≈ `#D3D3D3`) in Options → Advanced; Excel for the web inspects as `#E1E1E1` to `#D4D4D4` depending on Fluent token version. Microsoft does not publish an authoritative hex; `#D4D4D4` is defensible.
- Header `#F3F3F3` bg / `#5C5C5C` text — observation-derived from Excel for the web DOM. Microsoft does not publish.
- Selection range `rgba(16,124,65,0.10)` — green tint matching the Excel-for-web 2023+ behavior; pre-2023 used a blue tint. Either is defensible; current is green.
- **No row hover** — confirmed Excel desktop and Excel for the web behavior.

**Density**
- Default row height 15pt = 20px confirmed by [Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/257675/excel-row-height-logic-calculation).
- Compact / Standard / Comfortable pixel heights observation-derived from Excel for the web; Microsoft does not publish. Defensible round numbers used.

### Material 3 theme — value sources

**Color tokens (baseline scheme, seed `#6750A4`)**
- All values from the [Material Theme Builder](https://material-foundation.github.io/material-theme-builder/) baseline export, cross-checked against [material-color-utilities](https://github.com/material-foundation/material-color-utilities).
- Light: `surface #FEF7FF`, `surface-container #F3EDF7`, `surface-container-low #F7F2FA`, `on-surface #1D1B20`, `on-surface-variant #49454F`, `outline-variant #CAC4D0`, `outline #79747E`, `primary #6750A4`, `secondary-container #E8DEF8`, `on-secondary-container #1D192B`.
- Dark: `surface #141218`, `surface-container-low #1D1B20`, `surface-container #211F26`, `on-surface #E6E0E9`, `on-surface-variant #CAC4D0`, `outline-variant #49454F`, `outline #938F99`, `primary #D0BCFF`, `secondary-container #4A4458`, `on-secondary-container #E8DEF8`.

**Surface tier mapping**
- M3 has no formal data-table component spec (m3.material.io page returns 404). Mapping derived from M3 List, Card, and Surface patterns.
- Light grid sits at `surface`; header at `surface-container` (one tonal step up).
- Dark grid sits at `surface-container-low`, NOT raw `surface` — explicit M3 guidance: raw dark `surface` reads as a void.

**State layers**
- Hover 8%, Focus 10%, Pressed 10%, Dragged 16% — per [M3 States](https://m3.material.io/foundations/interaction/states/applying-states), confirmed by Compose Material3 + MDC-Web implementations.
- Layer color is `on-surface @ 8%` (the on-color over surface), NOT `primary @ 8%`.

**Typography**
- [M3 type scale tokens](https://m3.material.io/styles/typography/type-scale-tokens): body-medium = 14/20/400, label-large = 14/20/500, body-small = 12/16/400.
- Roboto Flex (variable) baseline; Roboto fallback; system-ui ultimate fallback.

**Shape**
- M3 shape scale: extra-small 4dp, small 8dp, medium 12dp, large 16dp, extra-large 28dp.
- Cards use medium (12dp) — adopted for the grid container.
- Lists/tables interior is flat (0dp) — adopted for cells.

**Density**
- M3 does not formally specify table density. Material Components Web (mdc-web) historical values: Comfortable 52dp, Compact 36dp.
- 2026 implementation chosen on M3's 4dp metric grid: Compact 40/44, Standard 48/52, Spacious 56/64.

### Gaps (no authoritative answer)

These have no published spec value; defensible choices documented:

1. **Excel default gridline hex.** Defensible: `#D4D4D4`.
2. **Excel header strip hex.** Defensible: `#F3F3F3` bg, `#5C5C5C` text.
3. **Excel selected-cell fill.** Defensible: `rgba(16,124,65,0.10)` (current Excel-for-web behavior).
4. **Excel for the web density pixel heights.** Defensible round values: 20/24/32px cells, 24/32/40px headers.
5. **M3 pressed-state opacity.** Spec internally inconsistent (10% vs 16%). Ship 10% pressed, 16% dragged — matches Google's component implementations.
6. **M3 data-table density.** Not specified at all. Pick 40/48/56 dp on the 4dp grid (informed by mdc-web).

### Cited sources

- [Microsoft Design — Aptos rollout](https://medium.com/microsoft-design/a-change-of-typeface-microsofts-new-default-font-has-arrived-f200eb16718d)
- [Microsoft Q&A — Excel row height logic](https://learn.microsoft.com/en-us/answers/questions/257675/excel-row-height-logic-calculation)
- [Microsoft Learn — Aptos typography](https://learn.microsoft.com/en-us/typography/font-list/aptos)
- [Office Watch — New Excel 365 default styles](https://office-watch.com/2023/excel-365-new-default-styles/)
- [BrandColorCode — Microsoft 365 brand palette](https://www.brandcolorcode.com/microsoft-365)
- [Material 3 — Color roles](https://m3.material.io/styles/color/roles)
- [Material 3 — Static color](https://m3.material.io/styles/color/static)
- [Material 3 — States (interaction)](https://m3.material.io/foundations/interaction/states/applying-states)
- [Material 3 — Type scale tokens](https://m3.material.io/styles/typography/type-scale-tokens)
- [Material Color Utilities](https://github.com/material-foundation/material-color-utilities)
- [Material Components Android — Color theming](https://github.com/material-components/material-components-android/blob/master/docs/theming/Color.md)
