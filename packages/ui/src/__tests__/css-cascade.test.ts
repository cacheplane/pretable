import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GRID_CSS = path.resolve(__dirname, "../grid.css");

describe("grid.css cascade contract", () => {
  test("grid.css declares @layer pretable", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/@layer\s+pretable\s*\{/);
  });

  test("grid.css styles the cell editor, error, and pending states", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\.pretable-cell-editor\)/);
    expect(css).toMatch(/:where\(\[data-pretable-edit-error\]\)/);
    expect(css).toMatch(/:where\(\[data-pretable-number-editor\]\)/);
    expect(css).toMatch(/:where\(textarea\.pretable-cell-editor\)/);
    expect(css).toMatch(/data-pretable-bool-cell/);
    expect(css).toMatch(
      /:where\(button\[data-pretable-bool-cell\]\[aria-invalid="true"\]\)/,
    );
    expect(css).toMatch(/var\(--pretable-edit-bg\)/);
    expect(css).toMatch(/var\(--pretable-text-error\)/);
  });

  test("pinned header cells get an opaque background, both sides", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    // The header row's own background sits BEHIND its cells; a transparent
    // pinned header cell lets a scrolled-under header's label read through it.
    const rule = css.match(
      /:where\(\s*\[data-pretable-header-cell\]\[data-pretable-pinned="left"\],\s*\[data-pretable-header-cell\]\[data-pretable-pinned="right"\]\s*\)\s*\{[^}]*\}/,
    );
    expect(rule?.[0]).toMatch(/background:\s*var\(--pretable-bg-header\)/);
  });

  test("grid.css styles the enum combobox listbox", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\[data-pretable-enum-listbox\]\)/);
    expect(css).toMatch(
      /:where\(\[data-pretable-enum-option\]\[aria-selected="true"\]\)/,
    );
    // An empty result set must not paint a bare popover box.
    expect(css).toMatch(/:where\(\[data-pretable-enum-listbox\]:empty\)/);
  });

  test("grid.css styles the date calendar popover", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\[data-pretable-date-popover\]\)/);
    expect(css).toMatch(
      /:where\(\[data-pretable-date-day\]\[aria-selected="true"\]\)/,
    );
    expect(css).toMatch(
      /:where\(\[data-pretable-date-day\]\[data-pretable-date-today\]\)/,
    );
  });

  test("portaled popovers declare the sans font themselves", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    // These render into document.body, so they can't inherit the font-family
    // declared on the scroll viewport.
    for (const block of [
      /:where\(\[data-pretable-filter-menu\]\)\s*\{[^}]*\}/,
      /:where\(\[data-pretable-enum-listbox\]\)\s*\{[^}]*\}/,
      /:where\(\[data-pretable-date-popover\]\)\s*\{[^}]*\}/,
    ]) {
      const match = css.match(block);
      expect(match?.[0]).toMatch(/font-family:\s*var\(--pretable-font-sans\)/);
    }
  });

  test("body cells clip their own content instead of spilling into the next column", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const cellRule = css.match(
      /:where\(\[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(cellRule, "no [data-pretable-cell] rule found").toBeDefined();
    // Cells are absolutely positioned, so an unclipped long value renders on
    // top of its neighbour rather than being cut off at the column edge.
    expect(cellRule).toMatch(/overflow:\s*hidden/);
  });

  test("every grid.css rule selector is wrapped in :where()", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = [...noComments.matchAll(/([^{}]+)\{/g)]
      .map((m) => m[1].trim())
      .filter(Boolean);
    expect(selectors.length).toBeGreaterThan(5);
    for (const sel of selectors) {
      if (/^@/.test(sel)) continue; // layer/media/supports/etc. block openers — not selectors
      expect(sel, `selector not wrapped in :where(): "${sel}"`).toMatch(
        /^:where\(/,
      );
    }
  });
});
