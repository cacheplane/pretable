import type { CompiledQuery } from "./compiled-query";
import type { PretableRowId } from "./column-types";
import {
  PretableRowIdentityChangeError,
  PretableRowModelError,
  PretableUnsupportedRowUpdateError,
} from "./errors";
import type { RevisionRoot, RowRecord } from "./internal-types";
import {
  attachGroupIndex,
  getGroupIndex,
  updateGroupIndex,
} from "./group-index";
import {
  inspectRowIntegrity,
  type PretableRowIntegrityDiagnostic,
} from "./row-integrity";
import type { PretableMutationIssue, PretableTransaction } from "./types";
import { createFlatVisibleTree, createVisibleIndex } from "./visible-index";

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

class TransactionValidationError extends PretableRowModelError {
  readonly name = "TransactionValidationError";

  constructor(
    readonly path: string,
    message: string,
    cause?: unknown,
  ) {
    super("derivation-failed", message, {
      operation: "apply-transaction",
      cause,
    });
  }
}

function remap(error: unknown): never {
  if (
    error instanceof PretableRowModelError &&
    error.code !== "reentrant-mutation" &&
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

function invalid(path: string, message: string, cause?: unknown): never {
  throw new TransactionValidationError(path, message, cause);
}

function readProperty(source: object, key: PropertyKey, path: string): unknown {
  try {
    return Reflect.get(source, key);
  } catch (cause) {
    return invalid(
      path,
      `The value at ${path} could not be read safely.`,
      cause,
    );
  }
}

function captureDenseList(value: unknown, path: string): readonly unknown[] {
  if (value === undefined) return Object.freeze([]);
  try {
    if (!Array.isArray(value))
      return invalid(path, `${path} must be an array.`);
    const length = value.length;
    const captured: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const entryPath = `${path}[${index}]`;
      if (!Object.hasOwn(value, index)) {
        return invalid(entryPath, `${path} must be a dense array.`);
      }
      captured.push(readProperty(value, index, entryPath));
    }
    return Object.freeze(captured);
  } catch (cause) {
    if (cause instanceof PretableRowModelError) throw cause;
    return invalid(path, `${path} could not be captured safely.`, cause);
  }
}

function validRowId(value: unknown): value is PretableRowId {
  return typeof value === "string" || typeof value === "number";
}

interface CapturedPatchProperty {
  readonly key: PropertyKey;
  readonly value: unknown;
}

type CapturedPatch = readonly CapturedPatchProperty[];

/** Patches use enumerable own data properties, including symbol keys. */
function capturePatch(value: unknown, path: string): CapturedPatch {
  if (value === null || typeof value !== "object") {
    return invalid(path, `${path} must be an object.`);
  }
  try {
    const captured: CapturedPatchProperty[] = [];
    for (const key of Reflect.ownKeys(value)) {
      const keyPath =
        typeof key === "symbol" ? `${path}[${String(key)}]` : `${path}.${key}`;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined)
        return invalid(keyPath, `The property at ${keyPath} disappeared.`);
      if (!descriptor.enumerable) continue;
      if (!("value" in descriptor)) {
        return invalid(
          keyPath,
          `The patch property at ${keyPath} must be a data property.`,
        );
      }
      captured.push(Object.freeze({ key, value: descriptor.value }));
    }
    return Object.freeze(captured);
  } catch (cause) {
    if (cause instanceof PretableRowModelError) throw cause;
    return invalid(path, `${path} could not be captured safely.`, cause);
  }
}

