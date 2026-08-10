/**
 * Presentation lifecycle of the loaded records. Consumer-owned and
 * consumer-asserted; the surface renders it and never infers it.
 *
 * **No default.** When the prop is absent the entire lifecycle presentation is
 * off — no body blocks, no phase announcements, no data-phase attribute — so
 * local consumers see zero change. Remote consumers must supply it from their
 * first render, starting at `{ phase: "loading" }`.
 *
 * @experimental
 * @public
 */
export type PretableDataState =
  /** The loaded records answer the desired query. */
  | { phase: "idle" }
  /** Nothing usable is loaded for the desired query. */
  | { phase: "loading" }
  /** The records answer a PREVIOUS query; the desired one is in flight. */
  | { phase: "stale" }
  /** Same query, a newer fulfillment in flight (polling). */
  | { phase: "refreshing" }
  /** A tail extension is in flight. */
  | { phase: "loading-more" }
  | { phase: "error"; message?: string };

/** Which body block the surface owes, or `null` when the rows are the answer. */
export type PretableBodyStateKind =
  "loading" | "empty" | "error" | "error-strip";

/**
 * §4.4's table, as a function. Called only when `dataState` was supplied.
 *
 * The two non-obvious rows are deliberate: `stale` with nothing loaded shows
 * loading, because an old-empty result with a NEW query in flight is not "no
 * results"; and `refreshing` with nothing loaded keeps the empty block, because
 * a 2 s poll over an empty result must not flicker empty → loading → empty.
 */
export function resolveBodyStateKind(
  phase: PretableDataState["phase"],
  loadedRowCount: number,
): PretableBodyStateKind | null {
  if (phase === "error") {
    // Never discard fulfilled records for a failure: rows stay visible and
    // interactive, and the failure gets a strip at the top of the viewport.
    return loadedRowCount === 0 ? "error" : "error-strip";
  }

  if (loadedRowCount > 0) {
    return null;
  }

  switch (phase) {
    case "loading":
    case "stale":
      return "loading";
    case "idle":
    case "refreshing":
      return "empty";
    case "loading-more":
      // A tail extension with nothing loaded is not a state the design defines.
      // Rendering nothing beats guessing at a block.
      return null;
  }
}
