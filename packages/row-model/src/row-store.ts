import type { CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import { PretableRowModelError } from "./errors";
import type { RowRecord, SourceOrderKey } from "./internal-types";
import {
  createOrderStatisticTree,
  instrumentOrderStatisticTree,
} from "./persistent/order-statistic-tree";
import {
  createPersistentMap,
  instrumentPersistentMap,
  type PersistentMap,
} from "./persistent/persistent-map";
import {
  inspectRowIntegrity,
  type PretableRowIntegrityDiagnostic,
} from "./row-integrity";
import type { SlotAllocator } from "./slot-allocator";
import { slotVectorFromEntries, type SlotVector } from "./slot-vector";

export interface BuildRowStoreInput<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rows: readonly TRow[];
  readonly getRowId: (row: TRow) => TRowId;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly previous?: PersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>;
  readonly slots: SlotAllocator;
  readonly instrumentation?: LocalRowModelInstrumentation;
}

export interface BuiltRowStore<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rows: PersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>;
  readonly sourceOrder: ReturnType<typeof createSourceOrderTree<TRowId>>;
  readonly records: readonly RowRecord<TRow, TRowId, TColumns>[];
  /** Slot-indexed view of `records`, sized to the allocator at build time. */
  readonly recordsBySlot: SlotVector<RowRecord<TRow, TRowId, TColumns>>;
  readonly sameReferenceMutation: boolean;
  readonly sameReferenceMutationCount: number;
  readonly diagnostics: readonly PretableRowIntegrityDiagnostic<TRowId>[];
}

/** Re-evaluates a bulk query while preserving every canonical source token. */
export function rebuildRowStoreForQuery<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  previousRows: PersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>,
  sourceOrder: ReturnType<typeof createSourceOrderTree<TRowId>>,
  queryPlan: CompiledQuery<TColumns>,
): Pick<
  BuiltRowStore<TRow, TRowId, TColumns>,
  "rows" | "sourceOrder" | "records"
