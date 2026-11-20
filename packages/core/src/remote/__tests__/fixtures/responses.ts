import { remoteAggregateDefinitionKey } from "../../query";
import type {
  PretableRemoteCapabilities,
  PretableRemoteQuery,
  PretableRemoteRange,
  PretableRemoteSession,
  PretableRemoteSummary,
} from "../../types";
export type Columns = readonly [
  { id: "value"; accessor: () => number; type: "number" },
];
export type Row = { value: number; extra?: unknown };
export const capabilities: PretableRemoteCapabilities = {
  rangeAccess: "ordinal",
  exactCounts: true,
  consistency: "immutable",
  fields: { value: { type: "number", operators: ["gt"] } },
  comparisons: ["binary@1"],
  aggregates: ["sum"],
  search: true,
  summaries: { filtered: "same-version", all: "same-version" },
  maxGroupDepth: 2,
  maxRangeSize: 100,
};
export const query: PretableRemoteQuery<Columns> = {
  source: "test",
  authScope: "scope",
  schemaVersion: "1",
  registryVersion: "1",
  comparison: "binary@1",
  locale: "en",
  filters: [],
  rowGroups: [],
  sort: [],
  groupSort: [],
  aggregates: [],
  projection: ["value"],
};
export const session: PretableRemoteSession = {
  queryKey: "query",
  sessionId: "session",
  resultToken: "token",
  rootCount: 4,
};
export function range(
  start = 0,
  end = 2,
  patch: Partial<PretableRemoteRange<Row>> = {},
): PretableRemoteRange<Row> {
  return {
    ...session,
    route: [],
    start,
    end,
    siblingCount: 4,
    entries: Array.from(
      { length: Math.max(0, Math.min(end, 4) - start) },
      (_, i) => ({ kind: "leaf", id: start + i, row: { value: start + i } }),
    ),
    ...patch,
  };
}
export const groupedQuery: PretableRemoteQuery<Columns> = {
  ...query,
  rowGroups: [{ columnId: "value" }],
  groupSort: [
    {
      level: 0,
      by: "key",
      direction: "asc",
      nulls: "first",
      comparison: "binary@1",
    },
  ],
  aggregates: [{ id: "sum", columnId: "value" }],
};
export const aggregate = (value = 4) => ({
  aggregateDefinitionKey: remoteAggregateDefinitionKey("1", "value", "sum"),
  authority: "server" as const,
  state: "ready" as const,
  completeness: "complete" as const,
  value,
});
export function summary(value = 4): PretableRemoteSummary {
  return {
    ...session,
    scope: "filtered",
    registryVersion: "1",
    aggregateIds: ["sum"],
    authority: "server",
    completeness: "complete",
    values: { sum: aggregate(value) },
  };
}
