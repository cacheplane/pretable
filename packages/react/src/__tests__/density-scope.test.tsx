// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "vitest";

import { createColumnHelper } from "@pretable/core";

import { PretableSurface } from "../pretable-surface";

/**
 * `data-density` scopes to a wrapper the way `data-theme` does.
 *
 * It did not. `getDensityHeights` and `readPx` both read
 * `document.documentElement` unconditionally, so a grid inside
 * `<div data-density="compact">` PAINTED compact — the tokens are custom
 * properties and inherit — while every number the engine read in JavaScript
 * came from the root. Row height, header height and therefore the whole
 * virtualization geometry were resolved against an element the consumer never
 * scoped. The grid painted at one density and measured at another.
 *
 * ## What jsdom can and cannot prove here
 *
 * jsdom DOES apply stylesheet selectors and DOES inherit custom properties down
 * the tree — verified before these tests were written, and load-bearing: the
 * values asserted below are produced by the cascade, not written onto the
 * element being read. So "the engine resolves the scoped value" is a real claim
 * here.
 *
 * jsdom lays nothing out, so it cannot say anything about real pixels, about
 * `--pretable-row-height` being a floor rather than a height, or about which
 * geometry the browser actually PAINTS while a grid is mounting. Those are
 * `apps/website/e2e/density-scope.spec.ts`, in a real browser.
 *
 * Every fixture states BOTH densities at different values. A fixture that set
 * only the wrapper's would be satisfied by reading either element.
 */

type Row = { id: number; name: string };

const column = createColumnHelper<Row>();
const columns = [column.accessor("name", { type: "text" })] as const;
const rows: readonly Row[] = [
  { id: 1, name: "a" },
  { id: 2, name: "b" },
];

const ROOT_ROW_HEIGHT = 56;
const ROOT_HEADER_HEIGHT = 60;
const SCOPED_ROW_HEIGHT = 24;
const SCOPED_HEADER_HEIGHT = 28;

/**
 * A theme's density blocks, written the way every shipped theme writes them: a
 * bare `[data-density="…"]` selector that matches wherever the attribute is
 * set, plus a `:root` default for the root-level case.
 */
function installTheme(): void {
  const style = document.createElement("style");
  style.setAttribute("data-test", "");
  style.textContent = `
    :root {
      --pretable-row-height: ${ROOT_ROW_HEIGHT}px;
      --pretable-header-height: ${ROOT_HEADER_HEIGHT}px;
      --pretable-group-panel-height: 48px;
    }
    [data-density="compact"] {
      --pretable-row-height: ${SCOPED_ROW_HEIGHT}px;
      --pretable-header-height: ${SCOPED_HEADER_HEIGHT}px;
      --pretable-group-panel-height: 30px;
    }
  `;
  document.head.append(style);
}

function grid(label: string): React.ReactElement {
  return (
    <PretableSurface
      ariaLabel={label}
      columns={columns}
      getRowId={(row) => row.id}
      overscan={0}
      rows={rows}
      viewportHeight={400}
    />
  );
}

function rowHeights(container: HTMLElement): number[] {
  return [
    ...container.querySelectorAll<HTMLElement>("[data-pretable-row]"),
  ].map((row) => Number(row.getAttribute("data-pretable-row-height")));
}

function headerHeight(container: HTMLElement): string {
  const header = container.querySelector<HTMLElement>(
    "[data-pretable-header-row]",
  );
  expect(header).not.toBeNull();
  return header!.style.height;
}

afterEach(() => {
  cleanup();
  document.head.querySelectorAll("style[data-test]").forEach((el) => {
    el.remove();
  });
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("style");
});

