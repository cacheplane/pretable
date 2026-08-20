import {
  filterVerdict,
  sortKeysOf,
  type CompiledQuery,
} from "./compiled-query";
import {
  attachChangeOperationDiagnosticsForTesting,
  getChangeOperationDiagnosticsForTesting,
} from "./change-journal";
import type { PretableRowId } from "./column-types";
import type { LocalRowModelInstrumentation } from "./diagnostics";
import { rowPassesFilter } from "./filter-membership";
import {
  PretableRowIdentityChangeError,
  PretableRowModelError,
  PretableUnsupportedRowUpdateError,
} from "./errors";
import type { RevisionRoot, RowRecord } from "./internal-types";
import { instrumentOrderStatisticTree } from "./persistent/order-statistic-tree";
import { instrumentPersistentMap } from "./persistent/persistent-map";
import {
  attachGroupIndex,
  getGroupIndex,
  makeGroupId,
  updateGroupIndex,
  visibleIndexOf,
  visibleRange,
} from "./group-index";
import {
  inspectRowIntegrity,
  type PretableRowIntegrityDiagnostic,
} from "./row-integrity";
import type {
  PretableChangeOperation,
  PretableMutationIssue,
  PretableTransaction,
  PretableVisibleRowRef,
} from "./types";
import type { PretableGroupId } from "./types";
import { orderedRowEntry } from "./ordered-row-entry";
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
  readonly instrumentation?: LocalRowModelInstrumentation;
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
  readonly operations: readonly PretableChangeOperation<TRowId>[];
  /** Canonical rows the cooperative transition candidate must replay. */
  readonly affectedRowIds: readonly TRowId[];
  readonly effective: boolean;
}

export interface RowsReplacementDraftResult<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> extends TransactionDraftResult<TRow, TRowId, TColumns> {
  readonly sameReferenceMutation: boolean;
}

export const getTransactionChangeDiagnosticsForTesting =
  getChangeOperationDiagnosticsForTesting;

class TransactionExecutionError extends PretableRowModelError {
  readonly rowIds: readonly PretableRowId[] | undefined;
  readonly groupValues: readonly unknown[] | undefined;
  readonly groupId: PretableGroupId | undefined;

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
      readonly groupId?: PretableGroupId;
    };
    this.rowIds = detailed.rowIds;
    this.groupValues = detailed.groupValues;
    this.groupId = detailed.groupId;
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
  instrumentation: LocalRowModelInstrumentation | undefined,
): {
  readonly record: RowRecord<TRow, TRowId, TColumns>;
  readonly diagnostic?: PretableRowIntegrityDiagnostic<TRowId>;
} {
  if (instrumentation !== undefined) instrumentation.work.rowsEvaluated += 1;
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
  previousPlan: CompiledQuery<TColumns>,
  nextPlan: CompiledQuery<TColumns>,
  previous: RowRecord<TRow, TRowId, TColumns>,
  next: RowRecord<TRow, TRowId, TColumns>,
  /** The committed root's membership verdict for this row (the OLD one). */
  previousPasses: boolean,
  /** The drafting plan's verdict for `next`, computed by the caller. */
  nextPasses: boolean,
): boolean {
  // Each record's keys resolve from the plan that evaluated it: `previous`
  // from the committed root's plan, `next` from the drafting plan. Outside
  // the same-reference-mutation recompile these are one and the same object.
  // The two VERDICTS likewise come from two different places, and must: the
  // old one is structural (root membership), the new one is computed. A
  // row-keyed verdict store could not tell them apart when the plan object is
  // shared, which is exactly the same-reference-mutation case.
  return (
    previous.sourceOrder === next.sourceOrder &&
    previousPasses === nextPasses &&
    sameKeyValues(
      sortKeysOf(previousPlan, previous as never),
      sortKeysOf(nextPlan, next as never),
    )
  );
}

