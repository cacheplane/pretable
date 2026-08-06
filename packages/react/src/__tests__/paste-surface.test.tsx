import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PastePayload } from "../paste";
import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceState } from "../use-pretable";
import type { PretableColumn } from "../types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  note: string;
  locked: string;
  qty: number;
}

const ROWS: Row[] = [
  { id: "r1", name: "Ada", note: "n1", locked: "L1", qty: 1 },
  { id: "r2", name: "Linus", note: "n2", locked: "L2", qty: 2 },
  { id: "r3", name: "Grace", note: "n3", locked: "L3", qty: 3 },
];

// Column order matters for the geometry assertions: name, note, locked, qty.
const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", editable: true },
  { id: "note", header: "Note", editable: true },
  { id: "locked", header: "Locked", editable: false },
  { id: "qty", header: "Qty", type: "number", editable: true },
];

function cellSelection(rowId: string, columnId: string): PretableSurfaceState {
  return {
    focus: { rowId, columnId },
    selection: {
      ranges: [
        {
          startRowId: rowId,
          endRowId: rowId,
          startColumnId: columnId,
          endColumnId: columnId,
        },
      ],
      anchor: { rowId, columnId },
    },
  };
}

function rangeSelection(
  startRowId: string,
  endRowId: string,
  startColumnId: string,
  endColumnId: string,
): PretableSurfaceState {
  return {
    focus: { rowId: startRowId, columnId: startColumnId },
    selection: {
      ranges: [{ startRowId, endRowId, startColumnId, endColumnId }],
      anchor: { rowId: startRowId, columnId: startColumnId },
    },
  };
}

interface HarnessOpts {
  columns?: PretableColumn<Row>[];
  rows?: Row[];
  state?: PretableSurfaceState;
  onPaste?: (payload: PastePayload<Row>) => void | Promise<void>;
}

function renderPasteGrid(opts: HarnessOpts = {}) {
  return render(
    <PretableSurface<Row>
      ariaLabel="paste-grid"
      columns={opts.columns ?? COLUMNS}
      getRowId={(row) => row.id}
      onPaste={opts.onPaste}
      overscan={0}
      rows={opts.rows ?? ROWS}
      state={opts.state}
      viewportHeight={300}
    />,
  );
}

/**
 * jsdom 29 ships neither `ClipboardEvent` nor `DataTransfer`, so a paste event
 * is a plain bubbling/cancelable `Event` carrying a minimal `clipboardData`
 * stub — exactly the surface of the API the listener reads.
 */
function makePasteEvent(text: string): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  return event;
}

function firePaste(target: Element, text: string): Event {
  const event = makePasteEvent(text);
  fireEvent(target, event);
  return event;
}

function grid(): HTMLElement {
  return screen.getByRole("grid");
}