describe("density scoped to a wrapper around the grid", () => {
  test("the engine measures at the wrapper's density, not the root's", async () => {
    installTheme();
    const { container } = render(
      <div data-density="compact">{grid("Scoped grid")}</div>,
    );

    await waitFor(() => {
      expect(rowHeights(container).length).toBeGreaterThan(0);
    });
    // Before the fix this was ROOT_ROW_HEIGHT: the rows inherited the wrapper's
    // 24px for painting and the virtualizer planned them at the root's 56px.
    expect(rowHeights(container)).toEqual(
      rowHeights(container).map(() => SCOPED_ROW_HEIGHT),
    );
    expect(headerHeight(container)).toBe(`${SCOPED_HEADER_HEIGHT}px`);
  });

  test("KNOWN GAP: rendered rows scope, the unmeasured-row ESTIMATE does not", async () => {
    // The boundary of this fix, pinned so it is not rediscovered as a surprise.
    //
    // Rows the DOM has rendered take their height from the surface's
    // `useResolvedPx`, which now resolves against the grid element — those are
    // scoped, and the first assertion is the one that used to be wrong.
    //
    // Rows BELOW the viewport are estimated by the row-layout controller, whose
    // `defaultRowHeight` comes from `getThemeRowHeight()` in
    // `pretable-model.ts`. That is read inside a `useState` lazy initialiser on
    // the FIRST render, before any element exists, and the controller captures
    // it with no setter by explicit design (see the comment in
    // `renderer-dom/src/row-layout-controller.ts`). A ref cannot reach back
    // before its own mount, so scoping that value needs the controller to
    // accept a re-seed — a renderer-dom API change, deliberately not made here.
    //
    // The same staleness already affects a ROOT-level runtime density flip on
    // main: nothing rebuilds the controller, so its estimate keeps the density
    // in force when the grid first rendered. Scoping does not make that worse,
    // it just does not fix it.
    installTheme();
    const many: readonly Row[] = Array.from({ length: 500 }, (_, index) => ({
      id: index,
      name: `row ${index}`,
    }));
    const { container } = render(
      <div data-density="compact">
        <PretableSurface
          ariaLabel="Scoped tall grid"
          columns={columns}
          getRowId={(row) => row.id}
          overscan={0}
          rows={many}
          viewportHeight={400}
        />
      </div>,
    );

    await waitFor(() => {
      expect(rowHeights(container).length).toBeGreaterThan(0);
    });
    // Fixed: every row actually drawn is at the wrapper's density.
    expect(rowHeights(container)).toEqual(
      rowHeights(container).map(() => SCOPED_ROW_HEIGHT),
    );

    // Not fixed: the scroll extent still charges unmeasured rows the ROOT's
    // height. Between the two bounds rather than at either, because the rendered
    // rows above have already been measured down to 24.
    const content = container.querySelector<HTMLElement>(
      "[data-pretable-scroll-content]",
    );
    expect(content).not.toBeNull();
    const extent = Number.parseFloat(content!.style.height);
    expect(extent).toBeGreaterThan(500 * SCOPED_ROW_HEIGHT);
    expect(extent).toBeLessThanOrEqual(500 * ROOT_ROW_HEIGHT);
  });

  test("a density swap ON THE WRAPPER re-measures", async () => {
    // The observer half. Watching `<html>` alone, a runtime swap on the wrapper
    // changes nothing on the observed node, so no callback fires and the grid
    // keeps the geometry it resolved at mount — even though the paint moved.
    installTheme();
    const { container } = render(
      <div data-density="compact">{grid("Swapping grid")}</div>,
    );

    await waitFor(() => {
      expect(rowHeights(container)[0]).toBe(SCOPED_ROW_HEIGHT);
    });

    const wrapper = container.querySelector<HTMLElement>("[data-density]");
    expect(wrapper).not.toBeNull();
    await act(async () => {
      wrapper!.removeAttribute("data-density");
      // MutationObserver delivers on a microtask.
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(rowHeights(container)).toEqual(
        rowHeights(container).map(() => ROOT_ROW_HEIGHT),
      );
    });
    expect(headerHeight(container)).toBe(`${ROOT_HEADER_HEIGHT}px`);
  });

  test("two grids at different densities in one document each read their own", async () => {
    // The claim scoping is FOR. A single root read gives both grids the same
    // number by construction, so this cannot pass by accident.
    installTheme();
    const { container } = render(
      <>
        <div data-density="compact" data-testid="left">
          {grid("Compact grid")}
        </div>
        <div data-testid="right">{grid("Root-density grid")}</div>
      </>,
    );

    const left = container.querySelector<HTMLElement>('[data-testid="left"]');
    const right = container.querySelector<HTMLElement>('[data-testid="right"]');
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();

    await waitFor(() => {
      expect(rowHeights(left!).length).toBeGreaterThan(0);
      expect(rowHeights(right!).length).toBeGreaterThan(0);
    });
    expect(rowHeights(left!)).toEqual(
      rowHeights(left!).map(() => SCOPED_ROW_HEIGHT),
    );
    expect(rowHeights(right!)).toEqual(
      rowHeights(right!).map(() => ROOT_ROW_HEIGHT),
    );
  });
});

/**
 * The other half of the bar: root-level density is the path every existing
 * consumer is on, and it has to behave exactly as it did. A change that made
 * scoping work by making the root stop working would pass every test above.
 */
describe("root-level density still resolves", () => {
  test("[data-density] on <html> drives the grid's geometry", async () => {
    installTheme();
    document.documentElement.setAttribute("data-density", "compact");
    const { container } = render(grid("Root-scoped grid"));

    await waitFor(() => {
      expect(rowHeights(container).length).toBeGreaterThan(0);
    });
    expect(rowHeights(container)).toEqual(
      rowHeights(container).map(() => SCOPED_ROW_HEIGHT),
    );
    expect(headerHeight(container)).toBe(`${SCOPED_HEADER_HEIGHT}px`);
  });

  test("a raw --pretable-row-height on <html> still drives the rows", async () => {
    document.documentElement.style.setProperty("--pretable-row-height", "20px");
    const { container } = render(grid("Root token grid"));

    await waitFor(() => {
      expect(rowHeights(container).length).toBeGreaterThan(0);
    });
    expect(rowHeights(container)).toEqual(rowHeights(container).map(() => 20));
  });

  test("a runtime swap on <html> still re-measures", async () => {
    installTheme();
    const { container } = render(grid("Root swap grid"));

    await waitFor(() => {
      expect(rowHeights(container)[0]).toBe(ROOT_ROW_HEIGHT);
    });

    await act(async () => {
      document.documentElement.setAttribute("data-density", "compact");
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(rowHeights(container)).toEqual(
        rowHeights(container).map(() => SCOPED_ROW_HEIGHT),
      );
    });
  });

  test("with no theme at all the historical 44px default is unchanged", async () => {
    const { container } = render(grid("Unthemed grid"));

    await waitFor(() => {
      expect(rowHeights(container).length).toBeGreaterThan(0);
    });
    expect(rowHeights(container)).toEqual(rowHeights(container).map(() => 44));
  });
});
