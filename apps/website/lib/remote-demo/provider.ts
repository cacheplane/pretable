import {
  canonicalRemoteRoute,
  prepareRemoteQuery,
  type PretableRemoteCapabilities,
  type PretableRemoteError,
  type PretableRemoteProvider,
  type PretableRemoteQuery,
  type PretableRemoteResult,
  type PretableRemoteSession,
  type PretableRemoteSignal,
} from "@pretable/core";
import type { DemoOrder, OrdersDataset, OrdersRead } from "./dataset";
import {
  aggregateOrders,
  filterOrders,
  orderTree,
  type OrderRow,
} from "./evaluate";
export type OrdersColumns = readonly [
  { id: "id"; accessor: () => string; type: "text" },
  { id: "region"; accessor: () => string | null; type: "text" },
  { id: "customer"; accessor: () => string | number | null; type: "enum" },
  { id: "customerLabel"; accessor: () => string; type: "text" },
  { id: "amount"; accessor: () => number | null; type: "number" },
];
export type OrdersQuery = PretableRemoteQuery<OrdersColumns>;
export const ordersQuery: OrdersQuery = {
  source: "orders",
  authScope: "demo",
  schemaVersion: "1",
  registryVersion: "orders@1",
  comparison: "binary@1",
  locale: "en",
  filters: [],
  rowGroups: [{ columnId: "region" }, { columnId: "customer" }],
  sort: [
    {
      columnId: "amount",
      direction: "desc",
      nulls: "last",
      comparison: "binary@1",
    },
  ],
  groupSort: [
    {
      level: 0,
      by: "aggregate",
      aggregateId: "amount.sum@1",
      direction: "desc",
      nulls: "last",
      comparison: "binary@1",
    },
    {
      level: 1,
      by: "key",
      direction: "asc",
      nulls: "last",
      comparison: "binary@1",
    },
  ],
  aggregates: [{ columnId: "amount", id: "amount.sum@1" }],
  projection: ["id", "region", "customer", "customerLabel", "amount"],
};
export interface OrdersProviderOptions {
  consistency?: "immutable" | "revision-fence";
  now?: () => number;
  ttlMs?: number;
  maxResources?: number;
  maxStoredRows?: number;
}
/** Backend-only feasibility handle, not an export job or browser download API. */
export interface OrdersExportCapture {
  readonly captureId: string;
  readonly queryKey: string;
  readonly resultToken: string;
  readonly expiresAt: number;
}
interface Snapshot {
  session: PretableRemoteSession;
  query: OrdersQuery;
  revision: number;
  base: readonly Readonly<DemoOrder>[];
  filtered: readonly Readonly<DemoOrder>[];
}
interface ExportCopy {
  handle: OrdersExportCapture;
  rows: readonly OrderRow[];
}
const fail = <T>(
  code: PretableRemoteError["code"],
): PretableRemoteResult<T> => ({
  ok: false,
  error: code === "unauthorized" ? { code, scope: "session" } : { code },
});
const success = <T>(value: T): PretableRemoteResult<T> => ({
  ok: true,
  value: structuredClone(value),
});

/** In-process conformance fixture. Instantiate explicitly; no module-global storage.
 * An application must supply durable authorized storage before exposing HTTP APIs. */
