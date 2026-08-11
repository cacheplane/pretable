import {
  inspectionColumns,
  type InspectionFilterableColumnId,
  type InspectionRow,
} from "@pretable-internal/scenario-data";
import type { HTMLAttributes } from "react";
import type { PretableQueryFor } from "@pretable/core";
import type { PretableTelemetry } from "./surface-types";

import { LabeledGridSurface } from "./labeled-grid-surface";
import type {
  PretableSurfaceProps,
  PretableSurfaceQueryColumns,
} from "./pretable-surface";

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
interface InspectionGridBaseProps {
  ariaLabel: string;
  filterableColumnIds: readonly InspectionFilterableColumnId[];
  state?: PretableSurfaceProps<InspectionRow>["state"];
  onSelectedRowIdChange?: (rowId: string | null) => void;
  onSelectionChange?: PretableSurfaceProps<InspectionRow>["onSelectionChange"];
  onFocusChange?: PretableSurfaceProps<InspectionRow>["onFocusChange"];
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

/** Props for {@link InspectionGrid}. @beta */
export type InspectionGridProps = InspectionGridBaseProps &
  (
    | {
        query: PretableQueryFor<typeof inspectionColumns>;
        onQueryChange: (
          query: PretableQueryFor<typeof inspectionColumns>,
        ) => void;
      }
    | { query?: never; onQueryChange?: never }
  );

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
  query,
  onQueryChange,
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
  const controlledQueryProps:
    | {
        query: PretableQueryFor<PretableSurfaceQueryColumns<InspectionRow>>;
        onQueryChange: (
          next: PretableQueryFor<PretableSurfaceQueryColumns<InspectionRow>>,
        ) => void;
      }
    | { query?: never; onQueryChange?: never } =
    query === undefined
      ? {}
      : {
          query: query as PretableQueryFor<
            PretableSurfaceQueryColumns<InspectionRow>
          >,
          onQueryChange: onQueryChange as (
            next: PretableQueryFor<PretableSurfaceQueryColumns<InspectionRow>>,
          ) => void,
        };

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
      {...controlledQueryProps}
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
