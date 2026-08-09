# Row Grouping Correctness Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every shipped grouping interaction use the same derived rows and columns the user sees, with rectangular copy output, valid focus/selection, complete treegrid accessibility, deterministic keyboard focus, and a releasable changeset.

**Architecture:** `grid-core` remains the authority for derived rows/columns and gains one reconciliation path for focus after visible-model mutations. React consumes that derived address space, shares aggregate formatting between rendering and copy, and coordinates post-grouping DOM focus without adding public props. The existing panel overflow design and SP4 docs/hero/bench work remain separate follow-ups.

**Tech Stack:** TypeScript, React 19, Vitest, Testing Library/jsdom, Playwright (Chromium + WebKit), API Extractor, Changesets, pnpm workspaces.

---

## Governing spec and execution rules

- Spec: `docs/superpowers/specs/2026-08-08-row-grouping-correctness-followup-design.md`
- Use `@superpowers:test-driven-development` for every behavior change: add the
  smallest failing test, run it red, implement, and run it green.
- Use one implementation worker at a time. After each task, run a spec review
  and then a code-quality review as required by
  `@superpowers:subagent-driven-development`.
- Do not cherry-pick production code from `abandoned-grouping-surface`; its
  grouped-column rendering model conflicts with the shipped synthetic
  `GROUP_COLUMN_ID` architecture.
- Do not implement panel wrapping/autoscroll, SP4 option plumbing, docs/hero,
  benchmarks, or speculative group-row memoization in this plan.
- Preserve unrelated user changes if the worktree becomes dirty.

## File map

**Engine authority**

- `packages/grid-core/src/create-grid-core.ts` — visible full-row selection,
  non-selectable group navigation, semantic-column invalidation, and focus
  reconciliation after row/filter/group mutations.
- `packages/grid-core/src/group-column.ts` — derived group-column capabilities.
- `packages/grid-core/src/__tests__/grouping-engine.test.ts` — grouped selection,
  focus, filter, streaming, and regrouping regressions.
- `packages/grid-core/src/__tests__/group-column.test.ts` — group-column flags and
  prop-merge invalidation.
- `packages/grid-core/src/__tests__/selection-state.test.ts` — `clearSelection`
  and row-toggle edge behavior.

**React serialization and rendering**

- `packages/react/src/rendering.ts` — shared aggregate string formatter.
- `packages/react/src/group-row.tsx` — consume the shared formatter.
- `packages/react/src/copy.ts` — rectangular group-row TSV/HTML output.
- `packages/react/src/__tests__/copy.test.ts` — serializer contract.
- `packages/react/src/__tests__/group-row-render.test.tsx` — renderer parity and
  leaf/tree metadata.

**React surface accessibility and focus**

- `packages/react/src/pretable-surface.tsx` — group-only click behavior,
  treegrid counts/levels, copy extent, live portal, keyboard ownership,
  expansion announcements, and post-mutation DOM focus.
- `packages/react/src/group-panel/GroupPanel.tsx` — report chip/header focus intent
  with each grouping mutation.
- `packages/react/src/column-menu/ColumnMenu.tsx` — restore the anchor only on
  dismissal, not after an action that removes it.
- `packages/react/src/column-menu/MenuButton.tsx` — publish button nodes for
  internal focus restoration.
- `packages/react/src/__tests__/pretable-surface.test.tsx` — surface keyboard,
  selection, ARIA, copy-count, live-region, and announcement tests.
- `packages/react/src/__tests__/group-panel.test.tsx` — chip focus intent.
- `packages/react/src/__tests__/column-menu.test.tsx` — action-vs-dismiss focus.

**Browser and release**

- `apps/website/app/fixtures/grouping/page.tsx` — deterministic copy sink and
  keyboard-focus assertions.
- `apps/website/e2e/grouping.spec.ts` — real-browser keyboard grouping, focus,
  and grouped copy.
- `packages/react/react.api.md` — API Extractor baseline for message factories.
- `.changeset/fuzzy-groups-align.md` — patch release record for the fixed package
  group.

---

### Task 1: Use effective columns for grouped full-row behavior

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts:375-525`
- Modify: `packages/grid-core/src/group-column.ts:71-90`
- Test: `packages/grid-core/src/__tests__/grouping-engine.test.ts:618-749`
- Test: `packages/grid-core/src/__tests__/group-column.test.ts:28-176`
- Test: `packages/react/src/__tests__/pretable-surface.test.tsx:5083-5190`

- [ ] **Step 1: Add failing engine tests for effective full-row bounds**

In the existing “group rows are focusable but never selectable” suite, use a
fixture with source columns `sector`, `name`, `qty`, group by `sector`, and
assert all three built-ins use ids returned by `grid.getColumns()`:

```ts
const visibleColumnIds = grid.getColumns().map((column) => column.id);
expect(visibleColumnIds).toEqual([GROUP_COLUMN_ID, "name", "qty"]);

grid.selectAll();
expect(grid.getSnapshot().selection.ranges).toEqual([
  expect.objectContaining({
    startColumnId: GROUP_COLUMN_ID,
    endColumnId: "qty",
  }),
]);

