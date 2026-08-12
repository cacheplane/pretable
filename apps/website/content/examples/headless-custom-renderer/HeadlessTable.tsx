"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { createGrid, createLocalRowModel } from "@pretable/core";

import { columns } from "./columns";
import { services } from "./data";

type ColumnId = (typeof columns)[number]["id"];

export function HeadlessTable() {
  const [rowModel] = useState(() =>
    createLocalRowModel({ columns, rows: services }),
  );
  const [grid] = useState(() => createGrid({ columns, rowModel }));

  // Subscribe to the SNAPSHOT, not to the whole state. `setQuery` settles
  // cooperatively: while it rebuilds, the model publishes a fresh state object
  // per slice carrying `rebuilding` progress, and `snapshot` keeps pointing at
  // the current rows until the new ones swap in. Reading `getState` directly
  // would hand useSyncExternalStore a new identity on every slice and re-render
  // every row for no visual change; reading `.snapshot` bails out on identity
  // and renders once, when the result is ready. Read `getState().status`
  // instead when you want to show rebuild progress.
  const readSnapshot = useCallback(
    () => rowModel.getState().snapshot,
    [rowModel],
  );
  const snapshot = useSyncExternalStore(
    rowModel.subscribe,
    readSnapshot,
    readSnapshot,
  );
  useSyncExternalStore(grid.subscribe, grid.getState, grid.getState);

  useEffect(
    () => () => {
      grid.dispose();
      rowModel.dispose();
    },
    [grid, rowModel],
  );

  // Each toggleRowSelection range is a single full-width row
  // (startRowId === endRowId), so selected ids read back directly.
  const toggleSort = (columnId: ColumnId) => {
    const current = snapshot.query.sort.find(
      (entry) => entry.columnId === columnId,
    );
    const next =
      current === undefined
        ? "asc"
        : current.direction === "asc"
          ? "desc"
          : null;
    rowModel.setQuery({
      ...snapshot.query,
      sort: next ? [{ columnId, direction: next }] : [],
    });
  };

  return (
    <div>
      <label style={{ display: "block", marginBottom: 8, fontSize: 13 }}>
        Filter by team{" "}
        <input
          aria-label="Filter by team"
          defaultValue=""
          onChange={(e) =>
            rowModel.setQuery({
              ...snapshot.query,
              filters: e.target.value
                ? [
                    {
                      columnId: "team",
                      operator: "contains",
                      value: e.target.value,
                    },
                  ]
                : [],
            })
          }
        />
      </label>
      <table>
        <thead>
          <tr>
            {columns.map((c) => {
              const sortEntry = snapshot.query.sort.find(
                (entry) => entry.columnId === c.id,
              );
              return (
                <th key={c.id} scope="col">
                  <button type="button" onClick={() => toggleSort(c.id)}>
                    {c.header ?? c.id}
                    {sortEntry
                      ? sortEntry.direction === "asc"
                        ? " ▲"
                        : " ▼"
                      : ""}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {snapshot
            .range(0, snapshot.visibleRowCount)
            .filter((entry) => entry.kind === "data")
            .map(({ rowId, row }) => (
              <tr
                key={rowId}
                aria-selected={grid.isRowSelected(rowId)}
                onClick={() => grid.toggleRowSelection(rowId)}
              >
                {columns.map((c) => (
                  <td key={c.id}>{String(c.accessor(row))}</td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
