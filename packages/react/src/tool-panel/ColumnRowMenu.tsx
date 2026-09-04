import { createElement, type CSSProperties } from "react";

import { CheckIcon } from "../icons";
import { useMenuKeyboard } from "../overlay/menu-keyboard";
import { OverlayPortal } from "../overlay/OverlayPortal";
import type { ColumnRowMenuMessages } from "./messages";

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
 * The columns-section row's kebab popover: the three pin placements (the
 * row's current one disabled) and the auto-width toggle.
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
 * Two activation behaviors on purpose. A pin item is a one-shot placement
 * COMMAND — selecting it closes the menu (`onSelect`, and the row moves out
 * from under the anchor anyway). The auto-width item is a `menuitemcheckbox`
 * MODE BIT — toggling it stays open, the native menuitemcheckbox pattern, so
 * the flip is visible where it was made and can be flipped straight back.
 * Its `aria-checked` updates live while open because the section re-renders
 * this menu from its auto-set subscription on every store publish.
 *
 * Focus return is the CALLER's job, via `onClose`/`onSelect`: a pin change
 * moves the row across subgroup fragments, remounting the kebab, so only the
 * section (with its per-id node map) can find the button again.
 */
export function ColumnRowMenu({
  columnId,
  label,
  pinned,
  autoWidth,
  style,
  onSelect,
  onToggleAutoWidth,
  onClose,
  messages,
}: {
  columnId: string;
  label: string;
  pinned: "left" | "right" | null;
  /** Live auto-set membership — the checkbox's checked state. */
  autoWidth: boolean;
  style?: CSSProperties;
  onSelect: (pinned: "left" | "right" | null) => void;
  /** Flips the column's auto-width mode bit; the menu stays open. */
  onToggleAutoWidth: () => void;
  /** `restoreFocus` false only for outside clicks, which chose a new target. */
  onClose: (restoreFocus: boolean) => void;
  /** Resolved surface messages — this component defaults no string itself. */
  messages: ColumnRowMenuMessages;
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
        {/* Divides the one-shot placement COMMANDS above from the mode bit
            below — two kinds of item with two activation behaviors, which
            without a rule between them read as one flat list of four. A real
            role="separator": `useMenuKeyboard` roves over
            [data-pretable-menu-item] only, so it is skipped by construction. */}
        <div role="separator" data-pretable-menu-separator="" />
        {/* "Let the grid manage this column's width" — a mode bit over the
            auto-width store, NOT a fit-to-content action (spec B1/Fact 2).
            The check glyph trails the label so the label's position is
            identical in both states with no reserved leading slot. */}
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={autoWidth}
          data-pretable-menu-item=""
          data-pretable-menu-action="auto-width"
          onClick={onToggleAutoWidth}
        >
          {messages.toolPanelAutoWidthLabel()}
          {autoWidth ? <CheckIcon /> : null}
        </button>
      </div>
    </OverlayPortal>
  );
}
