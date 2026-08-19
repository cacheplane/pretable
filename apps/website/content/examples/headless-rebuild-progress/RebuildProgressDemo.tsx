"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { createLocalRowModel } from "@pretable/core";
import { useDisposeOnUnmount } from "@pretable/react";

import { columns } from "./columns";
import { ORDER_COUNT, orders } from "./data";
import { RebuildProgress } from "./RebuildProgress";

const PREVIEW_ROWS = 8;

export function RebuildProgressDemo() {
  const [rowModel] = useState(() =>
    createLocalRowModel({ columns, rows: orders }),
  );
  useDisposeOnUnmount(rowModel);

  // Selecting `snapshot` (not the whole state) means this component bails
  // out on identity between rebuild slices — it only renders once, when the
  // filter actually lands. `RebuildProgress` above is the one re-rendering on
  // every slice in the meantime.
  const readSnapshot = useCallback(
    () => rowModel.getState().snapshot,
    [rowModel],
  );
  const snapshot = useSyncExternalStore(
    rowModel.subscribe,
    readSnapshot,
    readSnapshot,
  );

  const [filtered, setFiltered] = useState(false);

  // A FILTER change, not a sort: a sort-only change on ungrouped data
  // settles synchronously and never publishes a `rebuilding` phase, so it
  // could not demonstrate the progress readout at all.
  const toggleFilter = () => {
    const next = !filtered;
    setFiltered(next);
    rowModel.setQuery({
      ...snapshot.query,
      filters: next
        ? [{ columnId: "region", operator: "equals", value: "west" }]
        : [],
    });
  };

  return (
    <div>
      <button type="button" onClick={toggleFilter}>
        {filtered
          ? `Show all ${ORDER_COUNT.toLocaleString()} orders again`
          : `Filter ${ORDER_COUNT.toLocaleString()} orders to the west region`}
      </button>
      <RebuildProgress rowModel={rowModel} />
      <p style={{ fontSize: 13 }}>
        {snapshot.visibleRowCount.toLocaleString()} rows indexed — showing the
        first {PREVIEW_ROWS}
      </p>
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.id} scope="col">
                {c.header ?? c.id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {snapshot
            .range(0, Math.min(PREVIEW_ROWS, snapshot.visibleRowCount))
            .filter((entry) => entry.kind === "data")
            .map(({ rowId, row }) => (
              <tr key={rowId}>
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
