import { describe, expect, test } from "vitest";

import { createGridCore } from "../index";
import type {
  ColumnFilter,
  PretableCellRange,
  PretableColumn,
  PretableEngine,
  PretableFocusDirection,
} from "../index";

/**
 * A selection range is stored as a PAIR OF COLUMN IDS with everything between
 * them implied, so it breaks whenever the columns BETWEEN its endpoints change
 * — not only when an endpoint disappears. #259 fixed focus and left selection
 * corrupt; #264 then fixed selection for grouping and found the same defect in
 * plain reorder/pin, with no grouping involved at all. Both times the whole
 * suite stayed green while `onRowSelectionChange` under-reported and Cmd+C
 * copied the wrong columns.
 *
 * #264 wired `reconcileSelectionAfterColumnModelChange` into six mutators and
 * gave each one a test. Nothing stopped the SEVENTH from forgetting — which is
 * exactly how this class of bug reached main twice.
 *
 * So this file does not name the mutators. It reflects over the engine's whole
 * public surface, refuses to run unless every method is registered here, calls
 * all of them in randomised sweeps, and after EVERY call asserts that:
 *
 *   - every selection range still resolves against `getColumns()`;
 *   - each surviving range covers the same COLUMN SET it covered before, with
 *     the two documented exceptions (a full-row range follows the new
 *     first/last; a range a reorder has split is dropped, never widened);
 *   - a range is dropped only when nothing honest could be re-encoded;
 *   - focus never points at a row or column that is no longer there, and never
 *     drifts off one that is (`reconcileFocusAfterVisibleModelChange`, #259).
 *
 * **What makes it self-enforcing.** {@link METHODS} must name every function on
 * the engine, and the first test fails the moment it does not. So a new mutator
 * cannot be added silently: the author is forced to say how to CALL it — never
 * whether it needs reconciliation, which is the judgement call that was got
 * wrong twice — and the sweep then holds it to the same invariant as every
 * existing method. Adding a seventh column mutator without a reconcile call
 * fails here with no edit to this file beyond one registry line.
 *
 * `authors` is the one relaxation, and it cannot be used to dodge this file:
 * it marks methods whose JOB is to define selection or focus (`selectAll`,
 * `setFocus`, …), and any method carrying it is asserted to leave
 * `getColumns()` untouched. A new column mutator that claimed selection
 * authority to quiet the sweep fails on that assertion instead.
 *
 * The expected-coverage model below is a restatement of the two rules from
 * `docs/superpowers/specs/2026-08-09-grouping-correctness-round-2-design.md`
 * §1/§1b, not a copy of the implementation — it is written in terms of covered
 * column SETS, where the engine works in endpoints. The rules themselves are
 * pinned by #264's own unit tests; what this file adds is that every code path
 * is held to them.
 */

interface Row {
  [key: string]: unknown;
  id: string;
  dept: string;
  name: string;
  amount: number;
  region: string;
}

type Engine = PretableEngine<Row>;
type Rnd = () => number;

const COLUMN_POOL: readonly PretableColumn<Row>[] = [
  { id: "dept", header: "Dept" },
  { id: "name", header: "Name" },
  { id: "amount", header: "Amount", aggregate: "sum" },
  { id: "region", header: "Region" },
];

/** Not in the initial columns — `mergeColumnsFromProps` can introduce it. */
const EXTRA_COLUMN: PretableColumn<Row> = { id: "extra", header: "Extra" };

const ROWS: readonly Row[] = [
  { id: "r1", dept: "eng", name: "ada", amount: 1, region: "emea" },
  { id: "r2", dept: "eng", name: "bo", amount: 2, region: "amer" },
  { id: "r3", dept: "ops", name: "cy", amount: 3, region: "emea" },
  { id: "r4", dept: "ops", name: "di", amount: 4, region: "apac" },
  { id: "r5", dept: "art", name: "el", amount: 5, region: "amer" },
  { id: "r6", dept: "art", name: "fi", amount: 6, region: "apac" },
];

