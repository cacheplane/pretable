import { cleanup, render, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import BenchPage from "../app/bench/page";

afterEach(cleanup);

/**
 * `row_height_error_p95_px` cannot detect anything on a grid whose cells cannot
 * wrap: a cell's content height is floored at its box, so where text never
 * breaks, no row height — however wrong — moves the number. Three of the four
 * adapters in the archived runset were not wrapping (#400), so the values the
 * page used to print for them were a box-model constant, and the page read an
 * inference about AG Grid's *wrapped-cell* layout out of one of them (#414).
 *
 * These pin the distinction the fix rests on. Reporting "no opinion" the same
 * way as "scored zero" is the whole defect, so both halves are asserted: the
 * three unmeasurable adapters say n/a, and the one adapter that WAS wrapping
 * still prints its number.
 */
/**
 * The H1 scroll table is the first on the page; the interaction table below it
 * repeats every adapter name, so a page-wide text query matches twice.
 */
function rowHeightCellFor(container: HTMLElement, label: string): HTMLElement {
  const scrollTable = container.querySelector("table");
  expect(scrollTable).not.toBeNull();
  const row = within(scrollTable as HTMLElement)
    .getByText(label)
    .closest("tr");
  expect(row).not.toBeNull();
  // Adapter · frame p95 · row height error · blank gaps · verdict
  return within(row as HTMLElement).getAllByRole("cell")[2];
}

it("prints n/a, not a score, for every adapter the metric could not have caught", () => {
  const { container } = render(<BenchPage />);

  for (const label of [
    "AG Grid Community",
    "TanStack Table",
    "MUI X DataGrid Community",
  ]) {
    expect(rowHeightCellFor(container, label).textContent?.trim()).toBe("n/a");
  }
});

it("still prints the number for the one adapter that was wrapping", () => {
  const { container } = render(<BenchPage />);

  // The load-bearing positive. Rendering n/a everywhere would satisfy the test
  // above while quietly deleting a real measurement — pretable wrapped in this
  // runset, so its rows could have been laid out wrong and were not.
  expect(rowHeightCellFor(container, "pretable").textContent?.trim()).toBe("1");
});

it("explains what n/a means rather than leaving it to be read as a dash", () => {
  const { container } = render(<BenchPage />);
  const text = container.textContent ?? "";

  expect(text).toContain("is not a zero");
  expect(text).toContain("only pretable was wrapping");
});

it("no longer infers anything about AG Grid's wrapped-cell layout", () => {
  const { container } = render(<BenchPage />);
  const text = container.textContent ?? "";

  // The withdrawn claim: AG Grid's 2px was read as evidence that "wrapped-cell
  // layout doesn't round-trip through its line-height pipeline as cleanly as
  // pretable's text-core does" — drawn about a grid that was not wrapping.
  expect(text).not.toContain("line-height pipeline");
  expect(text).not.toContain("drifts 2px on row height");
});
