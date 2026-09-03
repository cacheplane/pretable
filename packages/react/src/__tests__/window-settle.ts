import { waitFor } from "@testing-library/react";
import { expect } from "vitest";

/**
 * Settling a windowed grid's slide in tests.
 *
 * A window slide is not visible on the render that requests it: `setRows`
 * lands synchronously in a layout effect, but the DOM rows come from the
 * renderer-dom row layout controller, which draws a replacement across
 * scheduler hops (`MessageChannel` macrotasks). Under CPU starvation those
 * hops outlast any fixed sleep — a 20ms `setTimeout` settle failed loaded
 * full-suite runs with the DOM one window BEHIND the props, the evicted row
 * still rendered and already announced at the new window's `aria-rowindex`
 * (#548). So a test polls for what the controller DREW.
 *
 * Once the rows match, the commit that drew them has also run
 * `observeRowModelRevision` (a layout effect of the same commit), so the
 * selection is reconciled against that window and a paint read afterwards is
 * the settled one, not a transient.
 */

/** Row ids of `dataset[start, start + length)` — the window a render asks for. */
export function windowIds<TRow extends { readonly id: string }>(
  dataset: readonly TRow[],
  start: number,
  length: number,
): string[] {
  return dataset.slice(start, start + length).map((row) => row.id);
}

/** Every rendered row id, in DOM order. */
export function renderedRowIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll("[data-pretable-row-id]")).map(
    (node) => node.getAttribute("data-pretable-row-id") ?? "",
  );
}

/** Polls until the controller has drawn exactly `rowIds`, in DOM order. */
export async function settledRows(
  container: HTMLElement,
  rowIds: readonly string[],
): Promise<void> {
  await waitFor(() => expect(renderedRowIds(container)).toEqual(rowIds), {
    timeout: 15_000,
  });
}

/**
 * Polls until the controller has drawn exactly `rowIds` AND placed the first
 * of them below `spacerRows` rows of leading spacer.
 *
 * The spacer is the second half of a settle: the ids say WHICH rows the plan
 * drew, the spacer says under WHICH window it drew them. The controller reads
 * `windowSpacers` once per plan, so a gate that opens or shuts — or a window
 * that is retained or dropped — is visible here even when the row set is
 * unchanged. A shut gate (`windowSpacers` null: non-exact total, non-external
 * sort, no `resultMeta.window`) draws zero spacer rows; an open one draws
 * `windowStart` rows. `rows[].top` is global, so the first row's `top` IS that
 * spacer, in whatever row height the theme resolved to.
 */
export async function settledWindow(
  container: HTMLElement,
  rowIds: readonly string[],
  spacerRows: number,
): Promise<void> {
  await waitFor(
    () => {
      const rows = Array.from(
        container.querySelectorAll<HTMLElement>("[data-pretable-row-id]"),
      );
      expect(
        rows.map((node) => node.getAttribute("data-pretable-row-id") ?? ""),
      ).toEqual(rowIds);
      const first = rows[0];
      if (first === undefined) throw new Error("no rows drawn");
      const rowHeight = Number(first.getAttribute("data-pretable-row-height"));
      expect(first.style.top).toBe(`${spacerRows * rowHeight}px`);
    },
    { timeout: 15_000 },
  );
}