grid.clearSelection();
grid.toggleRowSelection("r1");
expect(grid.getSnapshot().selection.ranges[0]).toMatchObject({
  startColumnId: GROUP_COLUMN_ID,
  endColumnId: "qty",
});

grid.setSelectAllVisible(true);
expect(grid.getSnapshot().selection.ranges).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      startColumnId: GROUP_COLUMN_ID,
      endColumnId: "qty",
    }),
  ]),
);
```

Keep the collapsed-groups no-op assertion: no visible data row still means
nothing selectable.

- [ ] **Step 2: Add a failing group-column capability test**

Extend `group-column.test.ts`:

```ts
test("the synthetic group column cannot resize or reorder", () => {
  const grid = makeGrid();
  grid.setRowGroups(["sector"]);
  const groupColumn = grid.getColumns().find((c) => c.id === GROUP_COLUMN_ID);
  expect(groupColumn).toMatchObject({
    sortable: false,
    filterable: false,
    resizable: false,
    reorderable: false,
  });
});
```

- [ ] **Step 3: Run the focused engine tests and confirm red**

Run:

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine group-column
```

Expected: the new bounds still contain hidden `sector`, and the group column's
resize/reorder flags are `undefined`.

- [ ] **Step 4: Implement effective bounds and inert capabilities**

In `selectAll`, `toggleRowSelection`, and `setSelectAllVisible`, replace reads
of `options.columns[0/last]` with one `const effectiveColumns = getColumns()` and
take its first/last entries. Do not special-case `GROUP_COLUMN_ID`; the existing
row-select synthetic column remains an endpoint when it is actually first in
the effective/pinned order.

In `makeGroupColumn`, add:

```ts
resizable: false,
reorderable: false,
```

- [ ] **Step 5: Add a React regression for painting the whole drawn row**

In the grouped selection suite, trigger the header checkbox or Cmd/Ctrl+A and
assert the group-column, `name`, and `qty` data cells are selected while the
hidden `sector` column is absent. Also assert the group-column header has no
resize handle and cannot start reorder.

- [ ] **Step 6: Run engine and React focused suites green**

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine group-column
pnpm --filter @pretable/react test -- pretable-surface
```

Expected: focused suites pass and existing ungrouped selection tests remain
unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/grid-core/src/create-grid-core.ts \
  packages/grid-core/src/group-column.ts \
  packages/grid-core/src/__tests__/grouping-engine.test.ts \
  packages/grid-core/src/__tests__/group-column.test.ts \
  packages/react/src/__tests__/pretable-surface.test.tsx
git commit -m "fix(core): use grouped columns for visible row selection"
```

---

### Task 2: Keep group focus out of selection state

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts:364-695`
- Modify: `packages/react/src/pretable-surface.tsx:2823-2860`
- Test: `packages/grid-core/src/__tests__/grouping-engine.test.ts:618-749`
- Test: `packages/grid-core/src/__tests__/selection-state.test.ts:1-120`
- Test: `packages/react/src/__tests__/group-row-render.test.tsx:140-194`
- Test: `packages/react/src/__tests__/pretable-surface.test.tsx:5201-5560`

- [ ] **Step 1: Add failing engine tests for arrow, Shift, Escape, and row toggle**

Cover these exact transitions:

```ts
grid.setSelection(dataCellSelection("r1", "qty"));
grid.setFocus({ rowId: "r1", columnId: "qty" });
grid.moveFocus("down"); // lands on the next group header
expect(grid.getSnapshot().focus.rowId).toMatch(/^__group__:/);
expect(grid.getSnapshot().selection).toEqual(dataCellSelection("r1", "qty"));

grid.moveFocus("down", { extend: true }); // group destination
expect(grid.getSnapshot().selection).toEqual(dataCellSelection("r1", "qty"));
grid.moveFocus("down", { extend: true }); // next data destination
expect(grid.getSnapshot().selection.ranges[0]?.endRowId).toBe("r2");

grid.clearSelection(); // while group-focused
expect(grid.getSnapshot().selection).toEqual({ ranges: [], anchor: null });

grid.toggleRowSelection(groupId);
expect(grid.getSnapshot().selection).toEqual({ ranges: [], anchor: null });
```

The row-toggle guard applies when the id resolves to a currently visible group;
unknown ids retain current permissive behavior.

- [ ] **Step 2: Run the focused engine tests and confirm red**

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine selection-state
```

Expected: group destinations replace/extend selection, `clearSelection` creates
a group-only range, and group row toggle creates a full-row group range.

- [ ] **Step 3: Gate built-in selection mutation on data rows**

In `moveFocus`, assign `focus = nextAddr` for either row kind, but execute the
existing extend/replace selection block only when `isDataRow(nextRow)`.

In `clearSelection`, resolve `focus.rowId` in `getSnapshot().visibleRows`. Build
the single-cell selection only for a data row; otherwise use
`{ ranges: [], anchor: null }`.

In `toggleRowSelection`, return before constructing a range when the visible
entry with `rowId` has `kind === "group"`.

- [ ] **Step 4: Add a failing React click/callback test**

Click both the group-label cell and an aggregate cell. Assert focus changes to
the clicked address, while `onSelectionChange` is not called and the prior data
selection remains. Keep the existing twisty test as a separate propagation
guard.

- [ ] **Step 5: Implement a focus-only group-cell click path**

