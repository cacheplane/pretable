import type { CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import { PretableRowModelError } from "./errors";
import type { RevisionRoot, RowRecord } from "./internal-types";
import {
  inspectRowIntegrity,
  type PretableRowIntegrityDiagnostic,
} from "./row-integrity";
import type { PretableMutationIssue, PretableTransaction } from "./types";
import { createFlatVisibleTree } from "./visible-index";

interface TransactionDraftInput<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly root: RevisionRoot<TRow, TRowId, TColumns>;
  readonly transaction: PretableTransaction<TRow, TRowId>;
  readonly getRowId: (row: TRow) => TRowId;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly nextSourceOrder: number;
}

export interface TransactionDraftResult<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> {
  readonly rows: RevisionRoot<TRow, TRowId, TColumns>["rows"];
  readonly sourceOrder: RevisionRoot<TRow, TRowId, TColumns>["sourceOrder"];
  readonly visible: RevisionRoot<TRow, TRowId, TColumns>["visible"];
  readonly nextSourceOrder: number;
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
  readonly ignored: number;
  readonly issues: readonly PretableMutationIssue<TRowId>[];
  readonly diagnostics: readonly PretableRowIntegrityDiagnostic<TRowId>[];
  readonly effective: boolean;
}

export interface RowsReplacementDraftResult<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> extends TransactionDraftResult<TRow, TRowId, TColumns> {
  readonly sameReferenceMutation: boolean;
}

class TransactionExecutionError extends PretableRowModelError {
  readonly rowIds: readonly PretableRowId[] | undefined;
  readonly groupValues: readonly unknown[] | undefined;

  constructor(error: PretableRowModelError) {
    super(error.code, error.message, {
      operation: "apply-transaction",
      rowId: error.rowId,
      columnId: error.columnId,
      cause: error.cause,
    });
    const detailed = error as PretableRowModelError & {
      readonly rowIds?: readonly PretableRowId[];
      readonly groupValues?: readonly unknown[];
    };
    this.rowIds = detailed.rowIds;
    this.groupValues = detailed.groupValues;
  }
}

function remap(error: unknown): never {
  if (
    error instanceof PretableRowModelError &&
    error.operation !== "apply-transaction"
  ) {
    throw new TransactionExecutionError(error);
  }
  throw error;
}

function fail(
  code:
    | "duplicate-row-id"
    | "existing-row-id"
    | "transaction-conflict"
    | "derivation-failed",
  message: string,
  rowId?: PretableRowId,
  cause?: unknown,
): never {
  throw new PretableRowModelError(code, message, {
    operation: "apply-transaction",
    rowId,
    cause,
  });
}

function captureList<T>(
  value: readonly T[] | undefined,
  name: string,
): readonly T[] {
  if (value === undefined) return [];
  try {
    return Array.from(value);
  } catch (cause) {
    return fail(
      "derivation-failed",
      `The transaction ${name} list could not be read safely.`,
      undefined,
      cause,
    );
  }
}

function captureId<TRow extends object, TRowId extends PretableRowId>(
  row: TRow,
  getRowId: (row: TRow) => TRowId,
): TRowId {
  try {
    const id = getRowId(row);
    if (typeof id !== "string" && typeof id !== "number")
      throw new TypeError("Row IDs must be strings or numbers.");
    return id;
  } catch (cause) {
    return fail(
      "derivation-failed",
      "The row ID accessor failed.",
      undefined,
      cause,
    );
  }
}

function mergeChanges<TRow extends object, TRowId extends PretableRowId>(
  previous: TRow,
  changesList: readonly Partial<TRow>[],
  rowId: TRowId,
): { readonly row: TRow; readonly changed: boolean } {
  try {
    let changed = false;
    const row = Object.assign({}, previous) as TRow;
    for (const changes of changesList) {
      if (changes === null || typeof changes !== "object") {
        return fail(
          "derivation-failed",
          "A transaction update must provide an object of changes.",
          rowId,
        );
      }
      for (const key of Reflect.ownKeys(changes)) {
        const descriptor = Object.getOwnPropertyDescriptor(changes, key);
        if (descriptor?.enumerable !== true) continue;
        const value = (changes as Record<PropertyKey, unknown>)[key];
        if (!Object.is((row as Record<PropertyKey, unknown>)[key], value))
          changed = true;
        (row as Record<PropertyKey, unknown>)[key] = value;
      }
    }
    return { row: changed ? Object.freeze(row) : row, changed };
  } catch (cause) {
    return fail(
      "derivation-failed",
      "A transaction update could not be merged safely.",
      rowId,
      cause,
    );
  }
}

