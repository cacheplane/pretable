"use client";

import { useState, useSyncExternalStore } from "react";

import { createGrid, type PretableSortDirection } from "@pretable/core";

import { columns } from "./columns";
import { services } from "./data";

export function HeadlessTable() {
  // The engine is created once and owns all grid state.
  const [grid] = useState(() =>
    createGrid({ columns, rows: services, getRowId: (r) => r.id }),
  );

  // Subscribe the component to engine changes. getSnapshot is memoized by the
  // engine until the next mutation, so it is safe as the store snapshot.
  const snapshot = useSyncExternalStore(
    grid.subscribe,
    grid.getSnapshot,
    grid.getSnapshot,
  );

  // Each toggleRowSelection range is a single full-width row
  // (startRowId === endRowId), so selected ids read back directly.
  const selectedIds = new Set(
    snapshot.selection.ranges
      .filter((r) => r.startRowId === r.endRowId)
      .map((r) => r.startRowId),
  );

  const toggleSort = (columnId: string) => {
    const current = snapshot.sort;
    const next: PretableSortDirection =
      current.columnId !== columnId
        ? "asc"
        : current.direction === "asc"
          ? "desc"
          : current.direction === "desc"
            ? null
            : "asc";
    grid.setSort(next ? columnId : null, next);
  };

  return (
    <div>
      <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
        Filter by team{" "}
        <input
          aria-label="Filter by team"
          defaultValue=""
          onChange={(e) => grid.setFilter("team", e.target.value)}
        />
      </label>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col">
                {c.sortable ? (
                  <button type="button" onClick={() => toggleSort(c.id)}>
                    {c.header ?? c.id}
                    {snapshot.sort.columnId === c.id
                      ? snapshot.sort.direction === "asc"
                        ? " ▲"
                        : snapshot.sort.direction === "desc"
                          ? " ▼"
                          : ""
                      : ""}
                  </button>
                ) : (
                  (c.header ?? c.id)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot.visibleRows.map(({ id, row }) => (
            <tr
              key={id}
              aria-selected={selectedIds.has(id)}
              onClick={() => grid.toggleRowSelection(id)}
            >
              {columns.map((c) => (
                <td key={c.id}>{String(row[c.id as keyof typeof row])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
