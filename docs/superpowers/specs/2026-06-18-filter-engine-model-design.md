# Filter engine operator model — design (sub-project 1 of 3)

**Date:** 2026-06-18
**Branch:** `claude/filter-operators` (off `main` after #176)
**Status:** approved (pending written-spec review)

## Context

Filtering today is intentionally minimal: `state.filters: Record<columnId, string>`,
case-insensitive substring, AND-combined (`packages/grid-core/src/derived-rows.ts:49-86`,
state in `create-grid-core.ts:90`, methods `setFilter`/`clearFilters`/`replaceFilters`).
The #1 ranked v1 gap is a real operator-based filter model with a built-in UI.

This is **sub-project 1 of 3** for that effort:

1. **Engine operator model** (this spec) — headless typed filters in `grid-core` + `core`.
2. Built-in header-menu filter UI (`@pretable/react` + `@pretable/ui`) — later spec.
3. Docs + hero adoption — later spec.

Everything else depends on this, so it ships first. No backcompat (pre-1.0, no external
consumers): the string filter model is **replaced**, not aliased.

## Goal

Replace the substring-only filter model with a typed, operator-based one covering four
column-type families (text, number, enum/set, date), AND-combined across columns, with
per-column configuration and the engine helpers the future UI needs. Fully headless —
no React, no DOM, no UI in this sub-project.

## Non-goals

- OR / boolean-tree logic (deferred to a future "advanced query" feature). Multi-value
  `isAnyOf` (OR within a column) + `between` (ranges) cover the common cases.
- Any React/UI, the header menu, `onFiltersChange` (sub-project 2).
- Docs and hero migration beyond what's needed to keep the repo compiling (sub-project 3).
- Per-column custom predicate functions / pluggable operators (possible later; not now).

## Filter model

```ts
/** @public */
export type FilterOperator =
  // text
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "startsWith"
  | "endsWith"
  // number
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  // enum / set
  | "isAnyOf"
  | "isNoneOf"
  // date
  | "on"
  | "before"
  | "after"
  | "dateBetween"
  // shared (any type)
  | "isEmpty"
  | "isNotEmpty";

/** @public */
export type FilterValue =
  | string // text ops, single date (ISO yyyy-mm-dd) for on/before/after
  | number // number comparisons
  | [number, number] // between
  | [string, string] // dateBetween (ISO start, ISO end)
  | string[] // isAnyOf / isNoneOf
  | null; // isEmpty / isNotEmpty (no operand)

/** @public — one column's filter. `value` omitted for isEmpty/isNotEmpty. */
export interface ColumnFilter {
  operator: FilterOperator;
  value?: FilterValue;
}

// snapshot.filters becomes: Record<columnId, ColumnFilter>   // AND across columns
```

Notes:

- `equals`/`notEquals` live in the **text** family (case-insensitive string equality).
  Numeric equality uses the number family's `equals` semantics via the column's
  `filterType` (the operator string `equals` is shared text+number; evaluation branches
  on `filterType`). To avoid ambiguity, evaluation is driven by `filterType`, not by the
  operator name alone.
- Dates are carried as ISO `yyyy-mm-dd` strings (UI sub-project owns the picker). The
  engine parses with `Date.parse` and compares by day-resolution timestamp.

## Per-column configuration

Additions/changes to `PretableColumn` (`packages/grid-core/src/types.ts:66-91`):

```ts
/** @public */
export type FilterType = "text" | "number" | "date" | "enum";

interface PretableColumn<TRow> {
  // ...existing...
  filterType?: FilterType; // default "text"
  filterable?: boolean; // EXISTING — keep; default true (a false value means
  // the engine ignores any filter targeting this column)
  filterOptions?: { value: string; label?: string }[]; // enum only; if omitted, the
  // distinct values are auto-derived from the rows.
}
```

- Filtering reads the cell via the existing `value` accessor (`readCellValue`,
  `derived-rows.ts:139`), falling back to `row[columnId]`.
- `filterable: false` → that column's entry in `filters` is ignored (like a non-existent
  column today). The UI sub-project will also hide the affordance.

## Evaluation (replace `matchesFilters` / `resolveFilters`)

In `packages/grid-core/src/derived-rows.ts`:

- `resolveFilters(filters, columnMap)` resolves each `[columnId, ColumnFilter]` to the
  column (skip if missing or `filterable === false`), carrying `filterType` and operator.
- `matchesFilters(row, resolved)` evaluates each, AND-combined (early-exit on first
  false). A single pure `evaluateFilter(cellValue, filterType, operator, value)` does the
  per-operator work:
  - **empty semantics:** `isEmpty` ≡ value is `null`, `undefined`, or `""` (after
    `String().trim()` for text; for number, also `NaN` after coercion); `isNotEmpty` = negation.
  - **text:** `String(cell).toLowerCase()` vs `String(value).toLowerCase()` —
    `contains`/`notContains` (`includes`), `equals`/`notEquals` (`===`),
    `startsWith`/`endsWith`.
  - **number:** `Number(cell)`; if `NaN`, the row fails any comparison (except
    `isEmpty`). `gt/gte/lt/lte`; `between` inclusive on `[min, max]` (tolerate reversed
    bounds by normalizing min≤max); `equals/notEquals` numeric.
  - **enum:** `isAnyOf` → `value.includes(String(cell))`; `isNoneOf` → negation. Empty
    selection array ⇒ no constraint (row passes), so an empty checklist doesn't hide
    everything.
  - **date:** parse cell + operand(s) to day-resolution ms; `on` (same day),
    `before` (`<`), `after` (`>`), `dateBetween` inclusive. Unparseable cell fails
    (except `isEmpty`).
