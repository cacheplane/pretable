"use client";

import { useRef, useState } from "react";

import { parseTsv, PretableSurface, type PastePayload } from "@pretable/react";

import { columns } from "./columns";
import { type Position, positions } from "./data";

const VIEWPORT_HEIGHT = 220;

// A 2x2 block: one cell writes it once; a 4-row x 2-col selection (an exact
// multiple) tiles it twice down; anchored past the last row clips it.
const CLIPBOARD_SAMPLE = "NVDA\t500\nMSFT\t200";

export function PasteGeometryGrid() {
  const [rows, setRows] = useState<Position[]>(positions);
  const [status, setStatus] = useState(
    "Copy the block, select a cell or range in the grid, and paste.",
  );

  // The surface listens for `paste` in the bubble phase, so a plain
  // onPaste on this wrapper would run AFTER the grid's own handler and see
  // an empty ref. onPasteCapture runs first — see docs/grid/paste#overflow.
  const clipboardText = useRef("");

  return (
    <div
      onPasteCapture={(event) => {
        clipboardText.current = event.clipboardData.getData("text/plain");
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        Select the block below, copy it, then click a cell or drag a range in
        the grid and paste. A single cell writes the block once; select{" "}
        <strong>Symbol + Qty across the first 4 rows</strong> (an exact multiple
        of the 2x2 block) to see it tile; anchor on the last row to see the
        overflow clipped, reported, and appended as a new row.
      </p>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <PretableSurface<Position>
            ariaLabel="Positions"
            columns={columns}
            getRowId={(row) => row.id}
            rows={rows}
            viewportHeight={VIEWPORT_HEIGHT}
            onPaste={({ cells, rejected, clipped }: PastePayload<Position>) => {
              const byRow = new Map<string, Partial<Position>>();
              for (const cell of cells) {
                byRow.set(cell.rowId, {
                  ...byRow.get(cell.rowId),
                  [cell.columnId]: cell.value,
                });
              }

              setRows((previous) => {
                let next = previous.map((row) =>
                  byRow.has(row.id) ? { ...row, ...byRow.get(row.id) } : row,
                );

                // Overflow-row-append recipe (docs/grid/paste#overflow-clips-and-reports).
                // `clipped.rows` counts TARGET rows dropped past the last row,
                // and this slice is only correct for an anchored (non-tiled)
                // paste. The clamp matters — a tiled paste can report MORE
                // clipped rows than the block itself has, and an unclamped
                // negative start would take the whole matrix instead of just
                // the overflow.
                if (clipped.rows > 0) {
                  const matrix = parseTsv(clipboardText.current);
                  const overflow = matrix.slice(
                    Math.max(0, matrix.length - clipped.rows),
                  );
                  next = [
                    ...next,
                    ...overflow.map((fields, i) => ({
                      id: `new-${Date.now()}-${i}`,
                      symbol: fields[0] ?? "",
                      qty: Number(fields[1] ?? 0),
                      price: 0,
                    })),
                  ];
                }

                return next;
              });

              const total = cells.length + rejected.length;
              const parts = [`Pasted ${cells.length} of ${total} cells`];
              if (rejected.length > 0) {
                parts.push(`${rejected.length} rejected`);
              }
              if (clipped.rows > 0 || clipped.columns > 0) {
                const bits: string[] = [];
                if (clipped.rows > 0) bits.push(`${clipped.rows} row(s)`);
                if (clipped.columns > 0)
                  bits.push(`${clipped.columns} column(s)`);
                parts.push(
                  `clipped ${bits.join(", ")}` +
                    (clipped.rows > 0 ? " (appended below)" : ""),
                );
              }
              setStatus(parts.join(" · ") + ".");
            }}
          />
        </div>
        <div style={{ flex: "0 0 190px" }}>
          <label
            htmlFor="paste-geometry-clipboard"
            style={{ display: "block", fontSize: 12, marginBottom: 4 }}
          >
            2x2 TSV block to copy
          </label>
          <textarea
            id="paste-geometry-clipboard"
            readOnly
            value={CLIPBOARD_SAMPLE}
            style={{
              width: "100%",
              height: 56,
              fontFamily: "monospace",
              fontSize: 13,
              resize: "none",
              boxSizing: "border-box",
            }}
          />
        </div>
      </div>
      <p style={{ margin: "8px 0 0", fontSize: 13 }} data-testid="paste-status">
        <code>{status}</code>
      </p>
    </div>
  );
}
