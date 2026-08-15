// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, expectTypeOf, test, vi } from "vitest";

import {
  createColumnHelper,
  createLocalRowModel,
  GROUP_COLUMN_ID,
  type PretableRowModel,
  type PretableRowModelSnapshot,
  type PretableIndexedFocusRef,
} from "@pretable/core";

import {
  PretableSurface,
  type PretableSurfaceGrid,
  type PretableSurfaceRowsProps,
} from "../pretable-surface";
import type { PretableColumnValue } from "../types";
import * as rowHeight from "../row-height";

type Row = {
  id: number;
  group: string;
  name: string;
  quantity: number;
  price: number;
};

const column = createColumnHelper<Row>();
const columns = [
  column.accessor("group", { type: "text" }),
  column.accessor("name", { type: "text" }),
  column.accessor("quantity", { type: "number", editable: true }),
  column.accessor("price", { type: "number" }),
] as const;

const rows: readonly Row[] = Array.from({ length: 100_000 }, (_, index) => ({
  id: index,
  group: `g${Math.floor(index / 10)}`,
  name: `row ${index}`,
  quantity: index,
  price: index / 10,
}));

type Model = PretableRowModel<Row, number, typeof columns>;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, reject, resolve };
}

function quantityCell(view: ReturnType<typeof render>, rowId = 0) {
  return view.container.querySelector<HTMLElement>(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="quantity"]`,
  )!;
}

async function commitQuantity(view: ReturnType<typeof render>, value: string) {
  await waitFor(() => expect(quantityCell(view)).toBeTruthy());
  fireEvent.doubleClick(quantityCell(view));
  const input = await view.findByRole("textbox");
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

function poisonUnboundedReads(model: Model, maxSpan = 256) {
  const range = vi.fn(
    (
      snapshot: PretableRowModelSnapshot<Row, number, typeof columns>,
      start: number,
      end: number,
    ) => {
      if (end - start > maxSpan) {
        throw new Error(`unbounded range read: ${start}..${end}`);
      }
      return snapshot.range(start, end);
    },
  );
  const parentGroupOf = vi.fn(
    (
      snapshot: PretableRowModelSnapshot<Row, number, typeof columns>,
      ref: Parameters<typeof snapshot.parentGroupOf>[0],
    ) => snapshot.parentGroupOf(ref),
  );
  const dataIndexOf = vi.fn(
    (
      snapshot: PretableRowModelSnapshot<Row, number, typeof columns>,
      ref: Parameters<typeof snapshot.dataIndexOf>[0],
    ) => snapshot.dataIndexOf(ref),
  );
  let sourceState = model.getState();
  let wrappedState: ReturnType<Model["getState"]> | undefined;
  const wrapState = () => {
    const state = model.getState();
    if (state === sourceState && wrappedState !== undefined)
      return wrappedState;
    sourceState = state;
    const snapshot = state.snapshot;
    const delegate =
      <TArgs extends unknown[], TResult>(
        operation: (...args: TArgs) => TResult,
      ) =>
      (...args: TArgs): TResult =>
        operation.apply(snapshot, args);
    wrappedState = {
      ...state,
      snapshot: {
        revision: snapshot.revision,
        sourceRowCount: snapshot.sourceRowCount,
        visibleRowCount: snapshot.visibleRowCount,
        visibleDataRowCount: snapshot.visibleDataRowCount,
        query: snapshot.query,
        expansion: snapshot.expansion,
        rowAt: delegate(snapshot.rowAt),
        range: (start: number, end: number) => range(snapshot, start, end),
        indexOf: delegate(snapshot.indexOf),
        dataIndexOf: (ref) => dataIndexOf(snapshot, ref),
        dataRowAt: delegate(snapshot.dataRowAt),
        firstDataRow: delegate(snapshot.firstDataRow),
        lastDataRow: delegate(snapshot.lastDataRow),
        nextDataRow: delegate(snapshot.nextDataRow),
        previousDataRow: delegate(snapshot.previousDataRow),
        parentGroupOf: (ref) => parentGroupOf(snapshot, ref),
        nearestVisibleRef: delegate(snapshot.nearestVisibleRef),
        isGroupExpanded: delegate(snapshot.isGroupExpanded),
      },
    };
    return wrappedState;
  };
  const boundMethods = new Map<PropertyKey, unknown>();
  const spy = new Proxy(model, {
    get(target, key) {
      if (key === "getState") return wrapState;
      if (boundMethods.has(key)) return boundMethods.get(key);
      const value = Reflect.get(target, key, target);
      if (typeof value !== "function") return value;
      const bound = value.bind(target);
      boundMethods.set(key, bound);
      return bound;
    },
  }) as Model;
  return { dataIndexOf, model: spy, parentGroupOf, range };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("indexed PretableSurface", () => {
  test("explicit-model query transitions update grouped presentation columns", async () => {
    const owned = createLocalRowModel({ rows: rows.slice(0, 20), columns });
    const view = render(
      <PretableSurface
        ariaLabel="explicit grouped presentation"
        model={owned}
        overscan={0}
        viewportHeight={168}
      />,
    );
    const headerIds = () =>
      [...view.container.querySelectorAll("[data-pretable-header-cell]")].map(
        (cell) => cell.getAttribute("data-pretable-column-id"),
      );

    await expect
      .poll(headerIds)
      .toEqual(["group", "name", "quantity", "price"]);
    act(() => {
      owned.setQuery({
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "group" }],
      });
    });
    await expect.poll(() => view.queryByRole("treegrid")).toBeInTheDocument();
    await expect
      .poll(headerIds)
      .toEqual([GROUP_COLUMN_ID, "name", "quantity", "price"]);

    act(() => {
      owned.setQuery({ filters: [], sort: [], rowGroups: [] });
    });
    await expect
      .poll(headerIds)
      .toEqual(["group", "name", "quantity", "price"]);
    owned.dispose();
  }, 30_000);

  test("a schema column revealed after initial grouping keeps auto width", async () => {
    const owned = createLocalRowModel({
      rows: rows.slice(0, 20),
      columns,
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "group" }],
      },
    });
    const view = render(
      <PretableSurface
        ariaLabel="initially grouped presentation"
        model={owned}
        overscan={0}
        viewportHeight={168}
      />,
    );
    await expect
      .poll(() =>
        view.container.querySelector(
          `[data-pretable-header-cell][data-pretable-column-id="${GROUP_COLUMN_ID}"]`,
        ),
      )
      .toBeTruthy();

    act(() => {
      owned.setQuery({ filters: [], sort: [], rowGroups: [] });
    });
    const revealed = await waitFor(() => {
      const cell = view.container.querySelector<HTMLElement>(
        '[data-pretable-header-cell][data-pretable-column-id="group"]',
      );
      expect(cell).toBeTruthy();
      return cell!;
    });

    expect(revealed.style.width).toBe("140px");
    owned.dispose();
  });

  test("controlled query transitions update grouped presentation columns", async () => {
    const emptyQuery = { filters: [], sort: [], rowGroups: [] } as const;
    const groupedQuery = {
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "group" }],
    } as const;
    const Harness = (props: { readonly grouped: boolean }) => (
      <PretableSurface
        ariaLabel="controlled grouped presentation"
        columns={columns}
        getRowId={(row) => row.id}
        onQueryChange={() => undefined}
        overscan={0}
        query={props.grouped ? groupedQuery : emptyQuery}
        rows={rows.slice(0, 20)}
        viewportHeight={168}
      />
    );
    const view = render(<Harness grouped={false} />);
    const headerIds = () =>
      [...view.container.querySelectorAll("[data-pretable-header-cell]")].map(
        (cell) => cell.getAttribute("data-pretable-column-id"),
      );

    await expect
      .poll(headerIds)
      .toEqual(["group", "name", "quantity", "price"]);
    view.rerender(<Harness grouped />);
    await expect
      .poll(headerIds)
      .toEqual([GROUP_COLUMN_ID, "name", "quantity", "price"]);
    await expect
      .poll(
        () =>
          view.container.querySelectorAll("[data-pretable-group-row]").length,
      )
      .toBeGreaterThan(0);

    view.rerender(<Harness grouped={false} />);
    await expect
      .poll(headerIds)
      .toEqual(["group", "name", "quantity", "price"]);
  });

  test("public rows-mode callbacks preserve numeric IDs and column values", () => {
    expectTypeOf<
      PretableColumnValue<(typeof columns)[2]>
    >().toEqualTypeOf<number>();
    const props: PretableSurfaceRowsProps<Row, number, typeof columns> = {
      ariaLabel: "typed numeric grid",
      columns,
      getRowId: (row) => row.id,
      onFocusChange: (focus) => {
        // Exact, not assignable — and it caught the widening the moment
        // `{kind: "header"}` joined the union, which is the point of writing it
        // this way. The cursor can sit on a column header, so the callback's
        // ref is a `PretableIndexedFocusRef`; a consumer switching on
        // `ref.kind` has three cases to answer.
        expectTypeOf(
          focus.ref,
        ).toEqualTypeOf<PretableIndexedFocusRef<number> | null>();
        expectTypeOf(focus.columnId).toEqualTypeOf<
          | "group"
          | "name"
          | "quantity"
          | "price"
          | "__pretable_group__"
          | "__pretable_row_select__"
          | null
        >();
      },
      onSelectionChange: (selection) => {
        const rowId: number | undefined = selection.ranges[0]?.startRowId;
        const columnId:
          | "group"
          | "name"
          | "quantity"
          | "price"
          | "__pretable_group__"
          | "__pretable_row_select__"
          | undefined = selection.ranges[0]?.startColumnId;
        void rowId;
        void columnId;
      },
      onTelemetryChange: (telemetry) => {
        expectTypeOf(telemetry.selectedRowId).toEqualTypeOf<number | null>();
      },
      renderBodyCell: (input) => {
        expectTypeOf(input.rowId).toEqualTypeOf<number>();
        if (input.columnId === "quantity") {
          const value: number = input.value;
          void value;
        }
        return null;
      },
      rows: rows.slice(0, 1),
      state: {
        focus: {
          ref: { kind: "data", rowId: 0 },
          columnId: "quantity",
        },
        selection: {
          ranges: [
            {
              startRowId: 0,
              endRowId: 0,
              startColumnId: "quantity",
              endColumnId: "quantity",
            },
          ],
          anchor: { rowId: 0, columnId: "quantity" },
        },
      },
      viewportHeight: 168,
    };

    expect(props.state?.focus?.ref).toEqual({ kind: "data", rowId: 0 });
  });

  test("controlled selection preserves numeric row ID zero", async () => {
    const onSelectedRowIdChange = vi.fn();
    render(
      <PretableSurface
        ariaLabel="controlled zero selection"
        columns={columns}
        getRowId={(row: Row) => row.id}
        onSelectedRowIdChange={onSelectedRowIdChange}
        rows={rows.slice(0, 1)}
        state={{
          selection: {
            ranges: [
              {
                startRowId: 0,
                endRowId: 0,
                startColumnId: "group",
                endColumnId: "price",
              },
            ],
            anchor: { rowId: 0, columnId: "group" },
          },
        }}
        viewportHeight={168}
      />,
    );

    await waitFor(() => expect(onSelectedRowIdChange).toHaveBeenCalledWith(0));
  });

  test("rendering, measurement, telemetry, selection, focus, activation and announcements stay bounded", async () => {
    const owned = createLocalRowModel({ rows: rows.slice(0, 1_000), columns });
    const guarded = poisonUnboundedReads(owned);
    const onTelemetryChange = vi.fn();
    const onRowActivate = vi.fn();
    const measure = vi.spyOn(rowHeight, "measureRenderedRowHeight");
    let grid: PretableSurfaceGrid<Row, number, typeof columns> | null = null;

    const view = render(
      <PretableSurface
        ariaLabel="indexed grid"
        model={guarded.model}
        onRowActivate={onRowActivate}
        onGridReady={(next) => {
          grid = next;
        }}
        onTelemetryChange={onTelemetryChange}
        overscan={0}
        rowSelectionColumn={{ enabled: true }}
        viewportHeight={168}
      />,
    );

    await waitFor(() => expect(guarded.range).toHaveBeenCalled(), {
      timeout: 1_000,
    });
    await waitFor(
      () => expect(view.getAllByTestId("pretable-row")).toHaveLength(4),
      { timeout: 15_000 },
    );
    expect(guarded.range).toHaveBeenCalled();
    expect(measure.mock.calls.length).toBeLessThanOrEqual(12);
    expect(onTelemetryChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        rowModelRowCount: 1_000,
        renderedRowCount: 4,
      }),
    );

    const firstCell = view.container.querySelector<HTMLElement>(
      '[data-pretable-row-id="0"] [data-pretable-column-id="name"]',
    )!;
    act(() => {
      grid!.setFocus({
        ref: { kind: "data", rowId: 1 },
        columnId: "name",
      });
      grid!.setFocus({
        ref: { kind: "data", rowId: 0 },
        columnId: "name",
      });
    });
    await waitFor(() => expect(document.activeElement).toBe(firstCell));

    fireEvent.doubleClick(quantityCell(view, 0));
    expect(await view.findByRole("textbox")).toBeInTheDocument();
    fireEvent.keyDown(view.getByRole("textbox"), { key: "Escape" });

    fireEvent.click(firstCell);
    onRowActivate.mockClear();
    fireEvent.keyDown(firstCell, { key: "Enter" });
    expect(onRowActivate).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: 0, rowIndex: 0 }),
    );
    onRowActivate.mockClear();
    fireEvent.keyDown(firstCell, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(firstCell, { key: "Enter" });
    expect(onRowActivate).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: 1, rowIndex: 1 }),
    );

    fireEvent.click(view.getByRole("checkbox", { name: "Select all rows" }));
    await waitFor(() =>
      expect(view.getByRole("status")).toHaveTextContent("All rows selected"),
    );
    expect(
      guarded.range.mock.calls.every(([, start, end]) => end - start <= 256),
    ).toBe(true);

    view.unmount();
    owned.dispose();
  }, 20_000);

  test("far-span copy announcements use indexed counts without reading the span", async () => {
    const owned = createLocalRowModel({ rows, columns });
    const guarded = poisonUnboundedReads(owned);
    let grid: PretableSurfaceGrid<Row, number, typeof columns> | null = null;
    const view = render(
      <PretableSurface
        ariaLabel="bounded announcement grid"
        model={guarded.model}
        onCopy={() => ({ text: "custom" })}
        copyToClipboard={() => undefined}
        onGridReady={(next) => {
          grid = next;
        }}
        overscan={0}
        viewportHeight={168}
      />,
    );
    await waitFor(() => expect(quantityCell(view)).toBeTruthy(), {
      timeout: 15_000,
    });
    act(() => {
      grid!.setFocus({
        ref: { kind: "data", rowId: 0 },
        columnId: "name",
      });
      grid!.setSelection({
        rows: { kind: "explicit", rowIds: new Set() },
        ranges: [
          {
            start: { rowId: 0, columnId: "name" },
            end: { rowId: 99_999, columnId: "name" },
          },
        ],
        anchor: { rowId: 0, columnId: "name" },
      });
    });
    fireEvent.keyDown(view.getByRole("grid"), { key: "c", metaKey: true });
    await waitFor(() =>
      expect(view.getByRole("status")).toHaveTextContent(
        "100000 rows × 1 columns copied",
      ),
    );
    expect(
      guarded.range.mock.calls.every(([, start, end]) => end - start <= 256),
    ).toBe(true);
    owned.dispose();
  }, 60_000);

  test("shift-checking a 100k row span is one bounded symbolic selection", async () => {
    const owned = createLocalRowModel({ rows, columns });
    const guarded = poisonUnboundedReads(owned);
    const onRowSelectionChange = vi.fn();
    let grid: PretableSurfaceGrid<Row, number, typeof columns> | null = null;
    const view = render(
      <PretableSurface
        ariaLabel="bounded row range selection"
        model={guarded.model}
        onGridReady={(next) => {
          grid = next;
        }}
        onRowSelectionChange={onRowSelectionChange}
        overscan={0}
        rowSelectionColumn={{ enabled: true }}
        viewportHeight={168}
      />,
    );
    const rowCheckbox = (rowId: number) =>
      view.container.querySelector<HTMLElement>(
        `[data-pretable-row-id="${rowId}"] button[data-pretable-row-select]`,
      );
    await waitFor(() => expect(rowCheckbox(0)).toBeTruthy(), {
      timeout: 15_000,
    });
    fireEvent.click(rowCheckbox(0)!);

    act(() => grid!.scrollToRow(99_999));
    await waitFor(() => expect(rowCheckbox(99_999)).toBeTruthy(), {
      timeout: 15_000,
    });
    const listener = vi.fn();
    const unsubscribe = grid!.subscribe(listener);
    onRowSelectionChange.mockClear();
    guarded.dataIndexOf.mockClear();

    fireEvent.click(rowCheckbox(99_999)!, { shiftKey: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(onRowSelectionChange).not.toHaveBeenCalled();
    const selectedRows = grid!.getState().selection.rows;
    expect(selectedRows.kind).toBe("explicit");
    if (selectedRows.kind !== "explicit") throw new Error("expected explicit");
    expect(Array.from(selectedRows.ranges ?? [])).toEqual([
      { startRowId: 0, endRowId: 99_999 },
    ]);
    expect(
      view.getByRole("checkbox", { name: "Select all rows" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      guarded.range.mock.calls.every(([, start, end]) => end - start <= 256),
    ).toBe(true);
    expect(guarded.dataIndexOf.mock.calls.length).toBeGreaterThan(0);
    expect(guarded.dataIndexOf.mock.calls.length).toBeLessThan(64);

    unsubscribe();
    view.unmount();
    owned.dispose();
  }, 60_000);

  test("group parent focus, collapse and scroll-to-row use indexed lookups", async () => {
    const owned = createLocalRowModel({
      rows: rows.slice(0, 100),
      columns,
      initialExpansion: { kind: "expanded" },
      query: {
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "group" }],
      },
    });
    const guarded = poisonUnboundedReads(owned, 16);
    let grid: unknown;
    const view = render(
      <PretableSurface
        ariaLabel="grouped indexed grid"
        model={guarded.model}
        onGridReady={(next) => {
          grid = next;
        }}
        overscan={0}
        viewportHeight={168}
      />,
    );

    await waitFor(() =>
      expect(
        view.container.querySelector("[data-pretable-group-row]"),
      ).toBeTruthy(),
    );
    const imperative = grid as {
      setFocus(focus: {
        ref: { kind: "data"; rowId: number };
        columnId: "name";
      }): void;
      moveFocus(movement: "parent"): void;
      scrollToRow(rowId: number): void;
    };
    act(() => {
      imperative.setFocus({
        ref: { kind: "data", rowId: 0 },
        columnId: "name",
      });
      imperative.moveFocus("parent");
    });
    expect(guarded.parentGroupOf).toHaveBeenCalledWith(expect.anything(), {
      kind: "data",
      rowId: 0,
    });

    fireEvent.click(view.getAllByRole("button", { name: /^Collapse / })[0]!);
    const firstRow = owned.getState().snapshot.rowAt(0);
    expect(firstRow?.kind).toBe("group");
    if (firstRow?.kind !== "group") throw new Error("expected group row");
    expect(owned.getState().snapshot.isGroupExpanded(firstRow.groupId)).toBe(
      false,
    );

    act(() => imperative.scrollToRow(99));
    await waitFor(() =>
      expect(view.getByRole("treegrid").scrollTop).toBeGreaterThan(0),
    );
    view.unmount();
    owned.dispose();
  });

  test("rows-mode editing saves until the accepted rows proposal reconciles", async () => {
    const gate = deferred();
    const onRowChange = vi.fn((change: unknown) => {
      void change;
      return gate.promise;
    });
    let grid: {
      rowModel: Model;
    } | null = null;
    const initial = [rows[0]!];
    const props = {
      ariaLabel: "controlled edit grid",
      columns,
      getRowId: (row: Row) => row.id,
      onGridReady: (next: { rowModel: Model }) => {
        grid = next;
      },
      onRowChange,
      overscan: 0,
      viewportHeight: 168,
    } as const;
    const view = render(<PretableSurface {...props} rows={initial} />);
    await commitQuantity(view, "41");
    await waitFor(() => expect(onRowChange).toHaveBeenCalledOnce());
    const beforeRevision = grid!.rowModel.getState().snapshot.revision;
    expect(view.getByRole("textbox")).toHaveAttribute("aria-busy", "true");
    expect(onRowChange.mock.calls[0]![0]).toMatchObject({
      rowId: 0,
      changes: { quantity: 41 },
    });

    await act(async () => gate.resolve());
    expect(view.getByRole("textbox")).toHaveAttribute("aria-busy", "true");
    expect(grid!.rowModel.getState().snapshot.revision).toBe(beforeRevision);

    view.rerender(
      <PretableSurface {...props} rows={[{ ...initial[0]!, quantity: 41 }]} />,
    );
    await waitFor(() => expect(view.queryByRole("textbox")).toBeNull());
    expect(grid!.rowModel.getState().snapshot.revision).toBeGreaterThan(
      beforeRevision,
    );
  });

  test("rows-mode synchronous reconciliation closes the saving editor", async () => {
    function Harness() {
      const [controlledRows, setControlledRows] = React.useState([rows[0]!]);
      return (
        <PretableSurface
          ariaLabel="synchronous controlled edit grid"
          columns={columns}
          getRowId={(row: Row) => row.id}
          onRowChange={(change) => {
            setControlledRows((current) =>
              current.map((row) =>
                row.id === change.rowId ? { ...row, ...change.changes } : row,
              ),
            );
          }}
          overscan={0}
          rows={controlledRows}
          viewportHeight={168}
        />
      );
    }

    const view = render(<Harness />);
    await commitQuantity(view, "45");
    await waitFor(() => expect(view.queryByRole("textbox")).toBeNull());
    expect(quantityCell(view)).toHaveTextContent("45");
  });

  test("rows-mode rejection restores the draft with an error and no revision", async () => {
    const gate = deferred();
    const onRowChange = vi.fn((change: unknown) => {
      void change;
      return gate.promise;
    });
    let grid: { rowModel: Model } | null = null;
    const view = render(
      <PretableSurface
        ariaLabel="rejected controlled edit grid"
        columns={columns}
        getRowId={(row: Row) => row.id}
        onGridReady={(next) => {
          grid = next as { rowModel: Model };
        }}
        onRowChange={onRowChange}
        overscan={0}
        rows={[rows[0]!]}
        viewportHeight={168}
      />,
    );
    await commitQuantity(view, "42");
    await waitFor(() => expect(onRowChange).toHaveBeenCalledOnce());
    const beforeRevision = grid!.rowModel.getState().snapshot.revision;
    await act(async () => gate.reject(new Error("desk rejected")));
    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(view.getByRole("textbox")).toHaveValue("42");
    expect(view.getByText("desk rejected")).toBeInTheDocument();
    expect(grid!.rowModel.getState().snapshot.revision).toBe(beforeRevision);
  });

  test("explicit-model editing gates one transaction behind beforeRowChange", async () => {
    const owned = createLocalRowModel({ rows: [rows[0]!], columns });
    const gate = deferred();
    const beforeRowChange = vi.fn((changes: readonly unknown[]) => {
      void changes;
      return gate.promise;
    });
    const view = render(
      <PretableSurface
        ariaLabel="explicit edit grid"
        beforeRowChange={beforeRowChange}
        model={owned}
        overscan={0}
        viewportHeight={168}
      />,
    );
    const beforeRevision = owned.getState().snapshot.revision;
    await commitQuantity(view, "43");
    await waitFor(() => expect(beforeRowChange).toHaveBeenCalledOnce());
    expect(beforeRowChange.mock.calls[0]![0]).toHaveLength(1);
    expect(view.getByRole("textbox")).toHaveAttribute("aria-busy", "true");
    expect(owned.getState().snapshot.revision).toBe(beforeRevision);

    await act(async () => gate.resolve());
    await waitFor(() => expect(view.queryByRole("textbox")).toBeNull());
    expect(owned.getState().snapshot.revision).toBe(beforeRevision + 1);
    expect(owned.getState().snapshot.dataRowAt(0)?.row.quantity).toBe(43);
    owned.dispose();
  });

  test("explicit-model editing discards a gated transaction after cancel", async () => {
    const owned = createLocalRowModel({ rows: [rows[0]!], columns });
    const gate = deferred();
    let surfaceGrid:
      PretableSurfaceGrid<Row, number, typeof columns> | undefined;
    const view = render(
      <PretableSurface
        ariaLabel="cancelled explicit edit grid"
        beforeRowChange={() => gate.promise}
        model={owned}
        onGridReady={(next) => {
          surfaceGrid = next;
        }}
        overscan={0}
        viewportHeight={168}
      />,
    );
    const beforeRevision = owned.getState().snapshot.revision;
    await commitQuantity(view, "43");
    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveAttribute("aria-busy", "true"),
    );

    act(() => surfaceGrid!.cancelEdit());
    await act(async () => gate.resolve());

    expect(owned.getState().snapshot.revision).toBe(beforeRevision);
    expect(owned.getState().snapshot.dataRowAt(0)?.row.quantity).toBe(0);
    owned.dispose();
  });

  test("explicit-model editing never lets an older gate overwrite a newer edit", async () => {
    const owned = createLocalRowModel({ rows: [rows[0]!], columns });
    const firstGate = deferred();
    const secondGate = deferred();
    const gates = [firstGate, secondGate];
    let call = 0;
    let surfaceGrid:
      PretableSurfaceGrid<Row, number, typeof columns> | undefined;
    const view = render(
      <PretableSurface
        ariaLabel="superseded explicit edit grid"
        beforeRowChange={() => gates[call++]!.promise}
        model={owned}
        onGridReady={(next) => {
          surfaceGrid = next;
        }}
        overscan={0}
        viewportHeight={168}
      />,
    );
    const beforeRevision = owned.getState().snapshot.revision;
    await commitQuantity(view, "43");
    await waitFor(() => expect(call).toBe(1));
    act(() => surfaceGrid!.cancelEdit());
    await commitQuantity(view, "44");
    await waitFor(() => expect(call).toBe(2));

    await act(async () => secondGate.resolve());
    await waitFor(() =>
      expect(owned.getState().snapshot.dataRowAt(0)?.row.quantity).toBe(44),
    );
    await act(async () => firstGate.resolve());

    expect(owned.getState().snapshot.revision).toBe(beforeRevision + 1);
    expect(owned.getState().snapshot.dataRowAt(0)?.row.quantity).toBe(44);
    owned.dispose();
  });

  test("explicit-model editing discards a gated transaction after unmount", async () => {
    const owned = createLocalRowModel({ rows: [rows[0]!], columns });
    const gate = deferred();
    const view = render(
      <PretableSurface
        ariaLabel="unmounted explicit edit grid"
        beforeRowChange={() => gate.promise}
        model={owned}
        overscan={0}
        viewportHeight={168}
      />,
    );
    const beforeRevision = owned.getState().snapshot.revision;
    await commitQuantity(view, "43");
    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveAttribute("aria-busy", "true"),
    );

    view.unmount();
    await act(async () => gate.resolve());

    expect(owned.getState().snapshot.revision).toBe(beforeRevision);
    expect(owned.getState().snapshot.dataRowAt(0)?.row.quantity).toBe(0);
    owned.dispose();
  });

  test("explicit-model editing discards a gated transaction after model replacement", async () => {
    const first = createLocalRowModel({ rows: [rows[0]!], columns });
    const second = createLocalRowModel({ rows: [rows[0]!], columns });
    const gate = deferred();
    const view = render(
      <PretableSurface
        ariaLabel="replaced explicit edit grid"
        beforeRowChange={() => gate.promise}
        model={first}
        overscan={0}
        viewportHeight={168}
      />,
    );
    const firstRevision = first.getState().snapshot.revision;
    const secondRevision = second.getState().snapshot.revision;
    await commitQuantity(view, "43");
    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveAttribute("aria-busy", "true"),
    );

    view.rerender(
      <PretableSurface
        ariaLabel="replaced explicit edit grid"
        beforeRowChange={() => gate.promise}
        model={second}
        overscan={0}
        viewportHeight={168}
      />,
    );
    await act(async () => gate.resolve());

    expect(first.getState().snapshot.revision).toBe(firstRevision);
    expect(first.getState().snapshot.dataRowAt(0)?.row.quantity).toBe(0);
    expect(second.getState().snapshot.revision).toBe(secondRevision);
    expect(second.getState().snapshot.dataRowAt(0)?.row.quantity).toBe(0);
    first.dispose();
    second.dispose();
  });

  test("explicit-model rejection keeps the revision and restores edit error state", async () => {
    const owned = createLocalRowModel({ rows: [rows[0]!], columns });
    const gate = deferred();
    const beforeRowChange = vi.fn((changes: readonly unknown[]) => {
      void changes;
      return gate.promise;
    });
    const view = render(
      <PretableSurface
        ariaLabel="rejected explicit edit grid"
        beforeRowChange={beforeRowChange}
        model={owned}
        overscan={0}
        viewportHeight={168}
      />,
    );
    const beforeRevision = owned.getState().snapshot.revision;
    await commitQuantity(view, "44");
    await waitFor(() => expect(beforeRowChange).toHaveBeenCalledOnce());
    await act(async () => gate.reject(new Error("server rejected")));
    await waitFor(() =>
      expect(view.getByRole("textbox")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(view.getByRole("textbox")).toHaveValue("44");
    expect(view.getByText("server rejected")).toBeInTheDocument();
    expect(owned.getState().snapshot.revision).toBe(beforeRevision);
    owned.dispose();
  });

  test("copy and paste read only the selected/output spans", async () => {
    const owned = createLocalRowModel({ rows: rows.slice(0, 1_000), columns });
    const guarded = poisonUnboundedReads(owned, 16);
    const copyToClipboard = vi.fn();
    const beforeRowChange = vi.fn();
    const view = render(
      <PretableSurface
        ariaLabel="clipboard indexed grid"
        model={guarded.model}
        beforeRowChange={beforeRowChange}
        copyToClipboard={copyToClipboard}
        overscan={0}
        viewportHeight={168}
      />,
    );
    await waitFor(
      () => expect(view.getAllByTestId("pretable-row")).toHaveLength(4),
      { timeout: 15_000 },
    );
    const cell = view.container.querySelector<HTMLElement>(
      '[data-pretable-row-id="0"] [data-pretable-column-id="quantity"]',
    )!;
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "c", metaKey: true });
    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledOnce());

    fireEvent.paste(view.getByRole("grid"), {
      clipboardData: { getData: () => "41\n42\n43" },
    });
    await waitFor(() => expect(beforeRowChange).toHaveBeenCalledOnce());
    expect(beforeRowChange.mock.calls[0]![0]).toHaveLength(3);
    expect(
      guarded.range.mock.calls.every(([, start, end]) => end - start <= 16),
    ).toBe(true);
    view.unmount();
    owned.dispose();
  }, 20_000);

  test("explicit paste cannot commit to a replaced model after its gate resolves in layout", async () => {
    const gate = deferred();
    const beforeRowChange = vi.fn(() => gate.promise);
    const first = createLocalRowModel({ rows: rows.slice(0, 3), columns });
    const replacement = createLocalRowModel({
      rows: rows.slice(0, 3),
      columns,
    });
    const Harness = (props: {
      readonly current: Model;
      readonly resolveInLayout?: () => void;
    }) => {
      const { current, resolveInLayout } = props;
      React.useLayoutEffect(() => {
        resolveInLayout?.();
      }, [resolveInLayout]);
      return (
        <PretableSurface
          ariaLabel="paste replacement race"
          beforeRowChange={beforeRowChange}
          model={current}
          overscan={0}
          viewportHeight={168}
        />
      );
    };
    const view = render(<Harness current={first} />);
    await waitFor(() => expect(quantityCell(view)).toBeTruthy());
    fireEvent.click(quantityCell(view));
    fireEvent.paste(view.getByRole("grid"), {
      clipboardData: { getData: () => "41" },
    });
    await waitFor(() => expect(beforeRowChange).toHaveBeenCalledOnce());
    const firstRevision = first.getState().snapshot.revision;
    const replacementRevision = replacement.getState().snapshot.revision;

    view.rerender(
      <Harness current={replacement} resolveInLayout={gate.resolve} />,
    );
    await act(async () => Promise.resolve());

    expect(first.getState().snapshot.revision).toBe(firstRevision);
    expect(replacement.getState().snapshot.revision).toBe(replacementRevision);
    first.dispose();
    replacement.dispose();
  });

  test("explicit paste cannot commit after unmount when its gate resolves in layout", async () => {
    const gate = deferred();
    const beforeRowChange = vi.fn(() => gate.promise);
    const owned = createLocalRowModel({ rows: rows.slice(0, 3), columns });
    const Harness = (props: {
      readonly show: boolean;
      readonly resolveInLayout?: () => void;
    }) => {
      const { resolveInLayout, show } = props;
      React.useLayoutEffect(() => {
        resolveInLayout?.();
      }, [resolveInLayout]);
      return show ? (
        <PretableSurface
          ariaLabel="paste unmount race"
          beforeRowChange={beforeRowChange}
          model={owned}
          overscan={0}
          viewportHeight={168}
        />
      ) : null;
    };
    const view = render(<Harness show />);
    await waitFor(() => expect(quantityCell(view)).toBeTruthy());
    fireEvent.click(quantityCell(view));
    fireEvent.paste(view.getByRole("grid"), {
      clipboardData: { getData: () => "41" },
    });
    await waitFor(() => expect(beforeRowChange).toHaveBeenCalledOnce());
    const revision = owned.getState().snapshot.revision;

    view.rerender(<Harness show={false} resolveInLayout={gate.resolve} />);
    await act(async () => Promise.resolve());

    expect(owned.getState().snapshot.revision).toBe(revision);
    owned.dispose();
  });

  test("windowGap telemetry reports the unsupplied tail past the loaded window, and clears inside it", async () => {
    const onTelemetryChange = vi.fn();
    // Dataset index 500..529 is loaded (30 rows); 500 unsupplied rows sit
    // before the window and 470 (1_000 total - 530 covered) sit after it.
    const windowedRows = rows.slice(500, 530);
    const view = render(
      <PretableSurface
        ariaLabel="windowed grid"
        columns={columns}
        getRowId={(row) => row.id}
        onQueryChange={() => undefined}
        onTelemetryChange={onTelemetryChange}
        overscan={0}
        processing={{ filter: "external", sort: "external" }}
        query={{ filters: [], sort: [], rowGroups: [] }}
        resultMeta={{
          total: { kind: "exact", count: 1_000 },
          window: { start: 500, hasMore: true },
        }}
        rows={windowedRows}
        viewportHeight={168}
      />,
    );

    await waitFor(() => expect(onTelemetryChange).toHaveBeenCalled());
    const lastCall = () =>
      onTelemetryChange.mock.calls[onTelemetryChange.mock.calls.length - 1]![0];

    const viewport = view.getByRole("grid", { name: "windowed grid" });

    // Scroll deep into the trailing gap: the loaded window's 30 rows plus
    // its leading 500-row spacer end well before the bottom of the full
    // 1_000-row, 44px-per-row scroll extent (44_000px).
    fireEvent.scroll(viewport, { target: { scrollTop: 43_832 } });
    await waitFor(() =>
      expect(lastCall().windowGap).toEqual({
        direction: "after",
        rowCount: 470,
      }),
    );

    // Scroll back to the top of the loaded window (dataset row 500, at
    // 500 * 44px): fully inside the supplied range, so the gap clears.
    onTelemetryChange.mockClear();
    fireEvent.scroll(viewport, { target: { scrollTop: 500 * 44 } });
    await waitFor(() => expect(onTelemetryChange).toHaveBeenCalled());
    expect(lastCall().windowGap).toBeUndefined();

    view.unmount();
  });

  test("windowGap telemetry does not refresh from a resultMeta-only update without a rows/viewport change", async () => {
    const onTelemetryChange = vi.fn();
    const windowedRows = rows.slice(500, 530);
    const Harness = (props: { readonly total: number }) => (
      <PretableSurface
        ariaLabel="windowed grid stale"
        columns={columns}
        getRowId={(row) => row.id}
        onQueryChange={() => undefined}
        onTelemetryChange={onTelemetryChange}
        overscan={0}
        processing={{ filter: "external", sort: "external" }}
        query={{ filters: [], sort: [], rowGroups: [] }}
        resultMeta={{
          total: { kind: "exact", count: props.total },
          window: { start: 500, hasMore: true },
        }}
        rows={windowedRows}
        viewportHeight={168}
      />
    );

    const view = render(<Harness total={1_000} />);
    await waitFor(() => expect(onTelemetryChange).toHaveBeenCalled());
    const lastCall = () =>
      onTelemetryChange.mock.calls[onTelemetryChange.mock.calls.length - 1]![0];

    const viewport = view.getByRole("grid", { name: "windowed grid stale" });
    // 30_000px is past the loaded window's true end (leading 500 rows +
    // 30 loaded rows = 530 * 44px = 23_320px) but nowhere near either
    // candidate scroll extent below, so it stays a valid "past the window"
    // position across the resultMeta change this test makes.
    fireEvent.scroll(viewport, { target: { scrollTop: 30_000 } });
    await waitFor(() =>
      expect(lastCall().windowGap).toEqual({
        direction: "after",
        rowCount: 470,
      }),
    );

    // resultMeta.total shrinks from 1_000 to 531 (only one row past the
    // loaded window now), but `rows` and the viewport do not change. The row
    // layout controller only replans on a scroll/viewport/column/row-model
    // change (see the comment above `windowGap` in pretable-surface.tsx), so
    // `renderSnapshot.totalHeight` stays pinned to the OLD total (1_000 *
    // 44px = 44_000px) even though `windowSpacers.trailingRows` (derived
    // straight from `resultMeta`, not from the stale render snapshot) is
    // fresh (1). Mixing the stale total with the fresh trailing count puts
    // the computed "last loaded row" boundary at 44_000 - 1*44 = 43_956px —
    // nowhere near the true boundary (23_320px) — so the still-past-the-
    // window viewport at 30_168px reads as *inside* the window and the gap
    // disappears, one render later than it should. This is the known
    // constraint from W4b landing on `windowGap`; it is pinned here rather
    // than fixed, because fixing it means changing when the row layout
    // controller replans (a `pretable-model.ts` concern deliberately kept
    // ignorant of `resultMeta`), not anything about how `windowGap` itself
    // is computed.
    onTelemetryChange.mockClear();
    view.rerender(<Harness total={531} />);
    await waitFor(() => expect(onTelemetryChange).toHaveBeenCalled());
    expect(lastCall().windowGap).toBeUndefined();

    // A scroll — any replan-triggering event — lets the controller pick up
    // the new geometry, and `windowGap` catches up to the true state.
    onTelemetryChange.mockClear();
    fireEvent.scroll(viewport, { target: { scrollTop: 30_001 } });
    await waitFor(() =>
      expect(lastCall().windowGap).toEqual({ direction: "after", rowCount: 1 }),
    );

    view.unmount();
  });
});
