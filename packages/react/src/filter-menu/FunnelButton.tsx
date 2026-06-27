// packages/react/src/filter-menu/FunnelButton.tsx
import type { CSSProperties } from "react";

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
  return (
    <button
      type="button"
      data-pretable-filter-funnel=""
      data-pretable-column-id={columnId}
      data-pretable-filter-active={active ? "true" : "false"}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Filter ${label}`}
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(columnId, e.currentTarget);
      }}
    >
      <svg
        viewBox="0 0 16 16"
        width="11"
        height="11"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M1.5 2.5h13l-5 6v4l-3 1.5v-5.5l-5-6z" fill="currentColor" />
      </svg>
    </button>
  );
}
