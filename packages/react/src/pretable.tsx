import {
  type PretableRow,
  type PretableRowId,
  type PretableQueryFor,
} from "@pretable/core";

import {
  type PretableSurfaceProps,
  type PretableSurfaceRowsProps,
  type PretableSurfaceSharedProps,
  type PretableSurfaceQueryColumns,
  PretableSurface,
} from "./pretable-surface";
import type { PretableColumn, PretableRowIdRequirement } from "./types";

/**
 * Props for the {@link Pretable} drop-in component.
 *
 * @public
 */
export type PretableProps<
  TRow extends PretableRow = PretableRow,
  TRowId extends PretableRowId = TRow extends {
    readonly id: infer TId extends PretableRowId;
  }
    ? TId
    : PretableRowId,
  TColumns extends readonly { readonly id: string }[] =
    readonly PretableColumn<TRow>[],
> = PretableBaseProps<TRow, TRowId, TColumns> &
  PretableRowIdRequirement<TRow, TRowId>;

/**
 * The always-present half of {@link PretableProps}. Split out only so the
 * conditional `getRowId` requirement can be intersected on top; callers should
 * name `PretableProps`.
 *
 * @public
 */
export interface PretableBaseProps<
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
  /**
   * Stable row identity. Optional when `TRow` has a conventional
   * `id: string | number` — the engine reads `row.id` — and required by
   * {@link PretableRowIdRequirement} for every other row shape.
   */
  getRowId?: (row: TRow) => TRowId;
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
  /** Which operations the caller applies rather than the engine. Forwarded
   *  verbatim; every honesty rule lives behind `PretableSurface`. */
  processing?: PretableSurfaceSharedProps<TRow, TRowId, TColumns>["processing"];
  /** Server-supplied result metadata: dataset identity and matching total. */
  resultMeta?: PretableSurfaceSharedProps<TRow, TRowId, TColumns>["resultMeta"];
  /** The data lifecycle phase driving the body-state blocks. */
  dataState?: PretableSurfaceSharedProps<TRow, TRowId, TColumns>["dataState"];
  /** Reports the query the engine now holds. `<Pretable>` never accepts
   *  `query`, so this is always the uncontrolled, observed shape. */
  onQueryChange?: (
    query: PretableQueryFor<PretableSurfaceQueryColumns<TRow>>,
  ) => void;
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
 * mode (it always supplies `rows` and never exposes `model` or `query`), so
 * one generic function is enough. `PretableProps` is an intersection rather
 * than a plain interface only so `getRowId` can be optional for rows with a
 * conventional `id` and required for every other row shape — see
 * {@link PretableRowIdRequirement}.
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
>(props: PretableProps<TRow, TRowId, TColumns>) {
  /*
   * Forwarded as one object rather than prop by prop. `PretableProps` is
   * `PretableBaseProps & PretableRowIdRequirement<TRow, TRowId>`, and inside
   * this generic function that second half is a conditional type TypeScript
   * cannot resolve — `TRow` is still a parameter. Re-listing `getRowId` as a
   * standalone prop erases it to `((row: TRow) => TRowId) | undefined`, which
   * is not provably assignable to the unresolved conditional, so the forward
   * has to carry the requirement through intact. Passing the object keeps that
   * constituent by identity. Every prop `Pretable` accepts is a prop the
   * surface accepts, so nothing leaks that the explicit list withheld.
   */
  const surfaceProps: PretableSurfaceRowsProps<TRow, TRowId, TColumns> = {
    ...props,
    viewportStyle: BENCHMARK_VIEWPORT_STYLE,
    viewportHeight: VIEWPORT_HEIGHT,
  };
  return <PretableSurface {...surfaceProps} />;
}
