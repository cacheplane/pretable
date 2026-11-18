import { createColumnHelper } from "@pretable/core";
import {
  PretableSurface,
  type PretableSummaries,
  type PretableSummaryDescriptor,
  type PretableServerSummaryResult,
} from "@pretable/react";
import type { Equal, Expect } from "../shared/assert";
const column = createColumnHelper<{
  id: string;
  date: string;
  amount: number;
}>();
const columns = [
  column.accessor("date", {
    type: "date",
    aggregate: "min",
    header: <span>Date</span>,
    formatSummary: (input) => {
      type Value = Expect<Equal<typeof input.value, string | null>>;
      type Column = Expect<Equal<typeof input.column.id, "date">>;
      const state: "ready" | "stale" = input.summary.state;
      // @ts-expect-error no data row in summary formatting
      input.row;
      // @ts-expect-error no group row in summary formatting
      input.group;
      return `${String(input.value as Value extends true ? (Column extends true ? string | null : never) : never)} ${state}`;
    },
  }),
  column.accessor("amount", {
    type: "number",
    aggregate: "sum",
    formatSummary: ({ value }) => {
      type Value = Expect<Equal<typeof value, number | null>>;
      return String(value as Value extends true ? number | null : never);
    },
  }),
] as const;
const summaries: PretableSummaries = {
  all: { authority: "engine", completeness: "partial" },
  filtered: {
    authority: "server",
    requestKey: "new",
    aggregateDefinitionKey: "v1",
    result: {
      state: "stale",
      label: "Previous filter",
      requestKey: "old",
      aggregateDefinitionKey: "v1",
      completeness: "complete",
      values: { amount: 10 },
    },
  },
};
<PretableSurface
  ariaLabel="Summary contract"
  columns={columns}
  rows={[]}
  summaries={summaries}
  viewportHeight={300}
/>;
// @ts-expect-error server authority requires keys and an explicit result
const missingKeys: PretableSummaryDescriptor = {
  authority: "server",
  result: { state: "loading" },
};
const mixed: PretableSummaryDescriptor = {
  authority: "engine",
  // @ts-expect-error engine authority cannot carry a server result
  result: { state: "loading" },
};
// @ts-expect-error stale answers require a visible label
const unlabeled: PretableServerSummaryResult = {
  state: "stale",
  requestKey: "old",
  aggregateDefinitionKey: "v1",
  completeness: "complete",
  values: {},
};
// @ts-expect-error ready answers require an explicit completeness claim
const incomplete: PretableServerSummaryResult = {
  state: "ready",
  requestKey: "new",
  aggregateDefinitionKey: "v1",
  values: {},
};
void [missingKeys, mixed, unlabeled, incomplete];
