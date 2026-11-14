/** Input population summarized before grouping, expansion and virtualization. @public */
export type PretableSummaryScope = "filtered" | "all";

/** Cached result owned by one immutable model revision. @public */
export interface PretableEngineSummary {
  readonly scope: PretableSummaryScope;
  /** Canonical column IDs; missing columns have no aggregate, null is an empty result. */
  readonly values: Readonly<Record<string, unknown>>;
}
