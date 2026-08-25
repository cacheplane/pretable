import {
  type PretableRow,
  type PretableRowId,
  type PretableQueryFor,
} from "@pretable/core";

import {
  type PretableSurfaceRowChange,
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
 * Every forwarded prop below indexes into `PretableSurfaceSharedProps`, the
 * plain interface — never into `PretableSurfaceProps`, the UNION of the
 * rows-owned and model-owned shapes. That distinction is load-bearing rather
 * than stylistic. Resolving one member of the union requires instantiating
 * both of its branches, and both are intersections carrying conditional types
 * over `TRow` and `TColumns`; doing that during contextual typing fixes
 * `TRowId` before the context-sensitive `getRowId` arrow is ever visited, so
 * `TRowId` fell back to its type-parameter default (`PretableRowId`) for
 * every row shape without a conventional `id`. `<PretableSurface>` in the
 * same position kept the exact id, which is what made the asymmetry a bug and
 * not a limit. `type-tests/react/row-identity.types.tsx` pins both.
 *
 * `onRowChange` is declared outright for the same reason: it lives on
 * `PretableSurfaceRowsProps`, one branch of that union, so indexing it would
 * reintroduce exactly what this avoids.
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
  locale?: PretableSurfaceSharedProps<TRow, TRowId, TColumns>["locale"];
  rows: readonly TRow[];
  rowSelectionColumn?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["rowSelectionColumn"];
  onRowActivate?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["onRowActivate"];
  onRowSelectionChange?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["onRowSelectionChange"];
  tabBehavior?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["tabBehavior"];
  copyWithHeaders?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["copyWithHeaders"];
  onCopy?: PretableSurfaceSharedProps<TRow, TRowId, TColumns>["onCopy"];
  copyToClipboard?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["copyToClipboard"];
  messages?: PretableSurfaceSharedProps<TRow, TRowId, TColumns>["messages"];
  /** The tool panel rail at the grid's right edge. On by default — the
   *  default lives in the surface, so the preset only ever forwards; pass
   *  `false` to remove it or a config object to control the open section. */
  toolPanel?: PretableSurfaceSharedProps<TRow, TRowId, TColumns>["toolPanel"];
  onColumnWidthsChange?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["onColumnWidthsChange"];
  onColumnOrderChange?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["onColumnOrderChange"];
  onColumnPinnedChange?: PretableSurfaceSharedProps<
    TRow,
    TRowId,
    TColumns
  >["onColumnPinnedChange"];
  onRowChange?: (
    change: PretableSurfaceRowChange<TRow, TRowId, TColumns>,
  ) => void | Promise<void>;
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
