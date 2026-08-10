import { inspectionColumns } from "@pretable-internal/scenario-data";
import type { HTMLAttributes } from "react";
import type { PretableTelemetry } from "./use-pretable";

import { LabeledGridSurface } from "./labeled-grid-surface";
import type { PretableSurfaceProps } from "./pretable-surface";

/**
 * Severity of an {@link InspectionRow}, used for the built-in `severity` column.
 *
 * @beta
 */
export type InspectionSeverity = "trace" | "info" | "warn" | "error";

/**
 * Row shape {@link InspectionGrid} renders. The component ships a fixed
 * log-inspection column set, so the row contract is fixed too — this type is
 * that contract, declared here rather than imported from a fixture package so
 * consumers can name what they pass to `rows`.
 *
 * @beta
 */
export interface InspectionRow extends Record<string, unknown> {
  id: string;
  timestamp: string;
  severity: InspectionSeverity;
  source: string;
  owner: string;
  tags: string[];
  message: string;
}

/**
 * Columns of {@link InspectionRow} that {@link InspectionGridProps.filterableColumnIds}
 * may name.
 *
 * @beta
 */
export type InspectionFilterableColumnId =
  "timestamp" | "severity" | "source" | "message";

const inspectionGridColumns = [...inspectionColumns];
const getInspectionRowId = (row: InspectionRow) => row.id;
const filterableBodyProps = {
  "data-filterable": "true",
} as HTMLAttributes<HTMLDivElement>;
const filterableHeaderProps = {
  "data-filterable": "true",
} as HTMLAttributes<HTMLButtonElement>;

/**
 * Props for {@link InspectionGrid}.
 *
 * @beta
 */
export interface InspectionGridProps {
  ariaLabel: string;
  filterableColumnIds: readonly InspectionFilterableColumnId[];
  state?: PretableSurfaceProps<InspectionRow>["state"];
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: PretableSurfaceProps<InspectionRow>["onSelectionChange"];
  onFocusChange?: PretableSurfaceProps<InspectionRow>["onFocusChange"];
  onSortChange?: PretableSurfaceProps<InspectionRow>["onSortChange"];
  onColumnWidthsChange?: PretableSurfaceProps<InspectionRow>["onColumnWidthsChange"];
  onColumnOrderChange?: PretableSurfaceProps<InspectionRow>["onColumnOrderChange"];
  onColumnPinnedChange?: PretableSurfaceProps<InspectionRow>["onColumnPinnedChange"];
  onTelemetryChange?: (telemetry: PretableTelemetry) => void;
  overscan?: number;
  rows: InspectionRow[];
  rowSelectionColumn?: PretableSurfaceProps<InspectionRow>["rowSelectionColumn"];
  tabBehavior?: PretableSurfaceProps<InspectionRow>["tabBehavior"];
  copyWithHeaders?: PretableSurfaceProps<InspectionRow>["copyWithHeaders"];
  onCopy?: PretableSurfaceProps<InspectionRow>["onCopy"];
  copyToClipboard?: PretableSurfaceProps<InspectionRow>["copyToClipboard"];
  messages?: PretableSurfaceProps<InspectionRow>["messages"];
  viewportHeight: number;
}

/**
 * Special-purpose inspection surface that renders rows as labeled key/value pairs. Experimental — shape may change before 1.0.
 *
 * @beta
 */
export function InspectionGrid({
  ariaLabel,
  filterableColumnIds,
  state,
  onSelectedRowIdChange,
  onSelectionChange,
  onFocusChange,
  onSortChange,
  onColumnWidthsChange,
  onColumnOrderChange,
  onColumnPinnedChange,
  onTelemetryChange,
  overscan,
  rows,
  rowSelectionColumn,
  tabBehavior,
  copyWithHeaders,
  onCopy,
  copyToClipboard,
  messages,
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
      onSelectionChange={onSelectionChange}
      onFocusChange={onFocusChange}
      onSortChange={onSortChange}
      onColumnWidthsChange={onColumnWidthsChange}
      onColumnOrderChange={onColumnOrderChange}
      onColumnPinnedChange={onColumnPinnedChange}
      onTelemetryChange={onTelemetryChange}
      pinnedClassName="is-pinned"
      rowClassName="inspection-row"
      rows={rows}
      rowSelectionColumn={rowSelectionColumn}
      selectFocusedRowOnArrowKey
      tabBehavior={tabBehavior}
      copyWithHeaders={copyWithHeaders}
      onCopy={onCopy}
      copyToClipboard={copyToClipboard}
      messages={messages}
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
