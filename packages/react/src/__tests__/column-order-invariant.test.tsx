import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ROW_SELECT_COLUMN_ID } from "../constants";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";
import type { PretableSurfaceGrid } from "../pretable-surface";

afterEach(cleanup);

/**
 * The engine's column array order IS the drawn order. grid-core enforces it by
 * regrouping into [synthetic?][left…][unpinned…][right…] on every path that
 * takes an order from outside (#209), and the surface leans on it hard: copy,
 * paste, the selection highlight, row-checkbox coverage, `onSelectedRowIdChange`
 * and the announced counts all resolve column spans against `grid.options.columns`
 * because it is the order on screen (#210, #226, #229).
 *
 * Nothing else pins that down end-to-end — grid-core's own tests cover the
 * regrouping, but not that the renderer agrees with it. If the two ever drift,
 * every one of those consumers is silently wrong, so this compares the engine's
 * array against the actual rendered header row for each way an order can be set.
 */
interface Row extends Record<string, unknown> {
  id: string;
  a: string;
  b: string;
  c: string;
  d: string;
}

const ROWS: Row[] = [{ id: "r1", a: "1", b: "2", c: "3", d: "4" }];

function mount(
  columns: PretableColumn<Row>[],
  withRowSelect = false,
  copyToClipboard?: (payload: { readonly text: string }) => void,
) {
  type Grid = PretableSurfaceGrid<Row, string, readonly PretableColumn<Row>[]>;
  let captured: Grid | null = null;
  const view = render(
    <PretableSurface<Row>
      ariaLabel="order-invariant"
      columns={columns}
      getRowId={(row) => row.id}
      onGridReady={(g) => {
        captured = g;
      }}
      rows={ROWS}
      {...(withRowSelect ? { rowSelectionColumn: { enabled: true } } : {})}
      {...(copyToClipboard ? { copyToClipboard } : {})}
      viewportHeight={200}
    />,
  );

  return {
    grid: captured as unknown as Grid,
    /** Column ids in rendered order. The synthetic header carries no
     *  column-id attribute, so it is identified by its own marker. */
    drawn: () =>
      Array.from(
        view.container.querySelectorAll("[data-pretable-header-cell]"),
      ).map((el) =>
        el.hasAttribute("data-pretable-row-select-header")
          ? ROW_SELECT_COLUMN_ID
          : el.getAttribute("data-pretable-column-id"),
      ),
    engine: () => captured!.getState().columnLayout.map((c) => c.id),
    view,
  };
}

function expectAgreement(h: ReturnType<typeof mount>) {
  expect(h.engine()).toEqual(h.drawn());
}

