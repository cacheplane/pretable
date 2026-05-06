# Cell Renderers (Sub-project D)

## Goal

Per-column display customization through two layered hooks: `format` (value → string) and `render` (returns React node). Header gets a parallel `renderHeader`. The pipeline runs `format` first, then `render` if provided, with sensible defaults for both. Engine-enforced memoization keeps the perf wedge intact.

## Position in the Tier 1 Roadmap

Sub-project D is the next item after sub-project C per the user-confirmed priority (`project_tier1_revised_priority.md`):

1. ~~B — selection + keyboard nav~~ ✅ shipped (Phase 7 bench deferred).
2. ~~C — column resize + reorder~~ ✅ shipped.
3. **D — cell renderers (this spec).**
4. A — public API stabilization (audit + contract tests).
5. B Phase 7 — bench Slab 1 (selection / nav latency hypotheses).

## Non-Goals

- **Cell editing.** Read-only display only in v1. Editing is a separate strand (D2 / future) with its own state machine, validation, parse/format round-trips, commit/cancel callbacks. Separate brainstorm.
- **Class-based cell renderers.** Pretable uses function renderers only — `(input) => ReactNode`. AG Grid supports both function and class renderers; we ship the simpler API.
- **Renderer refresh API.** AG Grid's `refresh(params): boolean` lets a class renderer optimize partial updates; we don't ship that. Engine memoization on `(rowId, columnId, value, formattedValue, isFocused, isSelected, width, dataAttrs)` is the entire performance contract.
- **Comparative bench (Slab 2).** Sub-project D ships the pretable-internal absolute-threshold hypotheses. Comparative claims (vs AG Grid / MUI X / TanStack with their equivalent renderers) are deferred to a follow-up.
- **Per-renderer escape hatch from memoization.** The engine memoizes every cell unconditionally in v1.

## Architectural separation

`format` returns `string` and lives on `GridCoreColumn` (engine-level). `render` and `renderHeader` return `ReactNode` and live on `PretableColumn` (React adapter only). The current `PretableColumn = GridCoreColumn` type alias becomes `interface PretableColumn<TRow> extends GridCoreColumn<TRow>` with the React-specific fields layered on.

This factoring keeps `@pretable-internal/grid-core` React-free.

## Column type

### Engine-level (`GridCoreColumn<TRow>`)

```ts
interface GridCoreColumn<TRow> {
  // existing: id, header, wrap, widthPx, pinned, sortable, filterable,
  //           minWidthPx, maxWidthPx, resizable, reorderable
  value?: (row: TRow) => unknown;                       // RENAMED from getValue
  format?: (input: GridCoreFormatInput<TRow>) => string; // NEW — string layer
}

interface GridCoreFormatInput<TRow> {
  value: unknown;
  row: TRow;
  column: GridCoreColumn<TRow>;
}
```

### React-level (`PretableColumn<TRow>`)

```ts
interface PretableColumn<TRow> extends PretableCoreColumn<TRow> {
  render?: (input: PretableCellRenderInput<TRow>) => ReactNode;
  renderHeader?: (input: PretableHeaderRenderInput<TRow>) => ReactNode;
}

interface PretableCellRenderInput<TRow> extends PretableFormatInput<TRow> {
  formattedValue: string;
  rowId: string;
  rowIndex: number;
  isFocused: boolean;
  isSelected: boolean;
}

interface PretableHeaderRenderInput<TRow> {
  column: PretableColumn<TRow>;
  label: string;          // = column.header ?? column.id
  sortDirection: "asc" | "desc" | null;
  isSorted: boolean;
}
```

`PretableFormatInput<TRow>` is the React-side re-export of `GridCoreFormatInput<TRow>` (same fields, just the public name).

## Render pipeline

For every visible body cell, on every render:

1. **value extraction**: `value = column.value ? column.value(row) : row[column.id]`.
2. **format**: `formattedValue = column.format ? column.format({ value, row, column }) : defaultFormat(value)`. `defaultFormat` mirrors the existing `formatCellValue` helper (`Array.isArray(v) ? v.join(", ") : String(v ?? "")`).
3. **render**: if `column.render` is present, call it with the full `PretableCellRenderInput<TRow>` (including `formattedValue`); the returned `ReactNode` is rendered inside the memoized cell shell. Otherwise fall back to grid-level `renderBodyCell`. Otherwise render `formattedValue` as plain text inside the cell shell.

For the header cell:
- If `column.renderHeader` is present, call it; the return value renders inside the existing header `<button role="columnheader">` shell. Otherwise fall back to grid-level `renderHeaderCell`. Otherwise render the label string + sort indicator (the existing default).

### `formatForCopy` removal

The B Phase 5 per-column `formatForCopy` field is **removed**. Copy serialization (in `serializeRangesAsTsv`) uses `column.format` if present, else `defaultCoerceForCopy` (the existing copy default coercion). This unifies display and copy formatting under one prop.

