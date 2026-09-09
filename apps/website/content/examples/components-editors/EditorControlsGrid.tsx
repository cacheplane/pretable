"use client";

import { useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

import { AppIconButton, AppTextarea, AppTextInput } from "./EditorControls";
import "./editor-controls.css";

interface Item {
  id: string;
  name: string;
  quantity: number | null;
  notes: string;
}

const initialRows: Item[] = [
  {
    id: "notebook",
    name: "Notebook",
    quantity: 4,
    notes: "Dot grid\nRecycled paper",
  },
  { id: "pencil", name: "Pencil", quantity: 12, notes: "Pack of twelve" },
  { id: "folder", name: "Folder", quantity: 6, notes: "For project notes" },
];

const columns: PretableColumn<Item>[] = [
  { id: "name", header: "Name", editable: true, widthPx: 170 },
  {
    id: "quantity",
    header: "Quantity",
    type: "number",
    editable: true,
    widthPx: 150,
  },
  { id: "notes", header: "Notes", editable: true, wrap: true, widthPx: 270 },
];

export function EditorControlsGrid() {
  const [rows, setRows] = useState(initialRows);
  const [status, setStatus] = useState(
    "Ready to edit. Saves take about 800ms.",
  );

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Double-click a cell or select it and press <kbd>F2</kbd>. Try the
        Quantity stepper, then enter <strong>-1</strong> and press{" "}
        <kbd>Enter</kbd> to see a rejected save. Correct the value and press{" "}
        <kbd>Enter</kbd> again. In Notes, <kbd>Enter</kbd> adds a line;{" "}
        <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>Enter</kbd> saves.{" "}
        <kbd>Escape</kbd> cancels.
      </p>
      <PretableSurface
        ariaLabel="Inventory with custom editors"
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        viewportHeight={230}
        components={{
          TextInput: AppTextInput,
          Textarea: AppTextarea,
          IconButton: AppIconButton,
        }}
        onRowChange={async ({ rowId, columnId, value, row }) => {
          setStatus(`Saving ${columnId}…`);
          await new Promise<void>((resolve) => setTimeout(resolve, 800));
          if (
            columnId === "quantity" &&
            typeof value === "number" &&
            value < 0
          ) {
            setStatus(
              "Quantity rejected. Correct it and press Enter to retry.",
            );
            throw new Error("Quantity must be zero or greater");
          }
          setRows((current) =>
            current.map((item) => (item.id === rowId ? row : item)),
          );
          setStatus(`Saved ${columnId}.`);
        }}
      />
      <p role="status" style={{ margin: "8px 0 0", fontSize: 13 }}>
        {status}
      </p>
    </div>
  );
}