describe("engine column order is the drawn order", () => {
  it("regroups a right pin declared mid-array", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B", pinned: "right" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    expect(h.drawn()).toEqual(["a", "c", "d", "b"]);
    expectAgreement(h);
  });

  it("regroups a left pin declared mid-array", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B", pinned: "left" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    expect(h.drawn()).toEqual(["b", "a", "c", "d"]);
    expectAgreement(h);
  });

  it("holds after setColumnPinned at runtime", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    act(() => h.grid.setColumnPinned("a", "right"));
    expect(h.drawn()).toEqual(["b", "c", "d", "a"]);
    expectAgreement(h);
  });

  it("holds when setColumnOrder interleaves a pinned id", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B", pinned: "right" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    // The request interleaves the right-pinned "b"; it is normalised, not
    // honoured literally.
    act(() => h.grid.setColumnOrder(["d", "b", "c", "a"]));
    expectAgreement(h);
  });

  it("holds after dragging a right-pinned column to the front", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B" },
      { id: "c", header: "C" },
      { id: "d", header: "D", pinned: "right" },
    ]);
    act(() => h.grid.setColumnOrder(["d", "a", "b", "c"]));
    expectAgreement(h);
  });

  it("a hidden column leaves the drawn order but stays in the engine layout", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    act(() => h.grid.setColumnVisible("b", false));

    // No header cell and no body cells for the hidden column.
    expect(h.drawn()).toEqual(["a", "c", "d"]);
    expect(
      h.view.container.querySelectorAll('[data-pretable-column-id="b"]'),
    ).toHaveLength(0);

    // The full layout — the roster a columns panel lists — is still reachable
    // through the existing state access, width and position intact.
    expect(h.engine()).toEqual(["a", "b", "c", "d"]);
    const hiddenEntry = h.grid
      .getState()
      .columnLayout.find((column) => column.id === "b");
    expect((hiddenEntry as { hidden?: boolean } | undefined)?.hidden).toBe(
      true,
    );

    // Re-showing restores the drawn cell in place.
    act(() => h.grid.setColumnVisible("b", true));
    expect(h.drawn()).toEqual(["a", "b", "c", "d"]);
  });

  it("copy across a hidden column excludes its values from the payload", async () => {
    const copyToClipboard = vi.fn();
    const h = mount(
      [
        { id: "a", header: "A" },
        { id: "b", header: "B" },
        { id: "c", header: "C" },
        { id: "d", header: "D" },
      ],
      false,
      copyToClipboard,
    );
    act(() => h.grid.setColumnVisible("b", false));

    // A range that visually spans where "b" would be: a → c.
    act(() =>
      h.grid.setSelection({
        rows: { kind: "explicit", rowIds: new Set() },
        ranges: [
          {
            start: { rowId: "r1", columnId: "a" },
            end: { rowId: "r1", columnId: "c" },
          },
        ],
        anchor: { rowId: "r1", columnId: "a" },
      } as never),
    );
    const cell = h.view.container.querySelector<HTMLElement>(
      '[data-pretable-column-id="a"][data-pretable-cell]',
    );
    expect(cell).not.toBeNull();
    fireEvent.keyDown(cell!, { key: "c", metaKey: true });

    await waitFor(() => expect(copyToClipboard).toHaveBeenCalledOnce());
    const payload = copyToClipboard.mock.calls[0]![0] as { text: string };
    expect(payload.text).toBe("1\t3");
  });

  it("hidden columns are absent from the drawn order every span consumer reads", () => {
    const h = mount([
      { id: "a", header: "A" },
      { id: "b", header: "B" },
      { id: "c", header: "C" },
      { id: "d", header: "D" },
    ]);
    act(() => h.grid.setColumnVisible("c", false));

    // The engine order minus hidden entries IS the drawn order — the
    // hidden-column refinement of `expectAgreement` above.
    const visibleEngine = h.grid
      .getState()
      .columnLayout.filter(
        (column) => (column as { hidden?: boolean }).hidden !== true,
      )
      .map((column) => column.id);
    expect(h.drawn()).toEqual(visibleEngine);
  });

  it("holds with the synthetic row-select column present", () => {
    const h = mount(
      [
        { id: "a", header: "A", pinned: "left" },
        { id: "b", header: "B" },
        { id: "c", header: "C" },
        { id: "d", header: "D" },
      ],
      true,
    );
    expect(h.drawn()[0]).toBe(ROW_SELECT_COLUMN_ID);
    expectAgreement(h);
  });
});

/**
 * The same invariant, one level down: the DRAWN order carries two synthetic
 * columns — the row-select checkbox and the derived group column — and neither
 * is data. `copy.ts`, `csv.ts` and `paste.ts` all agree on that predicate
 * (`isSyntheticColumnId`), so every consumer-facing statement ABOUT those
 * artifacts has to filter the same way or it describes a grid the user cannot
 * copy, export or paste into.
 *
 * Grouping is what makes the two predicates diverge: with nothing grouped
 * `isSyntheticColumnId` reduces to the checkbox test, so a site that filters
 * only the checkbox looks correct forever. Turn grouping on and it counts a
 * presentation column as data. Each test below therefore runs GROUPED and
 * UNGROUPED and compares the two — the ungrouped leg is the control that says
 * the assertion is about grouping and not about the fixture.
 */
