import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";
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

  it("does not leak typing provenance through a batched public cancel and begin", () => {
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
        onGridReady={(grid) => (publicGrid = grid)}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });

    act(() => {
      publicGrid.cancelEdit();
      publicGrid.beginEdit({ rowId: "r1", columnId: "name", value: "Ada" });
    });

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(3);
  });

  it("does not leak typing provenance through direct edit replacement", () => {
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
        onGridReady={(grid) => (publicGrid = grid)}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });

    act(() => {
      publicGrid.beginEdit({
        rowId: "r1",
        columnId: "name",
        value: "Ada",
      });
    });

    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(3);
  });

  it("preserves a typing session through an immediately resolved editable gate", async () => {
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: () => Promise.resolve(true),
          },
        ]}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });
    await flush();
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box).toHaveValue("a");
    expect(box.selectionStart).toBe(1);
    expect(box.selectionEnd).toBe(1);
  });

  it("commits a typed date replacement through a custom parser on blur", async () => {
    const parseEditValue = vi.fn((draft: string) => `parsed:${draft}`);
    const onRowChange = vi.fn();
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Date",
            type: "date",
            editable: true,
            parseEditValue,
          },
        ]}
        rows={[{ id: "r1", name: "2026-08-06" }]}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={onRowChange}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "x" });
    const box = screen.getByRole("textbox");
    expect(box).toHaveValue("x");

    fireEvent.blur(box);
    await flush();

    expect(parseEditValue).toHaveBeenCalledWith("x", expect.any(Object));
    expect(onRowChange).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "parsed:x",
      }),
    );
  });

  it("keeps a public replacement open when a stale editable gate resolves false", async () => {
    let allow!: (value: boolean) => void;
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: () =>
              new Promise<boolean>((resolve) => (allow = resolve)),
          },
        ]}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
        onGridReady={(grid) => (publicGrid = grid)}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });
    expect(cell).toHaveAttribute("data-pretable-edit-status", "checking");

    act(() => {
      publicGrid.beginEdit({
        rowId: "r1",
        columnId: "name",
        value: "replacement",
      });
    });
    allow(false);
    await flush();

    expect(screen.getByRole("textbox")).toHaveValue("replacement");
  });

  it("drops stale validation after a public edit replacement", async () => {
    let finishValidation!: (value: true) => void;
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    const onRowChange = vi.fn();
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: true,
            validate: () =>
              new Promise<true>((resolve) => (finishValidation = resolve)),
          },
        ]}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={onRowChange}
        onGridReady={(grid) => (publicGrid = grid)}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "first edit" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    act(() => {
      publicGrid.beginEdit({
        rowId: "r1",
        columnId: "name",
        value: "replacement",
      });
    });
    finishValidation(true);
    await flush();

    expect(onRowChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("replacement");
  });

  it("drops an old editable result after its controller is replaced", async () => {
    let allow!: (value: boolean) => void;
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    const firstColumns: PretableColumn<Row>[] = [
      {
        id: "name",
        header: "Name",
        editable: () => new Promise<boolean>((resolve) => (allow = resolve)),
      },
    ];
    const replacementColumns: PretableColumn<Row>[] = [
      { id: "name", header: "Replacement name", editable: true },
    ];
    const surface = (columns: PretableColumn<Row>[]) => (
      <PretableSurface<Row>
        ariaLabel="people"
        columns={columns}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
        onGridReady={(grid) => (publicGrid = grid)}
      />
    );
    const view = render(surface(firstColumns));
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(cell).toHaveAttribute("data-pretable-edit-status", "checking");

    view.rerender(surface(replacementColumns));
    act(() => {
      publicGrid.beginEdit({
        rowId: "r1",
        columnId: "name",
        value: "replacement",
      });
    });
    allow(false);
    await flush();

    expect(screen.getByRole("textbox")).toHaveValue("replacement");
  });

  it("closes orphaned checking state when its controller is replaced", async () => {
    let allow!: (value: boolean) => void;
    const onRowChange = vi.fn();
    const firstColumns: PretableColumn<Row>[] = [
      {
        id: "name",
        header: "Name",
        editable: () => new Promise<boolean>((resolve) => (allow = resolve)),
      },
    ];
    const surface = (columns: PretableColumn<Row>[]) => (
      <PretableSurface<Row>
        ariaLabel="people"
        columns={columns}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={onRowChange}
      />
    );
    const view = render(surface(firstColumns));
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(cell).toHaveAttribute("data-pretable-edit-status", "checking");

    view.rerender(
      surface([{ id: "name", header: "Replacement name", editable: true }]),
    );

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    allow(true);
    await flush();
    expect(onRowChange).not.toHaveBeenCalled();
    expect(firstNameCell()).not.toHaveAttribute("data-pretable-edit-status");
  });

  it("does not continue validation after its controller is replaced", async () => {
    let finishValidation!: (value: true) => void;
    const onRowChange = vi.fn();
    const firstColumns: PretableColumn<Row>[] = [
      {
        id: "name",
        header: "Name",
        editable: true,
        validate: () =>
          new Promise<true>((resolve) => (finishValidation = resolve)),
      },
    ];
    const surface = (columns: PretableColumn<Row>[]) => (
      <PretableSurface<Row>
        ariaLabel="people"
        columns={columns}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={onRowChange}
      />
    );
    const view = render(surface(firstColumns));
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "stale validation" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    view.rerender(
      surface([{ id: "name", header: "Replacement name", editable: true }]),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    finishValidation(true);
    await flush();

    expect(onRowChange).not.toHaveBeenCalled();
    expect(firstNameCell()).not.toHaveAttribute("data-pretable-edit-status");
  });

  it("closes orphaned saving state when its controller is replaced", async () => {
    let rejectSave!: (error: Error) => void;
    const onRowChange = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const surface = (header: string) => (
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[{ id: "name", header, editable: true }]}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={onRowChange}
      />
    );
    const view = render(surface("Name"));
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "stale save" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onRowChange).toHaveBeenCalledOnce();

    view.rerender(surface("Replacement name"));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    rejectSave(new Error("stale save failed"));
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(firstNameCell()).not.toHaveAttribute("data-pretable-edit-status");
  });

  it("preserves a nonpending edit when its controller is replaced", () => {
    const surface = (header: string) => (
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[{ id: "name", header, editable: true }]}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={vi.fn()}
      />
    );
    const view = render(surface("Name"));
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "in progress" },
    });

    view.rerender(surface("Replacement name"));

    expect(screen.getByRole("textbox")).toHaveValue("in progress");
    expect(firstNameCell()).toHaveAttribute(
      "data-pretable-edit-status",
      "editing",
    );
  });

  it("does not let an old save rejection mark a replacement edit", async () => {
    let rejectSave!: (error: Error) => void;
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    const onRowChange = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const surface = (header: string) => (
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[{ id: "name", header, editable: true }]}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={onRowChange}
        onGridReady={(grid) => (publicGrid = grid)}
      />
    );
    const view = render(surface("Name"));
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "stale save" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onRowChange).toHaveBeenCalledOnce();

    view.rerender(surface("Replacement name"));
    act(() => {
      publicGrid.beginEdit({
        rowId: "r1",
        columnId: "name",
        value: "replacement",
      });
    });
    rejectSave(new Error("stale save failed"));
    await flush();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("replacement");
  });

  it("does not continue validation after unmount", async () => {
    let finishValidation!: (value: true) => void;
    const onRowChange = vi.fn();
    const view = render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[
          {
            id: "name",
            header: "Name",
            editable: true,
            validate: () =>
              new Promise<true>((resolve) => (finishValidation = resolve)),
          },
        ]}
        rows={ROWS}
        getRowId={(row) => row.id}
        viewportHeight={300}
        onRowChange={onRowChange}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "stale validation" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    view.unmount();
    finishValidation(true);
    await flush();

    expect(onRowChange).not.toHaveBeenCalled();
  });

  it("clears typing tokens when controlled-row reconciliation closes the edit", async () => {
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    function Harness() {
      const [rows, setRows] = useState(ROWS);
      return (
        <PretableSurface<Row>
          ariaLabel="people"
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={300}
          onGridReady={(grid) => (publicGrid = grid)}
          onRowChange={(change) => {
            setRows((current) =>
              current.map((row) =>
                row.id === change.rowId ? { ...row, ...change.changes } : row,
              ),
            );
          }}
        />
      );
    }
    render(<Harness />);
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flush();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    act(() => {
      publicGrid.beginEdit({ rowId: "r1", columnId: "name", value: "a" });
    });
    const box = screen.getByRole("textbox") as HTMLInputElement;
    expect(box.selectionStart).toBe(0);
    expect(box.selectionEnd).toBe(1);
  });

  it("does not let delayed reconciliation for an old edit close its replacement", async () => {
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    let applyPendingChange!: () => void;
    let pendingChange: { rowId: string; changes: Partial<Row> } | null = null;
    function Harness() {
      const [rows, setRows] = useState(ROWS);
      applyPendingChange = () => {
        const change = pendingChange;
        if (change === null) return;
        setRows((current) =>
          current.map((row) =>
            row.id === change.rowId ? { ...row, ...change.changes } : row,
          ),
        );
      };
      return (
        <PretableSurface<Row>
          ariaLabel="people"
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={300}
          onGridReady={(grid) => (publicGrid = grid)}
          onRowChange={(change) => {
            pendingChange = change;
          }}
        />
      );
    }
    render(<Harness />);
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flush();

    act(() => {
      publicGrid.beginEdit({
        rowId: "r1",
        columnId: "name",
        value: "replacement",
      });
    });
    act(() => applyPendingChange());

    expect(screen.getByRole("textbox")).toHaveValue("replacement");
  });

  it("does not let an old rejected row change erase replacement reconciliation", async () => {
    let publicGrid!: PretableSurfaceGrid<
      Row,
      string,
      readonly PretableColumn<Row>[]
    >;
    let rejectFirstChange!: (error: Error) => void;
    let applyReplacementChange!: () => void;
    let replacementChange: {
      rowId: string;
      changes: Partial<Row>;
    } | null = null;
    let changeCount = 0;
    function Harness() {
      const [rows, setRows] = useState(ROWS);
      applyReplacementChange = () => {
        const change = replacementChange;
        if (change === null) return;
        setRows((current) =>
          current.map((row) =>
            row.id === change.rowId ? { ...row, ...change.changes } : row,
          ),
        );
      };
      return (
        <PretableSurface<Row>
          ariaLabel="people"
          columns={COLUMNS}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={300}
          onGridReady={(grid) => (publicGrid = grid)}
          onRowChange={(change) => {
            changeCount += 1;
            if (changeCount === 1) {
              return new Promise<void>((_resolve, reject) => {
                rejectFirstChange = reject;
              });
            }
            replacementChange = change;
          }}
        />
      );
    }
    render(<Harness />);
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "a" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });

    act(() => {
      publicGrid.beginEdit({
        rowId: "r1",
        columnId: "name",
        value: "replacement",
      });
    });
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "replacement committed" },
    });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await flush();

    rejectFirstChange(new Error("old change rejected"));
    await flush();
    act(() => applyReplacementChange());

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
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
