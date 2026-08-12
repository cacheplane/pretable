// packages/react/src/column-menu/MenuButton.tsx
import type { CSSProperties } from "react";
import { OverflowIcon } from "../icons";

/**
 * The `⋮` that opens a column's menu. It joins the funnel in the header's
 * trailing overlay strip — a sibling of the header `<button>`, never a child
 * of it, because an interactive control inside a button is invalid HTML.
 */
export function MenuButton({
  columnId,
  label,
  open,
  style,
  onNodeChange,
  onToggle,
}: {
  columnId: string;
  label: string;
  open: boolean;
  style?: CSSProperties;
  onNodeChange?: (columnId: string, node: HTMLButtonElement | null) => void;
  onToggle: (columnId: string, anchor: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      data-pretable-column-menu-button=""
      data-pretable-column-id={columnId}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-label={`Column menu for ${label}`}
      ref={(node) => onNodeChange?.(columnId, node)}
      style={style}
      // Load-bearing, exactly as on FunnelButton: React delegates at the root
      // container, so stopping here also keeps the pointerdown off `document`
      // — where the open ColumnMenu listens for outside-clicks. Without it,
      // pointerdown would close the menu and the following click would reopen
      // it, so the menu could never be dismissed by clicking its own button.
      // Covered by "closes on a real pointerdown+click on its own button".
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(columnId, e.currentTarget);
      }}
    >
      <OverflowIcon />
    </button>
  );
}
