import {
  createElement,
  Fragment,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { GROUP_COLUMN_ID, type PretableRow } from "@pretable/core";
import type { PlannedColumn } from "@pretable-internal/renderer-dom";

import { groupLabel } from "./group-model";
import { formatCellValue } from "./rendering";
import { ChevronDownIcon } from "./icons";
import {
  formatAggregateValue,
  type NumberFormatterRegistry,
} from "./value-formatting";
import { resolveColumnAlign } from "./column-align";
import { getPositionedCellStyle, getRowStyle } from "./styles";
import type { PretableColumn } from "./types";

/** @internal */
export interface GroupRowProps<TRow extends PretableRow> {
  /** Every planned column, in drawn order — the same list data rows use. */
  columns: readonly PlannedColumn[];
  /** Column definitions by id, including the derived group column. */
  columnsById: ReadonlyMap<string, PretableColumn<TRow>>;
  expanded: boolean;
  focusedColumnId: string | null;
  group: {
    readonly kind: "group";
    readonly groupId: string;
    readonly depth: number;
    readonly columnId: string;
    readonly value: unknown;
    readonly childCount: number;
    readonly aggregates: Readonly<Record<string, unknown>>;
    readonly expanded: boolean;
  };
  height: number;
  numberFormatters?: NumberFormatterRegistry;
  scope?: "all" | "loaded";
  formatChildCount?: (args: {
    childCount: number;
    scope: "all" | "loaded";
  }) => string;
  isFocused: boolean;
  /** Width override while a resize drag is live, so cells track the header. */
  liveWidth?: { columnId: string; width: number } | null;
  onCellClick: (columnId: string, event: ReactMouseEvent) => void;
  onToggle: () => void;
  registerCell: (key: string, node: HTMLDivElement | null) => void;
  /** Discriminated renderer identity used only for internal node lookup. */
  renderId: string;
  /** Logical row-model index, shared with the indexed data-row path. */
  rowIndex: number;
  top: number;
  viewportWidth: number;
}

/**
 * One group header row: the label, twisty and child count in the derived group
 * column, and each column's aggregate in the same pixel position as the data
 * cells beneath it.
 *
 * Group rows are focus targets but never selection or edit targets — the engine
 * excludes them from `deriveSelectedRows` and from the paste row-space, and
 * nothing here reintroduces them.
 */
export function GroupRow<TRow extends PretableRow>({
  columns,
  columnsById,
  expanded,
  focusedColumnId,
  group,
  height,
  numberFormatters = new Map(),
  scope = "all",
  formatChildCount = ({ childCount }) => `(${childCount})`,
  isFocused,
  liveWidth,
  onCellClick,
  onToggle,
  registerCell,
  renderId,
  rowIndex,
  top,
  viewportWidth,
}: GroupRowProps<TRow>) {
  // A group whose children a filter removed cannot be opened. `aria-expanded`
  // is dropped rather than written "false": "false" announces an unopenable row
  // as a collapsed group the user can expand.
  const expandable = group.childCount > 0;
  const label = groupLabel(group.value);

  return (
    <div
      aria-expanded={expandable ? (expanded ? "true" : "false") : undefined}
      aria-level={group.depth + 1}
      // No window offset here, and none is possible: resolveAriaRowCount
      // downgrades aria-rowcount to the loaded-model count whenever grouping
      // is active (rowGroups.length > 0), for the whole grid, not per row.
      // A group row only ever renders while that downgrade is in force, so
      // the dataset-position offset pretable-surface.tsx computes for data
      // rows (see rowIndexOffset there) is always 0 by the time it would
      // reach here — there is no meaningful window position to thread.
      aria-rowindex={rowIndex + 2}
      data-pretable-focused={isFocused ? "true" : "false"}
      data-pretable-group-row=""
      data-pretable-row-height={height}
      data-pretable-row-id={group.groupId}
      data-pretable-row-index={rowIndex}
      role="row"
      style={getRowStyle(top, height)}
    >
      {columns.map((plannedCol) => {
        const isGroupCell = plannedCol.id === GROUP_COLUMN_ID;
        const column = columnsById.get(plannedCol.id);
        const width =
          liveWidth?.columnId === plannedCol.id
            ? liveWidth.width
            : plannedCol.width;
        const cellIsFocused = isFocused && focusedColumnId === plannedCol.id;
        const positionStyle = getPositionedCellStyle(
          plannedCol,
          width,
          viewportWidth,
        );
        // Indentation is padding INSIDE the cell box, driven by this custom
        // property. Indenting the ROW instead would scroll the indent away from
        // a pinned group column, compute ellipsis truncation against the wrong
        // width, and misplace the focus outline.
        const style = isGroupCell
          ? ({
              ...positionStyle,
              "--pretable-group-depth": group.depth,
            } as CSSProperties)
          : positionStyle;
        // ENGINE-AWARE, for free. `group.aggregates` is what the row model
        // COMPUTED, keyed by schema id — never the `aggregate` a column prop
        // declared. A tool-panel override reaches this map because it is
        // merged into the derivations before they are compiled, so nothing
        // here needs to know an override exists.
        const hasAggregate =
          !isGroupCell &&
          Object.prototype.hasOwnProperty.call(group.aggregates, plannedCol.id);
        const aggregate = group.aggregates[plannedCol.id];

        return (
          <div
            aria-colindex={plannedCol.index + 1}
            data-pretable-cell=""
            data-pretable-column-id={plannedCol.id}
            data-pretable-column-type={column?.type}
            data-pretable-column-align={
              column ? resolveColumnAlign(column) : undefined
            }
            data-pretable-focused={cellIsFocused ? "true" : "false"}
            data-pretable-group-cell={isGroupCell ? "" : undefined}
            data-pretable-pinned={plannedCol.pinned}
            key={plannedCol.id}
            onClick={(event) => onCellClick(plannedCol.id, event)}
            onDoubleClick={(event) => {
              if (!isGroupCell || !expandable) return;
              // A fast double-click on the chevron fires click, click, dblclick
              // — open → close → OPEN — and the group looks unresponsive. The
              // twisty owns its own toggling; this handler covers the rest of
              // the cell only.
              if (
                event.target instanceof Element &&
                event.target.closest("[data-pretable-group-twisty]")
              ) {
                return;
              }
              onToggle();
            }}
            ref={(node) => {
              registerCell(`${renderId}::${plannedCol.id}`, node);
            }}
            role="gridcell"
            style={style}
            tabIndex={cellIsFocused ? 0 : -1}
          >
            {isGroupCell ? (
              <>
                {expandable ? (
                  <button
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`}
                    data-pretable-group-twisty=""
                    onClick={(event) => {
                      // Without this the click reaches the cell handler and
                      // expanding a group also selects it.
                      event.stopPropagation();
                      onToggle();
                    }}
                    // The grid owns a roving tabindex across cells; the twisty
                    // is reachable by Enter/Space/Left/Right on the cell, not by
                    // Tab, which the surface consumes for cell navigation.
                    tabIndex={-1}
                    type="button"
                  >
                    {/* Points down when expanded; the stylesheet rotates it
                        -90deg while aria-expanded is "false". */}
                    <ChevronDownIcon />
                  </button>
                ) : null}
                <span data-pretable-group-label="">{label}</span>
                <span data-pretable-group-count="">
                  {formatChildCount({ childCount: group.childCount, scope })}
                </span>
              </>
            ) : hasAggregate ? (
              column ? (
                formatAggregateValue({
                  column,
                  group: { ...group, id: group.groupId },
                  scope,
                  numberFormatters,
                  fallback: formatCellValue,
                })
              ) : (
                formatCellValue(aggregate)
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
