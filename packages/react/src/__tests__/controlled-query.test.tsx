// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { createColumnHelper, type PretableQueryFor } from "@pretable/core";

import { usePretable } from "../use-pretable";

interface Row {
  id: number;
  label: string;
  score: number;
}

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("label", { type: "text" }),
  column.accessor("score", { type: "number" }),
] as const;
const rows: readonly Row[] = [
  { id: 1, label: "one", score: 1 },
  { id: 2, label: "two", score: 2 },
];
const emptyQuery: PretableQueryFor<typeof columns> = {
  filters: [],
  sort: [],
  rowGroups: [],
};
const sortedQuery = {
  filters: [],
  sort: [{ columnId: "score", direction: "desc" }],
  rowGroups: [],
} as const;

describe("usePretable rows-mode query ownership", () => {
  test("treats an explicit undefined model exclusion as rows mode", () => {
    const { result } = renderHook(() =>
      usePretable({
        model: undefined,
        rows,
        columns,
        viewportHeight: 88,
      }),
    );

    expect(result.current.rowModelSnapshot.sourceRowCount).toBe(rows.length);
  });

  test("keeps controlled UI proposals callback-only until the prop changes", async () => {
    const onQueryChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ query }) =>
        usePretable({
          rows,
          columns,
          query,
          onQueryChange,
          viewportHeight: 88,
        }),
      { initialProps: { query: emptyQuery } },
    );
    const revision = result.current.rowModelSnapshot.revision;

    act(() => result.current.grid.setQuery(sortedQuery));

    expect(onQueryChange).toHaveBeenCalledOnce();
    expect(onQueryChange).toHaveBeenCalledWith(sortedQuery);
    expect(result.current.rowModelSnapshot.query).toEqual(emptyQuery);
    expect(result.current.rowModelSnapshot.revision).toBe(revision);

    rerender({ query: sortedQuery });
    await expect
      .poll(() => result.current.rowModelSnapshot.query)
      .toEqual(sortedQuery);
  });

  test("uncontrolled query actions call the owned model", async () => {
    const { result } = renderHook(() =>
      usePretable({ rows, columns, viewportHeight: 88 }),
    );

    act(() => result.current.grid.setQuery(sortedQuery));

    await expect
      .poll(() => result.current.rowModelSnapshot.query)
      .toEqual(sortedQuery);
  });

  test("successive controlled props supersede the older transition", async () => {
    const first = {
      filters: [{ columnId: "label", operator: "contains", value: "o" }],
      sort: [],
      rowGroups: [],
    } as const;
    const second = {
      filters: [{ columnId: "label", operator: "equals", value: "two" }],
      sort: [],
      rowGroups: [],
    } as const;
    const { result, rerender } = renderHook(
      ({ query }) =>
        usePretable({
          rows,
          columns,
          query,
          onQueryChange: () => undefined,
          viewportHeight: 88,
        }),
      {
        initialProps: {
          query: emptyQuery as typeof emptyQuery | typeof first | typeof second,
        },
      },
    );

    rerender({ query: first });
    rerender({ query: second });

    await expect
      .poll(() => result.current.rowModelSnapshot.query)
      .toEqual(second);
    expect(result.current.status.kind).not.toBe("error");
  });

  test("orders a controlled query behind same-commit derivation reconciliation", async () => {
    const reversedScoreColumns = [
      column.accessor("label", { type: "text" }),
      column.accessor("score", (row) => 100 - row.score, { type: "number" }),
    ] as const;
    const ascending = {
      filters: [],
      sort: [{ columnId: "score", direction: "asc" }],
      rowGroups: [],
    } as const;
    const { result, rerender } = renderHook(
      ({ activeColumns, query }) =>
        usePretable({
          rows,
          columns: activeColumns,
          query,
          onQueryChange: () => undefined,
          viewportHeight: 88,
        }),
      {
        initialProps: {
          activeColumns: columns as
            typeof columns | typeof reversedScoreColumns,
          query: emptyQuery as typeof emptyQuery | typeof ascending,
        },
      },
    );

    rerender({ activeColumns: reversedScoreColumns, query: ascending });

    await expect
      .poll(() => result.current.rowModelSnapshot.query)
      .toEqual(ascending);
    expect(result.current.rowModelSnapshot.dataRowAt(0)?.rowId).toBe(2);
  });
});
