import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GROUP_COLUMN_ID } from "@pretable/core";

import type { PretableReactGrid } from "../pretable-model";
import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: "r1", name: "Ada" },
  { id: "r2", name: "Linus" },
];
const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", editable: true },
];

function renderGrid(onRowChange = vi.fn()) {
  render(
    <PretableSurface<Row>
      ariaLabel="people"
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(r) => r.id}
      viewportHeight={300}
      onRowChange={onRowChange}
    />,
  );
  return { onRowChange };
}

function firstNameCell(): HTMLElement {
  // first body row, first cell
  return within(screen.getAllByRole("row")[1]).getAllByRole("gridcell")[0];
}

describe("PretableSurface editing", () => {
  it("enters edit mode on Enter and shows an input", () => {
    renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("commits on Enter and fires onRowChange with the new value", async () => {
    const { onRowChange } = renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Ada Lovelace" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await Promise.resolve();
    expect(onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "Ada Lovelace",
      }),
    );
  });

  it("reverts on Escape without firing onRowChange", () => {
    const { onRowChange } = renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onRowChange).not.toHaveBeenCalled();
  });

  it("does not enter edit mode for a non-editable column", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[{ id: "name", header: "Name" }]}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("enters edit mode on double-click of an editable cell", () => {
    renderGrid();
    const cell = firstNameCell();
    fireEvent.doubleClick(cell);
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("does not move grid focus when arrow keys are pressed inside the editor", () => {
    const onFocusChange = vi.fn();
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
        onFocusChange={onFocusChange}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    const box = screen.getByRole("textbox");
    onFocusChange.mockClear();
    // Arrow keys must drive the text cursor, not the grid's focus model.
    fireEvent.keyDown(box, { key: "ArrowRight" });
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(onFocusChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("shows a validation message and keeps the editor open on reject", async () => {
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: true,
            validate: () => "too short",
          },
        ]}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("too short");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("keeps an async validation attached across the validating render", async () => {
    let finishValidation!: (result: true | string) => void;
    const asyncColumns: PretableColumn<Row>[] = [
      {
        id: "name",
        header: "Name",
        editable: true,
        validate: () =>
          new Promise<true | string>((resolve) => {
            finishValidation = resolve;
          }),
      },
    ];
    const view = render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={asyncColumns}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
      />,
    );
    fireEvent.doubleClick(firstNameCell());
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "x" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await act(async () => Promise.resolve());
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-busy", "true");

    view.rerender(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={asyncColumns}
        rows={ROWS.map((row) => ({ ...row }))}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
      />,
    );

    await act(async () => finishValidation("async rejection"));
    expect(screen.getByRole("alert")).toHaveTextContent("async rejection");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  // A browser replaces the current selection with the typed character. jsdom's
  // fireEvent.change ignores selection, so mirror the browser here: splice the
  // character into the live selection range and dispatch the resulting value.
  function typeChar(el: HTMLInputElement | HTMLTextAreaElement, ch: string) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + ch + el.value.slice(end);
    fireEvent.change(el, { target: { value: next } });
  }

  it("accumulates keystrokes after a type-to-replace begin", () => {
    renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    // type-to-replace: the printable key seeds the draft and opens the editor
    fireEvent.keyDown(cell, { key: "a" });
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box).toHaveValue("a");
    // The seeded character must NOT be selected, or the next key replaces it.
    expect(box.selectionStart).toBe(1);
    expect(box.selectionEnd).toBe(1);
    typeChar(box, "b");
    expect(screen.getByRole("textbox")).toHaveValue("ab");
  });

  it("still selects the whole value when the edit begins with Enter", () => {
    renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe("Ada".length);
    // Select-all means the first keystroke replaces the existing value.
    typeChar(box, "b");
    expect(screen.getByRole("textbox")).toHaveValue("b");
  });

  it("still selects the whole value when the edit begins with a double-click", () => {
    renderGrid();
    fireEvent.doubleClick(firstNameCell());
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe("Ada".length);
  });

  it("does not leak a type-to-replace seed into the next Enter-opened edit", () => {
    renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    fireEvent.keyDown(cell, { key: "Enter" });
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe("Ada".length);
  });

  it("narrows an enum combobox progressively across two typed characters", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: true,
            type: "enum",
            options: [
              { value: "ready", label: "Ready" },
              { value: "beta", label: "Beta" },
              { value: "rust", label: "Rust" },
            ],
          },
        ]}
        rows={[{ id: "r1", name: "beta" }]}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "r" });
    const box = screen.getByRole("combobox") as HTMLInputElement;
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Ready",
      "Rust",
    ]);
    typeChar(box, "e");
    // "re" keeps only Ready; the buggy select-all would leave "e" → Ready+Beta.
    expect(screen.getByRole("combobox")).toHaveValue("re");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Ready",
    ]);
  });

  it("shows an error and allows Enter-retry when commit rejects then resolves", async () => {
    const onRowChange = vi
      .fn()
      .mockRejectedValueOnce(new Error("save failed"))
      .mockResolvedValueOnce(undefined);
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[{ id: "name", header: "Name", editable: true }]}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={onRowChange}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ada L." },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent("save failed");
    // retry
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flush();
    expect(onRowChange).toHaveBeenCalledTimes(2);
  });

  // Drives the REAL surface, not the controller's stub grid. The stub in
  // `use-cell-edit-controller.test.ts` honours the entry status it is handed,
  // so it reported `"checking"` while the surface silently dropped it and
  // opened every edit in `"editing"` — a green test over a phase the shipped
  // grid could not reach.
  it("holds an async-editable edit in 'checking' until the predicate answers", async () => {
    let allow!: (v: boolean) => void;
    const onRowChange = vi.fn();
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: () => new Promise<boolean>((r) => (allow = r)),
          },
        ]}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={onRowChange}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });

    // Predicate still in flight: the editor is mounted but inert.
    expect(cell).toHaveAttribute("data-pretable-edit-status", "checking");
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box).toHaveAttribute("readonly");

    // ...and a blur cannot commit a draft the grid has not agreed to accept.
    // `useEditorField` gates blur-commit on `status === "editing"`, which is
    // exactly the comparison the widened `string` left unchecked.
    fireEvent.blur(box);
    await flush();
    expect(onRowChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    allow(true);
    await flush();
    expect(firstNameCell()).toHaveAttribute(
      "data-pretable-edit-status",
      "editing",
    );
    const open = screen.getByRole("textbox");
    expect(open).not.toHaveAttribute("aria-busy");
    expect(open).not.toHaveAttribute("readonly");
  });

  it("closes without opening when async editable resolves false", async () => {
    let allow!: (v: boolean) => void;
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: () => new Promise<boolean>((r) => (allow = r)),
          },
        ]}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(cell).toHaveAttribute("data-pretable-edit-status", "checking");
    allow(false);
    await flush();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(firstNameCell()).not.toHaveAttribute("data-pretable-edit-status");
  });
});

