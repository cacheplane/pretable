"use client";

import { useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

interface Row {
  id: string;
  due: string | null;
}

const columns: PretableColumn<Row>[] = [
  {
    id: "due",
    header: "Due date",
    type: "date",
    editable: true,
    widthPx: 240,
  },
];

export function DateEditingGrid() {
  const [rows, setRows] = useState<Row[]>([
    { id: "invoice-1", due: "2026-09-18" },
  ]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Double-click the invoice due date. Choose a day, or type YYYY-MM-DD and
        press Enter or Tab to save. Escape cancels. Try 2026-02-30 for an error,
        or clear the field to save null.
      </p>
      <PretableSurface
        ariaLabel="Invoice due date editing"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={340}
        toolPanel={false}
        onRowChange={({ rowId, row }) => {
          setRows((previous) =>
            previous.map((candidate) =>
              candidate.id === rowId ? row : candidate,
            ),
          );
        }}
      />
      <p
        role="status"
        aria-label="Saved due date"
        style={{ margin: "12px 0 0", fontSize: 13, overflowWrap: "anywhere" }}
      >
        Saved value: <code>{JSON.stringify(rows[0]?.due)}</code>
      </p>
    </div>
  );
}
