# Row Grouping SP2 — Rendering Group Rows: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the group header rows the SP1 engine already produces — with a
dedicated group column, a working twisty, keyboard expand/collapse, aggregate
cells, and `treegrid` semantics.

**Architecture:** The engine gains a _derived_ column list (`getColumns()`)
that prepends a synthetic `__pretable_group__` column and drops the grouped
columns whenever `rowGroups` is non-empty; `options.columns` stays the
consumer's truth so every existing column guard is untouched. `moveFocus`
switches from data-row ordinals to flat-list positions so focus can land on a
group row. The React surface grows a group-row render branch parallel to the
data-row one, and `@pretable/ui` styles it.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library (jsdom),
Playwright (Chromium + WebKit), api-extractor, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-07-row-grouping-render-design.md`

---

## Status — Tasks 1 and 2 are DONE (`cef3638`, `1e94cfd`)

grid-core is complete: 376 tests pass (19 files). React is at 646 pass / 7 fail,
and those 7 are exactly the suite Task 4 inverts — verified, nothing else broke.

**Four corrections the implementer found, which later tasks depend on:**

1. **`moveFocus` already reads `getColumns()`**, not `options.columns`. This was
   not in the original plan and is load-bearing for Task 4: without it, focus
   could reach the _hidden_ grouped column and could never reach
   `GROUP_COLUMN_ID`, making Task 4's branch table unimplementable. Ungrouped it
   is an identity change, so non-grouping grids are unaffected.
2. **`getColumns()` is already on the `@pretable/core` `PretableGrid` facade** —
   which is the type `use-pretable.ts:170` holds. Task 3 can call it.
3. **A grid-core suite also had to invert:** `grouping-engine.test.ts:602-655`,
   `describe("group rows are neither focusable nor selectable (v1)")`. Already
   inverted in place and renamed. Task 2's "pre-existing suites must still pass"
   was not achievable as written.
4. **The derived-column cache keys on `options.columns` and `rowGroups`
   identity**, not on an enumerated list of mutators — the plan's list of six
   omitted `resetColumnLayout`, `autosizeColumns`, and the autosize re-measure
   inside `setRows`. Identity keying covers all nine paths structurally and
   matches the file's existing `cachedDerivedSort === sort` idiom.

Also fixed en route: collapsing the group that held focus used to leave focus
dangling. `setGroupExpanded` and `collapseAll` now re-anchor onto the nearest
surviving ancestor group row, preserving the column.

---

## Status — Tasks 3 and 4 are DONE (`82fade2`, this commit)

React is at 678 pass / 0 fail (38 files); grid-core is untouched at 376.

**Five corrections found while implementing them:**

1. **A childless group is UNREACHABLE through the engine.** `buildGroupedRows`
   builds the tree from POST-filter rows (`group-rows.ts:157-191`), so a group
   whose children a filter removed is never materialized —
   `childCount === 0` cannot occur in a snapshot. Task 3's fixture for it (a
   filter matching nothing) renders zero group rows, not one collapsed one, and
   the spec's "Guards" claim that a group _becomes_ non-expandable under a filter
   is wrong for this engine. The rule itself still ships and is still tested:
   `<GroupRow>` is exercised directly with a `childCount: 0` group, which is
   where that state is reachable.
2. **`columnLayout` (`pretable-surface.tsx:1215`) also had to move to
   `getColumns()`** — the plan lists only `:819-825`, `:3763`, `:3776`. It feeds
   scroll-into-view and the reorder drop indicator, both of which compare against
   _rendered_ pixels; planned from `options.columns` while grouped it misses the
   group column entirely and puts every other column's `left` one group-column
   width away from where it is painted.
3. **`buildWidthsMap` / `buildPinnedMap` (`:3763`, `:3776`) must NOT move to
   `getColumns()`.** They describe the CONSUMER's column state back to the
   consumer, who feeds it in again as controlled `state.columnWidths` — which
   `use-pretable.ts:301` applies over `options.columns`. Reading the drawn list
   would drop every grouped column from the emitted map and lose its width for
   good. Left on `options.columns`; `GROUP_COLUMN_ID` is never in that array, so
   nothing changed.
4. **Only six of the seven inverted assertions actually invert.** Cmd+End lands
   on the LAST flat row, and in that fixture every group precedes its own child,
   so the last entry is still a data row. Rewritten to assert the flat-list
   contract rather than flipped to `true`.
5. **`Left` on a collapsed top-level group cannot be negative-controlled at flat
   index 0** — with nothing before the row, the "no-op" holds however the parent
   lookup is written. The test uses the SECOND root instead (three group rows
   precede it), which does fail when `findParentGroupRow`'s `depth <` is relaxed
   to `depth <=`.

Also done en route, all no-ops while ungrouped: the reorder drop index is
translated from drawn space back to an `options.columns` index
(`toEngineDropIndex`); `selectFocusedRowOnArrowKey` skips group rows; the
begin-edit path is gated on the focused row being a data row; and the pinned-cell
position ternary is now one shared `getPositionedCellStyle` rather than a second
hand-rolled copy in the group-row path.

---

## Ground rules for every task

- **Vanilla CSS in `packages/*`.** No Tailwind. Use `:where()` + existing
  `--pretable-*` tokens, matching `packages/ui/src/grid.css`.
- **No backcompat shims.** Pre-1.0, no external consumers. Rename and replace
  outright; never add an alias.
- **jsdom has no layout engine.** Any claim about a _pixel_ — indentation
  width, sticky offsets, scroll position — is only verified by a Playwright
  assertion. Right-pin shipped measurably broken past 316 green jsdom tests.
- **Negative control on every behavioural test.** Before you commit, delete the
  one line of implementation the test targets and confirm the test fails. If it
  still passes, the test is vacuous. Three vacuous tests were found in this repo
  in the last week; do not add a fourth.
- Run `pnpm format:write` before committing (`pnpm format` is check-only).

---

## File Structure

**Create:**

- `packages/grid-core/src/group-column.ts` — the synthetic column definition, its
  id constant, and the pure `resolveEffectiveColumns()` derivation.
- `packages/grid-core/src/__tests__/group-column.test.ts`
- `packages/react/src/group-row.tsx` — the `<GroupRow>` component (twisty +
  indent + label + count in the group column, aggregates in the rest).
- `packages/react/src/group-model.ts` — the pure helpers `<GroupRow>` and the
  keyboard handler share: `isGroupExpanded`, `findParentGroupRow`, `groupLabel`.
  Split out of `group-row.tsx` because `react-refresh/only-export-components`
  warns on a component file that also exports functions.
- `packages/react/src/__tests__/group-row-render.test.tsx`
- `apps/website/e2e/grouping.spec.ts` — the real-browser gate.

**Modify:**

- `packages/grid-core/src/create-grid-core.ts` — `getColumns()`, the
  `groupColumnsByPin` synthetic check, `moveFocus`, and the governing doc
  comment at `:37-59`.
- `packages/grid-core/src/types.ts` — `groupColumn`, `hideGroupedColumns`,
  `formatAggregate`, `getColumns` on the engine interface.
- `packages/react/src/use-pretable.ts:381,391` — plan from `getColumns()`.
- `packages/react/src/pretable-surface.tsx` — the `kind !== "data"` early return
  at `:2601`, the `role` at `:1790`, keyboard handling in
  `handleSurfaceKeyDown` (`:3513-3757`), column reads at `:819-825`,
  `:3763`, `:3776`.
- `packages/react/src/__tests__/pretable-surface.test.tsx:5099-5255` — invert
  the suite (see Task 4).
- `packages/ui/src/grid.css` — group row + twisty + indent styling.

---

## Task 1: The derived column list

**Files:**

- Create: `packages/grid-core/src/group-column.ts`
- Create: `packages/grid-core/src/__tests__/group-column.test.ts`
- Modify: `packages/grid-core/src/types.ts`
- Modify: `packages/grid-core/src/create-grid-core.ts`

**Why a derivation and not an injection.** Read the spec's Decision 1 before
starting. In short: `mergeColumnsFromProps` (`create-grid-core.ts:1004-1016`)
rebuilds the column list by mapping over the _consumer's_ array, so anything
pushed into `options.columns` is deleted on the next prop identity change. And
the column list can't be built React-side either, because its contents depend on
`rowGroups`, which is engine state. So it is derived on read and cached.

- [x] **Step 1: Write the failing test**

Create `packages/grid-core/src/__tests__/group-column.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import { GROUP_COLUMN_ID } from "../group-column";

type Row = { id: string; sector: string; name: string; qty: number };

const columns = [
  { id: "sector", header: "Sector" },
  { id: "name", header: "Name" },
  { id: "qty", header: "Qty" },
];

const rows: Row[] = [
  { id: "r1", sector: "Tech", name: "a", qty: 1 },
  { id: "r2", sector: "Tech", name: "b", qty: 2 },
  { id: "r3", sector: "Energy", name: "c", qty: 3 },
];

const make = (options = {}) =>
  createGridCore({
    columns: [...columns],
    rows,
    getRowId: (row) => row.id as string,
    ...options,
  });

describe("derived group column", () => {
  test("ungrouped: getColumns() is exactly the consumer's columns", () => {
    const grid = make();
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      "sector",
      "name",
      "qty",
    ]);
  });

  test("grouped: prepends the group column and hides the grouped column", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "name",
      "qty",
    ]);
  });

  test("ungrouping restores the original list", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    grid.setRowGroups([]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      "sector",
      "name",
      "qty",
    ]);
  });

  test("hideGroupedColumns: false keeps the grouped column visible", () => {
    const grid = make({ hideGroupedColumns: false });
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "sector",
      "name",
      "qty",
    ]);
  });

  test("multi-level grouping hides every grouped column, one group column", () => {
    const grid = make();
    grid.setRowGroups(["sector", "name"]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "qty",
    ]);
  });

  test("groupColumn config overrides header and width", () => {
    const grid = make({ groupColumn: { header: "Bucket", widthPx: 320 } });
    grid.setRowGroups(["sector"]);
    const col = grid.getColumns()[0];
    expect(col.id).toBe(GROUP_COLUMN_ID);
    expect(col.header).toBe("Bucket");
    expect(col.widthPx).toBe(320);
  });

  test("default header comes from the first grouped column", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns()[0].header).toBe("Sector");
  });

  test("the group column is not sortable or filterable", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    const col = grid.getColumns()[0];
    expect(col.sortable).toBe(false);
    expect(col.filterable).toBe(false);
  });

  // The bug this whole design exists to prevent: a prop identity change used to
  // rebuild options.columns from the consumer's array, dropping any synthetic
  // column. Deriving on read makes that structurally impossible.
  test("survives mergeColumnsFromProps with a fresh array identity", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    grid.mergeColumnsFromProps([...columns]);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "name",
      "qty",
    ]);
  });

  test("getColumns() is referentially stable until something invalidates it", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    expect(grid.getColumns()).toBe(grid.getColumns());
  });

  test("setRowGroups invalidates the cached list", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    const before = grid.getColumns();
    grid.setRowGroups(["name"]);
    expect(grid.getColumns()).not.toBe(before);
    expect(grid.getColumns().map((c) => c.id)).toEqual([
      GROUP_COLUMN_ID,
      "sector",
      "qty",
    ]);
  });

  test("column mutations invalidate the cached list", () => {
    const grid = make();
    grid.setRowGroups(["sector"]);
    const before = grid.getColumns();
    grid.setColumnWidth("qty", 999);
    expect(grid.getColumns()).not.toBe(before);
    expect(grid.getColumns().find((c) => c.id === "qty")?.widthPx).toBe(999);
  });
});
```

- [x] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @pretable-internal/grid-core test group-column
```

Expected: FAIL — `group-column.ts` does not exist.

- [x] **Step 3: Implement**

Create `packages/grid-core/src/group-column.ts` exporting:

```ts
export const GROUP_COLUMN_ID = "__pretable_group__";
```

plus a pure `resolveEffectiveColumns({ columns, rowGroups, groupColumn, hideGroupedColumns })`
returning `columns` unchanged when `rowGroups.length === 0`, and otherwise
`[synthetic, ...columns.filter(c => hideGroupedColumns === false || !rowGroups.includes(c.id))]`.

The synthetic column: `id: GROUP_COLUMN_ID`, `sortable: false`,
`filterable: false`, `widthPx: groupColumn?.widthPx ?? 200`, `header:
groupColumn?.header ?? <header of the column named by rowGroups[0]> ?? ""`, and
`pinned: "left"` **only** when `groupColumn?.pinned === "left"` (not pinned by
default — see spec).

In `create-grid-core.ts`:

- Add `getColumns()` to the returned engine object, backed by a
  `cachedEffectiveColumns` field.
- Null that cache everywhere `cachedVisibleRows` is nulled, **plus** in every
  column mutator (`setColumnWidth`, `moveColumn`, `setColumnOrder`,
  `setColumnPinned`, `autosizeColumn`, `mergeColumnsFromProps`) and in
  `setRowGroups`.
- Add `GROUP_COLUMN_ID` to the synthetic check in `groupColumnsByPin`
  (`:143-187`), ordered **after** `ROW_SELECT_COLUMN_ID` when both are present.

In `types.ts`: add `groupColumn?: { header?: string; widthPx?: number; pinned?: "left" }`
and `hideGroupedColumns?: boolean` to `PretableGridOptions`, and
`getColumns(): readonly PretableColumn<TRow>[]` to the engine interface. Add
`formatAggregate?: (input: { value: unknown; column: PretableColumn<TRow>; group: PretableGroupRow }) => string`
to `PretableColumn` — Task 3 consumes it, but the type belongs with the rest of
the column contract.

- [x] **Step 4: Verify green**

```bash
pnpm --filter @pretable-internal/grid-core test
```

Expected: PASS, including all pre-existing grouping suites.

- [x] **Step 5: Negative control**

Delete the `.filter(...)` that drops grouped columns; confirm the "hides the
grouped column" and multi-level tests fail. Restore.

- [x] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(grid-core): derive the group column from rowGroups"
```

---

## Task 2: Focus lands on group rows

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts:37-59` (doc comment),
  `:61-105` (`scanDataRows`, `dataRowAt`), `:566-710` (`moveFocus`)
- Modify: `packages/grid-core/src/__tests__/move-focus.test.ts` (currently
  ungrouped fixtures only — 163 lines)

`scanDataRows` and `dataRowAt` have **exactly one call site each**, both inside
`moveFocus` (`:575` and `:655`). Read the doc comment at `:37-59` first: it
states the old contract and explicitly names this sub-project as where it
changes. **Rewrite that comment; do not amend it.** A comment that still says
"focus never lands on a group row by keyboard" next to code that does is worse
than no comment.

- [x] **Step 1: Write the failing tests**

Append to `packages/grid-core/src/__tests__/move-focus.test.ts`:

```ts
describe("moveFocus over grouped rows", () => {
  type Row = { id: string; sector: string; qty: number };
  const make = () => {
    const grid = createGridCore({
      columns: [
        { id: "sector", header: "Sector" },
        { id: "qty", header: "Qty" },
      ],
      rows: [
        { id: "r1", sector: "Tech", qty: 1 },
        { id: "r2", sector: "Tech", qty: 2 },
        { id: "r3", sector: "Energy", qty: 3 },
      ],
      getRowId: (row) => row.id as string,
    });
    grid.setRowGroups(["sector"]);
    return grid;
  };

  const isGroup = (id: string | null) =>
    id !== null && id.startsWith("__group__:");

  test("down from the first data row lands ON the next group row", () => {
    const grid = make();
    const visible = grid.getSnapshot().visibleRows;
    // [group Energy, r3, group Tech, r1, r2] — order is sector-ascending.
    const firstData = visible.find((r) => r.kind === "data")!;
    grid.setFocus({ rowId: firstData.id, columnId: "qty" });

    grid.moveFocus("down");
    expect(isGroup(grid.getSnapshot().focus.rowId)).toBe(true);
  });

  test("vertical movement preserves the focused column", () => {
    const grid = make();
    const firstData = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "data")!;
    grid.setFocus({ rowId: firstData.id, columnId: "qty" });

    grid.moveFocus("down");
    expect(grid.getSnapshot().focus.columnId).toBe("qty");
  });

  test("down from the last row is a no-op, not a wrap", () => {
    const grid = make();
    const visible = grid.getSnapshot().visibleRows;
    const last = visible[visible.length - 1];
    grid.setFocus({ rowId: last.id, columnId: "qty" });

    grid.moveFocus("down");
    expect(grid.getSnapshot().focus.rowId).toBe(last.id);
  });

  test("focus can reach every visible row, group rows included", () => {
    const grid = make();
    const visible = grid.getSnapshot().visibleRows;
    grid.setFocus({ rowId: visible[0].id, columnId: "qty" });

    const seen = [grid.getSnapshot().focus.rowId];
    for (let i = 1; i < visible.length; i += 1) {
      grid.moveFocus("down");
      seen.push(grid.getSnapshot().focus.rowId);
    }
    expect(seen).toEqual(visible.map((r) => r.id));
  });

  test("collapsing the group holding focus moves focus to that group row", () => {
    const grid = make();
    const dataRow = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "data")!;
    const groupRow = grid
      .getSnapshot()
      .visibleRows.find((r) => r.kind === "group")!;
    grid.setFocus({ rowId: dataRow.id, columnId: "qty" });

    grid.setGroupExpanded(groupRow.id, false);

    // The focused row no longer exists in the flat list; focus must not dangle.
    const ids = grid.getSnapshot().visibleRows.map((r) => r.id);
    expect(ids).toContain(grid.getSnapshot().focus.rowId);
  });
});
```

- [x] **Step 2: Run and watch them fail**

```bash
pnpm --filter @pretable-internal/grid-core test move-focus
```

Expected: FAIL on the group-landing tests. The last test ("collapsing the group
holding focus") may reveal a pre-existing dangling-focus bug — if it does, fix
it here and say so in the commit message.

- [x] **Step 3: Implement**

Rewrite `moveFocus` to index `snapshot.visibleRows` directly rather than by
data-row ordinal. Delete `scanDataRows` and `dataRowAt` if nothing else uses
them (verify with `grep -rn "scanDataRows\|dataRowAt" packages/`). Keep
`isDataRow` — `selectAll` (`:397`) and `setSelectAllVisible` (`:513`) still
need it, and their behaviour is unchanged: **selection remains data-rows-only**.

Rewrite the `:37-59` doc comment to state the new contract: group rows are
focus targets but never selection or edit targets.

- [x] **Step 4: Verify green**

```bash
pnpm --filter @pretable-internal/grid-core test
```

Pre-existing suites in `grouping-engine.test.ts` (notably "selection and focus
survive a grouped tick update" at `:425`) must still pass.

- [x] **Step 5: Negative control**

Revert `moveFocus` to skipping group rows; confirm the four new group-landing
tests fail. Restore.

- [x] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(grid-core): let keyboard focus land on group rows"
```

---

## Task 3: Render the group row

**Files:**

- Create: `packages/react/src/group-row.tsx`
- Create: `packages/react/src/__tests__/group-row-render.test.tsx`
- Modify: `packages/react/src/pretable-surface.tsx:2601` (the early return),
  `:1790` (the role), `:819-825`, `:3763`, `:3776` (column reads)
- Modify: `packages/react/src/use-pretable.ts:381,391`

Switch every React-side read of `grid.options.columns` to `grid.getColumns()`.
`use-pretable.ts:381` is the load-bearing one — it is what the renderer plans
from, so the group column will not appear in `renderSnapshot.columns` until it
changes.

- [x] **Step 1: Write the failing test**

Create `packages/react/src/__tests__/group-row-render.test.tsx`. Build the
fixture following the pattern at `pretable-surface.test.tsx:5113-5172`
(`groupedColumns` / `groupedRows` / `renderGrouped`), then write these. The four
below are spelled out because they are the ones most easily written vacuously:

```tsx
const groupRows = (view: ReturnType<typeof render>) =>
  view.container.querySelectorAll("[data-pretable-group-row]");

it("switches the root role to treegrid only while grouped", () => {
  const view = renderGrouped({ rowGroups: [] });
  expect(view.getByRole("grid")).toBeInTheDocument();

  view.rerender(<Grid state={{ rowGroups: ["sector"] }} />);
  expect(view.getByRole("treegrid")).toBeInTheDocument();

  // Reverting matters as much as applying: a grid that ungroups must stop
  // announcing itself as a tree.
  view.rerender(<Grid state={{ rowGroups: [] }} />);
  expect(view.getByRole("grid")).toBeInTheDocument();
});

it("omits aria-expanded entirely on a group with no children left", () => {
  // A filter that matches nothing in this group leaves the header with a
  // childCount of 0. aria-expanded="false" would announce it as a collapsed
  // group the user can open — it cannot be opened, so the attribute must go.
  const view = renderGrouped({
    rowGroups: ["sector"],
    filters: { name: { operator: "equals", value: "no-such-name" } },
  });
  const header = groupRows(view)[0];
  expect(header).not.toHaveAttribute("aria-expanded");
  expect(header.querySelector("[data-pretable-group-twisty]")).toBeNull();
});

it("clicking the twisty collapses without selecting the row", () => {
  const onSelectionChange = vi.fn();
  const view = renderGrouped({ rowGroups: ["sector"], onSelectionChange });
  const before = view.getAllByTestId("pretable-row").length;

  fireEvent.click(
    groupRows(view)[0].querySelector("[data-pretable-group-twisty]")!,
  );

  expect(view.getAllByTestId("pretable-row").length).toBeLessThan(before);
  expect(onSelectionChange).not.toHaveBeenCalled();
});

it("carries the depth as a custom property, per level", () => {
  const view = renderGrouped({ rowGroups: ["sector", "name"] });
  const cells = view.container.querySelectorAll("[data-pretable-group-cell]");
  expect(cells[0].getAttribute("style")).toContain("--pretable-group-depth: 0");
  expect(cells[1].getAttribute("style")).toContain("--pretable-group-depth: 1");
});
```

Also cover, in the same file: `role="row"` plus `aria-level="1"` at depth 0 and
`"2"` at depth 1; `aria-expanded` reading `"true"` expanded and `"false"`
collapsed on a group that _does_ have children; a null or `""` group value
rendering `(Blanks)`; and `formatAggregate` being applied to an aggregate cell
while a column without it falls back to default stringification.

Note that jsdom does not resolve `calc()` or custom properties into computed
layout, which is why the depth test asserts on the _declaration_ and Task 6
measures the actual pixels in a browser.

- [x] **Step 2: Run and watch it fail**

```bash
pnpm --filter @pretable/react test group-row-render
```

Expected: FAIL — nothing renders for group rows.

- [x] **Step 3: Implement**

Create `<GroupRow>` in `packages/react/src/group-row.tsx`. It renders one
absolutely-positioned row (reuse `getRowStyle(top, height)` from `styles.ts`)
containing a cell per planned column, using `getCellStyle(left, width)` exactly
as the data-row loop does — so aggregates line up under their headers.

**Emit exactly these attribute names** — Task 5's stylesheet and the tests above
both key on them, so a rename in one place breaks the other silently:

| Element                                   | Attribute                    |
| ----------------------------------------- | ---------------------------- |
| the group row                             | `data-pretable-group-row`    |
| its cell in the group column              | `data-pretable-group-cell`   |
| the twisty button                         | `data-pretable-group-twisty` |
| the `(N)` child count                     | `data-pretable-group-count`  |
| a **data** row's cell in the group column | `data-pretable-group-leaf`   |

The group column's cell contains, in order: a `<button>` twisty, the label, and
`(childCount)`. Rules that are easy to get wrong and are each covered above:

- **Indent with padding inside the cell**, driven by
  `style={{ "--pretable-group-depth": depth }}`. Never indent the row and never
  use a spacer sibling — indenting the row breaks pinning, ellipsis truncation,
  and the focus outline.
- **The twisty's `onClick` must call `stopPropagation()`**, or expanding also
  selects the row.
- **Omit `aria-expanded` when `childCount === 0`.** Do not write `"false"`.
- **Blank values render `(Blanks)`.**

Replace the early return at `pretable-surface.tsx:2601` with a branch to
`<GroupRow>`. Make `role` at `:1790` conditional on
`snapshot.rowGroups.length > 0`.

Data rows also need a leaf indent in the group column — one twisty-width — so
their content aligns with sibling group labels. That is Task 5's CSS, but the
data-row cell for `GROUP_COLUMN_ID` must render a marker element for it to hang
off.

- [x] **Step 4: Verify green**

```bash
pnpm --filter @pretable/react test
```

- [x] **Step 5: Negative control**

Remove `stopPropagation()` from the twisty handler and confirm the
"does not select the row" test fails. Restore.

- [x] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): render group header rows"
```

---

## Task 4: Keyboard expand/collapse

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx:3513-3757` (`handleSurfaceKeyDown`)
- Modify: `packages/react/src/__tests__/pretable-surface.test.tsx:5099-5255`

**This task inverts an existing suite.** `describe("keyboard navigation over
grouped rows")` currently asserts `isGroupRowId(focus().rowId) === false` after
Cmd+Home, End, Cmd+End, PageDown, PageUp, Tab and Shift+Tab. Every one of those
assertions is now wrong. **Rewrite them to assert the opposite — do not delete
them.** They are the clearest record of the contract this sub-project changes.

- [x] **Step 1: Rewrite the existing suite and add the new bindings**

Invert the seven assertions. Then add, per the spec's branch table:

| Key               | Focus in the group column                                 | Focus on an aggregate cell |
| ----------------- | --------------------------------------------------------- | -------------------------- |
| `Right`           | collapsed → expand; expanded → move to next cell          | move right                 |
| `Left`            | expanded → collapse; collapsed → move to parent group row | move left                  |
| `Enter` / `Space` | toggle                                                    | toggle                     |

Test each cell of that table, plus: `Left` on a collapsed _top-level_ group
(no parent) is a no-op, and `Enter` on a data row still does whatever it did
before (find out and preserve it — do not assume).

- [x] **Step 2: Run and watch them fail**

```bash
pnpm --filter @pretable/react test pretable-surface -t "grouped"
```

- [x] **Step 3: Implement in `handleSurfaceKeyDown`**

Branch on the focused row's kind and whether the focused column is
`GROUP_COLUMN_ID`, then fall through to the existing navigation for every case
the table marks "move".

- [x] **Step 4: Verify green**

```bash
pnpm --filter @pretable/react test
```

- [x] **Step 5: Negative control — one per binding**

For each of `Left`, `Right`, `Enter`, `Space`: remove that single branch,
confirm its tests fail, restore. A binding whose test still passes without it
is testing something else.

- [x] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): APG treegrid keyboard expand/collapse"
```

---

## Task 5: Styling

**Files:**

- Modify: `packages/ui/src/grid.css`
- Modify: `packages/ui/src/themes/excel.css`
- Modify: `packages/ui/src/themes/material.css`

Vanilla CSS only, `:where([data-pretable-*])` convention as in the rest of
`grid.css`.

**Tokens are defined per theme, not centrally.** `grid.css` only _consumes_
`--pretable-*`; the values live in `themes/excel.css` and
`themes/material.css`. A new token added to one theme resolves to nothing in
the other, and `calc(0 * <nothing>)` collapses the indent to zero — which is
precisely the failure Task 6's first Playwright assertion exists to catch. Add
`--pretable-group-indent` to **both** themes, next to `--pretable-cell-padding-x`
(excel.css:58, material.css's corresponding block), and give the consuming rule
a literal fallback so a third-party theme degrades to _indented_ rather than
flat.

- [ ] **Step 1: Add the token to both themes**

`packages/ui/src/themes/excel.css`, in the spacing block near `:58`:

```css
--pretable-group-indent: 16px;
```

`packages/ui/src/themes/material.css`, in its matching spacing block:

```css
--pretable-group-indent: 20px;
```

- [ ] **Step 2: Add the rules to `grid.css`**

```css
/* Group header rows read as structure, not data — they borrow the header's
     fill so the eye groups them with the chrome rather than the records. */
