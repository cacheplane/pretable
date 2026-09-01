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
  useSyncExternalStore,
} from "react";

import type {
  PretablePresentationColumns,
  PretableReactColumns,
  PretableRowChange,
} from "./types";
import {
  compiledQueryGuard,
  EMPTY_REJECTED_WRITES,
  INVALID_QUERY_CODE,
  rejectedWriteEquals,
  reportRejectedWrite,
  rowModelCodeGuard,
  toRejectedWrite,
  type PretableRejectedWrite,
  type PretableRejectedWrites,
} from "./rejected-write";
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

/** One refused write: the value the model declined, and why. */
interface RejectedWriteSlot {
  /** The refused value's identity — the clear-on-recovery mechanism. */
  readonly refused: unknown;
  readonly fault: PretableRejectedWrite;
}

/**
 * What the surface needs to know about the last rows write, as one value.
 *
 * ONE OBJECT, not two channels, for the reason `WindowState` in
 * `pretable-model.ts` gives for its own pairing: the two facts are only ever
 * meaningful together, and a reader that could see them from different
 * instants would pair a window with rows it never described.
 */
interface RowsWriteState {
  /**
   * The `rows` array the row model REFUSED, or `null` when the last write
   * landed.
   *
   * THE ARRAY, NOT A BOOLEAN, and the difference is a measured one. A bare
   * "the last write was rejected" bit is still set during the render that
   * RECOVERS — a valid array has arrived, but this store is only updated in
   * the layout effect that follows — so the surface would count the model for
   * that render and compare the new query's total against the old query's row
   * count. That is precisely the one-render skew `pretable-surface.tsx`'s
   * `loadedRowCount` comment exists to prevent: measured on a narrowing
   * recovery (three rows of three, rejected, then two rows of two), the bit
   * produced a spurious `result-meta-total-below-loaded` warning, which
   * `warnOnce` then LATCHED, disarming the check for the rest of the session.
   * An identity answers the question the surface actually has — "is the array
   * I am rendering the one that was refused?" — for which a newly arrived
   * array is correctly a "no".
   */
  readonly rejectedRows: unknown;
  /**
   * `resultMeta.window.start` as it stood when the rows the model CURRENTLY
   * HOLDS were accepted — the other half of the last coherent
   * `(rows, window)` pair.
   *
   * A rejected write changes nothing in the model, so the window that landed
   * alongside the rows on screen is still exactly right for them. Retaining it
   * is what lets the surface keep announcing those rows at their true dataset
   * positions. Both alternatives are false claims, not silences: reading the
   * window LIVE relocates the kept rows into the incoming window, and dropping
   * the window entirely relocates them to the head of the dataset, which is
   * indistinguishable from the truth only when the old window happened to
   * start at 0.
   *
   * Updated on every render whose `rows` prop is NOT the refused one, so a
   * `resultMeta`-only update — legal, and pinned by "windowGap telemetry
   * refreshes from a resultMeta-only update" — is captured too.
   */
  readonly coherentWindowStart: number | undefined;
  /** The rows fault paired with `rejectedRows`; null when the last rows write landed. */
  readonly rowsFault: PretableRejectedWrite | null;
  readonly derivations: RejectedWriteSlot | null;
  readonly query: RejectedWriteSlot | null;
}

/**
 * Slot normalization for `publish`: preserve the previous slot's identity
 * whenever the next one is field-equal, so a no-op republish neither notifies
 * subscribers nor hands the derived-record memo a fresh fault identity.
 */
function slotOrPrevious(
  previous: RejectedWriteSlot | null,
  next: RejectedWriteSlot | null,
): RejectedWriteSlot | null {
  if (previous === next) return previous;
  if (previous === null || next === null) return next;
  return previous.refused === next.refused &&
    rejectedWriteEquals(previous.fault, next.fault)
    ? previous
    : next;
}

