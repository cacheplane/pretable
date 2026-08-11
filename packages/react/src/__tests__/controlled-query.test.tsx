// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { StrictMode, useLayoutEffect } from "react";
import { describe, expect, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  type PretableQueryFor,
} from "@pretable/core";

import { usePretable } from "../use-pretable";
import { PretableSurface } from "../pretable-surface";
import {
  usePretableModelInternal,
  type PretableReactGrid,
} from "../pretable-model";

type Row = {
  id: number;
  label: string;
  score: number;
};

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
  test("legacy controlled UI slices leave omitted query slices live", async () => {
    let grid: PretableReactGrid<Row, number, typeof columns> | null = null;
    const view = render(
      <PretableSurface<Row, number, typeof columns>
        ariaLabel="partially controlled grid"
        columns={columns}
        getRowId={(row: Row) => row.id}
        onGridReady={(next) => {
          grid = next;
        }}
        rows={rows}
        state={{ focus: { rowId: null, columnId: null } }}
        viewportHeight={88}
      />,
    );
    await expect.poll(() => grid).not.toBeNull();

    await act(async () => {
      await grid!.setQuery(sortedQuery)?.finished;
    });
    await expect
      .poll(() => grid!.rowModel.getState().snapshot.query)
      .toEqual(sortedQuery);

    view.rerender(
      <PretableSurface<Row, number, typeof columns>
        ariaLabel="partially controlled grid"
        columns={columns}
        getRowId={(row: Row) => row.id}
        onGridReady={(next) => {
          grid = next;
        }}
        rows={rows}
        state={{ selection: { anchor: null, ranges: [] } }}
        viewportHeight={88}
      />,
    );
    const filteredAndGrouped = {
      filters: [{ columnId: "label", operator: "contains", value: "o" }],
      sort: sortedQuery.sort,
      rowGroups: [{ columnId: "label" }],
    } as const;
    await act(async () => {
      await grid!.setQuery(filteredAndGrouped)?.finished;
    });
    await expect
      .poll(() => grid!.rowModel.getState().snapshot.query)
      .toEqual(filteredAndGrouped);
  });

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

  test("keeps one controlled grid facade and dispatches through the latest callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ onQueryChange }) =>
        usePretable({
          rows,
          columns,
          query: emptyQuery,
          onQueryChange,
          viewportHeight: 88,
        }),
      { initialProps: { onQueryChange: first } },
    );
    const grid = result.current.grid;

    rerender({ onQueryChange: second });
    act(() => result.current.grid.setQuery(sortedQuery));

    expect(result.current.grid).toBe(grid);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(sortedQuery);
  });

  test("publishes callback and control-mode changes before child layout effects", async () => {
    const model = createLocalRowModel({ rows, columns });
    const first = vi.fn();
    const second = vi.fn();
    const grids: PretableReactGrid<Row, number, typeof columns>[] = [];
    const filteredQuery = {
      filters: [{ columnId: "label", operator: "equals", value: "two" }],
      sort: [],
      rowGroups: [],
    } as const;

    function QueryInChildLayout(props: {
      grid: PretableReactGrid<Row, number, typeof columns>;
      query: PretableQueryFor<typeof columns>;
    }) {
      useLayoutEffect(() => {
        grids.push(props.grid);
        props.grid.setQuery(props.query);
      }, [props.grid, props.query]);
      return null;
    }

    function Harness(props: {
      callback?: (query: PretableQueryFor<typeof columns>) => void;
      proposal: PretableQueryFor<typeof columns>;
    }) {
      const table = usePretableModelInternal({
        rowModel: model,
        columns,
        viewportHeight: 88,
        onQueryChange: props.callback,
      });
      return <QueryInChildLayout grid={table.grid} query={props.proposal} />;
    }

    const view = render(
      <StrictMode>
        <Harness callback={first} proposal={emptyQuery} />
      </StrictMode>,
    );
    first.mockClear();
    grids.length = 0;

    view.rerender(
      <StrictMode>
        <Harness callback={second} proposal={sortedQuery} />
      </StrictMode>,
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(sortedQuery);
    const stableGrid = grids.at(-1);

    second.mockClear();
    view.rerender(
      <StrictMode>
        <Harness proposal={filteredQuery} />
      </StrictMode>,
    );
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(grids.at(-1)).toBe(stableGrid);
    await expect
      .poll(() => model.getState().snapshot.query)
      .toEqual(filteredQuery);

    view.unmount();
    await act(async () => Promise.resolve());
    expect(() => stableGrid?.setQuery(emptyQuery)).toThrowError(
      expect.objectContaining({ code: "disposed-grid-ui" }),
    );
    model.dispose();
  });

  test("rejects retained controlled and uncontrolled grid handles after unmount", async () => {
    const onQueryChange = vi.fn();
    const controlled = renderHook(() =>
      usePretable({
        rows,
        columns,
        query: emptyQuery,
        onQueryChange,
        viewportHeight: 88,
      }),
    );
    const controlledGrid = controlled.result.current.grid;
    controlled.unmount();
    await act(async () => Promise.resolve());

    expect(() => controlledGrid.setQuery(sortedQuery)).toThrowError(
      expect.objectContaining({ code: "disposed-grid-ui" }),
    );
    expect(onQueryChange).not.toHaveBeenCalled();

    const uncontrolled = renderHook(() =>
      usePretable({ rows, columns, viewportHeight: 88 }),
    );
    const uncontrolledGrid = uncontrolled.result.current.grid;
    const ownedModel = uncontrolled.result.current.rowModel;
    const setQuery = vi.spyOn(ownedModel, "setQuery");
    uncontrolled.unmount();
    await act(async () => Promise.resolve());

    expect(() => uncontrolledGrid.setQuery(sortedQuery)).toThrowError(
      expect.objectContaining({ code: "disposed-grid-ui" }),
    );
    expect(setQuery).not.toHaveBeenCalled();
  });

  test("rejects stale explicit-model grids after replacement and unmount", async () => {
    const first = createLocalRowModel({ rows, columns });
    const second = createLocalRowModel({ rows, columns });
    const firstSetQuery = vi.spyOn(first, "setQuery");
    const secondSetQuery = vi.spyOn(second, "setQuery");
    const view = renderHook(
      ({ model }) => usePretable({ model, viewportHeight: 88 }),
      { initialProps: { model: first } },
    );
    const firstGrid = view.result.current.grid;

    view.rerender({ model: second });
    await act(async () => Promise.resolve());

    expect(() => firstGrid.setQuery(sortedQuery)).toThrowError(
      expect.objectContaining({ code: "disposed-grid-ui" }),
    );
    expect(firstSetQuery).not.toHaveBeenCalled();

    const secondGrid = view.result.current.grid;
    view.unmount();
    await act(async () => Promise.resolve());
    expect(() => secondGrid.setQuery(sortedQuery)).toThrowError(
      expect.objectContaining({ code: "disposed-grid-ui" }),
    );
    expect(secondSetQuery).not.toHaveBeenCalled();
    first.dispose();
    second.dispose();
  });
});