:where([data-pretable-group-row]) {
  background: var(--pretable-bg-header);
  font-weight: 600;
  color: var(--pretable-text-header);
}

/* Indent is padding INSIDE the cell box. Indenting the row instead would
     scroll the indent away from a pinned group column, compute ellipsis
     truncation against the wrong width, and misplace the focus outline. */
:where([data-pretable-group-cell]) {
  display: flex;
  align-items: center;
  gap: var(--pretable-cell-padding-x);
  padding-left: calc(
    var(--pretable-cell-padding-x) + var(--pretable-group-depth, 0) *
      var(--pretable-group-indent, 16px)
  );
}

:where([data-pretable-group-twisty]) {
  flex: none;
  width: 1em;
  height: 1em;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
  transition: rotate 120ms ease;
}

:where([data-pretable-group-twisty][aria-expanded="false"]) {
  rotate: -90deg;
}

:where([data-pretable-group-twisty]:focus-visible) {
  outline: 2px solid var(--pretable-focus-ring);
  outline-offset: 1px;
}

:where([data-pretable-group-count]) {
  color: var(--pretable-text-dim);
  font-weight: 400;
}

/* Data rows sit one twisty-width in so their content lines up with sibling
     group labels instead of hanging a chevron to the left. */
:where([data-pretable-group-leaf]) {
  padding-left: calc(
    var(--pretable-cell-padding-x) + 1em + var(--pretable-cell-padding-x)
  );
}
```

Match the surrounding file's actual nesting and selector style — `grid.css`
wraps its rules in a layer/scope block; put these inside it rather than at the
top level.

- [ ] **Step 3: Verify nothing regressed**

```bash
pnpm --filter @pretable/ui test && pnpm --filter @pretable/react test
```

- [ ] **Step 4: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(ui): style group rows, twisty, and depth indent"
```

