"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";
import { useMemo, useState, type ComponentProps } from "react";

/**
 * Test fixture for `apps/website/e2e/grouping.spec.ts`.
 *
 * jsdom has no layout engine, so every pixel claim about row grouping — the
 * depth indent above all — is only verified by a real browser. This route is
 * the smallest grouped grid those assertions can measure: two grouping levels
 * (so depth 0 and depth 1 both exist on screen at once) and enough rows to
 * overflow the viewport (so collapsing near the bottom can strand `scrollTop`
 * past the shrunken `scrollHeight`).
 *
 * SP3 adds the group panel to it, for the same reason. The panel's drop-zone
 * disambiguation is a comparison of the pointer against two RECTANGLES — the
 * panel's and the header row's — which jsdom cannot express at all, so the
 * unit suite mocks the hit test and this route is the only place the geometry
 * is exercised. `region` is here purely so there is an ungrouped column to drag
 * onto the panel that no other assertion depends on the position of; `name` and
 * `qty` stay free for the header-row reorder assertion.
 *
 * Deliberately not part of the product surface. Kept out of search engines so
 * the fixture can stay optimized for browser-level geometry assertions.
 */

interface HoldingRow {
  id: string;
  sector: string;
  industry: string;
  region: string;
  name: string;
  qty: number;
}

const SECTOR_COUNT = 10;
const INDUSTRIES_PER_SECTOR = 4;
const ROWS_PER_INDUSTRY = 5;

function makeRows(): HoldingRow[] {
  const rows: HoldingRow[] = [];
  for (let s = 1; s <= SECTOR_COUNT; s += 1) {
    for (let i = 1; i <= INDUSTRIES_PER_SECTOR; i += 1) {
      for (let r = 1; r <= ROWS_PER_INDUSTRY; r += 1) {
        rows.push({
          id: `s${s}-i${i}-r${r}`,
          sector: `Sector ${String(s).padStart(2, "0")}`,
          industry: `Industry ${String(s).padStart(2, "0")}-${i}`,
          region: s <= SECTOR_COUNT / 2 ? "West" : "East",
          name: `Holding ${String(s).padStart(2, "0")}-${i}-${r}`,
          qty: s * 100 + i * 10 + r,
        });
      }
    }
  }
  return rows;
}

const COLUMNS: PretableColumn<HoldingRow>[] = [
  { id: "sector", header: "Sector" },
  { id: "industry", header: "Industry" },
  { id: "region", header: "Region", widthPx: 140 },
  { id: "name", header: "Name", widthPx: 220 },
  {
    id: "qty",
    header: "Qty",
    type: "number",
    widthPx: 120,
    aggregate: "sum",
    formatAggregate: ({ value }) => `Σ ${String(value)}`,
  },
];

export default function GroupingFixturePage() {
  const rows = useMemo(() => makeRows(), []);
  const columns = useMemo(() => COLUMNS, []);
  const [query, setQuery] = useState<
    NonNullable<ComponentProps<typeof PretableSurface<HoldingRow>>["query"]>
  >({
    filters: [],
    sort: [],
    rowGroups: [{ columnId: "sector" }, { columnId: "industry" }],
  });
  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>Grouping fixture</h1>
      <PretableSurface<HoldingRow>
        ariaLabel="Grouped holdings"
        columns={columns}
        getRowId={(row) => row.id}
        groupPanel={{ enabled: true }}
        initialExpansion={{ kind: "expanded" }}
        query={query}
        onQueryChange={setQuery}
        rows={rows}
        viewportHeight={400}
      />
    </main>
  );
}
