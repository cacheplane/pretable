import { createColumnHelper } from "@pretable/core";
import { Pretable, PretableSurface } from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

/**
 * `createColumnHelper` + `as const` is the idiom the docs teach, because
 * `as const` is what preserves the column tuple that typed query and aggregate
 * inference depend on. It produces a `readonly` tuple.
 *
 * `<Pretable>` used to declare `columns: PretableColumn<TRow>[]` — mutable —
 * so the documented idiom failed with:
 *
 *   TS4104: The type 'readonly [...]' is 'readonly' and cannot be assigned to
 *   the mutable type 'PretableColumn<Person>[]'.
 *
 * `<PretableSurface>` already accepted readonly, so the concise preset was
 * stricter than the surface it wraps. These compile-only assertions pin both
 * components against that regression; there is nothing to run.
 */

interface Person {
  id: string;
  name: string;
  city: string;
}

const column = createColumnHelper<Person>();

const columns = [
  column.accessor("name", { type: "text", header: "Name" }),
  column.accessor("city", { type: "text", header: "City" }),
] as const;

const rows = [
  { id: "1", name: "Ada", city: "London" },
  { id: "2", name: "Grace", city: "New York" },
] as const satisfies readonly Person[];

export function ConcisePreset() {
  return (
    <Pretable
      ariaLabel="People directory"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
    />
  );
}

export function Surface() {
  return (
    <PretableSurface
      ariaLabel="People directory"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={320}
    />
  );
}

/**
 * The whole reason the docs teach `as const`: it preserves the column tuple
 * so id/value types flow through, rather than widening to `PretableColumn`'s
 * generic `string` id. Pin that inference through `<Pretable>` specifically —
 * threading a fixed `readonly PretableColumn<TRow>[]` through would still
 * compile the JSX above but silently drop this narrowing back to `string`.
 */
export function ConcisePresetTypedCallbacks() {
  return (
    <Pretable
      ariaLabel="People directory"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      onColumnOrderChange={(order) => {
        type _OrderIsNarrow = Expect<
          Equal<
            (typeof order)[number],
            "name" | "city" | "__pretable_group__" | "__pretable_row_select__"
          >
        >;
        void (null as unknown as _OrderIsNarrow);
      }}
      onRowChange={(change) => {
        const columnId: "name" | "city" = change.columnId;
        if (change.columnId === "name") {
          const value: string = change.value;
          void value;
        }
        void columnId;
      }}
    />
  );
}
