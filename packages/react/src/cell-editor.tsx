import { TextCellEditor } from "./editors/TextCellEditor";
import type { PretableEditorInput } from "./types";

export interface CellEditorProps {
  input: PretableEditorInput;
}

function editorFor(input: PretableEditorInput) {
  // Boolean columns never reach this popover path (the cell control commits
  // directly); enum/date fall back to text until sub-projects 2/3 land.
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
