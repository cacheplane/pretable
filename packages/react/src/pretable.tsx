import { type PretableRow, type PretableRowId } from "@pretable/core";

import { type PretableSurfaceProps, PretableSurface } from "./pretable-surface";
import type { PretableColumn } from "./types";

/**
 * Props for the {@link Pretable} drop-in component.
 *
 * @public
 */
export interface PretableProps<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
> {
  ariaLabel: string;
  columns: PretableColumn<TRow>[];
  getRowId: (row: TRow) => TRowId;
  locale?: PretableSurfaceProps<TRow, TRowId>["locale"];
  rows: TRow[];
  rowSelectionColumn?: PretableSurfaceProps<TRow, TRowId>["rowSelectionColumn"];
  onRowActivate?: PretableSurfaceProps<TRow, TRowId>["onRowActivate"];
  onRowSelectionChange?: PretableSurfaceProps<
    TRow,
    TRowId
  >["onRowSelectionChange"];
  tabBehavior?: PretableSurfaceProps<TRow, TRowId>["tabBehavior"];
  copyWithHeaders?: PretableSurfaceProps<TRow, TRowId>["copyWithHeaders"];
  onCopy?: PretableSurfaceProps<TRow, TRowId>["onCopy"];
  copyToClipboard?: PretableSurfaceProps<TRow, TRowId>["copyToClipboard"];
  messages?: PretableSurfaceProps<TRow, TRowId>["messages"];
  onColumnWidthsChange?: PretableSurfaceProps<
    TRow,
    TRowId
  >["onColumnWidthsChange"];
  onColumnOrderChange?: PretableSurfaceProps<
    TRow,
    TRowId
  >["onColumnOrderChange"];
  onColumnPinnedChange?: PretableSurfaceProps<
    TRow,
    TRowId
  >["onColumnPinnedChange"];
  onRowChange?: PretableSurfaceProps<TRow, TRowId>["onRowChange"];
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
 * Drop-in pretable component. Wraps {@link PretableSurface} with internal state — pass `columns` and `rows` and you're done. Reach for `PretableSurface` when you need to control state from the outside.
 *
 * @public
 */
export function Pretable<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
>({
  ariaLabel,
  columns,
  getRowId,
  locale,
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
  onRowChange,
}: PretableProps<TRow, TRowId>) {
  return (
    <PretableSurface
      ariaLabel={ariaLabel}
      columns={columns}
      getRowId={getRowId}
      locale={locale}
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
      onRowChange={onRowChange}
      viewportStyle={BENCHMARK_VIEWPORT_STYLE}
      viewportHeight={VIEWPORT_HEIGHT}
    />
  );
}
