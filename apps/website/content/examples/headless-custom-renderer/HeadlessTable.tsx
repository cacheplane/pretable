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

  // Read `status` too, because a rebuild can FAIL. On `error` the model keeps
  // publishing the last snapshot that committed, so a renderer that ignores it
  // shows stale rows with nothing to say so.
  //
  // Select a STRING, for the same reason the snapshot is selected above: it is
  // `""` through every slice of a healthy rebuild, so the store bails out on
  // equality and this costs no extra render at all.
  //
  // Selecting the status object, or its `completedRows`/`totalRows`, would
  // re-render per slice. Even selecting `status.kind` is worse than it looks:
  // whether an intermediate `rebuilding` state is published before the rebuild
  // finishes depends on how the work sliced, so the render count becomes 1 or 2
  // run to run — measured here at 1 extra render in 6. That is why this example
  // reports failures but not progress. Show progress by putting it in its own
  // component, so a slice re-renders that and not the table.
  const readErrorText = useCallback(() => {
    const status = rowModel.getState().status;
    return status.kind === "error"
      ? `${status.error.code}: ${status.error.message}`
      : "";
  }, [rowModel]);
  const errorText = useSyncExternalStore(
    rowModel.subscribe,
    readErrorText,
    readErrorText,
  );

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
      {/* Two regions, never one element that switches `role`. A single <p>
          whose role flipped would be the SAME node after reconciliation —
          React would call setAttribute on it — and assistive tech generally
          does not re-map a node it has already exposed. */}
      <p role="status" style={{ fontSize: 13 }}>
        {snapshot.visibleRowCount} of {snapshot.sourceRowCount} rows
      </p>
      {errorText === "" ? null : (
        <p
          role="alert"
          style={{ fontSize: 13, color: "var(--pretable-text-error, #b3261e)" }}
        >
          Query failed ({errorText}). The rows below are from the last query
          that committed.
        </p>
      )}
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
