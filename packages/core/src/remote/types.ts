import type {
  ColumnIdOf,
  PretableColumnType,
  PretableQueryFor,
  PretableRowId,
  PretableRowGroupFor,
  PretableSortFor,
} from "@pretable-internal/row-model";

/** JSON-safe canonical server group keys. Undefined/bigint require a server registry encoding. @public */
export type PretableRemoteKey = string | number | boolean | null;
/** @public */
export interface PretableRemoteRouteSegment {
  readonly columnId: string;
  readonly key: PretableRemoteKey;
}
/** Root is the empty route. @public */
export type PretableRemoteRoute = readonly PretableRemoteRouteSegment[];
/** @public */
export type PretableRemoteSort<TColumns> = PretableSortFor<TColumns> & {
  readonly nulls: "first" | "last";
  readonly comparison: string;
};
/** One explicit sibling ordering rule at a grouping level; stable identity breaks ties. @public */
export type PretableRemoteGroupSort = {
  readonly level: number;
  readonly direction: "asc" | "desc";
  readonly nulls: "first" | "last";
  readonly comparison: string;
} & (
  | { readonly by: "key" }
  | { readonly by: "aggregate"; readonly aggregateId: string }
);
/** Registered aggregate definition, never a JavaScript callback. @public */
export interface PretableRemoteAggregate<TColumns> {
  readonly columnId: ColumnIdOf<TColumns>;
  readonly id: string;
}
/** Every data-changing dependency must be represented here. Keys are sensitive; do not log them. @public */
export interface PretableRemoteQuery<TColumns> extends Omit<
  PretableQueryFor<TColumns>,
  "sort" | "rowGroups"
> {
  readonly source: string;
  /** Opaque scope identity, never a credential. */
  readonly authScope: string;
  readonly schemaVersion: string;
  readonly registryVersion: string;
  readonly comparison: string;
  readonly locale: string;
  readonly rowGroups: readonly Pick<
    PretableRowGroupFor<TColumns>,
    "columnId"
  >[];
  readonly sort: readonly PretableRemoteSort<TColumns>[];
  readonly groupSort: readonly PretableRemoteGroupSort[];
  readonly aggregates: readonly PretableRemoteAggregate<TColumns>[];
  readonly projection: readonly ColumnIdOf<TColumns>[];
  readonly search?: string;
}
/** Provider allowlists are advisory; the backend independently enforces authorization and semantics. @public */
export interface PretableRemoteCapabilities {
  readonly rangeAccess: "ordinal";
  readonly exactCounts: true;
  readonly consistency: "immutable" | "versioned" | "revision-fence";
  readonly fields: Readonly<
    Record<
      string,
      {
        readonly type: PretableColumnType;
        readonly operators: readonly string[];
      }
    >
  >;
  readonly comparisons: readonly string[];
  readonly aggregates: readonly string[];
  readonly search: boolean;
  /** All-scope means the authorized base dataset at the accepted result version.
   * Unavailable scopes must not fall back to latest data or cached page totals. */
  readonly summaries: {
    readonly filtered: "same-version" | "unavailable";
    readonly all: "same-version" | "unavailable";
  };
  readonly maxGroupDepth: number;
  readonly maxRangeSize: number;
}
/** Intentionally value-free diagnostics. @public */
export type PretableRemoteError =
  | {
      readonly code:
        | "unsupported-query"
        | "invalid-query"
        | "invalid-response"
        | "consistency"
        | "expired"
        | "cancelled"
        | "timeout";
    }
  | { readonly code: "transient"; readonly retryAfterMs?: number }
  | { readonly code: "unauthorized"; readonly scope: "range" | "session" };