/**
 * Holds {@link RowsWriteState} and notifies, so it can be read during render.
 *
 * A NOTIFYING STORE read through `useSyncExternalStore`, not a `useState` the
 * layout effect below sets. A rejection is an event from an external system —
 * the row model declined a write — which is the shape
 * `react-hooks/set-state-in-effect` names as the alternative to setState in an
 * effect body, and `createAutoWidthStore` in `pretable-model.ts` is this
 * package's established precedent for it.
 *
 * That rule is on as an error through `reactHooks.configs.recommended.rules`,
 * but do NOT read this as "the lint gate forced the store". Measured: the
 * `useState` variant of this code drew only an `exhaustive-deps` WARNING here
 * — the compiler-based rule bails on `usePretable`'s large layout effect — and
 * `pnpm lint` carries no `--max-warnings`, so it would have passed the gate.
 * The rule does fire on this shape in a smaller effect. The store is right on
 * precedent and on what the rule is aimed at, not on enforcement.
 *
 * The re-render is scheduled during commit, so it gets the same pre-paint
 * flush a layout-effect setState would and nothing on screen flashes.
 *
 * It DOES notify on ordinary updates, and the value-compare above is not what
 * prevents that: `coherentWindowStart` moves whenever a windowed consumer
 * pages, so a valid page change publishes a genuinely different pair. Measured
 * (one page change, external filter+sort): 1 notify for a windowed consumer, 0
 * for one publishing no `resultMeta.window`.
 *
 * That costs nothing, and the render count is the evidence rather than the
 * mechanism being argued from. Surface renders are IDENTICAL to `origin/main`
 * in both shapes — 3 at mount and 5 for a windowed page change, 3 and 4
 * non-windowed — because the re-render this schedules lands inside a commit
 * React is already flushing for the same prop change, and resolves to the same
 * values it would have anyway. What the compare does buy is a render that
 * changes NEITHER half publishing nothing at all.
 */
