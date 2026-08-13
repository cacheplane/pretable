import {
  createLocalRowModel,
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
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import type {
  PretablePresentationColumns,
  PretableReactColumns,
  PretableRowChange,
} from "./types";
import { type PretableModel, usePretableModelInternal } from "./pretable-model";

export type { PretableModel } from "./pretable-model";

type ModelSchemaColumn<TRow extends object = object> = {
  readonly id: string;
  readonly accessor: (row: TRow) => unknown;
  readonly value: (row: TRow) => unknown;
  readonly accessorKey?: string;
  readonly type?: unknown;
  readonly compare?: unknown;
  readonly aggregate?: unknown;
  readonly format?: unknown;
  readonly formatAggregate?: unknown;
};

type ModelPresentationColumn = {
  readonly id: string;
  readonly [key: string]: unknown;
};

/** @internal Test seam for presentation-only model column overlays. */
export function mergeModelPresentationColumnsForTesting<TRow extends object>(
  schemaColumns: readonly ModelSchemaColumn<TRow>[],
  presentationColumns: readonly ModelPresentationColumn[],
): readonly (ModelSchemaColumn<TRow> & ModelPresentationColumn)[] {
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
      aggregate: schema.aggregate,
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

/** Rows-mode options using the conventional `row.id`. @public */
export type UsePretableRowsOptions<TColumns> = PretableRowsModeBaseOptions<
  PretableRowForColumns<TColumns>,
  PretableConventionalRowId<PretableRowForColumns<TColumns>>,
  TColumns
> & {
  readonly getRowId?: undefined;
} & PretableQueryOptions<TColumns>;

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
        readonly ɵvisualColumns?:
          | readonly { readonly id: string }[]
          | ((query: PretableQueryFor<unknown>) => readonly {
              readonly id: string;
            }[]);
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

  useLayoutEffect(() => {
    if (mode !== "rows") return;
    const derivationsChanged = lastDerivations.current !== rowsOptions.columns;
    const controlledQueryChanged =
      lastControlledQuery.current !== rowsOptions.query;
    if (lastRows.current !== rowsOptions.rows) {
      lastRows.current = rowsOptions.rows;
      rowModel.setRows(rowsOptions.rows);
    }
    if (derivationsChanged) {
      lastDerivations.current = rowsOptions.columns;
      const transition = rowModel.setDerivations(
        rowsOptions.columns as unknown as PretableDerivationsFor<unknown>,
      );
      pendingDerivations.current = transition.finished;
      const clearPending = () => {
        if (pendingDerivations.current === transition.finished) {
          pendingDerivations.current = null;
        }
      };
      void transition.finished.then(clearPending, clearPending);
      void transition.finished.catch(() => undefined);
    }
    if (controlledQueryChanged) {
      lastControlledQuery.current = rowsOptions.query;
    }
    if (derivationsChanged || controlledQueryChanged) {
      queryReconciliationGeneration.current += 1;
    }
    if (
      (derivationsChanged || controlledQueryChanged) &&
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
            options.columns as readonly ModelPresentationColumn[],
          )
        : options.columns;
  return usePretableModelInternal({
    rowModel,
    columns: options.ɵvisualColumns ?? presentationColumns,
    viewportHeight: options.viewportHeight,
    viewportWidth: options.viewportWidth,
    overscan: options.overscan,
    onQueryChange:
      "onQueryChange" in options ? options.onQueryChange : undefined,
    allowVisualExtras: options.ɵvisualColumns !== undefined,
  });
}

export type {
  PretableSurfaceCellAddress,
  PretableSurfaceCellRange,
  PretableSurfaceColumnId,
  PretableSurfaceFocusState,
  PretableSurfaceInteractionColumnId,
  PretableSurfaceSelectionState,
  PretableSurfaceState,
  PretableTelemetry,
} from "./surface-types";
