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

  test("leaves everything alone when the viewport is not measured", () => {
    const widths = distributeFlexWidths({
      columns: [{ id: "a", width: 100, flex: 1 }],
      viewportWidth: Number.POSITIVE_INFINITY,
    });

    expect(widths).toEqual({});
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
});
