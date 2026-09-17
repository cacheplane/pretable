// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { PretableSurface } from "../pretable-surface";

// ---------------------------------------------------------------------------
// A keyboard-opened header popover REVEALS its anchor before opening it.
//
// What jsdom can prove, and what it deliberately cannot:
//
// CAN — the MECHANISM. That the keyboard path calls `scrollIntoView` on the
// funnel, with the exact options the fix depends on, before the popover is
// asked to open. Those options are our own output, and every one of them is
// load-bearing: `behavior: "instant"` because a smooth scroll would still be
// in flight when the popover's layout effect measures (the docs site sets
// `html { scroll-behavior: smooth }`), and `nearest` because a header already
// on screen must not move and the grid's own scroller must not be disturbed.
//
// CANNOT — the `return false` fall-through when the anchor still is not
// placeable after the reveal. jsdom has no layout engine and reports 0x0 for
// every element; the placeability rule deliberately treats a 0x0 rect as "this
// environment cannot decide, leave it alone", so that branch is inert here by
// design. Asserting it would pin the escape hatch, not the behaviour. The
// geometry half is asserted in apps/website/e2e/grid-header-keyboard.spec.ts,
// in both engines, and only there.
// ---------------------------------------------------------------------------

type Row = { id: string; name: string; qty: string };

const rows: Row[] = [
  { id: "r0", name: "alpha", qty: "1" },
  { id: "r1", name: "beta", qty: "2" },
];

const columns = [
  { id: "name", header: "Name", widthPx: 120 },
  { id: "qty", header: "Qty", widthPx: 120 },
];

function mount() {
  return render(
    <PretableSurface<Row>
      ariaLabel="header popover reveal"
      columns={columns}
      getRowId={(row) => row.id}
      groupPanel={{ enabled: true }}
      rows={rows}
      viewportHeight={300}
    />,
  );
}

/** Put the engine's focus cursor on the first header cell. */
function focusFirstHeader(view: ReturnType<typeof render>) {
  const cell = view.container.querySelector<HTMLElement>(
    `[data-pretable-row-id="r0"] [data-pretable-column-id="name"][data-pretable-cell]`,
  )!;
  fireEvent.focus(cell);
  fireEvent.keyDown(cell, { key: "ArrowUp" });
  return view.container.querySelector<HTMLElement>(
    `[data-pretable-header-cell][data-pretable-column-id="name"]`,
  )!;
}

afterEach(cleanup);

describe("a keyboard-opened header popover reveals its anchor first", () => {
  test("Alt+ArrowDown scrolls the funnel into view before opening the filter", () => {
    const view = mount();
    const header = focusFirstHeader(view);
    const funnel = view.container.querySelector<HTMLElement>(
      `[data-pretable-filter-funnel][data-pretable-column-id="name"]`,
    )!;

    // jsdom ships no scrollIntoView at all, so there is nothing to spy on —
    // patch one in and take it back off, as components-listbox.test.tsx does.
    const calls: { target: Element; arg: unknown }[] = [];
    const real = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (this: Element, arg?: unknown) {
      calls.push({ target: this, arg });
    };

    try {
      fireEvent.keyDown(header, { key: "ArrowDown", altKey: true });
    } finally {
      Element.prototype.scrollIntoView = real;
    }

    const revealed = calls.filter((c) => c.target === funnel);
    expect(revealed.length).toBe(1);
    expect(revealed[0]!.arg).toEqual({
      block: "nearest",
      inline: "nearest",
      behavior: "instant",
    });
  });

  test("Alt+ArrowDown still opens the filter popover", () => {
    // The positive twin: a reveal that forgot to open anything would satisfy
    // the assertion above on its own.
    const view = mount();
    const header = focusFirstHeader(view);

    fireEvent.keyDown(header, { key: "ArrowDown", altKey: true });

    expect(screen.queryByRole("dialog", { name: /Filter/ })).not.toBeNull();
  });

  test("Shift+F10 still opens the column menu", () => {
    const view = mount();
    const header = focusFirstHeader(view);

    fireEvent.keyDown(header, { key: "F10", shiftKey: true });

    expect(screen.queryByRole("menu")).not.toBeNull();
  });
});