Per-cell serialization order in copy:
1. `value = column.value ? column.value(row) : row[column.id]`.
2. `text = column.format ? column.format({ value, row, column }) : defaultCoerceForCopy(value)`.

`defaultCoerceForCopy` (B Phase 5) handles primitives, Dates, plain objects, etc. — preserved as-is for the no-format case. Tests are updated to reflect the new path.

### Synthetic row-select column

`column.id === ROW_SELECT_COLUMN_ID` (`__pretable_row_select__`) ignores `format`, `render`, and `renderHeader`. The built-in three-state checkbox (B Phase 4) is non-overridable in v1. Future custom-checkbox work lands as its own design.

## Engine-enforced memoization

Each rendered body cell is wrapped in `React.memo`'d `<MemoizedCell />`. Custom `areEqual`:

```ts
const cellPropsEqual = (prev, next) =>
  prev.rowId === next.rowId &&
  prev.columnId === next.columnId &&
  prev.value === next.value &&
  prev.formattedValue === next.formattedValue &&
  prev.isFocused === next.isFocused &&
  prev.isSelected === next.isSelected &&
  prev.width === next.width &&
  prev.dataAttrs === next.dataAttrs &&
  prev.renderRef === next.renderRef;

const MemoizedCell = React.memo(CellComp, cellPropsEqual);
```

The comparison includes a `renderRef` that is the column's `render` function (or `null`). This is reference comparison, not deep — if the consumer's columns memo is stable, `renderRef` stays the same and the cell skips re-render. If the consumer remounts with a new column array (new function reference), the cell re-renders. This is the pragmatic middle ground:

- **Stable formatters / renderers (the recommended pattern)**: cells skip re-render across grid-state changes that don't touch the cell's data.
- **Inline functions in column definitions (anti-pattern)**: cells re-render on every parent render. Documented as a perf cliff; consumers must `useMemo` their column arrays.
- **Intentional formatter changes (e.g., user toggles a "compact" view)**: changing the column array reference triggers re-render of all cells. Correct.

`format` and `value` are **not** part of the memo key. They run unconditionally per cell per render at the parent level. This is acceptable because:
- `value` is typically a property access — nanoseconds.
- `format` is typically `Intl.NumberFormat.format` or `Date.toISOString` — microseconds.
- The memo bails out further down based on the resulting `formattedValue` string equality, so the actual cell DOM is not re-rendered.

If a consumer writes a pathologically slow `format`, they hit a perf cliff. Documented loudly. Bench Slab 1 (D3) catches regressions in the demos.

**Header memoization:** parallel pattern. `<MemoizedHeader />` keyed on `(columnId, label, sortDirection, width, isSortable, isSorted, renderHeaderRef)`.

## Interaction with existing grid-level renderers

`<PretableSurface>` retains its existing grid-level `renderBodyCell?` and `renderHeaderCell?` props. The lookup order per cell is:

1. `column.render` (per-column, new in D2) — if present, used.
2. `renderBodyCell` (grid-level, existing) — if (1) absent, used.
3. Default render — `formattedValue` as plain text.

Same precedence for headers (`column.renderHeader` → `renderHeaderCell` → default label + sort indicator).

This keeps `<LabeledGridSurface>` working unchanged. Consumers can adopt per-column renderers gradually, mixing per-column overrides for specific columns with a grid-level default for the rest.

## Phase structure

Sub-project D ships as 3 PRs, merged on green between phases:

| # | Branch | Scope |
|---|---|---|
| D1 | `d1-engine-format` | Engine: rename `column.getValue` → `column.value` everywhere, add `column.format` field on `GridCoreColumn`, update all in-repo callsites (engine internals, copy serializer, react adapter, bench adapter, hero demo, tests). Remove `column.formatForCopy`; copy serializer uses `column.format`. Engine-level unit tests for the new shape. No React adapter render-path changes yet — `format` is recognized at the engine level but the surface's render path still uses the existing `formatCellValue` helper at this phase. |
| D2 | `d2-react-render` | React adapter: extend `PretableColumn` with `render` + `renderHeader` (extends, not aliases, `PretableCoreColumn`). Wire format → render pipeline in `<PretableSurface>`'s body and header render paths. Implement `React.memo`'d `<MemoizedCell />` and `<MemoizedHeader />` with custom `areEqual`. jsdom tests for: format pipeline, render override, renderHeader, memo bailout (cell DOM identity preserved across irrelevant parent re-renders), synthetic column ignores renderers, fall-through to grid-level `renderBodyCell` when per-column render absent. Update docs. |
| D3 | `d3-bench` | New bench scenarios that exercise format + render in the pretable adapter at S2/hypothesis. Three new hypotheses: H19 (format-only display), H20 (custom render returning a single `<span>`), H21 (heavier render returning a 3-element badge). Comparator adapters mark unsupported (Slab 1 only). Repeated Chromium runs at S2/hypothesis to capture evidence in `status/runsets/`. Updates `docs/research/repo-memory.md`. |

