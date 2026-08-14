import { useState } from "react";
import { createColumnHelper } from "@pretable/core";
import { PretableSurface } from "@pretable/react";
import type {
  PretableCellAddressFor,
  PretableCellRangeFor,
  PretableSelectionFor,
} from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";

/**
 * `content/docs/grid/selection.mdx` used to tell readers to import
 * `PretableSelectionState` from `@pretable/core` for a controlled `state.selection`.
 * Follow that AND the `createColumnHelper` + `as const` idiom the filtering and
 * grouping docs teach (necessary to keep the tuple typed query/aggregate
 * inference depends on) and it failed to typecheck: `<PretableSurface>`'s
 * `state.selection` / `onSelectionChange` narrow to
 * `PretableSelectionFor<TColumns>` (formerly the unnamed
 * `PretableSurfaceSelectionState<TRowId, TColumns>`), whose `columnId` is a
 * literal union incompatible with core's broad `startColumnId: string`.
 *
 * `PretableSelectionFor<TColumns>` (plus its `PretableCellRangeFor` /
 * `PretableCellAddressFor` companions) closes that gap — named exports mirroring
 * `PretableQueryFor<TColumns>` that a reader can write into a `useState`
 * declaration by hand, without a cast. This file pins that declaration compiles
 * and that `columnId` actually narrows, so both regressions stay caught:
 *   - reverting to `@pretable/core`'s `PretableSelectionState` here, or
 *   - deleting the `PretableSelectionFor` export,
 * must fail `pnpm typecheck:public`.
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

function describeRange(range: PretableCellRangeFor<typeof columns>): string {
  return `${range.startColumnId}@${range.startRowId}`;
}

function describeAddress(
  address: PretableCellAddressFor<typeof columns>,
): string {
  return `${address.columnId}@${address.rowId}`;
}

export function ControlledSelection() {
  const [selection, setSelection] = useState<
    PretableSelectionFor<typeof columns>
  >({ ranges: [], anchor: null });

  type _ColumnIdIsNarrow = Expect<
    Equal<
      PretableSelectionFor<typeof columns>["ranges"][number]["startColumnId"],
      "name" | "city" | "__pretable_group__" | "__pretable_row_select__"
    >
  >;
  void (null as unknown as _ColumnIdIsNarrow);

  void describeRange;
  void describeAddress;

  return (
    <PretableSurface
      ariaLabel="People directory"
      columns={columns}
      rows={rows}
      getRowId={(row) => row.id}
      viewportHeight={320}
      state={{ selection }}
      onSelectionChange={setSelection}
    />
  );
}