describe("the derived group column is not a data column", () => {
  interface GroupedRow extends Record<string, unknown> {
    id: string;
    sector: string;
    name: string;
    qty: number;
  }

  const GROUPED_ROWS: GroupedRow[] = [
    { id: "g1", sector: "Tech", name: "alpha", qty: 1 },
    { id: "g2", sector: "Tech", name: "beta", qty: 2 },
    { id: "g3", sector: "Energy", name: "gamma", qty: 4 },
  ];

  const GROUPED_COLUMNS: PretableColumn<GroupedRow>[] = [
    { id: "sector", header: "Sector", widthPx: 100 },
    { id: "name", header: "Name", widthPx: 100 },
    { id: "qty", header: "Qty", widthPx: 100, type: "number" },
  ];

  type GroupedGrid = PretableSurfaceGrid<
    GroupedRow,
    string,
    readonly PretableColumn<GroupedRow>[]
  >;

  async function mountGrouped(options: {
    grouped: boolean;
    copyToClipboard?: (payload: { readonly text: string }) => void;
    onSelectedRowIdChange?: (rowId: string | null) => void;
    rowSelect?: boolean;
    saveFile?: (file: unknown) => void;
    messages?: Record<string, unknown>;
  }) {
    let captured: GroupedGrid | null = null;
    const view = render(
      <PretableSurface<GroupedRow>
        ariaLabel="group-vocabulary"
        columns={GROUPED_COLUMNS}
        getRowId={(row) => row.id}
        initialExpansion={{ kind: "expanded" }}
        onGridReady={(g) => {
          captured = g as unknown as GroupedGrid;
        }}
        rows={GROUPED_ROWS}
        viewportHeight={400}
        {...(options.copyToClipboard
          ? { copyToClipboard: options.copyToClipboard }
          : {})}
        {...(options.onSelectedRowIdChange
          ? { onSelectedRowIdChange: options.onSelectedRowIdChange }
          : {})}
        {...(options.rowSelect
          ? { rowSelectionColumn: { enabled: true } }
          : {})}
        {...(options.saveFile ? { saveFile: options.saveFile as never } : {})}
        {...(options.messages ? { messages: options.messages as never } : {})}
      />,
    );
    await expect
      .poll(() => view.container.querySelectorAll("[data-pretable-row]").length)
      .toBeGreaterThan(0);
    const grid = captured as unknown as GroupedGrid;
    if (options.grouped) {
      act(() => {
        grid.setQuery({
          filters: [],
          sort: [],
          rowGroups: [{ columnId: "sector" }],
        } as never);
      });
      await expect
        .poll(
          () =>
            view.container.querySelectorAll("[data-pretable-group-row]").length,
        )
        .toBeGreaterThan(0);
    }
    return { view, grid };
  }

  /** Header ids as drawn, so a test names the columns the user actually sees. */
  const drawnIds = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("[data-pretable-header-cell]")).map(
      (el) => el.getAttribute("data-pretable-column-id")!,
    );

  const cellAt = (container: HTMLElement, rowId: string, columnId: string) =>
    container.querySelector<HTMLElement>(
      `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
    )!;

  /**
   * Columns in the TSV's first line. The clipboard is the artifact the
   * announcement describes, so it — not the drawn list — is the authority on
   * how many columns were copied.
   */
  const clipboardWidth = (text: string) =>
    text === "" ? 0 : text.split("\n")[0]!.split("\t").length;

  for (const grouped of [false, true]) {
    it(`Cmd+A then Cmd+C announces exactly the columns it copied, grouped=${grouped}`, async () => {
      const copyToClipboard = vi.fn();
      const announced: { rowCount: number; columnCount: number }[] = [];
      const { view } = await mountGrouped({
        grouped,
        copyToClipboard,
        messages: {
          copyAnnouncement: (args: {
            rowCount: number;
            columnCount: number;
          }) => {
            announced.push(args);
            return "copied";
          },
        },
      });

      // Grouping hides `sector`, so the real data columns are name+qty when
      // grouped and sector+name+qty when not. Asserting the drawn list first
      // makes the expected width below a consequence, not a guess.
      expect(drawnIds(view.container)).toEqual(
        grouped
          ? ["__pretable_group__", "name", "qty"]
          : ["sector", "name", "qty"],
      );
      const realColumnCount = grouped ? 2 : 3;

      const cell = cellAt(view.container, "g1", "name");
      fireEvent.click(cell);
      fireEvent.keyDown(cell, { key: "a", metaKey: true });
      fireEvent.keyDown(cell, { key: "c", metaKey: true });

      await waitFor(() => expect(copyToClipboard).toHaveBeenCalledOnce());
      const payload = copyToClipboard.mock.calls[0]![0] as { text: string };
      expect(clipboardWidth(payload.text)).toBe(realColumnCount);

      await waitFor(() => expect(announced).toHaveLength(1));
      expect(announced[0]!.columnCount).toBe(realColumnCount);
    });

    it(`Cmd+A announces exactly the data columns it selected, grouped=${grouped}`, async () => {
      const announced: { columnCount: number }[] = [];
      const { view } = await mountGrouped({
        grouped,
        messages: {
          selectAllAnnouncement: (args: { columnCount: number }) => {
            announced.push(args);
            return "selected";
          },
        },
      });
      const realColumnCount = grouped ? 2 : 3;

      const cell = cellAt(view.container, "g1", "name");
      fireEvent.click(cell);
      fireEvent.keyDown(cell, { key: "a", metaKey: true });

      await waitFor(() => expect(announced).toHaveLength(1));
      expect(announced[0]!.columnCount).toBe(realColumnCount);
    });

    it(`exportCsv announces exactly the columns the file carries, grouped=${grouped}`, async () => {
      const saveFile = vi.fn();
      const announced: { columnCount: number }[] = [];
      const { grid } = await mountGrouped({
        grouped,
        saveFile,
        messages: {
          exportAnnouncement: (args: { columnCount: number }) => {
            announced.push(args);
            return "exported";
          },
        },
      });
      const realColumnCount = grouped ? 2 : 3;

      act(() => grid.exportCsv());
      await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());

      // The header line of the written file is the authority on how wide it is.
      const file = saveFile.mock.calls[0]![0] as { text: string };
      expect(file.text.split("\n")[0]!.split(",")).toHaveLength(
        realColumnCount,
      );

      await waitFor(() => expect(announced).toHaveLength(1));
      expect(announced[0]!.columnCount).toBe(realColumnCount);
    });

    it(`the header select-all checkbox announces data columns only, grouped=${grouped}`, async () => {
      const announced: { columnCount: number }[] = [];
      const { view } = await mountGrouped({
        grouped,
        rowSelect: true,
        messages: {
          selectAllAnnouncement: (args: { columnCount: number }) => {
            announced.push(args);
            return "selected";
          },
        },
      });

      // With the checkbox column drawn there are two synthetics while grouped
      // and one while not, so this leg over-counts either way — the group
      // column is simply the second one. The ungrouped leg is still the
      // control: it is what says the count means data columns at all.
      const realColumnCount = grouped ? 2 : 3;

      const checkbox = view.container.querySelector<HTMLElement>(
        "[data-pretable-row-select-header] button",
      )!;
      fireEvent.click(checkbox);

      await waitFor(() => expect(announced).toHaveLength(1));
      expect(announced[0]!.columnCount).toBe(realColumnCount);
    });

    it(`a range over every data column is a full-row selection, grouped=${grouped}`, async () => {
      const onSelectedRowIdChange = vi.fn();
      const { view } = await mountGrouped({
        grouped,
        onSelectedRowIdChange,
      });

      // Every column the user can put a value in, first to last. The group
      // column is not one of them: it renders a twisty, never a cell value.
      const real = drawnIds(view.container).filter(
        (id) => !id.startsWith("__pretable"),
      );
      fireEvent.click(cellAt(view.container, "g1", real[0]!));
      fireEvent.click(cellAt(view.container, "g1", real.at(-1)!), {
        shiftKey: true,
      });

      await waitFor(() =>
        expect(onSelectedRowIdChange).toHaveBeenCalledWith("g1"),
      );
    });
  }
});
