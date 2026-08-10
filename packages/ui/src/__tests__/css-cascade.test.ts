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

  test("header cells reset the button border before drawing the tokenized divider", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\[data-pretable-header-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no [data-pretable-header-cell] rule found").toBeDefined();
    expect(rule).toMatch(
      /border:\s*0;[\s\S]*border-right:\s*var\(--pretable-rule-width,\s*1px\)\s*solid\s*var\(--pretable-rule-vertical,\s*var\(--pretable-rule\)\)/,
    );
  });

  test("the row hairline and the column divider read different tokens", () => {
    // The whole point of the split: a theme must be able to drop the vertical
    // cage without also erasing row separation. If both axes resolve to the
    // same token again, that capability is silently gone. The fallback chain
    // on the vertical declarations (`--pretable-rule-vertical, var(--pretable-rule)`)
    // is deliberate — a theme predating the axis split still needs to fall
    // back to `--pretable-rule`, not to no vertical token at all — so this
    // regex checks for the vertical TOKEN NAME appearing at all, which a
    // collapsed-axis edit (deleting `-vertical` and reusing `--pretable-rule`
    // outright) would fail.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const cellRule = css.match(
      /:where\(\[data-pretable-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(cellRule, "no [data-pretable-cell] rule found").toBeDefined();
    expect(cellRule).toMatch(
      /border-right:\s*var\(--pretable-rule-width,\s*1px\)\s*solid\s*var\(--pretable-rule-vertical,\s*var\(--pretable-rule\)\)/,
    );
    expect(cellRule).toMatch(
      /border-bottom:\s*var\(--pretable-rule-width,\s*1px\)\s*solid\s*var\(--pretable-rule\);/,
    );
  });

  test("header cells take their text color from the header token", () => {
    // The surface renders header cells as <button>, which carries a UA color.
    // The skin owns the reset, so this rule is the only thing standing between
    // `--pretable-text-header` and a header that renders in buttontext.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\[data-pretable-header-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no [data-pretable-header-cell] rule found").toBeDefined();
    expect(rule).toMatch(/color:\s*var\(--pretable-text-header\)/);
  });

  test("header cells reset the UA button background", () => {
    // Header cells are <button> (pretable-surface.tsx). Without this reset the
    // UA ButtonFace fill paints, and the grid only looks right in apps that
    // happen to ship a reset — both of ours import Tailwind Preflight, which is
    // why this went unnoticed. Every other button in the file resets explicitly.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\[data-pretable-header-cell\]\)\s*\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no [data-pretable-header-cell] rule found").toBeDefined();
    expect(rule).toMatch(/background:\s*transparent/);
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

  test("grid.css styles every element of the drag-to-group panel", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    // The panel's DOM is a fixed contract (@pretable/react emits exactly
    // these); an unstyled one of them ships as a naked <span> or <button>.
    for (const attr of [
      "data-pretable-group-panel",
      "data-pretable-group-panel-empty",
      "data-pretable-group-chip",
      "data-pretable-chip-handle",
      "data-pretable-chip-label",
      "data-pretable-chip-remove",
      "data-pretable-chip-drop-indicator",
    ]) {
      expect(css, `no rule for [${attr}]`).toMatch(
        new RegExp(`:where\\(\\[${attr}\\]`),
      );
    }
    // Drag feedback and the keyboard's focus ring are the two states the panel
    // is unusable without.
    expect(css).toMatch(
      /:where\(\[data-pretable-group-panel\]\[data-pretable-group-panel-active\]\)/,
    );
    expect(css).toMatch(
      /:where\(\[data-pretable-group-chip\]\[data-pretable-chip-dragging\]\)/,
    );
    const chipFocus = css.match(
      /:where\(\[data-pretable-group-chip\]:focus-visible\)\s*\{[^}]*\}/,
    );
    expect(chipFocus?.[0]).toMatch(/var\(--pretable-focus-ring\)/);
    // The strip's height is a token, not a literal — @pretable/react reads the
    // same one to subtract it from viewportHeight.
    const panel = css.match(
      /:where\(\[data-pretable-group-panel\]\)\s*\{[^}]*\}/,
    );
    expect(panel?.[0]).toMatch(/var\(--pretable-group-panel-height\)/);
  });

  test("grid.css styles the column menu and its ⋮ button", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/:where\(\[data-pretable-column-menu-button\]\)/);
    expect(css).toMatch(/:where\(\[data-pretable-column-menu\]\)/);
    expect(css).toMatch(/:where\(\[data-pretable-menu-item\]\)/);
    // The ⋮ hides with the funnel, but an OPEN menu must keep its button lit.
    expect(css).toMatch(
      /:where\(\[data-pretable-column-menu-button\]\[aria-expanded="true"\]\)/,
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
      /:where\(\[data-pretable-column-menu\]\)\s*\{[^}]*\}/,
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

  test("alignment uses justify-content, and the trailing edge is safe", () => {
    // Cells are flex containers (`display: flex`) and an unwrapped cell value is
    // an anonymous flex item, which `text-align` cannot move — only
    // `justify-content` can. And plain `flex-end` clips an over-wide value at
    // its LEADING edge under `overflow: hidden`, rendering 1,234,567 as a
    // legible, plausible, WRONG 34,567. `safe` falls back to start-alignment
    // rather than overflowing the start edge.
    const css = fs.readFileSync(GRID_CSS, "utf8");
    const rule = css.match(
      /:where\(\s*\[data-pretable-cell\]\[data-pretable-align="end"\][\s\S]*?\{([\s\S]*?)\}/,
    )?.[1];
    expect(rule, "no align=end rule found").toBeDefined();
    expect(rule).toMatch(/justify-content:\s*safe flex-end/);
    expect(rule).not.toMatch(/text-align/);
  });

  test("numeric and date cells get tabular figures without changing family", () => {
    const css = fs.readFileSync(GRID_CSS, "utf8");
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums lining-nums/);
    // The old rule swapped in the mono stack, which put a typographic seam down
    // every numeric column. One family throughout; the numerals do the aligning.
    expect(css).not.toMatch(/data-pretable-numeric/);
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
