import type { CSSProperties } from "react";

import { useMenuKeyboard } from "../overlay/menu-keyboard";
import { OverlayPortal } from "../overlay/OverlayPortal";
import type { ColumnPinMenuMessages } from "./messages";

/**
 * The three placements, in menu order. Structure only — the item's WORDS come
 * from `toolPanelPinLabel`, so the surface's messages layer is the one place
 * the panel's English lives.
 */
const PIN_MENU_ITEMS = [
  { pinned: "left", action: "pin-left" },
  { pinned: "right", action: "pin-right" },
  { pinned: null, action: "unpin" },
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
 * rules, and `useMenuKeyboard` for the focus/keyboard/dismissal contract
 * every list-shaped menu here shares.
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
  messages,
}: {
  columnId: string;
  label: string;
  pinned: "left" | "right" | null;
  style?: CSSProperties;
  onSelect: (pinned: "left" | "right" | null) => void;
  /** `restoreFocus` false only for outside clicks, which chose a new target. */
  onClose: (restoreFocus: boolean) => void;
  /** Resolved surface messages — this component defaults no string itself. */
  messages: ColumnPinMenuMessages;
}) {
  const { rootRef, onKeyDown } = useMenuKeyboard(onClose);

  return (
    <OverlayPortal>
      <div
        ref={rootRef}
        role="menu"
        aria-label={messages.toolPanelColumnMenuLabel({ label })}
        data-pretable-column-menu=""
        data-pretable-column-id={columnId}
        data-pretable-popover=""
        style={style}
        onKeyDown={onKeyDown}
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
            {messages.toolPanelPinLabel({ pinned: item.pinned })}
          </button>
        ))}
      </div>
    </OverlayPortal>
  );
}
