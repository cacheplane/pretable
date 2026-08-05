import type { PretableEditStatus } from "@pretable/core";

export interface BooleanCellControlProps {
  checked: boolean;
  editable: boolean;
  /** Edit status when this cell holds the active edit, else null. */
  status: PretableEditStatus | null;
  /**
   * Id of the rendered error element when this cell's edit failed
   * (validate/onCellEdit error); wires aria-invalid + aria-errormessage.
   */
  errorId?: string;
  label: string;
  onToggle: () => void;
}

/**
 * In-cell boolean control: toggles-and-commits directly (no editor popover).
 * Non-editable cells render the same control disabled for a consistent look.
 * Stays enabled in failed states (`editing`-with-error / `error`) so a click
 * can cancel-and-retry the toggle.
 */
export function BooleanCellControl({
  checked,
  editable,
  status,
  errorId,
  label,
  onToggle,
}: BooleanCellControlProps) {
  const busy =
    status === "checking" || status === "validating" || status === "saving";
  return (
    <button
      type="button"
      role="checkbox"
      data-pretable-bool-cell=""
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-invalid={errorId ? true : undefined}
      aria-errormessage={errorId}
      disabled={!editable || busy}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked ? "✓" : ""}
    </button>
  );
}
