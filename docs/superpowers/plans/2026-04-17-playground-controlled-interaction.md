# Playground Controlled Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface sorting, controlled interaction state, and visual sort/filter indicators in the playground's inspection table, replacing manual state management with the engine's canonical controlled API.

**Architecture:** Add `onSortChange` callback to `PretableSurface`. Thread `interactionState` and `onSortChange` through `LabeledGridSurface` and `InspectionGrid`. Replace the playground's manual filter/selection state and userland filtering with a single `interactionState` object, letting the engine handle filtering and sorting internally. Update header rendering in `LabeledGridSurface` to show sort glyphs and filter indicators.

**Tech Stack:** React 18, Vitest, @testing-library/react, @pretable/core grid-core engine

---

### Task 1: Add `onSortChange` callback to `PretableSurface`

**Files:**
- Modify: `packages/react/src/internal/pretable-surface.tsx:106-144` (props interface)
- Modify: `packages/react/src/internal/pretable-surface.tsx:146-166` (function signature)
- Modify: `packages/react/src/internal/pretable-surface.tsx:327-329` (header click handler)
- Test: `packages/react/src/internal/__tests__/pretable-surface.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/react/src/internal/__tests__/pretable-surface.test.tsx`, add a new test after the existing tests. First, read the file to find the right import pattern and test structure, then add:

```typescript
it("calls onSortChange when a column header is clicked", () => {
  const onSortChange = vi.fn();
  const view = render(
    <PretableSurface
      ariaLabel="Test grid"
      columns={columns}
      getRowId={(row) => row.id}
      onSortChange={onSortChange}
      overscan={0}
      rows={rows}
      viewportHeight={132}
    />,
  );

  const timestampHeader = view.getByRole("button", { name: "Sort Timestamp" });

  fireEvent.click(timestampHeader);

  expect(onSortChange).toHaveBeenCalledWith({
    columnId: "timestamp",
    direction: "desc",
  });

  fireEvent.click(timestampHeader);

  expect(onSortChange).toHaveBeenCalledWith({
    columnId: "timestamp",
    direction: "asc",
  });

  fireEvent.click(timestampHeader);

  expect(onSortChange).toHaveBeenCalledWith(null);
});
```

Use the same `columns` and `rows` fixtures already defined in the test file. If the file uses different fixture variable names, match them.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --environment jsdom`

Expected: FAIL — `onSortChange` is not a recognized prop (TypeScript) or is never called.

- [ ] **Step 3: Add `onSortChange` to `PretableSurfaceProps` and wire it**

In `packages/react/src/internal/pretable-surface.tsx`:

1. Add to the `PretableSurfaceProps` interface (after `onSelectedRowIdChange` on line 132):

```typescript
  onSortChange?: (sort: { columnId: string; direction: "asc" | "desc" } | null) => void;
```

2. Add `onSortChange` to the destructured props in the function signature (after `onSelectedRowIdChange` on line ~158):

```typescript
  onSortChange,
```

3. In the header click handler (line ~327-329), add the `onSortChange` call after `grid.setSort`:

```typescript
              onClick={() => {
                const nextDirection = getNextSortDirection(sortDirection);
                grid.setSort(column.id, nextDirection);
                if (nextDirection) {
                  onSortChange?.({ columnId: column.id, direction: nextDirection });
                } else {
                  onSortChange?.(null);
                }
              }}
```

This replaces the existing onClick handler which is:
```typescript
              onClick={() => {
                grid.setSort(column.id, getNextSortDirection(sortDirection));
              }}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/pretable-surface.test.tsx --environment jsdom`

Expected: PASS

- [ ] **Step 5: Run the full react package test suite to check for regressions**

Run: `pnpm --filter @pretable/react test`

Expected: All tests pass. The existing tests don't pass `onSortChange`, so uncontrolled behavior is unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/internal/pretable-surface.tsx packages/react/src/internal/__tests__/pretable-surface.test.tsx
git commit -m "feat(react): add onSortChange callback to PretableSurface"
```

---

### Task 2: Thread `interactionState` and `onSortChange` through `LabeledGridSurface`

