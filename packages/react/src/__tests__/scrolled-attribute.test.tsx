import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * `data-pretable-scrolled` is the hook the house theme's header seam keys on:
 * present at scrollTop > 0, absent at 0. It is a DOM contract like
 * `data-pretable-hydrated`, so it is pinned here on the real element rather
 * than inferred from a snapshot field.
 */

type Row = { id: string; name: string };
const ROWS: Row[] = Array.from({ length: 200 }, (_, i) => ({
  id: `r${i}`,
  name: `Row ${i}`,
}));
const COLUMNS = [{ id: "name", header: "Name", widthPx: 160 }];
const getRowId = (row: Row) => row.id;

afterEach(cleanup);

function viewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  );
  if (el === null) throw new Error("no viewport");
  return el;
}

/**
 * jsdom's own `scrollTop` accessor is pinned at 0 and swallows writes, so the
 * test would otherwise dispatch a scroll event on a viewport that still reads
 * 0. Same recording-accessor trick as focus-scroll.test.tsx.
 */
function makeScrollTopWritable(el: HTMLElement) {
  let scrollTop = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (next: number) => {
      scrollTop = next;
    },
  });
}

describe("data-pretable-scrolled", () => {
  it("is absent at rest, present after a scroll, and absent again at zero", () => {
    const { container } = render(
      <PretableSurface<Row>
        ariaLabel="Scrolled"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={getRowId}
        viewportHeight={240}
      />,
    );
    const el = viewport(container);
    makeScrollTopWritable(el);
    expect(el).not.toHaveAttribute("data-pretable-scrolled");

    act(() => {
      el.scrollTop = 120;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(el).toHaveAttribute("data-pretable-scrolled", "");

    act(() => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(el).not.toHaveAttribute("data-pretable-scrolled");
  });
});
