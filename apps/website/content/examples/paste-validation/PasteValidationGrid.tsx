"use client";

import { useId, useState } from "react";

import {
  PretableButton,
  PretableSurface,
  type PastePayload,
} from "@pretable/react";

import { columns } from "./columns";
import {
  correctedQuantities,
  initialInventory,
  mixedQuantities,
  type InventoryItem,
} from "./data";

export function PasteValidationGrid() {
  const clipboardId = useId();
  const [rows, setRows] = useState(initialInventory);
  const [sample, setSample] = useState(mixedQuantities);
  const [result, setResult] = useState<PastePayload<InventoryItem> | null>(
    null,
  );

  const reset = () => {
    setRows(initialInventory);
    setSample(mixedQuantities);
    setResult(null);
  };

  return (
    <div style={{ fontSize: 13 }}>
      <p style={{ margin: "0 0 12px" }}>
        Click the text box, select all with Cmd/Ctrl+A, then copy with
        Cmd/Ctrl+C. Click the first Quantity cell and press Cmd/Ctrl+V. In the
        initial sample, only 24 is valid; the other quantities stay unchanged.
      </p>
      <label
        htmlFor={clipboardId}
        style={{ display: "block", marginBottom: 4 }}
      >
        Quantities to paste
      </label>
      <textarea
        id={clipboardId}
        value={sample}
        onChange={(event) => setSample(event.target.value)}
        rows={3}
        spellCheck={false}
        style={{
          display: "block",
          width: "100%",
          boxSizing: "border-box",
          fontFamily: "monospace",
          fontSize: 13,
          resize: "vertical",
          border: "1px solid var(--pt-border-color, #888)",
          borderRadius: 4,
          padding: 8,
          marginBottom: 8,
        }}
      />
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}
      >
        <PretableButton onClick={() => setSample(correctedQuantities)}>
          Use corrected values
        </PretableButton>
        <PretableButton onClick={reset}>Reset example</PretableButton>
      </div>
      <p style={{ margin: "0 0 12px" }}>
        Use corrected values replaces the text above. Copy and paste again to
        apply it, or edit the text to try your own quantities.
      </p>
      <PretableSurface
        ariaLabel="Inventory quantities"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        toolPanel={false}
        viewportHeight={190}
        onPaste={(payload) => {
          const quantities = new Map<string, number>();
          for (const cell of payload.cells) {
            if (
              cell.columnId === "quantity" &&
              typeof cell.value === "number"
            ) {
              quantities.set(cell.rowId, cell.value);
            }
          }
          // Apply by id to current state: payload.row is a pre-validation snapshot.
          // Removed rows are ignored; rejected cells never enter this map.
          setRows((current) =>
            current.map((row) => {
              const quantity = quantities.get(row.id);
              return quantity === undefined ? row : { ...row, quantity };
            }),
          );
          setResult(payload);
        }}
        onRowChange={({ rowId, row }) => {
          setRows((current) =>
            current.map((item) =>
              item.id === rowId ? { ...item, quantity: row.quantity } : item,
            ),
          );
        }}
      />
      <p role="status" aria-label="Paste result" style={{ margin: "12px 0 0" }}>
        {result ? (
          <>
            {result.cells.length} accepted · {result.rejected.length} rejected.
            {result.clipped.rows > 0 || result.clipped.columns > 0
              ? ` Clipped ${result.clipped.rows} row(s) and ${result.clipped.columns} column(s).`
              : ""}
          </>
        ) : (
          "No paste yet."
        )}
      </p>
      {result && result.rejected.length > 0 ? (
        <ul
          aria-label="Rejected quantities"
          style={{
            margin: "8px 0 0",
            paddingLeft: 20,
            overflowWrap: "anywhere",
          }}
        >
          {result.rejected.map((cell) => (
            <li key={`${cell.rowId}:${cell.columnId}`}>
              {rows.find((row) => row.id === cell.rowId)?.product ?? cell.rowId}
              : “{cell.raw}” —{" "}
              {cell.message ??
                (cell.reason === "not-editable"
                  ? "This cell is read-only"
                  : "Invalid quantity")}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
