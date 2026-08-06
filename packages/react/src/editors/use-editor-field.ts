import { useEffect, useRef } from "react";

import type { PretableEditorInput } from "../types";

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  "checking",
  "validating",
  "saving",
]);

/**
 * Shared field chrome for typed cell editors: autofocus (select-all, or
 * caret-at-end when the draft was seeded by type-to-replace), ARIA
 * (label/invalid/errormessage/busy), readOnly-while-pending, blur-commit
 * guarded to the editing phase, and Enter/Tab/Escape commit keys.
 */
export function useEditorField<
  E extends HTMLInputElement | HTMLTextAreaElement,
>(input: PretableEditorInput) {
  const ref = useRef<E>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    if (input.seededFromTyping) {
      // The draft IS the character the user just typed: collapse the caret
      // after it so the next keystroke appends rather than replacing.
      const end = el.value.length;
      el.setSelectionRange(end, end);
    } else {
      el.select();
    }
    // Mount-only: the entry path can't change for the life of one edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