Replace the `handleCellClick` call in the `GroupRow` branch with:

```ts
const before = grid.getSnapshot().focus;
grid.setFocus({ rowId: group.id, columnId });
const after = grid.getSnapshot().focus;
if (before.rowId !== after.rowId || before.columnId !== after.columnId) {
  onFocusChange?.(after);
}
```

Do not call selection callbacks or `onSelectedRowIdChange`.

- [ ] **Step 6: Run focused suites green**

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine selection-state
pnpm --filter @pretable/react test -- group-row-render pretable-surface
```

- [ ] **Step 7: Commit**

```bash
git add packages/grid-core/src/create-grid-core.ts \
  packages/grid-core/src/__tests__/grouping-engine.test.ts \
  packages/grid-core/src/__tests__/selection-state.test.ts \
  packages/react/src/pretable-surface.tsx \
  packages/react/src/__tests__/group-row-render.test.tsx \
  packages/react/src/__tests__/pretable-surface.test.tsx
git commit -m "fix(grouping): separate group focus from selection"
```

---

### Task 3: Reconcile focus after every visible-row mutation

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts:58-60, 300-345, 1020-1195, 1260-1326`
- Test: `packages/grid-core/src/__tests__/grouping-engine.test.ts:78-477`

- [ ] **Step 1: Add failing focus-reconciliation tests**

Add one test per mutation class:

1. Focus group A; `setRows` with cloned identical rows; group A remains focused.
2. Focus group A; transaction changes its only row's key to B; focus addresses
   the row at A's former clamped flat index and never references missing A.
3. Focus a data row in the soon-hidden grouped column; `setRowGroups`; preserve
   the data row and move the column to `GROUP_COLUMN_ID`.
4. Focus a group; reorder grouping levels; the old path id disappears and focus
   lands at the clamped prior flat index with a valid effective column.
5. Focus a row removed by `setColumnFilter`, then separately by
   `replaceFilters`; every resulting non-null focus exists in `visibleRows` and
   `getColumns()`. Clear those filters and assert `clearFilters` preserves the
   already-valid repaired focus rather than inventing or clearing it.
6. Focus a descendant, collapse its ancestor; preserve the nearest surviving
   ancestor rather than merely clamping by index.
7. Start with null focus; mutate rows/filters/grouping; focus stays null.
8. Remove every visible row; focus becomes fully null. Task 4 covers the
   no-effective-column case through column prop merging.

Use a shared assertion:

```ts
function expectValidFocus(grid: PretableGrid<Row>) {
  const { focus, visibleRows } = grid.getSnapshot();
  if (focus.rowId === null || focus.columnId === null) {
    expect(focus).toEqual({ rowId: null, columnId: null });
    return;
  }
  expect(visibleRows.some((row) => row.id === focus.rowId)).toBe(true);
  expect(grid.getColumns().some((column) => column.id === focus.columnId)).toBe(
    true,
  );
}
```

- [ ] **Step 2: Run the focused test and classify the new guards**

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine
```

Expected red cases: cloned-row identity, transaction key changes, grouping a
focused column, regrouping, and filter removal expose the missing general
reconciliation. Document the null-focus, ancestor-collapse, all-rows-removed,
and already-valid `clearFilters` cases as existing-behavior guards when they
remain green; the task does not require every new assertion to fail.

- [ ] **Step 3: Replace collapse-only repair with one reconciliation helper**

Refactor `reanchorFocusAfterCollapse` into a helper that receives the
pre-mutation `visibleRows` and an option to prefer a surviving ancestor:

```ts
function reconcileFocusAfterVisibleModelChange(
  before: readonly PretableVisibleRow<TRow>[],
  options: { preferAncestor?: boolean } = {},
): void;
```

Implementation order:

1. Return immediately when both focus fields are null.
2. Clear `cachedSnapshot`, derive `afterRows` and `afterColumns`.
3. If either list is empty, set both focus fields null.
4. Preserve `focus.rowId` if it survives.
5. When `preferAncestor`, scan backward from the old index for the nearest
   surviving group with shallower depth.
6. Otherwise use `afterRows[clamp(oldIndex, 0, afterRows.length - 1)]`; when the
   old id was already absent, use index 0.
7. Preserve the column when it survives. Otherwise prefer `GROUP_COLUMN_ID`
   while grouped, then `afterColumns[0]`.
8. Set the repaired address and clear `cachedSnapshot` again.

Do not modify selection or create focus when the old focus was null.

- [ ] **Step 4: Route all mutation paths through the helper**

Capture `before = getSnapshot().visibleRows` before mutating and reconcile
before the final `emit()` in:

- `setRows`
- `applyTransaction`
- `setRowGroups`
- `setColumnFilter`
- `replaceFilters`
- `clearFilters`
- `setGroupExpanded`, `expandAll`, and `collapseAll` (with
  `preferAncestor: true` where descendants can disappear)

Remove the old source-row-only focus clear in `setRows`. Preserve existing
editing and selection row-pruning behavior.

- [ ] **Step 5: Run focused and full engine suites green**

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine
pnpm --filter @pretable-internal/grid-core test
```

- [ ] **Step 6: Negative-control the fallback algorithm**

