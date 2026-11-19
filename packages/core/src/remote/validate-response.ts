import {
  canonicalRemoteRoute,
  remoteAggregateDefinitionKey,
  remoteGroupId,
  remoteLeafId,
} from "./query";
import type {
  PretableRemoteAggregateValue,
  PretableRemoteError,
  PretableRemoteNode,
  PretableRemoteQuery,
  PretableRemoteRange,
  PretableRemoteRangeRequest,
  PretableRemoteResult,
  PretableRemoteRoute,
  PretableRemoteSession,
  PretableRemoteSummary,
} from "./types";

function fail(
  code: "invalid-response" | "consistency" = "invalid-response",
): never {
  throw { code };
}
function check(condition: unknown): asserts condition {
  if (!condition) fail();
}
const count = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const text = (s: unknown): s is string => typeof s === "string" && s.length > 0;

/** Transport snapshots support acyclic plain records/dense arrays and scalar values
 * (including undefined, finite numbers and -0). No accessors, symbols, classes or
 * executable values. Own copies are frozen so provider/consumer mutations cannot
 * change validation evidence. Query keys and values never enter diagnostics. */
export function snapshotWire<T>(value: T): T {
  const active = new Set<object>();
  function copy(v: unknown, depth: number): unknown {
    check(depth <= 64);
    if (
      v === null ||
      v === undefined ||
      typeof v === "string" ||
      typeof v === "boolean"
    )
      return v;
    if (typeof v === "number") {
      check(Number.isFinite(v));
      return v;
    }
    check(typeof v === "object" && !active.has(v));
    const isArray = Array.isArray(v);
    check(
      Object.getPrototypeOf(v) ===
        (isArray ? Array.prototype : Object.prototype),
    );
    active.add(v);
    const result: Record<string, unknown> | unknown[] = isArray ? [] : {};
    const keys = Reflect.ownKeys(v);
    if (isArray) check(keys.length === (v as unknown[]).length + 1);
    for (const key of keys) {
      if (isArray && key === "length") continue;
      check(typeof key === "string");
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      check(d.enumerable && "value" in d);
      if (isArray)
        check(
          /^(0|[1-9]\d*)$/.test(key) && Number(key) < (v as unknown[]).length,
        );
      Object.defineProperty(result, key, {
        value: copy(d.value, depth + 1),
        enumerable: true,
      });
    }
    active.delete(v);
    return Object.freeze(result);
  }
  return copy(value, 0) as T;
}
/** Validate the transport envelope without reading accessors or traversing a
 * successful payload. Payload validation makes the one owned deep snapshot later.
 * Error snapshots are made before any diagnostic fields are inspected. */
