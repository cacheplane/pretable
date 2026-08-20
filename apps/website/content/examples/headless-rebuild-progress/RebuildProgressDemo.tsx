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
  // grouping change actually lands. `RebuildProgress` above is the one
  // re-rendering on every slice in the meantime.
  const readSnapshot = useCallback(
    () => rowModel.getState().snapshot,
    [rowModel],
  );
  const snapshot = useSyncExternalStore(
    rowModel.subscribe,
    readSnapshot,
    readSnapshot,
  );

  const [grouped, setGrouped] = useState(false);

  // A GROUPING change, not a filter or a sort: both of those settle
  // synchronously on ungrouped data (the sort fast path and the filter fast
  // path each require `rowGroups.length === 0`), so neither could
  // demonstrate the progress readout anymore. Grouping never takes a fast
  // path — it always rebuilds cooperatively — which is exactly why it is the
  // vehicle here.
  const toggleGrouped = () => {
    const next = !grouped;
    setGrouped(next);
    rowModel.setQuery({
      ...snapshot.query,
      rowGroups: next ? [{ columnId: "region" }] : [],
    });
  };

  return (
    <div>
      <button type="button" onClick={toggleGrouped}>
        {grouped
          ? "Ungroup"
          : `Group ${ORDER_COUNT.toLocaleString()} orders by region`}
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
            .map((entry) =>
              entry.kind === "data" ? (
                <tr key={entry.rowId}>
                  {columns.map((c) => (
                    <td key={c.id}>{String(c.accessor(entry.row))}</td>
                  ))}
                </tr>
              ) : (
                <tr key={entry.groupId}>
                  <td colSpan={columns.length}>
                    {String(entry.value)} ({entry.childCount})
                  </td>
                </tr>
              ),
            )}
        </tbody>
      </table>
    </div>
  );
}
