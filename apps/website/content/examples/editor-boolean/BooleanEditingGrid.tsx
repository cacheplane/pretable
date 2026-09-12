"use client";

import { useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

interface Row {
  id: string;
  done: boolean;
}

const columns: PretableColumn<Row>[] = [
  {
    id: "done",
    header: "Done",
    type: "boolean",
    editable: true,
    widthPx: 240,
  },
];

export function BooleanEditingGrid() {
  const [rows, setRows] = useState<Row[]>([{ id: "task-1", done: false }]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Mark the launch review done: click the checkbox, or focus the cell and
        press Enter or Space. Each toggle saves immediately; toggle again to
        reverse it.
      </p>
      <PretableSurface
        ariaLabel="Task completion editing"
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
        aria-label="Saved completion"
        style={{ margin: "12px 0 0", fontSize: 13, overflowWrap: "anywhere" }}
      >
        Saved value: <code>{JSON.stringify(rows[0]?.done)}</code>
      </p>
    </div>
  );
}
