import {
  createColumnHelper,
  createLocalRowModel,
  type PretableRowModel,
  type PretableRowModelSnapshot,
  type PretableSummaryScope,
} from "@pretable/core";
import type { Equal, Expect } from "../shared/assert";

type Row = { id: string; amount: number; date: string };
const helper = createColumnHelper<Row>();
const columns = [
  helper.accessor("amount", {
    type: "number",
    aggregate: "sum",
    formatSummary: (input) => {
      type Value = Expect<Equal<typeof input.value, number | null>>;
      type Column = Expect<Equal<typeof input.column.id, "amount">>;
      // @ts-expect-error summaries do not fabricate a leaf row
      input.row;
      // @ts-expect-error summaries do not fabricate a group
      input.group;
      return String(input.value) as Value extends true
        ? Column extends true
          ? string
          : never
        : never;
    },
  }),
] as const;
helper.accessor("computedDate", (row) => row.date, {
  type: "date",
  aggregate: "min",
  formatSummary: ({ value }) => {
    type Value = Expect<Equal<typeof value, string | null>>;
    return String(value as Value extends true ? string | null : never);
  },
});
helper.accessor("date", {
  type: "date",
  aggregate: "count",
  formatSummary: ({ value }) => {
    type Value = Expect<Equal<typeof value, number | null>>;
    return String(value as Value extends true ? number | null : never);
  },
});
const model = createLocalRowModel({
  rows: [] as Row[],
  columns,
  getRowId: (row) => row.id,
});
const release: (() => void) | undefined = model.acquireSummaryScopes?.([
  "filtered",
  "all",
]);
const snapshot = model.getState().snapshot;
const ids: readonly "amount"[] | undefined = snapshot.aggregateColumnIds;
if (ids) {
  // @ts-expect-error effective metadata is immutable
  ids.push("amount");
}
const answer = snapshot.getSummary?.("all");
if (answer) {
  const scope: PretableSummaryScope = answer.scope;
  // @ts-expect-error cached summary values are readonly
  answer.values.amount = 0;
  void scope;
}
// @ts-expect-error visible rows are not a summary population
model.acquireSummaryScopes?.(["visible"]);
release?.();
type Model = PretableRowModel<Row, string, typeof columns>;
type Snapshot = PretableRowModelSnapshot<Row, string, typeof columns>;
declare const legacyModel: Omit<Model, "acquireSummaryScopes">;
declare const legacySnapshot: Omit<
  Snapshot,
  "getSummary" | "aggregateColumnIds"
>;
const compatibleModel: Model = legacyModel;
const compatibleSnapshot: Snapshot = legacySnapshot;
void [ids, compatibleModel, compatibleSnapshot];