---

## Task 6: Real-browser verification, API report, full validation

**Files:**

- Create: `apps/website/e2e/grouping.spec.ts`
- Modify: the api-extractor reports (regenerated, not hand-edited)

jsdom cannot verify a single pixel. Everything below is only true if Playwright
says so.

- [ ] **Step 1: Write the browser spec**

Follow the setup in `apps/website/e2e/smoke.spec.ts`. Assert, in both Chromium
and WebKit:

1. **Indentation is real.** Measure `getBoundingClientRect().left` of the label
   at depth 0 versus depth 1; the difference must equal one indent step, not
   zero. (Depth styling is exactly the class of bug jsdom cannot see.)
2. **Collapse near the bottom of a long list.** Scroll a grid with enough rows
   to overflow, collapse a group, and assert the viewport still shows rows and
   `scrollTop <= scrollHeight - clientHeight`. The spec's "Expansion and scroll"
   section explains why this is the one case not free: the stored `scrollTop`
   can briefly exceed the new `totalHeight`, and the browser's clamp only
   propagates on the next scroll event. **If this fails, that is a real finding
   — report it, do not paper over it with a forced reflow.**
3. **Keyboard round-trip.** Focus a group row, press `ArrowLeft` (collapses),
   `ArrowRight` (expands), and assert the child row count each way.

