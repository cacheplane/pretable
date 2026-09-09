import { usePretableComponents } from "../components/context";
import { createElement, useLayoutEffect } from "react";

import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

export function MultilineCellEditor({ input }: { input: PretableEditorInput }) {
  const { Textarea } = usePretableComponents();
  const { ref, attachRef, pending, fieldProps, isComposing } =
    useEditorField<HTMLTextAreaElement>(input);

  // Auto-grow with the draft; the skin caps growth via max-height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  });

  return (
    <Textarea
      site="cell-editor"
      ref={attachRef}
      className="pretable-cell-editor"
      data-pretable-multiline-editor=""
      rows={1}
      value={String(input.draft ?? "")}
      onChange={(e) => {
        if (!pending) input.setDraft(e.target.value);
      }}
      {...fieldProps}
      onKeyDown={(e) => {
        if (isComposing(e)) return;
        if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
          // Plain Enter = newline: keep the default, stop the grid handler.
          e.stopPropagation();
          return;
        }
        fieldProps.onKeyDown(e);
      }}
    />
  );
}
