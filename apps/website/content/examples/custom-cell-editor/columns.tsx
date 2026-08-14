import type { PretableColumn } from "@pretable/react";

import type { Task } from "./data";

const PRIORITY_LABEL: Record<number, string> = {
  1: "Low",
  2: "Medium",
  3: "High",
};

export const columns: PretableColumn<Task>[] = [
  { id: "title", header: "Title", editable: true, widthPx: 220 },
  {
    id: "priority",
    header: "Priority",
    editable: true,
    widthPx: 130,
    render: ({ row }) => PRIORITY_LABEL[row.priority] ?? String(row.priority),
    // The stored value is a number; a native <select> only ever hands back
    // strings on change, so formatEditValue seeds the draft as a string and
    // parseEditValue converts it back on commit.
    formatEditValue: (value) => String(value),
    parseEditValue: (raw) => Number(raw),
    renderEditor: ({ draft, setDraft, commit, cancel }) => (
      <select
        autoFocus
        value={String(draft ?? "")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
        }}
        onBlur={() => commit()}
      >
        <option value="1">Low</option>
        <option value="2">Medium</option>
        <option value="3">High</option>
      </select>
    ),
  },
];
