"use client";

import { useState } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { tasks, type Task } from "./data";

const VIEWPORT_HEIGHT = 200;

export function CustomEditorGrid() {
  const [rows, setRows] = useState<Task[]>(tasks);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        <strong>Title</strong> uses the built-in text editor. Double-click (or
        press <kbd>Enter</kbd>) on a <strong>Priority</strong> cell to open the
        custom <code>renderEditor</code> below — a plain
        <code>{"<select>"}</code>, bridged to the numeric stored value by{" "}
        <code>formatEditValue</code> and <code>parseEditValue</code>.
      </p>
      <PretableSurface<Task>
        ariaLabel="Tasks"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        viewportHeight={VIEWPORT_HEIGHT}
        onRowChange={({ rowId, row }) => {
          setRows((previous) =>
            previous.map((candidate) =>
              candidate.id === rowId ? row : candidate,
            ),
          );
        }}
      />
    </div>
  );
}
