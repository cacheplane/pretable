import { usePretableComponents } from "../components/context";
import { createElement } from "react";

import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

export function TextCellEditor({ input }: { input: PretableEditorInput }) {
  const { TextInput } = usePretableComponents();
  const { attachRef, pending, fieldProps } =
    useEditorField<HTMLInputElement>(input);
  return (
    <TextInput
      site="cell-editor"
      ref={attachRef}
      className="pretable-cell-editor"
      value={String(input.draft ?? "")}
      onChange={(e) => {
        if (!pending) input.setDraft(e.target.value);
      }}
      {...fieldProps}
    />
  );
}
