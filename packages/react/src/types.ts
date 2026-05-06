import type { ReactNode } from "react";
import type {
  PretableCoreColumn,
  PretableFormatInput,
  PretableRow,
} from "@pretable/core";

export interface PretableColumn<
  TRow extends PretableRow = PretableRow,
> extends PretableCoreColumn<TRow> {
  render?: (input: PretableCellRenderInput<TRow>) => ReactNode;
  renderHeader?: (input: PretableHeaderRenderInput<TRow>) => ReactNode;
}

export interface PretableCellRenderInput<
  TRow extends PretableRow = PretableRow,
> extends PretableFormatInput<TRow> {
  formattedValue: string;
  rowId: string;
  rowIndex: number;
  isFocused: boolean;
  isSelected: boolean;
}

export interface PretableHeaderRenderInput<
  TRow extends PretableRow = PretableRow,
> {
  column: PretableColumn<TRow>;
  label: string;
  sortDirection: "asc" | "desc" | null;
  isSorted: boolean;
}

export type { PretableFormatInput };
