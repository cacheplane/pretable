import { describe, expect, test } from "vitest";

import { distributeFlexWidths } from "../flex-widths";

/**
 * A grid whose columns are all fixed either underfills its container (dead
 * space on the right) or overflows it. `flex` hands a column a share of
 * whatever the fixed columns leave over, so the row ends exactly at the
 * viewport edge.
 */

describe("distributeFlexWidths", () => {
  test("gives a single flex column all the leftover width", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "a", width: 100 },
        { id: "b", width: 100, flex: 1 },
      ],
      viewportWidth: 500,
    });

    expect(widths).toEqual({ b: 400 });
  });

  test("splits the leftover in proportion to each weight", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "fixed", width: 200 },
        { id: "one", width: 50, flex: 1 },
        { id: "three", width: 50, flex: 3 },
      ],
      viewportWidth: 1000,
    });

    // 800 left over, split 1:3.
    expect(widths).toEqual({ one: 200, three: 600 });
  });

  test("consumes the viewport exactly, with no rounding gap", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "a", width: 0, flex: 1 },
        { id: "b", width: 0, flex: 1 },
        { id: "c", width: 0, flex: 1 },
      ],
      viewportWidth: 1000,
    });

    expect(Object.values(widths).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  test("respects a minimum, even when that overflows the viewport", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "fixed", width: 900 },
        { id: "flex", width: 50, flex: 1, minWidthPx: 120 },
      ],
      viewportWidth: 1000,
    });

    expect(widths).toEqual({ flex: 120 });
  });

  test("respects a maximum and does not hand back the remainder", () => {
    const widths = distributeFlexWidths({
      columns: [{ id: "flex", width: 50, flex: 1, maxWidthPx: 300 }],
      viewportWidth: 1000,
    });

    expect(widths).toEqual({ flex: 300 });
  });

  test("leaves everything alone when no column flexes", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "a", width: 100 },
        { id: "b", width: 200 },
      ],
      viewportWidth: 1000,
    });

    expect(widths).toEqual({});
  });

  test("keeps the declared width when the viewport is not measured", () => {
    const widths = distributeFlexWidths({
      columns: [{ id: "a", width: 100, flex: 1 }],
      viewportWidth: Number.POSITIVE_INFINITY,
    });

    expect(widths).toEqual({ a: 100 });
  });

  test("honours minWidthPx before the viewport is measured", () => {
    // The SSR paint: no measurement yet, but the floor must already hold so
    // the column does not jump on hydration.
    const widths = distributeFlexWidths({
      columns: [
        { id: "a", width: 500 },
        { id: "b", width: 220, flex: 1, minWidthPx: 320 },
      ],
      viewportWidth: Number.POSITIVE_INFINITY,
    });

    expect(widths).toEqual({ b: 320 });
  });

  test("falls back to the declared width when the fixed columns already overflow", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "fixed", width: 1200 },
        { id: "flex", width: 80, flex: 1 },
      ],
      viewportWidth: 1000,
    });

    // Nothing left to share — keep the column's own width rather than collapsing it.
    expect(widths).toEqual({ flex: 80 });
  });

  test("honours minWidthPx when the fixed columns already overflow", () => {
    // The hero grid at phone widths: a fixed 500px column has already blown
    // past a 400px viewport, and the flex column still owes its own floor.
    const widths = distributeFlexWidths({
      columns: [
        { id: "a", width: 500 },
        { id: "b", width: 220, flex: 1, minWidthPx: 320 },
      ],
      viewportWidth: 400,
    });

    expect(widths).toEqual({ b: 320 });
  });

  test("honours maxWidthPx when the fixed columns already overflow", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "a", width: 500 },
        { id: "b", width: 220, flex: 1, maxWidthPx: 200 },
      ],
      viewportWidth: 400,
    });

    expect(widths).toEqual({ b: 200 });
  });

  test("a floor on an earlier flex column is absorbed by the ones after it", () => {
    const widths = distributeFlexWidths({
      columns: [
        { id: "a", width: 100 },
        { id: "b", width: 0, flex: 1, minWidthPx: 150 },
        { id: "c", width: 0, flex: 1 },
      ],
      viewportWidth: 300,
    });

    // 200 left over, 100 each by weight; b's floor takes 150 and c gets the
    // rest so the row still ends on the edge. Only a floor on the LAST flex
    // column overruns the row.
    expect(widths).toEqual({ b: 150, c: 50 });
  });
});