function createRecord<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  row: TRow,
  rowId: TRowId,
  sourceOrder: number,
  queryPlan: CompiledQuery<TColumns>,
): {
  readonly record: RowRecord<TRow, TRowId, TColumns>;
  readonly diagnostic?: PretableRowIntegrityDiagnostic<TRowId>;
} {
  const metadata = queryPlan.evaluate({
    rowId,
    row: row as never,
    sourceOrder,
  }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
  const inspection = inspectRowIntegrity(row, rowId, undefined, false);
  return {
    record: Object.freeze({
      rowId,
      row,
      sourceOrder,
      metadata,
      publicRow: Object.freeze({
        kind: "data" as const,
        rowId,
        row,
        sourceIndex: sourceOrder,
        depth: 0,
      }),
      integrity: inspection.integrity,
    }),
    diagnostic: inspection.diagnostic,
  };
}

/** Validates and prepares a complete transaction before acquiring transient roots. */
export function applyFlatTransactionDraft<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  input: TransactionDraftInput<TRow, TRowId, TColumns>,
): TransactionDraftResult<TRow, TRowId, TColumns> {
  try {
    const adds = captureList(input.transaction.add, "add");
    const updates = captureList(input.transaction.update, "update");
    const removes = captureList(input.transaction.remove, "remove");

    const addById = new Map<TRowId, TRow>();
    for (const row of adds) {
      const rowId = captureId(row, input.getRowId);
      if (addById.has(rowId))
        fail(
          "duplicate-row-id",
          `Duplicate added row ID ${String(rowId)}.`,
          rowId,
        );
      addById.set(rowId, row);
    }
    const updateById = new Map<TRowId, Partial<TRow>[]>();
    for (const update of updates) {
      let rowId: TRowId;
      let changes: Partial<TRow>;
      try {
        rowId = update.id;
        changes = update.changes;
      } catch (cause) {
        return fail(
          "derivation-failed",
          "A transaction update could not be read safely.",
          undefined,
          cause,
        );
      }
      const list = updateById.get(rowId);
      if (list === undefined) updateById.set(rowId, [changes]);
      else list.push(changes);
    }
    const removeIds = new Set<TRowId>();
    for (const rowId of removes) removeIds.add(rowId);
    for (const rowId of addById.keys()) {
      if (updateById.has(rowId) || removeIds.has(rowId))
        fail(
          "transaction-conflict",
          `Row ID ${String(rowId)} appears in multiple transaction categories.`,
          rowId,
        );
    }
    for (const rowId of updateById.keys()) {
      if (removeIds.has(rowId))
        fail(
          "transaction-conflict",
          `Row ID ${String(rowId)} appears in multiple transaction categories.`,
          rowId,
        );
    }
    for (const rowId of addById.keys()) {
      if (input.root.rows.has(rowId))
        fail(
          "existing-row-id",
          `Row ID ${String(rowId)} already exists.`,
          rowId,
        );
    }

    const issues: PretableMutationIssue<TRowId>[] = [];
    const pending: {
      readonly rowId: TRowId;
      readonly row: TRow;
      readonly sourceOrder: number;
    }[] = [];
    const prepared: RowRecord<TRow, TRowId, TColumns>[] = [];
    const diagnostics: PretableRowIntegrityDiagnostic<TRowId>[] = [];
    let unchanged = 0;
    let ignored = 0;
    let nextSourceOrder = input.nextSourceOrder;

    for (const [rowId, changes] of updateById) {
      const previous = input.root.rows.get(rowId);
      if (previous === undefined) {
        issues.push(
          Object.freeze({ code: "unknown-update-id" as const, rowId }),
        );
        ignored += 1;
        continue;
      }
      const merged = mergeChanges(previous.row, changes, rowId);
      if (!merged.changed) {
        unchanged += 1;
        continue;
      }
      pending.push({
        rowId,
        row: merged.row,
        sourceOrder: previous.sourceOrder,
      });
    }
    for (const [rowId, row] of addById) {
      pending.push({ rowId, row, sourceOrder: nextSourceOrder });
      nextSourceOrder += 1;
    }

    const effectiveRemoves: TRowId[] = [];
    for (const rowId of removeIds) {
      if (!input.root.rows.has(rowId)) {
        issues.push(
          Object.freeze({ code: "unknown-remove-id" as const, rowId }),
        );
        ignored += 1;
      } else effectiveRemoves.push(rowId);
    }

    // All lists, IDs, and partial values are captured before active accessors
    // are allowed to run.
    for (const candidate of pending) {
      const made = createRecord(
        candidate.row,
        candidate.rowId,
        candidate.sourceOrder,
        input.queryPlan,
      );
      prepared.push(made.record);
      if (made.diagnostic) diagnostics.push(made.diagnostic);
    }

    const effective = prepared.length > 0 || effectiveRemoves.length > 0;
    if (!effective) {
      return {
        rows: input.root.rows,
        sourceOrder: input.root.sourceOrder,
        visible: input.root.visible,
        nextSourceOrder: input.nextSourceOrder,
        added: 0,
        updated: 0,
        removed: 0,
        unchanged,
        ignored,
        issues: Object.freeze(issues),
        diagnostics: Object.freeze([]),
        effective: false,
      };
    }

    const rowDraft = input.root.rows.asTransient();
    const sourceDraft = input.root.sourceOrder.asTransient();
    const visibleDraft = input.root.visible.rows.asTransient();
    for (const rowId of effectiveRemoves) {
      rowDraft.delete(rowId);
      sourceDraft.remove(rowId);
      visibleDraft.remove(rowId);
    }
    for (const record of prepared) {
      const previous = input.root.rows.get(record.rowId);
      rowDraft.set(record.rowId, record);
      if (previous === undefined)
        sourceDraft.insertOrReplace(
          Object.freeze({
            rowId: record.rowId,
            sourceOrder: record.sourceOrder,
          }),
        );
      if (record.metadata.filterPasses) visibleDraft.insertOrReplace(record);
      else visibleDraft.remove(record.rowId);
    }
    return {
      rows: rowDraft.freeze(),
      sourceOrder: sourceDraft.freeze(),
      visible: Object.freeze({ rows: visibleDraft.freeze() }),
      nextSourceOrder,
      added: addById.size,
      updated: prepared.length - addById.size,
      removed: effectiveRemoves.length,
      unchanged,
      ignored,
      issues: Object.freeze(issues),
      diagnostics: Object.freeze(diagnostics),
      effective: true,
    };
  } catch (error) {
    return remap(error);
  }
}