// ---------------------------------------------------------------------------
// Editing × row grouping.
//
// Grouping restructures the very things the edit lifecycle addresses: it
// injects a synthetic group column, hides the grouped column, and makes a row's
// visibility depend on an ancestor's expansion state. Each of those can strand
// engine editing state on something that is no longer drawn, so they are pinned
// here rather than left to the two features' separate suites.
// ---------------------------------------------------------------------------

interface GroupedRow extends Record<string, unknown> {
  id: string;
  sector: string;
  name: string;
}

const GROUPED_ROWS: GroupedRow[] = [
  { id: "r1", sector: "Tech", name: "alpha" },
  { id: "r2", sector: "Tech", name: "beta" },
  { id: "r3", sector: "Energy", name: "gamma" },
];

const GROUPED_COLUMNS: PretableColumn<GroupedRow>[] = [
  { id: "sector", header: "Sector", widthPx: 120, editable: true },
  { id: "name", header: "Name", widthPx: 120, editable: true },
];

type GroupedGrid = PretableReactGrid<
  GroupedRow,
  string,
  readonly [
    { readonly id: "sector"; readonly accessor: (row: GroupedRow) => string },
    { readonly id: "name"; readonly accessor: (row: GroupedRow) => string },
  ]
>;

/**
 * A REAL consumer, not a spy.
 *
 * In uncontrolled `rows` mode the commit path returns `"keep-open"` after
 * awaiting `onRowChange`, and a layout effect closes the editor only once the
 * `rows` prop it is handed actually reflects the change. A harness that never
 * writes the change back therefore sits in `"saving"` forever — correct
 * behaviour, but useless for any assertion about the editor CLOSING. Every test
 * below that watches an edit settle needs this write-back.
 */
