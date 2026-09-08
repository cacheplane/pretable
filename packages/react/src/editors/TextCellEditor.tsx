import { createElement } from "react";

import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

export function TextCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  return (
    <input
      ref={ref}
      className="pretable-cell-editor"
      value={String(input.draft ?? "")}
      onChange={(e) => {
        if (!pending) input.setDraft(e.target.value);
      }}
      {...fieldProps}
    />
  );
}
