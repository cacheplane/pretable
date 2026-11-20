import { canonicalRemoteRoute } from "./query";
import type { PretableRemoteRoute } from "./types";

/** Internal admission owner. Costs are accounted estimates, never process heap
 * measurements. The adapter must enforce decoded response limits and calculate
 * costs before prepare; no user sizing hooks run during commit. */
export interface RemoteCacheLimits {
  payloadEntries: number;
  payloadBytes: number;
  ingressBytes: number;
  responseBytes: number;
  stores: number;
  topology: number;
  depth: number;
  expansions: number;
  selectedIds: number;
  cellRanges: number;
  measurements: number;
  metadataBytes: number;
}
export const DEFAULT_REMOTE_CACHE_LIMITS: Readonly<RemoteCacheLimits> =
  Object.freeze({
    payloadEntries: 5000,
    payloadBytes: 32 * 1024 * 1024,
    ingressBytes: 32 * 1024 * 1024,
    responseBytes: 8 * 1024 * 1024,
    stores: 256,
    topology: 8192,
    depth: 32,
    expansions: 2048,
    selectedIds: 10000,
    cellRanges: 32,
    measurements: 100000,
    metadataBytes: 8 * 1024 * 1024,
  });
export type CacheKind =
  | "payload"
  | "store"
  | "topology"
  | "expansion"
  | "selection"
  | "cellRange"
  | "measurement"
  | "external";
export interface PayloadAddress {
  readonly generation: number;
  readonly route: PretableRemoteRoute;
  readonly start: number;
  readonly end: number;
}
/** One retained object/block. Overlapping blocks are charged independently.
 * key is an internal identity, not a display ID. Additional IDs/keys nested in
 * value must be included in metadataBytes. Payload bytes include frozen copies
 * and overlap-ledger evidence. Non-payload values are charged in metadataBytes.
 * Callers must never mutate retained values after admission. */
export interface CacheRecord {
  readonly scope: number;
  readonly key: string;
  readonly kind: CacheKind;
  readonly value: unknown;
  readonly bytes?: number;
  readonly entries?: number;
  readonly metadataBytes?: number;
  readonly address?: PayloadAddress;
  readonly protected?: boolean;
  readonly tier?: "cold" | "overscan" | "prefetch";
}
export interface CacheEviction {
  readonly scope: number;
  readonly key: string;
  readonly kind: CacheKind;
  readonly address?: PayloadAddress;
}
/** Sensitive eviction addresses are for synchronous integration only. They are
 * deliberately absent from diagnostics. Plans/snapshots retained externally are
 * owned by the consumer, outside this owner's budget. */
export interface CachePlan {
  readonly evictions: readonly CacheEviction[];
  readonly releasedScopes: readonly number[];
}
export type CacheFailure =
  | "invalid-cost"
  | "stale-plan"
  | "unknown-scope"
  | "payload-capacity"
  | "metadata-capacity"
  | "minimum-visible-too-large"
  | "intent-capacity";
export type CachePreparation =
  | { readonly ok: true; readonly plan: CachePlan }
  | { readonly ok: false; readonly reason: CacheFailure };
interface Retained {
  readonly record: CacheRecord;
  readonly metadata: number;
  readonly stamp: number;
}
interface Prepared {
  readonly epoch: number;
  readonly records: Map<string, Retained>;
  readonly scopes: Set<number>;
}
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
const identity = (scope: number, key: string) => JSON.stringify([scope, key]);
const intentKinds = new Set<CacheKind>([
  "topology",
  "expansion",
  "selection",
  "cellRange",
  "external",
]);
const kinds = new Set<CacheKind>([
  "payload",
  "store",
  "measurement",
  ...intentKinds,
]);
const failure = (reason: CacheFailure): CachePreparation => ({
  ok: false,
  reason,
});

/** Accounted record/map/key ownership, shared by staged credit and admission. */
export function cacheRecordMetadata(record: CacheRecord): number {
  const key = identity(record.scope, record.key),
    address = record.address;
  return (
    64 +
    2 * (record.key.length + key.length) +
    (record.metadataBytes ?? 0) +
    (address
      ? 32 +
        address.route.reduce(
          (n, part) =>
            n +
            48 +
            2 * part.columnId.length +
            (typeof part.key === "string" ? 2 * part.key.length : 8),
          0,
        )
      : 0)
  );
}

