import {
  inspectionColumns,
  type InspectionFilterableColumnId,
  type InspectionRow,
} from "@pretable-internal/scenario-data";
import type { HTMLAttributes } from "react";
import type { PretableTelemetry } from "./use-pretable";

import { LabeledGridSurface } from "./labeled-grid-surface";
import type { PretableSurfaceProps } from "./pretable-surface";

const inspectionGridColumns = [...inspectionColumns];
const getInspectionRowId = (row: InspectionRow) => row.id;
const filterableBodyProps = {
  "data-filterable": "true",
} as HTMLAttributes<HTMLDivElement>;
const filterableHeaderProps = {
  "data-filterable": "true",
} as HTMLAttributes<HTMLButtonElement>;

export interface InspectionGridProps {
  ariaLabel: string;
  filterableColumnIds: readonly InspectionFilterableColumnId[];
  state?: PretableSurfaceProps<InspectionRow>["state"];
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSortChange?: PretableSurfaceProps<InspectionRow>["onSortChange"];
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  overscan?: number;
  rows: InspectionRow[];
  viewportHeight: number;
}

export function InspectionGrid({
  ariaLabel,
  filterableColumnIds,
  state,
  onSelectedRowIdChange,
  onSortChange,
  onTelemetryChange,
  overscan,
  rows,
  viewportHeight,
}: InspectionGridProps) {
  const filterableColumns = new Set<string>(filterableColumnIds);

  return (
    <LabeledGridSurface<InspectionRow>
      ariaLabel={ariaLabel}
      bodyCellClassName="inspection-cell"
      columns={inspectionGridColumns}
      formatValue={({ value }) => formatInspectionValue(value)}
      getBodyCellProps={({ column }) =>
        filterableColumns.has(column.id) ? filterableBodyProps : undefined
      }
      getHeaderCellProps={({ column }) =>
        filterableColumns.has(column.id) ? filterableHeaderProps : undefined
      }
      getRowId={getInspectionRowId}
      headerCellClassName="inspection-header-cell"
      state={state}
      labelClassName="inspection-cell-label"
      overscan={overscan}
      onSelectedRowIdChange={onSelectedRowIdChange}
      onSortChange={onSortChange}
      onTelemetryChange={onTelemetryChange}
      pinnedClassName="is-pinned"
      rowClassName="inspection-row"
      rows={rows}
      selectFocusedRowOnArrowKey
      valueClassName="inspection-cell-value"
      viewportHeight={viewportHeight}
    />
  );
}

function formatInspectionValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  return String(value ?? "");
}
