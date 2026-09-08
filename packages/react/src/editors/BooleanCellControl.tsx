import { createElement } from "react";
import type { PretableEditStatus } from "@pretable/core";

import { usePretableComponents } from "../components/context";

export interface BooleanCellControlProps {
  checked: boolean;
  editable: boolean;
  /** Edit status when this cell holds the active edit, else null. */
  status: PretableEditStatus | null;
  /**
   * Id of the rendered error element when this cell's edit failed
   * (validation or commit error); wires aria-invalid + aria-errormessage.
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
  const { Checkbox } = usePretableComponents();
  const busy =
    status === "checking" || status === "validating" || status === "saving";
  return (
    <Checkbox
      site="bool-cell"
      data-pretable-bool-cell=""
      checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-invalid={errorId ? true : undefined}
      aria-errormessage={errorId}
      disabled={!editable || busy}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      onCheckedChange={() => onToggle()}
    />
  );
}