function mergeChanges<TRow extends object, TRowId extends PretableRowId>(
  previous: TRow,
  patches: readonly CapturedPatch[],
  rowId: TRowId,
): { readonly row: TRow; readonly changed: boolean } {
  try {
    const prototype = Object.getPrototypeOf(previous);
    if (
      Array.isArray(previous) ||
      (prototype !== Object.prototype && prototype !== null)
    ) {
      throw new PretableUnsupportedRowUpdateError(rowId);
    }
    const row = Object.create(prototype) as TRow;
    for (const key of Reflect.ownKeys(previous)) {
      const descriptor = Object.getOwnPropertyDescriptor(previous, key);
      if (descriptor === undefined)
        throw new TypeError("A row property disappeared.");
      Object.defineProperty(row, key, {
        ...descriptor,
        configurable: true,
        ...("value" in descriptor ? { writable: true } : {}),
      });
    }
    const originals = new Map<PropertyKey, PropertyDescriptor | undefined>();
    for (const patch of patches) {
      for (const property of patch) {
        if (!originals.has(property.key)) {
          originals.set(
            property.key,
            Object.getOwnPropertyDescriptor(previous, property.key),
          );
        }
        Object.defineProperty(row, property.key, {
          value: property.value,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    const changed = Array.from(originals, ([key, descriptor]) => {
      const final = Object.getOwnPropertyDescriptor(row, key)!;
      return (
        descriptor === undefined ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true ||
        !Object.is(descriptor.value, final.value)
      );
    }).some(Boolean);
    return { row: changed ? Object.freeze(row) : previous, changed };
  } catch (cause) {
    if (cause instanceof PretableUnsupportedRowUpdateError) throw cause;
    throw new PretableUnsupportedRowUpdateError(rowId, cause);
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

function sameKeyValues(
  left: readonly { readonly columnId: string; readonly value: unknown }[],
  right: readonly { readonly columnId: string; readonly value: unknown }[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.columnId === right[index]?.columnId &&
        Object.is(entry.value, right[index]?.value),
    )
  );
}

function sameFlatOrder<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  previous: RowRecord<TRow, TRowId, TColumns>,
  next: RowRecord<TRow, TRowId, TColumns>,
): boolean {
  return (
    previous.sourceOrder === next.sourceOrder &&
    previous.metadata.filterPasses === next.metadata.filterPasses &&
    sameKeyValues(previous.metadata.sortKeys, next.metadata.sortKeys)
  );
}

function rebaseSourceOrder<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  metadata: RowRecord<TRow, TRowId, TColumns>["metadata"],
  sourceOrder: number,
): RowRecord<TRow, TRowId, TColumns>["metadata"] {
  const aggregateLeaves = metadata.aggregateLeaves.map((leaf) => {
    const dependency = Object.freeze({
      ...leaf.allLeaf.dependency,
      sourceOrder,
    });
    const allLeaf = Object.freeze({ ...leaf.allLeaf, dependency });
    return Object.freeze({
      ...leaf,
      allLeaf,
      filteredLeaf: leaf.filteredLeaf === undefined ? undefined : allLeaf,
    });
  });
  return Object.freeze({
    ...metadata,
    sourceOrder,
    aggregateLeaves: Object.freeze(aggregateLeaves),
  }) as RowRecord<TRow, TRowId, TColumns>["metadata"];
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
    const transaction = input.transaction as unknown;
    if (transaction === null || typeof transaction !== "object") {
      return invalid("transaction", "The transaction must be an object.");
    }
    const rawAdds = readProperty(transaction, "add", "transaction.add");
    const rawUpdates = readProperty(
      transaction,
      "update",
      "transaction.update",
    );
    const rawRemoves = readProperty(
      transaction,
      "remove",
      "transaction.remove",
    );
    const adds = captureDenseList(
      rawAdds,
      "transaction.add",
    ) as readonly TRow[];
    const updateEntries = captureDenseList(rawUpdates, "transaction.update");
    const removes = captureDenseList(rawRemoves, "transaction.remove");

    const capturedUpdates: {
      readonly rowId: TRowId;
      readonly patch: CapturedPatch;
    }[] = [];
    for (let index = 0; index < updateEntries.length; index += 1) {
      const entry = updateEntries[index];
      const path = `transaction.update[${index}]`;
      if (entry === null || typeof entry !== "object") {
        return invalid(path, `${path} must be an object.`);
      }
      const rawId = readProperty(entry, "id", `${path}.id`);
      if (!validRowId(rawId)) {
        return invalid(`${path}.id`, `${path}.id must be a string or number.`);
      }
      const changes = readProperty(entry, "changes", `${path}.changes`);
      capturedUpdates.push({
        rowId: rawId as TRowId,
        patch: capturePatch(changes, `${path}.changes`),
      });
    }
    const capturedRemoves: TRowId[] = [];
    for (let index = 0; index < removes.length; index += 1) {
      const rowId = removes[index];
      const path = `transaction.remove[${index}]`;
      if (!validRowId(rowId)) {
        return invalid(path, `${path} must be a string or number.`);
      }
      capturedRemoves.push(rowId as TRowId);
    }

    const addById = new Map<TRowId, TRow>();
    for (let index = 0; index < adds.length; index += 1) {
      const row = adds[index]!;
      let rowId: TRowId;
      try {
        rowId = input.getRowId(row);
      } catch (cause) {
        return invalid(
          `transaction.add[${index}]`,
          "The row ID accessor failed.",
          cause,
        );
      }
      if (!validRowId(rowId)) {
        return invalid(
          `transaction.add[${index}]`,
          "The row ID accessor must return a string or number.",
        );
      }
      if (addById.has(rowId))
        fail(
          "duplicate-row-id",
          `Duplicate added row ID ${String(rowId)}.`,
          rowId,
        );
      addById.set(rowId, row);
    }
    const updateById = new Map<TRowId, CapturedPatch[]>();
    for (const update of capturedUpdates) {
      const list = updateById.get(update.rowId);
      if (list === undefined) updateById.set(update.rowId, [update.patch]);
      else list.push(update.patch);
    }
    const removeIds = new Set<TRowId>();
    for (const rowId of capturedRemoves) removeIds.add(rowId);
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
      readonly kind: "add" | "update";
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
      if (previous.integrity.kind === "fingerprinted") {
        throw new PretableUnsupportedRowUpdateError(rowId);
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
        kind: "update",
      });
    }
    for (const [rowId, row] of addById) {
      pending.push({
        rowId,
        row,
        sourceOrder: nextSourceOrder,
        kind: "add",
      });
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

    for (const candidate of pending) {
      if (candidate.kind !== "update") continue;
      let nextRowId: unknown;
      try {
        nextRowId = input.getRowId(candidate.row);
      } catch (cause) {
        throw new PretableRowIdentityChangeError(
          candidate.rowId,
          undefined,
          cause,
        );
      }
      if (
        !validRowId(nextRowId) ||
        !(
          nextRowId === candidate.rowId ||
          (nextRowId !== nextRowId && candidate.rowId !== candidate.rowId)
        )
      ) {
        throw new PretableRowIdentityChangeError(candidate.rowId, nextRowId);
      }
    }

    // All lists, IDs, partial values, and resulting identities are validated
    // before active derivation callbacks are allowed to run.
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
    const previousGroups = getGroupIndex(input.root.visible);
    const visibleNeedsChange =
      previousGroups === undefined &&
      (effectiveRemoves.some(
        (rowId) => input.root.rows.get(rowId)?.metadata.filterPasses === true,
      ) ||
        prepared.some((record) => {
          const previous = input.root.rows.get(record.rowId);
          return (
            (previous?.metadata.filterPasses === true ||
              record.metadata.filterPasses) &&
            (previous === undefined || !sameFlatOrder(previous, record))
          );
        }));
    const visibleDraft = visibleNeedsChange
      ? input.root.visible.rows.asTransient()
      : undefined;
    for (const rowId of effectiveRemoves) {
      rowDraft.delete(rowId);
      sourceDraft.remove(rowId);
      visibleDraft?.remove(rowId);
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
      if (previous !== undefined && sameFlatOrder(previous, record)) continue;
      if (previous?.metadata.filterPasses) visibleDraft?.remove(record.rowId);
      if (record.metadata.filterPasses) visibleDraft?.insertOrReplace(record);
    }
    const frozenRows = rowDraft.freeze();
    const frozenFlatRows = visibleDraft?.freeze();
    const grouped =
      previousGroups === undefined
        ? undefined
        : updateGroupIndex(
            previousGroups,
            [
              ...effectiveRemoves.map((rowId) => input.root.rows.get(rowId)!),
              ...prepared.flatMap((record) => {
                const old = input.root.rows.get(record.rowId);
                return old === undefined ? [] : [old];
              }),
            ],
            prepared,
            input.root.expansion.overrides,
          );
    return {
      rows: frozenRows,
      sourceOrder: sourceDraft.freeze(),
      visible:
        grouped !== undefined
          ? attachGroupIndex(frozenFlatRows ?? input.root.visible.rows, grouped)
          : visibleDraft === undefined
            ? input.root.visible
            : Object.freeze({ rows: frozenFlatRows! }),
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
    readonly cachedMetadata?: RowRecord<TRow, TRowId, TColumns>["metadata"];
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
      cachedMetadata:
        sameReference && !inspection.sameReferenceMutation
          ? previous?.metadata
          : undefined,
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
      metadata =
        candidate.cachedMetadata === undefined
          ? (input.queryPlan.evaluate({
              rowId,
              row: row as never,
              sourceOrder,
            }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"])
          : rebaseSourceOrder(candidate.cachedMetadata, sourceOrder);
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
  const orderChangedRecords = changedRecords.filter((record) => {
    const previous = input.root.rows.get(record.rowId);
    return previous === undefined || !sameFlatOrder(previous, record);
  });
  const affectedVisibleIds = new Set<TRowId>(
    orderChangedRecords
      .filter((record) => {
        const previous = input.root.rows.get(record.rowId);
        return (
          previous?.metadata.filterPasses === true ||
          record.metadata.filterPasses
        );
      })
      .map((record) => record.rowId),
  );
  for (const [rowId] of input.root.rows.entries()) {
    if (
      !seen.has(rowId) &&
      input.root.rows.get(rowId)?.metadata.filterPasses === true
    )
      affectedVisibleIds.add(rowId);
  }
  let hasUnaffectedVisible = false;
  for (const record of input.root.visible.rows.entries()) {
    if (!affectedVisibleIds.has(record.rowId)) {
      hasUnaffectedVisible = true;
      break;
    }
  }
  const visibleDraft =
    affectedVisibleIds.size === 0
      ? undefined
      : (hasUnaffectedVisible
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
    if (hasUnaffectedVisible) visibleDraft?.remove(rowId);
  }
  if (hasUnaffectedVisible) {
    for (const record of orderChangedRecords) {
      if (input.root.rows.get(record.rowId)?.metadata.filterPasses) {
        visibleDraft?.remove(record.rowId);
      }
    }
  }
  for (const record of changedRecords) {
    rowDraft.set(record.rowId, record);
    const previous = input.root.rows.get(record.rowId);
    if (previous === undefined || previous.sourceOrder !== record.sourceOrder) {
      sourceDraft.insertOrReplace(
        Object.freeze({ rowId: record.rowId, sourceOrder: record.sourceOrder }),
      );
    }
  }
  for (const record of orderChangedRecords) {
    if (record.metadata.filterPasses) visibleDraft?.insertOrReplace(record);
  }
  const frozenRows = rowDraft.freeze();
  const frozenSource = sourceDraft.freeze();
  const previousGroups = getGroupIndex(input.root.visible);
  const visible =
    previousGroups === undefined
      ? visibleDraft === undefined
        ? input.root.visible
        : Object.freeze({ rows: visibleDraft.freeze() })
      : createVisibleIndex(
          Array.from(frozenRows.entries(), ([, record]) => record),
          input.queryPlan,
          previousGroups.aggregateFilteredRows,
          input.root.expansion.overrides,
          "set-rows",
          previousGroups,
        );
  return {
    rows: frozenRows,
    sourceOrder: frozenSource,
    visible,
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
