"use client";

import { useCallback, useSyncExternalStore } from "react";

import type { PretableRowModel } from "@pretable/core";

/**
 * Subscribes to `status` ONLY — never to `snapshot`. That isolation is the
 * whole point: a rebuild over 150,000 rows publishes dozens of slices, and
 * keeping this readout in its own component means each slice re-renders
 * this one paragraph, not the (much larger) table underneath it.
 *
 * Selecting a STRING keeps `useSyncExternalStore` cheap between slices —
 * see the note on the smaller custom-renderer example for why the object
 * itself, or even `status.kind` alone, would be the wrong thing to select.
 */
export function RebuildProgress<
  TRow extends object,
  TRowId extends string | number,
  TColumns,
>({ rowModel }: { rowModel: PretableRowModel<TRow, TRowId, TColumns> }) {
  const readProgressText = useCallback(() => {
    const { status } = rowModel.getState();
    if (status.kind !== "rebuilding") return status.kind;
    const pct =
      status.totalRows === 0
        ? 0
        : Math.min(
            100,
            Math.round((status.completedRows / status.totalRows) * 100),
          );
    return `rebuilding:${pct}`;
  }, [rowModel]);

  const progressText = useSyncExternalStore(
    rowModel.subscribe,
    readProgressText,
    readProgressText,
  );

  const label = progressText.startsWith("rebuilding:")
    ? `Rebuilding… ${progressText.slice("rebuilding:".length)}%`
    : progressText === "ready"
      ? "Ready."
      : progressText;

  return (
    <p role="status" aria-live="polite" style={{ fontSize: 13 }}>
      {label}
    </p>
  );
}
