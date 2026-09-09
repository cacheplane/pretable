// packages/react/src/column-menu/MenuButton.tsx
import { createElement, type CSSProperties } from "react";
import { useOverlayContainer } from "../overlay/portal-context";
import { usePretableComponents } from "../components/context";
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
  const { IconButton } = usePretableComponents();
  const overlayReady = useOverlayContainer() !== null;

  return (
    <IconButton
      site="column-menu-button"
      data-pretable-column-menu-button=""
      data-pretable-column-id={columnId}
      aria-haspopup="menu"
      aria-expanded={open && overlayReady}
      aria-label={`Column menu for ${label}`}
      ref={(node) => onNodeChange?.(columnId, node)}
      style={style}
      // Out of the sequential tab order, for the same reason as FunnelButton:
      // the header joined the grid's roving-tabindex model, so this is reached
      // by moving the focus cursor onto the column header and pressing the
      // documented key. `.focus()` still works on it — which is what lets
      // ColumnMenu restore focus here on Escape.
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(columnId, e.currentTarget);
      }}
    >
      <OverflowIcon />
    </IconButton>
  );
}
