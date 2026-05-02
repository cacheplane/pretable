import {
  type PretableColumn,
  type PretableGridOptions,
  type PretableRow,
} from "@pretable/core";

import { PretableSurface } from "@pretable-internal/react-surface";

export interface PretableProps<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  getRowId?: PretableGridOptions<TRow>["getRowId"];
  rows: TRow[];
}

const VIEWPORT_HEIGHT = 320;
const BENCHMARK_VIEWPORT_STYLE = {
  contain: "none",
  containIntrinsicSize: "none",
  contentVisibility: "visible",
  overflowAnchor: "none",
  overscrollBehavior: "contain",
} as const;

export function Pretable<TRow extends PretableRow = PretableRow>({
  columns,
  getRowId,
  rows,
}: PretableProps<TRow>) {
  const resolvedGetRowId =
    getRowId ??
    ((row: TRow, index: number) => {
      const candidate = row.id;

      if (typeof candidate === "string" || typeof candidate === "number") {
        return String(candidate);
      }

      return String(index);
    });

  return (
    <section
      aria-label="Pretable React adapter"
      style={{
        display: "grid",
        gap: 12,
      }}
    >
      <header>
        <p
          style={{
            margin: 0,
            fontWeight: 700,
          }}
        >
          Pretable React adapter
        </p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>Rows: {rows.length}</p>
        <p style={{ margin: "4px 0 0", opacity: 0.8 }}>
          Columns: {columns.length}
        </p>
      </header>

      <PretableSurface
        ariaLabel="Pretable React adapter"
        columns={columns}
        getRowId={resolvedGetRowId}
        renderBodyCell={({ column, value }) => (
          <>
            <strong
              style={{
                display: "block",
                fontSize: 12,
                lineHeight: "16px",
                marginBottom: 4,
                opacity: 0.7,
              }}
            >
              {column.header ?? column.id}
            </strong>
            <span
              style={{
                display: "block",
                lineHeight: "22px",
              }}
            >
              {String(value ?? "")}
            </span>
          </>
        )}
        renderHeaderCell={({ label, sortDirection }) => (
          <>
            <span>{label}</span>
            <strong
              style={{
                fontSize: 12,
                lineHeight: "16px",
                opacity: 0.7,
              }}
            >
              {sortDirection === "desc"
                ? "Newest"
                : sortDirection === "asc"
                  ? "Oldest"
                  : "Sort"}
            </strong>
          </>
        )}
        rows={rows}
        viewportStyle={BENCHMARK_VIEWPORT_STYLE}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </section>
  );
}