- [ ] **Step 2: Run it**

```bash
pnpm --filter website test:e2e grouping
```

- [ ] **Step 3: Negative control**

Comment out the `--pretable-group-depth` padding rule and confirm assertion 1
fails with a measured delta of 0. Restore.

- [ ] **Step 4: Refresh the API report**

```bash
pnpm api
```

`getColumns`, `groupColumn`, `hideGroupedColumns` and `formatAggregate` are all
new `@public` surface. Re-run until it is a clean no-op — "API Extractor —
report freshness" is a **required** gate on main and will block the PR
otherwise.

- [ ] **Step 5: Full validation**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm format && pnpm test
```

All five must pass. Note that test files are now under typechecking (#248), so
a type error in a spec file fails the build.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "test(grouping): real-browser verification; refresh API report"
```

---

## Definition of done

- A grouped grid draws its group rows, indented by depth, with a working twisty.
- Expand/collapse works by mouse and by keyboard, and the keyboard model matches
  the APG treegrid table in the spec.
- The root is `treegrid` when grouped and `grid` when not.
- Every group row carries `aria-level`; `aria-expanded` is present when
  expandable and **absent** when not.
- Aggregates render through `formatAggregate` when supplied.
- Playwright measures a non-zero indent delta between depths, in two engines.
- `pnpm api` is a clean no-op; the five validation commands pass.
- Every new behavioural test has had its negative control run.

## Out of scope — do not build

Sticky group headers, group footers/totals, `multipleColumns` display mode,
expand/collapse animation, per-kind row heights, the drag-to-group panel (SP3),
and docs/hero adoption (SP4). Each is justified in the spec's "Deliberately not
doing" section.
