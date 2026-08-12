// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { usePretable } from "../use-pretable";
import { createColumnHelper } from "@pretable/core";

type Row = {
  id: string;
  name: string;
};

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("name", { header: "Name", type: "text" }),
] as const;

describe("usePretable streaming lifecycle", () => {
  it("keeps the grid instance and selection across rows updates", async () => {
    const { result, rerender } = renderHook(
      ({ rows }: { rows: Row[] }) =>
        usePretable({
          columns,
          rows,
          viewportHeight: 200,
        }),
      {
        initialProps: {
          rows: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
        },
      },
    );

    const grid = result.current.grid;
    grid.toggleRowSelection("a");
    expect(result.current.grid.getState().selection.rows).toMatchObject({
      kind: "explicit",
    });

    // New array, same ids, new data — the streaming case.
    rerender({
      rows: [
        { id: "a", name: "A2" },
        { id: "b", name: "B2" },
      ],
    });

    expect(result.current.grid).toBe(grid); // not recreated
    await waitFor(() =>
      expect(result.current.rowModelSnapshot.dataRowAt(0)?.row.name).toBe("A2"),
    );
    const selected = result.current.gridSnapshot.selection.rows;
    expect(selected.kind).toBe("explicit");
    if (selected.kind !== "explicit") throw new Error("expected explicit rows");
    expect(selected.rowIds.has("a")).toBe(true);
  });
});
