import type { CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import { PretableRowModelError } from "./errors";
import type { RowRecord, SourceOrderKey } from "./internal-types";
import { createOrderStatisticTree } from "./persistent/order-statistic-tree";
import {
  createPersistentMap,
  type PersistentMap,
} from "./persistent/persistent-map";
import {
  inspectRowIntegrity,
  type PretableRowIntegrityDiagnosticSink,
} from "./row-integrity";

export interface BuildRowStoreInput<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rows: readonly TRow[];
  readonly getRowId: (row: TRow) => TRowId;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly previous?: PersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>;
  readonly onDiagnostic?: PretableRowIntegrityDiagnosticSink<TRowId>;
}

export interface BuiltRowStore<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rows: PersistentMap<TRowId, RowRecord<TRow, TRowId, TColumns>>;
  readonly sourceOrder: ReturnType<typeof createSourceOrderTree<TRowId>>;
  readonly records: readonly RowRecord<TRow, TRowId, TColumns>[];
  readonly sameReferenceMutation: boolean;
  readonly sameReferenceMutationCount: number;
}

function createSourceOrderTree<TRowId extends PretableRowId>() {
  return createOrderStatisticTree<TRowId, SourceOrderKey<TRowId>, number>({
    getId: (entry) => entry.rowId,
    compare: (left, right) => left.sourceOrder - right.sourceOrder,
    measure: {
      empty: 0,
      fromEntry: () => 1,
      combine: (left, right) => left + right,
    },
  });
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

  const mapDraft = createPersistentMap<
    TRowId,
    RowRecord<TRow, TRowId, TColumns>
  >().asTransient();
  const sourceDraft = createSourceOrderTree<TRowId>().asTransient();
  const records: RowRecord<TRow, TRowId, TColumns>[] = [];
  for (let sourceOrder = 0; sourceOrder < captured.length; sourceOrder += 1) {
    const row = captured[sourceOrder]!;
    const rowId = ids[sourceOrder]!;
    const previous = input.previous?.get(rowId);
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
    const record = Object.freeze({
      rowId,
      row,
      sourceOrder,
      metadata,
      publicRow,
      integrity: inspections[sourceOrder]!.integrity,
    });
    mapDraft.set(rowId, record);
    sourceDraft.insertOrReplace(Object.freeze({ rowId, sourceOrder }));
    records.push(record);
  }
  inspections.forEach((inspection) =>
    inspection.emitDiagnostic(input.onDiagnostic),
  );
  return {
    rows: mapDraft.freeze(),
    sourceOrder: sourceDraft.freeze(),
    records: Object.freeze(records),
    sameReferenceMutation,
    sameReferenceMutationCount: inspections.filter(
      (inspection) => inspection.sameReferenceMutation,
    ).length,
  };
}
