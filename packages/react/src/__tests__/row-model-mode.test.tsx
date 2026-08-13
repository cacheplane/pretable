// @vitest-environment jsdom
import { act, render, renderHook } from "@testing-library/react";
import { StrictMode, Suspense } from "react";
import { describe, expect, test, vi } from "vitest";

import * as core from "@pretable/core";

import {
  mergeModelPresentationColumnsForTesting,
  usePretable,
} from "../use-pretable";

interface Row {
  key: `row_${number}`;
  label: string;
  score: number;
}

const column = core.createColumnHelper<Row>();
const columns = [
  column.accessor("label", { type: "text" }),
  column.accessor("score", { type: "number" }),
] as const;
const rows: readonly Row[] = [
  { key: "row_1", label: "one", score: 1 },
  { key: "row_2", label: "two", score: 2 },
];

function createModel() {
  return core.createLocalRowModel({
    rows,
    columns,
    getRowId: (row) => row.key,
  });
}

describe("usePretable explicit-model mode", () => {
  test("keeps exactly one rows-mode model alive through StrictMode rehearsal", async () => {
    const { result, unmount } = renderHook(
      () =>
        usePretable({
          rows,
          columns,
          getRowId: (row) => row.key,
          viewportHeight: 88,
        }),
      { wrapper: StrictMode },
    );
    const committed = result.current.rowModel;
    expect(committed.getState().status.kind).toBe("ready");

    unmount();
    await expect.poll(() => committed.getState().status.kind).toBe("disposed");
  });

  test("keeps a suspended rows-mode candidate alive for the eventual commit", async () => {
    const create = vi.spyOn(core, "createLocalRowModel");
    let ready = false;
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => {
      release = () => {
        ready = true;
        resolve();
      };
    });
    const seen: ReturnType<typeof createModel>[] = [];

    function SuspendedGrid() {
      const value = usePretable({
        rows,
        columns,
        getRowId: (row) => row.key,
        viewportHeight: 88,
      });
      seen.push(value.rowModel);
      if (!ready) throw blocker;
      return null;
    }

    const view = render(
      <Suspense fallback={null}>
        <SuspendedGrid />
      </Suspense>,
    );
    expect(create.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]?.getState().status.kind).toBe("ready");

    await act(async () => release());

    expect(create.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(seen.at(-1)?.getState().status.kind).toBe("ready");
    const committed = seen.at(-1)!;

    view.unmount();
    await expect.poll(() => committed.getState().status.kind).toBe("disposed");
    create.mockRestore();
  });

  test("does not subscribe a borrowed model from a render that throws", () => {
    const model = createModel();
    const subscribe = vi.spyOn(model, "subscribe");
    function BrokenGrid(): null {
      usePretable({ model, viewportHeight: 88 });
      throw new Error("render failed");
    }

    expect(() => render(<BrokenGrid />)).toThrow("render failed");
    expect(subscribe).not.toHaveBeenCalled();
    model.dispose();
  });

  test("uses model columns as presentation fallback and never disposes the model", async () => {
    const model = createModel();
    const dispose = vi.spyOn(model, "dispose");
    const { result, unmount } = renderHook(() =>
      usePretable({ model, viewportHeight: 88, viewportWidth: 320 }),
    );

    expect(result.current.rowModel).toBe(model);
    await expect
      .poll(() => result.current.renderSnapshot.modelRevision)
      .toBe(model.getState().snapshot.revision);
    expect(result.current.renderSnapshot.columns.map(({ id }) => id)).toEqual([
      "label",
      "score",
    ]);
    expect(result.current.gridSnapshot.observedRowModelRevision).toBe(
      result.current.renderSnapshot.modelRevision,
    );

    unmount();
    expect(dispose).not.toHaveBeenCalled();
    expect(model.getState().status).toEqual({ kind: "ready" });
    model.dispose();
  });

  test("observes caller disposal without reconfiguring a disposed controller", () => {
    const model = createModel();
    const { result, unmount } = renderHook(() =>
      usePretable({ model, viewportHeight: 88, viewportWidth: 320 }),
    );

    act(() => model.dispose());

    expect(result.current.status).toEqual({ kind: "disposed" });
    unmount();
  });

  test("accepts presentation overrides and replaces UI ownership when the model changes", async () => {
    const first = createModel();
    const second = createModel();
    const presentation = [
      { id: "label", header: "Display label", widthPx: 240 },
      { id: "score" },
    ] as const;
    const { result, rerender, unmount } = renderHook(
      ({ model }) =>
        usePretable({
          model,
          columns: presentation,
          viewportHeight: 88,
          viewportWidth: 320,
        }),
      { initialProps: { model: first } },
    );
    const firstGrid = result.current.grid;

    rerender({ model: second });

    expect(result.current.rowModel).toBe(second);
    expect(result.current.grid).not.toBe(firstGrid);
    expect(first.getState().status).toEqual({ kind: "ready" });
    unmount();
    expect(second.getState().status).toEqual({ kind: "ready" });
    first.dispose();
    second.dispose();
  });

  test("merges reordered presentation callbacks over authoritative schema columns", () => {
    const editor = vi.fn();
    const merged = mergeModelPresentationColumnsForTesting(columns, [
      { id: "score", renderEditor: editor },
      { id: "label", header: "Renamed" },
    ]);

    expect(merged.map(({ id }) => id)).toEqual(["score", "label"]);
    expect(merged[0]?.renderEditor).toBe(editor);
    expect(merged[0]?.value(rows[0]!)).toBe(1);
    expect(merged[1]?.value(rows[0]!)).toBe("one");
    expect(columns[1]).not.toHaveProperty("renderEditor");
  });

  test("preserves computed accessors for wrapped presentation estimation", async () => {
    const computedColumns = [
      column.accessor("computed", (row) => row.label.repeat(80), {
        type: "text",
      }),
    ] as const;
    const model = core.createLocalRowModel({
      rows,
      columns: computedColumns,
      getRowId: (row) => row.key,
    });
    const { result, unmount } = renderHook(() =>
      usePretable({
        model,
        columns: [{ id: "computed", wrap: true, widthPx: 60 }],
        viewportHeight: 88,
      }),
    );

    await expect
      .poll(() => result.current.renderSnapshot.rows[0]?.height ?? 0)
      .toBeGreaterThan(500);
    unmount();
    model.dispose();
  });

  test("uses value-based mode discrimination for explicit undefined exclusions", () => {
    const model = createModel();
    const setDerivations = vi.spyOn(model, "setDerivations");
    const { rerender } = renderHook(
      ({ header }) =>
        usePretable({
          model,
          rows: undefined,
          columns: [{ id: "label", header }, { id: "score" }],
          viewportHeight: 88,
        }),
      { initialProps: { header: "First" } },
    );

    rerender({ header: "Second" });

    expect(setDerivations).not.toHaveBeenCalled();
    model.dispose();
  });

  test("rejects a presentation override outside the model schema", () => {
    const model = createModel();
    expect(() =>
      renderHook(() =>
        usePretable({
          model,
          columns: [{ id: "missing" }, { id: "score" }] as never,
          viewportHeight: 88,
        }),
      ),
    ).toThrow(/presentation columns.*model schema/i);
    model.dispose();
  });

  test("observes model, UI, and layout stores independently while publishing atomic revisions", async () => {
    const model = createModel();
    const { result } = renderHook(() =>
      usePretable({ model, viewportHeight: 44, viewportWidth: 320 }),
    );
    const firstModelSnapshot = result.current.rowModelSnapshot;

    act(() => {
      result.current.grid.setViewport({
        scrollTop: 44,
        scrollLeft: 0,
        height: 44,
        width: 320,
      });
    });
    expect(result.current.rowModelSnapshot).toBe(firstModelSnapshot);

    act(() => {
      model.applyTransaction({
        update: [{ id: "row_1", changes: { score: 4 } }],
      });
    });
    await expect
      .poll(() => result.current.renderSnapshot.modelRevision)
      .toBe(model.getState().snapshot.revision);
    expect(result.current.rowModelSnapshot).toBe(
      result.current.renderSnapshot.modelSnapshot,
    );
    expect(result.current.gridSnapshot.observedRowModelRevision).toBe(
      result.current.renderSnapshot.modelRevision,
    );
    model.dispose();
  });

  test("forwards grid viewport and column layout into the render controller", async () => {
    const model = core.createLocalRowModel({
      rows: Array.from({ length: 40 }, (_, index): Row => ({
        key: `row_${index}`,
        label: `row ${index}`,
        score: index,
      })),
      columns,
      getRowId: (row) => row.key,
    });
    const { result } = renderHook(() =>
      usePretable({ model, viewportHeight: 44, viewportWidth: 320 }),
    );
    await expect
      .poll(() => result.current.renderSnapshot.modelRevision)
      .toBe(model.getState().snapshot.revision);

    act(() => {
      result.current.grid.setViewport({
        scrollTop: 440,
        scrollLeft: 24,
        height: 44,
        width: 280,
      });
      result.current.grid.setColumnWidth("label", 240);
    });

    await expect
      .poll(() => result.current.renderSnapshot.rows[0]?.rowIndex ?? 0)
      .toBeGreaterThan(0);
    expect(
      result.current.renderSnapshot.columns.find(({ id }) => id === "label")
        ?.width,
    ).toBe(240);
    model.dispose();
  });

  test("preserves UI state across visual prop identity changes and explicit flex widths", async () => {
    const model = createModel();
    type Presentation = readonly [
      { readonly id: "label"; readonly header: string; readonly flex: 1 },
      { readonly id: "score"; readonly widthPx: 80 },
    ];
    const firstPresentation: Presentation = [
      { id: "label", header: "Label", flex: 1 },
      { id: "score", widthPx: 80 },
    ];
    const { result, rerender } = renderHook(
      ({ presentation }: { readonly presentation: Presentation }) =>
        usePretable({
          model,
          columns: presentation,
          viewportHeight: 88,
          viewportWidth: 400,
        }),
      { initialProps: { presentation: firstPresentation } },
    );
    await expect
      .poll(() => result.current.renderSnapshot.modelRevision)
      .toBe(model.getState().snapshot.revision);
    const grid = result.current.grid;
    const flexWidth = result.current.renderSnapshot.columns.find(
      ({ id }) => id === "label",
    )?.width;
    expect(flexWidth).toBeGreaterThan(160);

    expect(() => {
      act(() => result.current.grid.setColumnWidth("label", Number.NaN));
    }).toThrow(/width/i);
    expect(
      result.current.renderSnapshot.columns.find(({ id }) => id === "label")
        ?.width,
    ).toBe(flexWidth);

    act(() => {
      result.current.grid.setFocus({
        ref: { kind: "data", rowId: "row_1" },
        columnId: "label",
      });
      result.current.grid.setColumnWidth("label", 160);
    });
    expect(
      result.current.renderSnapshot.columns.find(({ id }) => id === "label")
        ?.width,
    ).toBe(160);

    rerender({
      presentation: [
        { id: "label", header: "Renamed", flex: 1 },
        { id: "score", widthPx: 80 },
      ],
    });

    expect(result.current.grid).toBe(grid);
    expect(result.current.gridSnapshot.focus).toEqual({
      ref: { kind: "data", rowId: "row_1" },
      columnId: "label",
    });
    expect(
      result.current.renderSnapshot.columns.find(({ id }) => id === "label")
        ?.width,
    ).toBe(160);
    model.dispose();
  });

  test("does not re-render for a rebuild's progress ticks", async () => {
    // `setQuery` rebuilds cooperatively, publishing a fresh state object per
    // slice whose `status` carries `completedRows`/`totalRows` while `snapshot`
    // keeps pointing at the current rows until the new ones swap in.
    // Subscribing to `getState` therefore re-rendered the whole grid on every
    // progress tick against rows that had not changed — and those renders land
    // inside the yield between slices, so the rebuild pays for them. Measured
    // on a 120-row grouping transition: 7ms and 10 scheduler hops for the model
    // alone, ~470ms and 89 hops with a consumer rendering per tick (#327).
    //
    // Asserted as a render count rather than a duration: the defect is the
    // extra renders, and a wall-clock bound would be a flaky restatement of it.
    const manyRows: Row[] = Array.from({ length: 400 }, (_, index) => ({
      key: `row_${index + 1}` as Row["key"],
      label: index % 2 === 0 ? "even" : "odd",
      score: index,
    }));
    const model = core.createLocalRowModel({
      rows: manyRows,
      columns,
      getRowId: (row: Row) => row.key,
    });

    let renders = 0;
    const { result, unmount } = renderHook(() => {
      renders += 1;
      return usePretable({ model, viewportHeight: 88 });
    });

    const before = renders;
    let transition!: { finished: Promise<number> };
    await act(async () => {
      transition = model.setQuery({
        filters: [],
        sort: [{ columnId: "score", direction: "desc" }],
        rowGroups: [],
      }) as never;
      await transition.finished;
    });

    // Measured on these 400 rows: 4 renders with the fix — the snapshot swap
    // plus `rebuilding` and `ready`, all of which are material — against 20
    // when the raw per-tick status is subscribed to. The bound sits between
    // them rather than at either, so it survives a differently-sliced rebuild
    // while still failing the defect by a wide margin.
    expect(renders - before).toBeLessThanOrEqual(6);
    expect(result.current.rowModelSnapshot.query.sort[0]).toMatchObject({
      columnId: "score",
      direction: "desc",
    });
    unmount();
    model.dispose();
  });
});
