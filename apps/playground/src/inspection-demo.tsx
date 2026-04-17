import {
  createInspectionDataset,
  inspectionColumns,
  inspectionDatasetScaleOptions,
  type InspectionDatasetScale,
} from "@pretable-internal/scenario-data";
import {
  InspectionGrid,
  type PretableTelemetry,
} from "@pretable/react/internal";
import { useMemo, useState } from "react";

const VIEWPORT_HEIGHT = 420;
const OVERSCAN_ROWS = 5;

interface InteractionState {
  sort: { columnId: string; direction: "asc" | "desc" } | null;
  filters: Record<string, string>;
  selectedRowId: string | null;
}

export function InspectionDemo() {
  const [interactionState, setInteractionState] = useState<InteractionState>({
    sort: null,
    filters: {},
    selectedRowId: null,
  });
  const [scale, setScale] = useState<InspectionDatasetScale>("dev");
  const [telemetry, setTelemetry] = useState<PretableTelemetry | null>(null);
  const dataset = useMemo(() => createInspectionDataset(scale), [scale]);
  const rows = useMemo(() => [...dataset.rows], [dataset.rows]);

  const selectedRow = useMemo(
    () =>
      dataset.rows.find((row) => row.id === interactionState.selectedRowId) ??
      null,
    [dataset.rows, interactionState.selectedRowId],
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
          <p>{telemetry?.rowModelRowCount ?? dataset.rows.length} matching rows</p>
          <p>Scale: {scale}</p>
          <dl data-testid="inspection-diagnostics">
            <div>
              <dt>Rendered rows</dt>
              <dd>{telemetry?.renderedRowCount ?? 0}</dd>
            </div>
            <div>
              <dt>Visible rows</dt>
              <dd>{telemetry?.visibleRowCount ?? 0}</dd>
            </div>
            <div>
              <dt>Planned height</dt>
              <dd>{telemetry?.totalHeight ?? 0}</dd>
            </div>
            <div>
              <dt>Viewport range</dt>
              <dd>
                {telemetry
                  ? `${telemetry.visibleRowRange.start}-${telemetry.visibleRowRange.end}`
                  : "0-0"}
              </dd>
            </div>
            <div>
              <dt>Selected row</dt>
              <dd>{telemetry?.selectedRowId ?? "none"}</dd>
            </div>
            <div>
              <dt>Scale</dt>
              <dd>{scale}</dd>
            </div>
          </dl>
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
            <label className="filter-field">
              <span>Dataset scale</span>
              <select
                aria-label="Dataset scale"
                value={scale}
                onChange={(event) => {
                  setScale(event.currentTarget.value as InspectionDatasetScale);
                }}
              >
                {inspectionDatasetScaleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {dataset.filterableColumnIds.map((columnId) => {
              const column = inspectionColumns.find(
                (candidate) => candidate.id === columnId,
              );
              const label = column?.header ?? columnId;

              return (
                <label className="filter-field" key={columnId}>
                  <span>{label}</span>
                  <input
                    aria-label={`Filter ${label}`}
                    value={interactionState.filters[columnId] ?? ""}
                    onChange={(event) => {
                      const nextValue = event.currentTarget.value;

                      setInteractionState((current) => ({
                        ...current,
                        filters: {
                          ...current.filters,
                          [columnId]: nextValue,
                        },
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
              ariaLabel="Inspection grid"
              filterableColumnIds={dataset.filterableColumnIds}
              interactionState={interactionState}
              onSelectedRowIdChange={(rowId) => {
                setInteractionState((current) => ({
                  ...current,
                  selectedRowId: rowId,
                }));
              }}
              onSortChange={(sort) => {
                setInteractionState((current) => ({
                  ...current,
                  sort,
                }));
              }}
              onTelemetryChange={setTelemetry}
              overscan={OVERSCAN_ROWS}
              rows={rows}
              viewportHeight={VIEWPORT_HEIGHT}
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
