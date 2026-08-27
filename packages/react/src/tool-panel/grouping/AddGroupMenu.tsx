import type { CSSProperties } from "react";

import { useMenuKeyboard } from "../../overlay/menu-keyboard";
import { OverlayPortal } from "../../overlay/OverlayPortal";
import type { GroupingSectionMessages } from "../messages";

/**
 * The `+ Add group` popover: one item per schema data column not currently
 * grouped — there is no `groupable` flag in the schema, and `applyRowGroups`
 * already de-dupes and filters to schema ids, so eligibility is "any data
 * column not yet grouped" (spec decision 9). The CALLER computes that list;
 * this menu only renders what it is handed.
 *
 * Portaled for the pane's standing reason — the grid viewport's
 * `contain: content` makes it the containing block for `position: fixed`
 * descendants AND clips them — and it wears the popover contract's styling
 * attributes (`data-pretable-popover` + `data-pretable-column-menu` on the
 * container, `data-pretable-menu-item` on items) exactly as `ColumnPinMenu`
 * does, so grid.css styles it with zero new rules.
 * `data-pretable-add-group-menu` is its own identity on top: this is not a
 * per-column menu, and a test or consumer must be able to tell it from one.
 *
 * Keyboard, first-item focus and dismissal come from `useMenuKeyboard` — the
 * shared menu contract, never a per-menu copy. Focus return is the caller's,
 * via `onClose`/`onSelect`: only the section knows the add button.
 */
export function AddGroupMenu({
  options,
  style,
  onSelect,
  onClose,
  messages,
}: {
  /** Ungrouped schema columns, in schema order — id plus resolved label. */
  options: readonly { readonly id: string; readonly label: string }[];
  style?: CSSProperties;
  onSelect: (columnId: string) => void;
  /** `restoreFocus` false only for outside clicks, which chose a new target. */
  onClose: (restoreFocus: boolean) => void;
  /** Resolved surface messages — this component defaults no string itself. */
  messages: GroupingSectionMessages;
}) {
  const { rootRef, onKeyDown } = useMenuKeyboard(onClose);

  return (
    <OverlayPortal>
      <div
        ref={rootRef}
        role="menu"
        aria-label={messages.toolPanelAddRowGroupLabel()}
        data-pretable-add-group-menu=""
        data-pretable-column-menu=""
        data-pretable-popover=""
        style={style}
        onKeyDown={onKeyDown}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            role="menuitem"
            data-pretable-menu-item=""
            data-pretable-column-id={option.id}
            onClick={() => onSelect(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </OverlayPortal>
  );
}