/** Applies an authoritative rows-array replacement through one set of drafts. */
export function replaceFlatRowsDraft<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(input: {
  readonly root: RevisionRoot<TRow, TRowId, TColumns>;
  readonly rows: readonly TRow[];
  readonly getRowId: (row: TRow) => TRowId;
  readonly queryPlan: CompiledQuery<TColumns>;
  readonly nextSourceOrder: number;
  readonly acceptSameReferenceMutation?: boolean;
}): RowsReplacementDraftResult<TRow, TRowId, TColumns> {
  let captured: readonly TRow[];
  try {
    captured = Array.from(input.rows);
  } catch (cause) {
    throw new PretableRowModelError(
      "derivation-failed",
      "The rows input could not be read safely.",
      { operation: "set-rows", cause },
    );
  }
  const ids: TRowId[] = [];
  const seen = new Set<TRowId>();
  for (const row of captured) {
    let rowId: TRowId;
    try {
      rowId = input.getRowId(row);
      if (typeof rowId !== "string" && typeof rowId !== "number") {
        throw new TypeError("Row IDs must be strings or numbers.");
      }
    } catch (cause) {
      throw new PretableRowModelError(
        "derivation-failed",
        "The row ID accessor failed.",
        { operation: "set-rows", cause },
      );
    }
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

  const candidates: {
    readonly row: TRow;
    readonly rowId: TRowId;
    readonly sourceOrder: number;
    readonly integrity: RowRecord<TRow, TRowId, TColumns>["integrity"];
  }[] = [];
  const changedRecords: RowRecord<TRow, TRowId, TColumns>[] = [];
  const diagnostics: PretableRowIntegrityDiagnostic<TRowId>[] = [];
  let sameReferenceMutation = false;
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (let sourceOrder = 0; sourceOrder < captured.length; sourceOrder += 1) {
    const row = captured[sourceOrder]!;
    const rowId = ids[sourceOrder]!;
    const previous = input.root.rows.get(rowId);
    const sameReference =
      previous !== undefined && Object.is(previous.row, row);
    const inspection = inspectRowIntegrity(
      row,
      rowId,
      previous?.integrity,
      sameReference,
    );
    if (inspection.diagnostic) diagnostics.push(inspection.diagnostic);
    if (inspection.sameReferenceMutation) sameReferenceMutation = true;
    if (
      previous !== undefined &&
      sameReference &&
      previous.sourceOrder === sourceOrder &&
      !inspection.sameReferenceMutation
    ) {
      unchanged += 1;
      continue;
    }
    candidates.push({
      row,
      rowId,
      sourceOrder,
      integrity: inspection.integrity,
    });
    if (previous === undefined) added += 1;
    else updated += 1;
  }
  let removed = 0;
  for (const [rowId] of input.root.rows.entries()) {
    if (!seen.has(rowId)) removed += 1;
  }
  const effective = added > 0 || updated > 0 || removed > 0;
  if (sameReferenceMutation && input.acceptSameReferenceMutation !== true) {
    return {
      rows: input.root.rows,
      sourceOrder: input.root.sourceOrder,
      visible: input.root.visible,
      nextSourceOrder: input.nextSourceOrder,
      added,
      updated,
      removed,
      unchanged,
      ignored: 0,
      issues: Object.freeze([]),
      diagnostics: Object.freeze(diagnostics),
      effective: false,
      sameReferenceMutation: true,
    };
  }

  for (const candidate of candidates) {
    const { row, rowId, sourceOrder } = candidate;
    let metadata: RowRecord<TRow, TRowId, TColumns>["metadata"];
    try {
      metadata = input.queryPlan.evaluate({
        rowId,
        row: row as never,
        sourceOrder,
      }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
    } catch (error) {
      if (
        error instanceof PretableRowModelError &&
        error.operation !== "set-rows"
      ) {
        throw new PretableRowModelError(error.code, error.message, {
          operation: "set-rows",
          rowId: error.rowId,
          columnId: error.columnId,
          cause: error.cause,
        });
      }
      throw error;
    }
    const publicRow = Object.freeze({
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
      integrity: candidate.integrity,
    });
    changedRecords.push(record);
  }
  if (!effective) {
    return {
      rows: input.root.rows,
      sourceOrder: input.root.sourceOrder,
      visible: input.root.visible,
      nextSourceOrder: input.nextSourceOrder,
      added,
      updated,
      removed,
      unchanged,
      ignored: 0,
      issues: Object.freeze([]),
      diagnostics: Object.freeze(diagnostics),
      effective: false,
      sameReferenceMutation,
    };
  }

  const rowDraft = input.root.rows.asTransient();
  const sourceDraft = input.root.sourceOrder.asTransient();
  const affectedVisibleIds = new Set<TRowId>(
    changedRecords.map((record) => record.rowId),
  );
  for (const [rowId] of input.root.rows.entries()) {
    if (!seen.has(rowId)) affectedVisibleIds.add(rowId);
  }
  let hasUnaffectedVisible = false;
  for (const record of input.root.visible.rows.entries()) {
    if (!affectedVisibleIds.has(record.rowId)) {
      hasUnaffectedVisible = true;
      break;
    }
  }
  const visibleDraft = (
    hasUnaffectedVisible
      ? input.root.visible.rows
      : createFlatVisibleTree<TRow, TRowId, TColumns>(
          input.queryPlan.compareRows as unknown as (
            left: RowRecord<TRow, TRowId, TColumns>["metadata"],
            right: RowRecord<TRow, TRowId, TColumns>["metadata"],
          ) => number,
        )
  ).asTransient();
  for (const [rowId] of input.root.rows.entries()) {
    if (seen.has(rowId)) continue;
    rowDraft.delete(rowId);
    sourceDraft.remove(rowId);
    if (hasUnaffectedVisible) visibleDraft.remove(rowId);
  }
  if (hasUnaffectedVisible) {
    for (const record of changedRecords) {
      visibleDraft.remove(record.rowId);
    }
  }
  for (const record of changedRecords) {
    rowDraft.set(record.rowId, record);
    sourceDraft.insertOrReplace(
      Object.freeze({ rowId: record.rowId, sourceOrder: record.sourceOrder }),
    );
    if (record.metadata.filterPasses) visibleDraft.insertOrReplace(record);
  }
  return {
    rows: rowDraft.freeze(),
    sourceOrder: sourceDraft.freeze(),
    visible: Object.freeze({ rows: visibleDraft.freeze() }),
    nextSourceOrder: Math.max(input.nextSourceOrder, captured.length),
    added,
    updated,
    removed,
    unchanged,
    ignored: 0,
    issues: Object.freeze([]),
    diagnostics: Object.freeze(diagnostics),
    effective: true,
    sameReferenceMutation,
  };
}
