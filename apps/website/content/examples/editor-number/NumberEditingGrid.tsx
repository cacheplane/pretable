"use client";

import { useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

interface Row {
  id: string;
  estimate: number | null;
}

const columns: PretableColumn<Row>[] = [
  {
    id: "estimate",
    header: "Estimate hours",
    type: "number",
    step: 0.5,
    editable: true,
    widthPx: 240,
  },
];

export function NumberEditingGrid() {
  const [rows, setRows] = useState<Row[]>([{ id: "task-1", estimate: 2 }]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Double-click the launch-review estimate. ArrowUp/Down steps by 0.5.
        Enter or Tab saves; Escape cancels. Try abc for an error, or clear the
        field to save null.
      </p>
      <PretableSurface
        ariaLabel="Estimate hours editing"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={150}
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
        aria-label="Saved estimate hours"
        style={{ margin: "12px 0 0", fontSize: 13, overflowWrap: "anywhere" }}
      >
        Saved value: <code>{JSON.stringify(rows[0]?.estimate)}</code>
      </p>
    </div>
  );
}
