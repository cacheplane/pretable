import { useEffect, useRef } from "react";

import type { PretableEditorInput } from "./types";

export interface CellEditorProps {
  input: PretableEditorInput;
}

/**
 * Renders a column's `renderEditor` if present, otherwise a default text input
 * that drives the active edit's draft and commit/cancel.
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

  return (
    <input
      ref={ref}
      className="pretable-cell-editor"
      value={String(input.draft ?? "")}
      onChange={(e) => input.setDraft(e.target.value)}
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
  );
}
