import type { PretableRowModelErrorCode } from "@pretable/core";

import { warnOnce } from "./dev-warn";

/**
 * The reportable fields a rejected COMPILED-QUERY write carries. `path` is
 * required, not optional: every `describe` callback interpolates it into a
 * user-facing sentence, so a type that admitted `undefined` would let a
 * dropped fallback ship "at undefined" to the console.
 */
type CompiledQueryFault = {
  readonly columnId: string | undefined;
  readonly detail: string;
  readonly path: string;
};

/** The reportable fields a rejected ROW-MODEL write carries. */
type RowModelFault = {
  readonly code: string;
  readonly columnId: string | undefined;
  readonly detail: string;
};

/**
 * What a guard factory produces: how to accept, how to key, how to word.
 *
 * GENERIC over the fault, not widened to a union of both shapes. A shared
 * four-field type would have to make `code` and `path` optional, which is what
 * erases the guarantee above and forces each guard to hand-write `undefined`
 * for the half it does not have.
 */
type RejectedWriteGuard<TFault> = {
  readonly isAccepted: (error: Error) => boolean;
  readonly readFault: (error: Error) => TFault;
  readonly warnKey: (fault: TFault) => string;
  readonly describe: (fault: TFault) => string;
};

/**
 * The row-model error codes a `setRows` guard treats as a rejected write:
 * every DATA fault a bad `rows` prop can produce.
 *
 * An ALLOWLIST, never the fatal codes inverted, so a code added to
 * `PretableRowModelErrorCode` later propagates instead of being silently
 * swallowed.
 *
 * `disposed-model` and `reentrant-mutation` are excluded deliberately. Both
 * mean the CONSUMER'S CODE is wrong in a way the next render will not fix — a
 * write to a disposed model, or a write re-entered from inside another write's
 * publication — so swallowing either would convert a lifecycle bug into a grid
 * that silently stops updating. Their exclusion is pinned behaviourally, by
 * tests asserting each still propagates, not structurally: a second set
 * intersecting this one nowhere could be deleted without changing any result,
 * so no test could ever fail on its absence.
 *
 * The four remaining codes (`existing-row-id`, `transaction-conflict`,
 * `row-identity-change`, `unsupported-row-update`) are `apply-transaction`-only
 * and unreachable through `setRows`; they are left out rather than added "for
 * safety", so this set states what is actually reachable.
 *
 * Typed against the public `PretableRowModelErrorCode` union so a renamed code
 * breaks the build here rather than silently un-guarding a fault. The VALUES
 * are string literals, not imported constants: `@pretable-internal/row-model`
 * is a devDependency of this package, never a runtime one.
 *
 * SCOPED TO `setRows`. This is not "the rejectable codes"; it is the codes
 * reachable through one operation. A guard for a different operation — say
 * `applyTransaction`, whose faults include the four `apply-transaction`-only
 * codes named above — needs its OWN set. Widening this one to serve it would
 * silently widen the `setRows` guards too, making them swallow codes `setRows`
 * can never legitimately produce.
 *
 * That scoping is per-OPERATION, not per-call-site, so the two `setRows` call
 * sites that share this set — `usePretable`'s rows-mode layout effect and
 * `useLocalRowModel`'s — do NOT violate it. Both write through `setRows`, on a
 * model built by `createLocalRowModel`, so the reachable codes are the same
 * set; only the warn-key prefix and the wording differ per site.
 */
const REJECTABLE_ROW_MODEL_CODES: ReadonlySet<PretableRowModelErrorCode> =
  new Set<PretableRowModelErrorCode>([
    "duplicate-row-id",
    "accessor-failed",
    "invalid-group-key",
    "comparator-failed",
    "aggregator-failed",
    "derivation-failed",
  ]);

/**
 * The guard for a write that compiles a query — `setDerivations` and
 * `setQuery`.
 *
 * Detection is by NAME even though `CompiledQueryValidationError` does carry a
 * `code` (`"invalid-query"`): that string is not a member of
 * `PretableRowModelErrorCode`, so it cannot be typed against the union
 * {@link REJECTABLE_ROW_MODEL_CODES} is built from. It is in neither guard's
 * set, which is exactly what keeps the two guards disjoint — this guard
 * matches only the name, and the code guard's allowlist can never contain it.
 *
 * SHARED BY EVERY SITE ON PURPOSE. Two of them were once byte-identical inline
 * blocks and a fix to one silently missed the other; keeping the acceptance,
 * field reads and key construction in one factory is what stops that
 * recurring. Only the prefix and the sentences differ.
 *
 * Name rather than `instanceof` because the class is declared in
 * `@pretable-internal/row-model` and is NOT re-exported from `@pretable/core`,
 * so nothing under `src/` can import it — and because `instanceof` stops
 * matching across duplicated module instances.
 *
 * The key is `columnId` + an INDEX-STRIPPED `path` + `detail`, never a
 * constant: `warnOnce` latches, so one fire disarms that key for the rest of
 * the process. The RAW `path` is wrong in both directions — it is value-blind
 * (two different bad values at one position share it, failing "a DIFFERENT
 * invalid value still warns" in `invalid-derivations-rejected.test.tsx` and "a
 * DIFFERENT fault still warns" in `invalid-query-rejected.test.tsx`) and it
 * embeds an array INDEX (`query.filters[0].value`), so it re-fires when a
 * fault merely moves position. Stripping `[0]`/`[1]` keeps which PROPERTY
 * failed and discards where in the list it sat.
 *
 * The `warnKeyPrefix` is what separates one call site from another: `warnOnce`
 * latches per KEY, so two sites sharing a prefix would let a rejection in one
 * silence the identical rejection in the other for the rest of the process.
 *
 * `detail` and `path` are required constructor parameters of
 * `CompiledQueryValidationError`; only `columnId` is optional. The fallbacks
 * are still not dead code: acceptance is a duck-typed name check, so a foreign
 * error carrying the accepted name reaches them with neither field.
 */
