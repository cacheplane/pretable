# Playground Controlled Interaction Design

## Goal

Surface proven engine capabilities — sorting, controlled interaction state, and visual indicators — in the playground's inspection table, using the engine's canonical controlled API rather than manual state management.

## Current Behavior

The playground (`apps/playground/src/inspection-demo.tsx`) manages interaction state manually:

- **Filtering:** Separate `useState<Record<string, string>>` for filters. The playground computes `filteredRows` in userland via `getInspectionFilterValue`, then passes the pre-filtered array to `InspectionGrid` as `rows`. The engine never knows about filters.
- **Selection:** Separate `useState<string | null>` for `selectedRowId`, passed to `InspectionGrid` via `onSelectedRowIdChange`. Selection is partially controlled — the callback fires, but the state isn't passed back to `PretableSurface` via `interactionState`.
- **Sorting:** Not surfaced at all. No click-to-sort on headers. The engine supports sorting via `interactionState.sort` and `grid.setSort`, and `LabeledGridSurface` already renders sort labels, but `InspectionGrid` never passes `interactionState` through.

The result: the playground doesn't demonstrate sorting, uses a duplicate filtering path that bypasses the engine, and manages state through ad-hoc hooks instead of the engine's controlled interface.

## Target Behavior

The playground uses a single `interactionState` object (`{ sort, filters, selectedRowId }`) passed through `InspectionGrid` → `LabeledGridSurface` → `PretableSurface`. The engine handles filtering, sorting, and selection internally via `interactionOverrides` in `usePretableModel`.

- **Sorting:** Column headers are clickable. Clicking cycles null → asc → desc → null. A `▲` or `▼` glyph appears after the header label for sorted columns.
- **Filtering:** The existing top-level filter text inputs remain. They write into `interactionState.filters` instead of a separate state. The engine filters rows internally. The playground passes `dataset.rows` (unfiltered) to `InspectionGrid`. Header cells for columns with active filters show a 2px bottom border accent.
- **Selection:** Flows through `interactionState.selectedRowId`. The existing `onSelectedRowIdChange` callback updates the playground's state.

## Changes

### apps/playground/src/inspection-demo.tsx

Replace the three separate `useState` hooks (`filters`, `selectedRowId`, and the derived `filteredRows` memo) with a single `interactionState` object:

```typescript
const [interactionState, setInteractionState] = useState<{
  sort: { columnId: string; direction: "asc" | "desc" } | null;
  filters: Record<string, string>;
  selectedRowId: string | null;
}>({
  sort: null,
  filters: {},
  selectedRowId: null,
});
```

