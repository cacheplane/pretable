import { canonicalRemoteRoute, remoteGroupId } from "./query";
import { rangeAddress } from "./validate-response";
import { readRemoteSummary } from "./summaries";
import type { RemoteSessionSnapshot } from "./session";
import type { ModelRetention } from "./model-retention";
import type { PretableRemoteModelSnapshot } from "./model-types";
import type {
  PretableRemoteCapabilities,
  PretableRemoteQuery,
  PretableRemoteRoute,
  PretableRemoteSlot,
  PretableRemoteStatus,
} from "./types";
export interface ModelBlock {
  readonly route: PretableRemoteRoute;
  readonly start: number;
  readonly end: number;
}
export function createModelView<TRow extends object, TColumns>(
  state: RemoteSessionSnapshot<TRow>,
  retention: ModelRetention<TRow>,
  query: PretableRemoteQuery<TColumns> | undefined,
  capabilities: PretableRemoteCapabilities,
  pending: ReadonlySet<string>,
  summaryPending: ReadonlySet<string>,
  blockSize: number,
): PretableRemoteModelSnapshot<TRow> {
  const view = state.view;
  const groups = retention.groups;
  const index = view
    ? retention.index(view.session.rootCount, groups)
    : undefined;
  const ranges = view?.ranges ?? [];
  const loading = new Set(pending);
  const entries = new Map<string, Map<number, PretableRemoteSlot<TRow>>>();
  const loaded: {
    index: number;
    node: (typeof ranges)[number]["entries"][number];
  }[] = [];
  let leaves = 0,
    groupCount = 0;
  for (const range of ranges) {
    const parent = range.route.length ? remoteGroupId(range.route) : null;
    const routeKey = canonicalRemoteRoute(range.route);
    const branch =
      entries.get(routeKey) ?? new Map<number, PretableRemoteSlot<TRow>>();
    entries.set(routeKey, branch);
    range.entries.forEach((node, offset) => {
      if (node.kind === "leaf") leaves++;
      else groupCount++;
      branch.set(range.start + offset, Object.freeze({ kind: "loaded", node }));
      const rank = index?.rank(parent, range.start + offset);
      if (rank !== undefined) loaded.push(Object.freeze({ index: rank, node }));
    });
  }
  loaded.sort((a, b) => a.index - b.index);
  Object.freeze(loaded);
  let status: PretableRemoteStatus;
  if (view && (state.state === "ready" || state.state === "stale"))
    status = Object.freeze({ state: state.state, session: view.session });
  else if (state.state === "error")
    status = Object.freeze({
      state: "error",
      error: state.error ?? { code: "invalid-response" as const },
    });
  else
    status = Object.freeze({
      state:
        state.state === "disposed"
          ? "disposed"
          : state.state === "idle"
            ? "idle"
            : "loading",
    });
  const summaries = Object.freeze({
    filtered: readRemoteSummary(
      query,
      capabilities,
      view?.session,
      view?.summaries ?? [],
      "filtered",
      state.errors?.["summary:filtered"],
      summaryPending.has("filtered"),
    ),
    all: readRemoteSummary(
      query,
      capabilities,
      view?.session,
      view?.summaries ?? [],
      "all",
      state.errors?.["summary:all"],
      summaryPending.has("all"),
    ),
  });
  return Object.freeze({
    status,
    generation: state.generation,
    rootCount: view?.session.rootCount ?? 0,
    displayCount: index?.rowCount ?? 0,
    residentCount: leaves + groupCount,
    residentLeafCount: leaves,
    residentGroupCount: groupCount,
    ...(retention.capacity ? { capacity: retention.capacity } : {}),
    ...(state.error ? { error: state.error } : {}),
    readSlot(rank: number): PretableRemoteSlot<TRow> | undefined {
      const address = index?.at(rank);
      if (!address) return;
      const route =
        address.parent === null
          ? Object.freeze([])
          : groups.get(address.parent)!.route;
      const found = entries
        .get(canonicalRemoteRoute(route))
        ?.get(address.ordinal);
      if (found) return found;
      const start = Math.floor(address.ordinal / blockSize) * blockSize;
      const key = rangeAddress(route, start, start + blockSize);
      const error = state.errors?.[key];
      return Object.freeze(
        error
          ? { kind: "error", route, ordinal: address.ordinal, error }
          : {
              kind: loading.has(key) ? "loading" : "unloaded",
              route,
              ordinal: address.ordinal,
            },
      );
    },
    loadedEntries: () => loaded.values(),
    getSummary: (scope: "filtered" | "all") => summaries[scope],
  });
}
