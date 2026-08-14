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
  // sort actually lands. `RebuildProgress` above is the one re-rendering on
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

  const [descending, setDescending] = useState(true);

  const resort = () => {
    const next = !descending;
    setDescending(next);
    rowModel.setQuery({
      ...snapshot.query,
      sort: [{ columnId: "amount", direction: next ? "desc" : "asc" }],
    });
  };

  return (
    <div>
      <button type="button" onClick={resort}>
        Sort {ORDER_COUNT.toLocaleString()} orders by amount,{" "}
        {descending ? "ascending" : "descending"}
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
