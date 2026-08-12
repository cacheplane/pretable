"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import { createGrid, createLocalRowModel } from "@pretable/core";

import { columns } from "./columns";
import { services } from "./data";

type ColumnId = (typeof columns)[number]["id"];

export function HeadlessTable() {
  const [rowModel] = useState(() =>
    createLocalRowModel({ columns, rows: services }),
  );
  const [grid] = useState(() => createGrid({ columns, rowModel }));

  const rowModelState = useSyncExternalStore(
    rowModel.subscribe,
    rowModel.getState,
    rowModel.getState,
  );
  useSyncExternalStore(grid.subscribe, grid.getState, grid.getState);
  const snapshot = rowModelState.snapshot;

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
