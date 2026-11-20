import type { CachePlan, CacheRecord, RemoteCache } from "./cache";
import type { ModelGroup } from "./model-retention";
import type { SparseIndex } from "./sparse-index";
import type { PretableRemoteRange } from "./types";

export interface RetainedGeometry {
  rootCount: number;
  groups: Map<string, ModelGroup>;
  expanded: Set<string>;
  index: SparseIndex;
}
export interface RetentionCandidate<TRow extends object> {
  cachePlan: CachePlan;
  records?: Map<string, CacheRecord>;
  additions?: readonly CacheRecord[];
  drops?: readonly { scope: number; key: string }[];
  groups: Map<string, ModelGroup>;
  residentGroups: Set<string>;
  expanded: Set<string>;
  visible: number;
  releaseScopes: readonly number[];
  evictions: PretableRemoteRange<TRow>[];
  geometry?: RetainedGeometry;
}
/** All cross-turn candidate references live in a clearable cell, never captured
 * as independent const maps by plan closures. Discard revokes work immediately. */
export function createRetentionPlan<TRow extends object>(
  cache: RemoteCache,
  state: RetentionCandidate<TRow> | undefined,
  accept: (candidate: RetentionCandidate<TRow>) => void,
  index: (
    rootCount: number,
    groups: Map<string, ModelGroup>,
    expanded: Set<string>,
  ) => SparseIndex,
  build: (
    rootCount: number,
    groups: Map<string, ModelGroup>,
    expanded: Set<string>,
  ) => Generator<void, SparseIndex>,
) {
  let evictions = state!.evictions;
  let preparing: Generator<void, SparseIndex | undefined> | undefined;
  return {
    get evictions() {
      return evictions;
    },
    index(rootCount: number) {
      if (!state) throw new Error("Invalidated remote candidate");
      const geometry = index(rootCount, state.groups, state.expanded);
      state.geometry = {
        rootCount,
        groups: state.groups,
        expanded: state.expanded,
        index: geometry,
      };
      return geometry;
    },
    indexSteps(rootCount: number): Generator<void, SparseIndex | undefined> {
      if (!state) throw new Error("Invalidated remote candidate");
      const builder: Generator<void, SparseIndex | undefined> = (function* () {
        try {
          if (!state) return;
          const candidate = state;
          const geometry = yield* build(
            rootCount,
            candidate.groups,
            candidate.expanded,
          );
          if (state !== candidate) return;
          state.geometry = {
            rootCount,
            groups: state.groups,
            expanded: state.expanded,
            index: geometry,
          };
          return geometry;
        } finally {
          preparing = undefined;
        }
      })();
      preparing?.return(undefined);
      preparing = builder;
      return builder;
    },
    discard() {
      preparing?.return(undefined);
      preparing = undefined;
      if (state) cache.discard(state.cachePlan);
      state = undefined;
      evictions = [];
    },
    commit() {
      if (preparing) return false;
      if (!state) return false;
      const candidate = state;
      state = undefined;
      if (!cache.commit(candidate.cachePlan)) {
        evictions = [];
        return false;
      }
      accept(candidate);
      return true;
    },
  };
}
