import {
  createGrid,
  type PretableColumn,
  type PretableRow,
} from "@pretable/core";

export interface PretableProps<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn[];
  rows: TRow[];
}

export function Pretable<TRow extends PretableRow = PretableRow>({
  columns,
  rows,
}: PretableProps<TRow>) {
  const grid = createGrid({ columns, rows });

  return (
    <section aria-label="Pretable React adapter">
      <p>Pretable React adapter</p>
      <p>Rows: {grid.options.rows.length}</p>
      <p>Columns: {grid.options.columns.length}</p>
    </section>
  );
}