function mulberry(seed: number): Rnd {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: Rnd, items: readonly T[]): T {
  return items[Math.floor(rnd() * items.length)] as T;
}

function shuffle<T>(rnd: Rnd, items: readonly T[]): T[] {
  const out = items.slice();

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }

  return out;
}

function drawnIds(grid: Engine): string[] {
  return grid.getColumns().map((column) => column.id);
}

/** A drawn column id. */
function drawnColumnId(grid: Engine, rnd: Rnd): string {
  const ids = drawnIds(grid);

  return ids.length === 0 ? "nope" : pick(rnd, ids);
}

/**
 * A drawn column id, or occasionally one that does not exist — the early-return
 * paths in the column mutators are code paths too.
 *
 * Only for methods that validate their argument. `setFocus`, `addRange` and
 * friends store whatever they are handed, so an id the grid never drew would be
 * the test corrupting its own state rather than the engine failing.
 */
function someColumnId(grid: Engine, rnd: Rnd): string {
  return rnd() < 0.08 ? "nope" : drawnColumnId(grid, rnd);
}

function dataRowIds(grid: Engine): string[] {
  return grid
    .getSnapshot()
    .visibleRows.filter((row) => row.kind === "data")
    .map((row) => row.id);
}

function groupRowIds(grid: Engine): string[] {
  return grid
    .getSnapshot()
    .visibleRows.filter((row) => row.kind === "group")
    .map((row) => row.id);
}

function someRowId(grid: Engine, rnd: Rnd): string {
  const ids = grid.getSnapshot().visibleRows.map((row) => row.id);

  return ids.length === 0 ? "r1" : pick(rnd, ids);
}

function sourceRowIds(grid: Engine): Set<string> {
  const getRowId = grid.options.getRowId;

  return new Set(grid.options.rows.map((row) => getRowId(row)));
}

/**
 * How to call one engine method. `authors` names the axes the method is ALLOWED
 * to redefine rather than preserve. Carrying it also asserts that the method
 * leaves `getColumns()` alone, so it can never launder a column mutator — see
 * the file comment.
 */
interface MethodSpec {
  call: (grid: Engine, rnd: Rnd) => void;
  authors?: readonly ("selection" | "focus" | "rows")[];
}

const FILTERS: readonly (ColumnFilter | null)[] = [
  null,
  { operator: "contains", value: "e" },
  { operator: "isNotEmpty" },
  { operator: "equals", value: "eng" },
];