export function compiledQueryGuard(
  warnKeyPrefix: string,
  describe: (fault: CompiledQueryFault) => string,
): RejectedWriteGuard<CompiledQueryFault> {
  return {
    isAccepted: (error) => error.name === "CompiledQueryValidationError",
    readFault: (error) => {
      const validation = error as Error & {
        readonly columnId?: string;
        readonly detail?: string;
        readonly path?: string;
      };
      return {
        columnId: validation.columnId,
        detail: validation.detail ?? validation.message,
        path: validation.path ?? "(unknown location)",
      };
    },
    warnKey: (fault) =>
      `${warnKeyPrefix}:${fault.columnId ?? "(no column)"}:${fault.path.replace(
        /\[\d+\]/g,
        "[]",
      )}:${fault.detail}`,
    describe,
  };
}

/**
 * The guard for `setRows`. Detection is by row-model error CODE, not name —
 * hence the name of this factory, since `CompiledQueryValidationError` is
 * declared in row-model too and the CODE is the axis that separates them.
 *
 * The code is what survives: `PretableSetRowsExecutionError`'s constructor
 * calls `super(error.code, …)`, so the code passes through
 * `remapSetRowsError`'s wrapper while the name does not. A code check
 * therefore catches the wrapped and unwrapped forms with one entry, and does
 * not depend on enumerating the `PretableRowModelError` subclasses — most of
 * which override `name`, but not all (`TransactionExecutionError` does not,
 * and inherits `"PretableRowModelError"`). In practice the ordinary bad-`rows`
 * faults were all observed arriving as the BASE `PretableRowModelError`,
 * because `remapSetRowsError` only wraps when `operation !== "set-rows"`.
 *
 * The key OMITS `rowId` and the message, unlike the compiled-query twin. That
 * is deliberate and is the one place this guard is less discriminating than
 * its siblings: a streaming feed carrying many distinct bad rows would key
 * uniquely per row and flood the console. A consumer told once that they have
 * a duplicate row id has the information; the second bad id teaches nothing
 * new. Different fault KINDS still warn.
 *
 * The `warnKeyPrefix` separates call sites, for the reason documented on
 * {@link compiledQueryGuard}: `usePretable` keys `rows-rejected` and
 * `useLocalRowModel` keys `local-rows-rejected`, so neither hook's latch can
 * silence the other's — and the prefix names which hook produced the warning.
 */
export function rowModelCodeGuard(
  warnKeyPrefix: string,
  describe: (fault: RowModelFault) => string,
): RejectedWriteGuard<RowModelFault> {
  return {
    isAccepted: (error) => {
      const code = (error as Error & { readonly code?: unknown }).code;
      return (
        typeof code === "string" &&
        REJECTABLE_ROW_MODEL_CODES.has(code as PretableRowModelErrorCode)
      );
    },
    readFault: (error) => {
      /*
       * `code` is typed REQUIRED here, unlike the optional read in
       * `isAccepted` above, because `readFault` only ever runs on an error
       * `isAccepted` already returned true for — which proved `code` is a
       * string in {@link REJECTABLE_ROW_MODEL_CODES}. A `?? "(no code)"`
       * fallback would therefore be unreachable, and would survive its own
       * mutation test.
       */
      const rowModelError = error as Error & {
        readonly code: string;
        readonly columnId?: string;
      };
      return {
        code: rowModelError.code,
        columnId: rowModelError.columnId,
        detail: rowModelError.message,
      };
    },
    warnKey: (fault) =>
      `${warnKeyPrefix}:${fault.code}:${fault.columnId ?? "(no column)"}`,
    describe,
  };
}

/**
 * The shared mechanism behind every rejected-write guard: rethrow anything
 * unrecognised, and otherwise report the fault once.
 *
 * Everything not accepted RETHROWS. A blanket catch would hide unrelated
 * faults inside a layout effect, which is exactly the class of bug this seam
 * produces.
 *
 * What is genuinely site-specific — which call is wrapped, what the
 * surrounding code does with the transition, and the ref that is deliberately
 * not rolled back — all lives OUTSIDE the `catch` at each call site, so this
 * leaves it where it belongs.
 */
export function reportRejectedWrite<TFault>(
  error: unknown,
  guard: RejectedWriteGuard<TFault>,
): void {
  if (!(error instanceof Error) || !guard.isAccepted(error)) throw error;
  const fault = guard.readFault(error);
  warnOnce(guard.warnKey(fault), guard.describe(fault));
}
