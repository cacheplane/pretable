import type { PointerEvent as ReactPointerEvent } from "react";
import {
  createElement,
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { focusTab } from "./focus";
import type { PaneResizeDirection, PaneWidthBounds } from "./pane-resize";
import { paneWidthAfterDrag, paneWidthAfterKey } from "./pane-resize";
import { Rail } from "./Rail";
import type { ToolPanelSectionDescriptor } from "./sections";

/**
 * The writing direction the resize arithmetic keys on, read from the
 * RENDERED handle. The `dir` attribute is consulted before the computed
 * style, not after: an explicit `dir="rtl"` is the common way a consumer
 * flips the surface, and jsdom — where the keyboard tests run — does not
 * cascade the attribute into `getComputedStyle().direction`.
 */
function resolveDirection(el: Element): PaneResizeDirection {
  const attr = el.closest("[dir]")?.getAttribute("dir")?.toLowerCase();
  if (attr === "rtl") return "rtl";
  if (attr === "ltr") return "ltr";
  const view = el.ownerDocument.defaultView;
  return view?.getComputedStyle(el).direction === "rtl" ? "rtl" : "ltr";
}

/** A pane-width drag in flight. `startRaw` is what Escape restores. */
interface PaneResizeDrag {
  pointerId: number;
  startX: number;
  /** The committed width at pointerdown — `null` = the stylesheet width. */
  startRaw: number | null;
  /** The RENDERED width at pointerdown, the drag arithmetic's origin. */
  startWidth: number;
  dir: PaneResizeDirection;
  /** True once any move changed the width — gates the dblclick reset. */
  moved: boolean;
}

export interface ToolPanelProps {
  sections: readonly ToolPanelSectionDescriptor[];
  /**
   * Which section is open, or `null` for rail-only. Fully controlled: the
   * shell holds no open/close state, so the surface (Task 6) can offer both
   * controlled and uncontrolled forms without this component knowing which.
   * Ids are plain strings — the shell never assumes a closed vocabulary
   * (SP4 made the roster consumer-composable).
   */
  activeSection: string | null;
  onActiveSectionChange: (next: string | null) => void;
  /**
   * Accessible name for the rail's `tablist`. Required and never defaulted
   * here: the shell's own strings — this and the section tab labels — are
   * owned by the surface's messages layer, so a localizer overrides them in
   * exactly one place.
   *
   * The rule now reaches INSIDE the sections too: every string the columns
   * and filters panes render is a surface message, threaded down as a
   * `messages` prop (see `tool-panel/messages.ts`). Nothing anywhere in this
   * directory may default a user-facing string of its own.
   */
  railLabel: string;
  /** Accessible name for the pane's resize handle — same messages-layer rule. */
  resizeLabel: string;
  /**
   * The pane's width, already clamped by the surface, or `null` for "the
   * stylesheet width — write no inline style" (spec A5). Fully controlled
   * like `activeSection`, and for the same reason.
   */
  paneWidthPx: number | null;
  /** The surface's bounds — `max: null` while its width is unmeasured. */
  paneBounds: PaneWidthBounds;
  /**
   * Reports raw gesture output: live during a drag, per keystroke, and the
   * drag-start width on an Escape cancel (`null` when the drag started from
   * the stylesheet width). The SURFACE clamps — one clamp site for the
   * controlled and uncontrolled forms both.
   */
  onPaneWidthChange: (next: number | null) => void;
  /** Double-click or Enter on the handle — the surface owns what "default" is. */
  onPaneWidthReset: () => void;
}

/**
 * The tool panel shell: a pane and its rail, rendered as siblings in visual
 * order (pane, then rail at the outermost edge) for the parent's flex row to
 * dock against the grid's right side. No wrapper element — the surface owns
 * the layout, and a wrapper here would force it to style through one.
 *
 * The pane exists in the DOM only while open. `display:none` would keep a
 * closed section's state alive, but these sections are projections of engine
 * state, not owners of it — remount is free, and an unmounted pane can never
 * hold a stale focus trap or a hidden tabpanel that screen readers still
 * enumerate.
 */
export function ToolPanel({
  sections,
  activeSection,
  onActiveSectionChange,
  railLabel,
  resizeLabel,
  paneWidthPx,
  paneBounds,
  onPaneWidthChange,
  onPaneWidthReset,
}: ToolPanelProps) {
  const baseId = useId();
  const paneId = `${baseId}-pane`;
  const tabId = (id: string) => `${baseId}-tab-${id}`;
  const railRef = useRef<HTMLDivElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);

  const active =
    activeSection == null
      ? undefined
      : sections.find((s) => s.id === activeSection);

  // What the pane measures while it wears no inline width — the stylesheet
  // width, whatever the consumer's css says it is. This is aria-valuenow's
  // fallback and the origin of a drag or keystroke that starts from the
  // untouched state; `null` where layout cannot answer (jsdom measures 0),
  // in which case aria-valuenow is omitted rather than invented and the
  // first gesture starts from the floor.
  const [measuredPaneWidth, setMeasuredPaneWidth] = useState<number | null>(
    null,
  );
  const activeId = active?.id;
  useLayoutEffect(() => {
    if (activeId === undefined || paneWidthPx !== null) return;
    const el = paneRef.current;
    if (el === null) return;
    const width = Math.round(el.getBoundingClientRect().width);
    setMeasuredPaneWidth(width === 0 ? null : width);
  }, [activeId, paneWidthPx]);

  const dragRef = useRef<PaneResizeDrag | null>(null);
  /** True across the release that ends a real drag — gates the dblclick reset. */
  const wasResizingRef = useRef(false);
  /** Render state only so the Escape document listener below can arm. */
  const [dragActive, setDragActive] = useState(false);
  const currentWidth = paneWidthPx ?? measuredPaneWidth ?? paneBounds.min;

  const cancelDrag = useCallback(() => {
    const drag = dragRef.current;
    if (drag === null) return;
    dragRef.current = null;
    setDragActive(false);
    // Abandoning the gesture is NOT the restore here, unlike the row drags:
    // this drag commits continuously (spec A2, live resize), so the restore
    // is an explicit write of the drag-start width — `null` included, which
    // returns a pane that started untouched to its stylesheet width.
    onPaneWidthChange(drag.startRaw);
  }, [onPaneWidthChange]);

  // Escape mid-drag on a document listener, the register's pattern
  // (`useToolRowDrag`): pointer capture routes the MOVES here, but keyboard
  // events follow DOM focus, which a captured drag can leave anywhere. The
  // handle's own keydown below handles the focused-on-the-handle case first
  // and stops propagation — its comment carries the interlock with the
  // pane's Escape-to-rail-tab courtesy; this listener is the catch-all for
  // focus parked elsewhere, where `preventDefault` is what tells that pane
  // handler (which skips defaultPrevented events) to stand down when it has
  // not already run.
  useEffect(() => {
    if (!dragActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Esc") return;
      event.preventDefault();
      cancelDrag();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dragActive, cancelDrag]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const startWidth =
      paneWidthPx ??
      (paneRef.current
        ? Math.round(paneRef.current.getBoundingClientRect().width)
        : 0);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startRaw: paneWidthPx,
      startWidth,
      dir: resolveDirection(event.currentTarget),
      moved: false,
    };
    wasResizingRef.current = false;
    setDragActive(true);
    // Capture at pointerdown, the register's rule (`useToolRowDrag`): engines
    // rAF-coalesce pointermoves, so under load the first delivered move can
    // already be off this slim strip, and a capture taken any later never
    // happens — the drag silently dies.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // jsdom, or a pointer type without capture — no-op.
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    const next = paneWidthAfterDrag(
      drag.startWidth,
      drag.startX,
      event.clientX,
      drag.dir,
      paneBounds,
    );
    if (next !== drag.startWidth) drag.moved = true;
    // Applied LIVE — the width goes through the surface's state on every
    // move (chrome-cheap; the grid reflows through the virtualizer's resize
    // observer), so release has nothing left to commit.
    onPaneWidthChange(next);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragActive(false);
    // Survives into the dblclick that two fast press-drag-releases fire —
    // the header resize strip's `wasResizing` guard, same reason.
    wasResizingRef.current = drag.moved;
    try {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    } catch {
      // jsdom — no-op.
    }
  };

  return (
    <>
      {active !== undefined ? (
        <div
          id={paneId}
          ref={paneRef}
          role="tabpanel"
          aria-labelledby={tabId(active.id)}
          data-pretable-tool-pane=""
          // No inline style until someone acts (spec A5): untouched and
          // uncontrolled, the pane keeps its stylesheet width, so the
          // documented consumer css override keeps working. The first
          // drag/keystroke (or a width prop) switches to this inline
          // `inline-size`, which outranks any stylesheet.
          style={paneWidthPx === null ? undefined : { inlineSize: paneWidthPx }}
          // Escape hands focus back to the pane's rail tab — a keydown
          // listener on the container so it works from any control inside,
          // including ones a later section has not built yet. It does not close the
          // pane: dismissal is a decision, focus return is a courtesy.
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.defaultPrevented) {
              event.stopPropagation();
              focusTab(railRef.current, tabId(active.id));
            }
          }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={resizeLabel}
            aria-valuemin={paneBounds.min}
            aria-valuemax={paneBounds.max ?? undefined}
            // Omitted, not invented, while nothing has measured the pane —
            // the untouched jsdom/SSR state has no truthful number to offer.
            aria-valuenow={paneWidthPx ?? measuredPaneWidth ?? undefined}
            tabIndex={0}
            data-pretable-pane-resize=""
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={cancelDrag}
            onDoubleClick={() => {
              // A drag that moved ends with two fast clicks often enough for
              // the header's `wasResizing` guard to exist; same rule here.
              if (wasResizingRef.current) {
                wasResizingRef.current = false;
                return;
              }
              onPaneWidthReset();
            }}
            onKeyDown={(event) => {
              // Escape mid-drag restores the drag-start width. Handled on
              // the handle itself — pointerdown gives it DOM focus in real
              // browsers — with `stopPropagation` as the interlock so the
              // pane's own Escape handler above does not also yank focus to
              // the rail tab over a mere gesture cancel. A cancel with focus
              // parked elsewhere loses only the courtesy restore; release
              // still ends the drag at the live width.
              if (event.key === "Escape" || event.key === "Esc") {
                if (dragRef.current !== null) {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelDrag();
                }
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                onPaneWidthReset();
                return;
              }
              const next = paneWidthAfterKey(event.key, currentWidth, {
                min: paneBounds.min,
                max: paneBounds.max,
                dir: resolveDirection(event.currentTarget),
              });
              if (next === null) return;
              event.preventDefault();
              if (next !== currentWidth || paneWidthPx === null) {
                onPaneWidthChange(next);
              }
            }}
          />
          <div data-pretable-tool-section="">{active.render()}</div>
        </div>
      ) : null}
      <Rail
        label={railLabel}
        sections={sections}
        activeSection={activeSection}
        paneId={paneId}
        tabId={tabId}
        onActiveSectionChange={onActiveSectionChange}
        railRef={railRef}
      />
    </>
  );
}
