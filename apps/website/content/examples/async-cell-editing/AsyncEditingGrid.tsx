"use client";

import { useState } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { type StockItem, stockItems } from "./data";

const VIEWPORT_HEIGHT = 220;
// Every commit — success or rejection — pays this delay, so the field
// visibly sits in `saving` (dimmed, aria-busy) no matter which column you
// edit, not just the one that ends up rejected.
const COMMIT_DELAY_MS = 800;

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function AsyncEditingGrid() {
  const [rows, setRows] = useState<StockItem[]>(stockItems);
  const [status, setStatus] = useState(
    "Idle — commits take about 800ms, so you can watch a cell save.",
  );

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Edit <strong>Quantity</strong> to a negative number to see the rejection
        path: the field sits in <code>saving</code> for ~800ms, then{" "}
        <code>onRowChange</code> rejects it — an inline error appears, the
        editor stays open, and <kbd>Enter</kbd> retries.
      </p>
      <PretableSurface<StockItem>
        ariaLabel="Stock items"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        viewportHeight={VIEWPORT_HEIGHT}
        onRowChange={async ({ rowId, columnId, value, row }) => {
          setStatus(`Saving ${columnId}…`);
          await delay(COMMIT_DELAY_MS);
          if (
            columnId === "quantity" &&
            typeof value === "number" &&
            value < 0
          ) {
            setStatus(`Rejected: quantity can't go negative`);
            throw new Error("Quantity can't go negative");
          }
          setRows((previous) =>
            previous.map((candidate) =>
              candidate.id === rowId ? row : candidate,
            ),
          );
          setStatus(`Saved ${columnId} on ${rowId}`);
        }}
      />
      <p style={{ margin: "8px 0 0", fontSize: 13 }}>
        <code>{status}</code>
      </p>
    </div>
  );
}
