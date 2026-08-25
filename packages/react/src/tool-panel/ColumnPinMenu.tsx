import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import { OverlayPortal } from "../overlay/OverlayPortal";

const PIN_MENU_ITEMS = [
  { pinned: "left", label: "Pin left", action: "pin-left" },
  { pinned: "right", label: "Pin right", action: "pin-right" },
  { pinned: null, label: "Unpin", action: "unpin" },
] as const;

/**
 * The kebab's popover: three pin placements, the row's current one disabled.
 *
 * Portaled for the same reason every popover here is — the grid viewport's
 * `contain: content` makes it the containing block for `position: fixed`
 * descendants AND clips them, so an inline menu would be trapped inside the
 * pane's scroll box. It reuses the header ColumnMenu's attribute contract
 * (`data-pretable-popover` + `data-pretable-column-menu` on the container,
 * `data-pretable-menu-item` on items) so grid.css styles it with zero new
 * rules.
 *
 * Focus return is the CALLER's job, via `onClose`/`onSelect`: a pin change
 * moves the row across subgroup fragments, remounting the kebab, so only the
 * section (with its per-id node map) can find the button again.
 */
export function ColumnPinMenu({
  columnId,
  label,
  pinned,
  style,
  onSelect,
  onClose,
}: {
  columnId: string;
  label: string;
  pinned: "left" | "right" | null;
  style?: CSSProperties;
  onSelect: (pinned: "left" | "right" | null) => void;
  /** `restoreFocus` false only for outside clicks, which chose a new target. */
  onClose: (restoreFocus: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  const enabledItems = () =>
    Array.from(
      rootRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-pretable-menu-item]:not(:disabled)",
      ) ?? [],
    );

  // A menu opened from a button owns the focus while it is up. The first
  // ENABLED item: the current pin state is disabled and may well be first.
  useEffect(() => {
    enabledItems()[0]?.focus();
  }, []);

  // Outside-click → close. No focus return: the click is already moving focus
  // somewhere the user chose, and yanking it back would fight that.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) {
        onClose(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <OverlayPortal>
      <div
        ref={rootRef}
        role="menu"
        aria-label={`${label} column menu`}
        data-pretable-column-menu=""
        data-pretable-column-id={columnId}
        data-pretable-popover=""
        style={style}
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "Esc") {
            // `preventDefault`, NOT `stopPropagation`: the pane's own Escape
            // handler (which yanks focus to the rail tab) skips events that
            // are defaultPrevented — that check is the designed interlock,
            // and the portal still bubbles through the React tree to it.
            event.preventDefault();
            onClose(true);
            return;
          }
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const items = enabledItems();
          if (items.length === 0) return;
          const index = items.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const delta = event.key === "ArrowDown" ? 1 : -1;
          items[(index + delta + items.length) % items.length]?.focus();
        }}
      >
        {PIN_MENU_ITEMS.map((item) => (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            data-pretable-menu-item=""
            data-pretable-menu-action={item.action}
            disabled={pinned === item.pinned}
            onClick={() => onSelect(item.pinned)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </OverlayPortal>
  );
}
