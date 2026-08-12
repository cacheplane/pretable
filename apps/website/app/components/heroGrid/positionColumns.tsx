import { createColumnHelper } from "@pretable/core";
import {
  PretableBadge,
  PretableDelta,
  PretableEntity,
  type PretableBadgeTone,
} from "@pretable/react";

import { fmtPrice, fmtSignedUsd, fmtPct, fmtCompactUsd } from "./format";
import { parseQty, sanityCheckQty, breachesGuardrail } from "./qty-edit";
import { computeNav } from "./positions-math";
import { QtyEditor } from "./QtyEditor";
import type { PositionFlag, PositionRow } from "./types";
import styles from "./cells.module.css";

/** What each analyst flag means in the shared semantic ramp. */
const FLAG_TONE: Record<PositionFlag, PretableBadgeTone> = {
  trim: "warning",
  watch: "warning",
  risk: "negative",
  hold: "positive",
};

const COMPLIANCE_DELAY_MS = 400;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
        <PretableEntity primary={row.symbol} secondary={row.name} />
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
      aggregate: "sum",
      setValue: ({ row, value }) => ({
        qty: value,
        mktValue: Math.round(value * row.last),
      }),
      type: "number",
      format: ({ value }) => value.toLocaleString("en-US"),
      formatAggregate: ({ value }) =>
        value === null ? "" : value.toLocaleString("en-US"),
      editable: true,
      parseEditValue: (raw) => parseQty(raw),
      validate: async (value, input) => {
        const sanity = sanityCheckQty(value, input.row.qty);
        if (sanity !== true) return sanity;
        await sleep(COMPLIANCE_DELAY_MS);
        const rows = deps.getRows();
        const newMktValue = value * input.row.last;
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
      aggregate: "sum",
      format: ({ value }) => fmtCompactUsd(value),
      formatAggregate: ({ value }) =>
        value === null ? "" : fmtCompactUsd(value),
    }),
    column.accessor("dayPnl", {
      header: "Day P&L",
      widthPx: 120,
      type: "number",
      aggregate: "sum",
      formatAggregate: ({ value }) =>
        value === null ? "" : fmtSignedUsd(value),
      render: ({ row }) => (
        <span className={styles.pnl}>
          <PretableDelta value={row.dayPnl}>
            {fmtSignedUsd(row.dayPnl)}
          </PretableDelta>
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
              <PretableBadge
                className={styles.analystFlag}
                tone={FLAG_TONE[row.flag]}
              >
                {row.flag}
              </PretableBadge>
            )}
          </span>
        ),
      }),
      sortable: false,
    },
  ] as const;
}
