import type { PretableColumn } from "@pretable/react";
import { fmtPrice, fmtSignedUsd, fmtPct, fmtCompactUsd } from "./format";
import type { PositionFlag, PositionRow } from "./types";
import styles from "./cells.module.css";

const PILL_CLASS: Record<PositionFlag, string> = {
  trim: styles.pillTrim,
  watch: styles.pillWatch,
  risk: styles.pillRisk,
  hold: styles.pillHold,
};

export const positionColumns: PretableColumn<PositionRow>[] = [
  {
    id: "symbol",
    header: "Symbol",
    widthPx: 150,
    pinned: "left",
    value: (row) => row.symbol,
    render: ({ row }) => (
      <span className={styles.symbol}>
        {row.symbol}
        <span className={styles.symbolSub}>{row.name}</span>
      </span>
    ),
  },
  {
    id: "qty",
    header: "Qty",
    widthPx: 90,
    value: (row) => row.qty,
    format: ({ value }) => (value as number).toLocaleString("en-US"),
  },
  {
    id: "last",
    header: "Last",
    widthPx: 96,
    value: (row) => row.last,
    render: ({ row }) => {
      const dirClass = row.lastDir === "up" ? styles.flashUp : row.lastDir === "down" ? styles.flashDown : "";
      return (
        <span className={styles.num}>
          {/* key on tickSeq so React remounts the span and the CSS flash restarts each tick */}
          <span key={row.tickSeq ?? 0} className={`${styles.flash} ${dirClass}`}>
            {fmtPrice(row.last)}
          </span>
        </span>
      );
    },
  },
  {
    id: "mktValue",
    header: "Mkt Val",
    widthPx: 96,
    value: (row) => row.mktValue,
    format: ({ value }) => fmtCompactUsd(value as number),
  },
  {
    id: "dayPnl",
    header: "Day P&L",
    widthPx: 120,
    value: (row) => row.dayPnl,
    render: ({ row }) => (
      <span className={`${styles.num} ${row.dayPnl >= 0 ? styles.up : styles.down}`}>
        {fmtSignedUsd(row.dayPnl)}
        <span className={styles.subline}>{fmtPct(row.dayPnlPct)}</span>
      </span>
    ),
  },
  {
    id: "weight",
    header: "Wt",
    widthPx: 64,
    value: (row) => row.weight,
    format: ({ value }) => `${(value as number).toFixed(1)}%`,
  },
  {
    id: "analyst",
    header: "AI Analyst",
    widthPx: 340,
    wrap: true,
    sortable: false,
    value: (row) => row.analyst,
    render: ({ row }) => (
      <span className={styles.analyst}>
        {row.analyst}
        {row.analyst.length > 0 && (
          <span className={`${styles.pill} ${PILL_CLASS[row.flag]}`}>{row.flag}</span>
        )}
      </span>
    ),
  },
];
