import { describe, expect, test } from "vitest";

import {
  createRowMetricsIndex,
  planColumns,
  scrollLeftToReveal,
  scrollTopToReveal,
} from "../index";
import type { PlanColumnsColumnInput } from "../types";

// 100 uniform 40px rows: total height 4000.
const uniformRows = () =>
  createRowMetricsIndex(Array.from({ length: 100 }, () => 40));

// Variable heights. Offsets: 0, 40, 160, 204, 504. Total 548.
const variableRows = () => createRowMetricsIndex([40, 120, 44, 300, 44]);

describe("scrollTopToReveal", () => {
  test("returns null when the target row sits fully inside the band", () => {
    const rowMetrics = uniformRows();

    // Row 4 spans [160, 200); band at scrollTop 0 is [0, 200).
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 4,
        scrollTop: 0,
        viewportHeight: 200,
      }),
    ).toBeNull();
  });

  test("scrolls up to the target's top edge when the target is above the band", () => {
    const rowMetrics = uniformRows();

    // Row 5 spans [200, 240); band is [400, 600).
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 5,
        scrollTop: 400,
        viewportHeight: 200,
      }),
    ).toBe(200);
  });

  test("scrolls down minimally so the target's bottom lands on the band's bottom", () => {
    const rowMetrics = uniformRows();

    // Row 5 spans [200, 240); band is [0, 200). 240 - 200 = 40.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 5,
        scrollTop: 0,
        viewportHeight: 200,
      }),
    ).toBe(40);
  });

  test("reveals the first row at scrollTop 0", () => {
    const rowMetrics = uniformRows();

    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 0,
        scrollTop: 1000,
        viewportHeight: 200,
      }),
    ).toBe(0);
  });

  test("reveals the last row at the maximum scroll offset", () => {
    const rowMetrics = uniformRows();

    // Row 99 spans [3960, 4000); 4000 - 200 = 3800 = totalHeight - viewportHeight.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 99,
        scrollTop: 0,
        viewportHeight: 200,
      }),
    ).toBe(3800);
  });

  test("a target whose bottom sits exactly on the band edge is already visible", () => {
    const rowMetrics = uniformRows();

    // Row 4 bottom === 200 === scrollTop + viewportHeight.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 4,
        scrollTop: 0,
        viewportHeight: 200,
      }),
    ).toBeNull();

    // Row 5 top === 200 === scrollTop.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 5,
        scrollTop: 200,
        viewportHeight: 200,
      }),
    ).toBeNull();
  });

  test("a row taller than the viewport aligns to its top edge, not its bottom", () => {
    const rowMetrics = variableRows();

    // Row 3 spans [204, 504) — 300px tall in a 200px band.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 3,
        scrollTop: 0,
        viewportHeight: 200,
      }),
    ).toBe(204);

    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 3,
        scrollTop: 300,
        viewportHeight: 200,
      }),
    ).toBe(204);
  });

  test("an oversized row already aligned to its top edge does not oscillate", () => {
    const rowMetrics = variableRows();

    // At scrollTop 204 the row's bottom (504) is still below the band, but
    // scrolling further would hide its first line — nothing left to do.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 3,
        scrollTop: 204,
        viewportHeight: 200,
      }),
    ).toBeNull();
  });

  test("honours variable row heights in both directions", () => {
    const rowMetrics = variableRows();

    // Row 2 spans [160, 204); band [0, 100) → 204 - 100 = 104.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 2,
        scrollTop: 0,
        viewportHeight: 100,
      }),
    ).toBe(104);

    // Band [100, 200): row 1's top (40) is above it.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 1,
        scrollTop: 100,
        viewportHeight: 100,
      }),
    ).toBe(40);

    // Row 2 spans [160, 204); band [104, 204) → already flush.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 2,
        scrollTop: 104,
        viewportHeight: 100,
      }),
    ).toBeNull();
  });

  test("a zero-height band is UNDECIDABLE, not resolved", () => {
    // `undefined`, emphatically not `null`: a caller that latches on "resolved"
    // must be able to tell "the target is revealed" from "I could not measure".
    // Latching here would leave the address permanently unrevealed once the
    // band does get a height.
    const rowMetrics = uniformRows();

    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 50,
        scrollTop: 0,
        viewportHeight: 0,
      }),
    ).toBeUndefined();
  });

  test("an empty grid never scrolls", () => {
    const rowMetrics = createRowMetricsIndex([]);

    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 0,
        scrollTop: 0,
        viewportHeight: 200,
      }),
    ).toBeNull();
  });

  test("an out-of-range target index never scrolls", () => {
    const rowMetrics = uniformRows();

    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: -1,
        scrollTop: 500,
        viewportHeight: 200,
      }),
    ).toBeNull();

    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 100,
        scrollTop: 0,
        viewportHeight: 200,
      }),
    ).toBeNull();
  });

  test("clamps to 0 rather than returning a negative offset", () => {
    const rowMetrics = uniformRows();

    // Rubber-band overscroll can report a negative scrollTop. Row 2 spans
    // [80, 120): 120 - 200 = -80 before clamping.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 2,
        scrollTop: -100,
        viewportHeight: 200,
      }),
    ).toBe(0);
  });

  test("clamps to the maximum scroll offset", () => {
    const rowMetrics = uniformRows();

    // Row 98's top is 3920, but the scroller cannot go past 4000 - 200 = 3800.
    expect(
      scrollTopToReveal({
        rowMetrics,
        targetIndex: 98,
        scrollTop: 3950,
        viewportHeight: 200,
      }),
    ).toBe(3800);
  });
});

