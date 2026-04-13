import {
  type PretableColumn,
  usePretableModel,
} from "@pretable/react";
import { useMemo } from "react";

type InspectionRow = {
  id: string;
  timestamp: string;
  severity: "trace" | "info" | "warn" | "error";
  source: string;
  owner: string;
  tags: string[];
  message: string;
};

const VIEWPORT_HEIGHT = 420;
const OVERSCAN_ROWS = 5;

const columns: PretableColumn<InspectionRow>[] = [
  { id: "timestamp", header: "Timestamp", pinned: "left", widthPx: 188 },
  { id: "severity", header: "Severity", pinned: "left", widthPx: 112 },
  { id: "source", header: "Source", widthPx: 160 },
  { id: "owner", header: "Owner", widthPx: 144 },
  {
    id: "tags",
    header: "Tags",
    widthPx: 200,
    getValue: (row) => row.tags.join(" "),
  },
  { id: "message", header: "Message", wrap: true, widthPx: 480 },
];

const rows: InspectionRow[] = [
  {
    id: "evt-001",
    timestamp: "2026-04-12T09:18:11Z",
    severity: "info",
    source: "gateway",
    owner: "routing",
    tags: ["cold-start", "tenant-a"],
    message:
      "Cold request path completed after a fresh worker spin-up while keeping trace stitching intact across two proxy hops.",
  },
  {
    id: "evt-002",
    timestamp: "2026-04-12T09:18:44Z",
    severity: "error",
    source: "retriever",
    owner: "rag-pipeline",
    tags: ["customer-facing", "timeout"],
    message:
      "Retrieval fan-out exceeded the budget after a region failover and the downstream answer stream stalled before the model could emit the first token.",
  },
  {
    id: "evt-003",
    timestamp: "2026-04-12T09:19:03Z",
    severity: "warn",
    source: "session-cache",
    owner: "state",
    tags: ["eviction", "burst"],
    message:
      "Session cache hit-rate fell below the burst target; the next compaction window should be widened before the afternoon replay job starts.",
  },
  {
    id: "evt-004",
    timestamp: "2026-04-12T09:19:19Z",
    severity: "trace",
    source: "planner",
    owner: "agents",
    tags: ["tool-call", "spec"],
    message:
      "Planner emitted a single-tool branch after confirming the benchmark matrix already had current repeated-run evidence for H1 and H3.",
  },
  {
    id: "evt-005",
    timestamp: "2026-04-12T09:19:57Z",
    severity: "error",
    source: "stream-router",
    owner: "inference",
    tags: ["backpressure", "sse"],
    message:
      "Stream router dropped a partial chunk when the client reconnected mid-flight; the replay cursor recovered, but the user saw a duplicate completion banner.",
  },
  {
    id: "evt-006",
    timestamp: "2026-04-12T09:20:21Z",
    severity: "info",
    source: "analytics",
    owner: "benchmarks",
    tags: ["runset", "median"],
    message:
      "Repeated-run medians stayed inside the current volatility envelope, with policy notes preserved in the runset summary and no blank-gap regressions.",
  },
  {
    id: "evt-007",
    timestamp: "2026-04-12T09:20:58Z",
    severity: "warn",
    source: "policy-audit",
    owner: "safety",
    tags: ["drift", "review"],
    message:
      "Policy-note drift was detected across two candidate runs, so the report downgraded the claim from satisfied to directional instead of over-claiming confidence.",
  },
];

const filterableColumnIds = ["timestamp", "severity", "source", "message"] as const;
const getInspectionRowId = (row: InspectionRow) => row.id;