function sameGroupIndexContribution<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(
  previousPlan: CompiledQuery<TColumns>,
  nextPlan: CompiledQuery<TColumns>,
  previous: RowRecord<TRow, TRowId, TColumns>,
  next: RowRecord<TRow, TRowId, TColumns>,
  previousPasses: boolean,
  nextPasses: boolean,
): boolean {
  if (
    !sameFlatOrder(
      previousPlan,
      nextPlan,
      previous,
      next,
      previousPasses,
      nextPasses,
    ) ||
    !sameKeyValues(previous.metadata.groupPath, next.metadata.groupPath)
  ) {
    return false;
  }
  const previousLeaves = previous.metadata.aggregateLeaves as readonly {
    readonly columnId: string;
    readonly aggregate: unknown;
    readonly allLeaf: {
      readonly row: object;
      readonly value: unknown;
      readonly dependency: {
        readonly sourceOrder: number;
      };
    };
  }[];
  const nextLeaves = next.metadata.aggregateLeaves as typeof previousLeaves;
  return (
    previousLeaves.length === nextLeaves.length &&
    previousLeaves.every((previousLeaf, index) => {
      const nextLeaf = nextLeaves[index];
      if (
        nextLeaf === undefined ||
        previousLeaf.columnId !== nextLeaf.columnId ||
        previousLeaf.aggregate !== nextLeaf.aggregate
        // A per-leaf filtered flag is deliberately NOT compared: whether a
        // leaf belongs to the filtered aggregate tree is the row's filter
        // verdict, and `sameFlatOrder` above already compared the old verdict
        // against the new one for this very row. Comparing it again here only
        // restated that check.
      ) {
        return false;
      }
      if (typeof previousLeaf.aggregate !== "string") {
        return (
          Object.is(previousLeaf.allLeaf.row, nextLeaf.allLeaf.row) &&
          Object.is(previousLeaf.allLeaf.value, nextLeaf.allLeaf.value) &&
          Object.is(
            previousLeaf.allLeaf.dependency,
            nextLeaf.allLeaf.dependency,
          )
        );
      }
      // The dependency's sortKeys are deliberately NOT compared here:
      // sort-key changes no longer dirty aggregate leaves BY DESIGN
      // (aggregation is order-independent; `sameFlatOrder` above already
      // compared keys through the store).
      return (
        (previousLeaf.aggregate === "count" ||
          Object.is(previousLeaf.allLeaf.value, nextLeaf.allLeaf.value)) &&
        previousLeaf.allLeaf.dependency.sourceOrder ===
          nextLeaf.allLeaf.dependency.sourceOrder
      );
    })
  );
}

function dataRef<TRowId extends PretableRowId>(rowId: TRowId) {
  return Object.freeze({ kind: "data" as const, rowId });
}

function groupPathIds<TColumns>(
  metadata: RowRecord<object, PretableRowId, TColumns>["metadata"],
): readonly PretableGroupId[] {
  return Object.freeze(
    metadata.groupPath.map((_, index) =>
      makeGroupId(metadata.groupPath.slice(0, index + 1)),
    ),
  );
}

function sameVisibleRef<TRowId extends PretableRowId>(
  left: PretableVisibleRowRef<TRowId>,
  right: PretableVisibleRowRef<TRowId>,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "group") {
    return right.kind === "group" && left.groupId === right.groupId;
  }
  return (
    right.kind === "data" &&
    (left.rowId === right.rowId ||
      (left.rowId !== left.rowId && right.rowId !== right.rowId))
  );
}

type StructuralChangeOperation<TRowId extends PretableRowId> = Extract<
  PretableChangeOperation<TRowId>,
  { readonly kind: "insert" | "remove" | "move" }
>;

function rankAfterStructuralOperations<TRowId extends PretableRowId>(
  ref: PretableVisibleRowRef<TRowId>,
  previousIndex: number,
  operations: readonly StructuralChangeOperation<TRowId>[],
): number {
  let current = previousIndex;
  let present = previousIndex >= 0;
  for (const operation of operations) {
    if (operation.kind === "remove") {
      if (sameVisibleRef(ref, operation.ref)) {
        present = false;
        current = -1;
      } else if (present && operation.previousIndex < current) current -= 1;
      continue;
    }
    if (operation.kind === "insert") {
      if (sameVisibleRef(ref, operation.ref)) {
        present = true;
        current = operation.index;
      } else if (present && operation.index <= current) current += 1;
      continue;
    }
    if (sameVisibleRef(ref, operation.ref)) {
      present = true;
      current = operation.index;
      continue;
    }
    if (present) {
      if (operation.previousIndex < current) current -= 1;
      if (operation.index <= current) current += 1;
    }
  }
  return present ? current : -1;
}

