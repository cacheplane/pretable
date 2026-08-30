import { describe, expect, test } from "vitest";

import {
  PANE_KEY_STEP_PX,
  clampPaneWidth,
  paneWidthAfterDrag,
  paneWidthAfterKey,
} from "../tool-panel/pane-resize";

const BOUNDS = { min: 200, max: 600 };
const FLOOR_ONLY = { min: 200, max: null };

describe("clampPaneWidth", () => {
  test.each([
    ["below min clamps up", 120, BOUNDS, 200],
    ["above max clamps down", 900, BOUNDS, 600],
    ["in bounds is identity", 300, BOUNDS, 300],
    ["min itself survives", 200, BOUNDS, 200],
    ["max itself survives", 600, BOUNDS, 600],
    // max: null = the surface has no measurement yet (jsdom, pre-mount).
    // Only the floor applies — never an invented ceiling.
    ["floor-only: large value passes", 5000, FLOOR_ONLY, 5000],
    ["floor-only: min still applies", 10, FLOOR_ONLY, 200],
  ] as const)("%s", (_name, px, bounds, expected) => {
    expect(clampPaneWidth(px, bounds)).toBe(expected);
  });

  test("fractional drag positions round to whole pixels", () => {
    expect(clampPaneWidth(300.6, BOUNDS)).toBe(301);
  });
});

describe("paneWidthAfterKey", () => {
  // A6: "grow the pane" is the arrow that drags the seam that way. The pane
  // docks at the layout row's inline END, so its resize seam moves toward
  // inline-start as the pane grows: in ltr that is ArrowLeft, in rtl
  // ArrowRight. These rtl rows are the mutation target — an inverted
  // direction resolution must fail them.
  test.each([
    ["ltr ArrowLeft grows", "ArrowLeft", 300, "ltr", 300 + PANE_KEY_STEP_PX],
    [
      "ltr ArrowRight shrinks",
      "ArrowRight",
      300,
      "ltr",
      300 - PANE_KEY_STEP_PX,
    ],
    ["rtl ArrowRight grows", "ArrowRight", 300, "rtl", 300 + PANE_KEY_STEP_PX],
    ["rtl ArrowLeft shrinks", "ArrowLeft", 300, "rtl", 300 - PANE_KEY_STEP_PX],
    ["grow clamps at max", "ArrowLeft", 590, "ltr", 600],
    ["shrink clamps at min", "ArrowRight", 210, "ltr", 200],
    ["rtl grow clamps at max", "ArrowRight", 590, "rtl", 600],
    ["Home goes to min", "Home", 300, "ltr", 200],
    ["End goes to max", "End", 300, "ltr", 600],
    ["Home in rtl still goes to min", "Home", 300, "rtl", 200],
  ] as const)("%s", (_name, key, current, dir, expected) => {
    expect(paneWidthAfterKey(key, current, { min: 200, max: 600, dir })).toBe(
      expected,
    );
  });

  test("End with an unmeasured max is a no-op (no invented ceiling)", () => {
    expect(
      paneWidthAfterKey("End", 300, { min: 200, max: null, dir: "ltr" }),
    ).toBe(300);
  });

  test("a grow step with an unmeasured max still steps", () => {
    expect(
      paneWidthAfterKey("ArrowLeft", 300, { min: 200, max: null, dir: "ltr" }),
    ).toBe(300 + PANE_KEY_STEP_PX);
  });

  test.each(["ArrowUp", "ArrowDown", "Enter", "a", "Escape"])(
    "non-resize key %s returns null",
    (key) => {
      expect(
        paneWidthAfterKey(key, 300, { min: 200, max: 600, dir: "ltr" }),
      ).toBeNull();
    },
  );
});

describe("paneWidthAfterDrag", () => {
  // Same seam geometry as the keys: in ltr the pointer moving LEFT
  // (currentX < startX) grows the pane; in rtl the pointer moving RIGHT
  // grows it. The rtl rows are the mutation target.
  test.each([
    ["ltr: pointer left grows", 300, 500, 440, "ltr", 360],
    ["ltr: pointer right shrinks", 300, 500, 560, "ltr", 240],
    ["rtl: pointer right grows", 300, 500, 560, "rtl", 360],
    ["rtl: pointer left shrinks", 300, 500, 440, "rtl", 240],
    ["no movement is identity", 300, 500, 500, "ltr", 300],
    ["ltr grow clamps at max", 300, 500, 100, "ltr", 600],
    ["ltr shrink clamps at min", 300, 500, 900, "ltr", 200],
    ["rtl shrink clamps at min", 300, 500, 100, "rtl", 200],
  ] as const)("%s", (_name, startWidth, startX, currentX, dir, expected) => {
    expect(paneWidthAfterDrag(startWidth, startX, currentX, dir, BOUNDS)).toBe(
      expected,
    );
  });

  test("floor-only bounds never cap a grow drag", () => {
    expect(paneWidthAfterDrag(300, 500, 0, "ltr", FLOOR_ONLY)).toBe(800);
  });
});
