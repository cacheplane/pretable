# Grid Token Consolidation — Design

**Date:** 2026-06-07
**Status:** Approved (pending spec review)
**Scope:** Move the grid-control colors that `grid.css` depends on out of the undocumented `--pt-color-*` namespace into the documented `--pretable-*` theme contract, so the documented consumer recipe (`theme.css` + `grid.css`) yields a fully-themed grid. Fixes a real contract bug and delivers the "one complete token set to brand against" goal.

## Problem

`packages/ui/src/grid.css` consumes **two** token namespaces:

- `--pretable-*` — the documented 24-token theme contract, defined by each theme file (`material.css`, `excel.css`) and verified by `contract.test.ts`.
- `--pt-color-*` — 11 grid-control colors (checkbox ×4, selection overlay, focus-ring, resize ×2, reorder ×3) that are **defined only in `packages/ui/src/tokens.css`** (the Alpenglow website palette), are **not in any theme file**, **not in the documented contract**, and **not imported by the documented recipe**.

The documented consumer recipe (per `grid.css`'s own header) is `@import "@pretable/ui/themes/<theme>.css"; @import "@pretable/ui/grid.css";`. It does NOT import `tokens.css`. So a consumer following the recipe gets a grid where the checkbox is unstyled, range selection has no background, the resize handle is invisible, and the reorder ghost is broken — all 11 `--pt-color-*` are undefined. **Verified:** the bench app (`apps/bench/src/app.css`) imports `excel.css` + `grid.css` but not `tokens.css`, and its `cool-slate-tokens.css` defines zero `--pt-color-*` — so the bench grid's controls are already running on undefined values. Only the **website** works, by accident, because it also imports `tokens.css`.

pretable is pre-1.0 with no external consumers (`feedback_no_backcompat`), so the token namespace can change freely — this is the moment to make the grid's full styling contract coherent and documented.

## Goal

Every color `grid.css` needs is a documented `--pretable-*` token defined by each theme. A consumer importing only a theme + `grid.css` gets a fully, correctly themed grid. Because the new tokens derive from the theme's existing `--pretable-*` (accent, rule, bg-grid, …), recoloring those few cascades coherently to the grid controls — the real payoff behind the "brand alias layer" idea, grounded in a real contract instead of a speculative derivation layer.

## Design

### 1. Consolidated token set (10 new + 1 dedupe)

Rename, in `grid.css`, the `--pt-color-*` references to new `--pretable-*` tokens:

| New `--pretable-*` token            | Replaces `--pt-color-*`  |
| ----------------------------------- | ------------------------ |
| `--pretable-selection-bg`           | `selection-bg`           |
| `--pretable-checkbox-bg`            | `checkbox-bg`            |
| `--pretable-checkbox-border`        | `checkbox-border`        |
| `--pretable-checkbox-checked-bg`    | `checkbox-checked-bg`    |
| `--pretable-checkbox-checked-fg`    | `checkbox-checked-fg`    |
| `--pretable-resize-handle`          | `resize-handle`          |
| `--pretable-resize-handle-hover`    | `resize-handle-hover`    |
| `--pretable-reorder-ghost-bg`       | `reorder-ghost-bg`       |
| `--pretable-reorder-ghost-shadow`   | `reorder-ghost-shadow`   |
| `--pretable-reorder-drop-indicator` | `reorder-drop-indicator` |

**Dedupe (no new token):** `--pt-color-focus-ring` (used by the `[role="gridcell"]` focus rule) → reuse the existing `--pretable-focus-ring`. The duplicate is dropped.

`--pretable-selection-bg` (range / `[role="gridcell"][aria-selected]` overlay) is kept **distinct** from the existing `--pretable-bg-selected` (themed `[data-pretable-selected]` cell fill) — they style different selectors/states; collapsing them would change the rendered selection appearance.

Net: the documented contract grows **24 → 34** `--pretable-*` tokens; `--pt-color-*` disappears from `grid.css`'s dependency graph.

### 2. Definition, rename, and cleanup

**Define the 10 in each theme** (`material.css`, `excel.css`), derived from that theme's existing `--pretable-*` so they stay coherent and auto-adapt (incl. Material's `[data-theme="dark"]` block, since they reference tokens the dark block already overrides):

