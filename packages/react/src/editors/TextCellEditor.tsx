import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

export function TextCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, fieldProps } = useEditorField<HTMLInputElement>(input);
  return (
    <input
      ref={ref}
      className="pretable-cell-editor"
      value={String(input.draft ?? "")}
      onChange={(e) => input.setDraft(e.target.value)}
      {...fieldProps}
    />
  );
}
