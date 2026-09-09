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
        Edit Priority for Draft proposal, choose High, and press Enter to see a
        rejected save. Choose Medium or Low to retry. Enter/Shift+Enter save
        down/up; Tab/Shift+Tab save right/left. Escape cancels before saving.
        Leaving the field saves in place.
      </p>
      <PretableSurface<Task>
        ariaLabel="Tasks"
        columns={columns}
        getRowId={(row) => row.id}
        rows={rows}
        viewportHeight={VIEWPORT_HEIGHT}
        onRowChange={async ({ rowId, columnId, row }) => {
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (columnId === "priority" && rowId === "t1" && row.priority === 3) {
            throw new Error("Choose Medium or Low for the proposal.");
          }
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