```css
--pretable-selection-bg: color-mix(
  in srgb,
  var(--pretable-accent) 8%,
  transparent
);
--pretable-checkbox-bg: var(--pretable-bg-grid);
--pretable-checkbox-border: var(--pretable-rule-strong);
--pretable-checkbox-checked-bg: var(--pretable-accent);
--pretable-checkbox-checked-fg: #fff;
--pretable-resize-handle: transparent;
--pretable-resize-handle-hover: var(--pretable-accent);
--pretable-reorder-ghost-bg: var(--pretable-bg-header);
--pretable-reorder-ghost-shadow: 0 4px 12px rgb(0 0 0 / 0.12);
--pretable-reorder-drop-indicator: var(--pretable-accent);
```

Add them once to each theme's base `:root` block (they derive, so no per-density or per-dark duplication is required). `color-mix` is baseline ~2023, consistent with the `@layer`/`:where()` modernity from #160.

**`grid.css`:** rename the 16 `var(--pt-color-*)` references to the new `--pretable-*` names; the `[role="gridcell"]` focus rule switches to `--pretable-focus-ring`. Keep the `@layer pretable { :where(…) }` wrapping (#160) and the `data-pretable-*` selectors (#169) intact.

**`tokens.css` cleanup:** remove the now-dead grid-control `--pt-color-*` declarations — the 11 that `grid.css` referenced plus `--pt-color-selection-border` (which only fed the old `resize-handle-hover` derivation and is unreferenced once that repoints to `--pretable-accent`): `selection-bg`, `selection-border`, `focus-ring`, `resize-handle`, `resize-handle-hover`, `reorder-ghost-bg`, `reorder-ghost-shadow`, `reorder-drop-indicator`, `checkbox-bg`, `checkbox-border`, `checkbox-checked-bg`, `checkbox-checked-fg`. **Safe:** the only other `--pt-color-*` consumer is `apps/website/app/components/heroGrid/heroGrid.module.css`, which uses `--pt-color-warning` (unrelated) — leave that and any other non-grid `--pt-color-*` untouched.

**`tailwind.css` bridge:** unchanged. The 10 are grid-internal controls, not consumer surface/text colors, so they don't need Tailwind utility aliases (YAGNI).

### 3. The dedupe detail

`tokens.css` currently has internal derivations among the `--pt-color-*` set (e.g. `resize-handle-hover: var(--pt-color-selection-border)`, `reorder-drop-indicator: var(--pt-color-focus-ring)`). After consolidation those derivations are re-expressed against `--pretable-*` in the theme files (e.g. `resize-handle-hover: var(--pretable-accent)`), so no `--pt-color-*` remains referenced by the grid.

## Testing

1. **Extend `contract.test.ts` `TOKENS`** with the 10 new tokens → the existing "every theme defines every token at `:root`" test now guarantees `material.css` and `excel.css` (and Material dark) define them. A theme missing one fails CI. This is the direct fix that keeps the contract complete.
2. **Run the grid.css var-resolution test against BOTH themes.** `contract.test.ts` already asserts "grid.css has no unresolved `var(--pretable-*)` references when excel.css is loaded"; after consolidation that automatically covers the grid-control tokens. Extend it to also load `material.css` and assert the same — proving each theme satisfies grid.css's full dependency set (the precise guard that the documented recipe yields a fully-themed grid).
3. **New assertion: `grid.css` contains no `--pt-color-*`** (read the file as text; assert no match). Locks the consolidation against a future reintroduction of the split namespace — mirrors the structural guards from #160/#169.

**Expected to stay green:** `css-cascade.test.ts` (cascade structure unchanged — this touches token names/values, not `@layer`/`:where()`), the density test (these aren't density tokens), `api:check` (no exported TS symbols change). The bench renders correct grid-control colors for free (previously undefined) — no bench code change.

## Out of scope (tracked separately)

Brand-primitive derivation layer (map ~6 inputs → the full set) — now largely unnecessary, since deriving the grid-control tokens from `--pretable-accent`/`-bg-grid`/etc. already gives consumers the "recolor a few, get coherent controls" behavior. Dark mode for Excel.
