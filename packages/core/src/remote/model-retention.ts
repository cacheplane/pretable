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
 * Metadata-only commands reuse compatible topology. Payload changes prune the
 * bounded retained state and submit only changed records to cache validation. */
export class ModelRetention<TRow extends object> {
  readonly cache: RemoteCache;
  records = new Map<string, CacheRecord>();
  groups = new Map<string, ModelGroup>();
  expanded = new Set<string>();
  visible = 0;
  current = 0;
  capacity: CacheFailure | undefined;
  private scopes = new Set<number>();
  private residentGroups = new Set<string>();
  private geometry:
    | {
        rootCount: number;
        groups: Map<string, ModelGroup>;
        expanded: Set<string>;
        index: SparseIndex;
      }
    | undefined;
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
      this.groups = new Map();
      this.residentGroups = new Set();
      this.geometry = undefined;
    }
  }
  clearBodies() {
    for (const scope of [...this.scopes]) this.close(scope);
  }
  clearIntent() {
    this.expanded = new Set();
    this.geometry = undefined;
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
    protectedRanges?: ReadonlySet<string>;
  }) {
    const expectedEpoch = input.expectedEpoch ?? this.cache.snapshot().epoch;
    if (expectedEpoch !== this.cache.snapshot().epoch) {
      this.capacity = "stale-plan";
      return;
    }
    // With no payload/protection changes the accepted topology is compatible.
    // A collapse that can release an orphan ancestor takes the full pruning path.
    const metadataOnly =
      !input.root &&
      !input.protectedRanges &&
      (input.additions ?? []).every(
        (r) => r.kind === "external" || r.kind === "expansion",
      ) &&
      (input.drops ?? []).every((r) => {
        const kind = this.records.get(this.id(r))?.kind;
        return !kind || kind === "external" || kind === "expansion";
      }) &&
      (!input.expanded ||
        [...this.expanded].every(
          (id) => input.expanded!.has(id) || this.residentGroups.has(id),
        ));
    if (metadataOnly) {
      const prepared = this.cache.prepare({
        records: input.additions ?? [],
        drops: input.drops,
        expectedEpoch,
      });
      if (prepared.ok) {
        const changed = new Set(
          [...(input.additions ?? []), ...(input.drops ?? [])].map((r) =>
            this.id(r),
          ),
        );
        if (prepared.plan.evictions.every((r) => changed.has(this.id(r)))) {
          const groups = this.groups,
            expanded = input.expanded ?? this.expanded;
          let geometry =
            this.geometry?.expanded === expanded ? this.geometry : undefined;
          return {
            groups,
            evictions: [] as PretableRemoteRange<TRow>[],
            index: (rootCount: number) => {
              const index = this.index(rootCount, groups, expanded);
              geometry = { rootCount, groups, expanded, index };
              return index;
            },
            discard: () => {
              geometry = undefined;
              this.cache.discard(prepared.plan);
            },
            commit: () => {
              if (!this.cache.commit(prepared.plan)) {
                geometry = undefined;
                return false;
              }
              for (const r of input.drops ?? [])
                this.records.delete(this.id(r));
              for (const r of input.additions ?? [])
                this.records.set(this.id(r), r);
              this.expanded = expanded;
              this.geometry = geometry;
              geometry = undefined;
              return true;
            },
          };
        }
        this.cache.discard(prepared.plan);
      }
      // Pressure may evict payload together with acceptance evidence. Re-plan
      // through the shared pruning transaction, never silently drop that evidence.
    }
    const candidate = new Map(this.records);
    if (input.protectedRanges) {
      for (const [key, record] of candidate)
        if (
          record.kind === "payload" &&
          record.scope === this.visible &&
          Boolean(record.protected) !== input.protectedRanges.has(record.key)
        )
          candidate.set(key, {
            ...record,
            protected: input.protectedRanges.has(record.key),
          });
    }
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
    for (const r of input.additions ?? []) {
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
      const residentGroups = new Set(groups.keys());
      for (const id of expanded) retain(id);
      if (visible) {
        records.push(
          this.records.get(
            this.id({ scope: visible, key: "topology:root" }),
          ) ?? {
            scope: visible,
            key: "topology:root",
            kind: "topology",
            value: undefined,
            metadataBytes: 64,
          },
        );
        for (const group of groups.values()) {
          const previous = this.records.get(
            this.id({ scope: visible, key: `topology:${group.id}` }),
          );
          records.push(
            previous?.value === group
              ? previous
              : {
                  scope: visible,
                  key: `topology:${group.id}`,
                  kind: "topology",
                  value: group,
                  metadataBytes: wireBytes(group) * 2,
                },
          );
        }
        for (const [key, route] of stores)
          records.push(
            this.records.get(
              this.id({ scope: visible, key: `store:${key}` }),
            ) ?? {
              scope: visible,
              key: `store:${key}`,
              kind: "store",
              value: route,
              metadataBytes: wireBytes(route),
              protected: true,
            },
          );
      }
      const retained = new Map(records.map((r) => [this.id(r), r]));
      const prepared = this.cache.prepare({
        records: records.filter((r) => this.records.get(this.id(r)) !== r),
        drops: [...this.records.values()]
          .filter(
            (r) =>
              !releaseScopes.includes(r.scope) && !retained.has(this.id(r)),
          )
          .map((r) => ({ scope: r.scope, key: r.key })),
        releaseScopes,
        expectedEpoch,
      });
      if (
        prepared.ok &&
        prepared.plan.evictions.some(
          (r) =>
            r.kind === "payload" &&
            retained.has(this.id(r)) &&
            retained.get(this.id(r)) === this.records.get(this.id(r)),
        )
      ) {
        for (const eviction of prepared.plan.evictions)
          if (
            eviction.kind === "payload" &&
            retained.get(this.id(eviction)) ===
              this.records.get(this.id(eviction))
          )
            candidate.delete(this.id(eviction));
        this.cache.discard(prepared.plan);
        continue;
      }
      if (prepared.ok) {
        const evictions = [...this.records.values()]
          .filter(
            (r) =>
              r.kind === "payload" &&
              (!retained.has(this.id(r)) || incoming.has(this.id(r))),
          )
          .map((r) => r.value as PretableRemoteRange<TRow>);
        let geometry: typeof this.geometry;
        return {
          index: (rootCount: number) => {
            const index = this.index(rootCount, groups, expanded);
            geometry = { rootCount, groups, expanded, index };
            return index;
          },
          evictions,
          groups,
          discard: () => {
            geometry = undefined;
            this.cache.discard(prepared.plan);
          },
          commit: () => {
            if (!this.cache.commit(prepared.plan)) {
              geometry = undefined;
              return false;
            }
            this.records = retained;
            this.groups = groups;
            this.residentGroups = residentGroups;
            this.geometry = geometry;
            geometry = undefined;
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
    if (
      this.geometry?.rootCount === rootCount &&
      this.geometry.groups === groups &&
      this.geometry.expanded === expanded
    )
      return this.geometry.index;
    const index = new SparseIndex(rootCount, {
      maxNodes: this.cache.limits.topology,
      maxDepth: this.cache.limits.depth,
      maxExpanded: this.cache.limits.expansions,
    });
    index.resolveBatch(
      groups.values(),
      [...expanded].filter((id) => groups.has(id)),
    );
    if (groups === this.groups && expanded === this.expanded)
      this.geometry = { rootCount, groups, expanded, index };
    return index;
  }
}