> {
  const draft = createPersistentMap<
    TRowId,
    RowRecord<TRow, TRowId, TColumns>
  >().asTransient();
  const records: RowRecord<TRow, TRowId, TColumns>[] = [];
  // `range(0, size)` rather than `entries()`: a full walk into an array, and
  // the tree's non-generator walk is the cheaper way to get one (see
  // `iterateEntries`). The only exit below is a throw, not an early return.
  for (const source of sourceOrder.range(0, sourceOrder.size)) {
    const previous = previousRows.get(source.rowId);
    if (previous === undefined) {
      throw new PretableRowModelError(
        "derivation-failed",
        "The canonical source index referenced a missing row.",
        { operation: "set-query", rowId: source.rowId },
      );
    }
    const metadata = queryPlan.evaluate({
      rowId: previous.rowId,
      row: previous.row as never,
      sourceOrder: previous.sourceOrder,
    }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    // The spread carries `slot` (with everything else the query re-evaluation
    // leaves untouched) — a query rebuild never changes row lifetimes.
    const record = Object.freeze({ ...previous, metadata });
    draft.set(record.rowId, record);
    records.push(record);
  }
  return {
    rows: draft.freeze(),
    sourceOrder,
    records: Object.freeze(records),
  };
}

export function createSourceOrderTree<TRowId extends PretableRowId>(
  instrumentation?: LocalRowModelInstrumentation,
) {
  return instrumentOrderStatisticTree(
    createOrderStatisticTree<TRowId, SourceOrderKey<TRowId>, number>({
      getId: (entry) => entry.rowId,
      compare: (left, right) => left.sourceOrder - right.sourceOrder,
      measure: {
        empty: 0,
        fromEntry: () => 1,
        combine: (left, right) => left + right,
      },
    }),
    instrumentation,
  );
}

function captureRows<TRow extends object>(
  rows: readonly TRow[],
): readonly TRow[] {
  try {
    return Array.from(rows);
  } catch (cause) {
    throw new PretableRowModelError(
      "derivation-failed",
      "The rows input could not be read safely.",
      { operation: "set-rows", cause },
    );
  }
}

function captureRowId<TRow extends object, TRowId extends PretableRowId>(
  row: TRow,
  getRowId: (row: TRow) => TRowId,
): TRowId {
  try {
    const rowId = getRowId(row);
    if (typeof rowId !== "string" && typeof rowId !== "number") {
      throw new TypeError("Row IDs must be strings or numbers.");
    }
    return rowId;
  } catch (cause) {
    throw new PretableRowModelError(
      "derivation-failed",
      "The row ID accessor failed.",
      { operation: "set-rows", cause },
    );
  }
}

/** Builds the canonical persistent store after validating every ID first. */
export function buildRowStore<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  input: BuildRowStoreInput<TRow, TRowId, TColumns>,
): BuiltRowStore<TRow, TRowId, TColumns> {
  const captured = captureRows(input.rows);
  const ids: TRowId[] = [];
  const seen = new Set<TRowId>();
  for (const row of captured) {
    const rowId = captureRowId(row, input.getRowId);
    if (seen.has(rowId)) {
      throw new PretableRowModelError(
        "duplicate-row-id",
        `Duplicate row ID ${String(rowId)}.`,
        { operation: "set-rows", rowId },
      );
    }
    seen.add(rowId);
    ids.push(rowId);
  }

  const inspections = captured.map((row, index) => {
    const rowId = ids[index]!;
    const previous = input.previous?.get(rowId);
    return inspectRowIntegrity(
      row,
      rowId,
      previous?.integrity,
      previous !== undefined && Object.is(previous.row, row),
    );
  });
  const sameReferenceMutation = inspections.some(
    (inspection) => inspection.sameReferenceMutation,
  );

  const mapDraft = instrumentPersistentMap(
    createPersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>(),
    input.instrumentation,
  ).asTransient();
  const sourceDraft = createSourceOrderTree<TRowId>(
    input.instrumentation,
  ).asTransient();
  const records: RowRecord<TRow, TRowId, TColumns>[] = [];
  for (let sourceOrder = 0; sourceOrder < captured.length; sourceOrder += 1) {
    const row = captured[sourceOrder]!;
    const rowId = ids[sourceOrder]!;
    const previous = input.previous?.get(rowId);
    if (input.instrumentation !== undefined)
      input.instrumentation.work.rowsEvaluated += 1;
    const metadata = input.queryPlan.evaluate({
      rowId,
      row: row as never,
      sourceOrder,
    }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    const publicRow =
      previous !== undefined &&
      Object.is(previous.row, row) &&
      previous.sourceOrder === sourceOrder &&
      !inspections[sourceOrder]!.sameReferenceMutation
        ? previous.publicRow
        : Object.freeze({
            kind: "data" as const,
            rowId,
            row,
            sourceIndex: sourceOrder,
            depth: 0,
          });
    const slot =
      previous !== undefined ? previous.slot : input.slots.allocate();
    const record = Object.freeze({
      rowId,
      row,
      sourceOrder,
      slot,
      metadata,
      publicRow,
      integrity: inspections[sourceOrder]!.integrity,
    });
    mapDraft.set(rowId, record);
    sourceDraft.insertOrReplace(Object.freeze({ rowId, sourceOrder }));
    records.push(record);
  }
  if (input.previous !== undefined) {
    for (const [rowId, record] of input.previous.entries()) {
      if (!seen.has(rowId)) input.slots.release(record.slot);
    }
  }
  return {
    rows: mapDraft.freeze(),
    sourceOrder: sourceDraft.freeze(),
    records: Object.freeze(records),
    recordsBySlot: slotVectorFromEntries(
      records.map((record) => [record.slot, record] as const),
      input.slots.capacity,
    ),
    sameReferenceMutation,
    sameReferenceMutationCount: inspections.filter(
      (inspection) => inspection.sameReferenceMutation,
    ).length,
    diagnostics: Object.freeze(
      inspections.flatMap((inspection) =>
        inspection.diagnostic === undefined ? [] : [inspection.diagnostic],
      ),
    ),
  };
}
