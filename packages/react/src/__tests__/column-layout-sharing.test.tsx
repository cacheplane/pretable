import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { PretableGrid } from "@pretable/core";

// ---------------------------------------------------------------------------
// One plan, two consumers.
//
// Scroll-into-view and drag-to-reorder both need every column laid out,
// including the ones the virtualization window dropped. They used to derive
// that layout separately — `planColumnLayout` for the drag, a hand-built
// `planColumns` input for the scroll — and the two agreed only by coincidence.
// PR #203 is what that coincidence costs when it lapses.
//
// The fix is not "assert the two agree", which would still let a third caller
// roll its own: it is that there is only one plan object. So this test asserts
// reference identity, the one property no amount of drift can satisfy. It
// fails the moment either consumer builds its own plan, even a correct one.
//
// Both call sites are intercepted with pass-through spies rather than stubs,
// so the surface still behaves normally underneath.
// ---------------------------------------------------------------------------

const captured = vi.hoisted(() => ({
  scrollPlans: [] as { columns: readonly { id: string }[] }[],
  dragLayouts: [] as (readonly { id: string }[])[],
}));

vi.mock("@pretable-internal/renderer-dom", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@pretable-internal/renderer-dom")>();

  return {
    ...actual,
    scrollLeftToReveal: (
      input: Parameters<typeof actual.scrollLeftToReveal>[0],
    ) => {
      captured.scrollPlans.push(input.plan);
      return actual.scrollLeftToReveal(input);
    },
  };
});

vi.mock("../column-drag-geometry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../column-drag-geometry")>();

  return {
    ...actual,
    computeColumnDropTarget: (
      input: Parameters<typeof actual.computeColumnDropTarget>[0],
    ) => {
      captured.dragLayouts.push(input.layout);
      return actual.computeColumnDropTarget(input);
    },
  };
});

// Imported after the `vi.mock` calls only for readability — vitest hoists them
// above every import in this file regardless.
import { PretableSurface } from "../pretable-surface";

const VIEWPORT_WIDTH = 300;
let clientWidth = VIEWPORT_WIDTH;
let originalClientWidth: PropertyDescriptor | undefined;
let originalScrollLeft: PropertyDescriptor | undefined;

beforeEach(() => {
  captured.scrollPlans.length = 0;
  captured.dragLayouts.length = 0;
  clientWidth = VIEWPORT_WIDTH;
  originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  originalScrollLeft = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollLeft",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => clientWidth,
  });
  let scrollLeft = 0;
  Object.defineProperty(Element.prototype, "scrollLeft", {
    configurable: true,
    get: () => scrollLeft,
    set: (next: number) => {
      scrollLeft = next;
    },
  });
});

afterEach(() => {
  cleanup();
  if (originalClientWidth) {
    Object.defineProperty(
      HTMLElement.prototype,
      "clientWidth",
      originalClientWidth,
    );
  }
  if (originalScrollLeft) {
    Object.defineProperty(Element.prototype, "scrollLeft", originalScrollLeft);
  }
});

type Row = { id: string; pin: string; b: string; c: string; far: string };

// 700px of content in a 300px scrollport, so "far" is outside the window and
// reaching it needs a horizontal scroll — the case both consumers exist for.
const columns = [
  { id: "pin", header: "Pin", widthPx: 100, pinned: "left" as const },
  { id: "b", header: "B", widthPx: 200 },
  { id: "c", header: "C", widthPx: 200 },
  { id: "far", header: "Far", widthPx: 200 },
];

const rows: Row[] = [{ id: "r1", pin: "p", b: "b", c: "c", far: "f" }];

it("hands scroll-into-view and reorder hit-testing the same column plan", () => {
  let grid!: PretableGrid<Row>;
  const view = render(
    <PretableSurface<Row>
      ariaLabel="shared-plan-grid"
      columns={columns}
      getRowId={(row) => row.id}
      onGridReady={(g) => {
        grid = g as PretableGrid<Row>;
      }}
      overscan={0}
      rows={rows}
      viewportHeight={200}
    />,
  );

  // Consumer 1: focus a column outside the window, which runs the horizontal
  // reveal. (That it scrolls at all is covered in focus-scroll.test.tsx; here
  // it just has to run.)
  act(() => {
    grid.setFocus({ rowId: "r1", columnId: "far" });
  });

  // Consumer 2: start a reorder drag, which hit-tests the cursor.
  const header = view.getByLabelText("Sort B") as HTMLButtonElement;
  fireEvent.pointerDown(header, {
    button: 0,
    pointerId: 1,
    clientX: 0,
    clientY: 10,
  });
  fireEvent.pointerMove(header, { pointerId: 1, clientX: 250, clientY: 10 });
  fireEvent.pointerUp(header, { pointerId: 1, clientX: 250, clientY: 10 });

  const scrollPlan = captured.scrollPlans.at(0);
  const dragLayout = captured.dragLayouts.at(0);

  expect(scrollPlan).toBeDefined();
  expect(dragLayout).toBeDefined();

  // The assertion. Not "deep equal" — the *same array*, which is only possible
  // if a single `planColumnLayout` result feeds both.
  expect(scrollPlan?.columns).toBe(dragLayout);

  // And that shared plan is the unbounded one: every column, window or not.
  expect(dragLayout?.map((column) => column.id)).toEqual([
    "pin",
    "b",
    "c",
    "far",
  ]);
});
