import {
  createColumnHelper,
  createLocalRowModel,
  type ColumnIdOf,
  type ColumnValueOf,
} from "@pretable/core";
import { usePretable, usePretableColumns } from "@pretable/react";
import type { Equal, Expect, IsAny } from "../shared/assert";

interface Position {
  id: string;
  symbol: string;
  quantity: number;
  price: number;
}

const column = createColumnHelper<Position>();
declare const multiplier: number;

const columns = usePretableColumns(
  () =>
    [
      column.accessor("symbol", { type: "text", editable: true }),
      column.accessor("quantity", { type: "number", editable: true }),
      column.accessor(
        "marketValue",
        (row) => row.quantity * row.price * multiplier,
        {
          type: "number",
          editable: true,
          setValue: ({ row, value }) => {
            const exactRow: Position = row;
            const exactValue: number = value;
            type _SetValueRowAny = Expect<Equal<IsAny<typeof row>, false>>;
            type _SetValueValueAny = Expect<Equal<IsAny<typeof value>, false>>;
            void (null as unknown as _SetValueRowAny);
            void (null as unknown as _SetValueValueAny);
            return {
              price: exactValue / exactRow.quantity / multiplier,
            };
          },
          render: ({ row, rowId, value }) => {
            const exactRow: Position = row;
            const exactRowId: string = rowId;
            const exactValue: number = value;
            type _RenderRowAny = Expect<Equal<IsAny<typeof row>, false>>;
            type _RenderValueAny = Expect<Equal<IsAny<typeof value>, false>>;
            void (null as unknown as _RenderRowAny);
            void (null as unknown as _RenderValueAny);
            return `${exactRow.id}:${exactRowId}:${exactValue}`;
          },
        },
      ),
    ] as const,
  [multiplier],
);

const renderProbe = usePretableColumns(
  () =>
    [
      column.accessor("symbol", {
        type: "text",
        render: ({ row, rowId, value }) => {
          const exactRow: Position = row;
          const exactRowId: string = rowId;
          const exactValue: string = value;
          return `${exactRow.id}:${exactRowId}:${exactValue}`;
        },
      }),
      column.accessor("notional", (row) => row.quantity * row.price, {
        type: "number",
        render: ({ row, rowId, value }) => {
          const exactRow: Position = row;
          const exactRowId: string = rowId;
          const exactValue: number = value;
          return `${exactRow.id}:${exactRowId}:${exactValue}`;
        },
      }),
    ] as const,
  [],
);
void renderProbe;

type _Ids = Expect<
  Equal<ColumnIdOf<typeof columns>, "symbol" | "quantity" | "marketValue">
>;
type _MarketValue = Expect<
  Equal<ColumnValueOf<typeof columns, "marketValue">, number>
>;
type _NoAny = Expect<
  Equal<IsAny<ColumnValueOf<typeof columns, "marketValue">>, false>
>;

usePretable({
  rows: [{ id: "p1", symbol: "PRE", quantity: 2, price: 10 }],
  columns,
  viewportHeight: 320,
});

const model = createLocalRowModel({
  rows: [{ id: "p1", symbol: "PRE", quantity: 2, price: 10 }],
  columns,
});
usePretable({
  model,
  columns: [
    { id: "symbol" },
    { id: "quantity" },
    {
      id: "marketValue",
      editable: true,
      setValue: ({ row, value }) => ({
        price: value / row.quantity / multiplier,
      }),
    },
  ],
  viewportHeight: 320,
});
usePretable({
  model,
  columns: [
    { id: "symbol" },
    { id: "quantity" },
    // @ts-expect-error editable computed presentation overrides require setValue
    { id: "marketValue", editable: true },
  ],
  viewportHeight: 320,
});

interface ExternalIdPosition {
  key: `position_${number}`;
  symbol: string;
}
const externalColumn = createColumnHelper<ExternalIdPosition>();
const externalColumns = [
  externalColumn.accessor("symbol", { type: "text" }),
] as const;
const externalModel = createLocalRowModel({
  rows: [{ key: "position_1", symbol: "PRE" }],
  columns: externalColumns,
  getRowId: (row) => row.key,
});
usePretable({
  model: externalModel,
  columns: [
    {
      id: "symbol",
      render: ({ row, rowId, value }) => {
        const exactRow: ExternalIdPosition = row;
        const exactRowId: `position_${number}` = rowId;
        const exactValue: string = value;
        return `${exactRow.symbol}:${exactRowId}:${exactValue}`;
      },
    },
  ],
  viewportHeight: 320,
});

const missingReverseMapping = [
  // @ts-expect-error editable computed accessors require setValue
  column.accessor("marketValue", (row) => row.quantity * row.price, {
    type: "number",
    editable: true,
  }),
] as const;
usePretable({ rows: [], columns: missingReverseMapping, viewportHeight: 320 });

const wrongField = usePretableColumns(
  () =>
    [
      column.accessor("marketValue", (row) => row.quantity * row.price, {
        type: "number",
        editable: true,
        setValue: ({ value }): Partial<Position> => ({
          // @ts-expect-error reverse patches may only contain row fields
          missing: value,
        }),
      }),
    ] as const,
  [],
);
void wrongField;

const wrongValue = usePretableColumns(
  () =>
    [
      column.accessor("marketValue", (row) => row.quantity * row.price, {
        type: "number",
        // @ts-expect-error reverse mapping must accept the accessor's number value
        editable: true,
        setValue: ({ row, value }: { row: Position; value: string }) => ({
          price: Number(value) / row.quantity,
        }),
      }),
    ] as const,
  [],
);
void wrongValue;

void (null as unknown as _Ids);
void (null as unknown as _MarketValue);
void (null as unknown as _NoAny);
