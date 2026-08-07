import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import {
  GROUP_COLUMN_ID,
  type PretableGridSnapshot,
  type PretableGroupRow,
  type PretableRow,
  type PretableVisibleRow,
} from "@pretable/core";
import type { PlannedColumn } from "@pretable-internal/renderer-dom";

import { formatCellValue } from "./rendering";
import { getPositionedCellStyle, getRowStyle } from "./styles";
import type { PretableColumn } from "./types";

/**
 * Label for a group whose key value is null, undefined or empty. Grouping by a
 * nullable column is the common case, and a blank group row is
 * indistinguishable from a broken one.
 */
export const GROUP_BLANK_LABEL = "(Blanks)";

/**
 * Expanded state of one group, read off a snapshot.
 *
 * The engine stores expansion as a DEFAULT plus a set of ids that differ from
 * it — which is what lets `expandAll`/`collapseAll` apply to groups that do not
 * exist yet — so membership in the set means "collapsed" or "expanded"
 * depending on the default. Never read the set on its own.
 */
export function isGroupExpanded(
  snapshot: Pick<
    PretableGridSnapshot,
    "groupExpansionOverrides" | "groupsDefaultExpanded"
  >,
  groupId: string,
): boolean {
  return snapshot.groupExpansionOverrides.has(groupId)
    ? !snapshot.groupsDefaultExpanded
    : snapshot.groupsDefaultExpanded;
}

/**
 * The group row one level out from the entry at `index`, or `null` at the top
 * level. Backed by the flat visible list, so it is exactly the row `Left` on a
 * collapsed group navigates to.
 */
export function findParentGroupRow<TRow extends PretableRow>(
  visibleRows: readonly PretableVisibleRow<TRow>[],
  index: number,
): PretableGroupRow | null {
  const entry = visibleRows[index];

  if (!entry) return null;

  for (let i = index - 1; i >= 0; i -= 1) {
    const candidate = visibleRows[i];
    if (
      candidate &&
      candidate.kind === "group" &&
      candidate.depth < entry.depth
    ) {
      return candidate;
    }
  }

  return null;
}

/** The label a group row shows for its key value. */
export function groupLabel(value: unknown): string {
  const text = formatCellValue(value);

  return text === "" ? GROUP_BLANK_LABEL : text;
}

/** @internal */
export interface GroupRowProps<TRow extends PretableRow> {
  /** Every planned column, in drawn order — the same list data rows use. */
  columns: readonly PlannedColumn[];
  /** Column definitions by id, including the derived group column. */
  columnsById: ReadonlyMap<string, PretableColumn<TRow>>;
  expanded: boolean;
  focusedColumnId: string | null;
  group: PretableGroupRow;
  height: number;
  isFocused: boolean;
  /** Width override while a resize drag is live, so cells track the header. */
  liveWidth?: { columnId: string; width: number } | null;
  onCellClick: (columnId: string, event: ReactMouseEvent) => void;
  onToggle: () => void;
  registerCell: (key: string, node: HTMLDivElement | null) => void;
  /** Index into `snapshot.visibleRows`, as the data-row path uses. */
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
  isFocused,
  liveWidth,
  onCellClick,
  onToggle,
  registerCell,
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
      aria-rowindex={rowIndex + 2}
      data-pretable-focused={isFocused ? "true" : "false"}
      data-pretable-group-row=""
      data-pretable-row-height={height}
      data-pretable-row-id={group.id}
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
        const hasAggregate =
          !isGroupCell &&
          Object.prototype.hasOwnProperty.call(group.aggregates, plannedCol.id);
        const aggregate = group.aggregates[plannedCol.id];

        return (
          <div
            aria-colindex={plannedCol.index + 1}
            data-pretable-cell=""
            data-pretable-column-id={plannedCol.id}
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
              registerCell(`${group.id}::${plannedCol.id}`, node);
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
                    ▾
                  </button>
                ) : null}
                <span data-pretable-group-label="">{label}</span>
                <span data-pretable-group-count="">({group.childCount})</span>
              </>
            ) : hasAggregate ? (
              column?.formatAggregate ? (
                column.formatAggregate({ value: aggregate, column, group })
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
