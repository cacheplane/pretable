import { useCallback, useRef } from "react";

import { editorCommitDirection, useCompositionGuard } from "./editor-keyboard";
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
  const ref = useRef<E | null>(null);
  const composition = useCompositionGuard();
  const seededFromTyping = input.seededFromTyping;
  const attachRef = useCallback(
    (el: E | null) => {
      ref.current = el;
      if (!el) return;
      // Focus each actual field attachment, including a changed replacement slot.
      // Ordinary draft/status renders retain this callback and leave the caret alone.
      el.focus();
      if (seededFromTyping) {
        const end = el.value.length;
        el.setSelectionRange(end, end);
      } else {
        el.select();
      }
    },
    [seededFromTyping],
  );

  const pending = PENDING_STATUSES.has(input.status);
  const errorId = `pretable-edit-error-${input.rowId}-${input.columnId}`;

  return {
    ref,
    attachRef,
    pending,
    errorId,
    isComposing: composition.isComposing,
    fieldProps: {
      onCompositionStart: composition.onCompositionStart,
      onCompositionEnd: composition.onCompositionEnd,
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
        if (composition.isComposing(e)) return;
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          if (!pending) input.commit(editorCommitDirection(e));
        } else if (e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          if (!pending) input.commit(editorCommitDirection(e));
        } else if (e.key === "Escape" || e.key === "Esc") {
          e.preventDefault();
          e.stopPropagation();
          input.cancel();
        }
      },
    },
  };
}
