import { describe, expect, test } from "vitest";

import { createGridCore } from "@pretable-internal/grid-core";

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
    expect(render.rows.map((row) => row.top)).toEqual([132, 176, 220, 264, 308]);
  });
});
