import { useEffect, useRef } from "react";

import type { PretableEditorInput } from "../types";

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  "checking",
  "validating",
  "saving",
]);

/**
 * Shared field chrome for typed cell editors: autofocus+select, ARIA
 * (label/invalid/errormessage/busy), readOnly-while-pending, blur-commit
 * guarded to the editing phase, and Enter/Tab/Escape commit keys.
 */
export function useEditorField<
  E extends HTMLInputElement | HTMLTextAreaElement,
>(input: PretableEditorInput) {
  const ref = useRef<E>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const pending = PENDING_STATUSES.has(input.status);
  const errorId = `pretable-edit-error-${input.rowId}-${input.columnId}`;

  return {
    ref,
    pending,
    errorId,
    fieldProps: {
      "aria-label": input.column.header ?? input.columnId,
      "aria-invalid": input.error ? true : undefined,
      "aria-errormessage": input.error ? errorId : undefined,
      "aria-busy": pending ? true : undefined,
      readOnly: pending,
      onBlur: () => {
        // Commit in place (no direction). Guarded to the editing phase so a
        // blur during an in-flight validate/save can't double-submit.
        if (input.status === "editing") input.commit();
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          input.commit("down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          input.commit("right");
        } else if (e.key === "Escape" || e.key === "Esc") {
          e.preventDefault();
          e.stopPropagation();
          input.cancel();
        }
      },
    },
  };
}