export function createOrdersProvider(
  source: OrdersDataset,
  options: OrdersProviderOptions = {},
) {
  const consistency = options.consistency ?? "immutable";
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  const maxResources = options.maxResources ?? 16;
  const maxStoredRows = options.maxStoredRows ?? 5000;
  for (const limit of [ttlMs, maxResources, maxStoredRows]) {
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error("invalid fixture limit");
  }
  const trustedCapabilities: PretableRemoteCapabilities = {
    rangeAccess: "ordinal",
    exactCounts: true,
    consistency,
    fields: {
      id: {
        type: "text",
        operators: ["equals", "contains", "isEmpty", "isNotEmpty"],
      },
      region: {
        type: "text",
        operators: ["equals", "contains", "isEmpty", "isNotEmpty"],
      },
      customer: { type: "enum", operators: ["isEmpty", "isNotEmpty"] },
      customerLabel: {
        type: "text",
        operators: ["equals", "contains", "isEmpty", "isNotEmpty"],
      },
      amount: {
        type: "number",
        operators: ["equals", "gt", "gte", "isEmpty", "isNotEmpty"],
      },
    },
    comparisons: ["binary@1"],
    aggregates: ["amount.sum@1"],
    search: true,
    summaries: { filtered: "same-version", all: "same-version" },
    maxGroupDepth: 2,
    maxRangeSize: 100,
  };
  const sessions = new Map<string, Snapshot>();
  const exports = new Map<string, ExportCopy>();
  // Random instance namespace prevents another provider's handles aliasing local resources.
  const namespace = crypto.randomUUID();
  let sequence = 0;
  function prune() {
    const time = now();
    for (const [id, snapshot] of sessions)
      if (snapshot.session.expiresAt! <= time) sessions.delete(id);
    for (const [id, copy] of exports)
      if (copy.handle.expiresAt <= time) exports.delete(id);
  }
  function capacity(rows: number) {
    const used =
      [...sessions.values()].reduce(
        (sum, snapshot) => sum + snapshot.base.length,
        0,
      ) +
      [...exports.values()].reduce((sum, copy) => sum + copy.rows.length, 0);
    return (
      sessions.size + exports.size < maxResources &&
      used + rows <= maxStoredRows
    );
  }
  function operation<T>(
    signal: PretableRemoteSignal,
    callback: (view: OrdersRead) => PretableRemoteResult<T>,
  ): PretableRemoteResult<T> {
    prune();
    if (signal.aborted) return fail("cancelled");
    return source.read((view) => {
      if (signal.aborted) return fail("cancelled");
      if (!view.authorized) {
        sessions.clear();
        exports.clear();
        return fail("unauthorized");
      }
      return callback(view);
    });
  }
  function snapshotFor(
    session: PretableRemoteSession,
    view: OrdersRead,
  ): PretableRemoteResult<Snapshot> {
    const snapshot = sessions.get(session.sessionId);
    if (!snapshot) return fail("expired");
    if (
      session.queryKey !== snapshot.session.queryKey ||
      session.resultToken !== snapshot.session.resultToken
    )
      return fail("invalid-query");
    if (consistency === "revision-fence" && snapshot.revision !== view.revision)
      return fail("expired");
    return { ok: true, value: snapshot };
  }
  const provider: PretableRemoteProvider<OrderRow, OrdersColumns> = {
    // Advisory capabilities are a copy. Backend validation uses its private registry.
    capabilities: structuredClone(trustedCapabilities),
    async open(query, queryKey, signal) {
      return operation(signal, (view) => {
        const prepared = prepareRemoteQuery(query, trustedCapabilities);
        if (!prepared.ok) return prepared;
        if (query.source !== "orders" || query.authScope !== "demo")
          return fail("unauthorized");
        if (
          query.locale !== "en" ||
          query.schemaVersion !== "1" ||
          query.registryVersion !== "orders@1" ||
          query.aggregates.some((aggregate) => aggregate.columnId !== "amount")
        )
          return fail("unsupported-query");
        if (prepared.queryKey !== queryKey) return fail("invalid-query");
        const base = view.rows.filter((row) => row.tenant === "demo");
        if (!capacity(base.length)) return fail("transient");
        const ownedQuery = structuredClone(query);
        const filtered = filterOrders(base, ownedQuery);
        const session: PretableRemoteSession = {
          sessionId: `${namespace}:session:${++sequence}`,
          queryKey,
          resultToken: `${namespace}:revision:${view.revision}`,
          rootCount: orderTree(filtered, ownedQuery).rootCount,
          expiresAt: now() + ttlMs,
        };
        sessions.set(session.sessionId, {
          session,
          query: ownedQuery,
          revision: view.revision,
          base,
          filtered,
        });
        return success(session);
      });
    },
    async read(request, signal) {
      return operation(signal, (view) => {
        const found = snapshotFor(request, view);
        if (!found.ok) return found;
        const { session, query, filtered } = found.value;
        if (
          !Number.isSafeInteger(request.start) ||
          !Number.isSafeInteger(request.end) ||
          request.start < 0 ||
          request.end < request.start ||
          request.end - request.start > trustedCapabilities.maxRangeSize
        )
          return fail("invalid-query");
        let routeKey: string;
        try {
          routeKey = canonicalRemoteRoute(request.route);
        } catch {
          return fail("invalid-query");
        }
        const entries = orderTree(filtered, query).branches.get(routeKey);
        if (!entries) return fail("invalid-query");
        return success({
          ...session,
          route: request.route,
          start: request.start,
          end: request.end,
          siblingCount: entries.length,
          entries: entries.slice(request.start, request.end),
        });
      });
    },
    async summary(session, scope, signal) {
      return operation(signal, (view) => {
        const found = snapshotFor(session, view);
        if (!found.ok) return found;
        if (scope !== "all" && scope !== "filtered")
          return fail("invalid-query");
        const snapshot = found.value;
        return success({
          sessionId: snapshot.session.sessionId,
          queryKey: snapshot.session.queryKey,
          resultToken: snapshot.session.resultToken,
          scope,
          registryVersion: snapshot.query.registryVersion,
          aggregateIds: snapshot.query.aggregates.map(
            (aggregate) => aggregate.id,
          ),
          authority: "server" as const,
          completeness: "complete" as const,
          values: aggregateOrders(
            scope === "all" ? snapshot.base : snapshot.filtered,
            snapshot.query,
          ),
        });
      });
    },
    async release(session) {
      prune();
      const stored = sessions.get(session.sessionId);
      if (
        stored?.session.queryKey === session.queryKey &&
        stored.session.resultToken === session.resultToken
      )
        sessions.delete(session.sessionId);
    },
  };
  return {
    ...provider,
    /** Atomic server-side leaf copy is the feasibility proof, not a client traversal.
     * Export copies have independent bounded retention and do not extend session TTL. */
    async captureExport(
      session: PretableRemoteSession,
      signal: PretableRemoteSignal,
    ): Promise<PretableRemoteResult<OrdersExportCapture>> {
      return operation(signal, (view) => {
        const found = snapshotFor(session, view);
        if (!found.ok) return found;
        if (!capacity(found.value.filtered.length)) return fail("transient");
        const handle: OrdersExportCapture = {
          captureId: `${namespace}:export:${++sequence}`,
          queryKey: found.value.session.queryKey,
          resultToken: found.value.session.resultToken,
          expiresAt: now() + ttlMs,
        };
        const rows = orderTree(found.value.filtered, found.value.query).leaves;
        exports.set(handle.captureId, { handle, rows });
        return success(handle);
      });
    },
    async readExport(
      handle: OrdersExportCapture,
      signal: PretableRemoteSignal,
    ): Promise<PretableRemoteResult<readonly OrderRow[]>> {
      return operation(signal, () => {
        const copy = exports.get(handle.captureId);
        if (!copy) return fail("expired");
        if (
          handle.queryKey !== copy.handle.queryKey ||
          handle.resultToken !== copy.handle.resultToken
        )
          return fail("invalid-query");
        return success(copy.rows);
      });
    },
    async releaseExport(handle: OrdersExportCapture) {
      prune();
      const copy = exports.get(handle.captureId);
      if (
        copy?.handle.queryKey === handle.queryKey &&
        copy.handle.resultToken === handle.resultToken
      )
        exports.delete(handle.captureId);
    },
  };
}
