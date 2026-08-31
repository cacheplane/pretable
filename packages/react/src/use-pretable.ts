import {
  createLocalRowModel,
  mergeColumnAggregateOverrides,
  ɵsetLocalRowModelFilterAuthority,
  ɵsetLocalRowModelSortAuthority,
  type ColumnIdOf,
  type ColumnsOf,
  type PretableDerivationsFor,
  type PretableExpansionDefault,
  type PretableQueryFor,
  type PretableRowId,
  type PretableRowModel,
  type PretableRowModelErrorCode,
  type RowIdOf,
  type RowOf,
} from "@pretable/core";
import {
  useEffect,
  useInsertionEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  PretablePresentationColumns,
  PretableReactColumns,
  PretableRowChange,
} from "./types";
import { warnOnce } from "./dev-warn";
import { type PretableModel, usePretableModelInternal } from "./pretable-model";

export type { PretableModel } from "./pretable-model";

/**
 * The column shape a row model's `getColumns()` actually yields — schema, not
 * presentation. Exported (but not re-exported from `public_api`) so callers
 * that hand a model's own columns back to
 * {@link mergeModelPresentationColumnsForTesting} can name what they hold
 * instead of asserting past the mismatch.
 * @internal
 */
export type ModelSchemaColumn<TRow extends object = object> = {
  readonly id: string;
  readonly accessor: (row: TRow) => unknown;
  readonly value: (row: TRow) => unknown;
  readonly accessorKey?: string;
  readonly type?: unknown;
  readonly compare?: unknown;
  readonly aggregate?: unknown;
  readonly numberFormat?: unknown;
  readonly dateFormat?: unknown;
  readonly format?: unknown;
  readonly formatAggregate?: unknown;
};

/**
 * A one-value cache for the translated overrides object.
 *
 * A closure, not a `useRef` and not a bare `useState` object: the value is read
 * and written inside a `useMemo`, and both the react-hooks `refs` rule and its
 * `immutability` rule reject the direct forms there.
 */
function createOverridesCache(initial: Readonly<Record<string, unknown>>) {
  let current = initial;
  return {
    get: () => current,
    set: (next: Readonly<Record<string, unknown>>) => {
      current = next;
    },
  };
}

/**
 * A presentation column is only ever read by `.id` here; everything else is
 * spread through untouched. Constraining to `{ id }` rather than an index
 * signature is what lets an ordinary interface (`PretableColumn`) be passed —
 * interfaces get no implicit index signature, so the old shape rejected every
 * real caller and each one asserted its way in.
 */
type ModelPresentationColumn = { readonly id: string };

/**
 * The reportable fields a rejected COMPILED-QUERY write carries. `path` is
 * required, not optional: both `describe` callbacks interpolate it into a
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
 * SHARED BY BOTH SITES ON PURPOSE. The two were once byte-identical inline
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
 * `detail` and `path` are required constructor parameters of
 * `CompiledQueryValidationError`; only `columnId` is optional. The fallbacks
 * are still not dead code: acceptance is a duck-typed name check, so a foreign
 * error carrying the accepted name reaches them with neither field.
 */
