import {
  createColumnHelper,
  createLocalRowModel,
  type PretableGroupId,
  type PretableQueryFor,
} from "@pretable/core";
import {
  PretableSurface,
  usePretable,
  type PretableRowChange,
  type PretableSurfaceFocusState,
  type PretableSurfaceRowsProps,
} from "@pretable/react";
import type { Equal, Expect, IsAny } from "../shared/assert";

interface Holding {
  id: number;
  symbol: string;
  quantity: number;
}

const column = createColumnHelper<Holding>();
const columns = [
  column.accessor("symbol", { type: "text" }),
  column.accessor("quantity", { type: "number" }),
] as const;
const rows: readonly Holding[] = [{ id: 1, symbol: "PRE", quantity: 10 }];
const query: PretableQueryFor<typeof columns> = {
  filters: [],
  sort: [],
  rowGroups: [],
};

const rowsMode = usePretable({
  rows,
  columns,
  viewportHeight: 320,
  onRowChange(change) {
    const rowId: number = change.rowId;
    const columnId: "symbol" | "quantity" = change.columnId;
    const previous: Holding = change.previousRow;
    const proposed: Holding = change.row;
    const changes: Partial<Holding> = change.changes;
    void [rowId, columnId, previous, proposed, changes];
  },
});
type _RowsModeId = Expect<
  Equal<
    Parameters<typeof rowsMode.rowModel.applyTransaction>[0]["remove"],
    readonly number[] | undefined
  >
>;
type _RowsChangeAny = Expect<
  Equal<IsAny<PretableRowChange<Holding, number, typeof columns>>, false>
>;

const controlled = usePretable({
  rows,
  columns,
  query,
  onQueryChange(next) {
    const typed: PretableQueryFor<typeof columns> = next;
    void typed;
  },
  viewportHeight: 320,
});
void controlled;

const surfaceProps: PretableSurfaceRowsProps<Holding, number, typeof columns> =
  {
    ariaLabel: "typed surface",
    columns,
    rows,
    getRowId: (row) => row.id,
    viewportHeight: 320,
    state: {
      focus: {
        ref: {
          kind: "group",
          groupId: "group_fixture" as PretableGroupId,
        },
        columnId: "__pretable_group__",
      },
      selection: {
        ranges: [
          {
            startRowId: 1,
            endRowId: 1,
            startColumnId: "__pretable_row_select__",
            endColumnId: "quantity",
          },
        ],
        anchor: { rowId: 1, columnId: "symbol" },
      },
    },
    onRowChange(change) {
      const rowId: number = change.rowId;
      if (change.columnId === "quantity") {
        const value: number = change.value;
        void value;
      }
      void rowId;
    },
    query,
    onQueryChange(next) {
      const columnId: "symbol" | "quantity" | undefined =
        next.sort[0]?.columnId;
      void columnId;
    },
    onFocusChange(focus) {
      const columnId:
        | "symbol"
        | "quantity"
        | "__pretable_group__"
        | "__pretable_row_select__"
        | null = focus.columnId;
      if (focus.ref?.kind === "data") {
        const rowId: number = focus.ref.rowId;
        void rowId;
      } else if (focus.ref?.kind === "group") {
        const groupId: PretableGroupId = focus.ref.groupId;
        void groupId;
      }
      void columnId;
    },
    onColumnOrderChange(order) {
      const columnId:
        | "symbol"
        | "quantity"
        | "__pretable_group__"
        | "__pretable_row_select__"
        | undefined = order[0];
      void columnId;
    },
    renderBodyCell(input) {
      const rowId: number = input.rowId;
      if (input.columnId === "quantity") {
        const value: number = input.value;
        void value;
      }
      void rowId;
      return null;
    },
  };
const surface = <PretableSurface {...surfaceProps} />;
void surface;

const surfaceMissingQueryChange = (
  // @ts-expect-error Surface controlled query requires onQueryChange
  <PretableSurface
    ariaLabel="bad"
    columns={columns}
    rows={rows}
    getRowId={(row: Holding) => row.id}
    query={query}
    viewportHeight={320}
  />
);
// Notify-only: the engine owns the query and reports changes. Legal since the
// uncontrolled arm made `onQueryChange` optional rather than forbidden — the
// `<input defaultValue onChange>` shape. The INVERSE (a `query` with no setter)
// is still rejected above, which is the controlled-component guarantee.
const surfaceObservedQuery = (
  <PretableSurface
    ariaLabel="bad"
    columns={columns}
    rows={rows}
    getRowId={(row: Holding) => row.id}
    onQueryChange={() => {}}
    viewportHeight={320}
  />
);
void [surfaceMissingQueryChange, surfaceObservedQuery];