Temporarily remove the surviving-row check and confirm the identical `setRows`
test fails; restore it. Temporarily remove the ancestor scan and confirm the
collapse test fails; restore it.

- [ ] **Step 7: Commit**

```bash
git add packages/grid-core/src/create-grid-core.ts \
  packages/grid-core/src/__tests__/grouping-engine.test.ts
git commit -m "fix(core): reconcile focus after grouped row changes"
```

---

### Task 4: Invalidate grouped rows when column semantics change

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts:990-1018, 1398-1502`
- Test: `packages/grid-core/src/__tests__/group-column.test.ts:137-176`
- Test: `packages/grid-core/src/__tests__/grouping-engine.test.ts:301-477`
- Test: `packages/react/src/__tests__/group-row-render.test.tsx:194-236`

- [ ] **Step 1: Add failing engine tests for fresh definitions**

Cover:

```ts
grid.mergeColumnsFromProps(columnsWith({ qty: { aggregate: "count" } }));
expect(groupRows(grid)[0]?.aggregates.qty).toBe(2);

grid.mergeColumnsFromProps(columnsWith({ sector: { value: nextAccessor } }));
expect(groupRows(grid).map((row) => row.value)).toEqual(expectedNewKeys);

grid.mergeColumnsFromProps(columnsWithout("sector"));
expect(grid.getSnapshot().rowGroups).toEqual([]);
expect(grid.getSnapshot().groupExpansionOverrides.size).toBe(0);
expect(grid.getColumns().some((c) => c.id === GROUP_COLUMN_ID)).toBe(false);
expectValidFocus(grid);

grid.setFocus({ rowId: "r1", columnId: "qty" });
grid.mergeColumnsFromProps([]);
expect(grid.getSnapshot().focus).toEqual({ rowId: null, columnId: null });
```

Add a change-guard test proving a second merge with the exact stored accessor,
aggregate, and formatter references keeps snapshot identity.

- [ ] **Step 2: Add a failing React rerender test for aggregate semantics**

Render a grouped surface whose Qty aggregate is `sum`, rerender the same rows
and layout with Qty aggregate `count`, and assert the visible aggregate changes
without a row mutation. Keep any `formatAggregate` callback reference stable;
formatter freshness is prop-driven React rendering, not an engine row-model
invalidation key.

- [ ] **Step 3: Run focused tests red**

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine group-column
pnpm --filter @pretable/react test -- group-row-render
```

- [ ] **Step 4: Add grouping-semantic equality and invalidation**

Keep `sameColumnLayout` for layout notifications, and add a separate comparator
covering column id/set plus `value` and `aggregate` by identity/value.
`formatAggregate` is deliberately excluded because it changes display only and
React reads it from fresh props; `rowGroup` remains initialization-only.

Inside `mergeColumnsFromProps`:

1. Capture the pre-change visible rows only when grouping semantics or the
   column id set changed.
2. Store the merged columns as today.
3. Re-sanitize `rowGroups` against the merged definitions.
4. If the sanitized levels changed, replace `rowGroups` and clear expansion
   overrides.
5. Set `cachedVisibleRows = null` for grouping-semantic changes.
6. Reconcile focus through Task 3's helper.
7. Emit when layout, grouping semantics, or sanitized grouping changed.

The stored-reference guard prevents a child-only rerender loop. A parent that
provides a new inline closure may cause one correctness-required emission for
that parent update.

- [ ] **Step 5: Run focused tests and typecheck green**

```bash
pnpm --filter @pretable-internal/grid-core test -- grouping-engine group-column
pnpm --filter @pretable/react test -- group-row-render
pnpm --filter @pretable-internal/grid-core typecheck
pnpm --filter @pretable/react typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/grid-core/src/create-grid-core.ts \
  packages/grid-core/src/__tests__/group-column.test.ts \
  packages/grid-core/src/__tests__/grouping-engine.test.ts \
  packages/react/src/__tests__/group-row-render.test.tsx
git commit -m "fix(grouping): invalidate rows for column definition changes"
```

---

### Task 5: Serialize rectangular group rows and count copied rows

**Files:**

- Modify: `packages/react/src/rendering.ts:19-32`
- Modify: `packages/react/src/group-row.tsx:9-10, 103-172`
- Modify: `packages/react/src/copy.ts:1-307`
- Modify: `packages/react/src/pretable-surface.tsx:1962-2012, 3740-3833`
- Test: `packages/react/src/__tests__/copy.test.ts:1-581`
- Test: `packages/react/src/__tests__/group-row-render.test.tsx:203-236`
- Test: `packages/react/src/__tests__/pretable-surface.test.tsx:3217-3453, 5148-5190`

- [ ] **Step 1: Replace the stale omission test with failing rectangular tests**

Use columns `[GROUP_COLUMN_ID, "name", "qty"]` and visible rows containing a
group with `value: "Tech"`, `aggregates: { qty: 3 }` plus its data rows. Assert:

```ts
expect(out?.text).toBe("Tech\t\tΣ 3\n\tAlpha\t1\n\tBeta\t2");
expect(out?.html?.match(/<tr>/g)).toHaveLength(3);
expect(out?.html).toContain("<td>Tech</td><td></td><td>Σ 3</td>");
```

Add separate cases for:

