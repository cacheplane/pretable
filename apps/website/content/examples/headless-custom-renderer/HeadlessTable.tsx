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

  // snapshot.sort is an ordered PretableSortEntry[] (index = priority). This
  // renderer keeps a single-column asc → desc → none cycle, so it only ever
  // reads/writes one entry via setSort (which replaces the whole list).
  const toggleSort = (columnId: string) => {
    const current = snapshot.sort.find((entry) => entry.columnId === columnId);
    const next: PretableSortDirection =
      current === undefined
        ? "asc"
        : current.direction === "asc"
          ? "desc"
          : null;
    grid.setSort(next ? columnId : null, next);
  };

  return (
    <div>
      <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
        Filter by team{" "}
        <input
          aria-label="Filter by team"
          defaultValue=""
          onChange={(e) =>
            grid.setColumnFilter(
              "team",
              e.target.value
                ? { operator: "contains", value: e.target.value }
                : null,
            )
          }
        />
      </label>
      <table>
        <thead>
          <tr>
            {columns.map((c) => {
              const sortEntry = snapshot.sort.find(
                (entry) => entry.columnId === c.id,
              );
              return (
                <th key={c.id} scope="col">
                  {c.sortable ? (
                    <button type="button" onClick={() => toggleSort(c.id)}>
                      {c.header ?? c.id}
                      {sortEntry
                        ? sortEntry.direction === "asc"
                          ? " ▲"
                          : " ▼"
                        : ""}
                    </button>
                  ) : (
                    (c.header ?? c.id)
                  )}
                </th>
              );
            })}
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
