// packages/react/src/column-menu/ColumnMenu.tsx
import { useEffect, useRef, type CSSProperties, type JSX } from "react";

import { OverlayPortal } from "../overlay/OverlayPortal";

/** What a menu item does when chosen. */
export type ColumnMenuAction = "group" | "ungroup";

const ACTION_LABELS: Record<ColumnMenuAction, string> = {
  group: "Group by this column",
  ungroup: "Ungroup this column",
};

/**
 * The `⋮` popover: the pointer-free way to change the grouping.
 *
 * It is a real `role="menu"` — the first in this package, since the only other
 * header popover (`FilterMenu`) is a `role="dialog"` full of form controls.
 *
 * **Exactly one item is ever shown**, decided by whether the column is already
 * a grouping level. There is no arrow-key roving between items for that
 * reason; add it the day a second item lands.
 *
 * The **Ungroup** branch is only reachable with the engine's
 * `hideGroupedColumns: false`, because at its default a grouped column loses
 * its header — and with it its ⋮ — the moment it is grouped. `PretableSurface`
 * does not forward that option today, so through the surface this branch is
 * unreachable and the chip's ✕ is the ungroup affordance. The branch still
 * exists (and is unit-tested here directly) because the menu is the accessible
 * path and must not be wrong the day the option is plumbed through.
 */
export function ColumnMenu({
  anchor,
  columnId,
  grouped,
  label,
  style,
  onSelect,
  onClose,
}: {
  /** The `⋮` that opened the menu; Escape returns focus here when it survives. */
  anchor: HTMLElement | null;
  columnId: string;
  /** Whether this column is currently one of the grouping levels. */
  grouped: boolean;
  label: string;
  style?: CSSProperties;
  onSelect: (action: ColumnMenuAction) => void;
  onClose: () => void;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const action: ColumnMenuAction = grouped ? "ungroup" : "group";

  // A menu opened from a button owns the focus while it is up.
  useEffect(() => {
    firstItemRef.current?.focus();
  }, []);

  // Outside-click → close. No focus return: the click is already moving focus
  // somewhere the user chose, and yanking it back to the ⋮ would fight that.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  const dismiss = (restoreFocus: boolean) => {
    onClose();
    if (restoreFocus && anchor?.isConnected) {
      anchor.focus();
    }
  };

  return (
    <OverlayPortal>
      <div
        ref={rootRef}
        role="menu"
        aria-label={`Column menu for ${label}`}
        data-pretable-column-menu=""
        data-pretable-column-id={columnId}
        data-pretable-popover=""
        style={style}
        onKeyDown={(event) => {
          if (event.key !== "Escape" && event.key !== "Esc") return;
          // Owned here rather than left to the surface's shared popover hook,
          // because closing is only half of it — focus has to travel back to
          // the button the menu was opened from, or the keyboard user is
          // dumped on <body>.
          event.stopPropagation();
          event.preventDefault();
          dismiss(true);
        }}
      >
        <button
          ref={firstItemRef}
          type="button"
          role="menuitem"
          data-pretable-menu-item=""
          data-pretable-menu-action={action}
          onClick={() => {
            onSelect(action);
            onClose();
          }}
        >
          {ACTION_LABELS[action]}
        </button>
      </div>
    </OverlayPortal>
  );
}
