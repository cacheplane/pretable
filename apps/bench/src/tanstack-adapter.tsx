import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type Table,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import type {
  ScenarioColumn,
  ScenarioDataset,
  ScenarioRow,
} from "@pretable-internal/scenario-data";

import type { ApplyBenchUpdates } from "./bench-runtime";
import type { BenchInteractionPlan } from "./interaction-plan";

const VIEWPORT_HEIGHT = 320;
const ROW_HEIGHT = 48;
const OVERSCAN = 4;

export interface TanstackAdapterProps {
  dataset: ScenarioDataset;
  onUpdateApiReady?: (apply: ApplyBenchUpdates) => void;
  /**
   * Accepted for harness uniformity but never invoked: TanStack Table is
   * headless and exposes no autosize API. The bench-runner returns
   * `unsupported` for autosize on tanstack before the adapter ever mounts.
   */
  onAutosizeReady?: (autosize: () => Promise<void> | void) => void;
  runKey: number;
  scriptName?: string;
  interactionPlan?: BenchInteractionPlan | null;
}

function toColumnDef(
  column: ScenarioColumn,
  scriptName: string | undefined,
  interactionMode: BenchInteractionPlan["mode"] | null,
): ColumnDef<ScenarioRow> {
  const def: ColumnDef<ScenarioRow> = {
    id: column.id,
    accessorKey: column.id,
    header: column.header ?? column.id,
    size: column.widthPx ?? 140,
    enableSorting: true,
    enableColumnFilter: true,
    // TanStack v8 default filterFn is "auto" which maps to includesString
    // for strings. filter-metadata uses equals semantics in the bench
    // plan (see interaction-plan.ts METADATA_FILTER), so set
    // equalsString explicitly when the plan is in that mode.
    filterFn: interactionMode === "filter-metadata" ? "equalsString" : "auto",
  };

  if (scriptName === "scroll-with-format") {
    def.cell = (info) => {
      const value = info.getValue();
      return Array.isArray(value) ? value.join(", ") : String(value ?? "");
    };
  } else if (scriptName === "scroll-with-render") {
    def.cell = (info) => (
      <span data-bench-render="cheap">{String(info.getValue() ?? "")}</span>
    );
  } else if (scriptName === "scroll-with-heavy-render") {
    def.cell = (info) => (
      <span data-bench-render="heavy" className="bench-status-badge">
        <span className="bench-badge-dot" aria-hidden />
        <span>{String(info.getValue() ?? "")}</span>
      </span>
    );
  }

  return def;
}

