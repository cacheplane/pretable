"use client";

import {
  PretableSurface,
  type PretableColumn,
  type PretableSurfaceGrid,
} from "@pretable/react";
import { useMemo, useRef, useState } from "react";

/**
 * Test fixture for `apps/website/e2e/csv-export.spec.ts`.
 *
 * The serializer and the filename builder are covered exhaustively by unit
 * tests, and jsdom can assert that `saveFile` was called with the right bytes.
 * What jsdom cannot do is the part users actually experience: whether a real
 * browser accepts the synthetic `<a download>` click as a download at all,
 * whether it honours the filename we computed, and whether the bytes that
 * reach disk still carry the UTF-8 BOM and CRLF line endings once a `Blob`
 * URL has round-tripped through the download machinery.
 *
 * So this route deliberately leaves `saveFile` unset — `defaultSaveFile` is
 * the thing under test — and the spec reads the file Chromium wrote.
 *
 * Deliberately not part of the product surface; `app/fixtures/layout.tsx`
 * keeps it out of search engines.
 */

interface PositionRow {
  id: string;
  symbol: string;
  desk: string;
  note: string;
  qty: number;
}

const ROWS: PositionRow[] = [
  { id: "p1", symbol: "AAPL", desk: "Equity", note: "core", qty: 1200 },
  // A leading `=` is the formula vector; escaping must reach disk, not just
  // the serializer's return value.
  { id: "p2", symbol: "MSFT", desk: "Equity", note: "=1+1", qty: 800 },
  // A negative number must NOT be escaped — the Jira/MUI bug this design
  // exists to avoid. It is a real `number`, so it is exempt by JS type.
  { id: "p3", symbol: "NVDA", desk: "Equity", note: "hedge", qty: -450 },
  // A comma and a quote force RFC 4180 quoting; a non-ASCII character proves
  // the BOM and the encoding survive the Blob round trip.
  {
    id: "p4",
    symbol: "SAP",
    desk: "Macro",
    note: 'Frankfurt, "Größe"',
    qty: 300,
  },
];

const COLUMNS: PretableColumn<PositionRow>[] = [
  { id: "symbol", header: "Symbol", widthPx: 120 },
  { id: "desk", header: "Desk", widthPx: 140 },
  { id: "note", header: "Note", widthPx: 220 },
  { id: "qty", header: "Qty", type: "number", widthPx: 120 },
];

export default function CsvExportFixturePage() {
  const rows = useMemo(() => ROWS, []);
  const columns = useMemo(() => COLUMNS, []);
  const gridRef = useRef<PretableSurfaceGrid<
    PositionRow,
    string,
    readonly PretableColumn<PositionRow>[]
  > | null>(null);
  const [ready, setReady] = useState(false);

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ marginBottom: 12 }}>CSV export fixture</h1>
      <p>
        <button
          data-testid="export-all"
          disabled={!ready}
          onClick={() => gridRef.current?.exportCsv()}
          type="button"
        >
          Export
        </button>{" "}
        <button
          data-testid="export-selected"
          disabled={!ready}
          onClick={() => gridRef.current?.exportCsv({ onlySelected: true })}
          type="button"
        >
          Export selected
        </button>
      </p>
      <PretableSurface<PositionRow>
        ariaLabel="Positions"
        columns={columns}
        getRowId={(row) => row.id}
        onGridReady={(grid) => {
          gridRef.current = grid;
          setReady(true);
        }}
        rowSelectionColumn={{ enabled: true, headerCheckbox: true }}
        rows={rows}
        viewportHeight={300}
      />
    </main>
  );
}