- group-only range in `GROUP_COLUMN_ID`;
- blank group value emits `(Blanks)`;
- aggregate TSV/HTML escaping;
- partial column range omits the label when the group column is outside it;
- headers preserve the existing blank-line TSV and `<thead>` HTML contract;
- a range resolving to no body rows is omitted, and all-empty blocks return
  `null`.

- [ ] **Step 2: Add a failing renderer/serializer parity test**

Use a `formatAggregate` callback that reads `group.value`, proving the shared
helper supplies the full `{ value, column, group }` input in both paths.

- [ ] **Step 3: Add failing copy-announcement tests**

Select a data-to-data range that spans one group header. After Cmd/Ctrl+C and
the 500ms debounce, assert the copy message counts the group row. In the same
fixture, assert select-all announcement still counts only selectable data rows.

- [ ] **Step 4: Run focused tests red**

```bash
pnpm --filter @pretable/react test -- copy group-row-render pretable-surface
```

- [ ] **Step 5: Extract the shared aggregate formatter**

In `rendering.ts` add:

```ts
export function formatAggregateValue<TRow extends PretableRow>(
  column: PretableColumn<TRow>,
  group: PretableGroupRow,
): string {
  const value = group.aggregates[column.id];
  return column.formatAggregate
    ? column.formatAggregate({ value, column, group })
    : formatCellValue(value);
}
```

Use it in `GroupRow` only when the aggregate own-property guard succeeds.

- [ ] **Step 6: Implement group-cell serialization**

Import `GROUP_COLUMN_ID`, `groupLabel`, and `formatAggregateValue`. For every
selected visible row/column pair:

```ts
if (row.kind === "group") {
  if (column.id === GROUP_COLUMN_ID) return groupLabel(row.value);
  if (Object.prototype.hasOwnProperty.call(row.aggregates, column.id)) {
    return formatAggregateValue(column, row);
  }
  return "";
}
```

Feed that text through the existing TSV/HTML escaping and type-hint paths. Track
whether each table emitted a body row before adding its text/html block.

- [ ] **Step 7: Separate copy extent from selection extent**

Leave `computeSelectionExtent` data-row based. Add `computeCopyExtent` that maps
range row ids against every `snapshot.visibleRows` entry, maps columns against
drawn columns excluding `ROW_SELECT_COLUMN_ID`, and counts the union of addressed
visible row positions/column ids. Use it only for copy-success announcements.

- [ ] **Step 8: Run focused tests and negative controls**

```bash
pnpm --filter @pretable/react test -- copy group-row-render pretable-surface
```

Temporarily skip the group branch and confirm the rectangular tests fail;
restore. Temporarily reuse `computeSelectionExtent` for copy and confirm the
announcement test fails; restore.

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/rendering.ts packages/react/src/group-row.tsx \
  packages/react/src/copy.ts packages/react/src/pretable-surface.tsx \
  packages/react/src/__tests__/copy.test.ts \
  packages/react/src/__tests__/group-row-render.test.tsx \
  packages/react/src/__tests__/pretable-surface.test.tsx
git commit -m "fix(react): copy rectangular grouped rows"
```

---

### Task 6: Correct treegrid metadata and keyboard ownership

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx:1-125, 1896-2163, 2867-2936`
- Test: `packages/react/src/__tests__/group-row-render.test.tsx:74-108`
- Test: `packages/react/src/__tests__/pretable-surface.test.tsx:1115-1878`

- [ ] **Step 1: Add failing row-count and leaf-level tests**

Assert:

- filtered ungrouped `aria-rowcount === visibleRows + header`;
- expanded grouped count includes group headers;
- collapsed grouped count shrinks with `visibleRows`;
- every rendered `aria-rowindex <= aria-rowcount`;
- nested group rows expose levels 1 and 2, their data leaves level 3;
- ungrouped data rows omit `aria-level`.

- [ ] **Step 2: Add failing header-keyboard ownership tests**

Dispatch cancelable Tab, Enter, and Space from a header sort button and a column
menu button. Assert the root handler does not prevent native Tab and does not
move or select the stale grid focus. Keep the existing cell Tab tests green.

- [ ] **Step 3: Add a failing live-region structure test**

Render a grouped surface and assert:

```ts
const treegrid = screen.getByRole("treegrid");
const status = screen.getByRole("status");
expect(treegrid.contains(status)).toBe(false);
expect(status).toHaveAttribute("data-pretable-live-region");
```

Also render two surfaces and assert two independently labelled/status nodes are
cleaned up on unmount.

- [ ] **Step 4: Run focused React tests red**

```bash
pnpm --filter @pretable/react test -- group-row-render pretable-surface
```

- [ ] **Step 5: Implement visible tree metadata**

Set root `aria-rowcount={snapshot.visibleRows.length + 1}`. Destructure data-row
`depth` and set `aria-level={isGrouped ? depth + 1 : undefined}` on its row.

- [ ] **Step 6: Scope the root keyboard handler**

After the existing active-reorder and marquee-Escape branches, return when
`event.target` is inside `[data-pretable-header-row]`. Do not move this guard
above drag cancellation. Header buttons then own native keyboard behavior while
gridcells continue into `handleSurfaceKeyDown`.

- [ ] **Step 7: Portal the status region outside the grid**

