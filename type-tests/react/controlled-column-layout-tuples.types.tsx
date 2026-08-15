import { createColumnHelper } from "@pretable/core";
import { PretableSurface } from "@pretable/react";
import type { PretableSurfaceState } from "@pretable/react";
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

export function ControlledColumnLayout() {
  void (null as unknown as _OrderAcceptsSynthetics);
  void (null as unknown as _WidthsAcceptSynthetics);
  void (null as unknown as _PinnedAcceptsSynthetics);

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