// pinnedLeftWidth 40, scrollable run 500 (a..e at content lefts 40/140/240/340/440),
// pinnedRightWidth 60, totalWidth 600.
const columns: PlanColumnsColumnInput[] = [
  { id: "sel", width: 40, pinned: "left" },
  { id: "a", width: 100 },
  { id: "b", width: 100 },
  { id: "c", width: 100 },
  { id: "d", width: 100 },
  { id: "e", width: 100 },
  { id: "act", width: 60, pinned: "right" },
];

/**
 * The unbounded plan `scrollLeftToReveal` contracts for — every column present
 * at its true content offset, nothing virtualized away.
 *
 * `planColumnLayout` (`@pretable-internal/renderer-dom`) is the production
 * builder and the only one callers should use; layout-core cannot import it
 * because the dependency runs the other way, so the parameters are restated
 * here. What stops that restatement from silently drifting is that
 * `planColumnLayout` is covered by its own value assertions in
 * `renderer-dom.test.ts`, and that the last test below fails if this helper
 * ever starts producing a windowed plan.
 */
const fullPlan = (input: readonly PlanColumnsColumnInput[]) =>
  planColumns({
    columns: input,
    scrollLeft: 0,
    viewportWidth: Number.POSITIVE_INFINITY,
    overscan: 0,
  });

