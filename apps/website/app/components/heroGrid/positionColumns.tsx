import { PretableBadge, PretableDelta, PretableEntity } from "@pretable/react";
import type {
  PretableBadgeTone,
  PretableColumn,
  PretableEditInput,
} from "@pretable/react";
import { fmtPrice, fmtSignedUsd, fmtPct, fmtCompactUsd } from "./format";
import { parseQty, sanityCheckQty, breachesGuardrail } from "./qty-edit";
import { computeNav } from "./positions-math";
import { QtyEditor } from "./QtyEditor";
import type { PositionFlag, PositionRow } from "./types";
import styles from "./cells.module.css";

/** What each analyst flag means, in the ramp's vocabulary rather than the
 *  site's own. `hold` is the only reassuring one; `trim` and `watch` are both
 *  "look at this", and `risk` is the one that is actually bad. */
const FLAG_TONE: Record<PositionFlag, PretableBadgeTone> = {
  trim: "warning",
  watch: "warning",
  risk: "negative",
  hold: "positive",
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
      type: "text",
      value: (row) => `${row.symbol} ${row.name}`,
      // The library's presentation, not a hand-rolled two-line stack. The old
      // one dimmed the company name with `opacity: 0.55`, which rendered it at
      // 3.88:1 — below AA, on every row of the pinned column. <PretableEntity>
      // subordinates the second line with --pretable-text-dim (7.72:1) and a
      // type size instead, which is the whole reason the library owns this
      // pattern rather than leaving each consumer to reinvent it.
      render: ({ row }) => (
        <PretableEntity primary={row.symbol} secondary={row.name} />
      ),
    },
    {
      id: "sector",
      header: "Sector",
      widthPx: 110,
      type: "enum",
      value: (row) => row.sector,
    },
    {
      id: "qty",
      header: "Qty",
      widthPx: 96,
      type: "number",
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
      type: "number",
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
      type: "number",
      value: (row) => row.mktValue,
      format: ({ value }) => fmtCompactUsd(value as number),
    },
    {
      id: "dayPnl",
      header: "Day P&L",
      widthPx: 120,
      type: "number",
      value: (row) => row.dayPnl,
      // The library's presentation, not a hand-rolled `.up`/`.down` pair: it
      // follows the active theme's semantic ramp, and it adds the direction
      // marker the hand-rolled version never had — the old one said "loss" in
      // red and nothing else, which is nothing at all to a reader who cannot
      // separate it from the green above it.
      // The delta wraps the FIGURE only; the percentage is a sibling below it.
      // See `.pnl` in cells.module.css for why the stack is not inside it.
      render: ({ row }) => (
        <span className={styles.pnl}>
          <PretableDelta value={row.dayPnl}>
            {fmtSignedUsd(row.dayPnl)}
          </PretableDelta>
          <span className={styles.subline}>{fmtPct(row.dayPnlPct)}</span>
        </span>
      ),
    },
    {
      id: "weight",
      header: "Wt",
      widthPx: 64,
      type: "number",
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
      // The flag is a <PretableBadge> now. The hand-rolled pill tinted its fill
      // with a 14% mix of its own text colour, which put every tone between
      // 3.89:1 and 4.24:1 — a tinted chip cannot reach AA at any usable tint,
      // because the tint moves the background toward the text. The library's
      // chip leaves the fill alone and carries the tone on the label.
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
    },
  ];
}
