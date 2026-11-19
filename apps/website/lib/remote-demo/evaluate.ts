import {
  canonicalRemoteRoute,
  remoteAggregateDefinitionKey,
  remoteGroupId,
  remoteLeafId,
  type PretableRemoteAggregateValue,
  type PretableRemoteKey,
  type PretableRemoteNode,
  type PretableRemoteRoute,
} from "@pretable/core";
import type { DemoOrder } from "./dataset";
import type { OrdersQuery } from "./provider";

export type OrderRow = Partial<Omit<DemoOrder, "tenant">>;
type Order = Readonly<DemoOrder>;
type Filter = OrdersQuery["filters"][number];
function matches(row: Order, filter: Filter): boolean {
  if ("op" in filter)
    return filter.op === "and"
      ? filter.children.every((child) => matches(row, child))
      : filter.children.some((child) => matches(row, child));
  const actual = row[filter.columnId];
  if (filter.operator === "isEmpty") return actual === null || actual === "";
  if (filter.operator === "isNotEmpty") return actual !== null && actual !== "";
  if (actual === null) return false;
  switch (filter.operator) {
    case "equals":
      return actual === filter.value;
    case "contains":
      return String(actual).includes(String(filter.value));
    case "gt":
      return typeof actual === "number" && actual > (filter.value as number);
    case "gte":
      return typeof actual === "number" && actual >= (filter.value as number);
    default:
      throw new Error("unsupported fixture operator");
  }
}
export function filterOrders(
  rows: readonly Order[],
  query: OrdersQuery,
): readonly Order[] {
  return rows.filter(
    (row) =>
      query.filters.every((filter) => matches(row, filter)) &&
      (query.search === undefined ||
        [row.id, row.region, row.customerLabel].some((value) =>
          value?.includes(query.search!),
        )),
  );
}
const binary = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** binary@1: null placement independent of direction; types number, string, boolean. */
function compare(
  a: PretableRemoteKey,
  b: PretableRemoteKey,
  sort: { nulls: "first" | "last"; direction: "asc" | "desc" },
): number {
  if (Object.is(a, b)) return 0;
  if (a === null) return sort.nulls === "first" ? -1 : 1;
  if (b === null) return sort.nulls === "first" ? 1 : -1;
  const ranks = { number: 0, string: 1, boolean: 2 };
  const order =
    typeof a !== typeof b
      ? ranks[typeof a as keyof typeof ranks] -
        ranks[typeof b as keyof typeof ranks]
      : typeof a === "number" && typeof b === "number"
        ? a - b
        : binary(String(a), String(b));
  return sort.direction === "asc" ? order : -order;
}
export function aggregateOrders(
  rows: readonly Order[],
  query: OrdersQuery,
): Record<string, PretableRemoteAggregateValue> {
  return Object.fromEntries(
    query.aggregates.map((aggregate) => [
      aggregate.id,
      {
        aggregateDefinitionKey: remoteAggregateDefinitionKey(
          query.registryVersion,
          aggregate.columnId,
          aggregate.id,
        ),
        authority: "server",
        state: "ready",
        completeness: "complete",
        value: rows.reduce((sum, row) => sum + (row.amount ?? 0), 0),
      },
    ]),
  );
}
function project(row: Order, query: OrdersQuery): OrderRow {
  return Object.fromEntries(
    query.projection.map((column) => [column, row[column]]),
  );
}
export function orderTree(rows: readonly Order[], query: OrdersQuery) {
  const branches = new Map<string, readonly PretableRemoteNode<OrderRow>[]>();
  const leaves: OrderRow[] = [];
  function build(
    subset: readonly Order[],
    route: PretableRemoteRoute,
  ): readonly PretableRemoteNode<OrderRow>[] {
    const group = query.rowGroups[route.length];
    let nodes: PretableRemoteNode<OrderRow>[];
    if (!group) {
      nodes = [...subset]
        .sort((a, b) => {
          for (const sort of query.sort) {
            const order = compare(a[sort.columnId], b[sort.columnId], sort);
            if (order) return order;
          }
          return binary(remoteLeafId(a.id), remoteLeafId(b.id));
        })
        .map((row) => {
          const projected = project(row, query);
          leaves.push(projected);
          return { kind: "leaf", id: remoteLeafId(row.id), row: projected };
        });
    } else {
      const groups = new Map<
        string,
        { route: PretableRemoteRoute; rows: Order[] }
      >();
      for (const row of subset) {
        const childRoute = [
          ...route,
          { columnId: group.columnId, key: row[group.columnId] },
        ];
        const id = canonicalRemoteRoute(childRoute);
        const entry = groups.get(id) ?? { route: childRoute, rows: [] };
        entry.rows.push(row);
        groups.set(id, entry);
      }
      const sorted = [...groups.values()].sort((a, b) => {
        for (const sort of query.groupSort.filter(
          (sort) => sort.level === route.length,
        )) {
          const aKey =
            sort.by === "key"
              ? a.route.at(-1)!.key
              : a.rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
          const bKey =
            sort.by === "key"
              ? b.route.at(-1)!.key
              : b.rows.reduce((sum, row) => sum + (row.amount ?? 0), 0);
          const order = compare(aKey, bKey, sort);
          if (order) return order;
        }
        return binary(remoteGroupId(a.route), remoteGroupId(b.route));
      });
      nodes = sorted.map((entry) => {
        const children = build(entry.rows, entry.route);
        const key = entry.route.at(-1)!.key;
        return {
          kind: "group",
          id: remoteGroupId(entry.route),
          route: entry.route,
          label:
            key === null
              ? "(empty)"
              : group.columnId === "customer"
                ? entry.rows[0]!.customerLabel
                : String(key),
          childCount: children.length,
          leafCount: entry.rows.length,
          aggregates: aggregateOrders(entry.rows, query),
        };
      });
    }
    branches.set(canonicalRemoteRoute(route), nodes);
    return nodes;
  }
  const root = build(rows, []);
  return { branches, leaves, rootCount: root.length };
}