Import `createPortal` from `react-dom`. Remove the status node from
`scrollViewport`; create it as a hydration-gated portal to `document.body`.
Return a fragment containing the existing viewport/wrapper plus the portal.
Because portals do not create a child in the component container, the no-panel
first element remains the scroll viewport.

- [ ] **Step 8: Run focused suites and SSR/build guards green**

```bash
pnpm --filter @pretable/react test -- group-row-render pretable-surface build-config
pnpm --filter @pretable/react typecheck
```

- [ ] **Step 9: Commit**

```bash
git add packages/react/src/pretable-surface.tsx \
  packages/react/src/__tests__/group-row-render.test.tsx \
  packages/react/src/__tests__/pretable-surface.test.tsx
git commit -m "fix(react): expose valid grouped treegrid metadata"
```

---

### Task 7: Announce every successful expansion mutation

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx:167-239, 760-803, 2825-2863, 3842-3931`
- Test: `packages/react/src/__tests__/pretable-surface.test.tsx:3020-3453, 5360-5442`
- Modify: `packages/react/react.api.md`

- [ ] **Step 1: Add failing default/custom announcement tests**

Using fake timers, cover twisty click, group-cell double-click, Enter, Space,
ArrowLeft collapse, and ArrowRight expansion. After advancing 500ms, assert:

```ts
expect(status).toHaveTextContent("Tech collapsed, 2 rows");
expect(status).toHaveTextContent("Tech expanded, 2 rows");
```

Add custom message factories and assert their exact output. Assert no message
for childless/no-op expansion and preserve last-message-wins debounce behavior.

- [ ] **Step 2: Run the focused surface tests red**

```bash
pnpm --filter @pretable/react test -- pretable-surface
```

- [ ] **Step 3: Add public message factories and defaults**

Add the two optional fields from the spec to `PretableSurfaceMessages`, add
English defaults, and merge them into `effectiveMessages`/its ref:

```ts
groupExpandedAnnouncement: ({ label, childCount }) =>
  `${label} expanded, ${childCount} rows`,
groupCollapsedAnnouncement: ({ label, childCount }) =>
  `${label} collapsed, ${childCount} rows`,
```

- [ ] **Step 4: Centralize post-mutation announcement**

Create one callback that re-reads the snapshot after mutation, finds the still
visible group row, builds `{ label: groupLabel(value), childCount }`, selects
the expanded/collapsed factory through `isGroupExpanded`, and calls
`scheduleAnnouncement`.

Wrap mouse `toggleGroup`. Add an expansion-mutation callback to
`SurfaceKeyDownContext` and route every existing `toggleGroup`/
`setGroupExpanded` keyboard call through it. Only call the announcer when the
before/after expanded state differs.

- [ ] **Step 5: Run tests, API extraction, and negative controls**

```bash
pnpm --filter @pretable/react test -- pretable-surface
pnpm --filter @pretable/react build
pnpm --filter @pretable/react api
pnpm --filter @pretable/react api:check
```

Update `packages/react/react.api.md` through the normal `api` command, not by
hand. Temporarily bypass the wrapper in one keyboard branch and confirm its test
fails; restore.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/pretable-surface.tsx \
  packages/react/src/__tests__/pretable-surface.test.tsx \
  packages/react/react.api.md
git commit -m "feat(react): announce group expansion changes"
```

---

### Task 8: Restore DOM focus after grouping UI mutations

**Files:**

- Modify: `packages/react/src/group-panel/GroupPanel.tsx:1-380`
- Modify: `packages/react/src/column-menu/ColumnMenu.tsx:1-110`
- Modify: `packages/react/src/column-menu/MenuButton.tsx:1-60`
- Modify: `packages/react/src/pretable-surface.tsx:730-900, 2638-2805, 3339-3405`
- Test: `packages/react/src/__tests__/group-panel.test.tsx:250-430`
- Test: `packages/react/src/__tests__/column-menu.test.tsx:94-234`
- Test: `packages/react/src/__tests__/pretable-surface.test.tsx`

- [ ] **Step 1: Add failing focus-intent tests to `GroupPanel`**

Extend the internal `onChange` contract to report optional intent:

```ts
type GroupingFocusIntent = {
  target: "chip" | "header";
  columnId: string;
};
```

Assert keyboard reorder requests the moved chip, middle-chip deletion requests
the successor (or predecessor at the end), and final-chip deletion requests the
removed column's header. Cover both Delete/Backspace and the remove button.

- [ ] **Step 2: Add failing menu action-vs-dismiss tests**

Escape restores a connected anchor. Outside pointer dismissal leaves focus on
the user's chosen outside target, and choosing “Group by this column” calls
`onSelect` and closes without focusing the anchor that grouping will remove.

- [ ] **Step 3: Add failing surface integration tests**

Cover:

- menu grouping focuses the new chip;
- header-to-panel grouping focuses the new chip after the source header unmounts;
- chip reorder keeps chip focus;
- final-chip removal focuses the reappearing column-menu button;
- when a requested chip/header is absent, valid engine focus receives DOM
  focus;
- when engine focus is null/no cell exists, the scroll viewport receives DOM
  focus rather than `<body>`.

- [ ] **Step 4: Run focused tests red**