- Pass `dataset.rows` (all rows, unfiltered) to `InspectionGrid` instead of `filteredRows`.
- Pass `interactionState` to `InspectionGrid`.
- Pass `onSortChange` callback that updates `interactionState.sort`.
- Wire filter inputs to update `interactionState.filters`.
- Wire `onSelectedRowIdChange` to update `interactionState.selectedRowId`.
- Remove the `filteredRows` memo and the `getInspectionFilterValue` import.
- Update the "matching rows" count in the status card to use telemetry (the engine's `visibleRowCount` from `onTelemetryChange`) instead of `filteredRows.length`.

### packages/react/src/internal/inspection-grid.tsx

Add `interactionState` and `onSortChange` props. Pass them through to `LabeledGridSurface`.

### packages/react/src/internal/labeled-grid-surface.tsx

Add `interactionState` and `onSortChange` props. Pass `interactionState` to `PretableSurface`. Pass `onSortChange` to `PretableSurface`.

Update `renderHeaderCell` to show sort direction glyphs (`▲` for asc, `▼` for desc) instead of the current text labels ("Oldest" / "Newest" / "Sort"). Add a visual indicator for active filter columns — pass `activeFilters` from `interactionState.filters` to the header renderer and apply a CSS class when a column has an active filter.

### packages/react/src/internal/pretable-surface.tsx

Add `onSortChange` prop:

```typescript
onSortChange?: (sort: { columnId: string; direction: "asc" | "desc" } | null) => void;
```

In the header click handler, call `onSortChange` with the next sort state in addition to the existing `grid.setSort(...)`. The `grid.setSort` call stays for uncontrolled mode; `onSortChange` lets the controlled consumer update its state. On the next render, `interactionOverrides` applies the consumer's updated state.

No other changes to `PretableSurface`. The `interactionState` prop already exists and works. Selection already flows through `onSelectedRowIdChange`.

### apps/playground/src/styles.css (or equivalent)

- Add `cursor: pointer` to column headers (may already exist via the `<button>` element).
- Add sort glyph styling: reduced opacity (e.g., `opacity: 0.6`) so the indicator reads as secondary.
- Add active-filter header indicator: a 2px bottom border accent on header cells for filtered columns.

## What This Does Not Change

- `PretableSurface` behavior for uncontrolled consumers (no `interactionState` prop) — unchanged.
- `grid-core` — no changes. Filtering, sorting, and state management already work.
- `@pretable-internal/bench-runner` — no changes. Bench paths don't use the playground.
- `apps/bench` — no changes.
- The 6-column inspection dataset structure, virtual scrolling, and viewport behavior.
- Row selection and keyboard navigation UX — same behavior, just wired through controlled state.
- The sidebar detail panel.
- Column focus — stays row-level keyboard nav for this cut.
- Column-level filter UI — filtering stays as top-level text inputs.

## Tests

### Lock-in: engine filtering matches playground filtering

File: `apps/playground/src/__tests__/inspection-demo.test.tsx` (or nearest existing test)

Verify that when `interactionState.filters` is passed to the engine, the resulting visible rows match what the old `getInspectionFilterValue` path produced. This locks in that the migration doesn't change filter behavior.

### Sort cycle through controlled state

File: `apps/playground/src/__tests__/inspection-demo.test.tsx`

Render the inspection demo, click a column header, verify the grid is sorted (first visible row changes). Click again, verify reverse sort. Click again, verify sort is cleared.

### Sort indicator rendering

File: `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx` (or nearest)

Verify that `renderHeaderCell` produces `▲` when `sortDirection` is `"asc"`, `▼` when `"desc"`, and no glyph when `null`.

### Filter indicator rendering

File: `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`

Verify that header cells for columns with active filters receive the indicator class.

### Regression: existing bench and surface tests green

Run: `pnpm --filter @pretable/react test` and `pnpm --filter @pretable/app-bench test`

The bench adapter tests and pretable-surface tests must remain green since the uncontrolled path is unchanged.

## Verification

1. Unit suites:
   - `pnpm --filter @pretable/react test`
   - `pnpm --filter @pretable/app-bench test`
   - `pnpm --filter @pretable/app-playground test`
2. Typecheck: `pnpm -r typecheck`
3. Manual playground verification:
   - `pnpm --filter @pretable/app-playground dev`
   - Click column headers → verify sort cycle with ▲/▼ indicators
   - Type in filter inputs → verify filtered column headers show indicator
   - Select rows → verify selection persists across sort and filter changes
   - Arrow keys → verify keyboard nav works through sorted/filtered rows
   - Status card "matching rows" count reflects filtered result
4. Bench regression: `pnpm bench:e2e -- --project=chromium` (default pretable/S1/initial path still works)

## Open Questions

- **Sort glyph vs. SVG icon:** The design uses Unicode glyphs (`▲`/`▼`). If these render inconsistently across platforms, swap to inline SVG. Decide during implementation.

## Risk

Low. The core engine changes are limited to adding one callback (`onSortChange`) to `PretableSurface`. The rest is wiring existing props through the component chain and simplifying the playground's state management. The controlled `interactionState` path is already used by the bench adapter and proven at hypothesis scale.