export class RemoteCache {
  readonly limits: Readonly<RemoteCacheLimits>;
  private records = new Map<string, Retained>();
  private scopes = new Set<number>();
  private epoch = 0;
  private stamp = 0;
  private plans = new WeakMap<CachePlan, Prepared>();
  private readonly leases = new Map<object, number>();
  private ingressBytes = 0;

  constructor(limits: Partial<RemoteCacheLimits> = {}) {
    const merged = { ...DEFAULT_REMOTE_CACHE_LIMITS, ...limits };
    for (const [name, value] of Object.entries(merged)) {
      if (
        !safe(value) ||
        ((name === "responseBytes" || name === "depth") && value === 0)
      ) {
        throw new RangeError(`Invalid remote cache limit: ${name}`);
      }
    }
    this.limits = Object.freeze(merged);
  }

  openScope(scope: number): boolean {
    if (!safe(scope)) return false;
    if (this.scopes.has(scope)) return true;
    if (
      this.scopes.size === 2 ||
      this.snapshot().metadataBytes > this.limits.metadataBytes - 64
    )
      return false;
    this.scopes.add(scope);
    this.changed();
    return true;
  }

  /** Source/auth/disposal removal. Physical ingress remains reserved until the
   * transport settles AND acceptance/discard finishes, even after abort. */
  closeScope(scope: number): void {
    if (!this.scopes.delete(scope)) return;
    for (const [key, retained] of this.records) {
      if (retained.record.scope === scope) this.records.delete(key);
    }
    this.changed();
  }

  reserveIngress(bytes: number): object | undefined {
    if (
      !safe(bytes) ||
      bytes === 0 ||
      bytes > this.limits.responseBytes ||
      bytes > this.limits.ingressBytes - this.ingressBytes ||
      this.snapshot().metadataBytes > this.limits.metadataBytes - 64
    )
      return undefined;
    const lease = Object.freeze({});
    this.leases.set(lease, bytes);
    this.ingressBytes += bytes;
    this.changed();
    return lease;
  }

  /** Returns whether a lease was released; the adapter may then wake blocked
   * work once. No notification or automatic retry runs inside this owner. */
  releaseIngress(lease: object): boolean {
    const bytes = this.leases.get(lease);
    if (bytes === undefined) return false;
    this.leases.delete(lease);
    this.ingressBytes -= bytes;
    this.changed();
    return true;
  }

  get(scope: number, key: string): unknown {
    return this.records.get(identity(scope, key))?.record.value;
  }

  touch(scope: number, key: string): void {
    const id = identity(scope, key);
    const retained = this.records.get(id);
    if (!retained) return;
    this.records.set(id, { ...retained, stamp: ++this.stamp });
    this.changed();
  }

  protect(scope: number, key: string, protect: boolean): void {
    const id = identity(scope, key);
    const retained = this.records.get(id);
    if (!retained || Boolean(retained.record.protected) === protect) return;
    this.records.set(id, {
      ...retained,
      record: Object.freeze({ ...retained.record, protected: protect }),
    });
    this.changed();
  }

  drop(scope: number, key: string): void {
    if (this.records.delete(identity(scope, key))) this.changed();
  }

  snapshot() {
    return Object.freeze({
      epoch: this.epoch,
      scopes: this.scopes.size,
      records: this.records.size,
      ingressBytes: this.ingressBytes,
      ...this.count(this.records, this.scopes.size),
    });
  }