```bash
pnpm --filter @pretable/react test -- group-panel column-menu pretable-surface
```

- [ ] **Step 5: Implement internal focus intent**

Let `GroupPanel.onChange` accept the optional second argument. Report intent for
keyboard/button/drag mutations; retain its current local refocus optimization
only when it does not conflict with surface coordination.

Let `MenuButton` accept an internal callback ref and register nodes by column id
in the surface. Change `ColumnMenu` dismissal so Escape restores the anchor,
while outside dismissal and a selected action close without doing so.

In the surface, store one pending intent in a ref before `grid.setRowGroups`.
Pass chip intent explicitly from both the header-to-panel drop and the column
menu's Group action; pass through the intent supplied by `GroupPanel.onChange`
for chip mutations. In a layout effect after each grouping render:

1. Resolve chip intent from `groupPanelRef` and the chip's column id.
2. Resolve header intent from registered menu-button nodes.
3. If found and connected, focus it and clear the request.
4. Otherwise focus the valid `cellNodesRef` entry for snapshot focus.
5. Otherwise focus `viewportRef`.

Do not expose the intent type or callbacks from the package public API.

- [ ] **Step 6: Run focused tests and negative controls green**

```bash
pnpm --filter @pretable/react test -- group-panel column-menu pretable-surface
```

Temporarily restore the anchor after menu action and confirm the integration
test fails; restore. Temporarily remove the final-header intent and confirm the
last-chip test fails; restore.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/group-panel/GroupPanel.tsx \
  packages/react/src/column-menu/ColumnMenu.tsx \
  packages/react/src/column-menu/MenuButton.tsx \
  packages/react/src/pretable-surface.tsx \
  packages/react/src/__tests__/group-panel.test.tsx \
  packages/react/src/__tests__/column-menu.test.tsx \
  packages/react/src/__tests__/pretable-surface.test.tsx
git commit -m "fix(react): preserve focus across grouping controls"
```

---

### Task 9: Prove keyboard grouping and grouped copy in real browsers

**Files:**

- Modify: `apps/website/app/fixtures/grouping/page.tsx:1-100`
- Modify: `apps/website/e2e/grouping.spec.ts:1-570`

- [ ] **Step 1: Add a deterministic fixture copy sink**

Add local `copyText` state and pass:

```tsx
copyToClipboard={(payload) => setCopyText(payload.text)}
```

Render the last text in an off-grid test node such as
`<output data-grouping-copy-output>{copyText}</output>`. This exercises the real
keyboard/copy serializer path in both engines without depending on WebKit's OS
clipboard permissions. Enable the synthetic selector with
`rowSelectionColumn={{ enabled: true, headerCheckbox: true }}` so the same
fixture covers grouped row-selection copy.

- [ ] **Step 2: Add failing keyboard grouping/focus browser tests**

For Chromium and WebKit:

1. Tab through header controls until `Column menu for Region` is focused.
2. Press Enter and assert the menu item is focused.
3. Press Enter on “Group by this column”.
4. Assert the Region chip is focused and the source Region header is gone.
5. Delete grouping chips until Region is the last, delete it, and assert focus
   lands on the reappearing Region menu button.

Use role/name locators; do not depend on DOM order except where Tab order is the
behavior under test.

- [ ] **Step 3: Add a failing grouped Cmd/Ctrl+A copy test**

Focus a visible data cell, press the platform select-all shortcut and copy
shortcut, then assert the fixture output contains:

- group-label lines in the first TSV field;
- blank first fields for data rows;
- aggregate text under Qty;
- Name and Qty columns (the hidden grouped source columns must not collapse the
  copy to Qty only).

Parse the first several TSV lines and assert equal field counts rather than
matching one giant 200-row string.

Add a second path that selects grouped data through a row checkbox and then the
header checkbox, copies, and asserts the synthetic selector bound is excluded
while every drawn data column still serializes. Run both select-all and
row-selection paths in Chromium and WebKit.

- [ ] **Step 4: Run against a local website and confirm red before implementation completion**

Use the repository's established local server convention:

```bash
pnpm --filter @pretable/app-website dev
BASE_URL=http://127.0.0.1:3000 \
  pnpm --filter @pretable/app-website smoke -- grouping.spec.ts
```

If port 3000 is occupied, choose an explicit free port and pass the same URL to
both commands. Do not point the regression test at the deployed site.

- [ ] **Step 5: Run Chromium and WebKit green**

```bash
BASE_URL=http://127.0.0.1:3000 \
  pnpm --filter @pretable/app-website smoke -- grouping.spec.ts --project=chromium
BASE_URL=http://127.0.0.1:3000 \
  pnpm --filter @pretable/app-website smoke -- grouping.spec.ts --project=webkit
```

- [ ] **Step 6: Negative-control keyboard ownership and copy shape**

Temporarily remove the header-row key guard and confirm the Tab test fails.
Restore. Temporarily skip group serialization and confirm the equal-width/group
label assertions fail. Restore.

- [ ] **Step 7: Commit**

```bash
git add apps/website/app/fixtures/grouping/page.tsx \
  apps/website/e2e/grouping.spec.ts
