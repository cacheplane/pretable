import type { CSSProperties } from "react";

import { getGroupPanelStyle } from "../styles";
import {
  composeChipAccessibleName,
  removeGroupLevel,
} from "./group-panel-model";

/** Default for `groupPanel.emptyMessage`. */
export const DEFAULT_GROUP_PANEL_EMPTY_MESSAGE =
  "Drag a column here to group by it";

export interface GroupPanelProps {
  /**
   * The engine's grouping levels, in order. The panel keeps NO copy of this:
   * it is re-read every render, so a level can never be shown that the engine
   * does not hold.
   */
  rowGroups: readonly string[];
  /** Header text for a grouped column id; falls back to the id. */
  labelForColumn: (columnId: string) => string;
  emptyMessage?: string;
  height: number;
  /**
   * Commit a whole new grouping list. Every mutation the panel makes is one
   * call with a rearranged array — there is no add/remove/move protocol.
   */
  onChange: (next: readonly string[]) => void;
  style?: CSSProperties;
}

/**
 * The strip above the header listing the active grouping levels.
 *
 * **It holds no state.** It is a pure projection of `snapshot.rowGroups`. The
 * temptation is to mirror the list into `useState` so a drag or a keyboard
 * move can be "optimistic"; that gives two sources of truth for the same
 * ordering, and the panel then has to be told about every engine-side change
 * (a controlled `state.rowGroups`, a column being removed, a menu action) or
 * it silently shows a grouping that is not in effect.
 *
 * The panel is always rendered when enabled, including while ungrouped — that
 * is exactly when its empty message has a job to do.
 */
export function GroupPanel({
  rowGroups,
  labelForColumn,
  emptyMessage,
  height,
  onChange,
  style,
}: GroupPanelProps) {
  const isEmpty = rowGroups.length === 0;
  const panelStyle = { ...getGroupPanelStyle(height), ...style };

  // `role="listbox"` with zero options fails axe (and tells a screen-reader
  // user there is a list to explore when there is not), so an empty panel is
  // presentational — it is a drop target and a sentence, nothing more.
  if (isEmpty) {
    return (
      <div data-pretable-group-panel="" role="presentation" style={panelStyle}>
        <span data-pretable-group-panel-empty="">
          {emptyMessage ?? DEFAULT_GROUP_PANEL_EMPTY_MESSAGE}
        </span>
      </div>
    );
  }

  return (
    <div
      aria-label="Grouping levels"
      aria-orientation="horizontal"
      data-pretable-group-panel=""
      role="listbox"
      style={panelStyle}
    >
      {rowGroups.map((columnId, index) => {
        const label = labelForColumn(columnId);

        return (
          <div
            aria-label={composeChipAccessibleName(
              label,
              index + 1,
              rowGroups.length,
            )}
            aria-posinset={index + 1}
            aria-selected={index === 0}
            aria-setsize={rowGroups.length}
            data-pretable-column-id={columnId}
            data-pretable-group-chip=""
            key={columnId}
            role="option"
            // Roving tabindex: the strip is one tab stop and the arrow keys
            // move within it. Task 3 makes the active index follow focus.
            tabIndex={index === 0 ? 0 : -1}
          >
            <span aria-hidden="true" data-pretable-chip-handle="" />
            {/* Hidden from the accessibility tree because the option root's
                own name already contains it — plus the position and the key
                hints, which no assembled-from-content name could carry. */}
            <span aria-hidden="true" data-pretable-chip-label="">
              {label}
            </span>
            {/* ARIA makes an option's children presentational, so this button
                is not reachable by a screen reader's own means. That is not an
                oversight to fix by changing the role (the spec commits to
                listbox/option) — it is why Delete on the focused chip exists
                as the equivalent keyboard path. */}
            <button
              aria-label={`Remove ${label} from grouping`}
              data-pretable-chip-remove=""
              onClick={(event) => {
                event.stopPropagation();
                onChange(removeGroupLevel(rowGroups, index));
              }}
              tabIndex={-1}
              type="button"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