**Files:**
- Modify: `packages/react/src/internal/labeled-grid-surface.tsx:22-50` (props interface)
- Modify: `packages/react/src/internal/labeled-grid-surface.tsx:52-139` (component)
- Test: `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`, add a new test after the existing tests:

```typescript
it("passes interactionState and onSortChange through to the underlying surface", () => {
  const onSortChange = vi.fn();
  const view = render(
    <LabeledGridSurface
      ariaLabel="Inspection grid"
      columns={columns}
      getRowId={(row) => row.id}
      interactionState={{
        sort: { columnId: "timestamp", direction: "desc" },
        filters: {},
      }}
      onSortChange={onSortChange}
      overscan={0}
      rows={rows}
      viewportHeight={132}
    />,
  );

  const severityHeader = view.getByRole("button", { name: "Sort Severity" });

  fireEvent.click(severityHeader);

  expect(onSortChange).toHaveBeenCalledWith({
    columnId: "severity",
    direction: "desc",
  });
});
```

Use the same `columns` and `rows` fixtures already in the file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/labeled-grid-surface.test.tsx --environment jsdom`

Expected: FAIL — `interactionState` and `onSortChange` are not recognized props on `LabeledGridSurface`.

- [ ] **Step 3: Add props and pass them through**

In `packages/react/src/internal/labeled-grid-surface.tsx`:

1. Add the import for `PretableSurfaceProps` if not already imported (it's already imported on line 10-12):

```typescript
import {
  type PretableSurfaceProps,
  PretableSurface,
} from "./pretable-surface";
```

2. Add to `LabeledGridSurfaceProps` interface (after `getHeaderCellProps`, around line 38):

```typescript
  interactionState?: PretableSurfaceProps<TRow>["interactionState"];
  onSortChange?: PretableSurfaceProps<TRow>["onSortChange"];
```

3. Destructure them in the component function (add after `getHeaderCellProps` in the destructure around line 60):

```typescript
  interactionState,
  onSortChange,
```

4. Pass them to `PretableSurface` (add after `getHeaderCellClassName` prop around line 100):

```typescript
      interactionState={interactionState}
      onSortChange={onSortChange}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/labeled-grid-surface.test.tsx --environment jsdom`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/internal/labeled-grid-surface.tsx packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx
git commit -m "feat(react): thread interactionState and onSortChange through LabeledGridSurface"
```

---

### Task 3: Thread `interactionState` and `onSortChange` through `InspectionGrid`

**Files:**
- Modify: `packages/react/src/internal/inspection-grid.tsx:20-28` (props interface)
- Modify: `packages/react/src/internal/inspection-grid.tsx:30-67` (component)
- Test: `packages/react/src/internal/__tests__/inspection-grid.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/react/src/internal/__tests__/inspection-grid.test.tsx`, add a new test after the existing tests:

```typescript
it("threads interactionState and onSortChange to the underlying surface", () => {
  const dataset = createInspectionDataset("tiny");
  const onSortChange = vi.fn();
  const view = render(
    <InspectionGrid
      ariaLabel="Inspection grid"
      filterableColumnIds={inspectionFilterableColumnIds}
      interactionState={{
        sort: null,
        filters: {},
      }}
      onSortChange={onSortChange}
      overscan={0}
      rows={[...dataset.rows]}
      viewportHeight={132}
    />,
  );

  const timestampHeader = view.getByRole("button", { name: "Sort Timestamp" });

  fireEvent.click(timestampHeader);

  expect(onSortChange).toHaveBeenCalledWith({
    columnId: "timestamp",
    direction: "desc",
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/inspection-grid.test.tsx --environment jsdom`

Expected: FAIL — `interactionState` and `onSortChange` are not recognized props on `InspectionGrid`.

- [ ] **Step 3: Add props and pass them through**

In `packages/react/src/internal/inspection-grid.tsx`:

1. Add the import for `PretableSurfaceProps`:

```typescript
import type { PretableSurfaceProps } from "./pretable-surface";
```

2. Add to `InspectionGridProps` interface (after `filterableColumnIds`, around line 23):

