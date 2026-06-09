import { useEffect, useRef } from "react";

import type { PretableEditorInput } from "./types";

export interface CellEditorProps {
  input: PretableEditorInput;
}

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  "checking",
  "validating",
  "saving",
]);

/**
 * Renders a column's `renderEditor` if present, otherwise a default text input
 * that drives the active edit's draft, commit/cancel, blur-to-commit, and
 * surfaces validation/commit errors + pending state with ARIA.
 */
export function CellEditor({ input }: CellEditorProps) {
  const ref = useRef<HTMLInputElement>(null);

  // Autofocus + select on mount so type-to-replace and immediate typing work.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (input.column.renderEditor) {
    return <>{input.column.renderEditor(input)}</>;
  }

  const pending = PENDING_STATUSES.has(input.status);

  return (
    <>
      <input
        ref={ref}
        className="pretable-cell-editor"
        aria-label={input.column.header ?? input.columnId}
        aria-invalid={input.error ? true : undefined}
        aria-busy={pending ? true : undefined}
        readOnly={pending}
        value={String(input.draft ?? "")}
        onChange={(e) => input.setDraft(e.target.value)}
        onBlur={() => {
          // Commit in place (no direction → no focus move). Guarded to the
          // editing phase so a blur during an in-flight validate/save can't
          // double-submit; a blur from unmount-after-commit is a safe no-op.
          if (input.status === "editing") input.commit();
        }}
        onKeyDown={(e) => {
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
        }}
      />
      {input.error ? (
        <div data-pretable-edit-error role="alert">
          {input.error}
        </div>
      ) : null}
    </>
  );
}
