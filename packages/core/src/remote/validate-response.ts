import { ResponseCapacityError, wireStringLengthSteps } from "./wire-cost";
import { equalWireSteps } from "./wire-equality";
import {
  prepareCooperatively,
  type PreparationBudget,
} from "./cooperative-work";
import { RangeEvidence } from "./range-evidence";
import {
  canonicalRemoteRoute,
  remoteAggregateDefinitionKey,
  remoteGroupId,
} from "./query";
import type {
  PretableRemoteAggregateValue,
  PretableRemoteError,
  PretableRemoteQuery,
  PretableRemoteRange,
  PretableRemoteRangeRequest,
  PretableRemoteResult,
  PretableRemoteRoute,
  PretableRemoteSession,
  PretableRemoteSignal,
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
function completeSteps<T>(steps: Generator<void, T>): T {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}
export function snapshotWire<T>(value: T): T {
  return completeSteps(snapshotWireSteps(value));
}
export function* snapshotWireSteps<T>(
  value: T,
  maxBytes?: number,
  onCost?: (bytes: number) => void,
): Generator<void, T> {
  let bytes = 64;
  const tracked = maxBytes !== undefined || onCost !== undefined;
  const charge = (amount: number) => {
    if (!tracked) return;
    bytes += amount;
    if (!Number.isSafeInteger(bytes) || bytes > (maxBytes ?? Infinity))
      throw new ResponseCapacityError();
  };
  const active = new Set<object>();
  function* copy(v: unknown, depth: number): Generator<void, unknown> {
    check(depth <= 64);
    if (
      v === null ||
      v === undefined ||
      typeof v === "string" ||
      typeof v === "boolean"
    ) {
      if (tracked)
        charge(
          typeof v === "string"
            ? 2 * (yield* wireStringLengthSteps(v))
            : v === undefined
              ? 18
              : v === null || v === true
                ? 8
                : 10,
        );
      return v;
    }
    if (typeof v === "number") {
      check(Number.isFinite(v));
      if (tracked) charge(2 * JSON.stringify(v).length);
      return v;
    }
    check(typeof v === "object" && !active.has(v));
    const isArray = Array.isArray(v);
    check(
      Object.getPrototypeOf(v) ===
        (isArray ? Array.prototype : Object.prototype),
    );
    active.add(v);
    const keys = Reflect.ownKeys(v);
    charge(4 + 2 * Math.max(0, keys.length - (isArray ? 2 : 1)));
    const result: Record<string, unknown> | unknown[] = isArray ? [] : {};
    if (isArray) check(keys.length === (v as unknown[]).length + 1);
    const originals: unknown[] = [];
    for (const key of keys) {
      if (isArray && key === "length") {
        originals.push((v as unknown[]).length);
        continue;
      }
      check(typeof key === "string");
      if (tracked && !isArray)
        charge(2 + 2 * (yield* wireStringLengthSteps(key)));
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      check(d.enumerable && "value" in d);
      originals.push(d.value);
      if (isArray)
        check(
          /^(0|[1-9]\d*)$/.test(key) && Number(key) < (v as unknown[]).length,
        );
      Object.defineProperty(result, key, {
        value: yield* copy(d.value, depth + 1),
        enumerable: true,
      });
      yield;
    }
    // Returned wire values transfer read ownership until acceptance. Catch
    // mutations observable during a suspended object traversal without changing
    // caller-owned inputs or exposing the partially copied result.
    for (let i = 0; i < keys.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(v, keys[i]!);
      check(
        descriptor &&
          "value" in descriptor &&
          Object.is(descriptor.value, originals[i]),
      );
      yield;
    }
    check(Reflect.ownKeys(v).length === keys.length);
    active.delete(v);
    return Object.freeze(result);
  }
  const owned = (yield* copy(value, 0)) as T;
  onCost?.(bytes);
  return owned;
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
  const indexed = new RangeEvidence<TRow>();
  let topologyLookup:
    ReadonlyMap<string, { readonly childCount: number }> | undefined;
  let disposed = false;
  let topology: readonly {
    readonly route: PretableRemoteRoute;
    readonly childCount: number;
  }[] = [];
  function routeValid(route: PretableRemoteRoute) {
    canonicalRemoteRoute(route);
    check(route.length <= query.rowGroups.length);
    route.forEach((s, i) => check(s.columnId === query.rowGroups[i]?.columnId));
  }
  function* aggregateValues(
    values: Readonly<Record<string, PretableRemoteAggregateValue>>,
  ) {
    check(
      values &&
        !Array.isArray(values) &&
        Object.getPrototypeOf(values) === Object.prototype,
    );
    check(Object.keys(values).length === query.aggregates.length);
    for (const definition of query.aggregates) {
      yield;
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
  function routeCount(route: string): number | undefined {
    if (route === "[]") return session.rootCount;
    const known = topologyLookup?.get(`group:${route}`);
    if (known) return known.childCount;
    if (!topologyLookup) {
      const node = topology.find(
        (node) => canonicalRemoteRoute(node.route) === route,
      );
      if (node) return node.childCount;
    }
    return indexed.count(route);
  }
  function retainRange(r: PretableRemoteRange<TRow>) {
    const key = rangeAddress(r.route, r.start, r.end);
    indexed.set(key, r);
    ranges.set(key, r);
  }
  function* rangeSteps(
    request: PretableRemoteRangeRequest,
    input: PretableRemoteRange<TRow>,
    retain: boolean,
    maxBytes?: number,
    onCost?: (bytes: number) => void,
    beforeValidate?: (
      value: PretableRemoteRange<TRow>,
    ) => Generator<void, void>,
  ): Generator<void, PretableRemoteRange<TRow>> {
    check(!disposed);
    const r = yield* snapshotWireSteps(input, maxBytes, onCost);
    provenance(request, session);
    provenance(r, session);
    routeValid(request.route);
    routeValid(r.route);
    check(
      count(request.start) && count(request.end) && request.end > request.start,
    );
    check(
      r.start === request.start &&
        r.end === request.end &&
        canonicalRemoteRoute(r.route) === canonicalRemoteRoute(request.route),
    );
    check(count(r.siblingCount) && Array.isArray(r.entries));
    const route = canonicalRemoteRoute(r.route);
    const expected = routeCount(route);
    // A child request requires the authoritative parent descriptor first.
    check(expected !== undefined);
    if (expected !== r.siblingCount) fail("consistency");
    check(
      r.entries.length ===
        Math.max(0, Math.min(r.end, r.siblingCount) - r.start),
    );
    if (beforeValidate) yield* beforeValidate(r);
    const negativeZero = Symbol();
    const newIds = new Set<string | number | symbol>();
    for (const [i, node] of r.entries.entries()) {
      yield;
      check(node && (node.kind === "group" || node.kind === "leaf"));
      check(
        (node.kind === "group") === r.route.length < query.rowGroups.length,
      );
      const ordinal = r.start + i;
      let id: string | number | symbol;
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
        yield* aggregateValues(node.aggregates);
        const childCount = routeCount(canonicalRemoteRoute(node.route));
        if (childCount !== undefined && childCount !== node.childCount)
          fail("consistency");
        id = node.id;
      } else {
        check(
          typeof node.id === "string" ||
            (typeof node.id === "number" && Number.isFinite(node.id)),
        );
        id = Object.is(node.id, -0) ? negativeZero : node.id;
        check(
          node.row && typeof node.row === "object" && !Array.isArray(node.row),
        );
      }
      check(!newIds.has(id));
      newIds.add(id);
      const old = indexed.at(route, ordinal),
        position = indexed.find(node);
      if (
        (old && !(yield* equalWireSteps(old, node))) ||
        (position !== undefined &&
          (position.route !== route || position.ordinal !== ordinal))
      )
        fail("consistency");
    }
    if (retain) retainRange(r);
    return r;
  }
  function* summarySteps(
    scope: "filtered" | "all",
    input: PretableRemoteSummary,
    retain: boolean,
    maxBytes?: number,
    onCost?: (bytes: number) => void,
    beforeValidate?: (value: PretableRemoteSummary) => Generator<void, void>,
  ): Generator<void, PretableRemoteSummary> {
    check(!disposed);
    const s = yield* snapshotWireSteps(input, maxBytes, onCost);
    provenance(s, session);
    check(
      s.scope === scope &&
        s.registryVersion === query.registryVersion &&
        s.authority === "server",
    );
    check(s.completeness === "complete" || s.completeness === "partial");
    check(
      Array.isArray(s.aggregateIds) &&
        (yield* equalWireSteps(
          [...s.aggregateIds].sort(),
          query.aggregates.map((a) => a.id).sort(),
        )),
    );
    if (beforeValidate) yield* beforeValidate(s);
    yield* aggregateValues(s.values);
    const prior = summaries.get(scope);
    if (
      prior &&
      (prior.completeness !== s.completeness ||
        !(yield* equalWireSteps(prior.values, s.values)))
    )
      fail("consistency");
    if (retain) summaries.set(scope, s);
    return s;
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
        // Root ownership is authoritative in the accepted session itself.
        // Rebuilding every retained node/ID comparison cannot add evidence here.
        check(
          r.route.length === 0 ||
            routeCount(canonicalRemoteRoute(r.route)) !== undefined,
        );
        return r;
      });
    },
    acceptRange(
      request: PretableRemoteRangeRequest,
      input: PretableRemoteRange<TRow>,
      retain = true,
    ): PretableRemoteResult<PretableRemoteRange<TRow>> {
      return result(() => completeSteps(rangeSteps(request, input, retain)));
    },
    async acceptRangeCooperatively(
      request: PretableRemoteRangeRequest,
      input: PretableRemoteRange<TRow>,
      signal: PretableRemoteSignal,
      current: () => boolean,
      budget?: PreparationBudget,
      maxBytes?: number,
      beforeValidate?: (
        value: PretableRemoteRange<TRow>,
        bytes: number,
      ) => Generator<void, void>,
    ): Promise<
      | (PretableRemoteResult<PretableRemoteRange<TRow>> & {
          ownedBytes?: number;
          capacity?: "invalid-cost" | "metadata-capacity";
        })
      | undefined
    > {
      try {
        let ownedBytes: number | undefined;
        const prepared = await prepareCooperatively(
          rangeSteps(
            request,
            input,
            false,
            maxBytes,
            (bytes) => {
              ownedBytes = bytes;
            },
            beforeValidate
              ? (value) => beforeValidate(value, ownedBytes!)
              : undefined,
          ),
          signal,
          current,
          budget,
        );
        return prepared.ok
          ? { ok: true, value: prepared.value, ownedBytes }
          : undefined;
      } catch (error) {
        if (error instanceof ResponseCapacityError)
          return {
            ok: false,
            error: { code: "cancelled" },
            capacity: error.capacity,
          };
        return result(() => {
          throw error;
        });
      }
    },
    acceptSummary(
      scope: "filtered" | "all",
      input: PretableRemoteSummary,
      retain = true,
    ): PretableRemoteResult<PretableRemoteSummary> {
      return result(() => completeSteps(summarySteps(scope, input, retain)));
    },
    async acceptSummaryCooperatively(
      scope: "filtered" | "all",
      input: PretableRemoteSummary,
      signal: PretableRemoteSignal,
      current: () => boolean,
      budget?: PreparationBudget,
      maxBytes?: number,
      beforeValidate?: (
        value: PretableRemoteSummary,
        bytes: number,
      ) => Generator<void, void>,
    ): Promise<
      | (PretableRemoteResult<PretableRemoteSummary> & {
          ownedBytes?: number;
          capacity?: "invalid-cost" | "metadata-capacity";
        })
      | undefined
    > {
      try {
        let ownedBytes: number | undefined;
        const prepared = await prepareCooperatively(
          summarySteps(
            scope,
            input,
            false,
            maxBytes,
            (bytes) => {
              ownedBytes = bytes;
            },
            beforeValidate
              ? (value) => beforeValidate(value, ownedBytes!)
              : undefined,
          ),
          signal,
          current,
          budget,
        );
        return prepared.ok
          ? { ok: true, value: prepared.value, ownedBytes }
          : undefined;
      } catch (error) {
        if (error instanceof ResponseCapacityError)
          return {
            ok: false,
            error: { code: "cancelled" },
            capacity: error.capacity,
          };
        return result(() => {
          throw error;
        });
      }
    },
    retainTopology(nodes: typeof topology, lookup?: typeof topologyLookup) {
      topology = nodes;
      topologyLookup = lookup;
    },
    /** Commit only a successful preflight, with no external callbacks between. */
    commitRange(r: PretableRemoteRange<TRow>) {
      retainRange(r);
    },
    commitSummary(s: PretableRemoteSummary) {
      summaries.set(s.scope, s);
    },
    /** Release only together with the corresponding published payload eviction.
     * Forgotten overlaps remain the provider's sessionwide consistency duty. */
    releaseRange(route: PretableRemoteRoute, start: number, end: number) {
      const key = rangeAddress(route, start, end);
      ranges.delete(key);
      indexed.delete(key);
    },
    releaseSummary(scope: "filtered" | "all") {
      summaries.delete(scope);
    },
    retention() {
      const counts = new Set<string>(disposed ? [] : ["[]"]);
      for (const node of topology) counts.add(canonicalRemoteRoute(node.route));
      for (const range of ranges.values()) {
        counts.add(canonicalRemoteRoute(range.route));
        for (const node of range.entries)
          if (node.kind === "group")
            counts.add(canonicalRemoteRoute(node.route));
      }
      return {
        nodes: [...ranges.values()].reduce(
          (total, r) => total + r.entries.length,
          0,
        ),
        counts: counts.size,
        summaries: summaries.size,
      };
    },
    dispose() {
      ranges.clear();
      indexed.clear();
      topologyLookup = undefined;
      summaries.clear();
      topology = [];
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
