import {
  type CSSProperties,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { getGroupPanelStyle } from "../styles";
import { hitTestGroupPanel } from "./group-panel-hit-test";
import {
  DEFAULT_GROUP_PANEL_EMPTY_MESSAGE,
  composeChipAccessibleName,
  insertGroupLevel,
  moveGroupLevel,
  removeGroupLevel,
} from "./group-panel-model";

/** Matches the header reorder drag's threshold, so both grabs feel the same. */
const CHIP_DRAG_THRESHOLD_PX = 5;

export interface GroupPanelProps {
  /**
   * The panel's own container element, published so the surface's header drag
   * can hit-test against it. It is also the element a chip drag captures the
   * pointer on — see the drag notes below.
   */
  containerRef?: RefObject<HTMLDivElement | null>;
  /**
   * Where an in-flight drag STARTED FROM OUTSIDE the panel would insert, or
   * `null` for no external drag. The panel's own chip drag does not go through
   * this — it owns its insertion index directly.
   */
  dropIndicatorIndex?: number | null;
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
  containerRef,
  dropIndicatorIndex = null,
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

  // The panel container. It is the one element in the strip that survives a
  // whole drag: every chip is re-inserted as the insertion index moves.
  const panelRef = useRef<HTMLDivElement>(null);
  const setPanelNode = useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      if (containerRef) containerRef.current = node;
    },
    [containerRef],
  );

  /**
   * The in-flight chip drag. The ref is the truth the pointer handlers read;
   * the state exists only to paint. They cannot be one thing: the document
   * listeners are subscribed once per gesture, so a `useState` value read
   * inside them would be the one captured at pointerdown.
   *
   * `columnId` is captured HERE, at drag start, and never re-read from the
   * chip — the chip may not be the same DOM node by the time the pointer comes
   * up.
   */
  const chipDragRef = useRef<{
    columnId: string;
    pointerId: number;
    startX: number;
    startY: number;
    dragging: boolean;
    insertIndex: number | null;
  } | null>(null);
  const [chipDrag, setChipDrag] = useState<{
    columnId: string;
    dragging: boolean;
    insertIndex: number | null;
  } | null>(null);
  // Read by the document listeners, which subscribe once per gesture and must
  // not go stale on the props they commit against.
  const commitRef = useRef({ rowGroups, onChange });
  useLayoutEffect(() => {
    commitRef.current = { rowGroups, onChange };
  });

  const gestureArmed = chipDrag !== null;

  useEffect(() => {
    if (!gestureArmed) return;

    const end = () => {
      const drag = chipDragRef.current;
      chipDragRef.current = null;
      setChipDrag(null);
      if (!drag) return;
      try {
        panelRef.current?.releasePointerCapture(drag.pointerId);
      } catch {
        // jsdom, or a browser that dropped the capture already — no-op.
      }
    };

    const onMove = (event: PointerEvent) => {
      const drag = chipDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      if (!drag.dragging) {
        const dist = Math.hypot(
          event.clientX - drag.startX,
          event.clientY - drag.startY,
        );
        if (dist < CHIP_DRAG_THRESHOLD_PX) return;
        drag.dragging = true;
      }

      const hit = hitTestGroupPanel(
        panelRef.current,
        event.clientX,
        event.clientY,
      );
      drag.insertIndex = hit?.insertIndex ?? null;
      setChipDrag({
        columnId: drag.columnId,
        dragging: true,
        insertIndex: drag.insertIndex,
      });
    };

    const onUp = (event: PointerEvent) => {
      const drag = chipDragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;

      // The ONLY commit in the whole gesture. Leaving the panel did nothing on
      // the way out, so releasing outside it is a no-op — deliberately not
      // ag-grid's "leaving the strip ungroups you, with no undo".
      if (drag.dragging && drag.insertIndex !== null) {
        const { rowGroups: current, onChange: commit } = commitRef.current;
        const next = insertGroupLevel(current, drag.columnId, drag.insertIndex);
        if (next !== current) {
          refocusRef.current = drag.columnId;
          commit(next);
        }
      }
      end();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      // Nothing has been committed at any point during the drag, so abandoning
      // the gesture IS the restore — there is no snapshot to put back.
      event.preventDefault();
      end();
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", end);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", end);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [gestureArmed]);

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
  // A chip drag owns the indicator while it is running; otherwise it belongs to
  // whatever the surface reports dragging in from outside.
  const indicatorAt =
    chipDrag !== null && chipDrag.dragging
      ? chipDrag.insertIndex
      : dropIndicatorIndex;
  // Present only while a drop is pending, so it can be selected on rather than
  // needing a value: `[data-pretable-group-panel-active]`.
  const activeProps =
    indicatorAt === null ? {} : { "data-pretable-group-panel-active": "" };

  if (isEmpty) {
    return (
      <div
        {...activeProps}
        data-pretable-group-panel=""
        ref={setPanelNode}
        role="presentation"
        style={panelStyle}
      >
        <span data-pretable-group-panel-empty="">
          {emptyMessage ?? DEFAULT_GROUP_PANEL_EMPTY_MESSAGE}
        </span>
      </div>
    );
  }

  const gapIndicator = (index: number) =>
    indicatorAt === index ? (
      <span
        aria-hidden="true"
        data-pretable-chip-drop-indicator=""
        key={`drop-${index}`}
      />
    ) : null;

  return (
    <div
      {...activeProps}
      aria-label="Grouping levels"
      aria-orientation="horizontal"
      data-pretable-group-panel=""
      ref={setPanelNode}
      role="listbox"
      style={panelStyle}
    >
      {rowGroups.flatMap((columnId, index) => {
        const label = labelForColumn(columnId);

        return [
          gapIndicator(index),
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
            {...(chipDrag?.dragging && chipDrag.columnId === columnId
              ? { "data-pretable-chip-dragging": "" }
              : {})}
            key={columnId}
            onFocus={() => setActiveIndex(index)}
            // pointerdown is the ONLY pointer event bound to a chip. Everything
            // after it lives on the document, and the capture is taken on the
            // panel container — a chip is re-inserted as the insertion index
            // moves, and a capture on a node React replaces is lost mid-drag.
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              // The ✕ is a button inside the chip: pressing it is a removal,
              // not a grab.
              if (
                (event.target as HTMLElement).closest(
                  "[data-pretable-chip-remove]",
                )
              ) {
                return;
              }

              chipDragRef.current = {
                columnId,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                dragging: false,
                insertIndex: null,
              };
              setChipDrag({ columnId, dragging: false, insertIndex: null });
              try {
                panelRef.current?.setPointerCapture(event.pointerId);
              } catch {
                // jsdom, or a pointer type without capture — no-op.
              }
            }}
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
          </div>,
        ];
      })}
      {gapIndicator(rowGroups.length)}
    </div>
  );
}
