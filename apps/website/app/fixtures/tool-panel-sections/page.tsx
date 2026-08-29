"use client";

import {
  PretableSurface,
  type PretableColumn,
  type PretableToolPanelConfig,
  type PretableToolPanelSection,
} from "@pretable/react";
import { useMemo } from "react";

/**
 * Test fixture for the custom-section block of
 * `apps/website/e2e/tool-panel.spec.ts` (SP4).
 *
 * The unit suite proves the roster resolver and the descriptor plumbing in
 * jsdom; what only a real browser can prove is that a CONSUMER-authored pane
 * rides the shell's a11y contract — the rail stays one Tab stop, arrows reach
 * the custom tab, the pane's controls are ordinary Tab stops in DOM order,
 * forward-Tab from the last one leaves the panel, and Escape returns focus to
 * the rail tab. So this route ships the smallest grid that carries a
 * four-section roster: the three built-ins with a custom "notes" section
 * interleaved second.
 *
 * The e2e block pins the roster ORDER (`columns, notes, filters, grouping`)
 * and the notes pane's control roster (two buttons, then a text input) — keep
 * both in sync with the spec's comments when changing anything here.
 *
 * Deliberately not part of the product surface; `fixtures/layout.tsx` keeps
 * the route out of search engines.
 */

interface TradeRow {
  id: string;
  symbol: string;
  side: string;
  qty: number;
}

const ROWS: TradeRow[] = [
  { id: "t1", symbol: "AAPL", side: "Buy", qty: 100 },
  { id: "t2", symbol: "MSFT", side: "Sell", qty: 250 },
  { id: "t3", symbol: "NVDA", side: "Buy", qty: 75 },
  { id: "t4", symbol: "GOOG", side: "Sell", qty: 40 },
  { id: "t5", symbol: "AMZN", side: "Buy", qty: 300 },
];

const COLUMNS: PretableColumn<TradeRow>[] = [
  { id: "symbol", header: "Symbol" },
  { id: "side", header: "Side" },
  { id: "qty", header: "Qty", type: "number", widthPx: 120 },
];

function NotesIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height="16"
      stroke="currentColor"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width="16"
    >
      <rect height="12" rx="2" width="12" x="2" y="2" />
      <path d="M5 6h6M5 9h6M5 12h4" />
    </svg>
  );
}

/**
 * The custom section: a heading and three ordinary controls — two plain
 * buttons and a text input — enough surface for the e2e tab walk to tell
 * "ordinary stops in DOM order" from a trap or a skip.
 */
const NOTES_SECTION: PretableToolPanelSection = {
  id: "notes",
  icon: NotesIcon,
  label: "Notes",
  render: () => (
    <div style={{ display: "grid", gap: 8, padding: 4 }}>
      <h3 data-notes-heading style={{ fontSize: 13, margin: 0 }}>
        Trade notes
      </h3>
      <button data-notes-save type="button">
        Save note
      </button>
      <button data-notes-clear type="button">
        Clear note
      </button>
      <input
        aria-label="Note text"
        data-notes-input
        placeholder="Add a note"
        type="text"
      />
    </div>
  ),
};

export default function ToolPanelSectionsFixturePage() {
  const rows = useMemo(() => ROWS, []);
  const columns = useMemo(() => COLUMNS, []);
  const toolPanel = useMemo<PretableToolPanelConfig>(
    () => ({
      sections: ["columns", NOTES_SECTION, "filters", "grouping"],
    }),
    [],
  );
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>Tool-panel sections fixture</h1>
      {/* A focusable element BEFORE the grid, so the keyboard walk can park
          focus and prove the rail is reachable by Tab alone. */}
      <button data-fixture-tab-start style={{ marginBottom: 12 }} type="button">
        Before the grid
      </button>
      <PretableSurface<TradeRow>
        ariaLabel="Trades"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        toolPanel={toolPanel}
        viewportHeight={300}
      />
    </main>
  );
}
