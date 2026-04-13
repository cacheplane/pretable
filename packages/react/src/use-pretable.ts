import {
  createGrid,
  type PretableColumn,
  type PretableRow,
} from "@pretable/core";
import { useMemo } from "react";

export interface UsePretableOptions<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  rows: TRow[];
}

export function usePretable<TRow extends PretableRow = PretableRow>({
  columns,
  rows,
}: UsePretableOptions<TRow>) {
  return useMemo(() => createGrid({ columns, rows }), [columns, rows]);
}
