import type {
  PretableRowId,
  PretableRowModelSnapshot,
  PretableVisibleRowRef,
} from "@pretable-internal/row-model";

import type {
  PretableIndexedCellAddress,
  PretableIndexedCellRange,
  PretableIndexedSelectionState,
  PretableIndexedSelectionSummary,
} from "./types";

function dataRef<TRowId extends PretableRowId>(rowId: TRowId) {
  return { kind: "data" as const, rowId };
}

class ImmutableSet<T> implements ReadonlySet<T> {
  readonly #values: Set<T>;

  constructor(values?: Iterable<T>) {
    this.#values = new Set(values);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: T): boolean {
    return this.#values.has(value);
  }

  forEach(
    callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void,
    thisArg?: object,
  ): void {
    for (const value of this.#values) {
      callbackfn.call(thisArg, value, value, this);
    }
  }

  entries(): SetIterator<[T, T]> {
    return this.#values.entries();
  }

  keys(): SetIterator<T> {
    return this.#values.keys();
  }

  values(): SetIterator<T> {
    return this.#values.values();
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.#values[Symbol.iterator]();
  }

  get [Symbol.toStringTag](): string {
    return "ImmutableSet";
  }
}

/** @internal Clones mutable caller input behind a read-only collection surface. */
export function toImmutableIndexedSet<T>(values?: Iterable<T>): ReadonlySet<T> {
  return Object.freeze(new ImmutableSet(values));
}

function isVisibleData<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>, rowId: TRowId) {
  return snapshot.indexOf(dataRef(rowId)) >= 0;
}

export function createEmptyIndexedSelection<
  TRowId extends PretableRowId,
  TColumnId extends string,
>(): PretableIndexedSelectionState<TRowId, TColumnId> {
  return Object.freeze({
    rows: Object.freeze({
      kind: "explicit" as const,
      rowIds: toImmutableIndexedSet<TRowId>(),
    }),
    ranges: Object.freeze([]),
    anchor: null,
  });
}

export function selectAllVisibleRows<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  if (snapshot.visibleDataRowCount === 0) return selection;
  if (selection.rows.kind === "all" && selection.rows.excludedRowIds.size === 0)
    return selection;
  return Object.freeze({
    ...selection,
    rows: Object.freeze({
      kind: "all" as const,
      excludedRowIds: toImmutableIndexedSet<TRowId>(),
    }),
  });
}

export function toggleIndexedRowSelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  rowId: TRowId,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  if (!isVisibleData(snapshot, rowId)) return selection;
  if (selection.rows.kind === "explicit") {
    const rowIds = new Set(selection.rows.rowIds);
    if (rowIds.has(rowId)) rowIds.delete(rowId);
    else rowIds.add(rowId);
    return Object.freeze({
      ...selection,
      rows: Object.freeze({
        kind: "explicit" as const,
        rowIds: toImmutableIndexedSet(rowIds),
      }),
    });
  }
  const excludedRowIds = new Set(selection.rows.excludedRowIds);
  if (excludedRowIds.has(rowId)) excludedRowIds.delete(rowId);
  else excludedRowIds.add(rowId);
  return Object.freeze({
    ...selection,
    rows: Object.freeze({
      kind: "all" as const,
      excludedRowIds: toImmutableIndexedSet(excludedRowIds),
    }),
  });
}

export function isIndexedRowSelected<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  ref: PretableVisibleRowRef<TRowId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): boolean {
  if (ref.kind !== "data" || snapshot.indexOf(ref) < 0) return false;
  return selection.rows.kind === "explicit"
    ? selection.rows.rowIds.has(ref.rowId)
    : !selection.rows.excludedRowIds.has(ref.rowId);
}

export function getIndexedSelectionSummary<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionSummary {
  const visibleCount = snapshot.visibleDataRowCount;
  let selectedCount = 0;
  if (selection.rows.kind === "explicit") {
    for (const rowId of selection.rows.rowIds) {
      if (isVisibleData(snapshot, rowId)) selectedCount += 1;
    }
  } else {
    let excludedVisible = 0;
    for (const rowId of selection.rows.excludedRowIds) {
      if (isVisibleData(snapshot, rowId)) excludedVisible += 1;
    }
    selectedCount = Math.max(0, visibleCount - excludedVisible);
  }
  return Object.freeze({
    state:
      selectedCount === 0
        ? "none"
        : selectedCount === visibleCount
          ? "all"
          : "some",
    selectedCount,
    visibleCount,
  });
}

function columnIndex<TColumnId extends string>(
  columns: readonly TColumnId[],
  columnId: TColumnId,
): number {
  for (let index = 0; index < columns.length; index += 1) {
    if (columns[index] === columnId) return index;
  }
  return -1;
}

export function indexedRangeContainsCell<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  range: PretableIndexedCellRange<TRowId, TColumnId>,
  ref: PretableVisibleRowRef<TRowId>,
  columnId: TColumnId,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
  columns: readonly TColumnId[],
): boolean {
  if (ref.kind !== "data") return false;
  const rowIndex = snapshot.indexOf(ref);
  const startRowIndex = snapshot.indexOf(dataRef(range.start.rowId));
  const endRowIndex = snapshot.indexOf(dataRef(range.end.rowId));
  const currentColumnIndex = columnIndex(columns, columnId);
  const startColumnIndex = columnIndex(columns, range.start.columnId);
  const endColumnIndex = columnIndex(columns, range.end.columnId);
  if (
    rowIndex < 0 ||
    startRowIndex < 0 ||
    endRowIndex < 0 ||
    currentColumnIndex < 0 ||
    startColumnIndex < 0 ||
    endColumnIndex < 0
  ) {
    return false;
  }
  return (
    rowIndex >= Math.min(startRowIndex, endRowIndex) &&
    rowIndex <= Math.max(startRowIndex, endRowIndex) &&
    currentColumnIndex >= Math.min(startColumnIndex, endColumnIndex) &&
    currentColumnIndex <= Math.max(startColumnIndex, endColumnIndex)
  );
}

function visibleAddress<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  address: PretableIndexedCellAddress<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): boolean {
  return isVisibleData(snapshot, address.rowId);
}

export function reconcileIndexedSelection<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
  TColumnId extends string,
>(
  selection: PretableIndexedSelectionState<TRowId, TColumnId>,
  snapshot: PretableRowModelSnapshot<TRow, TRowId, TColumns>,
): PretableIndexedSelectionState<TRowId, TColumnId> {
  let changed = false;
  const ranges: PretableIndexedCellRange<TRowId, TColumnId>[] = [];
  for (const range of selection.ranges) {
    const startVisible = visibleAddress(range.start, snapshot);
    const endVisible = visibleAddress(range.end, snapshot);
    if (startVisible && endVisible) {
      ranges.push(range);
    } else if (startVisible || endVisible) {
      const survivor = startVisible ? range.start : range.end;
      ranges.push(Object.freeze({ start: survivor, end: survivor }));
      changed = true;
    } else {
      changed = true;
    }
  }
  let anchor = selection.anchor;
  if (anchor !== null && !visibleAddress(anchor, snapshot)) {
    anchor = ranges[0]?.start ?? null;
    changed = true;
  }
  if (!changed) return selection;
  return Object.freeze({ ...selection, ranges: Object.freeze(ranges), anchor });
}