const ambiguousSurfaceFocus: PretableSurfaceFocusState<number, typeof columns> =
  {
    // @ts-expect-error controlled surface focus requires a discriminated row ref
    rowId: 1,
    columnId: "symbol",
  };
void ambiguousSurfaceFocus;

// @ts-expect-error controlled query requires onQueryChange
usePretable({ rows, columns, query, viewportHeight: 320 });
// Notify-only is legal here too; the controlled case above still requires both.
usePretable({ rows, columns, onQueryChange: () => {}, viewportHeight: 320 });

const model = createLocalRowModel({ rows, columns });
const modelMode = usePretable({ model, viewportHeight: 320 });
const modelId: number = modelMode.rowModelSnapshot.dataRowAt(0)!.rowId;
void modelId;

usePretable({
  model,
  columns: [
    { id: "symbol", header: "Ticker", widthPx: 180 },
    { id: "quantity", header: "Quantity" },
  ],
  beforeRowChange(batch) {
    const first = batch[0];
    if (first) {
      const id: number = first.rowId;
      const row: Holding = first.row;
      void [id, row];
    }
  },
  viewportHeight: 320,
});

const modelSurface = (
  <PretableSurface
    ariaLabel="model surface"
    beforeRowChange={() => {}}
    model={model}
    viewportHeight={320}
  />
);
void modelSurface;

const modelSurfaceWithQuery = (
  <PretableSurface
    ariaLabel="bad"
    // @ts-expect-error explicit-model Surface owns query state
    model={model}
    query={query}
    onQueryChange={() => {}}
    viewportHeight={320}
  />
);
const rowsSurfaceWithBefore = (
  <PretableSurface
    ariaLabel="bad"
    // @ts-expect-error rows Surface emits proposals instead of beforeRowChange transactions
    beforeRowChange={() => {}}
    columns={columns}
    rows={rows}
    getRowId={(row: Holding) => row.id}
    viewportHeight={320}
  />
);
const modelSurfaceWithRowChange = (
  // @ts-expect-error model Surface commits transactions instead of onRowChange proposals
  <PretableSurface
    ariaLabel="bad"
    model={model}
    onRowChange={() => {}}
    viewportHeight={320}
  />
);
const modelSurfaceWithExpansion = (
  // @ts-expect-error model Surface cannot override model construction expansion
  <PretableSurface
    ariaLabel="bad"
    initialExpansion={{ kind: "expanded" }}
    model={model}
    viewportHeight={320}
  />
);
const modelSurfaceWithAggregation = (
  // @ts-expect-error model Surface cannot override model construction aggregation
  <PretableSurface
    aggregateFilteredRows
    ariaLabel="bad"
    model={model}
    viewportHeight={320}
  />
);
void [
  modelSurfaceWithQuery,
  rowsSurfaceWithBefore,
  modelSurfaceWithRowChange,
  modelSurfaceWithExpansion,
  modelSurfaceWithAggregation,
];

// @ts-expect-error rows and model ownership modes are mutually exclusive
usePretable({ model, rows, columns, viewportHeight: 320 });
// @ts-expect-error explicit-model mode owns query state
usePretable({ model, query, onQueryChange: () => {}, viewportHeight: 320 });
// @ts-expect-error rows mode emits proposals instead of beforeRowChange transactions
usePretable({ rows, columns, beforeRowChange: () => {}, viewportHeight: 320 });
// @ts-expect-error model mode commits transactions instead of onRowChange proposals
usePretable({ model, onRowChange: () => {}, viewportHeight: 320 });
usePretable({
  model,
  // @ts-expect-error presentation overrides cannot replace derivation accessors
  columns: [
    {
      id: "symbol",
      accessor: (row: Holding) => row.symbol.toLowerCase(),
    },
    { id: "quantity" },
  ],
  viewportHeight: 320,
});

interface ExternalIdRow {
  key: `holding_${number}`;
  value: string;
}
const externalColumn = createColumnHelper<ExternalIdRow>();
const externalColumns = [
  externalColumn.accessor("value", { type: "text" }),
] as const;
const explicitId = usePretable({
  rows: [{ key: "holding_1", value: "one" }],
  columns: externalColumns,
  getRowId: (row) => row.key,
  viewportHeight: 320,
});
const externalId: `holding_${number}` =
  explicitId.rowModelSnapshot.dataRowAt(0)!.rowId;
void externalId;

void (null as unknown as _RowsModeId);
void (null as unknown as _RowsChangeAny);
