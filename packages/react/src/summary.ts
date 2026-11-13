import type {
  PretableEngineSummary,
  PretableProcessingOptions,
  PretableSummaryScope,
} from "@pretable/core";

/** Application-supplied answer; keys describe semantics, never presentation. @public */
export type PretableServerSummaryResult =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "error"; readonly message?: string }
  | ({ readonly state: "ready" } & PretableSummaryValues)
  | ({
      readonly state: "stale";
      readonly label: string;
    } & PretableSummaryValues);
/** Provenance and population claim attached to an answer. @public */
export interface PretableSummaryValues {
  readonly requestKey: string;
  readonly aggregateDefinitionKey: string;
  readonly completeness: "complete" | "partial";
  readonly values: Readonly<Record<string, unknown>>;
}
/** Independent computation authority for one summary scope. @public */
export type PretableSummaryDescriptor =
  | {
      readonly authority: "engine";
      readonly label?: string;
      readonly completeness?: "complete" | "partial";
    }
  | {
      readonly authority: "server";
      readonly label?: string;
      /** Change for filters, dataset/auth context, data revisions, aggregate overrides,
       * and sort/order revisions relevant to order-sensitive aggregates. No keys are generated. */
      readonly requestKey: string;
      /** Change when column value semantics or effective aggregate definitions change. */
      readonly aggregateDefinitionKey: string;
      readonly result: PretableServerSummaryResult;
    };
/** Opt-in scopes; absent scopes do no work. @public */
export type PretableSummaries = Readonly<
  Partial<Record<PretableSummaryScope, PretableSummaryDescriptor>>
>;
/** Normalized answer, safe to present with its caption and context. @public */
export type PretableResolvedSummary = {
  readonly scope: PretableSummaryScope;
  readonly authority: "engine" | "server";
  readonly caption: string;
} & (
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "error"; readonly message?: string }
  | ({
      readonly values: Readonly<Record<string, unknown>>;
      readonly completeness: "complete" | "partial";
      readonly dataScope: "all" | "loaded" | "partial";
      readonly requestKey?: string;
      readonly aggregateDefinitionKey?: string;
    } & (
      | { readonly state: "ready" }
      | {
          readonly state: "stale";
          readonly label: string;
          readonly requestKey: string;
          readonly aggregateDefinitionKey: string;
        }
    ))
);
export interface ResolveSummariesInput {
  readonly summaries?: PretableSummaries;
  /** Canonical eligible column identities, including effective overrides. */
  readonly columns: readonly { readonly id: string }[];
  readonly snapshot?: {
    getSummary?(scope: PretableSummaryScope): PretableEngineSummary | undefined;
  };
  readonly processing?: PretableProcessingOptions;
  /** Caller knows this input is a window or otherwise partial. Counts never upgrade it. */
  readonly loadedOnly?: boolean;
}
export function resolveSummaryCompleteness(
  input: Pick<ResolveSummariesInput, "processing" | "loadedOnly">,
  descriptor: PretableSummaryDescriptor,
): "complete" | "partial" {
  return descriptor.authority === "engine" &&
    (descriptor.completeness === "partial" ||
      input.loadedOnly ||
      input.processing?.filter === "external" ||
      input.processing?.sort === "external")
    ? "partial"
    : "complete";
}
export function resolveSummaries(
  input: ResolveSummariesInput,
): Partial<Record<PretableSummaryScope, PretableResolvedSummary>> {
  const resolved: Partial<
    Record<PretableSummaryScope, PretableResolvedSummary>
  > = {};
  for (const scope of ["filtered", "all"] as const) {
    const descriptor = input.summaries?.[scope];
    if (!descriptor) continue;
    const answer =
      descriptor.authority === "server"
        ? descriptor.result
        : input.snapshot?.getSummary?.(scope);
    const completeness =
      descriptor.authority === "server" && answer && "completeness" in answer
        ? answer.completeness
        : resolveSummaryCompleteness(input, descriptor);
    const loaded =
      descriptor.authority === "engine" && completeness === "partial";
    const caption =
      descriptor.label ??
      (scope === "filtered"
        ? loaded
          ? "Matching loaded rows"
          : "Matching rows"
        : loaded
          ? "All loaded rows"
          : "All input rows");
    const base = { scope, authority: descriptor.authority, caption };
    if (!answer) {
      resolved[scope] = { ...base, state: "unavailable" };
      continue;
    }
    if (descriptor.authority === "server") {
      const result = descriptor.result;
      if (result.state === "loading" || result.state === "unavailable") {
        resolved[scope] = { ...base, state: result.state };
        continue;
      }
      if (result.state === "error") {
        resolved[scope] = { ...base, state: "error", message: result.message };
        continue;
      }
      if (
        result.aggregateDefinitionKey !== descriptor.aggregateDefinitionKey ||
        (result.state === "ready" &&
          result.requestKey !== descriptor.requestKey) ||
        (result.state === "stale" && !result.label.trim())
      ) {
        resolved[scope] = { ...base, state: "unavailable" };
        continue;
      }
      resolved[scope] = {
        ...base,
        ...result,
        values: knownValues(result.values, input.columns),
        dataScope: completeness === "partial" ? "partial" : "all",
      };
    } else {
      const engine = answer as PretableEngineSummary;
      resolved[scope] = {
        ...base,
        state: "ready",
        values: knownValues(engine.values, input.columns),
        completeness,
        dataScope: loaded ? "loaded" : "all",
      };
    }
  }
  return resolved;
}
function knownValues(
  values: Readonly<Record<string, unknown>>,
  columns: readonly { readonly id: string }[],
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    columns
      .filter((column) => Object.hasOwn(values, column.id))
      .map((column) => [column.id, values[column.id]]),
  );
}
