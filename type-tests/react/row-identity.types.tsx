/**
 * Stable row identity is one contract across every entry point that takes
 * rows: `getRowId` is OPTIONAL when the row carries a conventional
 * `id: string | number` (the engine reads `row.id`) and REQUIRED for every
 * other row shape. The engine has always behaved that way — these tests pin
 * the surface types to it so the components, the hooks and the core factory
 * cannot drift apart again.
 */
import {
  createColumnHelper,
  createLocalRowModel,
  type PretableRowId,
} from "@pretable/core";
import {
  LabeledGridSurface,
  Pretable,
  PretableSurface,
  useLocalRowModel,
  usePretable,
} from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

/** Conventional identity: `id` is a number. */
interface Holding {
  id: number;
  symbol: string;
  quantity: number;
}
/** No conventional identity — the stable key is `sku`. */
interface Part {
  sku: `part_${number}`;
  label: string;
}

const holdingColumn = createColumnHelper<Holding>();
const holdingColumns = [
  holdingColumn.accessor("symbol", { type: "text" }),
  holdingColumn.accessor("quantity", { type: "number" }),
] as const;
const holdings: readonly Holding[] = [{ id: 1, symbol: "PRE", quantity: 10 }];

const partColumn = createColumnHelper<Part>();
const partColumns = [partColumn.accessor("label", { type: "text" })] as const;
const parts: readonly Part[] = [{ sku: "part_1", label: "Bolt" }];

/* ------------------------------------------------------------------ *
 * @pretable/core — createLocalRowModel
 * ------------------------------------------------------------------ */

const coreConventional = createLocalRowModel({
  rows: holdings,
  columns: holdingColumns,
});
type _CoreConventionalId = Expect<
  Equal<
    NonNullable<
      ReturnType<
        ReturnType<typeof coreConventional.getState>["snapshot"]["dataRowAt"]
      >
    >["rowId"],
    number
  >
>;

// @ts-expect-error `Part` has no conventional `id`, so `getRowId` is required
createLocalRowModel({ rows: parts, columns: partColumns });

const coreExplicit = createLocalRowModel({
  rows: parts,
  columns: partColumns,
  getRowId: (row) => row.sku,
});
type _CoreExplicitId = Expect<
  Equal<
    NonNullable<
      ReturnType<
        ReturnType<typeof coreExplicit.getState>["snapshot"]["dataRowAt"]
      >
    >["rowId"],
    `part_${number}`
  >
>;

/* ------------------------------------------------------------------ *
 * @pretable/react — useLocalRowModel
 * ------------------------------------------------------------------ */

useLocalRowModel({ rows: holdings, columns: holdingColumns });
// @ts-expect-error `Part` has no conventional `id`, so `getRowId` is required
useLocalRowModel({ rows: parts, columns: partColumns });
useLocalRowModel({
  rows: parts,
  columns: partColumns,
  getRowId: (row) => row.sku,
});

/* ------------------------------------------------------------------ *
 * @pretable/react — usePretable (rows mode)
 * ------------------------------------------------------------------ */

const hookConventional = usePretable({
  rows: holdings,
  columns: holdingColumns,
  viewportHeight: 320,
});
type _HookConventionalId = Expect<
  Equal<
    NonNullable<
      ReturnType<typeof hookConventional.rowModelSnapshot.dataRowAt>
    >["rowId"],
    number
  >
>;

// @ts-expect-error `Part` has no conventional `id`, so `getRowId` is required
usePretable({ rows: parts, columns: partColumns, viewportHeight: 320 });

const hookExplicit = usePretable({
  rows: parts,
  columns: partColumns,
  getRowId: (row) => row.sku,
  viewportHeight: 320,
});
type _HookExplicitId = Expect<
  Equal<
    NonNullable<
      ReturnType<typeof hookExplicit.rowModelSnapshot.dataRowAt>
    >["rowId"],
    `part_${number}`
  >
>;

/* ------------------------------------------------------------------ *
 * @pretable/react — <PretableSurface> (rows mode)
 * ------------------------------------------------------------------ */

/**
 * The regression this file exists for. Before the fix this was an error, and
 * not a clean one: `getRowId` was a *required* member of
 * `PretableSurfaceRowsProps`, and omitting it made inference for the whole
 * intersection bail to the type-parameter defaults, so the reported failure
 * was a `TColumns` mismatch against `readonly PretableColumn<object>[]`
 * rather than a missing prop. Declaring `getRowId` optional restores
 * inference: `TRow`, `TRowId` and `TColumns` below all come from `rows` and
 * `columns` alone.
 */
