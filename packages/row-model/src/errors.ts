import type { PretableGroupKey, PretableRowId } from "./column-types";

/** @public */
export type PretableRowModelOperation =
  | "set-rows"
  | "apply-transaction"
  | "set-query"
  | "set-derivations"
  | "set-group-expanded"
  | "set-expansion-default"
  | "expand-all"
  | "collapse-all"
  | "changes-since"
  | "distinct-values"
  | "dispose";

/** @public */
export type PretableRowModelErrorCode =
  | "disposed-model"
  | "duplicate-row-id"
  | "existing-row-id"
  | "transaction-conflict"
  | "reentrant-mutation"
  | "row-identity-change"
  | "unsupported-row-update"
  | "accessor-failed"
  | "invalid-group-key"
  | "comparator-failed"
  | "aggregator-failed"
  | "derivation-failed";

/** @public */
export interface PretableRowModelErrorContext {
  readonly operation: PretableRowModelOperation;
  readonly rowId?: PretableRowId;
  readonly columnId?: string;
  readonly cause?: unknown;
}

/** @public */
export class PretableRowModelError extends Error {
  readonly name: string = "PretableRowModelError";
  readonly code: PretableRowModelErrorCode;
  readonly operation: PretableRowModelOperation;
  readonly rowId?: PretableRowId;
  readonly columnId?: string;

  constructor(
    code: PretableRowModelErrorCode,
    message: string,
    context: PretableRowModelErrorContext,
  ) {
    super(message, { cause: context.cause });
    this.code = code;
    this.operation = context.operation;
    this.rowId = context.rowId;
    this.columnId = context.columnId;
  }
}

/** @public */
export class PretableDisposedModelError extends PretableRowModelError {
  readonly name: string = "PretableDisposedModelError";

  constructor(operation: PretableRowModelOperation) {
    super("disposed-model", "The row model has been disposed.", { operation });
  }
}

/** @public */
export class PretableReentrantMutationError extends PretableRowModelError {
  readonly name = "PretableReentrantMutationError";

  constructor(
    operation: PretableRowModelOperation,
    readonly activeOperation: PretableRowModelOperation,
  ) {
    super(
      "reentrant-mutation",
      `Cannot run ${operation} while ${activeOperation} is preparing an atomic publication.`,
      { operation },
    );
  }
}

/** Finds a nested guard failure through structured callback-error causes. */
export function findPretableReentrantMutationError(
  error: unknown,
): PretableReentrantMutationError | undefined {
  const visited = new Set<object>();
  let current = error;
  while (current !== null && typeof current === "object") {
    if (current instanceof PretableReentrantMutationError) return current;
    if (visited.has(current)) return undefined;
    visited.add(current);
    current = "cause" in current ? current.cause : undefined;
  }
  return undefined;
}

/** @public */
export class PretableRowIdentityChangeError extends PretableRowModelError {
  readonly name = "PretableRowIdentityChangeError";

  constructor(
    rowId: PretableRowId,
    readonly nextRowId: unknown,
    cause?: unknown,
  ) {
    super(
      "row-identity-change",
      `An update for row ${String(rowId)} changed its configured identity.`,
      { operation: "apply-transaction", rowId, cause },
    );
  }
}

/** @public */
export class PretableUnsupportedRowUpdateError extends PretableRowModelError {
  readonly name = "PretableUnsupportedRowUpdateError";

  constructor(rowId: PretableRowId, cause?: unknown) {
    super(
      "unsupported-row-update",
      "Partial updates require an ordinary object or null-prototype record; replace class and exotic rows with setRows instead.",
      { operation: "apply-transaction", rowId, cause },
    );
  }
}

/** @public */
export class PretableInvalidGroupKeyError extends PretableRowModelError {
  readonly name = "PretableInvalidGroupKeyError";

  constructor(
    operation: PretableRowModelOperation,
    rowId: PretableRowId | undefined,
    columnId: string,
    readonly value: unknown,
    cause: unknown = new TypeError(
      "Group keys must be strings, numbers, bigints, booleans, Dates, null, or undefined.",
    ),
  ) {
    super(
      "invalid-group-key",
      `Column ${columnId} produced an unsupported group key.`,
      { operation, rowId, columnId, cause },
    );
  }
}

/** Runtime complement to the wholly-assignable `PretableRowGroupFor` check. */
export function isPretableGroupKey(value: unknown): value is PretableGroupKey {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value !== "object") return false;
  try {
    Date.prototype.getTime.call(value);
    return true;
  } catch {
    return false;
  }
}

/** @public */
export type PretableTransitionCancellationReason =
  "cancelled" | "superseded" | "disposed";

/** @public */
export class PretableTransitionCancelledError extends Error {
  readonly name = "PretableTransitionCancelledError";

  constructor(
    readonly transitionId: number,
    readonly reason: PretableTransitionCancellationReason,
  ) {
    super(`Row-model transition ${transitionId} was ${reason}.`);
  }
}
