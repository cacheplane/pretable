/**
 * The tool panel's pointer-drag state machine for row lists — one machine,
 * shared by the columns section and the grouping section, which carried
 * verbatim copies of it until this extraction. The hook owns the gesture
 * (press, threshold, move, release, cancel) and the drag's render state; the
 * pure insertion geometry stays in `tool-panel-drop-target.ts`, and the
 * section keeps what genuinely differs: how its rendered rows are measured,
 * what subgroups they partition into, and what a finished move commits.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import type {
  ToolDropGroup,
  ToolDropTarget,
  ToolRowRect,
} from "./tool-panel-drop-target";
import { dropTargetForPointer } from "./tool-panel-drop-target";

/** Same slop the header drag uses before a press becomes a reorder. */
const DRAG_THRESHOLD_PX = 5;

/** A press on a grip that has not (yet) crossed the drag threshold. */
interface PendingRowDrag {
  columnId: string;
  pointerId: number;
  startX: number;
  startY: number;
  dragging: boolean;
}

/** The in-flight drag the render reflects: dim the row, draw the line. */
export interface ActiveToolRowDrag {
  readonly columnId: string;
  readonly target: ToolDropTarget;
}

export interface ToolRowDragOptions {
  /**
   * Measure the rendered rows, in rendered order. Called fresh on every drag
   * move AND again at release — never cached, for the header drag's reason:
   * the pane scrolls without a React render, and a stale rect would put the
   * drop a scroll-distance from the pointer.
   */
  readonly measureRows: () => readonly ToolRowRect[];
  /**
   * The rendered subgroups the rows partition into — the columns section's
   * pin groups, or a single constant group for a list with no partition
   * (`dropTargetForPointer` is the shared geometry and speaks in groups, so
   * an unpartitioned list presents itself as exactly one).
   */
  readonly groups: readonly ToolDropGroup[];
  /**
   * Apply a finished move. Called ONLY from a release over a resolved
   * target — never on drag-leave, mid-move, or a cancelled gesture — so a
   * section's commit can assume "commit on drop" without restating it. The
   * commit should re-read its model at commit time rather than trust a
   * render-closure snapshot; that rationale lives with each section's commit,
   * because what there is to re-read differs.
   */
  readonly commit: (columnId: string, target: ToolDropTarget) => void;
}

/** The pointer handlers to spread onto one row's grip. */
export interface ToolRowGripHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  readonly onPointerCancel: () => void;
}

export interface ToolRowDrag {
  /** The in-flight drag, or null. Null until the threshold is crossed. */
  readonly drag: ActiveToolRowDrag | null;
  /** Handlers for the grip of the row identified by `columnId`. */
  readonly gripHandlers: (columnId: string) => ToolRowGripHandlers;
}

export function useToolRowDrag({
  measureRows,
  groups,
  commit,
}: ToolRowDragOptions): ToolRowDrag {
  // The press-in-progress lives in a ref (every pointermove reads it, most
  // discard it under the threshold); only a drag past the threshold becomes
  // state, because only then does the render change.
  const pendingDragRef = useRef<PendingRowDrag | null>(null);
  const [drag, setDrag] = useState<ActiveToolRowDrag | null>(null);

  const endDrag = useCallback(() => {
    pendingDragRef.current = null;
    setDrag(null);
  }, []);

  // Escape mid-drag cancels without engine mutation — the rule every drag
  // surface follows (the header reorder in its keydown, the chip drag on a
  // document listener like this one). Nothing has been committed at any
  // point during the drag, so abandoning the gesture IS the restore.
  // `preventDefault` also tells the pane's own Escape handler (which skips
  // defaultPrevented events) not to yank focus to the rail tab over a mere
  // gesture cancel — though only when focus sits OUTSIDE the pane, since a
  // document bubble listener runs after the React-root handler; the chip
  // drag's cancel has the same characteristic.
  const dragActive = drag !== null;
  useEffect(() => {
    if (!dragActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      event.preventDefault();
      endDrag();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dragActive, endDrag]);

  // Plain per-render closures over `measureRows`/`groups`/`commit`, exactly
  // as the sections' inline handlers were: the drag geometry must follow the
  // CURRENT render's rows, not a memoized snapshot of an earlier one.
  const gripHandlers = (columnId: string): ToolRowGripHandlers => ({
    // No stopPropagation — deliberately: this pointerdown must reach the
    // document so an open popover's outside-press close fires (the columns
    // section's pin menu, the grouping section's add menu). Starting a drag
    // dismisses such a menu through the same mechanism any outside press
    // does.
    onPointerDown: (event) => {
      if (event.button !== 0) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey) return;
      pendingDragRef.current = {
        columnId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
      };
      // Capture NOW, not after the threshold — the chip drag's rule
      // (GroupPanel), and load-bearing on a ~16px handle: engines
      // rAF-coalesce pointermoves, so under load the first DELIVERED move
      // can already be outside the grip, and a capture taken in the move
      // handler never happens — the drag silently dies. The 5px threshold
      // still gates the dragging STATE, so a plain click never flickers the
      // indicator.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // jsdom, or a pointer type without capture — no-op.
      }
    },
    onPointerMove: (event) => {
      const pending = pendingDragRef.current;
      if (pending === null || pending.columnId !== columnId) return;
      if (event.pointerId !== pending.pointerId) return;
      if (!pending.dragging) {
        const dist = Math.hypot(
          event.clientX - pending.startX,
          event.clientY - pending.startY,
        );
        if (dist < DRAG_THRESHOLD_PX) return;
        pending.dragging = true;
      }
      // Measured fresh on every move (the pane scrolls without a render);
      // the pure function is the geometry authority, tested where jsdom
      // cannot follow.
      const target = dropTargetForPointer(event.clientY, measureRows(), groups);
      setDrag(target === null ? null : { columnId, target });
    },
    // Commit on drop, never on drag-leave or mid-move — the header drag's
    // settled rule: nothing mutates until the pointer is released over a
    // target. The target is resolved from the RELEASE coordinates, measured
    // here and now: both engines routinely coalesce away the last
    // pointermove before a quick release, so any target tracked during the
    // moves can be one step behind where the user actually let go —
    // measured as a cross-boundary drop landing on the wrong side of the
    // subgroup split, in Chromium and WebKit alike.
    onPointerUp: (event) => {
      const pending = pendingDragRef.current;
      if (pending === null || event.pointerId !== pending.pointerId) return;
      const wasDragging = pending.dragging;
      endDrag();
      if (!wasDragging) return;
      const target = dropTargetForPointer(event.clientY, measureRows(), groups);
      if (target !== null) {
        commit(pending.columnId, target);
      }
    },
    onPointerCancel: endDrag,
  });

  return { drag, gripHandlers };
}