function createRowsWriteStore() {
  let snapshot: RowsWriteState = {
    rejectedRows: null,
    coherentWindowStart: undefined,
    rowsFault: null,
    derivations: null,
    query: null,
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /*
     * Value-compared before replacing, which is what makes it safe to call
     * from an effect that runs on EVERY render: an unchanged pair notifies
     * nobody, and `getSnapshot` keeps handing back one stable object, so
     * `useSyncExternalStore` never sees a snapshot that changes every read.
     */
    publish(next: RowsWriteState) {
      const rowsFault = rejectedWriteEquals(snapshot.rowsFault, next.rowsFault)
        ? snapshot.rowsFault
        : next.rowsFault;
      const derivations = slotOrPrevious(
        snapshot.derivations,
        next.derivations,
      );
      const query = slotOrPrevious(snapshot.query, next.query);
      if (
        snapshot.rejectedRows === next.rejectedRows &&
        snapshot.coherentWindowStart === next.coherentWindowStart &&
        snapshot.rowsFault === rowsFault &&
        snapshot.derivations === derivations &&
        snapshot.query === query
      ) {
        return;
      }
      snapshot = { ...next, rowsFault, derivations, query };
      for (const listener of Array.from(listeners)) listener();
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
        /**
         * `resultMeta.window.start` as of this render, handed in so the
         * rejection bookkeeping below can remember which window landed WITH
         * the rows the model now holds. Rows mode only; see
         * {@link RowsWriteState.coherentWindowStart}.
         */
        readonly ɵwindowStart?: number;
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
  /*
   * The last coherent `(rows, window)` pair, published to
   * `pretable-surface.tsx`. That file counts a rows-mode grid's records off
   * the `rows` PROP (see the comment on its `loadedRowCount`) and reads
   * `resultMeta.window` live — both correct only while writes land. A rejected
   * write breaks both: `lastRows` is deliberately not rolled back, so the gate
   * below stays shut, the update is never retried, and the divergence is
   * PERMANENT rather than lasting one render.
   *
   * Why a store rather than a `useState` the effect sets is on
   * {@link createRowsWriteStore}; what each half means is on
   * {@link RowsWriteState}.
   *
   * Cannot loop. `lastRows.current` is recorded before the throw, so the
   * re-render this schedules finds the gate shut, and `publish` value-compares
   * so the unchanged pair notifies nobody.
   */
  const [rowsWriteStore] = useState(createRowsWriteStore);
  const rowsWrite = useSyncExternalStore(
    rowsWriteStore.subscribe,
    rowsWriteStore.getSnapshot,
    // Server render: nothing has been written yet, so nothing was refused.
    rowsWriteStore.getSnapshot,
  );
  const ownRowsFault = rowsWrite.rowsFault;
  const ownDerivationsFault = rowsWrite.derivations?.fault ?? null;
  const ownQueryFault = rowsWrite.query?.fault ?? null;
  /*
   * Deps are the FAULTS, never the whole snapshot: `coherentWindowStart` moves
   * on every valid page change, and a record identity that moved with it would
   * fire `onRejectedWriteChange` on ordinary paging. `publish`'s slot
   * normalization is what makes these deps stable across no-op republishes.
   * (localSlots is added in Task 3; until then use EMPTY placeholders.)
   */
  const rejectedWrites = useMemo<PretableRejectedWrites>(() => {
    if (
      ownRowsFault === null &&
      ownDerivationsFault === null &&
      ownQueryFault === null
    ) {
      return EMPTY_REJECTED_WRITES;
    }
    return {
      rows: ownRowsFault,
      derivations: ownDerivationsFault,
      query: ownQueryFault,
    };
  }, [ownRowsFault, ownDerivationsFault, ownQueryFault]);
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
    /*
     * Read ONCE, before the write below can replace it: the "did this render's
     * array get refused" answer and the window that is coherent with the
     * model are two halves of one pair, and reading them at different instants
     * is what `RowsWriteState` exists to prevent.
     */
    const previousWrite = rowsWriteStore.getSnapshot();
    /*
     * Whether a write was ATTEMPTED this render, which is not the same as
     * whether one was rejected. This effect runs on every render; the gate
     * below opens only when `rows` changes identity. Without this distinction
     * every render after a rejection looks like "not rejected" and would clear
     * the record the surface is relying on.
     */
    let rowsWriteAttempted = false;
    let rejected = false;
    let rowsFault: PretableRejectedWrite | null = null;
    let derivationsFault: PretableRejectedWrite | null = null;
    const derivationsChanged = lastDerivations.current !== derivations;
    const controlledQueryChanged =
      lastControlledQuery.current !== rowsOptions.query;
    const rowsGuard = rowModelCodeGuard(
      "rows-rejected",
      ({ columnId, detail }) =>
        "[pretable] A rows update was rejected as invalid" +
        (columnId === undefined ? "" : ` on column "${columnId}"`) +
        /*
         * Trailing "." stripped so the sentence ends with exactly one.
         * Unlike the sibling guards, which interpolate an unpunctuated
         * `CompiledQueryValidationError.detail`, this guard's detail is
         * a row-model message and those are written as full sentences
         * (`row-store.ts:116` → `Duplicate row ID dup.`), which rendered
         * as `…Duplicate row ID dup.. The grid kept…`. Both shapes are
         * reachable through the code allowlist, so normalise rather than
         * assume: an unpunctuated detail still gets its period here.
         */
        `: ${detail.replace(/\.$/, "")}. The grid kept its previous rows, so it is showing ` +
        "data from before this update and the rows on screen no longer " +
        "match the ones you passed. Correct the rows, or drop the change.",
    );
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
      rowsWriteAttempted = true;
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
         * name, is documented on `rowModelCodeGuard` in `./rejected-write`.
         */
        const report = reportRejectedWrite(error, rowsGuard);
        rowsFault = toRejectedWrite(
          "rows",
          report.fault.code,
          report.message,
          report.fault.columnId,
        );
        /*
         * AFTER the report, never before: `reportRejectedWrite` RETHROWS
         * anything outside the guard's allowlist, so only a write that was
         * actually swallowed reaches this line. Recording a fault that
         * escapes the commit would claim a divergence for a grid React is
         * about to unmount anyway.
         */
        rejected = true;
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
         * a consumer would see a stale aggregate and nothing else. What
         * rethrows and how the warning is keyed are documented on
         * `reportRejectedWrite` in `./rejected-write`; acceptance is
         * per-guard, and this one's — by error NAME, unlike
         * `rowModelCodeGuard`'s by code — is documented on
         * `compiledQueryGuard` there.
         */
        const report = reportRejectedWrite(
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
        derivationsFault = toRejectedWrite(
          "derivations",
          INVALID_QUERY_CODE,
          report.message,
          report.fault.columnId,
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
    /*
     * The bookkeeping, OUTSIDE the rows-changed gate above so a
     * `resultMeta`-only update still refreshes the coherent window. It sits
     * BELOW the derivations block — still inside the same synchronous effect,
     * so that behaviour is unchanged — so ONE publish carries the rows fault,
     * the derivations fault and the query clear together.
     *
     * Clearing `rejectedRows` on the landing path is not what makes recovery
     * work — the surface compares identities, so a newly arrived array already
     * reads as "not the refused one". It is not behaviourally observable at
     * all; it is kept so a refused array (potentially a whole dataset) is not
     * retained for the life of the grid.
     */
    const rejectedRows = rowsWriteAttempted
      ? rejected
        ? rowsOptions.rows
        : null
      : previousWrite.rejectedRows;
    rowsWriteStore.publish({
      rejectedRows,
      rowsFault: rowsWriteAttempted ? rowsFault : previousWrite.rowsFault,
      /*
       * The window is coherent with the model except while the array on
       * screen is the refused one — which is exactly when the previous pair
       * must be held, because nothing about the model changed.
       */
      coherentWindowStart:
        rowsOptions.rows === rejectedRows
          ? previousWrite.coherentWindowStart
          : rowsOptions.ɵwindowStart,
      derivations: derivationsChanged
        ? derivationsFault === null
          ? null
          : { refused: derivations, fault: derivationsFault }
        : previousWrite.derivations,
      // A changed controlled query is a new "last requested": the old refusal no
      // longer describes it. A rejection of the NEW query re-publishes from
      // applyQuery below (sync or from the .then chain), generation-gated so a
      // stale rejection never lands against a newer query.
      query: controlledQueryChanged ? null : previousWrite.query,
    });
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
        /*
         * A STALE `applyQuery` — superseded by a newer query — returns here
         * and publishes nothing at all, which is what guarantees a stale
         * rejection never lands against a newer query's record.
         */
        if (queryReconciliationGeneration.current !== generation) return;
        const queryGuard = compiledQueryGuard(
          "query-rejected",
          ({ columnId, detail, path }) =>
            "[pretable] A query update was rejected as invalid" +
            (columnId === undefined ? "" : ` on column "${columnId}"`) +
            ` at ${path}: ${detail}. The grid kept its previous query, so ` +
            "the rows it shows are the ones from before this update. " +
            "Correct the query, or drop the change.",
        );
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
           * The mechanism is documented on `reportRejectedWrite` in
           * `./rejected-write`.
           */
          const report = reportRejectedWrite(error, queryGuard);
          /*
           * Read-modify-write rather than a value carried from the effect
           * body: on the chained path the effect's own publish has long since
           * landed, so the snapshot is the only truthful base to write over.
           */
          rowsWriteStore.publish({
            ...rowsWriteStore.getSnapshot(),
            query: {
              refused: desiredQuery,
              fault: toRejectedWrite(
                "query",
                INVALID_QUERY_CODE,
                report.message,
                report.fault.columnId,
              ),
            },
          });
        }
        if (transition !== undefined) {
          /*
           * The clear on the LANDED path, and it is not redundant with the
           * `controlledQueryChanged` clear in the main publish: a query
           * rejected earlier can land LATER with the same identity, when a
           * derivations change re-runs `applyQuery` and the model now holds
           * the column the query names.
           */
          rowsWriteStore.publish({
            ...rowsWriteStore.getSnapshot(),
            query: null,
          });
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

  /*
   * INTERNAL, and reachable only through the `ɵ`-prefixed key: every public
   * overload of this hook is typed as `PretableModel`, which does not declare
   * it, so nothing in `react.api.md` moves. `pretable-surface.tsx` reads it
   * through the same cast it already uses for `setWindowState`.
   *
   * A spread rather than a mutation, and it costs no identity stability:
   * `usePretableModelInternal` already returns a fresh object literal on every
   * render (`pretable-model.ts`), so nothing downstream could have been
   * depending on this reference.
   */
  return { ...table, ɵrowsWrite: rowsWrite, rejectedWrites };
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
