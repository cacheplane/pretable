"use client";

import { useState } from "react";

import { PretableSurface } from "@pretable/react";

import { columns } from "./columns";
import { tasks, type Task } from "./data";

const VIEWPORT_HEIGHT = 220;

export function DarkModeToggleGrid() {
  const [dark, setDark] = useState(false);

  return (
    <div>
      <p style={{ margin: "0 0 8px", fontSize: 13 }}>
        The button below sets <code>data-theme=&quot;dark&quot;</code> on the
        wrapper <code>div</code>, not on <code>&lt;html&gt;</code> — a docs-site
        adaptation so this one grid goes dark without repainting the rest of the
        page. A real app toggles the attribute on <code>&lt;html&gt;</code>{" "}
        instead; that is the pattern this example is standing in for.
      </p>
      <button
        onClick={() => setDark((value) => !value)}
        style={{ marginBottom: 8 }}
        type="button"
      >
        Switch to {dark ? "light" : "dark"}
      </button>
      <div
        data-theme={dark ? "dark" : undefined}
        style={{
          background: "var(--pretable-bg-toolbar)",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <PretableSurface<Task>
          ariaLabel="Tasks"
          columns={columns}
          getRowId={(row) => row.id}
          rows={tasks}
          viewportHeight={VIEWPORT_HEIGHT}
        />
      </div>
    </div>
  );
}
