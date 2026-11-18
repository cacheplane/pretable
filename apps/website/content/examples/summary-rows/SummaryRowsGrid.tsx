"use client";

import { useState } from "react";
import { createColumnHelper, type PretableQueryFor } from "@pretable/core";
import { PretableSurface } from "@pretable/react";

type Delivery = { id: string; team: string; hours: number };
const column = createColumnHelper<Delivery>();
const columns = [
  column.accessor("team", { type: "text", header: "Team", widthPx: 230 }),
  column.accessor("hours", {
    type: "number",
    header: "Planned hours",
    aggregate: "sum",
    widthPx: 180,
    numberFormat: { maximumFractionDigits: 1 },
  }),
] as const;
const rows: readonly Delivery[] = [
  { id: "1", team: "Design", hours: 12 },
  { id: "2", team: "Engineering", hours: 28 },
  { id: "3", team: "Design", hours: 8 },
  { id: "4", team: "Support", hours: 16 },
];

export function SummaryRowsGrid() {
  const [query, setQuery] = useState<PretableQueryFor<typeof columns>>({
    filters: [],
    sort: [],
    rowGroups: [],
  });
  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Filter Team using its header funnel. Matching hours change; all input
        hours stay at 64. Group by Team and collapse a group: both totals stay
        the same. Summary rows remain below the scrollable data.
      </p>
      <PretableSurface
        ariaLabel="Delivery plan with matching and all input hours"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        query={query}
        onQueryChange={setQuery}
        groupPanel={{ enabled: true }}
        summaries={{
          filtered: { authority: "engine" },
          all: { authority: "engine" },
        }}
        viewportHeight={340}
      />
    </div>
  );
}
