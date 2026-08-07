import { describe, expect, test, vi } from "vitest";

import { createGridCore } from "@pretable-internal/grid-core";
import { planColumns } from "@pretable-internal/layout-core";
import * as textCore from "@pretable-internal/text-core";

import { createDomRenderSnapshot, planColumnLayout } from "../index";

describe("renderer-dom", () => {
  test("estimates wrapped row heights and returns a render snapshot", () => {
    const grid = createGridCore({
      columns: [
        { id: "message", header: "Message", wrap: true, widthPx: 220 },
        { id: "status", header: "Status", widthPx: 140 },
      ],
      rows: [
        { id: "row-0", message: "Short row", status: "ready" },
        {
          id: "row-1",
          message:
            "A much longer multilingual row that should wrap across several lines in the benchmark renderer surface.",
          status: "running",
        },
      ],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 1,
    });

    expect(render.rows).toHaveLength(2);
    expect(render.rows[1]?.height).toBeGreaterThan(render.rows[0]?.height ?? 0);
    expect(render.totalWidth).toBe(360);
    expect(render.nodeCount).toBe(4);
  });

  test("uses layout-core planning to virtualize by viewport and overscan", () => {
    const grid = createGridCore({
      columns: [{ id: "message", header: "Message", widthPx: 140 }],
      rows: Array.from({ length: 10 }, (_, index) => ({
        id: `row-${index}`,
        message: `Row ${index}`,
      })),
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 44 * 4,
      viewportHeight: 44 * 2,
      overscan: 1,
    });

    expect(render.rows.map((row) => row.rowIndex)).toEqual([3, 4, 5, 6, 7]);
    expect(render.rows.map((row) => row.top)).toEqual([
      132, 176, 220, 264, 308,
    ]);
  });

  test("keeps the primary wrapped benchmark row-height estimate within the calibrated S2 envelope", () => {
    const grid = createGridCore({
      columns: [
        { id: "col_0", header: "Message 1", wrap: true, widthPx: 220 },
        { id: "col_1", header: "Owner 1", wrap: true, widthPx: 220 },
        { id: "col_2", header: "Status 1", wrap: true, widthPx: 220 },
        { id: "col_3", header: "Score 1", widthPx: 96 },
      ],
      rows: [
        {
          id: "S2-row-0",
          col_0:
            "Hola desde Pretable token-202 Hola desde Pretable token-203 Hola desde Pretable token-204",
          col_1:
            "Bonjour depuis Pretable token-231 Bonjour depuis Pretable token-232 Bonjour depuis Pretable token-233 Bonjour depuis Pretable token-234",
          col_2: "Pretable says hello in English token-260",
          col_3: "24.1",
        },
      ],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 0,
    });

    // Calibrated: 6 wrapped lines × 24px (matches browser's actual line-height
    // for Inter at 16px) + 42px chrome = 186. Previously 174 (= 6 × 22 + 42),
    // which underestimated by 12px and surfaced as row_height_error_p95_px=5
    // in the H1 hypothesis after the column-virtualization refactor switched
    // row sizing from CSS grid auto to planner-driven.
    expect(render.rows[0]?.height).toBe(186);
  });

  test("virtualizes columns when scrollLeft and viewportWidth are provided", () => {
    const manyColumns = Array.from({ length: 50 }, (_, i) => ({
      id: `col_${i}`,
      header: `Column ${i}`,
      widthPx: 140,
    }));
    const grid = createGridCore({
      columns: manyColumns,
      rows: [
        {
          id: "row-0",
          ...Object.fromEntries(manyColumns.map((c) => [c.id, `val-${c.id}`])),
        },
        {
          id: "row-1",
          ...Object.fromEntries(manyColumns.map((c) => [c.id, `val-${c.id}`])),
        },
      ],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      scrollLeft: 0,
      viewportHeight: 320,
      viewportWidth: 400,
      overscan: 1,
    });

    expect(render.columns.length).toBeLessThan(50);
    expect(render.columns.length).toBeGreaterThanOrEqual(3);
    expect(render.totalWidth).toBe(50 * 140);
    expect(render.nodeCount).toBe(render.rows.length * render.columns.length);
  });

  test("includes pinned columns in the column plan regardless of scrollLeft", () => {
    const columnsWithPinned = [
      {
        id: "pinned_0",
        header: "Pinned 0",
        widthPx: 100,
        pinned: "left" as const,
      },
      {
        id: "pinned_1",
        header: "Pinned 1",
        widthPx: 120,
        pinned: "left" as const,
      },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `col_${i}`,
        header: `Column ${i}`,
        widthPx: 140,
      })),
    ];
    const grid = createGridCore({
      columns: columnsWithPinned,
      rows: [
        {
          id: "row-0",
          ...Object.fromEntries(columnsWithPinned.map((c) => [c.id, "v"])),
        },
      ],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      scrollLeft: 2000,
      viewportHeight: 320,
      viewportWidth: 400,
      overscan: 1,
    });

    const pinnedIds = render.columns
      .filter((c) => c.pinned === "left")
      .map((c) => c.id);

    expect(pinnedIds).toEqual(["pinned_0", "pinned_1"]);
  });

  test("carries right-pinned columns through the column plan", () => {
    const columnsWithPinned = [
      { id: "first", header: "First", widthPx: 100, pinned: "left" as const },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `col_${i}`,
        header: `Column ${i}`,
        widthPx: 140,
      })),
      {
        id: "status",
        header: "Status",
        widthPx: 120,
        pinned: "right" as const,
      },
      {
        id: "actions",
        header: "Actions",
        widthPx: 80,
        pinned: "right" as const,
      },
    ];
    const grid = createGridCore({
      columns: columnsWithPinned,
      rows: [
        {
          id: "row-0",
          ...Object.fromEntries(columnsWithPinned.map((c) => [c.id, "v"])),
        },
      ],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      scrollLeft: 1500,
      viewportHeight: 320,
      viewportWidth: 400,
      overscan: 1,
    });

    const rightPinned = render.columns.filter((c) => c.pinned === "right");

    expect(rightPinned.map((c) => c.id)).toEqual(["status", "actions"]);
    // Offsets from the viewport's right edge: last one flush, the previous
    // one pushed in by the width of the one after it.
    expect(rightPinned.map((c) => c.right)).toEqual([80, 0]);
    // Right-pinned columns render last, after the scrollable window.
    expect(render.columns[render.columns.length - 1]?.id).toBe("actions");
    expect(render.columns[0]?.id).toBe("first");
  });

  test("carries right-pinned columns through the no-viewportWidth fallback", () => {
    const grid = createGridCore({
      columns: [
        { id: "a", header: "A", widthPx: 140 },
        { id: "b", header: "B", widthPx: 120, pinned: "right" as const },
        { id: "c", header: "C", widthPx: 80, pinned: "right" as const },
      ],
      rows: [{ id: "row-0", a: "1", b: "2", c: "3" }],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 1,
    });

    expect(render.columns.map((c) => c.pinned)).toEqual([
      undefined,
      "right",
      "right",
    ]);
    expect(render.columns.map((c) => c.right)).toEqual([undefined, 80, 0]);
    expect(render.totalWidth).toBe(340);
  });

  test("agrees on right-pinned `left` between the planned and fallback paths", () => {
    // The planned path buckets columns (left | scrollable | right) and the
    // fallback just accumulates in declaration order, so for columns already
    // declared in bucket order the two must produce identical content
    // offsets — including for the right-pinned pair, whose `left` is a real
    // content coordinate rather than a placeholder.
    const columns = [
      { id: "a", header: "A", widthPx: 100, pinned: "left" as const },
      { id: "b", header: "B", widthPx: 140 },
      { id: "c", header: "C", widthPx: 120 },
      { id: "d", header: "D", widthPx: 120, pinned: "right" as const },
      { id: "e", header: "E", widthPx: 80, pinned: "right" as const },
    ];
    const grid = createGridCore({
      columns,
      rows: [{ id: "row-0", a: "1", b: "2", c: "3", d: "4", e: "5" }],
      getRowId: (row) => String(row.id),
    });
    const base = {
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 2,
    };

    // Viewport wide enough that nothing is virtualized away.
    const planned = createDomRenderSnapshot({
      ...base,
      scrollLeft: 0,
      viewportWidth: 1000,
    });
    const fallback = createDomRenderSnapshot(base);

    const leftsOf = (snapshot: { columns: { id: string; left: number }[] }) =>
      new Map(snapshot.columns.map((c) => [c.id, c.left]));

    expect(leftsOf(planned)).toEqual(leftsOf(fallback));
    // And those offsets are the real end-to-end content layout.
    expect(Object.fromEntries(leftsOf(planned))).toEqual({
      a: 0,
      b: 100,
      c: 240,
      d: 360,
      e: 480,
    });
    expect(planned.totalWidth).toBe(fallback.totalWidth);
  });

  test("agrees with the planned path on a prop-declared left pin that is NOT the leading column", () => {
    // A left pin declared on a non-leading column is the one shape the engine
    // never produces (setColumnPinned/state.columnPinned relocate the column
    // into the leading region), so it is only reachable straight off the
    // `columns` prop. The planned path buckets it into the left-pinned group —
    // `left` is its offset WITHIN that group, and it renders first. The
    // no-viewportWidth path has to agree, because it is what SSR and the
    // pre-measurement first commit render.
    const columns = [
      { id: "a", header: "A", widthPx: 150 },
      { id: "b", header: "B", widthPx: 100, pinned: "left" as const },
      { id: "c", header: "C", widthPx: 120 },
      { id: "d", header: "D", widthPx: 60, pinned: "left" as const },
    ];
    const grid = createGridCore({
      columns,
      rows: [{ id: "row-0", a: "1", b: "2", c: "3", d: "4" }],
      getRowId: (row) => String(row.id),
    });
    const base = {
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 2,
    };

    // Viewport wide enough that nothing is virtualized away.
    const planned = createDomRenderSnapshot({
      ...base,
      scrollLeft: 0,
      viewportWidth: 1000,
    });
    const fallback = createDomRenderSnapshot(base);

    // Same order: left-pinned group first, then the scrollable run.
    expect(fallback.columns.map((c) => c.id)).toEqual(
      planned.columns.map((c) => c.id),
    );
    expect(planned.columns.map((c) => c.id)).toEqual(["b", "d", "a", "c"]);

    const leftsOf = (snapshot: { columns: { id: string; left: number }[] }) =>
      new Map(snapshot.columns.map((c) => [c.id, c.left]));

    expect(leftsOf(fallback)).toEqual(leftsOf(planned));
    // `left` on a left-pinned column is its offset within the left-pinned
    // group, so the first one is flush at 0 — NOT its declaration offset.
    expect(Object.fromEntries(leftsOf(planned))).toEqual({
      b: 0,
      d: 100,
      a: 160,
      c: 310,
    });
    expect(fallback.totalWidth).toBe(planned.totalWidth);
  });

  test("returns all columns when viewportWidth is not provided (backwards compatible)", () => {
    const grid = createGridCore({
      columns: [
        { id: "a", header: "A", widthPx: 140 },
        { id: "b", header: "B", widthPx: 140 },
      ],
      rows: [{ id: "row-0", a: "1", b: "2" }],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 1,
    });

    expect(render.columns).toHaveLength(2);
    expect(render.columns[0]).toMatchObject({ id: "a", left: 0, width: 140 });
    expect(render.columns[1]).toMatchObject({ id: "b", left: 140, width: 140 });
  });

  test("reuses wrapped row-height estimates across pure viewport scroll updates", () => {
    const prepareTextSpy = vi.spyOn(textCore, "prepareText");
    const grid = createGridCore({
      columns: [{ id: "message", header: "Message", wrap: true, widthPx: 220 }],
      rows: Array.from({ length: 20 }, (_, index) => ({
        id: `row-${index}`,
        message: `Wrapped benchmark row ${index} with enough repeated multilingual text to trigger estimate work.`,
      })),
      getRowId: (row) => String(row.id),
    });

    createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 1,
    });
    const initialCallCount = prepareTextSpy.mock.calls.length;

    grid.setViewport({
      scrollTop: 44 * 4,
      scrollLeft: 0,
      height: 320,
      width: 0,
    });
    createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 44 * 4,
      viewportHeight: 320,
      overscan: 1,
    });

    expect(prepareTextSpy.mock.calls.length).toBe(initialCallCount);
  });

  test("exposes pinned group widths matching planColumns for the same inputs", () => {
    const columnsWithPinned = [
      { id: "sel", header: "Sel", widthPx: 48, pinned: "left" as const },
      { id: "name", header: "Name", widthPx: 180, pinned: "left" as const },
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `col_${i}`,
        header: `Column ${i}`,
        widthPx: 140,
      })),
      {
        id: "status",
        header: "Status",
        widthPx: 120,
        pinned: "right" as const,
      },
      {
        id: "actions",
        header: "Actions",
        widthPx: 90,
        pinned: "right" as const,
      },
    ];
    const grid = createGridCore({
      columns: columnsWithPinned,
      rows: [
        {
          id: "row-0",
          ...Object.fromEntries(columnsWithPinned.map((c) => [c.id, "v"])),
        },
      ],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      scrollLeft: 900,
      viewportHeight: 320,
      viewportWidth: 500,
      overscan: 1,
    });

    // Same inputs the renderer feeds planColumns internally.
    const plan = planColumns({
      columns: grid.options.columns.map((column) => ({
        id: column.id,
        width: column.widthPx!,
        pinned: column.pinned,
      })),
      scrollLeft: 900,
      viewportWidth: 500,
      overscan: 1,
    });

    expect(render.pinnedLeftWidth).toBe(plan.pinnedLeftWidth);
    expect(render.pinnedRightWidth).toBe(plan.pinnedRightWidth);
    // Guard against both sides being trivially 0 and the assertion passing.
    expect(render.pinnedLeftWidth).toBe(48 + 180);
    expect(render.pinnedRightWidth).toBe(120 + 90);
  });

  test("reports zero pinned widths when no column is pinned", () => {
    const grid = createGridCore({
      columns: [
        { id: "a", header: "A", widthPx: 140 },
        { id: "b", header: "B", widthPx: 140 },
      ],
      rows: [{ id: "row-0", a: "1", b: "2" }],
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 320,
      overscan: 1,
    });

    expect(render.pinnedLeftWidth).toBe(0);
    expect(render.pinnedRightWidth).toBe(0);
  });

  test("exposes row metrics reaching rows outside the rendered window", () => {
    const grid = createGridCore({
      columns: [{ id: "message", header: "Message", widthPx: 140 }],
      rows: Array.from({ length: 500 }, (_, index) => ({
        id: `row-${index}`,
        message: `Row ${index}`,
      })),
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 88,
      overscan: 1,
    });

    // The window is tiny; row 400 is nowhere near it.
    expect(render.rows.some((row) => row.rowIndex === 400)).toBe(false);

    expect(render.rowMetrics.rowCount).toBe(500);
    expect(render.rowMetrics.getOffsetForIndex(400)).toBe(400 * 44);
    expect(render.rowMetrics.getHeight(400)).toBe(44);
    expect(render.rowMetrics.getTotalHeight()).toBe(500 * 44);
  });

  test("row metrics account for variable heights outside the rendered window", () => {
    const grid = createGridCore({
      columns: [
        { id: "message", header: "Message", wrap: true, widthPx: 220 },
        { id: "status", header: "Status", widthPx: 140 },
      ],
      rows: Array.from({ length: 200 }, (_, index) => ({
        id: `row-${index}`,
        // Every third row wraps to more than one line, so heights genuinely vary
        // rather than all falling back to DEFAULT_ROW_HEIGHT.
        message:
          index % 3 === 0
            ? "A much longer multilingual row that should wrap across several lines in the renderer surface and therefore exceed the default row height."
            : "Short",
        status: "ready",
      })),
      getRowId: (row) => String(row.id),
    });

    const render = createDomRenderSnapshot({
      columns: grid.options.columns,
      snapshot: grid.getSnapshot(),
      scrollTop: 0,
      viewportHeight: 100,
      overscan: 0,
      // A measured height for a row far outside the window: only rendered rows
      // are ever measured in practice, but the index is built over every visible
      // row, so a measured value must be reflected at any index.
      measuredHeights: { "row-150": 320 },
    });

    const renderedIndexes = new Set(render.rows.map((row) => row.rowIndex));
    expect(renderedIndexes.has(150)).toBe(false);
    expect(renderedIndexes.has(151)).toBe(false);

    expect(render.rowMetrics.getHeight(150)).toBe(320);

    // Offsets must be the running sum of the mixed measured/estimated heights,
    // not index * DEFAULT_ROW_HEIGHT.
    const wrappedHeight = render.rowMetrics.getHeight(0);
    expect(wrappedHeight).toBeGreaterThan(44);

    let expectedOffset = 0;
    for (let index = 0; index < 151; index += 1) {
      expectedOffset += render.rowMetrics.getHeight(index);
    }
    expect(render.rowMetrics.getOffsetForIndex(151)).toBe(expectedOffset);
    expect(render.rowMetrics.getOffsetForIndex(151)).not.toBe(151 * 44);

    // The last row's offset plus its height is the total scrollable height.
    expect(
      render.rowMetrics.getOffsetForIndex(199) +
        render.rowMetrics.getHeight(199),
    ).toBe(render.rowMetrics.getTotalHeight());
    expect(render.rowMetrics.getTotalHeight()).toBe(render.totalHeight);  test("planColumnLayout lays out every column, window or not", () => {
    // Consumers that hit-test against the column layout (drag-to-reorder)
    // need an entry for columns outside the virtualization window too — and
    // widths resolved the same way the renderer resolves them, so an
    // unsized column is not laid out at zero width.
    const layout = planColumnLayout([
      { id: "pinned", header: "Pinned", widthPx: 120, pinned: "left" },
      { id: "a", header: "A", widthPx: 200 },
      { id: "unsized", header: "Unsized" },
      { id: "wrapped", header: "Wrapped", wrap: true },
      { id: "note", header: "Note", widthPx: 240, pinned: "right" },
    ]);

    expect(layout.columns.map((c) => c.id)).toEqual([
      "pinned",
      "a",
      "unsized",
      "wrapped",
      "note",
    ]);
    expect(layout.columns.map((c) => c.left)).toEqual([0, 120, 320, 460, 680]);
    expect(layout.columns.map((c) => c.width)).toEqual([
      120, 200, 140, 220, 240,
    ]);
    expect(layout.columns[4]?.right).toBe(0);
    expect(layout.totalWidth).toBe(920);
  });

  test("planColumnLayout groups pinned columns into content order", () => {
    // A right-pinned column declared mid-array still lays out last: the
    // content order is [left-pinned, scrollable, right-pinned].
    const layout = planColumnLayout([
      { id: "a", header: "A", widthPx: 100 },
      { id: "note", header: "Note", widthPx: 100, pinned: "right" },
      { id: "b", header: "B", widthPx: 100 },
      { id: "pinned", header: "Pinned", widthPx: 100, pinned: "left" },
    ]);

    expect(layout.columns.map((c) => c.id)).toEqual([
      "pinned",
      "a",
      "b",
      "note",
    ]);
    expect(layout.columns.map((c) => c.index)).toEqual([3, 0, 2, 1]);
    expect(layout.columns.map((c) => c.left)).toEqual([0, 100, 200, 300]);  });
});
