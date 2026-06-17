import { useMemo } from "react";
import { fmtCompactUsd, fmtSignedUsd, fmtPct } from "./format";
import type { PositionRow } from "./types";
import styles from "./portfolioSummary.module.css";
import { FilterSection } from "./sidebar/FilterSection";
import { SelectionSection } from "./sidebar/SelectionSection";
import type { FilterState } from "./filters";
import type { SelectionSummary } from "./selection";

export interface PortfolioSummaryProps {
  rows: readonly PositionRow[];
  filter: FilterState;
  onSearch: (value: string) => void;
  onSector: (value: string) => void;
  selection: SelectionSummary | null;
  copied: boolean;
}

const SECTOR_COLORS: Record<string, string> = {
  Technology: "#2563eb",
  "Health Care": "#1a8f50",
  Energy: "#b87800",
  Financials: "#8b5cf6",
  Consumer: "#0891b2",
};
const OTHER_COLOR = "#64748b";

interface Model {
  nav: number;
  dayPnl: number;
  dayPnlPct: number;
  sectors: Array<{ name: string; pct: number; color: string }>;
  alerts: Array<{ id: string; symbol: string; flag: PositionRow["flag"] }>;
}

function buildModel(rows: readonly PositionRow[]): Model {
  const nav = rows.reduce((s, r) => s + r.mktValue, 0);
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);
  const prevNav = nav - dayPnl;
  const dayPnlPct = prevNav > 0 ? (dayPnl / prevNav) * 100 : 0;

  const bySector = new Map<string, number>();
  for (const r of rows)
    bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + r.mktValue);
  const sectors = [...bySector.entries()]
    .map(([name, mkt]) => ({
      name,
      pct: nav > 0 ? (mkt / nav) * 100 : 0,
      color: SECTOR_COLORS[name] ?? OTHER_COLOR,
    }))
    .sort((a, b) => b.pct - a.pct);

  const alerts = rows
    .filter(
      (r) => (r.flag === "risk" || r.flag === "watch") && r.analyst.length > 0,
    )
    .map((r) => ({ id: r.id, symbol: r.symbol, flag: r.flag }));

  return { nav, dayPnl, dayPnlPct, sectors, alerts };
}

export function PortfolioSummary({
  rows,
  filter,
  onSearch,
  onSector,
  selection,
  copied,
}: PortfolioSummaryProps) {
  const model = useMemo(() => buildModel(rows), [rows]);

  return (
    <aside aria-label="Portfolio summary" className={styles.board}>
      <FilterSection
        search={filter.search}
        sector={filter.sector ?? "All"}
        onSearch={onSearch}
        onSector={onSector}
      />
      <SelectionSection summary={selection} copied={copied} />
      <section className={styles.section}>
        <span className={styles.label}>Net Asset Value</span>
        <span className={styles.nav} data-testid="summary-nav">
          {fmtCompactUsd(model.nav)}
        </span>
      </section>

      <section className={styles.section}>
        <span className={styles.label}>Day P&amp;L</span>
        <span
          className={`${styles.pnl} ${model.dayPnl >= 0 ? styles.up : styles.down}`}
          data-testid="summary-pnl"
        >
          {fmtSignedUsd(model.dayPnl)}{" "}
          <span style={{ fontSize: 11 }}>{fmtPct(model.dayPnlPct)}</span>
        </span>
      </section>

      {model.sectors.length > 0 && (
        <section className={styles.section}>
          <span className={styles.label}>Allocation</span>
          <div className={styles.alloc}>
            {model.sectors.map((s) => (
              <span
                key={s.name}
                style={{ width: `${s.pct}%`, background: s.color }}
              />
            ))}
          </div>
          <div className={styles.legend}>
            {model.sectors.map((s) => (
              <span key={s.name} className={styles.key}>
                <span className={styles.sw} style={{ background: s.color }} />
                {s.name} {s.pct.toFixed(0)}%
              </span>
            ))}
          </div>
        </section>
      )}

      {model.alerts.length > 0 && (
        <section className={styles.section}>
          <span className={styles.label}>AI Alerts</span>
          {model.alerts.map((a) => (
            <div
              className={styles.alert}
              data-testid="summary-alert"
              key={a.id}
            >
              <strong>{a.symbol}</strong>{" "}
              {a.flag === "risk" ? "flagged for review" : "on watch"}
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}
