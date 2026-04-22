import {
  createInspectionDataset,
  inspectionColumns,
  inspectionDatasetScaleOptions,
  type InspectionDatasetScale,
} from "@pretable-internal/scenario-data";
import { useMemo, useState } from "react";

interface InteractionState {
  sort: { columnId: string; direction: "asc" | "desc" } | null;
  filters: Record<string, string>;
  selectedRowId: string | null;
}

export function PitchGrid() {
  const [scale, setScale] = useState<InspectionDatasetScale>("dev");
  const [interactionState, setInteractionState] = useState<InteractionState>({
    sort: null,
    filters: {},
    selectedRowId: null,
  });

  const dataset = useMemo(() => createInspectionDataset(scale), [scale]);

  // Task 6 replaces these with real telemetry values from InspectionGrid.
  const renderedRowCount = 0;
  const selectedId = interactionState.selectedRowId ?? "none";

  return (
    <section
      id="grid"
      className="bg-grid-bg text-grid-text border-y border-grid-rule"
    >
      {/* Chrome strip */}
      <div
        data-testid="pitch-grid-chrome"
        className="flex items-center justify-between border-b border-grid-rule px-7 py-3 font-mono text-[11px] text-grid-dim md:px-10"
      >
        <div className="flex items-center gap-2">
          <span>inspection.log</span>
          <span>·</span>
          <label className="inline-flex items-center gap-1">
            <span className="sr-only">Dataset scale</span>
            <select
              aria-label="Dataset scale"
              className="bg-transparent text-amber outline-none cursor-pointer"
              value={scale}
              onChange={(event) => {
                setScale(
                  event.currentTarget.value as InspectionDatasetScale,
                );
              }}
            >
              {inspectionDatasetScaleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex items-center gap-3">
          <span>rendered {renderedRowCount}</span>
          <span>·</span>
          <span>sel {selectedId}</span>
        </div>
      </div>

      {/* Filter row */}
      <div
        data-testid="pitch-grid-filters"
        className="grid grid-flow-col auto-cols-fr gap-3 border-b border-grid-rule bg-grid-raised px-7 py-3 font-mono text-[12px] md:px-10"
      >
        {dataset.filterableColumnIds.map((columnId) => {
          const column = inspectionColumns.find((c) => c.id === columnId);
          const label = column?.header ?? columnId;
          return (
            <label key={columnId} className="grid gap-1 text-grid-dim">
              <span className="uppercase tracking-[0.06em]">{label}</span>
              <input
                type="text"
                aria-label={`Filter ${label}`}
                value={interactionState.filters[columnId] ?? ""}
                onChange={(event) => {
                  const nextValue = event.currentTarget.value;
                  setInteractionState((current) => ({
                    ...current,
                    filters: { ...current.filters, [columnId]: nextValue },
                  }));
                }}
                className="rounded-[2px] border border-grid-rule bg-grid-bg px-2 py-1 text-grid-text placeholder:text-grid-dim focus:outline-none focus:border-amber"
                placeholder={`Filter ${label.toLowerCase()}`}
              />
            </label>
          );
        })}
      </div>

      {/* Grid body placeholder — replaced in Task 6 */}
      <div
        data-testid="pitch-grid-body-placeholder"
        className="px-7 py-12 text-grid-dim md:px-10"
      >
        grid mounts in task 6
      </div>
    </section>
  );
}