function compiledQueryGuard(
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
 */
function rowModelCodeGuard(
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
 * The shared mechanism behind the rejected-write guards in the layout effect
 * below: rethrow anything unrecognised, and otherwise report the fault once.
 *
 * Everything not accepted RETHROWS. A blanket catch would hide unrelated
 * faults inside a layout effect, which is exactly the class of bug this seam
 * produces.
 *
 * What is genuinely site-specific — which call is wrapped, what the
 * surrounding code does with the transition, and the ref that is deliberately
 * not rolled back — all lives OUTSIDE the `catch`, so this leaves it where it
 * belongs.
 */
function reportRejectedWrite<TFault>(
  error: unknown,
  guard: RejectedWriteGuard<TFault>,
): void {
  if (!(error instanceof Error) || !guard.isAccepted(error)) throw error;
  const fault = guard.readFault(error);
  warnOnce(guard.warnKey(fault), guard.describe(fault));
}

/** @internal Test seam for presentation-only model column overlays. */
export function mergeModelPresentationColumnsForTesting<
  TRow extends object,
  TPresentation extends ModelPresentationColumn,
>(
  schemaColumns: readonly ModelSchemaColumn<TRow>[],
  presentationColumns: readonly TPresentation[],
): readonly (ModelSchemaColumn<TRow> & TPresentation)[] {
  const schemaById = new Map(
    schemaColumns.map((column) => [column.id, column] as const),
  );
  return presentationColumns.map((presentation) => {
    const schema = schemaById.get(presentation.id);
    if (schema === undefined) {
      throw new TypeError(
        `Pretable presentation columns must match the row model schema exactly: ${presentation.id}`,
      );
    }
    return {
      ...schema,
      ...presentation,
      id: schema.id,
      accessor: schema.accessor,
      value: schema.value,
      accessorKey: schema.accessorKey,
      type: schema.type,
      compare: schema.compare,
      // PROP-ONLY BY DESIGN, twice over: this is a model-mode test seam, and
      // model mode never re-requests derivations at all (the caller owns their
      // model), so no aggregate override reaches it. The schema's own
      // `aggregate` wins over a presentation column's, as every other
      // value-bearing field here does.
      aggregate: schema.aggregate,
      numberFormat: schema.numberFormat,
      dateFormat: schema.dateFormat,
      format: schema.format,
      formatAggregate: schema.formatAggregate,
    };
  });
}

/** Row type inferred from a non-empty column tuple. @public */
export type PretableRowForColumns<TColumns> = TColumns extends readonly [
  infer TFirst,
  ...(readonly unknown[]),
]
  ? TFirst extends {
      readonly accessor: (row: infer TRow extends object) => unknown;
    }
    ? TRow
    : never
  : never;

/** Conventional `row.id` type inferred from a row. @public */
export type PretableConventionalRowId<TRow> = TRow extends {
  readonly id: infer TRowId extends PretableRowId;
}
  ? TRowId
  : never;

/**
 * The query/notification pairing accepted in rows mode. @public
 *
 * Two arms, not three. The uncontrolled arm makes `onQueryChange` OPTIONAL
 * rather than forbidden, which is what lets a caller observe the query
 * without controlling it — the `<input defaultValue onChange>` shape. A
 * third arm for that case would express the same constraint set while
 * degrading TypeScript's error text for a malformed pair.
 *
 * Ownership stays unambiguous: no arm lets the caller set `query` while the
 * engine also owns it.
 */
export type PretableQueryOptions<TColumns> =
  /** Controlled: `query` requires its setter, as `value` requires `onChange`. */
  | {
      readonly query: PretableQueryFor<NoInfer<TColumns>>;
      readonly onQueryChange: (
        query: PretableQueryFor<NoInfer<TColumns>>,
      ) => void;
    }
  /** Uncontrolled: the engine owns the query, and MAY report changes. */
  | {
      readonly query?: never;
      readonly onQueryChange?: (
        query: PretableQueryFor<NoInfer<TColumns>>,
      ) => void;
    };

/** Viewport inputs shared by rows and explicit-model modes. @public */
export interface PretableViewportOptions {
  readonly viewportHeight: number;
  readonly viewportWidth?: number;
  readonly overscan?: number;
}

/** Shared declarative rows-mode inputs. @public */
export interface PretableRowsModeBaseOptions<
  TRow extends object,
  TRowId extends PretableRowId,
  TColumns,
> extends PretableViewportOptions {
  readonly rows: readonly TRow[];
  readonly columns: TColumns & PretableReactColumns<TColumns, TRowId>;
  readonly model?: never;
  readonly initialExpansion?: PretableExpansionDefault;
  readonly aggregateFilteredRows?: boolean;
  readonly onRowChange?: (
    change: PretableRowChange<TRow, TRowId, TColumns>,
  ) => void | Promise<void>;
  readonly beforeRowChange?: never;
}

/**
 * Rows-mode options using the conventional `row.id`.
 *
 * Gated on the row actually having an `id: string | number`, exactly as
 * `CreateLocalRowModelWithDefaultIdOptions` is. Without the gate this
 * overload still matched rows that have no `id`, silently resolving `TRowId`
 * to `never` (`PretableConventionalRowId` of an id-less row) and deferring the
 * failure to the engine, which throws `PretableRowModelError` on the first row
 * it reads. Resolving to `never` here pushes the call onto the explicit
 * `getRowId` overload, where the missing accessor is a compile error.
 *
 * @public
 */
export type UsePretableRowsOptions<TColumns> =
  PretableRowForColumns<TColumns> extends { readonly id: PretableRowId }
    ? PretableRowsModeBaseOptions<
        PretableRowForColumns<TColumns>,
        PretableConventionalRowId<PretableRowForColumns<TColumns>>,
        TColumns
      > & {
        readonly getRowId?: undefined;
      } & PretableQueryOptions<TColumns>
    : never;

/** Rows-mode options with an explicit ID accessor. @public */
export type UsePretableRowsWithIdOptions<
  TColumns,
  TRowId extends PretableRowId,
> = PretableRowsModeBaseOptions<
  PretableRowForColumns<TColumns>,
  TRowId,
  TColumns
> & {
  readonly getRowId: (row: PretableRowForColumns<TColumns>) => TRowId;
} & PretableQueryOptions<TColumns>;

/** Explicit-model options. The caller owns model lifecycle and query state. @public */
export interface UsePretableModelOptions<
  TModel,
> extends PretableViewportOptions {
  readonly model: TModel;
  readonly rows?: never;
  readonly getRowId?: never;
  readonly query?: never;
  readonly onQueryChange?: never;
  readonly onRowChange?: never;
  readonly columns?: PretablePresentationColumns<
    ColumnsOf<TModel>,
    RowIdOf<TModel>
  >;
  readonly beforeRowChange?: (
    changes: readonly PretableRowChange<
      RowOf<TModel>,
      RowIdOf<TModel>,
      ColumnsOf<TModel>
    >[],
  ) => void | Promise<void>;
}

/** Exact reordered presentation tuple accepted for one opaque model. @public */
export type PretableExactModelPresentationColumns<TModel, TPresentation> =
  TPresentation &
    (TPresentation extends PretablePresentationColumns<
      ColumnsOf<TModel>,
      RowIdOf<TModel>
    >
      ? unknown
      : never) &
    (Exclude<
      ColumnIdOf<ColumnsOf<TModel>>,
      TPresentation extends readonly {
        readonly id: infer TId extends string;
      }[]
        ? TId
        : never
    > extends never
      ? unknown
      : never);

/** Public rows-mode overload using conventional `row.id`. @public */
export function usePretable<
  const TColumns extends readonly [unknown, ...(readonly unknown[])],
>(
  options: UsePretableRowsOptions<TColumns>,
): PretableModel<
  PretableRowForColumns<TColumns>,
  PretableConventionalRowId<PretableRowForColumns<TColumns>>,
  TColumns
>;
/** Public rows-mode overload using an explicit ID accessor. @public */
export function usePretable<
  const TColumns extends readonly [unknown, ...(readonly unknown[])],
  const TRowId extends PretableRowId,
>(
  options: UsePretableRowsWithIdOptions<TColumns, TRowId>,
): PretableModel<PretableRowForColumns<TColumns>, TRowId, TColumns>;
/** Public explicit-model overload using schema presentation fallback. @public */
export function usePretable<TModel>(
  options: Omit<UsePretableModelOptions<TModel>, "columns"> & {
    readonly columns?: undefined;
    readonly model: TModel extends PretableRowModel<
      infer _TRow,
      infer _TRowId,
      infer _TColumns
    >
      ? TModel
      : never;
  },
): PretableModel<RowOf<TModel>, RowIdOf<TModel>, ColumnsOf<TModel>>;
/** Public explicit-model overload with an exact reordered presentation tuple. @public */
export function usePretable<
  TModel,
  const TPresentation extends PretablePresentationColumns<
    ColumnsOf<TModel>,
    RowIdOf<TModel>
  >,
>(
  options: Omit<UsePretableModelOptions<TModel>, "columns"> & {
    readonly columns: PretableExactModelPresentationColumns<
      TModel,
      TPresentation
    >;
    readonly model: TModel extends PretableRowModel<
      infer _TRow,
      infer _TRowId,
      infer _TColumns
    >
      ? TModel
      : never;
  },
): PretableModel<RowOf<TModel>, RowIdOf<TModel>, ColumnsOf<TModel>>;
export function usePretable(rawOptions: unknown): unknown {
  const options = rawOptions as
    | (PretableViewportOptions & {
        readonly model: PretableRowModel<object, PretableRowId, unknown>;
        readonly columns?: readonly { readonly id: string }[];
        readonly ɵvisualColumns?:
          | readonly { readonly id: string }[]
          | ((query: PretableQueryFor<unknown>) => readonly {
              readonly id: string;
            }[]);
        /** SEED only; see `hideGroupedColumns` on `UseIndexedPretableOptions`. */
        readonly ɵhideGroupedColumns?: boolean;
      })
    | (PretableViewportOptions & {
        readonly rows: readonly object[];
        readonly columns: readonly {
          readonly id: string;
          readonly accessor: (row: object) => unknown;
        }[];
        readonly getRowId?: (row: object) => PretableRowId;
        readonly query?: PretableQueryFor<unknown>;
        readonly onQueryChange?: (query: PretableQueryFor<unknown>) => void;
        readonly initialExpansion?: PretableExpansionDefault;
        readonly aggregateFilteredRows?: boolean;
        /**
         * Who selected the rows handed in. `"external"` keeps `query.filters`
         * published and stops the owned model re-applying them. Rows mode only:
         * a consumer-supplied model owns its own query, so the surface never
         * moves its authority.
         */
        readonly ɵfilterAuthority?: "engine" | "external";
        readonly ɵsortAuthority?: "engine" | "external";
        readonly ɵvisualColumns?:
          | readonly { readonly id: string }[]
          | ((query: PretableQueryFor<unknown>) => readonly {
              readonly id: string;
            }[]);
        /** SEED only; see `hideGroupedColumns` on `UseIndexedPretableOptions`. */
        readonly ɵhideGroupedColumns?: boolean;
      });
  const modelOption = "model" in options ? options.model : undefined;
  const mode = modelOption === undefined ? "rows" : "model";
  const rowsOptions = options as Extract<
    typeof options,
    { readonly rows: unknown }
  >;
  const [initialMode] = useState(mode);
  if (initialMode !== mode) {
    throw new Error("usePretable ownership mode cannot change after mount.");
  }
  const [ownedModel] = useState(() => {
    if (modelOption !== undefined) return null;
    return createLocalRowModel({
      rows: rowsOptions.rows,
      columns: rowsOptions.columns,
      ...(rowsOptions.getRowId === undefined
        ? {}
        : { getRowId: rowsOptions.getRowId }),
      ...(rowsOptions.query === undefined ? {} : { query: rowsOptions.query }),
      ...(rowsOptions.initialExpansion === undefined
        ? {}
        : { initialExpansion: rowsOptions.initialExpansion }),
      ...(rowsOptions.aggregateFilteredRows === undefined
        ? {}
        : { aggregateFilteredRows: rowsOptions.aggregateFilteredRows }),
      /*
       * Supplied at construction, not applied afterwards: the initial store is
       * built inside `createLocalRowModel`, so a model created under engine
       * authority would draw one filtered frame before any effect could move
       * it. The effect below only handles later flips.
       */
      ...(rowsOptions.ɵfilterAuthority === undefined
        ? {}
        : { ɵfilterAuthority: rowsOptions.ɵfilterAuthority }),
      ...(rowsOptions.ɵsortAuthority === undefined
        ? {}
        : { ɵsortAuthority: rowsOptions.ɵsortAuthority }),
    } as never) as PretableRowModel<object, PretableRowId, unknown>;
  });
  const rowModel =
    modelOption ?? (ownedModel as NonNullable<typeof ownedModel>);
  const lastRows = useRef(mode === "rows" ? rowsOptions.rows : undefined);
  const lastDerivations = useRef(
    mode === "rows" ? rowsOptions.columns : undefined,
  );
  const lastControlledQuery = useRef(
    mode === "rows" ? rowsOptions.query : undefined,
  );
  const pendingDerivations = useRef<Promise<number> | null>(null);
  const queryReconciliationGeneration = useRef(0);
  const disposalGeneration = useRef(0);
  const lastFilterAuthority = useRef(
    mode === "rows" ? (rowsOptions.ɵfilterAuthority ?? "engine") : "engine",
  );
  const lastSortAuthority = useRef(
    mode === "rows" ? (rowsOptions.ɵsortAuthority ?? "engine") : "engine",
  );

  /*
   * Guarded on `ownedModel`, not on `mode`: the model the caller supplied is
   * theirs, and moving its authority is the explicit-model change this design
   * excludes. `processing` is read during render and never memoized, so this
   * really can change while one model lives — the plan's recompile cache
   * compares authority for the same reason.
   */
  useLayoutEffect(() => {
    if (ownedModel === null) return;
    const authority = rowsOptions.ɵfilterAuthority ?? "engine";
    if (lastFilterAuthority.current === authority) return;
    lastFilterAuthority.current = authority;
    ɵsetLocalRowModelFilterAuthority(ownedModel, authority);
  });

  /** The sort twin, guarded on `ownedModel` for the same reason. */
  useLayoutEffect(() => {
    if (ownedModel === null) return;
    const authority = rowsOptions.ɵsortAuthority ?? "engine";
    if (lastSortAuthority.current === authority) return;
    lastSortAuthority.current = authority;
    ɵsetLocalRowModelSortAuthority(ownedModel, authority);
  });

  /*
   * The `columns` prop with grid-core's per-column aggregate overrides layered
   * on — what actually gets requested as derivations.
   *
   * A REF, published BELOW from an insertion effect, because the value cannot
   * be computed at this point in the hook order: the overrides live on the
   * grid core, and `usePretableModelInternal` does not create that until the
   * end of this function. Insertion effects run ahead of every layout effect
   * in the same commit, so the effect just below always reads the value the
   * committed render computed. Seeded with the unmerged list, which is what an
   * override-free grid merges to anyway.
   */
  const mergedDerivations = useRef(
    mode === "rows"
      ? (rowsOptions.columns as readonly { readonly id: string }[])
      : undefined,
  );

  useLayoutEffect(() => {
    if (mode !== "rows") return;
    /*
     * The gate compares the MERGED list, not the `columns` prop. An override
     * never touches the prop's identity, so a prop-identity gate would swallow
     * it. What the ref holds is memoized on `[columns, overrides]` below
     * precisely so this comparison stays meaningful: the merge is NOT
     * identity-idempotent on the applying path, so merging inline here would
     * make every render look like a change and pay a `compileQuery` before
     * concluding no-op.
     */
    const derivations = mergedDerivations.current as NonNullable<
      typeof mergedDerivations.current
    >;
    const derivationsChanged = lastDerivations.current !== derivations;
    const controlledQueryChanged =
      lastControlledQuery.current !== rowsOptions.query;
    if (lastRows.current !== rowsOptions.rows) {
      /*
       * Recorded BEFORE the call that can throw, and deliberately NOT rolled
       * back if it does — the derivations and query rule below, for the same
       * reason: the rejected array stays here as "last requested", so an
       * invalid update is attempted ONCE instead of being retried on every
       * later render. Recovery is unaffected; a later valid array is a new
       * identity, so this gate opens for it.
       */
      lastRows.current = rowsOptions.rows;
      try {
        rowModel.setRows(rowsOptions.rows);
      } catch (error) {
        /*
         * The rows twin of the two rejection guards below. An invalid `rows`
         * prop is a REJECTED WRITE, not a fatal one: this runs in a layout
         * effect, so a throw escapes the commit and React unmounts the live
         * grid — measured at three rendered rows going to zero for five
         * ordinary faults (a duplicate id, a throwing accessor, a missing id,
         * a null row, a non-scalar id). The same fixture under an INJECTED
         * error also put a figure on what is destroyed: 8705 bytes of markup
         * to zero.
         *
         * The kept value is a STRONGER claim than its siblings make. A stale
         * aggregate or filter is a display nuance; stale ROWS mean the
         * consumer's data and the screen have diverged, which is why the
         * message says so in as many words.
         *
         * No transition to chain: `setRows` returns a synchronous
         * `PretableMutationResult`, not a transition with a `finished`
         * promise.
         *
         * Which codes are accepted, and why acceptance is by code rather than
         * name, is documented on `rowModelCodeGuard` above.
         */
        reportRejectedWrite(
          error,
          rowModelCodeGuard("rows-rejected", ({ columnId, detail }) =>
            "[pretable] A rows update was rejected as invalid" +
            (columnId === undefined ? "" : ` on column "${columnId}"`) +
            `: ${detail}. The grid kept its previous rows, so it is showing ` +
            "data from before this update and the rows on screen no longer " +
            "match the ones you passed. Correct the rows, or drop the change.",
          ),
        );
      }
    }
    /*
     * NOT the same question as `derivationsChanged`. A rejected update changes
     * nothing in the row model, so there is nothing for the query
     * reconciliation below to reconcile, and forcing a re-apply on that path
     * would ask the model to recompile a query the consumer never changed.
     *
     * HISTORY, because the original reason no longer holds and a reader should
     * not restore it: when this gate was written, `setQuery` below was
     * unguarded, so that re-apply was actively FATAL — a combined update that
     * adds a column AND typos an aggregate leaves the model without the new
     * column, and re-applying a query naming it threw `references unknown
     * column` out of this same layout effect. That throw is now a rejected
     * write too: it is a `CompiledQueryValidationError`, and the guard inside
     * `applyQuery` below catches exactly it (pinned end to end by the
     * unknown-column test in `invalid-query-rejected.test.tsx`).
     *
     * What remains is smaller and still worth keeping: a needless recompile,
     * and a `query-rejected` warning naming a query the consumer never
     * touched. Safety is no longer the reason this gate exists.
     *
     * A query the CONSUMER changed in the same commit still lands, via
     * `controlledQueryChanged`, which is independent of this gate.
     */
    let derivationsApplied = false;
    if (derivationsChanged) {
      /*
       * Recorded BEFORE the call that can throw, and deliberately NOT rolled
       * back if it does: the rejected array stays here as "last requested", so
       * an invalid update is attempted ONCE instead of recompiling on every
       * later render. Restoring the previous value would retry the same
       * invalid input forever. Recovery is unaffected — a later valid array is
       * a new identity, so the gate above opens for it.
       */
      lastDerivations.current = derivations as typeof lastDerivations.current;
      let transition;
      try {
        transition = rowModel.setDerivations(
          derivations as unknown as PretableDerivationsFor<unknown>,
        );
      } catch (error) {
        /*
         * An invalid derivations update is a REJECTED WRITE, not a fatal one:
         * this runs in a layout effect, so a throw escapes the commit and
         * React unmounts the live grid. The row model keeps the derivations it
         * already had and the grid stays interactive — silently otherwise, so
         * a consumer would see a stale aggregate and nothing else. The
         * mechanism (which names are accepted, what rethrows, how the warning
         * is keyed) is documented on `reportRejectedWrite` above.
         */
        reportRejectedWrite(
          error,
          compiledQueryGuard(
            "derivations-rejected",
            ({ columnId, detail, path }) =>
              "[pretable] A derivations update was rejected as invalid" +
              (columnId === undefined ? "" : ` on column "${columnId}"`) +
              ` at ${path}: ${detail}. The grid kept its previous derivations, ` +
              "so the values it shows are the ones from before this update. " +
              "Correct the column definition, or drop the change.",
          ),
        );
      }
      if (transition !== undefined) {
        derivationsApplied = true;
        const finished = transition.finished;
        pendingDerivations.current = finished;
        const clearPending = () => {
          if (pendingDerivations.current === finished) {
            pendingDerivations.current = null;
          }
        };
        void finished.then(clearPending, clearPending);
        void finished.catch(() => undefined);
      }
    }
    if (controlledQueryChanged) {
      /*
       * Recorded BEFORE the `setQuery` below can throw, and deliberately NOT
       * rolled back if it does — the derivations rule above, for the same
       * reason: the rejected query stays here as "last requested", so an
       * invalid update is attempted ONCE instead of recompiling on every later
       * render. Recovery is unaffected; a later valid query is a new identity,
       * so this gate opens for it.
       */
      lastControlledQuery.current = rowsOptions.query;
    }
    if (derivationsApplied || controlledQueryChanged) {
      queryReconciliationGeneration.current += 1;
    }
    if (
      (derivationsApplied || controlledQueryChanged) &&
      rowsOptions.query !== undefined
    ) {
      const desiredQuery = rowsOptions.query;
      const generation = queryReconciliationGeneration.current;
      const applyQuery = () => {
        if (queryReconciliationGeneration.current !== generation) return;
        let transition;
        try {
          transition = rowModel.setQuery(desiredQuery);
        } catch (error) {
          /*
           * The query twin of the derivations rejection above. An invalid
           * query arriving on the `query` prop is a REJECTED WRITE, not a
           * fatal one: this runs in a layout effect, so a throw escapes the
           * commit and React unmounts the live grid. The row model keeps the
           * query it already had and the grid stays interactive.
           *
           * INSIDE `applyQuery`, not around its call sites, because there are
           * two: this closure runs synchronously when no derivations
           * transition is pending, and from a `.then()` callback when one is.
           * Only the synchronous path shows the fatal signature — a throw on
           * the chained path is an unhandled rejection — but both leave the
           * query silently unapplied, so both are reported here.
           *
           * The mechanism is documented on `reportRejectedWrite` above.
           */
          reportRejectedWrite(
            error,
            compiledQueryGuard(
              "query-rejected",
              ({ columnId, detail, path }) =>
                "[pretable] A query update was rejected as invalid" +
                (columnId === undefined ? "" : ` on column "${columnId}"`) +
                ` at ${path}: ${detail}. The grid kept its previous query, so ` +
                "the rows it shows are the ones from before this update. " +
                "Correct the query, or drop the change.",
            ),
          );
        }
        if (transition !== undefined) {
          void transition.finished.catch(() => undefined);
        }
      };
      const pending = pendingDerivations.current;
      if (pending === null) applyQuery();
      else void pending.then(applyQuery, applyQuery);
    }
  });

  useEffect(() => {
    if (ownedModel === null) return;
    disposalGeneration.current += 1;
    const mountedGeneration = disposalGeneration.current;
    return () => {
      queueMicrotask(() => {
        if (disposalGeneration.current === mountedGeneration) {
          ownedModel.dispose();
        }
      });
    };
  }, [ownedModel]);

  useLayoutEffect(
    () => () => {
      queryReconciliationGeneration.current += 1;
    },
    [],
  );

  const schemaColumns =
    rowModel.getColumns() as unknown as readonly ModelSchemaColumn[];
  const presentationColumns =
    options.columns === undefined
      ? schemaColumns
      : mode === "model"
        ? mergeModelPresentationColumnsForTesting(
            schemaColumns,
            options.columns,
          )
        : options.columns;
  const table = usePretableModelInternal({
    rowModel,
    columns: options.ɵvisualColumns ?? presentationColumns,
    viewportHeight: options.viewportHeight,
    viewportWidth: options.viewportWidth,
    overscan: options.overscan,
    onQueryChange:
      "onQueryChange" in options ? options.onQueryChange : undefined,
    allowVisualExtras: options.ɵvisualColumns !== undefined,
    // Controlled iff the caller supplies `query` in rows mode: that's the
    // only shape where the consumer owns the next query state (mirrors the
    // `rowsOptions.query !== undefined` check already used above to decide
    // whether to reconcile a controlled query back onto the model).
    queryControlled: mode === "rows" && rowsOptions.query !== undefined,
    ...(options.ɵhideGroupedColumns === undefined
      ? {}
      : { hideGroupedColumns: options.ɵhideGroupedColumns }),
  });

  /*
   * VOCABULARY TRANSLATION, and the only place it happens.
   *
   * `gridSnapshot.columnAggregates` is keyed by the LAYOUT column vocabulary —
   * every column the grid draws or hides, INCLUDING presentation-only extras
   * the schema has never heard of (the surface's synthetic group and
   * row-select columns, reachable through `ɵvisualColumns`).
   * `mergeColumnAggregateOverrides` is keyed by the vocabulary of the
   * DERIVATIONS it is handed. Ids shared by both are the same string, so
   * translating is dropping the ids the derivations do not carry. Nothing in
   * either signature enforces this: both are `string`.
   *
   * KEYED ON THE CURRENT `columns` PROP, never on `rowModel.getColumns()`.
   * That method is documented (see `PretableRowModel.getColumns` in
   * `@pretable/core`) as returning "the immutable original schema/presentation
   * tuple supplied when this model was created" — `setDerivations` "never
   * changes this presentation fallback or its identity". The owned model is
   * built once in a `useState` initializer, so `getColumns()` freezes the
   * vocabulary at MOUNT. Filtering against it silently dropped every override
   * for a column the consumer added to `columns` after mount — which is
   * exactly what a tool panel drives. The prop is both the live vocabulary and
   * the list the merge iterates, so keying on it cannot disagree with the
   * merge.
   *
   * The RESULT IS VALUE-STABLE, not merely memoized, and that is load-bearing:
   * `mergeColumnAggregateOverrides` is not identity-idempotent once any
   * override applies, so a fresh overrides object carrying the same kept
   * entries would produce a fresh merged array and re-request derivations.
   * grid-core publishes a new `columnAggregates` for a write to ANY layout
   * column, synthetic ones included, so without this reuse a write the
   * derivations cannot even see would cost a `compileQuery`. Stability is what
   * makes the drop observable at all: the merge already ignores an id no
   * derivation carries, so a dropped key changes nothing about the VALUES
   * either way.
   *
   * What is handed out is the LAST OBJECT HANDED OUT whenever the kept entries
   * are value-equal to it — which on the first render is this cache's own
   * frozen `{}`, not `gridSnapshot.columnAggregates`. Only when the entries
   * differ is a new object produced, and only then is the engine's own object
   * passed through unwrapped (the no-drop case, i.e. every grid without visual
   * extras). The memo body itself always allocates a `Set` and two arrays when
   * it runs; what is saved is downstream, not here.
   *
   * A DISCARDED CONCURRENT RENDER CAN COST ONE EXTRA `setDerivations`. The
   * cache is written during render, so an interrupted render records its
   * value, and a later committed render whose entries match an EARLIER
   * commit's misses the reuse and hands out a fresh object. Values are never
   * stale — every object returned is either recomputed from current inputs or
   * value-equal to them — so this is a wasted `compileQuery`, nothing more.
   * Do not "fix" it by moving the write into an effect: an effect runs after
   * the render that needs the value, which would hand out a genuinely stale
   * object.
   */
  const layoutAggregateOverrides = table.gridSnapshot
    .columnAggregates as Record<string, unknown>;
  const derivationColumns =
    mode === "rows"
      ? (rowsOptions.columns as readonly { readonly id: string }[])
      : schemaColumns;
  // A channel rather than `useRef`: this cache is read AND written during
  // render, which the react-hooks `refs` rule forbids for a ref and the
  // `immutability` rule forbids for a bare state object. Same escape hatch
  // `createLatestValueChannel` takes in `pretable-model.ts`.
  const [keptOverridesCache] = useState(() =>
    createOverridesCache(Object.freeze({})),
  );
  const schemaAggregateOverrides = useMemo(() => {
    const derivationIds = new Set(derivationColumns.map((column) => column.id));
    const entries = Object.entries(layoutAggregateOverrides);
    const kept = entries.filter(([id]) => derivationIds.has(id));
    // Value equality against the LAST OBJECT HANDED OUT, and the cache is
    // written on every path — including the nothing-dropped one. Recording
    // only the dropped path leaves the cache cold until the first drop, so the
    // first drop still hands out a fresh object and still re-derives, which is
    // the exact write this is meant to make free. Same length plus same
    // (id, value) per kept entry is set equality, because object keys are
    // unique; `hasOwn` rather than a bare lookup so a hypothetical stored
    // `undefined` cannot read as a match against an absent key.
    const previous = keptOverridesCache.get();
    if (
      Object.keys(previous).length === kept.length &&
      kept.every(
        ([id, value]) =>
          Object.hasOwn(previous, id) && Object.is(previous[id], value),
      )
    ) {
      return previous;
    }
    const next =
      kept.length === entries.length
        ? layoutAggregateOverrides
        : Object.freeze(Object.fromEntries(kept));
    keptOverridesCache.set(next);
    return next;
  }, [derivationColumns, keptOverridesCache, layoutAggregateOverrides]);

  /*
   * The memo the effect above depends on. Two calls with `Object.is`-equal
   * inputs return two DISTINCT arrays whenever an override applies, so the
   * merged array has to be produced exactly once per input pair and held, not
   * recomputed inside the comparison that consumes it.
   *
   * MODEL MODE IS DELIBERATELY EXCLUDED: a caller-supplied row model owns its
   * own derivations, and this hook never calls `setDerivations` on one, so an
   * override written on the grid core of a model-mode grid does not reach the
   * aggregates. Same rule that keeps filter/sort authority moves scoped to
   * `ownedModel`.
   */
  const nextDerivations = useMemo(
    () =>
      mode === "rows"
        ? mergeColumnAggregateOverrides(
            rowsOptions.columns as readonly { readonly id: string }[],
            schemaAggregateOverrides,
          )
        : undefined,
    [mode, rowsOptions.columns, schemaAggregateOverrides],
  );
  useInsertionEffect(() => {
    mergedDerivations.current = nextDerivations;
  }, [nextDerivations]);

  return table;
}

export type {
  PretableCellAddressFor,
  PretableCellRangeFor,
  PretableSelectionFor,
  PretableSurfaceColumnId,
  PretableSurfaceFocusState,
  PretableSurfaceInteractionColumnId,
  PretableSurfaceState,
  PretableTelemetry,
} from "./surface-types";
