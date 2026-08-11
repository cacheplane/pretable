// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, test } from "vitest";

import * as core from "@pretable/core";

import { useLocalRowModel } from "../use-local-row-model";

interface Row {
  id: number;
  label: string;
  score: number;
}

const column = core.createColumnHelper<Row>();
const columns = [
  column.accessor("label", { type: "text" }),
  column.accessor("score", { type: "number" }),
] as const;

describe("useLocalRowModel", () => {
  test("owns one long-lived model, reconciles after commit, and disposes it", async () => {
    const firstRows: readonly Row[] = [
      { id: 1, label: "one", score: 1 },
      { id: 2, label: "two", score: 2 },
    ];
    const { result, rerender, unmount } = renderHook(
      ({ rows }) => useLocalRowModel({ rows, columns }),
      {
        initialProps: { rows: firstRows },
        wrapper: StrictMode,
      },
    );

    const model = result.current;
    const initialRevision = model.getState().snapshot.revision;
    rerender({ rows: firstRows });
    expect(result.current).toBe(model);
    expect(model.getState().snapshot.revision).toBe(initialRevision);

    rerender({
      rows: [
        { id: 1, label: "updated", score: 3 },
        { id: 2, label: "two", score: 2 },
      ],
    });
    expect(result.current).toBe(model);
    expect(model.getState().snapshot.rowAt(0)).toMatchObject({
      kind: "data",
      row: { label: "updated", score: 3 },
    });

    unmount();
    await expect
      .poll(() => model.getState().status)
      .toEqual({
        kind: "disposed",
      });
  });

  test("reconciles compatible derivations without replacing the model", async () => {
    const firstColumns = columns;
    const secondColumns = [
      column.accessor("label", { type: "text" }),
      column.accessor("score", (row) => row.score * 2, { type: "number" }),
    ] as const;
    const { result, rerender } = renderHook(
      ({ derivations }) =>
        useLocalRowModel({
          rows: [{ id: 1, label: "one", score: 2 }],
          columns: firstColumns,
          derivations,
        }),
      { initialProps: { derivations: firstColumns } },
    );
    const model = result.current;

    rerender({ derivations: secondColumns });

    expect(result.current).toBe(model);
    await expect.poll(() => model.getState().snapshot.revision).toBe(1);
  });
});