export function InspectionDemo() {
  const { grid, snapshot, renderSnapshot } = usePretableModel<InspectionRow>({
    columns,
    getRowId: getInspectionRowId,
    rows,
    viewportHeight: VIEWPORT_HEIGHT,
    overscan: OVERSCAN_ROWS,
  });
  const selectedRow = useMemo(() => {
    const selectedId = snapshot.selection.rowIds[0];

    return rows.find((row) => row.id === selectedId) ?? null;
  }, [snapshot.selection.rowIds]);
  const pinnedOffsets = useMemo(
    () => getPinnedOffsets(grid.options.columns),
    [grid.options.columns],
  );

  return (
    <section className="inspection-demo">
      <div className="inspection-controls">
        <div className="inspection-copy">
          <p className="eyebrow">Prototype playground</p>
          <h1>Read-heavy inspection table</h1>
          <p>
            This surface is the first honest product wedge: wrapped text,
            pinned metadata, local filtering, and stable keyboard/selection
            behavior on the same core and renderer path used by the benchmark
            work.
          </p>
        </div>

        <div className="inspection-status-card">
          <span>Current slice</span>
          <strong>Inspection workflow</strong>
          <p>{snapshot.visibleRows.length} matching rows</p>
        </div>
      </div>

      <div className="inspection-layout">
        <article className="inspection-surface">
          <header className="inspection-panel-header">
            <div>
              <h2>Signal view</h2>
              <p>
                Filter by known metadata first, then move through the stream
                with the keyboard once a row is selected.
              </p>
            </div>
            <div className="inspection-keymap">
              <span>Arrows move focus</span>
              <span>Click selects</span>
            </div>
          </header>

          <div className="inspection-toolbar">
            {filterableColumnIds.map((columnId) => {
              const column = columns.find((candidate) => candidate.id === columnId);
              const label = column?.header ?? columnId;

              return (
                <label className="filter-field" key={columnId}>
                  <span>{label}</span>
                  <input
                    aria-label={`Filter ${label}`}
                    value={snapshot.filters[columnId] ?? ""}
                    onChange={(event) => {
                      grid.setFilter(columnId, event.currentTarget.value);
                    }}
                    placeholder={`Filter ${label.toLowerCase()}`}
                  />
                </label>
              );
            })}
          </div>

          <div
            aria-label="Inspection grid"
            className="inspection-viewport"
            role="grid"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                grid.moveFocus(event.key === "ArrowDown" ? 1 : -1);
                const nextRowId = grid.getSnapshot().focus.rowId;

                if (nextRowId) {
                  grid.selectRow(nextRowId);
                }

                event.preventDefault();
                return;
              }

              if (event.key === "Enter" || event.key === " ") {
                const focusedRowId = grid.getSnapshot().focus.rowId;

                if (focusedRowId) {
                  grid.selectRow(focusedRowId);
                  event.preventDefault();
                }
              }
            }}
            onScroll={(event) => {
              grid.setViewport({
                scrollTop: event.currentTarget.scrollTop,
                height: VIEWPORT_HEIGHT,
              });
            }}
          >
            <div
              className="inspection-grid"
              style={{
                minWidth: `${renderSnapshot.totalWidth}px`,
              }}
            >
              <div
                className="inspection-header-row"
                style={{
                  gridTemplateColumns: grid.options.columns
                    .map((column) => `${getColumnWidth(column)}px`)
                    .join(" "),
                }}
              >
                {grid.options.columns.map((column) => {
                  const sortDirection =
                    snapshot.sort.columnId === column.id
                      ? snapshot.sort.direction
                      : null;

                  return (
                    <button
                      aria-label={`Sort ${column.header ?? column.id}`}
                      className="inspection-header-cell"
                      key={column.id}
                      onClick={() => {
                        grid.setSort(
                          column.id,
                          getNextSortDirection(sortDirection),
                        );
                      }}
                      style={getPinnedCellStyle(column.id, pinnedOffsets)}
                      type="button"
                    >
                      <span>{column.header ?? column.id}</span>
                      <strong>
                        {sortDirection === "desc"
                          ? "Newest"
                          : sortDirection === "asc"
                            ? "Oldest"
                            : "Sort"}
                      </strong>
                    </button>
                  );
                })}
              </div>

              <div
                className="inspection-scroll-content"
                style={{ height: `${renderSnapshot.totalHeight}px` }}
              >
                {renderSnapshot.rows.map((row) => {
                  const isSelected = snapshot.selection.rowIds.includes(row.id);
                  const isFocused = snapshot.focus.rowId === row.id;

                  return (
                    <div
                      aria-selected={isSelected}
                      className="inspection-row"
                      data-row-id={row.id}
                      data-testid="inspection-row"
                      key={row.id}
                      onClick={() => {
                        grid.setFocus(row.id, "timestamp");
                        grid.selectRow(row.id);
                      }}
                      style={{
                        gridTemplateColumns: grid.options.columns
                          .map((column) => `${getColumnWidth(column)}px`)
                          .join(" "),
                        top: `${row.top}px`,
                        height: `${row.height}px`,
                      }}
                    >
                      {grid.options.columns.map((column) => (
                        <div
                          className="inspection-cell"
                          data-focused={isFocused ? "true" : "false"}
                          data-pinned={
                            column.pinned === "left" ? "left" : undefined
                          }
                          data-selected={isSelected ? "true" : "false"}
                          key={`${row.id}:${column.id}`}
                          style={getPinnedCellStyle(column.id, pinnedOffsets)}
                        >
                          <span className="inspection-cell-label">
                            {column.header ?? column.id}
                          </span>
                          <span className="inspection-cell-value">
                            {formatCellValue(row.row, column)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </article>

        <aside className="inspection-sidebar" data-testid="inspection-detail">
          <header className="inspection-panel-header">
            <div>
              <h2>Selected event</h2>
              <p>
                Selection stays keyed by event id, even when local filters hide
                the row from the viewport.
              </p>
            </div>
          </header>

          {selectedRow ? (
            <dl className="inspection-detail-list">
              <div>
                <dt>Event</dt>
                <dd>{selectedRow.id}</dd>
              </div>
              <div>
                <dt>Timestamp</dt>
                <dd>{selectedRow.timestamp}</dd>
              </div>
              <div>
                <dt>Severity</dt>
                <dd>{selectedRow.severity}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{selectedRow.source}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{selectedRow.owner}</dd>
              </div>
              <div>
                <dt>Tags</dt>
                <dd>{selectedRow.tags.join(", ")}</dd>
              </div>
              <div className="detail-message">
                <dt>Message</dt>
                <dd>{selectedRow.message}</dd>
              </div>
            </dl>
          ) : (
            <p className="inspection-empty">
              Pick a row to inspect the current event payload.
            </p>
          )}
        </aside>
      </div>
    </section>
  );
}

function getNextSortDirection(current: "asc" | "desc" | null) {
  if (current === null) {
    return "desc";
  }

  if (current === "desc") {
    return "asc";
  }

  return null;
}

function getColumnWidth(column: PretableColumn<InspectionRow>) {
  return column.widthPx ?? (column.wrap ? 220 : 140);
}

function getPinnedOffsets(columns: PretableColumn<InspectionRow>[]) {
  const offsets: Record<string, number> = {};
  let left = 0;

  for (const column of columns) {
    if (column.pinned !== "left") {
      continue;
    }

    offsets[column.id] = left;
    left += getColumnWidth(column);
  }

  return offsets;
}

function getPinnedCellStyle(
  columnId: string,
  pinnedOffsets: Record<string, number>,
) {
  const left = pinnedOffsets[columnId];

  if (left === undefined) {
    return undefined;
  }

  return {
    left: `${left}px`,
    position: "sticky" as const,
  };
}

function formatCellValue(
  row: InspectionRow,
  column: PretableColumn<InspectionRow>,
) {
  const value = column.getValue
    ? column.getValue(row)
    : row[column.id as keyof InspectionRow];

  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}
