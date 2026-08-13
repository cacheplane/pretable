import type {
  PretableMatchingTotal,
  PretableProcessingOptions,
} from "@pretable/core";

import { warnOnce } from "./dev-warn";

/**
 * The snapshot fields these rules read. Structural so tests can pass literals.
 *
 * @public
 */
export interface DataHonestyInput {
  visibleRowCount: number;
  isGrouped: boolean;
  loadedRowCount: number;
  matchingTotal: PretableMatchingTotal;
  /**
   * Dataset index of the first loaded row, when the loaded rows are a window
   * rather than a prefix. Absent (or `0`) is the classic prefix case, where
   * the impossible condition is simply "more rows loaded than exist".
   */
  windowStart?: number;
}

/**
 * `aria-rowcount` per the design's honesty rules (§4.5).
 *
 * ARIA 1.2 defines the attribute as the total row count of the FULL table
 * including rows not in the DOM, with `-1` for unknown. A remote grid may only
 * publish the population count when every condition that makes loaded model
 * index `i` equal dataset position `i` holds. Any doubt downgrades to the
 * loaded-model count, which is the one number the grid can prove.
 */
export function resolveAriaRowCount(
  input: DataHonestyInput,
  processing: PretableProcessingOptions | undefined,
): number {
  const loadedModelCount = input.visibleRowCount + 1;

  // Anything short of full external authority means the engine reordered or
  // re-selected the loaded window locally, and global positions no longer hold.
  if (processing?.filter !== "external" || processing.sort !== "external") {
    return loadedModelCount;
  }

  // Grouping synthesizes header rows and hides the children of collapsed
  // branches: the contiguous mapping is gone.
  if (input.isGrouped) {
    return loadedModelCount;
  }

  const total = input.matchingTotal;

  // An estimate cannot be spoken through an attribute whose contract is an
  // exact integer. `-1` is the spec's "unknown"; the number belongs in prose.
  if (total.kind !== "exact") {
    return -1;
  }

  // Detected violations of the contiguous-window contract: a count the
  // attribute cannot express (`aria-rowcount` is an integer, and core copies
  // the supplied `count` verbatim), or a window that runs past the end of the
  // population the total claims. Downgrade rather than lie — and say so,
  // because a silent downgrade leaves a consumer whose window really doesn't
  // fit with nothing to notice: the attribute it reads is a plausible number
  // either way.
  if (!Number.isInteger(total.count)) {
    warnOnce(
      "result-meta-total-not-an-integer",
      "[pretable] resultMeta.total.count is not an integer, so it cannot be " +
        "published as aria-rowcount. Reporting the loaded-model count instead.",
    );
    return loadedModelCount;
  }
  const windowStart = input.windowStart ?? 0;
  if (total.count < windowStart + input.loadedRowCount) {
    warnOnce(
      "result-meta-total-below-loaded",
      "[pretable] resultMeta.total claims fewer matching records than the " +
        "loaded window's end (start + loaded count), so the loaded records " +
        "cannot be a contiguous window of the result set at the claimed " +
        "offset (see PretableResultMeta). Reporting the loaded-model count " +
        "instead.",
    );
    return loadedModelCount;
  }

  return total.count + 1;
}

/**
 * Whether the loaded records are the whole matching population (`"all"`) or a
 * window onto it (`"loaded"`). Every user-facing count label routes through
 * this, so a 200-of-10,432 window can never be described as "all rows". Local
 * mode is always `"all"`.
 *
 * A total that undercounts the loaded records reads as `"all"` here while
 * `resolveAriaRowCount` downgrades for it. Calling a set that already holds
 * every record the server claims exist "all" overstates nothing; publishing
 * that same count as the population would.
 */
/**
 * The honest answer to "does this grid hold everything?" — `"all"` only when it
 * can prove it, `"loaded"` otherwise.
 *
 * Public because `serializeCsv` REQUIRES a scope and this is the only correct
 * way to compute one. Leaving it internal made the required argument
 * unanswerable, so a consumer would hardcode `"all"` and re-introduce exactly
 * the optimistic default the requirement exists to prevent.
 *
 * @public
 */
export function resolveDataScope(
  input: Pick<DataHonestyInput, "loadedRowCount" | "matchingTotal">,
  processing: PretableProcessingOptions | undefined,
): "all" | "loaded" {
  if (processing?.filter !== "external") {
    return "all";
  }
  const total = input.matchingTotal;
  if (total.kind === "exact" && total.count <= input.loadedRowCount) {
    return "all";
  }
  return "loaded";
}

/**
 * Engine sort over a partial window is expressible — a complete-window consumer
 * legitimately uses it — but dishonest when the window really is partial: it
 * presents "top N of a server-selected sample" under a truthful-looking
 * `aria-sort`.
 */
export function warnOnEngineSortOverPartialWindow(
  input: DataHonestyInput,
  processing: PretableProcessingOptions | undefined,
): void {
  if (processing?.filter !== "external" || processing.sort === "external") {
    return;
  }
  const total = input.matchingTotal;
  if (total.kind !== "exact" || total.count <= input.loadedRowCount) {
    return;
  }
  warnOnce(
    "engine-sort-over-partial-window",
    '[pretable] sort authority is "engine" while only part of the matching ' +
      "population is loaded. Sorting a server-selected window locally presents " +
      "the wrong SAMPLE, not just the wrong order. Set " +
      'processing: { sort: "external" } or load the whole result.',
  );
}
