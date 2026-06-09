import type { ReactNode } from "react";
import type {
  PretableColumn as PretableBaseColumn,
  PretableEditInput,
  PretableFocusDirection,
  PretableFormatInput,
  PretableRow,
} from "@pretable/core";

/**
 * React-extended column definition. Adds the `render` and `renderHeader` JSX-typed callbacks on top of `@pretable/core`'s base column.
 *
 * @public
 */
export interface PretableColumn<
  TRow extends PretableRow = PretableRow,
> extends PretableBaseColumn<TRow> {
  render?: (input: PretableCellRenderInput<TRow>) => ReactNode;
  renderHeader?: (input: PretableHeaderRenderInput<TRow>) => ReactNode;
  renderEditor?: (input: PretableEditorInput<TRow>) => ReactNode;
}

/**
 * Input passed to a column's `renderEditor`. Extends the engine edit input with
 * draft controls bound to the active edit. `commit` accepts the focus direction
 * to move after a successful commit (Enter → "down", Tab → "right").
 *
 * @public
 */
export interface PretableEditorInput<
  TRow extends PretableRow = PretableRow,
> extends Omit<PretableEditInput<TRow>, "column"> {
  column: PretableColumn<TRow>;
  draft: unknown;
  setDraft: (value: unknown) => void;
  commit: (direction?: PretableFocusDirection) => void;
  cancel: () => void;
}

/**
 * Input passed to a column's `render` function.
 *
 * @public
 */
export interface PretableCellRenderInput<
  TRow extends PretableRow = PretableRow,
> extends PretableFormatInput<TRow> {
  formattedValue: string;
  rowId: string;
  rowIndex: number;
  isFocused: boolean;
  isSelected: boolean;
}

/**
 * Input passed to a column's `renderHeader` function.
 *
 * @public
 */
export interface PretableHeaderRenderInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  label: string;
  sortDirection: "asc" | "desc" | null;
  isSorted: boolean;
}

export type { PretableFormatInput };
