import {
  type PretableDerivationsFor,
  type PretableGroupRow,
  type PretableQueryFor,
} from "@pretable/core";
import type { Equal, Expect, IsAny } from "../shared/assert";
import { holdingColumns } from "./columns.types";

const query: PretableQueryFor<typeof holdingColumns> = {
  filters: [
    { columnId: "symbol", operator: "contains", value: "PRE" },
    { columnId: "quantity", operator: "between", value: [1, 100] },
    { columnId: "active", operator: "isAnyOf", value: [true] },
    {
      columnId: "openedAt",
      operator: "dateBetween",
      value: [new Date(0), new Date()],
    },
  ],
  sort: [{ columnId: "quantity", direction: "desc", nulls: "last" }],
  rowGroups: [{ columnId: "symbol", direction: "asc" }],
};
void query;

const invalidNumberOperator: PretableQueryFor<typeof holdingColumns> = {
  filters: [
    // @ts-expect-error number columns reject text-only operators and operands
    { columnId: "quantity", operator: "contains", value: "10" },
  ],
  sort: [],
  rowGroups: [],
};
void invalidNumberOperator;

const invalidBooleanOperand: PretableQueryFor<typeof holdingColumns> = {
  filters: [
    // @ts-expect-error boolean set filters require boolean values
    { columnId: "active", operator: "isAnyOf", value: ["yes"] },
  ],
  sort: [],
  rowGroups: [],
};
void invalidBooleanOperand;

const invalidSort: PretableQueryFor<typeof holdingColumns> = {
  filters: [],
  // @ts-expect-error sort IDs are limited to declared columns
  sort: [{ columnId: "missing", direction: "asc" }],
  rowGroups: [],
};
void invalidSort;

const invalidGroup: PretableQueryFor<typeof holdingColumns> = {
  filters: [],
  sort: [],
  // @ts-expect-error group IDs are limited to declared group-compatible columns
  rowGroups: [{ columnId: "missing" }],
};
void invalidGroup;

type Aggregates = PretableGroupRow<typeof holdingColumns>["aggregates"];
const aggregates: Aggregates = {
  symbol: 1,
  quantity: 42,
  quantityLabel: "42.00",
};
void aggregates;

const invalidAggregateOutput: Aggregates = {
  symbol: 1,
  quantity: 42,
  // @ts-expect-error custom aggregate output flows into group records
  quantityLabel: 42,
};
void invalidAggregateOutput;

type QuantityDerivation = PretableDerivationsFor<typeof holdingColumns>[1];
type CompatibleAggregate = Extract<QuantityDerivation["aggregate"], object>;
type CompatibleAccumulator = Parameters<CompatibleAggregate["accumulate"]>[0];
type _AccumulatorDoesNotLeakAny = Expect<
  Equal<IsAny<CompatibleAccumulator>, false>
>;
void (null as unknown as _AccumulatorDoesNotLeakAny);
