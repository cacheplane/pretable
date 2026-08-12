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

/**
 * Which body block the surface owes, or `null` when the rows are the answer.
 *
 * @experimental
 * @public
 */
export type PretableBodyStateKind =
  "loading" | "empty" | "error" | "error-strip";

/**
 * The body-state table of
 * `docs/superpowers/specs/2026-08-09-server-controlled-exploration-design.md`
 * §4.4, as a function. Called only when `dataState` was supplied.
 *
 * `bodyRowCount` is what the body currently RENDERS, not
 * `snapshot.loadedRowCount`: under engine filter authority a grid can hold
 * loaded records and still show nothing, and "no results" is exactly the
 * answer that case needs. Under external filter authority — the remote shape
 * this table was written for — the two counts are the same number.
 *
 * The two non-obvious rows are deliberate: `stale` with nothing shown gets
 * loading, because an old-empty result with a NEW query in flight is not "no
 * results"; and `refreshing` with nothing shown keeps the empty block, because
 * a 2 s poll over an empty result must not flicker empty → loading → empty.
 */
export function resolveBodyStateKind(
  phase: PretableDataState["phase"],
  bodyRowCount: number,
): PretableBodyStateKind | null {
  if (phase === "error") {
    // Never discard fulfilled records for a failure: rows stay visible and
    // interactive, and the failure gets a strip at the top of the viewport.
    return bodyRowCount === 0 ? "error" : "error-strip";
  }

  if (bodyRowCount > 0) {
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