Each phase ships spec + plan-detail in its own PR. Master plan + Phase D1 detail land in D1's PR; D2 and D3 append their phase-specific detail to the plan file in their own PRs (the just-in-time pattern from sub-projects B and C).

## Bench plan (D3 detail summary)

The pretable adapter gains an opt-in mode where every column has a `format` + `render` set. Three scripts:

- `scroll-with-format` (cheap format like `String(value)`, no render override) at S2/hypothesis.
- `scroll-with-render` (cheap render returning `<span>{formattedValue}</span>`) at S2/hypothesis.
- `scroll-with-heavy-render` (small JSX tree, e.g., a status badge with conditional class) at S2/hypothesis.

Hypotheses:

- **H19** — `S2/hypothesis/pretable/scroll-with-format`: scroll p95 ≤ existing baseline + 2ms. Validates that `format`'s overhead doesn't break the wedge.
- **H20** — `S2/hypothesis/pretable/scroll-with-render`: scroll p95 ≤ 16ms (single-frame budget at 60Hz). Validates that the cell-level memo holds when the render is a thin component.
- **H21** — `S2/hypothesis/pretable/scroll-with-heavy-render`: scroll p95 ≤ 20ms. Defines the band where heavier renders degrade gracefully without falling off a cliff.

Hypothesis numbering: H1-H15 are taken (H13-H15 = S5 streaming); H16-H18 reserved for B Phase 7 selection/nav; D gets H19-H21.

Comparator support (AG Grid `valueFormatter`+`cellRenderer`, MUI X `valueFormatter`+`renderCell`, TanStack `cell` accessor) is **out of scope for D3**. Slab 2 — comparative bench across the matrix — follows in a future sub-project D2-bench, similar to B2.

## Test layering

- **Engine tests** (D1): rename + format field. Existing `column.getValue` references migrate to `column.value`.
- **Adapter tests** (D2): format/render/renderHeader pipeline, memo bailout (the most subtle test — verify cell DOM is reused across parent re-renders that don't change the cell's inputs), default-rendering fall-through, synthetic column ignore.
- **Bench tests** (D3): the three new scripts have implementation tests under `apps/bench/src/__tests__/`. The hypothesis assertions live in `scripts/bench-matrix.mjs` (extending the existing matrix evaluator).

## Documentation

`apps/website/content/docs/grid/cell-renderers.mdx` (new) — covers `value`, `format`, `render`, `renderHeader`, the pipeline, the memoization contract, the perf cost model, examples for date / number / status badge. Linked from `_nav.ts` between Column Layout and Custom Rendering.

`api-reference.mdx` — extends `PretableColumn` with the new fields. Drops `formatForCopy`. Adds `PretableCellRenderInput`, `PretableHeaderRenderInput`, `PretableFormatInput` types.

`pretable-surface.mdx` — props table is unchanged (no new surface props; per-column renderers are the customization seam now). `LabeledGridSurface` continues to use grid-level `renderBodyCell` — no migration required.

The existing `apps/website/content/docs/grid/custom-rendering.mdx` page (which currently describes the grid-level `renderBodyCell` pattern with hooks) gets an updated section pointing readers at per-column renderers as the canonical surface for cell customization, with grid-level `renderBodyCell` documented as the fallback / `<LabeledGridSurface>` integration point.

## Exit criteria

- `column.value` (was `getValue`) renamed across engine, copy, React adapter, bench adapter, hero demo, tests, and docs.
- `column.format` field added at engine level; `column.render` and `column.renderHeader` added at React level. Pipeline: value → format → render with sensible defaults.
- `column.formatForCopy` removed; copy uses `column.format`. B Phase 5 copy tests migrated.
- Cell-level `React.memo` with the documented `areEqual` contract. jsdom tests verify cell DOM is reused across parent re-renders that don't touch the cell's inputs.
- Synthetic row-select column ignores all three renderer hooks.
- Three new bench hypotheses (H19, H20, H21) pass at S2/hypothesis on repeated Chromium runs. Evidence under `status/runsets/`.
- New `cell-renderers.mdx` docs page; `api-reference.mdx` updated; `_nav.ts` entry added.
- `pnpm -w typecheck` / `test` / `lint` / `format` clean across all three phases.

## Open items tracked elsewhere

- Cell editing → separate sub-project, future brainstorm.
- Comparative bench (Slab 2) for cell renderers → future sub-project, follows D3.
- `LabeledGridSurface` per-column renderer migration — opportunistic, not required by D's exit criteria.
- Theming integration for renderer-rendered nodes — covered by `project_theming_architecture_followup.md`.
