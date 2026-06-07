# Semantic Targeting Attributes — Design

**Date:** 2026-06-06
**Status:** Approved (pending spec review)
**Scope:** Unify, complete, and document the grid's styling/targeting `data-*` attribute contract so consumers can target any part (a specific column, a row, selected/focused/pinned state, body vs header) with plain CSS — building on the `@layer pretable` + `:where()` override contract shipped in #160.

## Problem

The grid already emits a useful set of styling/identity/state `data-*` attributes, but the set is **inconsistent, incomplete, and undocumented as a stable contract**:

- **Inconsistent naming.** Structural attributes are `data-pretable-*`-prefixed (`data-pretable-cell`, `data-pretable-header-cell`, `data-pretable-row`, `data-pretable-wrap`), but identity/state attributes are **unprefixed** (`data-column-id`, `data-row-id`, `data-row-index`, `data-selected`, `data-focused`, `data-pinned`, `data-row-select-cell`). Unprefixed attributes risk colliding with consumer/framework attributes, don't read as "Pretable's", and aren't part of a documented contract.
- **Incomplete / dead.** Header cells emit **no** `data-column-id`, so "style the Revenue _header_" is impossible via CSS. Separately, the `[data-pinned="right"]` rule shipped in `grid.css` (#160) is **dead code** — right-pinning is not implemented (core `setColumnPinned` accepts only `"left" | null`; `PretableColumn.pinned` is `"left"`), so `data-pinned` only ever emits `"left"` and that rule can never match. (It will be removed, not "completed" — right-pin is a separate, unscoped feature.)
- **Uncommitted.** None of these are documented as a stable styling API, so consumers can't rely on them.

pretable is pre-1.0 with no external consumers (`feedback_no_backcompat`), so attributes can be renamed freely — this is the moment to lock a consistent, complete, documented contract.

## Goal

A single, consistent, documented `data-pretable-*` styling-attribute contract that lets a consumer target, with plain CSS (and the #160 override guarantees):

- a specific column's **body cells and header** (`data-pretable-column-id`)
- a specific **row** (`data-pretable-row-id`, `data-pretable-row-index`)
- **state** (`data-pretable-selected`, `data-pretable-focused`)
- **pinned** cells/headers (`data-pretable-pinned="left"`) — left only; right-pinning is not a feature (core `setColumnPinned` accepts `"left" | null`; `PretableColumn.pinned` is `"left"` only)
- body vs header (existing `data-pretable-cell` vs `data-pretable-header-cell`)

Explicitly NOT adding (YAGNI — redundant with the above): `data-cell-type` (served by the two prefixed element attrs), `data-row-id` on cells (target via the parent row's id with a descendant selector), a sort attribute (already CSS-targetable via `aria-sort`).

## Design

### 1. The unified attribute contract

Rename every styling/identity/state attribute to the `data-pretable-*` namespace and fill the two gaps:

| Element                                   | Attribute                                         | Change                                                                                       |
| ----------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| row `[data-pretable-row]`                 | `data-pretable-row-id`                            | renamed from `data-row-id`                                                                   |
|                                           | `data-pretable-row-index`                         | renamed from `data-row-index`                                                                |
|                                           | `data-pretable-selected`, `data-pretable-focused` | renamed                                                                                      |
|                                           | `data-pretable-row-height`                        | renamed from `data-row-height`; internal (measurement output), not a documented styling hook |
| body cell `[data-pretable-cell]`          | `data-pretable-column-id`                         | renamed from `data-column-id`                                                                |
|                                           | `data-pretable-selected`, `data-pretable-focused` | renamed                                                                                      |
|                                           | `data-pretable-pinned="left"`                     | renamed from `data-pinned` (left-only; right-pin unsupported)                                |
|                                           | `data-pretable-row-select-cell`                   | renamed from `data-row-select-cell`                                                          |
| header cell `[data-pretable-header-cell]` | `data-pretable-column-id`                         | **NEW** (gap fill)                                                                           |
|                                           | `data-pretable-pinned="left"`                     | renamed from `data-pinned` (left-only)                                                       |

Unchanged: `data-pretable-wrap`, `data-pretable-row-select-header` (already prefixed); `aria-*` / `role` (ARIA — not ours to namespace); `data-testid` (test hook).

Net new capability: **target a column's header by id**, plus a single consistent, collision-safe, documentable namespace. We also **remove the dead `[data-pinned="right"]` rule from `grid.css`** (right-pinning is not implemented, so the rule can never match). Everything else is the same capability under the new names.

### 2. Emission points + readers (update in one change)

**Emission** (rename + add header `data-pretable-column-id`):

- `packages/react/src/pretable-surface.tsx` — body cell (~line 1555), header cell (~line 1180), row (~line 1485). `column.pinned`/`plannedCol.pinned` is `"left"` only, so `data-pretable-pinned` stays left-only (no right).
- `packages/react/src/labeled-grid-surface.tsx` — `data-pinned` (2 spots) → `data-pretable-pinned`.

**Styles:**

- `packages/ui/src/grid.css` — rename the attrs inside the existing `@layer pretable { :where(…) }` block (keep the layer + `:where()` wrapping from #160 intact), and **delete the dead `[data-pinned="right"]` rule** (right-pin unsupported).

**Bench (the cross-package coupling):**

- `apps/bench/src/bench-runtime.ts` — update **only the pretable profile's** `rowIdAttribute`/`rowIndexAttribute` to `data-pretable-row-id`/`data-pretable-row-index`. The **comparator profile must keep `data-row-id`/`data-row-index`** (TanStack/AG Grid/MUI adapters emit their own unprefixed attrs, e.g. `tanstack-adapter.tsx:275`).

**Docs:**

- `apps/website/content/docs/grid/{custom-rendering,index,pretable-component,api-reference}.mdx` and `theming/cascade-and-overrides.mdx` — update shown attribute names, and document the full `data-pretable-*` targeting contract (ideally a table) on the cascade/overrides or a targeting page.

**MUST NOT touch:** `apps/bench/src/tanstack-adapter.tsx` `data-row-id`; the comparator profile in `bench-runtime.ts`; `.next/` build artifacts (regenerated).

### 3. Primary risk

The pretable↔bench DOM coupling: the bench harness reads pretable rows by `data-row-id`/`data-row-index` via its pretable profile. If that profile isn't renamed in lockstep with the emission, the harness can't read pretable rows and interaction measurement breaks. The bench reads only row-id/row-index from the DOM (selection/focus come via pretable's telemetry override), so the coupling is bounded. **Mitigation:** update the pretable profile in the same change and verify with a `bench:matrix` pretable interaction run before merge.

## Testing

1. **Update existing unit assertions** to the new names — `pretable-surface.test.tsx` (~133 refs) plus `pretable.test.tsx`, `inspection-grid.test.tsx`, `labeled-grid-surface.test.tsx`, `bench-runtime.test.ts`. The existing suite already exercises cell/row/header rendering, so it is the rename's safety net.
2. **New assertion for the gap-fill:**
   - A header cell emits `data-pretable-column-id` matching its column (proves the new header-targeting capability). Also assert a left-pinned column's header emits `data-pretable-pinned="left"` (covers the header rename).
3. **New structural guard test** (`packages/react`): render a grid and assert no unprefixed styling `data-*` attribute leaks — every Pretable-emitted `data-*` is `data-pretable-*` (allow `data-testid`; `aria-*`/`role` stay). Locks the unified-namespace contract against regressions, mirroring the `css-cascade` guard from #160.
4. **Bench integration verification** (merge gate for the coupling): `pnpm bench:matrix --adapters=pretable --scenarios=S2 --scripts=sort,filter-text --scale=hypothesis` completes, confirming the harness reads the renamed row attrs.

**Expected to stay green:** the `css-cascade` structural test and the `ui` token-contract test (the rename changes attr names inside `grid.css` but not the `@layer`/`:where()` structure); `api:check` (these are DOM attributes, not exported TS symbols — no public-API change).

## Out of scope (tracked separately)

Brand/semantic token-alias layer; dark mode for Excel; unstyled/headless variant. (Headless docs already shipped in #168.)
