// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableSurfaceFocusState } from "../surface-types";

// ---------------------------------------------------------------------------
// `Cmd/Ctrl + Arrow` — "jump focus to grid edge in arrow direction".
//
// The four directions have to disagree with each other for this to prove
// anything, so the fixture is deliberately NOT square-symmetric about the
// starting cell: three rows, three columns, cursor in the dead centre. Every
// correct answer differs from every incorrect one in BOTH coordinates, which
// is what makes the vertical/horizontal confusion visible rather than a
// coincidence of a 1x1 grid.
//
// jsdom is the right environment: the movement is entirely our own keydown
// handler writing an engine address, and `onFocusChange` reports that address.
// No browser layout, scrolling or focus order is involved.
// ---------------------------------------------------------------------------

type Row = { id: string; a: string; b: string; c: string };

const rows: Row[] = [
  { id: "r0", a: "a0", b: "b0", c: "c0" },
  { id: "r1", a: "a1", b: "b1", c: "c1" },
  { id: "r2", a: "a2", b: "b2", c: "c2" },
];

const columns = [
  { id: "a", header: "A", widthPx: 100 },
  { id: "b", header: "B", widthPx: 100 },
  { id: "c", header: "C", widthPx: 100 },
];

function mount(
  onFocusChange: (next: PretableSurfaceFocusState<string>) => void,
) {
  return render(
    <PretableSurface<Row>
      ariaLabel="jump to edge"
      columns={columns}
      getRowId={(row) => row.id}
      rows={rows}
      viewportHeight={300}
      onFocusChange={onFocusChange}
    />,
  );
}

const cell = (
  view: ReturnType<typeof render>,
  rowId: string,
  columnId: string,
) =>
  view.container.querySelector<HTMLElement>(
    `[data-pretable-row-id="${rowId}"] [data-pretable-column-id="${columnId}"][data-pretable-cell]`,
  )!;

const headerCell = (view: ReturnType<typeof render>, columnId: string) =>
  view.container.querySelector<HTMLElement>(
    `[data-pretable-header-cell][data-pretable-column-id="${columnId}"]`,
  )!;

/** Put the cursor on the centre cell and hand back the recorded addresses. */
function startAtCentre() {
  const changes: PretableSurfaceFocusState<string>[] = [];
  const view = mount((next) => changes.push(next));
  const centre = cell(view, "r1", "b");
  fireEvent.focus(centre);
  fireEvent.click(centre);
  expect(changes.at(-1)).toEqual({
    ref: { kind: "data", rowId: "r1" },
    columnId: "b",
  });
  return { view, changes, centre };
}

afterEach(cleanup);

describe("Cmd/Ctrl + Arrow jumps to the edge in the ARROW's direction", () => {
  test("Cmd+ArrowLeft goes to the first COLUMN, staying on the same row", () => {
    const { changes, centre } = startAtCentre();

    fireEvent.keyDown(centre, { key: "ArrowLeft", metaKey: true });

    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "a",
    });
  });

  test("Cmd+ArrowRight goes to the last COLUMN, staying on the same row", () => {
    const { changes, centre } = startAtCentre();

    fireEvent.keyDown(centre, { key: "ArrowRight", metaKey: true });

    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "c",
    });
  });

  test("Cmd+ArrowUp goes to the first ROW, staying in the same column", () => {
    const { changes, centre } = startAtCentre();

    fireEvent.keyDown(centre, { key: "ArrowUp", metaKey: true });

    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r0" },
      columnId: "b",
    });
  });

  test("Cmd+ArrowDown goes to the last ROW, staying in the same column", () => {
    const { changes, centre } = startAtCentre();

    fireEvent.keyDown(centre, { key: "ArrowDown", metaKey: true });

    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r2" },
      columnId: "b",
    });
  });

  test("Ctrl is the same modifier as Cmd", () => {
    const { changes, centre } = startAtCentre();

    fireEvent.keyDown(centre, { key: "ArrowLeft", ctrlKey: true });

    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "a",
    });
  });

  // The positive twin of the four above. Without it, a "fix" that mapped every
  // ArrowLeft to the first column — modifier or not — would pass all of them.
  test("a bare Arrow still moves exactly one cell, not to an edge", () => {
    const { view, changes, centre } = startAtCentre();

    fireEvent.keyDown(centre, { key: "ArrowRight" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "c",
    });

    // From column `c` a bare ArrowLeft lands back on `b` — the neighbour. The
    // edge answer would be `a`, so this discriminates.
    fireEvent.keyDown(cell(view, "r1", "c"), { key: "ArrowLeft" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "b",
    });

    // Same for the vertical axis: r1 -> r0 is one step, and r0 is also the
    // top EDGE, so step down first to make the two answers differ.
    fireEvent.keyDown(cell(view, "r1", "b"), { key: "ArrowDown" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r2" },
      columnId: "b",
    });
    fireEvent.keyDown(cell(view, "r2", "b"), { key: "ArrowUp" });
    expect(changes.at(-1)).toEqual({
      ref: { kind: "data", rowId: "r1" },
      columnId: "b",
    });
  });
});

describe("the header's own edge keys are unchanged", () => {
  test("Home / End on a header cell move by COLUMN", () => {
    const changes: PretableSurfaceFocusState<string>[] = [];
    const view = mount((next) => changes.push(next));

    const centre = cell(view, "r0", "b");
    fireEvent.focus(centre);
    fireEvent.click(centre);
    fireEvent.keyDown(centre, { key: "ArrowUp" });
    expect(changes.at(-1)).toEqual({ ref: { kind: "header" }, columnId: "b" });

    fireEvent.keyDown(headerCell(view, "b"), { key: "Home" });
    expect(changes.at(-1)).toEqual({ ref: { kind: "header" }, columnId: "a" });

    fireEvent.keyDown(headerCell(view, "a"), { key: "End" });
    expect(changes.at(-1)).toEqual({ ref: { kind: "header" }, columnId: "c" });
  });

  test("Cmd+Arrow on a header cell stays on the header for the horizontal axis", () => {
    const changes: PretableSurfaceFocusState<string>[] = [];
    const view = mount((next) => changes.push(next));

    const centre = cell(view, "r0", "b");
    fireEvent.focus(centre);
    fireEvent.click(centre);
    fireEvent.keyDown(centre, { key: "ArrowUp" });
    expect(changes.at(-1)).toEqual({ ref: { kind: "header" }, columnId: "b" });

    fireEvent.keyDown(headerCell(view, "b"), {
      key: "ArrowLeft",
      metaKey: true,
    });
    expect(changes.at(-1)).toEqual({ ref: { kind: "header" }, columnId: "a" });

    fireEvent.keyDown(headerCell(view, "a"), {
      key: "ArrowRight",
      metaKey: true,
    });
    expect(changes.at(-1)).toEqual({ ref: { kind: "header" }, columnId: "c" });
  });
});
