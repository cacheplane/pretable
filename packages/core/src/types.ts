export interface PretableColumn {
  id: string;
  header?: string;
  wrap?: boolean;
  widthPx?: number;
  pinned?: "left";
}

export type PretableRow = Record<string, unknown>;

export interface PretableGridOptions<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn[];
  rows: TRow[];
}

export interface PretableGrid<TRow extends PretableRow = PretableRow> {
  kind: "pretable-grid";
  options: PretableGridOptions<TRow>;
}
