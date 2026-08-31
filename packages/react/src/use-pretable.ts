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
      lastRows.current = rowsOptions.rows;
      rowModel.setRows(rowsOptions.rows);
    }
    /*
     * NOT the same question as `derivationsChanged`. A rejected update changes
     * nothing in the row model, so there is nothing for the query
     * reconciliation below to reconcile — and forcing a re-apply on that path
     * is actively fatal: a combined update that adds a column AND typos an
     * aggregate leaves the model without the new column, so re-applying a
     * query that names it throws `references unknown column` out of this same
     * layout effect, which is the exact destruction this guard exists to
     * remove. A query the CONSUMER changed in the same commit still lands, via
     * `controlledQueryChanged` — a throw on that path is the pre-existing
     * unguarded-`setQuery` hazard, filed separately because query reject
     * semantics involve the `onQueryChange` round trip.
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
         * already had and the grid stays interactive.
         *
         * Detected by NAME, not `instanceof`. `CompiledQueryValidationError`
         * is declared in `@pretable-internal/row-model` and is NOT re-exported
         * from `@pretable/core`; row-model is a devDependency here (tests
         * import it directly), never a runtime one, so nothing under `src/`
         * can import the class. A name check is also sturdier than
         * `instanceof`, which stops matching across duplicated module
         * instances. Everything else RETHROWS: a blanket catch here would hide
         * unrelated faults inside a layout effect, which is exactly the class
         * of bug this seam produces.
         */
        const isValidationError =
          error instanceof Error &&
          error.name === "CompiledQueryValidationError";
        if (!isValidationError) throw error;
        /*
         * A rejected write is silent otherwise: the grid keeps painting the
         * derivations it already had, so a consumer sees a stale aggregate and
         * nothing else. Say so once per distinct fault.
         *
         * KEYED ON `columnId` + INDEX-STRIPPED `path` + `detail`, and never on
         * a constant: `warnOnce` latches, so one fire disarms that key for the
         * rest of the process and a constant key would suppress every later,
         * different misconfiguration.
         *
         * The RAW `path` is wrong on its own in both directions. It is
         * value-blind — two different bad aggregates at the same position
         * share it, and keying on it fails the "a DIFFERENT invalid value
         * still warns" pin — and it embeds the derivation's array INDEX
         * (`derivations[1].aggregate`), so it re-fires when the same bad
         * column merely moves position. Stripping `[0]`/`[1]` keeps the part
         * that says WHICH PROPERTY while discarding the part that only says
         * where in the array: details like `property getter threw while
         * compiling` are column-invariant and position-only, so `columnId` +
         * `detail` alone cannot tell two such faults apart.
         *
         * `detail` and `path` are both required constructor parameters of
         * `CompiledQueryValidationError`; only `columnId` is optional (absent
         * on non-column failures). The fallbacks below are not dead code
         * anyway: detection here is a duck-typed `error.name` check, so a
         * foreign error carrying that name reaches this line with neither
         * field.
         */
        const validationError = error as Error & {
          readonly columnId?: string;
          readonly detail?: string;
          readonly path?: string;
        };
        const columnId = validationError.columnId;
        const detail = validationError.detail ?? validationError.message;
        const path = validationError.path ?? "(unknown location)";
        warnOnce(
          `derivations-rejected:${columnId ?? "(no column)"}:${path.replace(
            /\[\d+\]/g,
            "[]",
          )}:${detail}`,
          "[pretable] A derivations update was rejected as invalid" +
            (columnId === undefined ? "" : ` on column "${columnId}"`) +
            ` at ${path}: ${detail}. The grid kept its previous derivations, ` +
            "so the values it shows are the ones from before this update. " +
            "Correct the column definition, or drop the change.",
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
        const transition = rowModel.setQuery(desiredQuery);
        void transition.finished.catch(() => undefined);
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