  /** Prepare is speculative and must not notify observers. Capture expectedEpoch
   * BEFORE invoking adapter sizing hooks; a reentrant mutation invalidates it.
   * releaseScopes explicitly permits dropping a retiring protected body, never
   * expansion/selection intent retained outside that body's scope. */
  prepare(input: {
    readonly records: readonly CacheRecord[];
    readonly drops?: readonly {
      readonly scope: number;
      readonly key: string;
    }[];
    readonly releaseScopes?: readonly number[];
    readonly expectedEpoch?: number;
  }): CachePreparation {
    // Even a refused successor revokes the previous speculative candidate.
    this.plans = new WeakMap();
    const epoch = this.epoch;
    if (input.expectedEpoch !== undefined && input.expectedEpoch !== epoch)
      return failure("stale-plan");
    const records = new Map(this.records);
    const scopes = new Set(this.scopes);
    const added = new Set<string>();
    const evictions: CacheEviction[] = [];
    const remove = (key: string) => {
      const retained = records.get(key);
      if (!retained) return;
      const { scope, kind, address, key: recordKey } = retained.record;
      evictions.push(
        Object.freeze({
          scope,
          key: recordKey,
          kind,
          ...(address ? { address } : {}),
        }),
      );
      records.delete(key);
    };
    try {
      const releasedScopes = [...new Set(input.releaseScopes ?? [])];
      for (const scope of releasedScopes) {
        if (!scopes.delete(scope)) return failure("unknown-scope");
        for (const [key, retained] of records)
          if (retained.record.scope === scope) remove(key);
      }
      for (const drop of input.drops ?? [])
        remove(identity(drop.scope, drop.key));
      for (const source of input.records) {
        // Copy input during preparation, never execute external code at commit.
        const record: CacheRecord = Object.freeze({
          ...source,
          ...(source.address
            ? {
                address: Object.freeze({
                  ...source.address,
                  route: Object.freeze(
                    source.address.route.map((segment) =>
                      Object.freeze({ ...segment }),
                    ),
                  ),
                }),
              }
            : {}),
        });
        // -1 is controller-lifetime accounting only, not a third data view.
        // Session bodies, payload, topology and summaries never use this scope.
        if (
          !scopes.has(record.scope) &&
          !(
            record.scope === -1 &&
            (record.kind === "external" || record.kind === "expansion") &&
            !record.address
          )
        )
          return failure("unknown-scope");
        if (
          typeof record.key !== "string" ||
          !kinds.has(record.kind) ||
          !safe(record.bytes ?? 0) ||
          !safe(record.entries ?? 0) ||
          !safe(record.metadataBytes ?? 0)
        )
          return failure("invalid-cost");
        if (
          record.tier !== undefined &&
          !["cold", "overscan", "prefetch"].includes(record.tier)
        )
          return failure("invalid-cost");
        const address = record.address;
        if (
          record.kind === "payload" &&
          (!address || !safe(record.entries ?? -1) || !safe(record.bytes ?? -1))
        )
          return failure("invalid-cost");
        if (
          address &&
          (!safe(address.generation) ||
            address.generation !== record.scope ||
            !safe(address.start) ||
            !safe(address.end) ||
            address.start >= address.end ||
            address.route.length > this.limits.depth)
        )
          return failure("invalid-cost");
        if (address) canonicalRemoteRoute(address.route);
        const key = identity(record.scope, record.key);
        const metadata = cacheRecordMetadata(record);
        if (!safe(metadata)) return failure("invalid-cost");
        if (added.has(key)) return failure("invalid-cost");
        added.add(key);
        // Replacement must co-release old acceptance evidence at composition.
        remove(key);
        records.set(key, { record, metadata, stamp: this.stamp + added.size });
      }
      const count = this.count(records, scopes.size);
      if (!Object.values(count).every(safe)) return failure("invalid-cost");
      if (
        count.topology > this.limits.topology ||
        count.expansions > this.limits.expansions ||
        count.selectedIds > this.limits.selectedIds ||
        count.cellRanges > this.limits.cellRanges
      )
        return failure("intent-capacity");
      const excess = (usage = count) =>
        usage.payloadEntries > this.limits.payloadEntries ||
        usage.payloadBytes > this.limits.payloadBytes ||
        usage.metadataBytes > this.limits.metadataBytes ||
        usage.stores > this.limits.stores ||
        usage.measurements > this.limits.measurements;
      const priority = (r: Retained) =>
        r.record.tier === "prefetch" ? 0 : r.record.tier === "overscan" ? 1 : 2;
      const candidates = excess()
        ? [...records]
            .filter(
              ([key, r]) =>
                !added.has(key) &&
                !r.record.protected &&
                !intentKinds.has(r.record.kind),
            )
            .sort(
              (a, b) =>
                priority(a[1]) - priority(b[1]) || a[1].stamp - b[1].stamp,
            )
        : [];
      for (const [key, retained] of candidates) {
        if (!excess()) break;
        const kind = retained.record.kind;
        if (
          count.metadataBytes <= this.limits.metadataBytes &&
          !(
            kind === "payload" &&
            (count.payloadEntries > this.limits.payloadEntries ||
              count.payloadBytes > this.limits.payloadBytes)
          ) &&
          !(kind === "store" && count.stores > this.limits.stores) &&
          !(
            kind === "measurement" &&
            count.measurements > this.limits.measurements
          )
        )
          continue;
        const removed = this.count(new Map([[key, retained]]), 0, 0);
        for (const field of Object.keys(count) as (keyof typeof count)[])
          count[field] -= removed[field];
        remove(key);
      }
      if (excess()) {
        // The atomic batch may contain optional incoming prefetch/overscan.
        // Diagnose the protected minimum without those evictable records, but
        // never pretend that required topology or user intent can be dropped.
        const required = new Map(
          [...records].filter(
            ([, retained]) =>
              retained.record.protected ||
              intentKinds.has(retained.record.kind),
          ),
        );
        if (
          [...added].some((key) => records.get(key)?.record.protected) &&
          excess(this.count(required, scopes.size))
        )
          return failure("minimum-visible-too-large");
        return failure(
          count.metadataBytes > this.limits.metadataBytes
            ? "metadata-capacity"
            : "payload-capacity",
        );
      }
      if (this.epoch !== epoch) return failure("stale-plan");
      const plan = Object.freeze({
        evictions: Object.freeze(evictions),
        releasedScopes: Object.freeze(releasedScopes),
      });
      // Only the latest successful preparation remains eligible for commit.
      this.plans = new WeakMap();
      this.plans.set(plan, { epoch, records, scopes });
      return { ok: true, plan };
    } catch {
      return failure(this.epoch !== epoch ? "stale-plan" : "invalid-cost");
    }
  }