```typescript
  interactionState?: PretableSurfaceProps<InspectionRow>["interactionState"];
  onSortChange?: PretableSurfaceProps<InspectionRow>["onSortChange"];
```

3. Destructure them in the component function (after `filterableColumnIds` in the destructure around line 33):

```typescript
  interactionState,
  onSortChange,
```

4. Pass them to `LabeledGridSurface` (add after the `getHeaderCellProps` prop around line 51):

```typescript
        interactionState={interactionState}
        onSortChange={onSortChange}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/inspection-grid.test.tsx --environment jsdom`

Expected: PASS

- [ ] **Step 5: Run the full react package test suite**

Run: `pnpm --filter @pretable/react test`

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/internal/inspection-grid.tsx packages/react/src/internal/__tests__/inspection-grid.test.tsx
git commit -m "feat(react): thread interactionState and onSortChange through InspectionGrid"
```

---

### Task 4: Update sort indicator glyphs in `LabeledGridSurface`

**Files:**
- Modify: `packages/react/src/internal/labeled-grid-surface.tsx:128-133` (renderHeaderCell)
- Modify: `packages/react/src/internal/labeled-grid-surface.tsx:163-173` (getSortLabel)
- Test: `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`, add a new test:

```typescript
it("shows sort direction glyphs in header cells", () => {
  const view = render(
    <LabeledGridSurface
      ariaLabel="Inspection grid"
      columns={columns}
      getRowId={(row) => row.id}
      interactionState={{
        sort: { columnId: "timestamp", direction: "desc" },
        filters: {},
      }}
      overscan={0}
      rows={rows}
      viewportHeight={132}
    />,
  );

  const timestampHeader = view.getByRole("button", { name: "Sort Timestamp" });
  const severityHeader = view.getByRole("button", { name: "Sort Severity" });

  expect(timestampHeader).toHaveTextContent("Timestamp▼");
  expect(severityHeader).not.toHaveTextContent("▼");
  expect(severityHeader).not.toHaveTextContent("▲");

  view.rerender(
    <LabeledGridSurface
      ariaLabel="Inspection grid"
      columns={columns}
      getRowId={(row) => row.id}
      interactionState={{
        sort: { columnId: "timestamp", direction: "asc" },
        filters: {},
      }}
      overscan={0}
      rows={rows}
      viewportHeight={132}
    />,
  );

  expect(timestampHeader).toHaveTextContent("Timestamp▲");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/labeled-grid-surface.test.tsx --environment jsdom`

Expected: FAIL — the header shows "Newest" / "Oldest" / "Sort" instead of glyphs.

- [ ] **Step 3: Update `renderHeaderCell` and `getSortLabel`**

In `packages/react/src/internal/labeled-grid-surface.tsx`:

1. Replace the `renderHeaderCell` prop on `PretableSurface` (lines 128-133):

```typescript
      renderHeaderCell={({ label, sortDirection }) => (
        <>
          <span>{label}</span>
          {sortDirection ? (
            <span className="sort-indicator">
              {sortDirection === "desc" ? "▼" : "▲"}
            </span>
          ) : null}
        </>
      )}
```

2. Remove the `getSortLabel` function (lines 163-173) — it is no longer used.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/labeled-grid-surface.test.tsx --environment jsdom`

Expected: PASS

- [ ] **Step 5: Update the existing test expectation**

The existing test in `labeled-grid-surface.test.tsx` at line 108 asserts `expect(timestampHeader).toHaveTextContent("Newest")` after clicking the timestamp header. This needs to change to match the new glyph rendering.

Update line 108:

```typescript
    expect(timestampHeader).toHaveTextContent("Timestamp▼");
```

- [ ] **Step 6: Run the full react package test suite**

Run: `pnpm --filter @pretable/react test`

Expected: All tests pass including the updated assertion.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/internal/labeled-grid-surface.tsx packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx
git commit -m "feat(react): replace sort text labels with glyph indicators in LabeledGridSurface"
```

---

### Task 5: Add filter indicator styling to `LabeledGridSurface` headers

**Files:**
- Modify: `packages/react/src/internal/labeled-grid-surface.tsx` (getHeaderCellClassName callback)
- Modify: `apps/playground/src/app.css` (add filter indicator CSS)
- Test: `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`

- [ ] **Step 1: Write the failing test**

In `packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx`, add a new test:

```typescript
it("applies a filter-active class to header cells for filtered columns", () => {
  const view = render(
    <LabeledGridSurface
      ariaLabel="Inspection grid"
      columns={columns}
      getRowId={(row) => row.id}
      headerCellClassName="inspection-header-cell"
      interactionState={{
        sort: null,
        filters: { severity: "error" },
      }}
      overscan={0}
      rows={rows}
      viewportHeight={132}
    />,
  );

  const severityHeader = view.getByRole("button", { name: "Sort Severity" });
  const timestampHeader = view.getByRole("button", { name: "Sort Timestamp" });

  expect(severityHeader).toHaveClass("is-filtered");
  expect(timestampHeader).not.toHaveClass("is-filtered");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/labeled-grid-surface.test.tsx --environment jsdom`

Expected: FAIL — no `is-filtered` class on any header cell.

- [ ] **Step 3: Add the `is-filtered` class based on `interactionState.filters`**

In `packages/react/src/internal/labeled-grid-surface.tsx`:

1. The component already has `interactionState` destructured from Task 2. Extract the active filter column ids:

Add this line inside the component function body, after the existing `getFormattedValue` declaration:

```typescript
  const activeFilterColumns = new Set(
    Object.entries(interactionState?.filters ?? {})
      .filter(([, value]) => value.trim() !== "")
      .map(([columnId]) => columnId),
  );
```

2. Update the `getHeaderCellClassName` callback passed to `PretableSurface`. Replace the existing one (around line 98-100):

```typescript
      getHeaderCellClassName={({ column }) =>
        joinClassNames(
          headerCellClassName,
          getPinnedClassName(column),
          activeFilterColumns.has(column.id) ? "is-filtered" : undefined,
        )
      }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @pretable/react exec vitest run src/internal/__tests__/labeled-grid-surface.test.tsx --environment jsdom`

Expected: PASS

- [ ] **Step 5: Add CSS for the filter indicator**

In `apps/playground/src/app.css`, add after the `.inspection-header-cell strong` rule (after line 246):

```css
.inspection-header-cell.is-filtered {
  border-bottom: 2px solid #f3cb75;
}

.sort-indicator {
  color: #f3cb75;
  font-size: 0.83rem;
  opacity: 0.6;
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/internal/labeled-grid-surface.tsx packages/react/src/internal/__tests__/labeled-grid-surface.test.tsx apps/playground/src/app.css
git commit -m "feat(react): add filter indicator class and sort glyph styling to headers"
```

---

### Task 6: Migrate `inspection-demo.tsx` to controlled `interactionState`

**Files:**
- Modify: `apps/playground/src/inspection-demo.tsx` (full component rewrite of state management)
- Test: `apps/playground/src/__tests__/inspection-demo.test.tsx`

This is the main playground migration. The existing tests in `inspection-demo.test.tsx` serve as the regression gate — they must all pass after the migration.

- [ ] **Step 1: Read the current `inspection-demo.tsx` and `inspection-demo.test.tsx`**

Read both files to understand the current state and test expectations before making changes.

- [ ] **Step 2: Replace the entire `inspection-demo.tsx` with the controlled version**

Replace the full content of `apps/playground/src/inspection-demo.tsx` with:

```typescript
import {
  createInspectionDataset,
  inspectionColumns,
  inspectionDatasetScaleOptions,
  type InspectionDatasetScale,
} from "@pretable-internal/scenario-data";
import {
  InspectionGrid,
  type PretableTelemetry,
} from "@pretable/react/internal";
import { useMemo, useState } from "react";

const VIEWPORT_HEIGHT = 420;
const OVERSCAN_ROWS = 5;

interface InteractionState {
  sort: { columnId: string; direction: "asc" | "desc" } | null;
  filters: Record<string, string>;
  selectedRowId: string | null;
}

export function InspectionDemo() {
  const [interactionState, setInteractionState] = useState<InteractionState>({
    sort: null,
    filters: {},
    selectedRowId: null,
  });
  const [scale, setScale] = useState<InspectionDatasetScale>("dev");
  const [telemetry, setTelemetry] = useState<PretableTelemetry | null>(null);
  const dataset = useMemo(() => createInspectionDataset(scale), [scale]);

  const selectedRow = useMemo(
    () =>
      dataset.rows.find((row) => row.id === interactionState.selectedRowId) ??
      null,
    [dataset.rows, interactionState.selectedRowId],
  );

  return (
    <section className="inspection-demo">
      <div className="inspection-controls">
        <div className="inspection-copy">
          <p className="eyebrow">Prototype playground</p>
          <h1>Read-heavy inspection table</h1>
          <p>
            This surface is the first honest product wedge: wrapped text,
            pinned metadata, local filtering, and stable keyboard/selection
            behavior on the same core and renderer path used by the benchmark
            work.
          </p>
        </div>

        <div className="inspection-status-card">
          <span>Current slice</span>
          <strong>Inspection workflow</strong>
          <p>{telemetry?.visibleRowCount ?? dataset.rows.length} matching rows</p>
          <p>Scale: {scale}</p>
          <dl data-testid="inspection-diagnostics">
            <div>
              <dt>Rendered rows</dt>
              <dd>{telemetry?.renderedRowCount ?? 0}</dd>
            </div>
            <div>
              <dt>Visible rows</dt>
              <dd>{telemetry?.visibleRowCount ?? 0}</dd>
            </div>
            <div>
              <dt>Planned height</dt>
              <dd>{telemetry?.totalHeight ?? 0}</dd>
            </div>
            <div>
              <dt>Viewport range</dt>
              <dd>
                {telemetry
                  ? `${telemetry.visibleRowRange.start}-${telemetry.visibleRowRange.end}`
                  : "0-0"}
              </dd>
            </div>
            <div>
              <dt>Selected row</dt>
              <dd>{telemetry?.selectedRowId ?? "none"}</dd>
            </div>
            <div>
              <dt>Scale</dt>
              <dd>{scale}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="inspection-layout">
        <article className="inspection-surface">
          <header className="inspection-panel-header">
            <div>
              <h2>Signal view</h2>
              <p>
                Filter by known metadata first, then move through the stream
                with the keyboard once a row is selected.
              </p>
            </div>
            <div className="inspection-keymap">
              <span>Arrows move focus</span>
              <span>Click selects</span>
            </div>
          </header>

          <div className="inspection-toolbar">
            <label className="filter-field">
              <span>Dataset scale</span>
              <select
                aria-label="Dataset scale"
                value={scale}
                onChange={(event) => {
                  setScale(event.currentTarget.value as InspectionDatasetScale);
                }}
              >
                {inspectionDatasetScaleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {dataset.filterableColumnIds.map((columnId) => {
              const column = inspectionColumns.find(
                (candidate) => candidate.id === columnId,
              );
              const label = column?.header ?? columnId;

              return (
                <label className="filter-field" key={columnId}>
                  <span>{label}</span>
                  <input
                    aria-label={`Filter ${label}`}
                    value={interactionState.filters[columnId] ?? ""}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;

                      setInteractionState((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          [columnId]: nextValue,
                        },
                      }));
                    }}
                    placeholder={`Filter ${label.toLowerCase()}`}
                  />
                </label>
              );
            })}
          </div>

          <div className="inspection-grid-shell">
            <InspectionGrid
              ariaLabel="Inspection grid"
              filterableColumnIds={dataset.filterableColumnIds}
              interactionState={interactionState}
              onSelectedRowIdChange={(rowId) => {
                setInteractionState((current) => ({
                  ...current,
                  selectedRowId: rowId,
                }));
              }}
              onSortChange={(sort) => {
                setInteractionState((current) => ({
                  ...current,
                  sort,
                }));
              }}
              onTelemetryChange={setTelemetry}
              overscan={OVERSCAN_ROWS}
              rows={[...dataset.rows]}
              viewportHeight={VIEWPORT_HEIGHT}
            />
          </div>
        </article>

        <aside className="inspection-sidebar" data-testid="inspection-detail">
          <header className="inspection-panel-header">
            <div>
              <h2>Selected event</h2>
              <p>
                Selection stays keyed by event id, even when local filters hide
                the row from the viewport.
              </p>
            </div>
          </header>

          {selectedRow ? (
            <dl className="inspection-detail-list">
              <div>
                <dt>Event</dt>
                <dd>{selectedRow.id}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>{selectedRow.timestamp}</dd>
              </div>
              <div>
                <dt>Severity</dt>
                <dd>{selectedRow.severity}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedRow.source}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{selectedRow.owner}</dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{selectedRow.tags.join(", ")}</dd>
              </div>
              <div className="detail-message">
                <dt>Message</dt>
                <dd>{selectedRow.message}</dd>
              </div>
            </dl>
          ) : (
            <p className="inspection-empty">
              Pick a row to inspect the current event payload.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}
```

Key changes from the original:
1. Removed `getInspectionFilterValue` import — engine handles filtering.
2. Removed `filters` and `selectedRowId` as separate `useState` — consolidated into `interactionState`.
3. Removed `filteredRows` memo — no more userland filtering. All rows passed directly.
4. `interactionState` passed to `InspectionGrid`.
5. `onSortChange` wired to update `interactionState.sort`.
6. `onSelectedRowIdChange` wired to update `interactionState.selectedRowId`.
7. Filter inputs write to `interactionState.filters`.
8. Matching rows count uses `telemetry?.visibleRowCount` instead of `filteredRows.length`.

- [ ] **Step 3: Run the existing test suite to check regression**

Run: `pnpm --filter @pretable/app-playground test`

Expected: The existing tests may need adjustments because the "matching rows" text now comes from telemetry rather than a pre-filtered array. Specifically:

- The "250 matching rows" / "7 matching rows" / "2500 matching rows" test depends on `filteredRows.length`. With the engine handling filtering, the initial count before telemetry updates will be `dataset.rows.length` via the fallback `telemetry?.visibleRowCount ?? dataset.rows.length`. This should still produce the correct count since with no filters, `visibleRowCount` equals `dataset.rows.length`.
- The "62 matching rows" assertion after filtering by severity "error" should still work because the engine filters identically to the old userland path (`String(row[columnId]).toLowerCase().includes(needle)` matches `getInspectionFilterValue(row, columnId).toLowerCase().includes(filter)`).

If tests pass, proceed to Step 5. If any test fails, proceed to Step 4.

- [ ] **Step 4: Fix any failing test assertions (if needed)**

If the "matching rows" count assertions fail due to telemetry timing (the initial render showing `dataset.rows.length` before the engine computes `visibleRowCount`), wrap the assertion in a `waitFor`:

For example, if `"62 matching rows"` is not found immediately, change the filter test assertion from:
```typescript
expect(screen.getByText("62 matching rows")).toBeInTheDocument();
```
to:
```typescript
await waitFor(() => {
  expect(screen.getByText("62 matching rows")).toBeInTheDocument();
});
```

And make the test function `async`.

- [ ] **Step 5: Run typecheck**

Run: `pnpm -r typecheck`

Expected: Clean — no type errors.

- [ ] **Step 6: Commit**

```bash
git add apps/playground/src/inspection-demo.tsx apps/playground/src/__tests__/inspection-demo.test.tsx
git commit -m "feat(playground): migrate to controlled interactionState with engine-driven filtering and sorting"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run all affected unit test suites**

Run: `pnpm --filter @pretable/react test && pnpm --filter @pretable/app-playground test && pnpm --filter @pretable/app-bench test`

Expected: All tests pass across react, playground, and bench packages.

- [ ] **Step 2: Run typecheck**

Run: `pnpm -r typecheck`

Expected: Clean.

- [ ] **Step 3: Run the default bench:e2e to verify no bench regression**

Run: `pnpm bench:e2e -- --project=chromium`

Expected: PASS — the default pretable/S1/initial path is unaffected by playground changes.

- [ ] **Step 4: Commit the plan document**

```bash
git add docs/superpowers/plans/2026-04-17-playground-controlled-interaction.md
git commit -m "docs: add playground controlled interaction implementation plan"
```