/** @public */
export type PretableRemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PretableRemoteError };
/** DOM-independent structural subset implemented by AbortSignal. Providers must settle after cancellation. @public */
export interface PretableRemoteSignal {
  readonly aborted: boolean;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { readonly once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}
/** Backend-enforced version; query identity and controller generation remain separate. @public */
export interface PretableRemoteSession {
  readonly queryKey: string;
  /** Provider resource identity; distinct even when opens share a version token. */
  readonly sessionId: string;
  readonly resultToken: string;
  readonly rootCount: number;
  readonly expiresAt?: number;
}
/** Values cover all matching descendant leaves, never just resident pages.
 * Token/query provenance is inherited from the containing range; route supplies scope.
 * @public */
export type PretableRemoteAggregateValue = {
  /** Use remoteAggregateDefinitionKey with the effective query registry, column and aggregate ID. */
  readonly aggregateDefinitionKey: string;
  readonly authority: "server";
} & (
  | {
      readonly state: "ready";
      readonly completeness: "complete" | "partial";
      readonly value: unknown;
    }
  | { readonly state: "unavailable" }
  | { readonly state: "error"; readonly error: PretableRemoteError }
);
/** @public */
export interface PretableRemoteGroup {
  readonly kind: "group";
  readonly id: string;
  readonly route: PretableRemoteRoute;
  readonly label: string;
  readonly childCount: number;
  readonly leafCount?: number;
  readonly aggregates: Readonly<Record<string, PretableRemoteAggregateValue>>;
}
/** @public */
export interface PretableRemoteLeaf<TRow extends object> {
  readonly kind: "leaf";
  readonly id: PretableRowId;
  readonly row: TRow;
}
/** Only materialized business nodes; status slots are separate. @public */
export type PretableRemoteNode<TRow extends object> =
  PretableRemoteGroup | PretableRemoteLeaf<TRow>;
/** @public */
export interface PretableRemoteRangeRequest extends PretableRemoteSession {
  readonly route: PretableRemoteRoute;
  readonly start: number;
  readonly end: number;
}
/** Exact immediate sibling count and echoed half-open request interval. @public */
export interface PretableRemoteRange<
  TRow extends object,
> extends PretableRemoteRangeRequest {
  readonly siblingCount: number;
  readonly entries: readonly PretableRemoteNode<TRow>[];
}
/** Server-authoritative provenance is independent of payload residency. @public */
export interface PretableRemoteSummary {
  readonly sessionId: string;
  readonly queryKey: string;
  readonly resultToken: string;
  readonly scope: "filtered" | "all";
  readonly registryVersion: string;
  readonly aggregateIds: readonly string[];
  readonly authority: "server";
  readonly completeness: "complete" | "partial";
  readonly values: Readonly<Record<string, PretableRemoteAggregateValue>>;
}
/** The provider must serve one coherent version or reject it; echoing tokens alone is insufficient.
 * Response rows and aggregate values use acyclic plain records/dense arrays with
 * string, boolean, null, undefined and finite number values. Classes, accessors,
 * symbols and executable values require application transport encoding.
 * Client evidence is retained with cached ranges; forgotten overlaps remain the
 * provider's consistency obligation.
 * Success values transfer immutable read ownership on delivery: providers must
 * not mutate returned objects afterwards. The model may snapshot them across
 * preparation tasks before publishing its own frozen copy. @public */
export interface PretableRemoteProvider<TRow extends object, TColumns> {
  readonly capabilities: PretableRemoteCapabilities;
  open(
    query: PretableRemoteQuery<TColumns>,
    queryKey: string,
    signal: PretableRemoteSignal,
  ): Promise<PretableRemoteResult<PretableRemoteSession>>;
  read(
    request: PretableRemoteRangeRequest,
    signal: PretableRemoteSignal,
  ): Promise<PretableRemoteResult<PretableRemoteRange<TRow>>>;
  summary(
    session: PretableRemoteSession,
    scope: "filtered" | "all",
    signal: PretableRemoteSignal,
  ): Promise<PretableRemoteResult<PretableRemoteSummary>>;
  release(session: PretableRemoteSession): Promise<void>;
}
/** Remote-only unavailable slots never carry records or selectable IDs. @public */
export type PretableRemoteSlot<TRow extends object> =
  | { readonly kind: "loaded"; readonly node: PretableRemoteNode<TRow> }
  | {
      readonly kind: "unloaded";
      readonly route: PretableRemoteRoute;
      readonly ordinal: number;
    }
  | {
      readonly kind: "loading";
      readonly route: PretableRemoteRoute;
      readonly ordinal: number;
    }
  | {
      readonly kind: "error";
      readonly route: PretableRemoteRoute;
      readonly ordinal: number;
      readonly error: PretableRemoteError;
    };
/** @public */
export type PretableRemoteStatus =
  | { readonly state: "idle" | "loading" | "disposed" }
  | {
      readonly state: "ready" | "stale";
      readonly session: PretableRemoteSession;
    }
  | { readonly state: "error"; readonly error: PretableRemoteError };
/** Minimal read-only observation contract; controller commands will be defined with their implementation. @public */
export interface PretableRemoteReadHandle<TRow extends object> {
  getStatus(): PretableRemoteStatus;
  /** Undefined means no valid slot at this index; an unloaded valid slot is explicit. */
  getSlot(index: number): PretableRemoteSlot<TRow> | undefined;
  subscribe(listener: () => void): () => void;
}
/** @public */
export type PretableRemotePreparedQuery =
  | { readonly ok: true; readonly queryKey: string }
  | { readonly ok: false; readonly error: PretableRemoteError };