  /** Adapter validates its own participants before commit and synchronously
   * applies these evictions to session ranges and overlap evidence before any
   * observer notification. No callbacks run here. One-shot, owner-bound plans. */
  commit(plan: CachePlan): boolean {
    const prepared = this.plans.get(plan);
    this.plans.delete(plan);
    if (!prepared || prepared.epoch !== this.epoch) return false;
    this.records = prepared.records;
    this.scopes = prepared.scopes;
    this.stamp += this.records.size + 1;
    this.changed();
    return true;
  }

  /** Release discarded speculative values without admitting or notifying. */
  discard(plan: CachePlan): void {
    this.plans.delete(plan);
  }

  private changed(): void {
    this.epoch++;
    // No prepared historical body survives source/auth/disposal mutations.
    this.plans = new WeakMap();
  }

  private count(
    records: ReadonlyMap<string, Retained>,
    scopeCount = this.scopes.size,
    leaseCount = this.leases.size,
  ) {
    const count = {
      payloadEntries: 0,
      payloadBytes: 0,
      metadataBytes: 64 * (scopeCount + leaseCount),
      stores: 0,
      topology: 0,
      expansions: 0,
      selectedIds: 0,
      cellRanges: 0,
      measurements: 0,
    };
    for (const { record, metadata } of records.values()) {
      count.metadataBytes += metadata;
      switch (record.kind) {
        case "payload":
          count.payloadBytes += record.bytes ?? 0;
          count.payloadEntries += record.entries ?? 0;
          break;
        case "store":
          count.stores++;
          break;
        case "topology":
          count.topology++;
          break;
        case "expansion":
          count.expansions++;
          break;
        case "selection":
          count.selectedIds++;
          break;
        case "cellRange":
          count.cellRanges++;
          break;
        case "measurement":
          count.measurements++;
          break;
      }
    }
    return count;
  }
}
