import { useLayoutEffect } from "react";

import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

export function MultilineCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, fieldProps } = useEditorField<HTMLTextAreaElement>(input);

  // Auto-grow with the draft; the skin caps growth via max-height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, input.draft]);

  return (
    <textarea
      ref={ref}
      className="pretable-cell-editor"
      data-pretable-multiline-editor=""
      rows={1}
      value={String(input.draft ?? "")}
      onChange={(e) => input.setDraft(e.target.value)}
      {...fieldProps}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
          // Plain Enter = newline: keep the default, stop the grid handler.
          e.stopPropagation();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          input.commit("down");
          return;
        }
        fieldProps.onKeyDown(e);
      }}
    />
  );
}