describe("scrollLeftToReveal", () => {
  test("returns null for a target already inside the unoccluded band", () => {
    // Band at scrollLeft 0 is [40, 240): column "a" spans [40, 140).
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "a",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBeNull();
  });

  test("scrolls right minimally so the target clears the right-pinned group", () => {
    // "c" spans [240, 340); band [40, 240) → 240 + 100 - 300 + 60 = 100.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "c",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBe(100);
  });

  test("scrolls left minimally so the target clears the left-pinned group", () => {
    // Band at scrollLeft 200 is [240, 440); "a" spans [40, 140) → 40 - 40 = 0.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "a",
        scrollLeft: 200,
        viewportWidth: 300,
      }),
    ).toBe(0);

    // "b" spans [140, 240) → 140 - 40 = 100.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "b",
        scrollLeft: 200,
        viewportWidth: 300,
      }),
    ).toBe(100);
  });

  test("a target flush against either band edge is already visible", () => {
    // "b" ends at 240 === scrollLeft + viewportWidth - pinnedRightWidth.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "b",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBeNull();

    // "c" starts at 240 === scrollLeft + pinnedLeftWidth.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "c",
        scrollLeft: 200,
        viewportWidth: 300,
      }),
    ).toBeNull();
  });

  test("a left-pinned target never scrolls — it is always on screen", () => {
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "sel",
        scrollLeft: 250,
        viewportWidth: 300,
      }),
    ).toBeNull();
  });

  test("a right-pinned target never scrolls — it is always on screen", () => {
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "act",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBeNull();
  });

  test("accounts for the left-pinned width when only a left group exists", () => {
    const leftOnly: PlanColumnsColumnInput[] = [
      { id: "sel", width: 200, pinned: "left" },
      { id: "a", width: 100 },
      { id: "b", width: 100 },
    ];

    // pinnedLeftWidth 200: "b" spans [300, 400); band at scrollLeft 0 is
    // [200, 300) → 300 + 100 - 300 + 0 = 100.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(leftOnly),
        targetColumnId: "b",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBe(100);
  });

  test("accounts for the right-pinned width when only a right group exists", () => {
    const rightOnly: PlanColumnsColumnInput[] = [
      { id: "a", width: 100 },
      { id: "b", width: 100 },
      { id: "c", width: 100 },
      { id: "act", width: 60, pinned: "right" },
    ];

    // "c" spans [200, 300); band at scrollLeft 0 is [0, 240) → 200 + 100 - 300 + 60 = 60.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(rightOnly),
        targetColumnId: "c",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBe(60);
  });

  test("clamps to the maximum scroll offset", () => {
    // "e" spans [440, 540); 440 + 100 - 300 + 60 = 300 = totalWidth - viewportWidth.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "e",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBe(300);
  });

  test("a column wider than the band aligns to the band's left edge", () => {
    const wide: PlanColumnsColumnInput[] = [
      { id: "sel", width: 40, pinned: "left" },
      { id: "wide", width: 300 },
      { id: "tail", width: 100 },
      { id: "act", width: 60, pinned: "right" },
    ];

    // Band is 300 - 40 - 60 = 200 wide; "wide" spans [40, 340).
    expect(
      scrollLeftToReveal({
        plan: fullPlan(wide),
        targetColumnId: "wide",
        scrollLeft: 100,
        viewportWidth: 300,
      }),
    ).toBe(0);

    // Already aligned at its left edge: nothing more can be revealed.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(wide),
        targetColumnId: "wide",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBeNull();
  });

  test("pinned groups at least as wide as the viewport are UNDECIDABLE", () => {
    // 40 + 60 = 100 > 90: the band is inverted, so no offset can reveal anything
    // — but only until the container is resized wider, so this is `undefined`
    // and the caller must retry rather than latch.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "c",
        scrollLeft: 0,
        viewportWidth: 90,
      }),
    ).toBeUndefined();

    // Exactly equal: the band is empty.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "c",
        scrollLeft: 0,
        viewportWidth: 100,
      }),
    ).toBeUndefined();

    // …and the very same call at a width that leaves a real band resolves.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "c",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).not.toBeUndefined();
  });

  test("an unknown column id is RESOLVED, not undecidable", () => {
    // Deliberately `null`: a column the plan does not have is a caller bug,
    // not a measurement gap. Reporting it retryable would put this function's
    // O(columns) scan on every later effect pass, forever.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(columns),
        targetColumnId: "nope",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBeNull();
  });

  test("a zero-width viewport is UNDECIDABLE, not resolved", () => {
    // The unmeasured scrollport: SSR, the first commit, or a grid inside a
    // `display: none` tab. A caller that latched here would never scroll to the
    // column once the tab is opened.
    expect(
      scrollLeftToReveal({
        plan: fullPlan([
          { id: "a", width: 100 },
          { id: "b", width: 100 },
        ]),
        targetColumnId: "b",
        scrollLeft: 0,
        viewportWidth: 0,
      }),
    ).toBeUndefined();
  });

  test("reveals a target far outside planColumns' virtualization window", () => {
    // 200 scrollable columns: the target is ~15000px past the viewport.
    const many: PlanColumnsColumnInput[] = [
      { id: "sel", width: 40, pinned: "left" },
      ...Array.from({ length: 200 }, (_unused, index) => ({
        id: `col${index}`,
        width: 100,
      })),
      { id: "act", width: 60, pinned: "right" },
    ];

    // The premise, asserted rather than assumed — and asserted here because the
    // plan is now the caller's to supply, which is the only way to get this
    // wrong. A plan built at the real 300px viewport genuinely does not contain
    // "col150", so feeding one in reveals nothing at all.
    const windowed = planColumns({
      columns: many,
      scrollLeft: 0,
      viewportWidth: 300,
      overscan: 0,
    });

    expect(windowed.columns.some((column) => column.id === "col150")).toBe(
      false,
    );
    expect(
      scrollLeftToReveal({
        plan: windowed,
        targetColumnId: "col150",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBeNull();

    // The unbounded plan — what `planColumnLayout` hands in — does contain it.
    // "col150" spans [15040, 15140) → 15040 + 100 - 300 + 60 = 14900.
    expect(
      scrollLeftToReveal({
        plan: fullPlan(many),
        targetColumnId: "col150",
        scrollLeft: 0,
        viewportWidth: 300,
      }),
    ).toBe(14900);
  });
});