- A filter whose `value` is "blank" (empty string, empty array, `undefined` for a
  non-empty operator) is treated as **inactive** (row passes) — mirrors today's "drop
  empty needle" behavior so a half-entered filter doesn't blank the grid.

## Engine API (replace string methods — no aliases)

In `packages/grid-core/src/create-grid-core.ts` and the public `PretableGrid`
(`packages/core/src/pretable-grid.ts:37-41`, exported via `public_api.ts`):

- `setColumnFilter(columnId: string, filter: ColumnFilter | null): void` — set/replace
  one column's filter; `null` (or a blank/inactive filter) removes it. Replaces the old
  `setFilter(columnId, value: string)`. Emits only on change (keep existing equality-guard
  behavior, compared structurally).
- `replaceFilters(next: Record<string, ColumnFilter>): void` — atomic replace; drops
  inactive entries; emits only if changed.
- `clearFilters(): void` — unchanged behavior, retyped.
- `distinctColumnValues(columnId: string): string[]` — **new.** Returns sorted, de-duped
  `String(value)` of the column across the **source** rows (pre-filter), for enum
  auto-derive. Skips null/undefined/`""`. Used by the UI sub-project; lives in the engine
  because it needs row access.
- `snapshot.filters` retyped `Record<string, ColumnFilter>` (`grid-core/src/types.ts:210`).

## Files

- `packages/grid-core/src/types.ts` — `FilterOperator`, `FilterValue`, `ColumnFilter`,
  `FilterType`; column field additions; `snapshot.filters` retype; `PretableEngine`
  method signatures.
- `packages/grid-core/src/derived-rows.ts` — new `evaluateFilter` + rewritten
  `resolveFilters`/`matchesFilters`.
- `packages/grid-core/src/create-grid-core.ts` — `setColumnFilter`, retyped
  `replaceFilters`/`clearFilters`, `distinctColumnValues`, state retype.
- `packages/core/src/pretable-grid.ts` + `packages/core/src/create-grid.ts` — forward the
  new/retyped methods on the public `PretableGrid`.
- `packages/core/src/public_api.ts` + `packages/react/src/public_api.ts` — export the new
  types (`FilterOperator`, `FilterValue`, `ColumnFilter`, `FilterType`).
- `packages/react/src/use-pretable.ts` — retype `PretableSurfaceState.filters` to
  `Record<string, ColumnFilter>` and the controlled-apply block (`grid.replaceFilters`).
  No UI yet; this only keeps types coherent and the controlled prop working.
- `apps/website/app/components/heroGrid/filters.ts` + `HeroGrid.tsx` — migrate
  `buildFilters` to emit `ColumnFilter`s (e.g. `{operator:"contains",value}` for search,
  `{operator:"isAnyOf",value:[sector]}` for sector) so the website compiles. The hero's
  _UX_ redesign is sub-project 3; this is the minimal keep-it-building change.
- `*.api.md` (api-extractor reports) for `core` and `react` — regenerated via `pnpm api`.

## Testing

`packages/grid-core/src/__tests__/` (new `filter-operators.test.ts` + extend existing):

- **text:** contains/notContains/equals/notEquals/startsWith/endsWith, case-insensitive.
- **number:** gt/gte/lt/lte/equals/notEquals; between inclusive + reversed-bounds; NaN cell fails.
- **enum:** isAnyOf/isNoneOf; empty selection = no constraint.
- **date:** on/before/after/dateBetween (inclusive); unparseable cell fails.
- **shared:** isEmpty/isNotEmpty across types (null/undefined/""/NaN).
- **combination:** multiple columns AND; non-existent + `filterable:false` columns ignored;
  blank/inactive filter passes all rows.
- **distinctColumnValues:** sorted, de-duped, skips empties, reads via `value` accessor,
  uses source (pre-filter) rows.
- **API methods:** `setColumnFilter` set/replace/remove + emit-only-on-change;
  `replaceFilters` drops inactive + emits-on-change; `clearFilters`.

Plus: `pnpm api` (report freshness gate), repo-wide `pnpm -r typecheck`, `pnpm -r lint`,
`pnpm -r test`, `pnpm format`. The website must still build/typecheck after the
`buildFilters` migration.

## Risks

- **API report churn:** new exported types change `core.api.md`/`react.api.md`; the
  required "API Extractor — report freshness" gate will fail unless `pnpm api` is run and
  the reports committed. Build the plan with that as an explicit step.
- **Coercion surprises:** number/date coercion of arbitrary cell values. Mitigated by
  explicit NaN/unparseable → fail rules and thorough per-operator tests.
- **Operator/`filterType` coupling:** evaluation keys on `filterType`, so a column with
  `filterType:"number"` must receive number-family operators. The UI enforces this by only
  offering valid operators; the engine treats an out-of-family operator as a no-match
  (documented), not a throw.