const METHODS: Record<string, MethodSpec> = {
  subscribe: {
    call: (grid) => {
      grid.subscribe(() => {})();
    },
  },
  getSnapshot: {
    call: (grid) => {
      grid.getSnapshot();
    },
  },
  getColumns: {
    call: (grid) => {
      grid.getColumns();
    },
  },
  setSort: {
    call: (grid, rnd) => {
      grid.setSort(someColumnId(grid, rnd), pick(rnd, ["asc", "desc", null]));
    },
  },
  replaceSort: {
    call: (grid, rnd) => {
      grid.replaceSort(
        rnd() < 0.3
          ? []
          : [
              {
                columnId: someColumnId(grid, rnd),
                direction: pick(rnd, ["asc", "desc"] as const),
              },
            ],
      );
    },
  },
  setColumnFilter: {
    call: (grid, rnd) => {
      grid.setColumnFilter(someColumnId(grid, rnd), pick(rnd, FILTERS));
    },
  },
  clearFilters: {
    call: (grid) => {
      grid.clearFilters();
    },
  },
  replaceFilters: {
    call: (grid, rnd) => {
      const filter = pick(rnd, FILTERS);

      grid.replaceFilters(
        filter === null ? {} : { [someColumnId(grid, rnd)]: filter },
      );
    },
  },
  distinctColumnValues: {
    call: (grid, rnd) => {
      grid.distinctColumnValues(someColumnId(grid, rnd));
    },
  },
  setSelection: {
    authors: ["selection"],
    call: (grid, rnd) => {
      const range = randomRange(grid, rnd);

      grid.setSelection(
        range === null
          ? { ranges: [], anchor: null }
          : {
              ranges: [range],
              anchor: {
                rowId: range.startRowId,
                columnId: range.startColumnId,
              },
            },
      );
    },
  },
  selectAll: {
    authors: ["selection"],
    call: (grid) => {
      grid.selectAll();
    },
  },
  clearSelection: {
    authors: ["selection"],
    call: (grid) => {
      grid.clearSelection();
    },
  },
  addRange: {
    authors: ["selection"],
    call: (grid, rnd) => {
      const range = randomRange(grid, rnd);

      if (range) {
        grid.addRange(range);
      }
    },
  },
  extendRangeFromAnchor: {
    authors: ["selection"],
    call: (grid, rnd) => {
      grid.extendRangeFromAnchor({
        rowId: someRowId(grid, rnd),
        columnId: drawnColumnId(grid, rnd),
      });
    },
  },
  toggleRowSelection: {
    authors: ["selection"],
    call: (grid, rnd) => {
      grid.toggleRowSelection(someRowId(grid, rnd));
    },
  },
  setSelectAllVisible: {
    authors: ["selection"],
    call: (grid, rnd) => {
      grid.setSelectAllVisible(rnd() < 0.5);
    },
  },
  setFocus: {
    authors: ["focus"],
    call: (grid, rnd) => {
      const rows = grid.getSnapshot().visibleRows;

      grid.setFocus(
        rnd() < 0.15 || rows.length === 0
          ? null
          : {
              rowId: pick(rnd, rows).id,
              columnId: drawnColumnId(grid, rnd),
            },
      );
    },
  },
  moveFocus: {
    // `moveFocus` drags the selection along with the caret by design.
    authors: ["focus", "selection"],
    call: (grid, rnd) => {
      grid.moveFocus(
        pick(rnd, ["up", "down", "left", "right"] as PretableFocusDirection[]),
        {
          extend: rnd() < 0.4,
          jumpToEdge: rnd() < 0.2,
          byPage: rnd() < 0.2,
        },
      );
    },
  },
  setViewport: {
    call: (grid, rnd) => {
      grid.setViewport({
        scrollTop: Math.floor(rnd() * 100),
        scrollLeft: Math.floor(rnd() * 100),
        height: 200,
        width: 400,
      });
    },
  },
  autosizeColumns: {
    call: (grid) => {
      grid.autosizeColumns();
    },
  },
  autosizeColumn: {
    call: (grid, rnd) => {
      grid.autosizeColumn(someColumnId(grid, rnd));
    },
  },
  setColumnWidth: {
    call: (grid, rnd) => {
      grid.setColumnWidth(
        someColumnId(grid, rnd),
        60 + Math.floor(rnd() * 240),
      );
    },
  },
  moveColumn: {
    call: (grid, rnd) => {
      grid.moveColumn(
        someColumnId(grid, rnd),
        Math.floor(rnd() * (grid.options.columns.length + 1)),
      );
    },
  },
  setColumnOrder: {
    call: (grid, rnd) => {
      grid.setColumnOrder(
        shuffle(
          rnd,
          grid.options.columns.map((column) => column.id),
        ),
      );
    },
  },
  setColumnPinned: {
    call: (grid, rnd) => {
      grid.setColumnPinned(
        someColumnId(grid, rnd),
        pick(rnd, ["left", "right", null] as const),
      );
    },
  },
  resetColumnLayout: {
    call: (grid) => {
      grid.resetColumnLayout();
    },
  },
  mergeColumnsFromProps: {
    call: (grid, rnd) => {
      grid.mergeColumnsFromProps(randomProps(rnd));
    },
  },
  applyTransaction: {
    call: (grid, rnd) => {
      const roll = rnd();

      if (roll < 0.34) {
        grid.applyTransaction({ add: [pick(rnd, ROWS)] });
      } else if (roll < 0.67) {
        grid.applyTransaction({
          update: [{ id: pick(rnd, ROWS).id, amount: Math.floor(rnd() * 50) }],
        });
      } else {
        grid.applyTransaction({ remove: [pick(rnd, ROWS).id] });
      }
    },
  },
  setRows: {
    // Ranges whose rows are gone are pruned by id — a row-model decision, not
    // a column one. The column checks still apply to every survivor.
    authors: ["rows"],
    call: (grid, rnd) => {
      grid.setRows(ROWS.filter(() => rnd() < 0.85).map((row) => ({ ...row })));
    },
  },
  setResultMeta: {
    // A CHANGED datasetKey means the loaded records answer a different
    // question, so the engine drops selection and focus wholesale rather than
    // reconciling them. No `total` here: this grid has engine filter
    // authority, where a supplied total is a warned no-op.
    authors: ["selection", "focus"],
    call: (grid, rnd) => {
      grid.setResultMeta({ datasetKey: pick(rnd, ["ds-a", "ds-b", "ds-c"]) });
    },
  },
  setRowGroups: {
    call: (grid, rnd) => {
      const roll = rnd();

      if (roll < 0.3) {
        grid.setRowGroups([]);
      } else if (roll < 0.75) {
        grid.setRowGroups([someColumnId(grid, rnd)]);
      } else {
        grid.setRowGroups([
          pick(rnd, ["dept", "region"]),
          someColumnId(grid, rnd),
        ]);
      }
    },
  },
  toggleGroup: {
    call: (grid, rnd) => {
      const ids = groupRowIds(grid);

      grid.toggleGroup(ids.length === 0 ? "no-such-group" : pick(rnd, ids));
    },
  },
  setGroupExpanded: {
    call: (grid, rnd) => {
      const ids = groupRowIds(grid);

      grid.setGroupExpanded(
        ids.length === 0 ? "no-such-group" : pick(rnd, ids),
        rnd() < 0.5,
      );
    },
  },
  expandAll: {
    call: (grid) => {
      grid.expandAll();
    },
  },
  collapseAll: {
    call: (grid) => {
      grid.collapseAll();
    },
  },
  beginEdit: {
    call: (grid, rnd) => {
      grid.beginEdit(
        { rowId: someRowId(grid, rnd), columnId: someColumnId(grid, rnd) },
        rnd() < 0.5 ? { status: "checking" } : undefined,
      );
    },
  },
  setEditDraft: {
    call: (grid, rnd) => {
      grid.setEditDraft(Math.floor(rnd() * 100));
    },
  },
  markEditing: {
    call: (grid) => {
      grid.markEditing();
    },
  },
  markEditValidating: {
    call: (grid) => {
      grid.markEditValidating();
    },
  },
  markEditSaving: {
    call: (grid) => {
      grid.markEditSaving();
    },
  },
  markEditInvalid: {
    call: (grid) => {
      grid.markEditInvalid("nope");
    },
  },
  markEditError: {
    call: (grid) => {
      grid.markEditError("boom");
    },
  },
  commitEditSucceeded: {
    call: (grid) => {
      grid.commitEditSucceeded();
    },
  },
  cancelEdit: {
    call: (grid) => {
      grid.cancelEdit();
    },
  },
};

