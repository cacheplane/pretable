import type { PretableColumn } from "@pretable/react";

import type { StockRow } from "./types";

export const streamingColumns: PretableColumn<StockRow>[] = [
  {
    id: "symbol",
    header: "Symbol",
    widthPx: 80,
    getValue: (row: StockRow) => row.symbol,
  },
  {
    id: "name",
    header: "Name",
    widthPx: 200,
    getValue: (row: StockRow) => row.name,
  },
  {
    id: "last",
    header: "Last",
    widthPx: 100,
    getValue: (row: StockRow) => row.last,
  },
  {
    id: "change_pct",
    header: "Change",
    widthPx: 90,
    getValue: (row: StockRow) => row.change_pct,
  },
  {
    id: "volume",
    header: "Volume",
    widthPx: 100,
    getValue: (row: StockRow) => row.volume,
  },
  {
    id: "sector",
    header: "Sector",
    widthPx: 130,
    getValue: (row: StockRow) => row.sector,
  },
  {
    id: "last_update",
    header: "Time",
    widthPx: 90,
    getValue: (row: StockRow) => row.last_update,
  },
];