export function TanstackAdapter({
  dataset,
  onUpdateApiReady,
  runKey,
  scriptName,
  interactionPlan,
}: TanstackAdapterProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const onUpdateApiReadyRef = useRef(onUpdateApiReady);

  useEffect(() => {
    onUpdateApiReadyRef.current = onUpdateApiReady;
  }, [onUpdateApiReady]);

  const [data, setData] = useState<ScenarioRow[]>(() => dataset.rows.slice());
  const [sorting, setSorting] = useState<SortingState>([]);

  useEffect(() => {
    setData(dataset.rows.slice());
    setSorting([]);
  }, [dataset.rows, runKey]);

  const interactionMode = interactionPlan?.mode ?? null;
  const columns = useMemo(
    () =>
      dataset.columns.map((c) => toColumnDef(c, scriptName, interactionMode)),
    [dataset.columns, scriptName, interactionMode],
  );

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table's API is intentionally non-memoizable; this is the documented pattern.
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => String(row.id),
  });

  // useReactTable returns a fresh Table object each render. Mirror the
  // apiRef pattern from ag-grid/mui by syncing the latest table instance
  // into a ref so the interaction useEffect can call setSorting /
  // setColumnFilters from outside the render path.
  const tableRef = useRef<Table<ScenarioRow> | null>(table);
  tableRef.current = table;

  useEffect(() => {
    const t = tableRef.current;
    if (!t || !interactionPlan) return;

    if (interactionPlan.mode === "sort" && interactionPlan.sort) {
      t.setSorting([
        {
          id: interactionPlan.sort.columnId,
          desc: interactionPlan.sort.direction === "desc",
        },
      ]);
      return;
    }

    if (
      interactionPlan.mode === "filter-metadata" ||
      interactionPlan.mode === "filter-text"
    ) {
      const filters = Object.entries(interactionPlan.filters).map(
        ([id, value]) => ({ id, value }),
      );
      t.setColumnFilters(filters);
    }
  }, [interactionPlan, runKey]);

  useEffect(() => {
    const apply: ApplyBenchUpdates = (patches) => {
      setData((prev) => {
        const map = new Map(prev.map((r) => [String(r.id), r] as const));
        for (const patch of patches) {
          const id = String((patch as { id: unknown }).id);
          const existing = map.get(id);
          if (existing) map.set(id, { ...existing, ...(patch as ScenarioRow) });
        }
        return Array.from(map.values());
      });
    };
    onUpdateApiReadyRef.current?.(apply);
  }, [runKey]);

  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  const totalSize = virtualizer.getTotalSize();
  const virtualRows = virtualizer.getVirtualItems();
  const totalWidth = dataset.columns.reduce(
    (sum, c) => sum + (c.widthPx ?? 140),
    0,
  );
  const gridTemplateColumns = dataset.columns
    .map((c) => `${c.widthPx ?? 140}px`)
    .join(" ");

  return (
    <section
      aria-label="TanStack Table adapter"
      data-benchmark-adapter="tanstack"
      // `rows` is the post-filter, post-sort row model (table.getRowModel()),
      // so this reflects the count the grid actually displays after an
      // interaction. `data` is the full unfiltered dataset (always 3000).
      data-bench-result-row-count={String(rows.length)}
      style={{ display: "grid", gap: 12 }}
    >
      <header>
        <p style={{ margin: 0, fontWeight: 700 }}>TanStack Table v8</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Rows: {data.length} · Columns: {dataset.columns.length}
        </p>
      </header>
      <div
        key={runKey}
        ref={viewportRef}
        data-pretable-bench-tanstack-viewport=""
        className="adapter-surface"
        style={{
          height: VIEWPORT_HEIGHT,
          minWidth: 720,
          overflow: "auto",
          position: "relative",
        }}
      >
        <div
          role="table"
          style={{
            display: "grid",
            gridTemplateColumns,
            minWidth: totalWidth,
          }}
        >
          {table.getHeaderGroups().map((headerGroup) => (
            <div
              key={headerGroup.id}
              role="row"
              style={{
                display: "contents",
              }}
            >
              {headerGroup.headers.map((header) => {
                const canSort = header.column.getCanSort();
                return (
                  <button
                    key={header.id}
                    type="button"
                    role="columnheader"
                    onClick={
                      canSort
                        ? header.column.getToggleSortingHandler()
                        : undefined
                    }
                    style={{
                      textAlign: "left",
                      padding: "8px 10px",
                      borderBottom: "1px solid rgb(229 233 237)",
                      background: "transparent",
                      font: "inherit",
                      cursor: canSort ? "pointer" : "default",
                    }}
                  >
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div
          style={{
            height: totalSize,
            minWidth: totalWidth,
            position: "relative",
          }}
        >
          {virtualRows.map((vr) => {
            const row = rows[vr.index];
            return (
              <div
                key={row.id}
                data-tanstack-row=""
                data-row-id={row.id}
                data-row-index={String(vr.index)}
                style={{
                  position: "absolute",
                  top: vr.start,
                  left: 0,
                  width: totalWidth,
                  height: ROW_HEIGHT,
                  display: "grid",
                  gridTemplateColumns,
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    data-tanstack-cell=""
                    style={{
                      padding: "8px 10px",
                      borderRight: "1px solid rgb(229 233 237)",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
