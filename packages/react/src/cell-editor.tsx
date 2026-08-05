import { MultilineCellEditor } from "./editors/MultilineCellEditor";
import { NumberCellEditor } from "./editors/NumberCellEditor";
import { TextCellEditor } from "./editors/TextCellEditor";
import type { PretableEditorInput } from "./types";

export interface CellEditorProps {
  input: PretableEditorInput;
}

function editorFor(input: PretableEditorInput) {
  const type = input.column.type ?? "text";
  if (type === "number") return <NumberCellEditor input={input} />;
  if (type === "text" && input.column.wrap)
    return <MultilineCellEditor input={input} />;
  // enum/date fall back to text until sub-projects 2/3; boolean never reaches
  // this popover path (the cell control commits directly).
  return <TextCellEditor input={input} />;
}

/**
 * Dispatches the active edit to the column's editor: `renderEditor` wins,
 * else the built-in editor for `column.type`. Renders the shared error
 * element for every built-in editor.
 */
export function CellEditor({ input }: CellEditorProps) {
  if (input.column.renderEditor) {
    return <>{input.column.renderEditor(input)}</>;
  }
  const errorId = `pretable-edit-error-${input.rowId}-${input.columnId}`;
  return (
    <>
      {editorFor(input)}
      {input.error ? (
        <div id={errorId} data-pretable-edit-error role="alert">
          {input.error}
        </div>
      ) : null}
    </>
  );
}
