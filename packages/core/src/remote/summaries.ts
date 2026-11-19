import { remoteAggregateDefinitionKey } from "./query";
import type {
  PretableRemoteCapabilities,
  PretableRemoteError,
  PretableRemoteQuery,
  PretableRemoteSession,
  PretableRemoteSummary,
} from "./types";
/** @public */
export type PretableRemoteSummaryAnswer =
  | { readonly state: "unavailable" | "loading" }
  | { readonly state: "error"; readonly error: PretableRemoteError }
  | { readonly state: "ready"; readonly summary: PretableRemoteSummary };
export function readRemoteSummary<TColumns>(
  query: PretableRemoteQuery<TColumns> | undefined,
  capabilities: PretableRemoteCapabilities,
  session: PretableRemoteSession | undefined,
  summaries: readonly PretableRemoteSummary[],
  scope: "filtered" | "all",
  error?: PretableRemoteError,
  loading = false,
): PretableRemoteSummaryAnswer {
  if (!query || !session || capabilities.summaries[scope] !== "same-version")
    return Object.freeze({ state: "unavailable" });
  if (error) return Object.freeze({ state: "error", error });
  const summary = summaries.find(
    (s) =>
      s.scope === scope &&
      s.sessionId === session.sessionId &&
      s.queryKey === session.queryKey &&
      s.resultToken === session.resultToken &&
      s.registryVersion === query.registryVersion &&
      s.aggregateIds.length === query.aggregates.length &&
      query.aggregates.every(
        (a) =>
          s.values[a.id]?.aggregateDefinitionKey ===
          remoteAggregateDefinitionKey(
            query.registryVersion,
            String(a.columnId),
            a.id,
          ),
      ),
  );
  return Object.freeze(
    summary
      ? { state: "ready", summary }
      : { state: loading ? "loading" : "unavailable" },
  );
}