function GroupedHarness({
  hideGroupedColumns,
  onGridReady,
  onRowChange,
}: {
  hideGroupedColumns: boolean;
  onGridReady: (grid: GroupedGrid) => void;
  onRowChange: (change: unknown) => void;
}) {
  const [rows, setRows] = React.useState<GroupedRow[]>(GROUPED_ROWS);
  return (
    <PretableSurface<GroupedRow>
      ariaLabel="positions"
      columns={GROUPED_COLUMNS}
      getRowId={(row) => row.id}
      hideGroupedColumns={hideGroupedColumns}
      initialExpansion={{ kind: "expanded" }}
      onGridReady={(grid) => {
        onGridReady(grid as unknown as GroupedGrid);
      }}
      onRowChange={(change) => {
        onRowChange(change);
        setRows((prev) =>
          prev.map((row) =>
            row.id === change.rowId
              ? { ...row, [change.columnId]: change.value }
              : row,
          ),
        );
      }}
      overscan={0}
      rows={rows}
      viewportHeight={600}
    />
  );
}

describe("editing × row grouping", () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  async function setupGrouped(
    options: { hideGroupedColumns?: boolean } = {},
  ): Promise<{
    container: HTMLElement;
    grid: GroupedGrid;
    onRowChange: ReturnType<typeof vi.fn>;
  }> {
    const onRowChange = vi.fn();
    let captured: GroupedGrid | undefined;
    const view = render(
      <GroupedHarness
        hideGroupedColumns={options.hideGroupedColumns ?? true}
        onGridReady={(grid) => {
          captured = grid;
        }}
        onRowChange={onRowChange}
      />,
    );
    if (captured === undefined) throw new Error("Expected onGridReady to fire");
    return { container: view.container, grid: captured, onRowChange };
  }

  async function groupBySector(grid: GroupedGrid, container: HTMLElement) {
    act(() => {
      grid.setQuery({
        filters: [],
        sort: [],
        rowGroups: [{ columnId: "sector" }],
      });
    });
    await expect
      .poll(
        () => container.querySelectorAll("[data-pretable-group-row]").length,
      )
      .toBe(2);
  }

  const cellOf = (container: HTMLElement, rowId: string, columnId: string) => {
    const cell = container.querySelector<HTMLElement>(
      `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"]`,
    );
    if (cell === null) {
      throw new Error(`Expected a ${columnId} cell on row ${rowId}`);
    }
    return cell;
  };

  const groupRowLabelled = (container: HTMLElement, label: string) => {
    const row = [
      ...container.querySelectorAll<HTMLElement>("[data-pretable-group-row]"),
    ].find((candidate) => candidate.textContent?.includes(label));
    if (row === undefined) throw new Error(`Expected a ${label} group row`);
    return row;
  };

  const twistyOf = (row: HTMLElement) => {
    const twisty = row.querySelector<HTMLElement>(
      "[data-pretable-group-twisty]",
    );
    if (twisty === null) throw new Error("Expected a group twisty");
    return twisty;
  };

  /** Any live editor, wherever the surface chose to mount it. */
  const openEditor = (container: HTMLElement) =>
    container.querySelector("input, textarea");

  it("commits a data row inside a group under its own rowId and columnId", async () => {
    const { container, grid, onRowChange } = await setupGrouped();
    await groupBySector(grid, container);

    // Fixture guard: the synthetic group column is drawn FIRST and `sector` is
    // not drawn at all. If a future default changed either, the payload
    // assertion below could pass for the wrong reason.
    expect(
      [...container.querySelectorAll("[data-pretable-header-cell]")].map((c) =>
        c.getAttribute("data-pretable-column-id"),
      ),
    ).toEqual([GROUP_COLUMN_ID, "name"]);

    const cell = cellOf(container, "r1", "name");
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "alpha-2" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await settle();

    // The change addresses the SCHEMA row/column. The group column sits to the
    // left of every drawn cell, so an index-based commit path would report the
    // neighbouring column (or none at all) instead of `name`.
    expect(onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "alpha-2",
        changes: { name: "alpha-2" },
      }),
    );
    await expect.poll(() => grid.getState().editing).toBeNull();
  });

  it("opens no editor from a group row, for Enter or a printable key", async () => {
    const { container, grid } = await setupGrouped();
    await groupBySector(grid, container);
    // Positive twin first: the identical gesture on a DATA row in this same
    // grouped view DOES open an editor, so the nulls below are a real refusal
    // rather than an edit path that happens to be broken for everyone.
    const dataCell = cellOf(container, "r1", "name");
    fireEvent.click(dataCell);
    fireEvent.keyDown(dataCell, { key: "Enter" });
    expect(openEditor(container)).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(openEditor(container)).toBeNull();

    const techRow = groupRowLabelled(container, "Tech");
    const groupCell = techRow.querySelector("[data-pretable-group-cell]");
    if (groupCell === null) throw new Error("Expected a group cell");
    expect(techRow).toHaveAttribute("aria-expanded", "true");

    // Enter belongs to expand/collapse on a group row; a group row carries an
    // aggregate, not an editable value, so it must not reach the edit
    // controller. The collapse is the proof the key was RECEIVED and consumed —
    // without it, "no editor" could just mean the event went nowhere.
    fireEvent.click(groupCell);
    fireEvent.keyDown(groupCell, { key: "Enter" });
    expect(openEditor(container)).toBeNull();
    // Polled: the toggle settles asynchronously (post-#321), so a one-shot
    // read of `aria-expanded` races the commit.
    await expect
      .poll(() =>
        groupRowLabelled(container, "Tech").getAttribute("aria-expanded"),
      )
      .toBe("false");

    // Type-to-replace has no value to seed from on a group row either — sent
    // at the CURRENT group cell, re-queried: the collapse settle above may
    // have re-rendered the row, and a keyDown at a detached node proves
    // nothing.
    const collapsedGroupCell = groupRowLabelled(
      container,
      "Tech",
    ).querySelector("[data-pretable-group-cell]");
    if (collapsedGroupCell === null) throw new Error("Expected a group cell");
    fireEvent.keyDown(collapsedGroupCell, { key: "a" });
    expect(openEditor(container)).toBeNull();
    expect(grid.getState().editing).toBeNull();
  });

  it("cancels an in-flight edit when grouping hides that very column", async () => {
    const { container, grid } = await setupGrouped();
    const cell = cellOf(container, "r1", "sector");
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(grid.getState().editing).not.toBeNull();

    await groupBySector(grid, container);

    // `sector` stops being drawn the moment it becomes the grouping key. An
    // edit left open on an undrawn column is invisible but still live: it would
    // swallow keystrokes and could commit a value the user cannot see.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await expect.poll(() => grid.getState().editing).toBeNull();
  });

  it("cancels the edit, and drops the draft, when the row's group collapses", async () => {
    const { container, grid, onRowChange } = await setupGrouped();
    await groupBySector(grid, container);
    const cell = cellOf(container, "r1", "name");
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "draft-never-committed" },
    });

    const twisty = twistyOf(groupRowLabelled(container, "Tech"));
    expect(twisty.getAttribute("aria-label")).toContain("Tech");
    fireEvent.click(twisty);

    // Collapsing removes the edited row from the view. Editing state must go
    // with it: a live edit on an unrendered row has no editor to cancel it.
    await expect
      .poll(() => container.querySelector('[data-pretable-row-id="r1"]'))
      .toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await expect.poll(() => grid.getState().editing).toBeNull();

    // Re-expanding restores the ROW, not the abandoned draft — the edit was
    // cancelled, so nothing was ever handed to the consumer.
    fireEvent.click(twistyOf(groupRowLabelled(container, "Tech")));
    await expect
      .poll(() => container.querySelector('[data-pretable-row-id="r1"]'))
      .not.toBeNull();
    expect(cellOf(container, "r1", "name")).toHaveTextContent("alpha");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onRowChange).not.toHaveBeenCalled();
  });

  it("settles a commit that re-paths the edited row into a collapsed group", async () => {
    // `sector` has to stay drawn to be edited, so grouping keeps it visible.
    const { container, grid } = await setupGrouped({
      hideGroupedColumns: false,
    });
    await groupBySector(grid, container);
    fireEvent.click(twistyOf(groupRowLabelled(container, "Energy")));
    await expect
      .poll(() => container.querySelector('[data-pretable-row-id="r3"]'))
      .toBeNull();

    const cell = cellOf(container, "r1", "sector");
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Energy" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    // The commit moves r1 under a COLLAPSED group, so the row the editor was
    // attached to disappears in the same tick the write-back lands. The
    // uncontrolled close path watches `rows` for the change, and must not need
    // the row to still be rendered to notice it.
    await expect.poll(() => grid.getState().editing).toBeNull();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(container.querySelector('[data-pretable-row-id="r1"]')).toBeNull();

    // Focus cannot stay on a row that is no longer visible; it re-seats to the
    // nearest ancestor that is.
    expect(grid.getState().focus.ref).toEqual({
      kind: "group",
      groupId: "__group__:sector=s:Energy",
    });

    // Nothing is left stuck: an unrelated row still edits normally afterwards.
    const next = cellOf(container, "r2", "name");
    fireEvent.click(next);
    fireEvent.keyDown(next, { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
