import {
  createColumnHelper,
  prepareRemoteQuery,
  type PretableRemoteQuery,
  type PretableRemoteProvider,
  type PretableRemoteReadHandle,
  type PretableRemoteSignal,
} from "@pretable/core";
const helper = createColumnHelper<{
  id: number;
  name: string;
  amount: number;
}>();
const columns = [
  helper.accessor("name", { type: "text" }),
  helper.accessor("amount", { type: "number" }),
] as const;
declare const query: PretableRemoteQuery<typeof columns>;
declare const provider: PretableRemoteProvider<
  { id: number; name: string; amount: number },
  typeof columns
>;
prepareRemoteQuery(query, provider.capabilities);
const goodFilter: PretableRemoteQuery<typeof columns>["filters"] = [
  { columnId: "amount", operator: "gt", value: 1 },
];
const badFilter: PretableRemoteQuery<typeof columns>["filters"] = [
  // @ts-expect-error numeric operands retain column inference
  { columnId: "amount", operator: "gt", value: "1" },
];
const badProjection: PretableRemoteQuery<typeof columns>["projection"] = [
  // @ts-expect-error unknown column IDs do not widen to string
  "missing",
];
const badSort: PretableRemoteQuery<typeof columns>["sort"] = [
  // @ts-expect-error comparison and null order are required
  { columnId: "amount", direction: "asc" },
];
declare const handle: PretableRemoteReadHandle<{ id: number }>;
// @ts-expect-error remote handles expose no local mutation method
handle.updateRows([]);
const slot = handle.getSlot(0);
if (slot?.kind === "loading") {
  // @ts-expect-error unavailable slots have no business row
  slot.row;
}
declare const signal: PretableRemoteSignal;
provider.open(query, "semantic-key", signal);
void [goodFilter, badFilter, badProjection, badSort];

const badGroups: PretableRemoteQuery<typeof columns>["rowGroups"] = [
  // @ts-expect-error groupSort is the sole remote ordering authority
  { columnId: "name", direction: "desc" },
];
void badGroups;

const summaryCapability: typeof provider.capabilities.summaries = {
  filtered: "same-version",
  all: "unavailable",
};
const invalidSummaryCapability: typeof provider.capabilities.summaries = {
  filtered: "same-version",
  // @ts-expect-error latest-version totals cannot be advertised as compatible
  all: "latest",
};
void [summaryCapability, invalidSummaryCapability];

if (slot?.kind === "unloaded" || slot?.kind === "loading") {
  const ordinal: number = slot.ordinal;
  // @ts-expect-error unavailable slots are not records
  slot.row;
  // @ts-expect-error unavailable slots have no selectable record identity
  slot.id;
  void ordinal;
}