function groupedTransactionOperations<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
>(input: {
  readonly previous: RevisionRoot<TRow, TRowId, TColumns>;
  readonly nextVisible: RevisionRoot<TRow, TRowId, TColumns>["visible"];
  readonly removals: readonly RowRecord<TRow, TRowId, TColumns>[];
  readonly insertions: readonly RowRecord<TRow, TRowId, TColumns>[];
}): readonly PretableChangeOperation<TRowId>[] {
  const oldGroups = getGroupIndex(input.previous.visible);
  const nextGroups = getGroupIndex(input.nextVisible);
  if (oldGroups === undefined || nextGroups === undefined)
    return Object.freeze([]);
  const policy = input.previous.expansion.default;
  const affectedGroupIds = new Set<PretableGroupId>();
  for (const record of [...input.removals, ...input.insertions]) {
    for (const groupId of groupPathIds(record.metadata as never)) {
      affectedGroupIds.add(groupId);
    }
  }

  type RankedRef = {
    readonly ref: PretableVisibleRowRef<TRowId>;
    readonly previousIndex: number;
    readonly index: number;
  };
  const candidates: RankedRef[] = [];
  const rowCandidates: RankedRef[] = [];
  const updates: PretableChangeOperation<TRowId>[] = [];
  let visibleRowReads = 0;

  for (const groupId of affectedGroupIds) {
    const ref = Object.freeze({ kind: "group" as const, groupId });
    const previousIndex = visibleIndexOf(oldGroups, policy, ref);
    const index = visibleIndexOf(nextGroups, policy, ref);
    const candidate = { ref, previousIndex, index };
    candidates.push(candidate);
    if (previousIndex >= 0 && index >= 0) {
      const previousRow = visibleRange(
        oldGroups,
        policy,
        previousIndex,
        previousIndex + 1,
      )[0];
      const nextRow = visibleRange(nextGroups, policy, index, index + 1)[0];
      visibleRowReads += 2;
      if (previousRow?.kind === "group" && nextRow?.kind === "group") {
        const fields = [
          !Object.is(previousRow.aggregates, nextRow.aggregates)
            ? ("aggregates" as const)
            : undefined,
          previousRow.childCount !== nextRow.childCount
            ? ("childCount" as const)
            : undefined,
          previousRow.expanded !== nextRow.expanded
            ? ("expanded" as const)
            : undefined,
          previousRow.depth !== nextRow.depth ? ("depth" as const) : undefined,
        ].filter(
          (field): field is NonNullable<typeof field> => field !== undefined,
        );
        if (fields.length > 0) {
          updates.push(
            Object.freeze({
              kind: "update" as const,
              ref,
              index,
              fields: Object.freeze(fields),
            }),
          );
        }
      }
    }
  }

  const insertedById = new Map(
    input.insertions.map((record) => [record.rowId, record]),
  );
  const removedById = new Map(
    input.removals.map((record) => [record.rowId, record]),
  );
  for (const rowId of new Set([
    ...removedById.keys(),
    ...insertedById.keys(),
  ])) {
    const previousRecord = removedById.get(rowId);
    const nextRecord = insertedById.get(rowId);
    const ref = dataRef(rowId);
    const previousIndex = visibleIndexOf(oldGroups, policy, ref);
    const index = visibleIndexOf(nextGroups, policy, ref);
    const candidate = { ref, previousIndex, index };
    candidates.push(candidate);
    rowCandidates.push(candidate);
    if (
      previousIndex >= 0 &&
      index >= 0 &&
      previousRecord !== undefined &&
      nextRecord !== undefined &&
      !Object.is(previousRecord.row, nextRecord.row)
    ) {
      updates.push(
        Object.freeze({
          kind: "update" as const,
          ref,
          index,
          fields: Object.freeze(["row" as const]),
        }),
      );
    }
  }

  const structural: StructuralChangeOperation<TRowId>[] = [];
  const absent = candidates
    .filter(({ previousIndex, index }) => previousIndex >= 0 && index < 0)
    .sort((left, right) => right.previousIndex - left.previousIndex);
  for (const { ref, previousIndex } of absent) {
    structural.push(
      Object.freeze({ kind: "remove" as const, ref, previousIndex }),
    );
  }
  const inserted = candidates
    .filter(({ previousIndex, index }) => previousIndex < 0 && index >= 0)
    .sort((left, right) => left.index - right.index);
  const targets = rowCandidates
    .filter(({ previousIndex, index }) => previousIndex >= 0 && index >= 0)
    .map((candidate) => ({
      ...candidate,
      workingIndex:
        candidate.index -
        inserted.filter(({ index }) => index <= candidate.index).length,
    }))
    .sort((left, right) => left.workingIndex - right.workingIndex);
  const moveToIndex = (
    { ref, previousIndex }: RankedRef,
    index: number,
  ): number => {
    const currentIndex = rankAfterStructuralOperations(
      ref,
      previousIndex,
      structural,
    );
    if (currentIndex !== index) {
      structural.push(
        Object.freeze({
          kind: "move" as const,
          ref,
          previousIndex: currentIndex,
          index,
        }),
      );
    }
    return currentIndex;
  };
  // First place surviving changed rows in the view with future insertions
  // removed from its coordinate space. This preserves untouched rows and
  // groups without enumerating them.
  for (const { ref, previousIndex, workingIndex } of targets) {
    const currentIndex = rankAfterStructuralOperations(
      ref,
      previousIndex,
      structural,
    );
    if (currentIndex > workingIndex) {
      moveToIndex({ ref, previousIndex, index: workingIndex }, workingIndex);
    }
  }
  for (const target of [...targets].reverse()) {
    const currentIndex = rankAfterStructuralOperations(
      target.ref,
      target.previousIndex,
      structural,
    );
    if (currentIndex < target.workingIndex) {
      moveToIndex(target, target.workingIndex);
    }
  }
  for (const target of [...targets].reverse()) {
    moveToIndex(target, target.workingIndex);
  }
  for (const { ref, index } of inserted) {
    structural.push(Object.freeze({ kind: "insert" as const, ref, index }));
  }
  const finalRowTargets = rowCandidates
    .filter(({ index }) => index >= 0)
    .sort((left, right) => right.index - left.index);
  for (const target of finalRowTargets) {
    moveToIndex(target, target.index);
  }
  return attachChangeOperationDiagnosticsForTesting(
    Object.freeze([
      ...structural,
      ...updates.sort((left, right) => {
        const leftIndex = left.kind === "update" ? left.index : 0;
        const rightIndex = right.kind === "update" ? right.index : 0;
        return leftIndex - rightIndex;
      }),
    ]),
    {
      touchedRefs: candidates.length,
      visibleRowReads,
    },
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
    // A rebase changes only the source order; the entry-carried sort keys
    // ride along unchanged.
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
    // Each prepared record's NEW verdict is computed once, here, and keyed by
    // the record OBJECT (the same row id can appear twice in one transaction,
    // and each occurrence carries its own record). It is never stored on the
    // record: the structures this draft builds are where it lands.
    const nextVerdicts = new Map<
      RowRecord<TRow, TRowId, TColumns>,
      boolean
    >();
    const passesNext = (record: RowRecord<TRow, TRowId, TColumns>): boolean =>
      nextVerdicts.get(record)!;
    /** The committed root's membership — the OLD verdict for one row. */
    const passedPreviously = (rowId: TRowId): boolean =>
      rowPassesFilter(input.root, rowId);
    for (const candidate of pending) {
      const made = createRecord(
        candidate.row,
        candidate.rowId,
        candidate.sourceOrder,
        input.queryPlan,
        input.instrumentation,
      );
      prepared.push(made.record);
      nextVerdicts.set(
        made.record,
        filterVerdict(input.queryPlan, made.record as never),
      );
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
        operations: Object.freeze([]),
        affectedRowIds: Object.freeze([]),
        effective: false,
      };
    }

    const rowDraft = instrumentPersistentMap(
      input.root.rows,
      input.instrumentation,
    ).asTransient();
    const sourceDraft = instrumentOrderStatisticTree(
      input.root.sourceOrder,
      input.instrumentation,
    ).asTransient();
    const previousGroups = getGroupIndex(input.root.visible);
    const visibleNeedsChange =
      previousGroups === undefined &&
      (effectiveRemoves.some((rowId) => passedPreviously(rowId)) ||
        prepared.some((record) => {
          const previous = input.root.rows.get(record.rowId);
          return (
            (passedPreviously(record.rowId) || passesNext(record)) &&
            (previous === undefined ||
              !sameFlatOrder(
                input.root.queryPlan,
                input.queryPlan,
                previous,
                record,
                passedPreviously(record.rowId),
                passesNext(record),
              ))
          );
        }));
    const visibleDraft = visibleNeedsChange
      ? instrumentOrderStatisticTree(
          input.root.visible.rows,
          input.instrumentation,
        ).asTransient()
      : undefined;
    const operations: PretableChangeOperation<TRowId>[] = [];
    const ref = (rowId: TRowId) =>
      Object.freeze({ kind: "data" as const, rowId });
    for (const rowId of effectiveRemoves) {
      if (previousGroups === undefined) {
        const previousIndex = visibleDraft?.rankOf(rowId);
        if (previousIndex !== undefined) {
          operations.push(
            Object.freeze({
              kind: "remove" as const,
              ref: ref(rowId),
              previousIndex,
            }),
          );
        }
      }
      rowDraft.delete(rowId);
      sourceDraft.remove(rowId);
      visibleDraft?.remove(rowId);
    }
    for (const record of prepared) {
      const previous = input.root.rows.get(record.rowId);
      // Both verdicts, resolved from their own authorities: the old one from
      // the committed root's membership (immutable while this loop mutates
      // the drafts), the new one computed when the record was prepared.
      const previouslyPassed = passedPreviously(record.rowId);
      const passes = passesNext(record);
      rowDraft.set(record.rowId, record);
      if (previous === undefined)
        sourceDraft.insertOrReplace(
          Object.freeze({
            rowId: record.rowId,
            sourceOrder: record.sourceOrder,
          }),
        );
      if (previousGroups === undefined) {
        if (
          previous !== undefined &&
          sameFlatOrder(
            input.root.queryPlan,
            input.queryPlan,
            previous,
            record,
            previouslyPassed,
            passes,
          )
        ) {
          if (passes) {
            const index =
              visibleDraft?.rankOf(record.rowId) ??
              input.root.visible.rows.rankOf(record.rowId);
            if (index !== undefined) {
              operations.push(
                Object.freeze({
                  kind: "update" as const,
                  ref: ref(record.rowId),
                  index,
                  fields: Object.freeze(["row" as const]),
                }),
              );
            }
          }
          continue;
        }
        const previousIndex = previouslyPassed
          ? visibleDraft?.rankOf(record.rowId)
          : undefined;
        if (previouslyPassed) visibleDraft?.remove(record.rowId);
        if (passes) {
          visibleDraft?.insertOrReplace(
            orderedRowEntry(input.queryPlan, record),
          );
        }
        const index = passes ? visibleDraft?.rankOf(record.rowId) : undefined;
        if (previousIndex !== undefined && index !== undefined) {
          operations.push(
            Object.freeze({
              kind: "move" as const,
              ref: ref(record.rowId),
              previousIndex,
              index,
            }),
            Object.freeze({
              kind: "update" as const,
              ref: ref(record.rowId),
              index,
              fields: Object.freeze(["row" as const]),
            }),
          );
        } else if (previousIndex !== undefined) {
          operations.push(
            Object.freeze({
              kind: "remove" as const,
              ref: ref(record.rowId),
              previousIndex,
            }),
          );
        } else if (index !== undefined) {
          operations.push(
            Object.freeze({
              kind: "insert" as const,
              ref: ref(record.rowId),
              index,
            }),
          );
        }
        continue;
      }
      if (
        previous !== undefined &&
        sameFlatOrder(
          input.root.queryPlan,
          input.queryPlan,
          previous,
          record,
          previouslyPassed,
          passes,
        )
      )
        continue;
    }
    const frozenRows = rowDraft.freeze();
    const frozenFlatRows = visibleDraft?.freeze();
    const groupedRemovals = [
      ...effectiveRemoves.map((rowId) => input.root.rows.get(rowId)!),
      ...prepared.flatMap((record) => {
        const previous = input.root.rows.get(record.rowId);
        return previous === undefined ||
          sameGroupIndexContribution(
            input.root.queryPlan,
            input.queryPlan,
            previous,
            record,
            passedPreviously(record.rowId),
            passesNext(record),
          )
          ? []
          : [previous];
      }),
    ];
    const groupedInsertions = prepared.filter((record) => {
      const previous = input.root.rows.get(record.rowId);
      return (
        previous === undefined ||
        !sameGroupIndexContribution(
          input.root.queryPlan,
          input.queryPlan,
          previous,
          record,
          passedPreviously(record.rowId),
          passesNext(record),
        )
      );
    });
    const grouped =
      previousGroups === undefined
        ? undefined
        : groupedRemovals.length === 0 && groupedInsertions.length === 0
          ? previousGroups
          : updateGroupIndex(
              previousGroups,
              groupedRemovals,
              groupedInsertions,
              input.root.expansion.overrides,
              "apply-transaction",
              input.instrumentation,
            );
    const visible =
      grouped !== undefined
        ? attachGroupIndex(frozenFlatRows ?? input.root.visible.rows, grouped)
        : visibleDraft === undefined
          ? input.root.visible
          : Object.freeze({ rows: frozenFlatRows! });
    const groupedOperations =
      grouped === undefined
        ? undefined
        : groupedTransactionOperations({
            previous: input.root,
            nextVisible: visible,
            removals: [
              ...effectiveRemoves.map((rowId) => input.root.rows.get(rowId)!),
              ...prepared.flatMap((record) => {
                const old = input.root.rows.get(record.rowId);
                return old === undefined ? [] : [old];
              }),
            ],
            insertions: prepared,
          });
    return {
      rows: frozenRows,
      sourceOrder: sourceDraft.freeze(),
      visible,
      nextSourceOrder,
      added: addById.size,
      updated: prepared.length - addById.size,
      removed: effectiveRemoves.length,
      unchanged,
      ignored,
      issues: Object.freeze(issues),
      diagnostics: Object.freeze(diagnostics),
      operations: groupedOperations ?? Object.freeze(operations),
      affectedRowIds: Object.freeze([
        ...effectiveRemoves,
        ...prepared.map((record) => record.rowId),
      ]),
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
  readonly instrumentation?: LocalRowModelInstrumentation;
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
  // The NEW verdict per changed record, computed once beside the record and
  // spent on the drafts below. The OLD verdict never appears here: it is read
  // from `input.root`'s membership, which matters most in the
  // same-reference-mutation retry, where the row OBJECT is unchanged and the
  // two plans are distinct compilations of the same query — nothing keyed by
  // the row could separate the two answers, but the two ROOTS are separate
  // objects.
  const nextVerdicts = new Map<RowRecord<TRow, TRowId, TColumns>, boolean>();
  const passesNext = (record: RowRecord<TRow, TRowId, TColumns>): boolean =>
    nextVerdicts.get(record)!;
  const passedPreviously = (rowId: TRowId): boolean =>
    rowPassesFilter(input.root, rowId);
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
  const removedRecords: RowRecord<TRow, TRowId, TColumns>[] = [];
  for (const [rowId, record] of input.root.rows.entries()) {
    if (!seen.has(rowId)) removedRecords.push(record);
  }
  const removed = removedRecords.length;
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
      operations: Object.freeze([]),
      affectedRowIds: Object.freeze([]),
      effective: false,
      sameReferenceMutation: true,
    };
  }

  for (const candidate of candidates) {
    const { row, rowId, sourceOrder } = candidate;
    let metadata: RowRecord<TRow, TRowId, TColumns>["metadata"];
    try {
      if (candidate.cachedMetadata === undefined) {
        if (input.instrumentation !== undefined)
          input.instrumentation.work.rowsEvaluated += 1;
        metadata = input.queryPlan.evaluate({
          rowId,
          row: row as never,
          sourceOrder,
        }) as unknown as RowRecord<TRow, TRowId, TColumns>["metadata"];
      } else {
        metadata = rebaseSourceOrder(candidate.cachedMetadata, sourceOrder);
      }
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
    // A record whose metadata was CARRIED carries its verdict too, and the
    // carried verdict is the previous root's membership: `cachedMetadata` is
    // only offered for an unmutated same-reference row, whose filter-column
    // values are by definition the ones the committed root already judged.
    // Re-running the predicate here would be a second accessor pass over
    // rows this path exists to avoid re-evaluating (a pinned budget).
    nextVerdicts.set(
      record,
      candidate.cachedMetadata === undefined
        ? filterVerdict(input.queryPlan, record as never)
        : passedPreviously(rowId),
    );
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
      operations: Object.freeze([]),
      affectedRowIds: Object.freeze([]),
      effective: false,
      sameReferenceMutation,
    };
  }

  const rowDraft = instrumentPersistentMap(
    input.root.rows,
    input.instrumentation,
  ).asTransient();
  const sourceDraft = instrumentOrderStatisticTree(
    input.root.sourceOrder,
    input.instrumentation,
  ).asTransient();
  const orderChangedRecords = changedRecords.filter((record) => {
    const previous = input.root.rows.get(record.rowId);
    return (
      previous === undefined ||
      !sameFlatOrder(
        input.root.queryPlan,
        input.queryPlan,
        previous,
        record,
        passedPreviously(record.rowId),
        passesNext(record),
      )
    );
  });
  const affectedVisibleIds = new Set<TRowId>(
    orderChangedRecords
      .filter(
        (record) => passedPreviously(record.rowId) || passesNext(record),
      )
      .map((record) => record.rowId),
  );
  for (const record of removedRecords) {
    // A removed row's verdict is the one it was drawn under: membership.
    if (passedPreviously(record.rowId)) affectedVisibleIds.add(record.rowId);
  }
  let hasUnaffectedVisible = false;
  for (const entry of input.root.visible.rows.entries()) {
    if (!affectedVisibleIds.has(entry.record.rowId)) {
      hasUnaffectedVisible = true;
      break;
    }
  }
  const visibleDraft =
    affectedVisibleIds.size === 0
      ? undefined
      : instrumentOrderStatisticTree(
          hasUnaffectedVisible
            ? input.root.visible.rows
            : createFlatVisibleTree<TRow, TRowId, TColumns>(input.queryPlan),
          input.instrumentation,
        ).asTransient();
  for (const record of removedRecords) {
    rowDraft.delete(record.rowId);
    sourceDraft.remove(record.rowId);
    if (hasUnaffectedVisible) visibleDraft?.remove(record.rowId);
  }
  if (hasUnaffectedVisible) {
    for (const record of orderChangedRecords) {
      if (passedPreviously(record.rowId)) visibleDraft?.remove(record.rowId);
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
    if (passesNext(record)) {
      visibleDraft?.insertOrReplace(orderedRowEntry(input.queryPlan, record));
    }
  }
  const frozenRows = rowDraft.freeze();
  const frozenSource = sourceDraft.freeze();
  const previousGroups = getGroupIndex(input.root.visible);
  const visible =
    previousGroups === undefined
      ? visibleDraft === undefined
        ? input.root.visible
        : Object.freeze({ rows: visibleDraft.freeze() })
      : attachGroupIndex(
          input.root.visible.rows,
          updateGroupIndex(
            previousGroups,
            [
              ...removedRecords,
              ...changedRecords.flatMap((record) => {
                const old = input.root.rows.get(record.rowId);
                return old === undefined ? [] : [old];
              }),
            ],
            changedRecords,
            input.root.expansion.overrides,
            "set-rows",
            input.instrumentation,
          ),
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
    operations: Object.freeze([]),
    affectedRowIds: Object.freeze([
      ...removedRecords.map((record) => record.rowId),
      ...changedRecords.map((record) => record.rowId),
    ]),
    effective: true,
    sameReferenceMutation,
  };
}
