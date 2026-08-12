import {
  createColumnHelper,
  createLocalRowModel,
  type ColumnIdOf,
  type ColumnValueOf,
  type PretableEditStatus,
} from "@pretable/core";
import { usePretable, usePretableColumns } from "@pretable/react";
import type { Equal, Expect, IsAny } from "../shared/assert";
import {
  precompiledDirectModel,
  type PrecompiledPosition,
} from "./precompiled-core-model";

interface Position {
  id: string;
  symbol: string;
  quantity: number;
  price: number;
}

const column = createColumnHelper<Position>();
declare const multiplier: number;

usePretable({
  model: precompiledDirectModel,
  columns: [
    {
      id: "price",
      editable: true,
      renderEditor: ({ row, rowId, value }) => {
        const exactRow: PrecompiledPosition = row;
        const exactRowId: string = rowId;
        const exactValue: number = value;
        return `${exactRow.id}:${exactRowId}:${exactValue}`;
      },
    },
  ],
  viewportHeight: 320,
});

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

const authoritativePresentationProbe = usePretableColumns(
  () =>
    [
      column.accessor("quantity", {
        type: "number",
        header: <span>Quantity</span>,
        editable: ({ row, rowId, columnId, value }) => {
          const exactRow: Position = row;
          const exactRowId: string = rowId;
          const exactColumnId: "quantity" = columnId;
          const exactValue: number = value;
          return (
            exactRow.id === exactRowId &&
            exactColumnId === "quantity" &&
            exactValue >= 0
          );
        },
        validate: (value, { row, rowId, columnId }) => {
          const exactValue: number = value;
          const exactRow: Position = row;
          const exactRowId: string = rowId;
          const exactColumnId: "quantity" = columnId;
          void [exactRow, exactRowId, exactColumnId];
          return exactValue >= 0 || "Quantity must be non-negative";
        },
        parseEditValue: (raw, { value }) => {
          const current: number = value;
          return Number(raw) || current;
        },
        formatEditValue: (value, { row }) => {
          const exactValue: number = value;
          const exactRow: Position = row;
          return `${exactRow.symbol}:${exactValue}`;
        },
        flex: 1,
        minWidthPx: 80,
        maxWidthPx: 320,
        pinned: "left",
        wrap: true,
        render: ({
          row,
          rowId,
          value,
          column,
          formattedValue,
          rowIndex,
          isFocused,
          isSelected,
          pinned,
        }) => {
          const exactRow: Position = row;
          const exactRowId: string = rowId;
          const exactValue: number = value;
          const exactColumnId: "quantity" = column.id;
          const exactFormatted: string = formattedValue;
          const exactIndex: number = rowIndex;
          const exactFocused: boolean = isFocused;
          const exactSelected: boolean = isSelected;
          const exactPinned: "left" | "right" | null = pinned;
          return `${exactRow.id}:${exactRowId}:${exactValue}:${exactColumnId}:${exactFormatted}:${exactIndex}:${exactFocused}:${exactSelected}:${exactPinned}`;
        },
        renderHeader: ({ column, label, sortDirection, isSorted, pinned }) => {
          const exactColumnId: "quantity" = column.id;
          const exactLabel: string = label;
          const exactSort: "asc" | "desc" | null = sortDirection;
          const exactSorted: boolean = isSorted;
          const exactPinned: "left" | "right" | null = pinned;
          return `${exactColumnId}:${exactLabel}:${exactSort}:${exactSorted}:${exactPinned}`;
        },
        renderEditor: ({
          row,
          rowId,
          columnId,
          value,
          draft,
          status,
          error,
          setDraft,
          commit,
          cancel,
          seededFromTyping,
        }) => {
          const exactRow: Position = row;
          const exactRowId: string = rowId;
          const exactColumnId: "quantity" = columnId;
          const exactValue: number = value;
          const exactDraft: number | string = draft;
          const exactStatus: PretableEditStatus = status;
          const exactError: string | undefined = error;
          const exactSeeded: boolean | undefined = seededFromTyping;
          setDraft(exactValue);
          setDraft(String(exactDraft));
          commit("down");
          cancel();
          // @ts-expect-error a numeric editor draft cannot become boolean
          setDraft(false);
          void [
            exactRow,
            exactRowId,
            exactColumnId,
            exactStatus,
            exactError,
            exactSeeded,
          ];
          return null;
        },
      }),
      column.accessor("notional", (row) => row.quantity * row.price, {
        type: "number",
        editable: true,
        setValue: ({ row, value }) => ({
          price: value / row.quantity,
        }),
        widthPx: 180,
        renderEditor: ({ row, rowId, columnId, value, draft, setDraft }) => {
          const exactRow: Position = row;
          const exactRowId: string = rowId;
          const exactColumnId: "notional" = columnId;
          const exactValue: number = value;
          const exactDraft: number | string = draft;
          setDraft(exactValue);
          void [exactRow, exactRowId, exactColumnId, exactDraft];
          return null;
        },
      }),
    ] as const,
  [],
);
void authoritativePresentationProbe;

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
    {
      id: "marketValue",
      editable: true,
      setValue: ({ row, value }) => ({
        price: value / row.quantity / multiplier,
      }),
      renderEditor: ({ row, rowId, columnId, value, draft, setDraft }) => {
        const exactRow: Position = row;
        const exactRowId: string = rowId;
        const exactColumnId: "marketValue" = columnId;
        const exactValue: number = value;
        const exactDraft: number | string = draft;
        setDraft(exactValue);
        void [exactRow, exactRowId, exactColumnId, exactDraft];
        return null;
      },
    },
    { id: "quantity" },
    { id: "symbol" },
  ],
  viewportHeight: 320,
});
usePretable({
  model,
  // @ts-expect-error editable computed presentation overrides require setValue
  columns: [
    { id: "symbol" },
    { id: "quantity" },
    { id: "marketValue", editable: true },
  ],
  viewportHeight: 320,
});
usePretable({
  model,
  // @ts-expect-error presentation tuples must contain every schema ID exactly once
  columns: [{ id: "symbol" }, { id: "quantity" }, { id: "quantity" }],
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
      renderHeader: ({ column, label, sortDirection, isSorted, pinned }) => {
        const exactColumnId: "symbol" = column.id;
        const exactLabel: string = label;
        const exactSort: "asc" | "desc" | null = sortDirection;
        const exactSorted: boolean = isSorted;
        const exactPinned: "left" | "right" | null = pinned;
        return `${exactColumnId}:${exactLabel}:${exactSort}:${exactSorted}:${exactPinned}`;
      },
      renderEditor: ({ row, rowId, columnId, value, draft, setDraft }) => {
        const exactRow: ExternalIdPosition = row;
        const exactRowId: `position_${number}` = rowId;
        const exactColumnId: "symbol" = columnId;
        const exactValue: string = value;
        const exactDraft: string = draft;
        setDraft(exactValue);
        // @ts-expect-error string editors reject non-string drafts
        setDraft(1);
        void [exactRow, exactRowId, exactColumnId, exactDraft];
        return null;
      },
    },
  ],
  viewportHeight: 320,
});

const sameKeyComputed = column.accessor(
  "price",
  (row) => row.price * multiplier,
  { type: "number" },
);
usePretable({
  // @ts-expect-error a same-key functional accessor still requires setValue
  rows: [{ id: "p1", symbol: "PRE", quantity: 2, price: 10 }],
  // @ts-expect-error a same-key functional accessor still requires setValue
  columns: [{ ...sameKeyComputed, editable: true }] as const,
  viewportHeight: 320,
});
const sameKeyModel = createLocalRowModel({
  rows: [{ id: "p1", symbol: "PRE", quantity: 2, price: 10 }],
  columns: [sameKeyComputed] as const,
});
usePretable({
  model: sameKeyModel,
  // @ts-expect-error model overrides cannot edit same-key computed columns without setValue
  columns: [{ id: "price", editable: true }],
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
