import {
  createColumnHelper,
  createLocalRowModel,
  type PretableQueryFor,
} from "@pretable/core";
import {
  PretableSurface,
  usePretable,
  type PretableRowChange,
  type PretableSurfaceRowsProps,
} from "@pretable/react";
import type { Equal, Expect, IsAny } from "../shared/assert";

interface Holding {
  [key: string]: unknown;
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
    viewportHeight: 320,
    state: {
      focus: { rowId: 1, columnId: "__pretable_group__" },
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
    onCellEdit(edit) {
      if (edit.columnId === "symbol") {
        const value: string = edit.value;
        void value;
      }
    },
    onSortChange(sort) {
      const columnId: "symbol" | "quantity" | undefined = sort[0]?.columnId;
      void columnId;
    },
    onRowGroupsChange(groups) {
      const columnId: "symbol" | "quantity" | undefined = groups[0];
      void columnId;
    },
    onFocusChange(focus) {
      const columnId:
        | "symbol"
        | "quantity"
        | "__pretable_group__"
        | "__pretable_row_select__"
        | null = focus.columnId;
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

// @ts-expect-error controlled query requires onQueryChange
usePretable({ rows, columns, query, viewportHeight: 320 });
// @ts-expect-error onQueryChange requires controlled query
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
