"use client";

import { useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

interface Row {
  id: string;
  title: string;
}

const columns: PretableColumn<Row>[] = [
  {
    id: "title",
    header: "Task title",
    type: "text",
    editable: true,
    widthPx: 240,
  },
];

export function TextEditingGrid() {
  const [rows, setRows] = useState<Row[]>([
    { id: "task-1", title: "Review launch checklist" },
  ]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Double-click the task title to rename it. Enter or Tab saves; Escape
        cancels the draft.
      </p>
      <PretableSurface
        ariaLabel="Task title editing"
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
        aria-label="Saved task title"
        style={{ margin: "12px 0 0", fontSize: 13, overflowWrap: "anywhere" }}
      >
        Saved value: <code>{JSON.stringify(rows[0]?.title)}</code>
      </p>
    </div>
  );
}
