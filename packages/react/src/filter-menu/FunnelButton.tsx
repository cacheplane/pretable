// packages/react/src/filter-menu/FunnelButton.tsx
import { createElement, type CSSProperties } from "react";
import { useOverlayContainer } from "../overlay/portal-context";
import { usePretableComponents } from "../components/context";
import { FunnelIcon } from "../icons";

export function FunnelButton({
  columnId,
  label,
  active,
  open,
  style,
  onToggle,
}: {
  columnId: string;
  label: string;
  active: boolean;
  open: boolean;
  style?: CSSProperties;
  onToggle: (columnId: string, anchor: HTMLElement) => void;
}) {
  const { IconButton } = usePretableComponents();
  const overlayReady = useOverlayContainer() !== null;

  return (
    <IconButton
      site="filter-funnel"
      data-pretable-filter-funnel=""
      data-pretable-column-id={columnId}
      data-pretable-filter-active={active ? "true" : "false"}
      aria-haspopup="dialog"
      aria-expanded={open && overlayReady}
      aria-label={`Filter ${label}`}
      style={style}
      // Out of the sequential tab order, exactly like the row-select checkbox
      // and every non-focused cell: you reach it by moving the grid's focus
      // cursor to this column's header and pressing the documented key, not by
      // Tabbing. Left at the browser default this was one extra tab stop PER
      // COLUMN in Chromium — 10 on a five-column grid, 40 on a twenty-column
      // one — and zero in Safari, which keeps bare <button>s out of the
      // sequential order. Neither number was the contract.
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(columnId, e.currentTarget);
      }}
    >
      <FunnelIcon />
    </IconButton>
  );
}
