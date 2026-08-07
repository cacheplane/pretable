import "@testing-library/jest-dom/vitest";
import { cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * Without `flex` a grid's columns are all fixed, so a row either stops short of
 * the container's right edge or runs past it. The consumer's only recourse was
 * to hand-tune `widthPx` for one target width.
 */

type DemoRow = {
  id: string;
  name: string;
  note: string;
};

const rows: DemoRow[] = [{ id: "a", name: "Zulu", note: "hello" }];

function widthsOf(container: HTMLElement): Record<string, number> {
  const widths: Record<string, number> = {};
  for (const cell of container.querySelectorAll(
    "[data-pretable-header-cell]",
  )) {
    const id = cell.getAttribute("aria-label")?.replace("Sort ", "") ?? "";
    widths[id] = Number.parseFloat(
      (cell as HTMLElement).style.width.replace("px", ""),
    );
  }
  return widths;
}

/** The surface reads its own width off the scrollport, which jsdom reports as
 *  0 — so pin it the way a real layout would. */
function withViewportWidth(px: number) {
  const original = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth",
  );
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get() {
      return this.hasAttribute("data-pretable-scroll-viewport") ? px : 0;
    },
  });
  return () => {
    if (original)
      Object.defineProperty(HTMLElement.prototype, "clientWidth", original);
  };
}

afterEach(cleanup);

describe("flex columns", () => {
  it("hands the leftover width to the flex column", () => {
    const restore = withViewportWidth(1000);
    try {
      const { container } = render(
        <PretableSurface<DemoRow>
          ariaLabel="Demo"
          columns={[
            { id: "name", header: "name", widthPx: 200, value: (r) => r.name },
            { id: "note", header: "note", flex: 1, value: (r) => r.note },
          ]}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={200}
        />,
      );

      const widths = widthsOf(container);
      expect(widths.name).toBe(200);
      expect(widths.note).toBe(800);
    } finally {
      restore();
    }
  });

  it("splits the leftover between weighted columns", () => {
    const restore = withViewportWidth(1000);
    try {
      const { container } = render(
        <PretableSurface<DemoRow>
          ariaLabel="Demo"
          columns={[
            { id: "name", header: "name", widthPx: 200, value: (r) => r.name },
            { id: "note", header: "note", flex: 3, value: (r) => r.note },
            { id: "id", header: "id", flex: 1, value: (r) => r.id },
          ]}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={200}
        />,
      );

      const widths = widthsOf(container);
      expect(widths.note).toBe(600);
      expect(widths.id).toBe(200);
    } finally {
      restore();
    }
  });

  it("leaves fixed-width grids exactly as they were", () => {
    const restore = withViewportWidth(1000);
    try {
      const { container } = render(
        <PretableSurface<DemoRow>
          ariaLabel="Demo"
          columns={[
            { id: "name", header: "name", widthPx: 200, value: (r) => r.name },
            { id: "note", header: "note", widthPx: 150, value: (r) => r.note },
          ]}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={200}
        />,
      );

      const widths = widthsOf(container);
      expect(widths.name).toBe(200);
      expect(widths.note).toBe(150);
    } finally {
      restore();
    }
  });

  it("honours a minimum rather than collapsing", () => {
    const restore = withViewportWidth(300);
    try {
      const { container } = render(
        <PretableSurface<DemoRow>
          ariaLabel="Demo"
          columns={[
            { id: "name", header: "name", widthPx: 250, value: (r) => r.name },
            {
              id: "note",
              header: "note",
              flex: 1,
              minWidthPx: 120,
              value: (r) => r.note,
            },
          ]}
          rows={rows}
          getRowId={(row) => row.id}
          viewportHeight={200}
        />,
      );

      expect(widthsOf(container).note).toBe(120);
    } finally {
      restore();
    }
  });
});