git commit -m "test(website): cover grouped keyboard and copy flows"
```

---

### Task 10: Add release metadata and run final verification

**Files:**

- Create: `.changeset/fuzzy-groups-align.md`
- Verify: `packages/react/react.api.md`
- Verify: all files changed by Tasks 1-9

- [ ] **Step 1: Add the patch changeset**

Create a normal Changesets markdown file naming the public fixed packages. The
repository's fixed group will expand versions consistently:

```md
---
"@pretable/core": patch
"@pretable/react": patch
"@pretable/ui": patch
---

Fix row grouping selection, focus, clipboard output, and treegrid accessibility,
including keyboard grouping controls and expansion announcements.
```

Do not edit package versions directly.

- [ ] **Step 2: Verify Changesets sees the intended fixed release set**

```bash
pnpm exec changeset status
```

Expected: the fixed group reports patch releases for `@pretable/core`,
`@pretable/react`, `@pretable/stream-adapter`, and `@pretable/ui`; no package is
missing because of fixed-version expansion.

- [ ] **Step 3: Run formatting and inspect only intended rewrites**

```bash
pnpm format:write
git diff --check
git status --short
```

Review any formatter changes before staging. Revert no user changes.

- [ ] **Step 4: Run the full non-browser validation matrix**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm api:check
pnpm format:check
```

Expected: all commands exit 0. The pre-existing
`react-hooks/exhaustive-deps` warning may remain; no new warning/error is
accepted.

- [ ] **Step 5: Start a fresh local server and run the real-browser suite**

Choose an explicit free port, start the website with that same `PORT`, wait for
the fixture to respond, and retain the server pid for cleanup. For example:

```bash
PORT=3109 pnpm --filter @pretable/app-website dev
```

Then, in a separate shell while that process is running:

```bash
BASE_URL=http://127.0.0.1:3109 \
  pnpm --filter @pretable/app-website smoke -- grouping.spec.ts --project=chromium
BASE_URL=http://127.0.0.1:3109 \
  pnpm --filter @pretable/app-website smoke -- grouping.spec.ts --project=webkit
```

Capture the command summaries for the final handoff and stop the exact server
process afterward. If 3109 is occupied, substitute one chosen free port in
both `PORT` and `BASE_URL`; do not assume Task 9's server is still alive.

- [ ] **Step 6: Review diff and history**

```bash
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --check
git log --oneline origin/main..HEAD
git status --short --branch
```

Confirm the diff contains no panel-overflow implementation and no SP4
docs/hero/bench changes.

- [ ] **Step 7: Commit release metadata/final mechanical updates**

```bash
git add .changeset/fuzzy-groups-align.md \
  packages/grid-core/src/create-grid-core.ts \
  packages/grid-core/src/group-column.ts \
  packages/grid-core/src/__tests__/grouping-engine.test.ts \
  packages/grid-core/src/__tests__/group-column.test.ts \
  packages/grid-core/src/__tests__/selection-state.test.ts \
  packages/react/src/rendering.ts \
  packages/react/src/group-row.tsx \
  packages/react/src/copy.ts \
  packages/react/src/pretable-surface.tsx \
  packages/react/src/group-panel/GroupPanel.tsx \
  packages/react/src/column-menu/ColumnMenu.tsx \
  packages/react/src/column-menu/MenuButton.tsx \
  packages/react/src/__tests__/copy.test.ts \
  packages/react/src/__tests__/group-row-render.test.tsx \
  packages/react/src/__tests__/group-panel.test.tsx \
  packages/react/src/__tests__/column-menu.test.tsx \
  packages/react/src/__tests__/pretable-surface.test.tsx \
  packages/react/react.api.md \
  apps/website/app/fixtures/grouping/page.tsx \
  apps/website/e2e/grouping.spec.ts
git commit -m "chore: add grouping correctness changeset"
```

- [ ] **Step 8: Apply completion workflows**

Use `@superpowers:verification-before-completion` before claiming success, then
`@superpowers:requesting-code-review` for the final code review, and finally
`@superpowers:finishing-a-development-branch` to present merge/PR/keep-branch
options. Do not push or open a PR unless the user chooses that external action.

---

## Acceptance checklist

- [ ] Visible full-row selection bounds exist in `getColumns()` while grouped.
- [ ] Group rows can receive focus but built-in interaction never creates a
      group-only selection.
- [ ] Focus is valid after setRows, transactions, filters, regrouping,
      expansion, and grouping-semantic column changes.
- [ ] Aggregate/accessor changes rederive immediately; removed grouped columns
      sanitize grouping and expansion state.
- [ ] TSV and HTML contain rectangular group labels/aggregates/blanks.
- [ ] Copy announcements count serialized group rows; selection announcements
      stay data-row based.
- [ ] `aria-rowcount`, `aria-rowindex`, and leaf `aria-level` agree with the
      visible tree.
- [ ] Header controls own native keyboard input and the live region is outside
      the grid/treegrid.
- [ ] Every expansion path announces through localizable factories.
- [ ] Menu/chip/header grouping mutations leave deterministic DOM focus.
- [ ] The group column exposes no inert resize/reorder affordances.
- [ ] Chromium and WebKit pass keyboard grouping, focus, and copy coverage.
- [ ] API extraction and Changesets describe the public patch.
- [ ] Panel overflow and SP4 work remain untouched and explicitly deferred.
