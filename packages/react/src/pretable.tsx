import { type PretableGridOptions, type PretableRow } from "@pretable/core";

import { type PretableSurfaceProps, PretableSurface } from "./pretable-surface";
import type { PretableColumn } from "./types";

/**
 * Props for the {@link Pretable} drop-in component.
 *
 * @public
 */
export interface PretableProps<TRow extends PretableRow = PretableRow> {
  columns: PretableColumn<TRow>[];
  /**
   * Stable identity for a row, derived from the row's own data. Required — see
   * {@link PretableGridOptions.getRowId}. There is no positional default at any
   * pretable entry point.
   */
  getRowId: PretableGridOptions<TRow>["getRowId"];
  rows: TRow[];
  rowSelectionColumn?: PretableSurfaceProps<TRow>["rowSelectionColumn"];
  onRowActivate?: PretableSurfaceProps<TRow>["onRowActivate"];
  onRowSelectionChange?: PretableSurfaceProps<TRow>["onRowSelectionChange"];
  tabBehavior?: PretableSurfaceProps<TRow>["tabBehavior"];
  copyWithHeaders?: PretableSurfaceProps<TRow>["copyWithHeaders"];
  onCopy?: PretableSurfaceProps<TRow>["onCopy"];
  copyToClipboard?: PretableSurfaceProps<TRow>["copyToClipboard"];
  messages?: PretableSurfaceProps<TRow>["messages"];
  onColumnWidthsChange?: PretableSurfaceProps<TRow>["onColumnWidthsChange"];
  onColumnOrderChange?: PretableSurfaceProps<TRow>["onColumnOrderChange"];
  onColumnPinnedChange?: PretableSurfaceProps<TRow>["onColumnPinnedChange"];
  onCellEdit?: PretableSurfaceProps<TRow>["onCellEdit"];
}

const VIEWPORT_HEIGHT = 320;
const BENCHMARK_VIEWPORT_STYLE = {
  contain: "none",
  containIntrinsicSize: "none",
  contentVisibility: "visible",
  overflowAnchor: "none",
  overscrollBehavior: "contain",
} as const;

/**
 * Drop-in pretable component. Wraps {@link PretableSurface} with internal state — pass `columns`, `rows` and `getRowId` and you're done. Reach for `PretableSurface` when you need to control state from the outside.
 *
 * @public
 */
export function Pretable<TRow extends PretableRow = PretableRow>({
  columns,
  getRowId,
  rows,
  rowSelectionColumn,
  onRowActivate,
  onRowSelectionChange,
  tabBehavior,
  copyWithHeaders,
  onCopy,
  copyToClipboard,
  messages,
  onColumnWidthsChange,
  onColumnOrderChange,
  onColumnPinnedChange,
  onCellEdit,
}: PretableProps<TRow>) {
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
        getRowId={getRowId}
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
        onRowActivate={onRowActivate}
        onRowSelectionChange={onRowSelectionChange}
        rowSelectionColumn={rowSelectionColumn}
        tabBehavior={tabBehavior}
        copyWithHeaders={copyWithHeaders}
        onCopy={onCopy}
        copyToClipboard={copyToClipboard}
        messages={messages}
        onColumnWidthsChange={onColumnWidthsChange}
        onColumnOrderChange={onColumnOrderChange}
        onColumnPinnedChange={onColumnPinnedChange}
        onCellEdit={onCellEdit}
        viewportStyle={BENCHMARK_VIEWPORT_STYLE}
        viewportHeight={VIEWPORT_HEIGHT}
      />
    </section>
  );
}