const METHOD_NAMES = Object.keys(METHODS);

/** Non-function members of the engine. Nothing here can mutate anything. */
const NON_METHOD_KEYS = ["options"];

function randomRange(grid: Engine, rnd: Rnd): PretableCellRange | null {
  const columns = drawnIds(grid);
  const rows = dataRowIds(grid);

  if (columns.length === 0 || rows.length === 0) {
    return null;
  }

  const rowA = pick(rnd, rows);
  const rowB = rnd() < 0.6 ? rowA : pick(rnd, rows);
  const full = rnd() < 0.45;
  const colA = full ? (columns[0] as string) : pick(rnd, columns);
  const colB = full
    ? (columns[columns.length - 1] as string)
    : pick(rnd, columns);
  // Right-to-left drags store their bounds reversed; the reconciler has to keep
  // that orientation, so the sweep must produce it.
  const reversed = rnd() < 0.3;

  return {
    startRowId: rowA,
    endRowId: rowB,
    startColumnId: reversed ? colB : colA,
    endColumnId: reversed ? colA : colB,
  };
}

function randomProps(rnd: Rnd): PretableColumn<Row>[] {
  const pool = [...COLUMN_POOL, EXTRA_COLUMN];
  const chosen = shuffle(rnd, pool).filter(() => rnd() < 0.8);
  const kept = chosen.length === 0 ? [pool[0] as PretableColumn<Row>] : chosen;

  return kept.map((column) => {
    const pinned = rnd();

    return {
      ...column,
      ...(pinned < 0.15
        ? { pinned: "left" as const }
        : pinned < 0.3
          ? { pinned: "right" as const }
          : {}),
    };
  });
}

