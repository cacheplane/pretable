"use client";

import { PretableSurface, type PretableColumn } from "@pretable/react";

/**
 * Fixture for `apps/website/e2e/scrolled-seam.spec.ts`.
 *
 * One tall grid on the house theme, enough rows to scroll. The spec reads the
 * header's computed box-shadow at rest and after a scroll; jsdom cannot make
 * that claim because it computes no box-shadow from a token that a data
 * attribute rule supplies.
 */

type Row = { id: string; name: string; amount: number };

const ROWS: Row[] = Array.from({ length: 300 }, (_, i) => ({
  id: `r${i}`,
  name: `Payment ${i}`,
  amount: (i * 37) % 5000,
}));

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Payment", type: "text", widthPx: 240 },
  { id: "amount", header: "Amount", type: "number", widthPx: 140 },
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
