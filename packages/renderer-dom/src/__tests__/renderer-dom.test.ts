import { describe, expect, test, vi } from "vitest";

import { createGridCore } from "@pretable-internal/grid-core";
import * as textCore from "@pretable-internal/text-core";

import { createDomRenderSnapshot } from "../index";

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

    expect(render.rows[0]?.height).toBe(174);
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
});
