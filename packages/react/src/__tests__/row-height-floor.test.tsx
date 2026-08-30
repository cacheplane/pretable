// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { createColumnHelper } from "@pretable/core";

import { PretableSurface } from "../pretable-surface";
import { measureRenderedRowHeight } from "../row-height";

/**
 * A row's height has a floor, and until now that floor was the literal 44 —
 * written in April, before the token contract existed, and never revisited.
 * Every shipped theme states a row height per density tier, and three of the
 * nine tiers are shorter than 44: Excel is 20 / 24 / 32, and both pretable and
 * Material are 40 at compact. Under those the floor won every time, so the
 * theme's stated height was unreachable and Excel's rows rendered at more than
 * twice their intended size.
 *
 * jsdom has no layout engine — every element measures zero — so the floor is
 * the ONLY thing deciding a row's height here. That makes it exactly the right
 * environment to pin the floor, and useless for anything about content.
 */

type Row = { id: number; name: string };

const column = createColumnHelper<Row>();
const columns = [column.accessor("name", { type: "text" })] as const;
const rows: readonly Row[] = [
  { id: 1, name: "a" },
  { id: 2, name: "b" },
];

function setThemeRowHeight(value: string | null) {
  if (value === null) {
    document.documentElement.style.removeProperty("--pretable-row-height");
    return;
  }
  document.documentElement.style.setProperty("--pretable-row-height", value);
}

function renderedRowHeights(container: HTMLElement): number[] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-pretable-row]"),
  ].map((row) => Number(row.getAttribute("data-pretable-row-height")));
}

afterEach(() => {
  cleanup();
  setThemeRowHeight(null);
});

describe("row height floor", () => {
  test("measureRenderedRowHeight floors at the height it is given", () => {
    const row = document.createElement("div");
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    row.appendChild(cell);
    document.body.appendChild(row);

    // Same empty row, two themes. A single hard-coded floor cannot produce
    // both of these numbers, which is the whole point.
    expect(measureRenderedRowHeight(row, 20)).toBe(20);
    expect(measureRenderedRowHeight(row, 56)).toBe(56);
  });

  test("content taller than the floor still wins", () => {
    // The floor is a floor, not a height. Regressing it into an assignment
    // would clip every wrapped row, and jsdom cannot see clipping — so assert
    // it here, where scrollHeight is the one dimension jsdom does report.
    const row = document.createElement("div");
    row.style.borderBottomWidth = "0";
    const cell = document.createElement("div");
    cell.setAttribute("data-pretable-cell", "");
    Object.defineProperty(cell, "scrollHeight", { value: 90 });
    row.appendChild(cell);
    document.body.appendChild(row);

    expect(measureRenderedRowHeight(row, 20)).toBe(90);
  });

  test("a surface renders its rows at the theme's row height", async () => {
    setThemeRowHeight("20px");
    const { container } = render(
      <PretableSurface
        ariaLabel="Excel-density grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={200}
      />,
    );

    await waitFor(() => {
      expect(renderedRowHeights(container).length).toBeGreaterThan(0);
    });
    expect(renderedRowHeights(container)).toEqual(
      renderedRowHeights(container).map(() => 20),
    );
  });

  test("with no theme, rows keep the historical 44px default", async () => {
    // The fallback is unchanged on purpose: an app that never imports a theme
    // file — and every jsdom test in this package — must render exactly as it
    // did before. This is the check that keeps the change surgical.
    const { container } = render(
      <PretableSurface
        ariaLabel="Unthemed grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={200}
      />,
    );

    await waitFor(() => {
      expect(renderedRowHeights(container).length).toBeGreaterThan(0);
    });
    expect(renderedRowHeights(container)).toEqual(
      renderedRowHeights(container).map(() => 44),
    );
  });

  test("rows nobody has measured yet are estimated at the theme's height", async () => {
    // The floor governs rows the DOM has rendered. Everything below the
    // viewport is a guess, and the guess has its own constant — renderer-dom's
    // defaultRowHeight, also 44. Fixing only the floor would leave a themed
    // grid estimating its scroll extent at one height and measuring at
    // another: under Excel, a 500-row grid would claim 22000px of scroll for
    // 10000px of rows, and the scrollbar would visibly shrink as you scrolled.
    setThemeRowHeight("20px");
    const many: readonly Row[] = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      name: `row ${i}`,
    }));
    const { container } = render(
      <PretableSurface
        ariaLabel="Estimated grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={many}
        viewportHeight={200}
      />,
    );

    await waitFor(() => {
      expect(renderedRowHeights(container).length).toBeGreaterThan(0);
    });
    const content = container.querySelector<HTMLElement>(
      "[data-pretable-scroll-content]",
    );
    expect(content).not.toBeNull();
    expect(content!.style.height).toBe(`${500 * 20}px`);
  });

  test("a density flip re-measures rows that did not otherwise change", async () => {
    // The subtle one. Rows are re-measured only when their measurement key
    // changes, and that key is built from the row's own markup — class, style,
    // state attributes, cell text. A density switch changes NONE of those in
    // jsdom: same rows, same text, same classes. If the floor is not part of
    // the key, every already-measured row keeps its old height and only rows
    // scrolled into view afterwards pick up the new density.
    setThemeRowHeight("20px");
    const { container } = render(
      <PretableSurface
        ariaLabel="Density-switching grid"
        columns={columns}
        getRowId={(row) => row.id}
        overscan={0}
        rows={rows}
        viewportHeight={200}
      />,
    );

    await waitFor(() => {
      expect(renderedRowHeights(container)[0]).toBe(20);
    });

    await act(async () => {
      setThemeRowHeight("56px");
    });

    await waitFor(() => {
      expect(renderedRowHeights(container)).toEqual(
        renderedRowHeights(container).map(() => 56),
      );
    });
  });
});
