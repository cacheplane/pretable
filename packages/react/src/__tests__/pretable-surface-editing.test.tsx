import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
