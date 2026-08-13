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
  TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
> {
  ariaLabel: string;
  /**
   * Generic over the column tuple — mirroring `PretableSurface` — rather than
   * typed as `readonly PretableColumn<TRow>[]`. `readonly` alone (preserving
   * `as const`) is necessary but not sufficient: `createColumnHelper`'s
   * definitions have `header: ReactNode`, which is not assignable to
   * `PretableColumn`'s `header: string | undefined`, so the documented
   * `createColumnHelper` + `as const` idiom still failed to typecheck against
   * a fixed `PretableColumn<TRow>` element type. Binding `columns` to `TColumns`
   * (bounded only by `{ readonly id: string }[]`) lets the actual column tuple
   * type flow through unchanged, exactly as `<PretableSurface>` does — the
   * concise preset must not be stricter than the surface it wraps.
   */
  columns: TColumns;
  getRowId: (row: TRow) => TRowId;
  locale?: PretableSurfaceProps<TRow, TRowId, TColumns>["locale"];
  rows: readonly TRow[];
  rowSelectionColumn?: PretableSurfaceProps<
    TRow,
    TRowId,
    TColumns
  >["rowSelectionColumn"];
  onRowActivate?: PretableSurfaceProps<TRow, TRowId, TColumns>["onRowActivate"];
  onRowSelectionChange?: PretableSurfaceProps<
    TRow,
    TRowId,
    TColumns
  >["onRowSelectionChange"];
  tabBehavior?: PretableSurfaceProps<TRow, TRowId, TColumns>["tabBehavior"];
  copyWithHeaders?: PretableSurfaceProps<
    TRow,
    TRowId,
    TColumns
  >["copyWithHeaders"];
  onCopy?: PretableSurfaceProps<TRow, TRowId, TColumns>["onCopy"];
  copyToClipboard?: PretableSurfaceProps<
    TRow,
    TRowId,
    TColumns
  >["copyToClipboard"];
  messages?: PretableSurfaceProps<TRow, TRowId, TColumns>["messages"];
  onColumnWidthsChange?: PretableSurfaceProps<
    TRow,
    TRowId,
    TColumns
  >["onColumnWidthsChange"];
  onColumnOrderChange?: PretableSurfaceProps<
    TRow,
    TRowId,
    TColumns
  >["onColumnOrderChange"];
  onColumnPinnedChange?: PretableSurfaceProps<
    TRow,
    TRowId,
    TColumns
  >["onColumnPinnedChange"];
  onRowChange?: PretableSurfaceProps<TRow, TRowId, TColumns>["onRowChange"];
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
 * A single signature, not overloads: unlike `PretableSurface`, whose two
 * overloads exist because `PretableSurfaceProps` is a union of a rows-owned
 * and a model-owned mode, `Pretable` only ever forwards to the rows-owned
 * mode (it always supplies `rows` + `getRowId` and never exposes `model` or
 * `query`), so `PretableProps` is a plain interface and one generic function
 * is enough.
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
  const TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
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
}: PretableProps<TRow, TRowId, TColumns>) {
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
