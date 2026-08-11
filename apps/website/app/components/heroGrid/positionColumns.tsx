import { createColumnHelper } from "@pretable/core";
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

const column = createColumnHelper<PositionRow>();

export function makePositionColumns(deps: PositionColumnsDeps) {
  return [
    column.accessor("symbol", (row) => `${row.symbol} ${row.name}`, {
      header: "Symbol",
      widthPx: 150,
      pinned: "left",
      type: "text",
      render: ({ row }) => (
        <span className={styles.symbol}>
          {row.symbol}
          <span className={styles.symbolSub}>{row.name}</span>
        </span>
      ),
    }),
    column.accessor("sector", {
      header: "Sector",
      widthPx: 110,
      type: "enum",
    }),
    column.accessor("qty", {
      header: "Qty",
      widthPx: 96,
      setValue: ({ row, value }) => ({
        qty: value,
        mktValue: Math.round(value * row.last),
      }),
      type: "number",
      format: ({ value }) => value.toLocaleString("en-US"),
      editable: true,
      parseEditValue: (raw) => parseQty(raw),
      validate: async (value, input) => {
        const qty = value;
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
    }),
    column.accessor("last", {
      header: "Last",
      widthPx: 96,
      type: "number",
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
    }),
    column.accessor("mktValue", {
      header: "Mkt Val",
      widthPx: 96,
      type: "number",
      format: ({ value }) => fmtCompactUsd(value),
    }),
    column.accessor("dayPnl", {
      header: "Day P&L",
      widthPx: 120,
      type: "number",
      render: ({ row }) => (
        <span
          className={`${styles.num} ${row.dayPnl >= 0 ? styles.up : styles.down}`}
        >
          {fmtSignedUsd(row.dayPnl)}
          <span className={styles.subline}>{fmtPct(row.dayPnlPct)}</span>
        </span>
      ),
    }),
    column.accessor("weight", {
      header: "Wt",
      widthPx: 64,
      type: "number",
      format: ({ value }) => `${value.toFixed(1)}%`,
    }),
    {
      ...column.accessor("analyst", {
        header: "AI Analyst",
        widthPx: 320,
        wrap: true,
        type: "text",
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
      }),
      sortable: false,
    },
  ] as const;
}