const surfaceConventional = (
  <PretableSurface
    ariaLabel="conventional surface"
    columns={holdingColumns}
    rows={holdings}
    viewportHeight={320}
    renderBodyCell={(input) => {
      type _InferredRowId = Expect<Equal<typeof input.rowId, number>>;
      void (null as unknown as _InferredRowId);
      if (input.columnId === "quantity") {
        type _InferredValue = Expect<Equal<typeof input.value, number>>;
        void (null as unknown as _InferredValue);
      }
      return null;
    }}
    onFocusChange={(focus) => {
      type _InferredColumnId = Expect<
        Equal<
          typeof focus.columnId,
          | "symbol"
          | "quantity"
          | "__pretable_group__"
          | "__pretable_row_select__"
          | null
        >
      >;
      void (null as unknown as _InferredColumnId);
    }}
  />
);
void surfaceConventional;

const surfaceMissingAccessor = (
  // @ts-expect-error `Part` has no conventional `id`, so `getRowId` is required
  <PretableSurface
    ariaLabel="part surface"
    columns={partColumns}
    rows={parts}
    viewportHeight={320}
  />
);
void surfaceMissingAccessor;

/** Explicit `getRowId` must still win over the conventional `id`. */
const surfaceExplicitOverride = (
  <PretableSurface
    ariaLabel="explicit override"
    columns={holdingColumns}
    rows={holdings}
    getRowId={(row) => `holding_${row.id}` as const}
    viewportHeight={320}
    renderBodyCell={(input) => {
      type _OverriddenRowId = Expect<
        Equal<typeof input.rowId, `holding_${number}`>
      >;
      void (null as unknown as _OverriddenRowId);
      return null;
    }}
  />
);
void surfaceExplicitOverride;

/* ------------------------------------------------------------------ *
 * @pretable/react — <Pretable>
 * ------------------------------------------------------------------ */

const pretableConventional = (
  <Pretable
    ariaLabel="conventional"
    columns={holdingColumns}
    rows={holdings}
    onRowSelectionChange={(rowIds) => {
      // Omitting `getRowId` must not cost identity precision: `TRowId` comes
      // from the type-parameter default reading `Holding["id"]`.
      type _ConventionalId = Expect<Equal<typeof rowIds, number[]>>;
      void (null as unknown as _ConventionalId);
    }}
  />
);
void pretableConventional;

const pretableMissingAccessor = (
  // @ts-expect-error `Part` has no conventional `id`, so `getRowId` is required
  <Pretable ariaLabel="parts" columns={partColumns} rows={parts} />
);
void pretableMissingAccessor;

const pretableExplicit = (
  <Pretable
    ariaLabel="parts"
    columns={partColumns}
    rows={parts}
    getRowId={(row) => row.sku}
    onRowSelectionChange={(rowIds) => {
      /*
       * KNOWN GAP, pre-existing and deliberately pinned rather than fixed
       * here. `<Pretable>` widens `TRowId` to `PretableRowId` when it has to
       * infer it from `getRowId`; `<PretableSurface>` in the same position
       * keeps `` `part_${number}` `` (asserted above). Verified against the
       * pre-change `getRowId`-required definition, so the optional prop is
       * not the cause: `PretableBaseProps` declares most of its props as
       * indexed accesses into `PretableSurfaceProps<TRow, TRowId, TColumns>`,
       * which forces `TRowId` to be fixed before the context-sensitive
       * `getRowId` arrow is typed. Passing explicit type arguments produces
       * the exact id, so the prop types themselves are sound.
       *
       * The conventional path — the one this change made optional — is exact
       * either way, because `TRowId` then comes from the type-parameter
       * default rather than from inference. See `pretableConventional`.
       */
      type _WidenedId = Expect<Equal<typeof rowIds, PretableRowId[]>>;
      void (null as unknown as _WidenedId);
    }}
  />
);
void pretableExplicit;

/* ------------------------------------------------------------------ *
 * @pretable/react — <LabeledGridSurface> (@beta)
 * ------------------------------------------------------------------ */

const labeledConventional = (
  <LabeledGridSurface
    ariaLabel="conventional labeled"
    columns={[{ id: "symbol", header: "Symbol" }]}
    rows={[{ id: 1, symbol: "PRE", quantity: 10 }]}
    viewportHeight={320}
  />
);
void labeledConventional;

const labeledMissingAccessor = (
  // @ts-expect-error `Part` has no conventional `id`, so `getRowId` is required
  <LabeledGridSurface
    ariaLabel="parts labeled"
    columns={[{ id: "label", header: "Label" }]}
    rows={[{ sku: "part_1", label: "Bolt" }] as Part[]}
    viewportHeight={320}
  />
);
void labeledMissingAccessor;

void (null as unknown as _CoreConventionalId);
void (null as unknown as _CoreExplicitId);
void (null as unknown as _HookConventionalId);
void (null as unknown as _HookExplicitId);
