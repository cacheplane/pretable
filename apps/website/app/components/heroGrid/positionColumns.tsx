import type { PretableColumn, PretableEditInput } from "@pretable/react";
import { fmtPrice, fmtSignedUsd, fmtPct, fmtCompactUsd } from "./format";
import { parseQty, sanityCheckQty, breachesGuardrail } from "./qty-edit";
import { computeNav } from "./positions-math";
import { QtyEditor } from "./QtyEditor";
import type { PositionFlag, PositionRow } from "./types";
import styles from "./cells.module.css";

const PILL_CLASS: Record<PositionFlag, string> = {
  trim: styles.pillTrim,
  watch: styles.pillWatch,
  risk: styles.pillRisk,
  hold: styles.pillHold,
};

const COMPLIANCE_DELAY_MS = 400;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PositionColumnsDeps {
  /** Live accessor to current rows, for NAV-aware guardrail validation. */
  getRows: () => readonly PositionRow[];
}

export function makePositionColumns(
  deps: PositionColumnsDeps,
): PretableColumn<PositionRow>[] {
  return [
    {
      id: "symbol",
      header: "Symbol",
      widthPx: 150,
      pinned: "left",
      filterType: "text",
      value: (row) => `${row.symbol} ${row.name}`,
      render: ({ row }) => (
        <span className={styles.symbol}>
          {row.symbol}
          <span className={styles.symbolSub}>{row.name}</span>
        </span>
      ),
    },
    {
      id: "sector",
      header: "Sector",
      widthPx: 110,
      filterType: "enum",
      value: (row) => row.sector,
    },
    {
      id: "qty",
      header: "Qty",
      widthPx: 96,
      value: (row) => row.qty,
      format: ({ value }) => (value as number).toLocaleString("en-US"),
      editable: true,
      parseEditValue: (raw) => parseQty(raw),
      validate: async (value, input: PretableEditInput<PositionRow>) => {
        const qty = value as number;
        const sanity = sanityCheckQty(qty, input.row.qty);
        if (sanity !== true) return sanity;
        await sleep(COMPLIANCE_DELAY_MS);
        const rows = deps.getRows();
        const newMktValue = qty * input.row.last;
        const otherMktValue = computeNav(rows) - input.row.mktValue;
        if (breachesGuardrail({ newMktValue, otherMktValue })) {
          return "Rejected: breaches 7% single-name guardrail";
        }
        return true;
      },
      renderEditor: (input) => <QtyEditor input={input} />,
    },
    {
      id: "last",
      header: "Last",
      widthPx: 96,
      value: (row) => row.last,
      render: ({ row }) => {
        const dirClass =
          row.lastDir === "up"
            ? styles.flashUp
            : row.lastDir === "down"
              ? styles.flashDown
              : "";
        return (
          <span className={styles.num}>
            <span
              key={row.tickSeq ?? 0}
              className={`${styles.flash} ${dirClass}`}
            >
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
        <span
          className={`${styles.num} ${row.dayPnl >= 0 ? styles.up : styles.down}`}
        >
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
      widthPx: 320,
      wrap: true,
      sortable: false,
      value: (row) => row.analyst,
      render: ({ row }) => (
        <span className={styles.analyst}>
          {row.analyst}
          {row.analyst.length > 0 && (
            <span className={`${styles.pill} ${PILL_CLASS[row.flag]}`}>
              {row.flag}
            </span>
          )}
        </span>
      ),
    },
  ];
}
