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
    expect(css).toMatch(/var\(--pretable-edit-bg\)/);
    expect(css).toMatch(/var\(--pretable-text-error\)/);
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
