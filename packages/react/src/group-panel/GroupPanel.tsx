import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";

import { getGroupPanelStyle } from "../styles";
import {
  DEFAULT_GROUP_PANEL_EMPTY_MESSAGE,
  composeChipAccessibleName,
  moveGroupLevel,
  removeGroupLevel,
} from "./group-panel-model";

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
  // The roving tab stop. This is the panel's ONLY state, and it is about the
  // keyboard rather than about the grouping — the levels themselves stay a
  // pure projection of the prop.
  const [activeIndex, setActiveIndex] = useState(0);
  const chipNodes = useRef(new Map<string, HTMLDivElement>());
  // Which chip to put DOM focus back on once the reordered list has committed.
  // Keyed by column id, not by index: "focus follows the moved chip" is a
  // statement about a chip's identity, and after a move its index is exactly
  // the thing that changed.
  const refocusRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    const columnId = refocusRef.current;
    if (columnId === null) return;
    refocusRef.current = null;
    // React reorders keyed children by re-inserting the DOM nodes, and
    // detaching a focused element drops focus to the body. Without this the
    // first Shift+Arrow would work and the second would go nowhere.
    chipNodes.current.get(columnId)?.focus();
  });

  const isEmpty = rowGroups.length === 0;
  const panelStyle = { ...getGroupPanelStyle(height), ...style };
  // A removal can leave the stored index past the end.
  const active = Math.min(activeIndex, Math.max(rowGroups.length - 1, 0));

  const focusChip = (columnId: string | undefined, index: number) => {
    if (columnId === undefined) return;
    setActiveIndex(index);
    chipNodes.current.get(columnId)?.focus();
  };

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
            aria-selected={index === active}
            aria-setsize={rowGroups.length}
            data-pretable-column-id={columnId}
            data-pretable-group-chip=""
            key={columnId}
            onFocus={() => setActiveIndex(index)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                const delta = event.key === "ArrowLeft" ? -1 : 1;
                const target = index + delta;

                if (event.shiftKey) {
                  // Reorder. `moveGroupLevel` returns the same array when the
                  // target is off either end, so the first and last chips
                  // simply stay put — no wrap, and nothing is committed.
                  const next = moveGroupLevel(rowGroups, index, target);
                  if (next === rowGroups) return;
                  event.preventDefault();
                  setActiveIndex(target);
                  refocusRef.current = columnId;
                  onChange(next);
                  return;
                }

                if (target < 0 || target >= rowGroups.length) return;
                event.preventDefault();
                focusChip(rowGroups[target], target);
                return;
              }

              if (event.key === "Delete" || event.key === "Backspace") {
                // Backspace is a browser back-navigation shortcut in some
                // configurations, so this must not fall through.
                event.preventDefault();
                const next = removeGroupLevel(rowGroups, index);
                if (next === rowGroups) return;
                // Keep the keyboard in the strip: focus the level that slides
                // into this slot, or the one before it when the last chip went.
                refocusRef.current =
                  rowGroups[index + 1] ?? rowGroups[index - 1] ?? null;
                setActiveIndex(Math.min(index, next.length - 1));
                onChange(next);
              }
            }}
            ref={(node) => {
              if (node) {
                chipNodes.current.set(columnId, node);
              } else {
                chipNodes.current.delete(columnId);
              }
            }}
            role="option"
            // Roving tabindex: the strip is one tab stop, and the arrow keys
            // move within it.
            tabIndex={index === active ? 0 : -1}
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