function makeGrid(rnd: Rnd): Engine {
  const columns = COLUMN_POOL.map((column) => {
    const pinned = rnd();

    return {
      ...column,
      ...(pinned < 0.15
        ? { pinned: "left" as const }
        : pinned < 0.3
          ? { pinned: "right" as const }
          : {}),
      ...(rnd() < 0.15 ? { rowGroup: true } : {}),
    };
  });

  return createGridCore<Row>({
    columns,
    rows: ROWS.map((row) => ({ ...row })),
    getRowId: (row) => row.id,
    ...(rnd() < 0.25 ? { autosize: true } : {}),
    ...(rnd() < 0.2 ? { groupsDefaultExpanded: false } : {}),
    ...(rnd() < 0.2 ? { hideGroupedColumns: false } : {}),
    ...(rnd() < 0.2 ? { groupColumn: { pinned: "left" as const } } : {}),
  });
}

/** The column ids a range covers, or `null` when an endpoint does not resolve. */
function coveredColumns(
  columns: readonly string[],
  range: PretableCellRange,
): string[] | null {
  const start = columns.indexOf(range.startColumnId);
  const end = columns.indexOf(range.endColumnId);

  if (start === -1 || end === -1) {
    return null;
  }

  return columns.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/**
 * The columns a range must cover once the drawn model has gone from `before` to
 * `after`, or `null` when it must be dropped. Spec §1/§1b, in two rules:
 *
 * 1. Endpoints that WERE the drawn first/last were positional ("the whole
 *    row"), so they follow the new first/last — including over a column that
 *    has just appeared, such as the synthetic group column.
 * 2. Otherwise the range means the specific columns it covered, so those are
 *    preserved. If a reorder has split the survivors apart, no contiguous range
 *    covers exactly them and the range is dropped rather than stretched over
 *    the intruder.
 */
function expectedCoverage(
  before: readonly string[],
  after: readonly string[],
  range: PretableCellRange,
): string[] | null {
  if (after.length === 0) {
    return null;
  }

  const first = before[0] as string;
  const last = before[before.length - 1] as string;
  const fullRow =
    (range.startColumnId === first && range.endColumnId === last) ||
    (range.startColumnId === last && range.endColumnId === first);

  if (fullRow) {
    return [...after];
  }

  const members = coveredColumns(before, range);

  if (members === null) {
    return null;
  }

  const positions = members
    .map((id) => after.indexOf(id))
    .filter((index) => index !== -1);

  if (positions.length === 0) {
    return null;
  }

  const lo = Math.min(...positions);
  const hi = Math.max(...positions);

  if (hi - lo + 1 !== positions.length) {
    return null;
  }

  return after.slice(lo, hi + 1);
}

interface Snapshot {
  columns: string[];
  ranges: PretableCellRange[];
  anchorColumnId: string | null;
  focusRowId: string | null;
  focusColumnId: string | null;
  visibleRowIds: string[];
}

function capture(grid: Engine): Snapshot {
  const snapshot = grid.getSnapshot();

  return {
    columns: drawnIds(grid),
    ranges: snapshot.selection.ranges.map((range) => ({ ...range })),
    anchorColumnId: snapshot.selection.anchor?.columnId ?? null,
    focusRowId: snapshot.focus.rowId,
    focusColumnId: snapshot.focus.columnId,
    visibleRowIds: snapshot.visibleRows.map((row) => row.id),
  };
}

/** Establish something worth corrupting. Not asserted — this is arrangement. */
function seedState(grid: Engine, rnd: Rnd): void {
  const snapshot = grid.getSnapshot();

  if (snapshot.selection.ranges.length === 0 || rnd() < 0.25) {
    const range = randomRange(grid, rnd);

    if (range) {
      if (snapshot.selection.ranges.length >= 4) {
        grid.setSelection({
          ranges: [range],
          anchor: { rowId: range.startRowId, columnId: range.startColumnId },
        });
      } else {
        grid.addRange(range);
      }
    }
  }

  if (snapshot.focus.rowId === null || rnd() < 0.25) {
    const columns = drawnIds(grid);
    const rows = snapshot.visibleRows.map((row) => row.id);

    if (columns.length > 0 && rows.length > 0) {
      grid.setFocus({
        rowId: pick(rnd, rows),
        columnId: pick(rnd, columns),
      });
    }
  }
}

function assertInvariants(
  before: Snapshot,
  grid: Engine,
  spec: MethodSpec,
  context: string,
): void {
  const snapshot = grid.getSnapshot();
  const after = drawnIds(grid);
  const afterRowIds = new Set(snapshot.visibleRows.map((row) => row.id));
  const authors = spec.authors ?? [];

  // `authors` relaxes the preservation checks below, so it must not be reachable
  // by the very methods those checks exist for. A method that redraws the
  // columns is a column mutator no matter what it claims about selection, and
  // claiming authority is the only way to dodge this file — so the claim is
  // checked rather than trusted.
  if (authors.length > 0) {
    expect(
      after,
      `${context}\n"${authors.join("+")}" authority is only for methods that leave the drawn columns alone — this one redrew them, so it owes a reconcile like every other column mutator`,
    ).toEqual(before.columns);
  }

  // Structural, and true of every method: a stored id nobody can resolve is
  // what makes `copy` emit one column and `deriveSelectedRows` under-report.
  for (const range of snapshot.selection.ranges) {
    expect(
      coveredColumns(after, range),
      `${context}\nunresolvable range ${range.startColumnId}…${range.endColumnId} against [${after.join(",")}]`,
    ).not.toBeNull();
  }

  const anchorColumnId = snapshot.selection.anchor?.columnId ?? null;

  expect(
    anchorColumnId === null || after.includes(anchorColumnId),
    `${context}\nanchor column ${String(anchorColumnId)} is not drawn: [${after.join(",")}]`,
  ).toBe(true);

  expect(
    snapshot.focus.columnId === null || after.includes(snapshot.focus.columnId),
    `${context}\nfocus column ${String(snapshot.focus.columnId)} is not drawn: [${after.join(",")}]`,
  ).toBe(true);

  expect(
    snapshot.focus.rowId === null || afterRowIds.has(snapshot.focus.rowId),
    `${context}\nfocus row ${String(snapshot.focus.rowId)} is not visible`,
  ).toBe(true);

  // With nothing left to draw there is nothing to focus, and the structural
  // check above already forces focus to null in that case.
  const drawable = after.length > 0 && afterRowIds.size > 0;

  if (!authors.includes("focus") && before.focusRowId !== null && drawable) {
    expect(
      snapshot.focus.rowId,
      `${context}\nfocus was dropped while ${afterRowIds.size} rows × ${after.length} columns remain`,
    ).not.toBeNull();

    if (afterRowIds.has(before.focusRowId)) {
      expect(snapshot.focus.rowId, `${context}\nfocus row drifted`).toBe(
        before.focusRowId,
      );
    }

    if (before.focusColumnId !== null && after.includes(before.focusColumnId)) {
      expect(snapshot.focus.columnId, `${context}\nfocus column drifted`).toBe(
        before.focusColumnId,
      );
    }
  }

  if (authors.includes("selection")) {
    return;
  }

  expect(
    before.columns.length,
    `${context}\nempty pre-change column model`,
  ).toBeGreaterThan(0);

  const survivingRows = authors.includes("rows") ? sourceRowIds(grid) : null;
  const expected: { covered: string[]; range: PretableCellRange }[] = [];

  for (const range of before.ranges) {
    if (
      survivingRows &&
      (!survivingRows.has(range.startRowId) ||
        !survivingRows.has(range.endRowId))
    ) {
      continue;
    }

    const covered = expectedCoverage(before.columns, after, range);

    if (covered === null) {
      continue;
    }

    expected.push({ covered, range });
  }

  expect(
    snapshot.selection.ranges.length,
    `${context}\nranges: expected ${expected.length}, got ${snapshot.selection.ranges.length}\nbefore=[${before.columns.join(",")}] after=[${after.join(",")}]`,
  ).toBe(expected.length);

  for (let i = 0; i < expected.length; i += 1) {
    const actual = snapshot.selection.ranges[i] as PretableCellRange;
    const want = expected[i] as { covered: string[]; range: PretableCellRange };
    const detail = `${context}\nrange ${i}: was ${want.range.startColumnId}…${want.range.endColumnId} over [${before.columns.join(",")}], now ${actual.startColumnId}…${actual.endColumnId} over [${after.join(",")}]`;

    expect(coveredColumns(after, actual), detail).toEqual(want.covered);
    expect(actual.startRowId, detail).toBe(want.range.startRowId);
    expect(actual.endRowId, detail).toBe(want.range.endRowId);
  }
}

describe("column-model reconciliation invariant", () => {
  test("every engine member is registered in the sweep", () => {
    const grid = makeGrid(mulberry(1));
    const members = Object.entries(grid as unknown as Record<string, unknown>);
    const functions = members
      .filter(([, value]) => typeof value === "function")
      .map(([key]) => key)
      .sort();

    expect(
      functions,
      [
        "An engine method is missing from METHODS in this file.",
        "",
        "Every public method is swept, not a hand-picked list of the ones that",
        "happen to touch columns today — that list drifted twice already (#259,",
        "#264) and both times a selection-corrupting mutator shipped green.",
        "",
        "Add an entry saying how to CALL the new method. Do not decide here",
        "whether it needs `reconcileSelectionAfterColumnModelChange`; the sweep",
        "decides that, and it is the decision that was got wrong before.",
      ].join("\n"),
    ).toEqual(METHOD_NAMES.slice().sort());

    expect(
      members
        .filter(([, value]) => typeof value !== "function")
        .map(([key]) => key)
        .sort(),
    ).toEqual(NON_METHOD_KEYS.slice().sort());
  });

  // 150 seeds x 3 passes x every mutator is genuinely ~6.5-10.5s of work,
  // not a hang, so it blows the 5s default deterministically whenever the
  // machine is under load. Raise the ceiling rather than trimming the sweep:
  // the exhaustive ordering is the entire point of the invariant.
  test("selection and focus survive every mutator, in every order", () => {
    for (let seed = 0; seed < 150; seed += 1) {
      const rnd = mulberry(seed * 7919 + 13);
      const grid = makeGrid(rnd);
      const trace: string[] = [];

      for (let pass = 0; pass < 3; pass += 1) {
        for (const name of shuffle(rnd, METHOD_NAMES)) {
          seedState(grid, rnd);

          const before = capture(grid);
          const spec = METHODS[name] as MethodSpec;

          trace.push(`${name}() over [${before.columns.join(",")}]`);
          spec.call(grid, rnd);
          assertInvariants(
            before,
            grid,
            spec,
            `seed=${seed}\n${trace.slice(-8).join("\n")}`,
          );
        }
      }
    }
  }, 30_000);
});
