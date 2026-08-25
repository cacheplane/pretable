import { describe, expect, it } from "vitest";

import {
  dropTargetForPointer,
  type ToolDropGroup,
  type ToolRowRect,
} from "../tool-panel/tool-panel-drop-target";

/**
 * Geometry fixtures. Rows are 28px tall, stacked with a 12px group gap where
 * a subgroup label sits — deliberately non-zero, because the boundary rule
 * splits that gap and a zero gap could not disprove a wrong split.
 *
 * Layout (tops):
 *   group 0 (pinned left):   a  [0..28)
 *   group 1 (unpinned):      b  [40..68)   c [68..96)   d [96..124)
 *   group 2 (pinned right):  e  [136..164)
 */
const GROUPS: readonly ToolDropGroup[] = [
  { pinned: "left" },
  { pinned: null },
  { pinned: "right" },
];

function row(
  id: string,
  top: number,
  groupIndex: number,
  height = 28,
): ToolRowRect {
  return { id, top, height, groupIndex };
}

const ROWS: readonly ToolRowRect[] = [
  row("a", 0, 0),
  row("b", 40, 1),
  row("c", 68, 1),
  row("d", 96, 1),
  row("e", 136, 2),
];

describe("dropTargetForPointer", () => {
  it("returns null for an empty row list", () => {
    expect(dropTargetForPointer(50, [], GROUPS)).toBeNull();
  });

  it("targets before a row while the pointer is above its midpoint", () => {
    // c spans [68..96), midpoint 82. Just under it: before c.
    expect(dropTargetForPointer(81, ROWS, GROUPS)).toEqual({
      beforeRow: 2,
      groupIndex: 1,
      indicatorY: 68,
    });
  });

  it("targets after a row once the pointer passes its midpoint", () => {
    // Past c's midpoint but before d's (110): before d.
    expect(dropTargetForPointer(83, ROWS, GROUPS)).toEqual({
      beforeRow: 3,
      groupIndex: 1,
      indicatorY: 96,
    });
  });

  it("targets the very first position when the pointer is above every midpoint", () => {
    expect(dropTargetForPointer(-10, ROWS, GROUPS)).toEqual({
      beforeRow: 0,
      groupIndex: 0,
      indicatorY: 0,
    });
  });

  it("targets after the last row when the pointer passes every midpoint", () => {
    // e's midpoint is 150; below it appends to the last group.
    expect(dropTargetForPointer(400, ROWS, GROUPS)).toEqual({
      beforeRow: 5,
      groupIndex: 2,
      indicatorY: 164,
    });
  });

  it("splits a group gap: the upper half appends to the group above", () => {
    // Gap between a (bottom 28) and b (top 40); split at 34. Above the
    // split but past a's midpoint (14): end of group 0 — same insertion
    // slot as "before b", but the PIN of group 0.
    expect(dropTargetForPointer(33, ROWS, GROUPS)).toEqual({
      beforeRow: 1,
      groupIndex: 0,
      indicatorY: 28,
    });
  });

  it("splits a group gap: the lower half prepends to the group below", () => {
    expect(dropTargetForPointer(35, ROWS, GROUPS)).toEqual({
      beforeRow: 1,
      groupIndex: 1,
      indicatorY: 40,
    });
  });

  it("crosses into a trailing pinned group below the last unpinned row", () => {
    // Gap between d (bottom 124) and e (top 136); split at 130.
    expect(dropTargetForPointer(131, ROWS, GROUPS)).toEqual({
      beforeRow: 4,
      groupIndex: 2,
      indicatorY: 136,
    });
    expect(dropTargetForPointer(129, ROWS, GROUPS)).toEqual({
      beforeRow: 4,
      groupIndex: 1,
      indicatorY: 124,
    });
  });

  it("treats hidden rows as ordinary slots — ids play no part in the math", () => {
    // The same geometry with different ids must produce the same target:
    // hidden columns are rendered rows here, so they hold boundaries too.
    const withHidden = ROWS.map((r, i) =>
      i === 2 ? { ...r, id: "hidden-col" } : r,
    );
    expect(dropTargetForPointer(81, withHidden, GROUPS)).toEqual({
      beforeRow: 2,
      groupIndex: 1,
      indicatorY: 68,
    });
  });

  it("handles a single-group list (no pinned subgroups rendered)", () => {
    const rows = [row("x", 0, 0), row("y", 28, 0)];
    const groups: ToolDropGroup[] = [{ pinned: null }];
    expect(dropTargetForPointer(27, rows, groups)).toEqual({
      beforeRow: 1,
      groupIndex: 0,
      indicatorY: 28,
    });
    expect(dropTargetForPointer(100, rows, groups)).toEqual({
      beforeRow: 2,
      groupIndex: 0,
      indicatorY: 56,
    });
  });

  it("lands exactly on a midpoint: the boundary belongs to the position after", () => {
    // c's midpoint is 82; the >= side goes after c (before d).
    expect(dropTargetForPointer(82, ROWS, GROUPS)).toEqual({
      beforeRow: 3,
      groupIndex: 1,
      indicatorY: 96,
    });
  });
});
