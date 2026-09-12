"use client";

import { useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

interface Row {
  id: string;
  status: "queued" | "in_progress" | "done" | null;
}

const columns: PretableColumn<Row>[] = [
  {
    id: "status",
    header: "Status",
    type: "enum",
    options: [
      { value: "queued", label: "Queued" },
      { value: "in_progress", label: "In progress" },
      { value: "done", label: "Done" },
    ],
    editable: true,
    widthPx: 240,
  },
];

export function EnumEditingGrid() {
  const [rows, setRows] = useState<Row[]>([{ id: "task-1", status: "queued" }]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Double-click the launch-review status and choose In progress to save
        in_progress. Enter or Tab saves; Escape cancels. Try unknown for an
        error, or clear the field to save null.
      </p>
      <PretableSurface
        ariaLabel="Task status editing"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={220}
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
        aria-label="Saved task status"
        style={{ margin: "12px 0 0", fontSize: 13, overflowWrap: "anywhere" }}
      >
        Saved value: <code>{JSON.stringify(rows[0]?.status)}</code>
      </p>
    </div>
  );
}
