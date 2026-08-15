import { createColumnHelper } from "@pretable/core";
import { PretableSurface } from "@pretable/react";
import type { PretableModel, PretableSurfaceState } from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

/**
 * `state.columnOrder` / `.columnWidths` / `.columnPinned` address DRAWN
 * columns, and the drawn set includes two synthetic columns the schema tuple
 * knows nothing about: `__pretable_row_select__` (whenever `rowSelectionColumn`
 * is enabled) and `__pretable_group__` (whenever rows are grouped).
 *
 * They used to be typed with `PretableSurfaceColumnId<TColumns>` — schema ids
 * only — while `focus` and `selection` used the interaction variant that
 * includes both synthetics. That was not merely inconvenient for
 * `columnOrder`: the write-back applies it only when it covers the drawn
 * layout EXACTLY (same length, every id present), so a consumer with
 * checkboxes on could not write an order that passes the gate at all, and the
 * whole slice was silently inert for them. The write-back's `as never` cast is
 * what kept the compiler from ever comparing the two.
 *
 * Reverting any of the three to `PretableSurfaceColumnId<TColumns>` must fail
 * `pnpm typecheck:public`.
 */

interface Row {
  id: string;
  name: string;
  city: string;
}

const column = createColumnHelper<Row>();

const columns = [
  column.accessor("name", { type: "text", header: "Name" }),
  column.accessor("city", { type: "text", header: "City" }),
] as const;

const rows: Row[] = [
  { id: "1", name: "Ada", city: "London" },
  { id: "2", name: "Grace", city: "New York" },
];

type _OrderAcceptsSynthetics = Expect<
  Equal<
    NonNullable<
      PretableSurfaceState<string, typeof columns>["columnOrder"]
    >[number],
    "name" | "city" | "__pretable_group__" | "__pretable_row_select__"
  >
>;

type _WidthsAcceptSynthetics = Expect<
  Equal<
    keyof NonNullable<
      PretableSurfaceState<string, typeof columns>["columnWidths"]
    >,
    "name" | "city" | "__pretable_group__" | "__pretable_row_select__"
  >
>;

type _PinnedAcceptsSynthetics = Expect<
  Equal<
    keyof NonNullable<
      PretableSurfaceState<string, typeof columns>["columnPinned"]
    >,
    "name" | "city" | "__pretable_group__" | "__pretable_row_select__"
  >
>;

/**
 * The other half of the same distinction, one layer down.
 *
 * The engine used to be handed the DRAWN columns while instantiated with the
 * SCHEMA tuple, and five `as never` casts in `pretable-model.ts` were what
 * bridged the two vocabularies. They are separate type parameters now, and
 * this pins the consequence a widening "fix" would have quietly cost: a
 * headless grid, which draws nothing beyond its schema, must still get the
 * NARROW ids everywhere the drawn vocabulary appears. Retyping the drawn
 * positions as `string` would remove the casts too, and would pass every
 * assertion above while silently deleting the checking below.
 */
type HeadlessModel = PretableModel<Row, string, typeof columns>;

type _HeadlessLayoutIdsStayNarrow = Expect<
  Equal<
    HeadlessModel["gridSnapshot"]["columnLayout"][number]["id"],
    "name" | "city"
  >
>;

type _HeadlessFocusIdStaysNarrow = Expect<
  Equal<
    HeadlessModel["gridSnapshot"]["focus"]["columnId"],
    "name" | "city" | null
  >
>;

type _HeadlessColumnOrderStaysNarrow = Expect<
  Equal<
    Parameters<HeadlessModel["grid"]["setColumnOrder"]>[0],
    readonly ("name" | "city")[]
  >
>;

export function ControlledColumnLayout() {
  void (null as unknown as _OrderAcceptsSynthetics);
  void (null as unknown as _WidthsAcceptSynthetics);
  void (null as unknown as _PinnedAcceptsSynthetics);
  void (null as unknown as _HeadlessLayoutIdsStayNarrow);
  void (null as unknown as _HeadlessFocusIdStaysNarrow);
  void (null as unknown as _HeadlessColumnOrderStaysNarrow);

  // The order a consumer with checkboxes on has to be able to write: it must
  // name every DRAWN column, synthetic included, or the write-back's
  // exact-cover gate rejects it at runtime.
  return (
    <PretableSurface
      ariaLabel="People directory"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={320}
      rowSelectionColumn={{ enabled: true }}
      state={{
        columnOrder: ["__pretable_row_select__", "city", "name"],
        columnWidths: { __pretable_row_select__: 48 },
        columnPinned: { __pretable_row_select__: "left" },
      }}
    />
  );
}
