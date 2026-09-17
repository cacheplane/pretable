"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";

/** Fixture for `apps/website/e2e/scrolled-seam.spec.ts`; the rationale is there. */

type Row = { id: string; name: string; amount: number };

// 300 rows is >= 12,000px at the compact 40px floor against a 320px viewport,
// so the grid always scrolls. The amount formula is arbitrary but non-uniform.
const ROWS: Row[] = Array.from({ length: 300 }, (_, i) => ({
  id: `r${i}`,
  name: `Payment ${i}`,
  amount: (i * 37) % 5000,
}));

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Payment", type: "text", widthPx: 240 },
  { id: "amount", header: "Amount", type: "number", flex: 1, minWidthPx: 140 },
];

const getRowId = (row: Row) => row.id;

export default function ScrolledSeamFixture() {
  return (
    <main style={{ padding: 32 }}>
      <PretableSurface
        ariaLabel="Scrolled seam"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={getRowId}
        viewportHeight={320}
      />
    </main>
  );
}