async function flush(): Promise<void> {
  // The gate resolves over a handful of microtask ticks (parse → editable →
  // validate → onPaste); a macrotask turn drains all of them.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("PretableSurface paste", () => {
  it("fires onPaste once with the anchored block's cells", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({ state: cellSelection("r1", "name"), onPaste });

    const event = firePaste(grid(), "x\ty\nz\tw");
    await flush();

    expect(onPaste).toHaveBeenCalledTimes(1);
    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(
      payload.cells.map((c) => [c.rowId, c.columnId, c.raw, c.value]),
    ).toEqual([
      ["r1", "name", "x", "x"],
      ["r1", "note", "y", "y"],
      ["r2", "name", "z", "z"],
      ["r2", "note", "w", "w"],
    ]);
    expect(payload.cells[0]!.row).toEqual(ROWS[0]);
    expect(payload.rejected).toEqual([]);
    expect(payload.source).toEqual({ rows: 2, columns: 2 });
    expect(payload.clipped).toEqual({ rows: 0, columns: 0 });
    // Handled ⇒ the browser must not also paste into the page.
    expect(event.defaultPrevented).toBe(true);
  });

  it("coerces through the column's type: a number column yields a number", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({ state: cellSelection("r1", "qty"), onPaste });

    firePaste(grid(), "42");
    await flush();

    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells).toHaveLength(1);
    expect(payload.cells[0]!.value).toBe(42);
    expect(payload.cells[0]!.raw).toBe("42");
  });

  it("prefers the column's parseEditValue and receives the edit input", async () => {
    const onPaste = vi.fn();
    const parseEditValue = vi.fn((raw: string) => Number(raw) * 10);
    renderPasteGrid({
      columns: [
        ...COLUMNS.slice(0, 3),
        {
          id: "qty",
          header: "Qty",
          type: "number",
          editable: true,
          parseEditValue,
        },
      ],
      state: cellSelection("r1", "qty"),
      onPaste,
    });

    firePaste(grid(), "4");
    await flush();

    expect(parseEditValue).toHaveBeenCalledWith(
      "4",
      expect.objectContaining({
        rowId: "r1",
        columnId: "qty",
        row: ROWS[0],
        value: 1,
      }),
    );
    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells[0]!.value).toBe(40);
  });

  it("rejects a cell whose parseEditValue throws, applying its neighbours", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({
      columns: [
        { id: "name", header: "Name", editable: true },
        {
          id: "note",
          header: "Note",
          editable: true,
          parseEditValue: (raw: string) => {
            if (raw === "boom") throw new Error("nope");
            return raw;
          },
        },
        ...COLUMNS.slice(2),
      ],
      state: cellSelection("r1", "name"),
      onPaste,
    });

    firePaste(grid(), "keep\tboom");
    await flush();

    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells.map((c) => c.columnId)).toEqual(["name"]);
    expect(payload.rejected).toEqual([
      {
        rowId: "r1",
        columnId: "note",
        raw: "boom",
        reason: "invalid",
        message: "nope",
      },
    ]);
  });

  it("rejects a non-editable column's cells while the rest apply", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({ state: cellSelection("r1", "note"), onPaste });

    firePaste(grid(), "N\tL");
    await flush();

    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells.map((c) => [c.columnId, c.value])).toEqual([
      ["note", "N"],
    ]);
    expect(payload.rejected).toEqual([
      {
        rowId: "r1",
        columnId: "locked",
        raw: "L",
        reason: "not-editable",
      },
    ]);
  });

  it("gates on editable BEFORE coercing, so a read-only column never reports a parse complaint", async () => {
    const onPaste = vi.fn();
    const parseEditValue = vi.fn((raw: string) => raw);
    renderPasteGrid({
      columns: [
        { id: "name", header: "Name", editable: true },
        { id: "note", header: "Note", editable: false, parseEditValue },
        COLUMNS[2]!,
        // A number column nobody can write: "xyz" would fail the built-in
        // parse, but the cell is unwritable, so that is not the reason.
        { id: "qty", header: "Qty", type: "number", editable: false },
      ],
      state: cellSelection("r1", "note"),
      onPaste,
    });

    firePaste(grid(), "abc\tL\txyz");
    await flush();

    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells).toEqual([]);
    // Every reason is "not-editable", and none carries a coercion message.
    expect(payload.rejected).toEqual([
      { rowId: "r1", columnId: "note", raw: "abc", reason: "not-editable" },
      { rowId: "r1", columnId: "locked", raw: "L", reason: "not-editable" },
      { rowId: "r1", columnId: "qty", raw: "xyz", reason: "not-editable" },
    ]);
    // Coercion is skipped entirely for cells that cannot be written.
    expect(parseEditValue).not.toHaveBeenCalled();
  });

  it("contains a throwing editable or validate to the cell that threw", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({
      columns: [
        {
          id: "name",
          header: "Name",
          editable: (input) => {
            if (input.rowId === "r2") throw new Error("editable blew up");
            return true;
          },
        },
        {
          id: "note",
          header: "Note",
          editable: true,
          validate: (value: unknown) => {
            if (value === "kaboom") throw new Error("validate blew up");
            return true;
          },
        },
        ...COLUMNS.slice(2),
      ],
      state: cellSelection("r1", "name"),
      onPaste,
    });

    firePaste(grid(), "ok\tkaboom\nboom\tfine");
    await flush();

    // One flaky predicate costs its own cell, not the whole paste.
    expect(onPaste).toHaveBeenCalledTimes(1);
    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells.map((c) => [c.rowId, c.columnId, c.value])).toEqual([
      ["r1", "name", "ok"],
      ["r2", "note", "fine"],
    ]);
    expect(payload.rejected).toEqual([
      {
        rowId: "r1",
        columnId: "note",
        raw: "kaboom",
        reason: "invalid",
        message: "validate blew up",
      },
      {
        rowId: "r2",
        columnId: "name",
        raw: "boom",
        reason: "invalid",
        message: "editable blew up",
      },
    ]);
  });

  it("rejects a cell whose validate returns a message, applying the rest", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({
      columns: [
        { id: "name", header: "Name", editable: true },
        {
          id: "note",
          header: "Note",
          editable: true,
          validate: (value: unknown) =>
            value === "bad" ? "no bad values" : true,
        },
        ...COLUMNS.slice(2),
      ],
      state: cellSelection("r1", "note"),
      onPaste,
    });

    firePaste(grid(), "bad\ngood");
    await flush();

    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells.map((c) => [c.rowId, c.value])).toEqual([
      ["r2", "good"],
    ]);
    expect(payload.rejected).toEqual([
      {
        rowId: "r1",
        columnId: "note",
        raw: "bad",
        reason: "invalid",
        message: "no bad values",
      },
    ]);
  });

  it("awaits async editable and async validate", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({
      columns: [
        {
          id: "name",
          header: "Name",
          // Async predicate: must be awaited, never truthiness-tested.
          editable: async (input) => Promise.resolve(input.rowId !== "r2"),
          validate: async (value: unknown) =>
            Promise.resolve(value === "no" ? "async says no" : true),
        },
        ...COLUMNS.slice(1),
      ],
      state: cellSelection("r1", "name"),
      onPaste,
    });

    firePaste(grid(), "yes\nblocked\nno");
    await flush();

    expect(onPaste).toHaveBeenCalledTimes(1);
    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells.map((c) => [c.rowId, c.value])).toEqual([
      ["r1", "yes"],
    ]);
    expect(payload.rejected).toEqual([
      { rowId: "r2", columnId: "name", raw: "blocked", reason: "not-editable" },
      {
        rowId: "r3",
        columnId: "name",
        raw: "no",
        reason: "invalid",
        message: "async says no",
      },
    ]);
  });

  it("tiles the block across an exact-multiple selection", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({
      // Two selected rows, one column; a one-row block repeats down it.
      state: rangeSelection("r1", "r2", "name", "name"),
      onPaste,
    });

    firePaste(grid(), "tile");
    await flush();

    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    expect(payload.cells.map((c) => [c.rowId, c.columnId, c.value])).toEqual([
      ["r1", "name", "tile"],
      ["r2", "name", "tile"],
    ]);
  });

  it("reports clipped rows and columns when the block overflows", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({ state: cellSelection("r3", "qty"), onPaste });

    firePaste(grid(), "1\t2\n3\t4\n5\t6");
    await flush();

    const payload = onPaste.mock.calls[0]![0] as PastePayload<Row>;
    // Anchored at the last row and last column: 1 cell lands, 2 rows and 1
    // column fall off the edges.
    expect(payload.cells.map((c) => [c.rowId, c.columnId, c.value])).toEqual([
      ["r3", "qty", 1],
    ]);
    expect(payload.clipped).toEqual({ rows: 2, columns: 1 });
    expect(payload.source).toEqual({ rows: 3, columns: 2 });
  });

  it("is inert without an onPaste prop", async () => {
    renderPasteGrid({ state: cellSelection("r1", "name") });

    const event = firePaste(grid(), "x\ty");
    await flush();

    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores empty clipboard text", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({ state: cellSelection("r1", "name"), onPaste });

    const event = firePaste(grid(), "");
    await flush();

    expect(onPaste).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores a paste with nothing selected or focused", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({ onPaste });

    const event = firePaste(grid(), "x");
    await flush();

    expect(onPaste).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("ignores a paste while a cell editor input is focused", async () => {
    const onPaste = vi.fn();
    renderPasteGrid({ state: cellSelection("r1", "name"), onPaste });

    const cell = within(screen.getAllByRole("row")[1]!).getAllByRole(
      "gridcell",
    )[0]!;
    fireEvent.keyDown(cell, { key: "Enter" });
    const input = screen.getByRole("textbox");
    expect(document.activeElement).toBe(input);

    // The editor owns its own paste — both when the event targets the input
    // and when it targets the grid root while the input holds focus.
    firePaste(input, "hijack");
    firePaste(grid(), "hijack");
    await flush();

    expect(onPaste).not.toHaveBeenCalled();
  });

  it("does not cross-fire between two grids on the page", async () => {
    const onPasteA = vi.fn();
    const onPasteB = vi.fn();
    render(
      <>
        <PretableSurface<Row>
          ariaLabel="grid-a"
          columns={COLUMNS}
          getRowId={(row) => row.id}
          onPaste={onPasteA}
          rows={ROWS}
          state={cellSelection("r1", "name")}
          viewportHeight={300}
        />
        <PretableSurface<Row>
          ariaLabel="grid-b"
          columns={COLUMNS}
          getRowId={(row) => row.id}
          onPaste={onPasteB}
          rows={ROWS}
          state={cellSelection("r1", "name")}
          viewportHeight={300}
        />
      </>,
    );

    firePaste(screen.getByRole("grid", { name: "grid-a" }), "only-a");
    await flush();

    expect(onPasteA).toHaveBeenCalledTimes(1);
    expect(onPasteB).not.toHaveBeenCalled();
  });

  it("discards a stale gate when a second paste starts mid-flight", async () => {
    const onPaste = vi.fn();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let call = 0;
    renderPasteGrid({
      columns: [
        {
          id: "name",
          header: "Name",
          editable: true,
          validate: async (): Promise<true> => {
            call += 1;
            if (call === 1) await gate;
            return true;
          },
        },
        ...COLUMNS.slice(1),
      ],
      state: cellSelection("r1", "name"),
      onPaste,
    });

    firePaste(grid(), "first");
    await flush();
    firePaste(grid(), "second");
    await flush();
    release!();
    await flush();

    expect(onPaste).toHaveBeenCalledTimes(1);
    expect(
      (onPaste.mock.calls[0]![0] as PastePayload<Row>).cells[0]!.value,
    ).toBe("second");
  });
});
