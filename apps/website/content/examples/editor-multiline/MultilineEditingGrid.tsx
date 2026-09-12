"use client";

import { useState } from "react";
import { PretableSurface, type PretableColumn } from "@pretable/react";

interface Row {
  id: string;
  notes: string;
}

const columns: PretableColumn<Row>[] = [
  {
    id: "notes",
    header: "Handoff note",
    type: "text",
    wrap: true,
    editable: true,
    widthPx: 240,
  },
];

export function MultilineEditingGrid() {
  const [rows, setRows] = useState<Row[]>([
    {
      id: "handoff-1",
      notes: "Confirm the release window.\nSend the checklist to support.",
    },
  ]);

  return (
    <div>
      <p style={{ margin: "0 0 12px", fontSize: 13 }}>
        Double-click the handoff note. Enter adds a line; Cmd/Ctrl + Enter or
        Tab saves. Escape cancels. Saved JSON shows line breaks as{" "}
        <code>{"\\n"}</code>.
      </p>
      <PretableSurface
        ariaLabel="Handoff note editing"
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        viewportHeight={180}
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
        aria-label="Saved handoff note"
        style={{ margin: "12px 0 0", fontSize: 13, overflowWrap: "anywhere" }}
      >
        Saved value: <code>{JSON.stringify(rows[0]?.notes)}</code>
      </p>
    </div>
  );
}
