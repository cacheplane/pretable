import type { PretableRowId } from "./column-types";

export type PretableRowModelOperation =
  | "set-rows"
  | "apply-transaction"
  | "set-query"
  | "set-derivations"
  | "set-group-expanded"
  | "set-expansion-default"
  | "expand-all"
  | "collapse-all"
  | "distinct-values";

export type PretableRowModelErrorCode =
  | "disposed-model"
  | "duplicate-row-id"
  | "existing-row-id"
  | "transaction-conflict"
  | "accessor-failed"
  | "comparator-failed"
  | "aggregator-failed"
  | "derivation-failed";

export interface PretableRowModelErrorContext {
  readonly operation: PretableRowModelOperation;
  readonly rowId?: PretableRowId;
  readonly columnId?: string;
  readonly cause?: unknown;
}

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

export class PretableDisposedModelError extends PretableRowModelError {
  readonly name: string = "PretableDisposedModelError";

  constructor(operation: PretableRowModelOperation) {
    super("disposed-model", "The row model has been disposed.", { operation });
  }
}

export type PretableTransitionCancellationReason =
  "cancelled" | "superseded" | "disposed";

export class PretableTransitionCancelledError extends Error {
  readonly name = "PretableTransitionCancelledError";

  constructor(
    readonly transitionId: number,
    readonly reason: PretableTransitionCancellationReason,
  ) {
    super(`Row-model transition ${transitionId} was ${reason}.`);
  }
}