export function validateRemoteResult<T>(
  input: unknown,
): PretableRemoteResult<T> {
  try {
    check(
      input &&
        typeof input === "object" &&
        Object.getPrototypeOf(input) === Object.prototype,
    );
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of Reflect.ownKeys(input)) {
      check(typeof key === "string" && ["ok", "value", "error"].includes(key));
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      check(descriptor && descriptor.enumerable && "value" in descriptor);
      descriptors.set(key, descriptor);
    }
    const ok = descriptors.get("ok")?.value;
    check(typeof ok === "boolean" && descriptors.size === 2);
    if (ok) {
      check(descriptors.has("value"));
      return { ok: true, value: descriptors.get("value")!.value as T };
    }
    check(descriptors.has("error"));
    const error = snapshotWire(
      descriptors.get("error")!.value as PretableRemoteError,
    );
    check(validRemoteError(error));
    return { ok: false, error };
  } catch {
    return { ok: false, error: { code: "invalid-response" } };
  }
}
// Typed encoding of already-validated snapshots: order-insensitive objects,
// distinct missing/undefined and -0/0. Never used as an externally logged key.
function signature(v: unknown): string {
  if (v === undefined) return '["undefined"]';
  if (v === null) return '["null"]';
  if (typeof v !== "object")
    return JSON.stringify([typeof v, Object.is(v, -0) ? "-0" : v]);
  if (Array.isArray(v)) return `["array",${v.map(signature).join(",")}]`;
  return `["object",${Object.keys(v)
    .sort()
    .map(
      (k) =>
        JSON.stringify(k) + ":" + signature((v as Record<string, unknown>)[k]),
    )
    .join(",")}]`;
}
const equal = (a: unknown, b: unknown) => signature(a) === signature(b);
function result<T>(operation: () => T): PretableRemoteResult<T> {
  try {
    return { ok: true, value: operation() };
  } catch (error) {
    return {
      ok: false,
      error: {
        code:
          (error as PretableRemoteError)?.code === "consistency"
            ? "consistency"
            : "invalid-response",
      },
    };
  }
}
export function validateSession(
  value: PretableRemoteSession,
  queryKey: string,
): PretableRemoteResult<PretableRemoteSession> {
  return result(() => {
    const s = snapshotWire(value);
    check(
      s.queryKey === queryKey &&
        text(s.sessionId) &&
        text(s.resultToken) &&
        count(s.rootCount),
    );
    check(
      s.expiresAt === undefined ||
        (typeof s.expiresAt === "number" && Number.isFinite(s.expiresAt)),
    );
    return s;
  });
}
function provenance(
  value: PretableRemoteSession | PretableRemoteSummary,
  session: PretableRemoteSession,
) {
  check(
    value.queryKey === session.queryKey &&
      value.sessionId === session.sessionId &&
      value.resultToken === session.resultToken,
  );
  if ("rootCount" in value)
    check(
      value.rootCount === session.rootCount &&
        value.expiresAt === session.expiresAt,
    );
}
export function rangeAddress(
  route: PretableRemoteRoute,
  start: number,
  end: number,
): string {
  return JSON.stringify([canonicalRemoteRoute(route), start, end]);
}
export function createResponseValidator<TRow extends object, TColumns>(
  queryInput: PretableRemoteQuery<TColumns>,
  sessionInput: PretableRemoteSession,
) {
  const query = snapshotWire(queryInput),
    session = snapshotWire(sessionInput);
  // Evidence is owned by retained ranges, not a historical hash journal. Task7
  // must account for these nodes/counts/summaries alongside the published cache.
  const ranges = new Map<string, PretableRemoteRange<TRow>>();
  const summaries = new Map<string, PretableRemoteSummary>();
  let disposed = false;
  function routeValid(route: PretableRemoteRoute) {
    canonicalRemoteRoute(route);
    check(route.length <= query.rowGroups.length);
    route.forEach((s, i) => check(s.columnId === query.rowGroups[i]?.columnId));
  }
  function aggregateValues(
    values: Readonly<Record<string, PretableRemoteAggregateValue>>,
  ) {
    check(
      values &&
        !Array.isArray(values) &&
        Object.getPrototypeOf(values) === Object.prototype,
    );
    check(Object.keys(values).length === query.aggregates.length);
    for (const definition of query.aggregates) {
      const a = values[definition.id];
      check(
        a &&
          a.aggregateDefinitionKey ===
            remoteAggregateDefinitionKey(
              query.registryVersion,
              String(definition.columnId),
              definition.id,
            ) &&
          a.authority === "server",
      );
      check(["ready", "unavailable", "error"].includes(a.state));
      if (a.state === "ready")
        check(
          (a.completeness === "complete" || a.completeness === "partial") &&
            Object.hasOwn(a, "value"),
        );
      if (a.state === "error") check(validRemoteError(a.error));
    }
  }
  function evidence() {
    const counts = new Map<string, number>(
      disposed ? [] : [[canonicalRemoteRoute([]), session.rootCount]],
    );
    const nodes = new Map<string, PretableRemoteNode<TRow>>();
    const ids = new Map<string, string>();
    for (const range of ranges.values()) {
      const route = canonicalRemoteRoute(range.route);
      counts.set(route, range.siblingCount);
      range.entries.forEach((node, i) => {
        const address = JSON.stringify([route, range.start + i]);
        nodes.set(address, node);
        ids.set(
          node.kind === "group" ? node.id : remoteLeafId(node.id),
          address,
        );
        if (node.kind === "group")
          counts.set(canonicalRemoteRoute(node.route), node.childCount);
      });
    }
    return { counts, nodes, ids };
  }
  return {
    validateRequest(
      request: PretableRemoteRangeRequest,
    ): PretableRemoteResult<PretableRemoteRangeRequest> {
      return result(() => {
        check(!disposed);
        const r = snapshotWire(request);
        provenance(r, session);
        routeValid(r.route);
        check(count(r.start) && count(r.end) && r.end > r.start);
        check(evidence().counts.has(canonicalRemoteRoute(r.route)));
        return r;
      });
    },
    acceptRange(
      request: PretableRemoteRangeRequest,
      input: PretableRemoteRange<TRow>,
      retain = true,
    ): PretableRemoteResult<PretableRemoteRange<TRow>> {
      return result(() => {
        check(!disposed);
        const r = snapshotWire(input);
        provenance(request, session);
        provenance(r, session);
        routeValid(request.route);
        routeValid(r.route);
        check(
          count(request.start) &&
            count(request.end) &&
            request.end > request.start,
        );
        check(
          r.start === request.start &&
            r.end === request.end &&
            canonicalRemoteRoute(r.route) ===
              canonicalRemoteRoute(request.route),
        );
        check(count(r.siblingCount) && Array.isArray(r.entries));
        const prior = evidence(),
          route = canonicalRemoteRoute(r.route);
        const expected = prior.counts.get(route);
        // A child request requires the authoritative parent descriptor first.
        check(expected !== undefined);
        if (expected !== r.siblingCount) fail("consistency");
        check(
          r.entries.length ===
            Math.max(0, Math.min(r.end, r.siblingCount) - r.start),
        );
        const newIds = new Set<string>();
        for (const [i, node] of r.entries.entries()) {
          check(node && (node.kind === "group" || node.kind === "leaf"));
          check(
            (node.kind === "group") === r.route.length < query.rowGroups.length,
          );
          const address = JSON.stringify([route, r.start + i]);
          let id: string;
          if (node.kind === "group") {
            routeValid(node.route);
            check(
              node.route.length === r.route.length + 1 &&
                canonicalRemoteRoute(node.route.slice(0, -1)) === route,
            );
            check(
              node.id === remoteGroupId(node.route) &&
                typeof node.label === "string" &&
                count(node.childCount),
            );
            check(node.leafCount === undefined || count(node.leafCount));
            aggregateValues(node.aggregates);
            const childCount = prior.counts.get(
              canonicalRemoteRoute(node.route),
            );
            if (childCount !== undefined && childCount !== node.childCount)
              fail("consistency");
            id = node.id;
          } else {
            id = remoteLeafId(node.id);
            check(
              node.row &&
                typeof node.row === "object" &&
                !Array.isArray(node.row),
            );
          }
          check(!newIds.has(id));
          newIds.add(id);
          const old = prior.nodes.get(address),
            position = prior.ids.get(id);
          if (
            (old && !equal(old, node)) ||
            (position !== undefined && position !== address)
          )
            fail("consistency");
        }
        if (retain) ranges.set(rangeAddress(r.route, r.start, r.end), r);
        return r;
      });
    },
    acceptSummary(
      scope: "filtered" | "all",
      input: PretableRemoteSummary,
      retain = true,
    ): PretableRemoteResult<PretableRemoteSummary> {
      return result(() => {
        check(!disposed);
        const s = snapshotWire(input);
        provenance(s, session);
        check(
          s.scope === scope &&
            s.registryVersion === query.registryVersion &&
            s.authority === "server",
        );
        check(s.completeness === "complete" || s.completeness === "partial");
        check(
          Array.isArray(s.aggregateIds) &&
            equal(
              [...s.aggregateIds].sort(),
              query.aggregates.map((a) => a.id).sort(),
            ),
        );
        aggregateValues(s.values);
        const prior = summaries.get(scope);
        if (
          prior &&
          (prior.completeness !== s.completeness ||
            !equal(prior.values, s.values))
        )
          fail("consistency");
        if (retain) summaries.set(scope, s);
        return s;
      });
    },
    /** Commit only a successful preflight, with no external callbacks between. */
    commitRange(r: PretableRemoteRange<TRow>) {
      ranges.set(rangeAddress(r.route, r.start, r.end), r);
    },
    commitSummary(s: PretableRemoteSummary) {
      summaries.set(s.scope, s);
    },
    /** Release only together with the corresponding published payload eviction.
     * Forgotten overlaps remain the provider's sessionwide consistency duty. */
    releaseRange(route: PretableRemoteRoute, start: number, end: number) {
      ranges.delete(rangeAddress(route, start, end));
    },
    releaseSummary(scope: "filtered" | "all") {
      summaries.delete(scope);
    },
    retention() {
      const e = evidence();
      return {
        nodes: [...ranges.values()].reduce(
          (total, r) => total + r.entries.length,
          0,
        ),
        counts: e.counts.size,
        summaries: summaries.size,
      };
    },
    dispose() {
      ranges.clear();
      summaries.clear();
      disposed = true;
    },
  };
}
export function validRemoteError(error: PretableRemoteError): boolean {
  if (!error || typeof error !== "object") return false;
  if (error.code === "unauthorized")
    return error.scope === "range" || error.scope === "session";
  if (error.code === "transient")
    return (
      error.retryAfterMs === undefined ||
      (Number.isFinite(error.retryAfterMs) && error.retryAfterMs >= 0)
    );
  return [
    "unsupported-query",
    "invalid-query",
    "invalid-response",
    "consistency",
    "expired",
    "cancelled",
    "timeout",
  ].includes(error.code);
}
