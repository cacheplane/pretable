import { RemoteCache, type CacheRecord, type CacheFailure } from "./cache";
import { canonicalRemoteRoute, remoteGroupId } from "./query";
import { rangeAddress } from "./validate-response";
import { SparseIndex, type SparseGroup } from "./sparse-index";
import type { PretableRemoteModelOptions } from "./model-types";
import type {
  PretableRemoteRange,
  PretableRemoteRoute,
  PretableRemoteSummary,
} from "./types";

export interface ModelGroup extends SparseGroup {
  readonly route: PretableRemoteRoute;
}
export const wireBytes = (value: unknown): number =>
  64 + 2 * JSON.stringify(value).length;
const addressKey = (r: {
  route: PretableRemoteRoute;
  start: number;
  end: number;
}) => rangeAddress(r.route, r.start, r.end);
/** The cache is the sole retention authority. These maps are indexes into the
 * same frozen accepted objects; their map/key/descriptor overhead is charged.
 * Planning scans bounded retained state; incremental planning is Task 9. */
export class ModelRetention<TRow extends object> {
  readonly cache: RemoteCache;
  records = new Map<string, CacheRecord>();
  groups = new Map<string, ModelGroup>();
  expanded = new Set<string>();
  visible = 0;
  current = 0;
  capacity: CacheFailure | undefined;
  private scopes = new Set<number>();
  constructor(readonly options: PretableRemoteModelOptions) {
    this.cache = new RemoteCache(options.limits);
  }
  private id(record: Pick<CacheRecord, "scope" | "key">) {
    return JSON.stringify([record.scope, record.key]);
  }
  begin(generation: number) {
    for (const scope of [...this.scopes])
      if (scope !== this.visible) this.close(scope);
    this.current = generation;
    if (!this.cache.openScope(generation)) {
      this.capacity = "metadata-capacity";
      return false;
    }
    this.scopes.add(generation);
    return true;
  }
  close(scope: number) {
    this.cache.closeScope(scope);
    this.scopes.delete(scope);
    for (const [key, record] of this.records)
      if (record.scope === scope) this.records.delete(key);
    if (this.visible === scope) {
      this.visible = 0;
      this.groups.clear();
    }
  }
  clearBodies() {
    for (const scope of [...this.scopes]) this.close(scope);
  }
  clearIntent() {
    this.expanded.clear();
    for (const [key, record] of this.records)
      if (record.kind === "expansion") {
        this.cache.drop(-1, record.key);
        this.records.delete(key);
      }
  }
  dropGlobal(key: string) {
    this.cache.drop(-1, key);
    this.records.delete(this.id({ scope: -1, key }));
  }
  protect(wanted: ReadonlySet<string>) {
    for (const [key, record] of this.records) {
      if (record.kind !== "payload") continue;
      const protect = record.scope === this.visible && wanted.has(record.key);
      this.cache.protect(record.scope, record.key, protect);
      this.records.set(key, { ...record, protected: protect });
    }
  }
  ranges(scope = this.visible): PretableRemoteRange<TRow>[] {
    return [...this.records.values()]
      .filter((r) => r.scope === scope && r.kind === "payload")
      .map((r) => r.value as PretableRemoteRange<TRow>);
  }
  prepare(input: {
    additions?: readonly CacheRecord[];
    drops?: readonly { scope: number; key: string }[];
    root?: boolean;
    expectedEpoch?: number;
    expanded?: Set<string>;
  }) {
    const expectedEpoch = input.expectedEpoch ?? this.cache.snapshot().epoch;
    if (expectedEpoch !== this.cache.snapshot().epoch) {
      this.capacity = "stale-plan";
      return;
    }
    const candidate = new Map(this.records);
    const releaseScopes = input.root
      ? [...this.scopes].filter((scope) => scope !== this.current)
      : [];
    for (const [key, r] of candidate)
      if (
        releaseScopes.includes(r.scope) ||
        r.kind === "topology" ||
        r.kind === "store"
      )
        candidate.delete(key);
    for (const drop of input.drops ?? []) candidate.delete(this.id(drop));
    for (const r of input.additions ?? []) candidate.set(this.id(r), r);
    const expanded = input.expanded ?? this.expanded;
    const incoming = new Set((input.additions ?? []).map((r) => this.id(r)));
    const visible = input.root ? this.current : this.visible;
    const known = input.root
      ? new Map<string, ModelGroup>()
      : new Map(this.groups);
    for (const r of candidate.values()) {
      if (r.kind !== "payload" || r.scope !== visible) continue;
      const range = r.value as PretableRemoteRange<TRow>;
      range.entries.forEach((node, offset) => {
        if (node.kind === "group")
          known.set(
            node.id,
            Object.freeze({
              id: node.id,
              parent: range.route.length ? remoteGroupId(range.route) : null,
              ordinal: range.start + offset,
              route: node.route,
              childCount: node.childCount,
            }),
          );
      });
    }
    for (;;) {
      const groups = new Map<string, ModelGroup>();
      const retain = (id: string) => {
        if (groups.has(id)) return;
        const group = known.get(id);
        if (!group) return;
        if (group.parent !== null) retain(group.parent);
        groups.set(id, group);
      };
      for (const id of expanded) retain(id);
      const records = [...candidate.values()];
      const stores = new Map<string, PretableRemoteRoute>();
      for (const r of records) {
        if (r.kind !== "payload" || r.scope !== visible) continue;
        const range = r.value as PretableRemoteRange<TRow>;
        stores.set(canonicalRemoteRoute(range.route), range.route);
        if (range.route.length) retain(remoteGroupId(range.route));
        for (const node of range.entries)
          if (node.kind === "group") retain(node.id);
      }
      if (visible) {
        records.push({
          scope: visible,
          key: "topology:root",
          kind: "topology",
          value: undefined,
          metadataBytes: 64,
        });
        for (const group of groups.values())
          records.push({
            scope: visible,
            key: `topology:${group.id}`,
            kind: "topology",
            value: group,
            metadataBytes: wireBytes(group) * 2,
          });
        for (const [key, route] of stores)
          records.push({
            scope: visible,
            key: `store:${key}`,
            kind: "store",
            value: route,
            metadataBytes: wireBytes(route),
            protected: true,
          });
      }
      const prepared = this.cache.prepare({
        records,
        drops: [...this.records.values()]
          .filter((r) => !releaseScopes.includes(r.scope))
          .map((r) => ({ scope: r.scope, key: r.key })),
        releaseScopes,
        expectedEpoch,
      });
      if (prepared.ok) {
        const retained = new Map(records.map((r) => [this.id(r), r]));
        const evictions = [...this.records.values()]
          .filter(
            (r) =>
              r.kind === "payload" &&
              (!retained.has(this.id(r)) || incoming.has(this.id(r))),
          )
          .map((r) => r.value as PretableRemoteRange<TRow>);
        return {
          evictions,
          groups,
          discard: () => this.cache.discard(prepared.plan),
          commit: () => {
            if (!this.cache.commit(prepared.plan)) return false;
            this.records = retained;
            this.groups = groups;
            this.expanded = expanded;
            this.visible = visible;
            for (const scope of releaseScopes) this.scopes.delete(scope);
            return true;
          },
        };
      }
      if (
        prepared.reason === "stale-plan" ||
        prepared.reason === "invalid-cost"
      ) {
        this.capacity = prepared.reason;
        return;
      }
      const cold = [...candidate].find(
        ([key, r]) =>
          r.kind === "payload" && !r.protected && !incoming.has(key),
      );
      if (!cold) {
        this.capacity = prepared.reason;
        return;
      }
      candidate.delete(cold[0]);
    }
  }
  responseRecord(
    generation: number,
    value: PretableRemoteRange<TRow> | PretableRemoteSummary,
    protectedRange: boolean,
  ): CacheRecord {
    const bytes =
      this.options.estimateResponseBytes?.(value) ?? wireBytes(value);
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > this.cache.limits.responseBytes
    )
      throw new RangeError("response cost");
    if ("scope" in value)
      return {
        scope: generation,
        key: `summary:${value.scope}`,
        kind: "external",
        value,
        metadataBytes: bytes * 2,
      };
    return {
      scope: generation,
      key: addressKey(value),
      kind: "payload",
      value,
      entries: value.entries.length,
      bytes: bytes * 2,
      metadataBytes:
        128 +
        256 * value.entries.length +
        wireBytes(value.route) +
        16 * addressKey(value).length,
      address: {
        generation,
        route: value.route,
        start: value.start,
        end: value.end,
      },
      protected: protectedRange,
    };
  }
  index(rootCount: number, groups = this.groups, expanded = this.expanded) {
    const index = new SparseIndex(rootCount, {
      maxNodes: this.cache.limits.topology,
      maxDepth: this.cache.limits.depth,
      maxExpanded: this.cache.limits.expansions,
    });
    for (const group of groups.values()) index.resolve(group);
    for (const id of expanded) if (groups.has(id)) index.setExpanded(id, true);
    return index;
  }
}
