import type { PretableColumn } from "@pretable/react";
import {
  LabeledGridSurface,
} from "@pretable/react/internal";
import { memo, useMemo, useState } from "react";

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

const InspectionGrid = memo(function InspectionGrid({
  onSelectedRowIdChange,
  rows,
}: {
  onSelectedRowIdChange: (rowId: string | null) => void;
  rows: InspectionRow[];
}) {
  return (
    <LabeledGridSurface
      ariaLabel="Inspection grid"
      bodyCellClassName="inspection-cell"
      columns={columns}
      formatValue={({ value }) => formatInspectionValue(value)}
      getRowId={(row) => row.id}
      headerCellClassName="inspection-header-cell"
      labelClassName="inspection-cell-label"
      overscan={OVERSCAN_ROWS}
      onSelectedRowIdChange={onSelectedRowIdChange}
      pinnedClassName="is-pinned"
      rowClassName="inspection-row"
      rows={rows}
      selectFocusedRowOnArrowKey
      valueClassName="inspection-cell-value"
      viewportHeight={VIEWPORT_HEIGHT}
    />
  );
});

export function InspectionDemo() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        filterableColumnIds.every((columnId) => {
          const filter = filters[columnId]?.trim().toLowerCase();

          if (!filter) {
            return true;
          }

          return getInspectionFilterValue(row, columnId)
            .toLowerCase()
            .includes(filter);
        }),
      ),
    [filters],
  );

  const selectedRow = useMemo(
    () => rows.find((row) => row.id === selectedRowId) ?? null,
    [selectedRowId],
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
          <p>{filteredRows.length} matching rows</p>
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
                    value={filters[columnId] ?? ""}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;

                      setFilters((current) => ({
                        ...current,
                        [columnId]: nextValue,
                      }));
                    }}
                    placeholder={`Filter ${label.toLowerCase()}`}
                  />
                </label>
              );
            })}
          </div>

          <div className="inspection-grid-shell">
            <InspectionGrid
              onSelectedRowIdChange={setSelectedRowId}
              rows={filteredRows}
            />
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

function formatInspectionValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}

function getInspectionFilterValue(
  row: InspectionRow,
  columnId: (typeof filterableColumnIds)[number],
) {
  switch (columnId) {
    case "timestamp":
      return row.timestamp;
    case "severity":
      return row.severity;
    case "source":
      return row.source;
    case "message":
      return row.message;
  }
}
