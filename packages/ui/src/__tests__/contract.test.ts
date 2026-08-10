import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TOKENS = [
  "pretable-bg-grid",
  "pretable-bg-grid-alt",
  "pretable-bg-header",
  "pretable-bg-pinned",
  "pretable-bg-group-row",
  "pretable-bg-toolbar",
  "pretable-bg-tooltip",
  "pretable-text-cell",
  "pretable-text-header",
  "pretable-text-dim",
  "pretable-rule",
  "pretable-rule-strong",
  "pretable-rule-vertical",
  "pretable-rule-width",
  "pretable-radius",
  "pretable-radius-control",
  "pretable-bg-hover",
  "pretable-bg-selected",
  "pretable-text-selected",
  "pretable-focus-ring",
  "pretable-accent",
  "pretable-row-height",
  "pretable-header-height",
  "pretable-group-panel-height",
  "pretable-cell-padding-x",
  "pretable-cell-padding-y",
  "pretable-font-size-cell",
  "pretable-font-size-header",
  "pretable-font-sans",
  "pretable-font-mono",
  "pretable-selection-bg",
  "pretable-checkbox-bg",
  "pretable-checkbox-border",
  "pretable-checkbox-checked-bg",
  "pretable-checkbox-checked-fg",
  "pretable-resize-handle",
  "pretable-resize-handle-hover",
  "pretable-reorder-ghost-bg",
  "pretable-reorder-drop-indicator",
  "pretable-shadow-overlay",
  "pretable-shadow-card",
  "pretable-shadow-seam",
  "pretable-edit-bg",
  "pretable-text-error",
];

/**
 * The tokens @pretable/react parses in JS as pixel numbers. `useResolvedPx`
 * matches `^<number>px$` and silently falls back on anything else, so one of
 * these resolving to a non-px value does not throw — it quietly renders every
 * theme at the hard-coded fallback.
 */
const HEIGHT_TOKENS = [
  "--pretable-row-height",
  "--pretable-header-height",
  "--pretable-group-panel-height",
];

const THEMES_DIR = path.resolve(__dirname, "../themes");
const GRID_CSS = path.resolve(__dirname, "../grid.css");

/**
 * `--pretable-*` custom properties that are NOT theme tokens: @pretable/react
 * writes them per element as render state, so they resolve on the element and
 * are absent from `:root` by design. A theme must not define them — doing so
 * would imply they are themeable.
 *
 * - `--pretable-group-depth`: a row's grouping depth, set inline on group cells
 *   and once on the scroll content for leaf rows.
 */
const RUNTIME_VARS = new Set(["--pretable-group-depth"]);

function loadCSS(absolutePath: string): () => void {
  const css = fs.readFileSync(absolutePath, "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
  return () => {
    document.head.removeChild(style);
  };
}

afterEach(() => {
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-theme");
});

describe("token contract", () => {
  for (const themeFile of ["excel.css", "material.css"]) {
    test(`${themeFile} defines every public token at :root`, () => {
      const cleanup = loadCSS(path.join(THEMES_DIR, themeFile));
      const computed = getComputedStyle(document.documentElement);
      for (const token of TOKENS) {
        expect(
          computed.getPropertyValue(`--${token}`).trim(),
          `${themeFile}: --${token} is empty`,
        ).not.toBe("");
      }
      cleanup();
    });

    test(`${themeFile} resolves all density tiers to <number>px`, () => {
      const cleanup = loadCSS(path.join(THEMES_DIR, themeFile));
      for (const density of ["compact", "standard", "spacious"]) {
        document.documentElement.setAttribute("data-density", density);
        const computed = getComputedStyle(document.documentElement);
        for (const token of HEIGHT_TOKENS) {
          expect(
            computed.getPropertyValue(token).trim(),
            `${themeFile} @ ${density}: ${token} not <number>px`,
          ).toMatch(/^\d+(\.\d+)?px$/);
        }
      }
      cleanup();
    });

    test(`${themeFile} grows every height token from tier to tier`, () => {
      // The test above cannot catch a token that a tier FORGOT: custom
      // properties inherit, so a missing `[data-density="spacious"]` value
      // silently resolves to the `:root` tier's and still reads as `<n>px`.
      // Measured — deleting one tier's --pretable-group-panel-height left the
      // suite green until this test existed. Strict growth is the invariant
      // that distinguishes "this tier declares it" from "this tier inherited
      // whatever the default tier said".
      const cleanup = loadCSS(path.join(THEMES_DIR, themeFile));
      for (const token of HEIGHT_TOKENS) {
        const heights = ["compact", "standard", "spacious"].map((density) => {
          document.documentElement.setAttribute("data-density", density);
          return parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue(token),
          );
        });
        expect(
          heights[1],
          `${themeFile}: ${token} standard (${heights[1]}) is not taller than compact (${heights[0]})`,
        ).toBeGreaterThan(heights[0]);
        expect(
          heights[2],
          `${themeFile}: ${token} spacious (${heights[2]}) is not taller than standard (${heights[1]})`,
        ).toBeGreaterThan(heights[1]);
      }
      cleanup();
    });
  }

  test("material.css resolves dark mode (color override fires)", () => {
    const cleanup = loadCSS(path.join(THEMES_DIR, "material.css"));
    const lightBg = getComputedStyle(document.documentElement)
      .getPropertyValue("--pretable-bg-grid")
      .trim();
    document.documentElement.setAttribute("data-theme", "dark");
    const darkBg = getComputedStyle(document.documentElement)
      .getPropertyValue("--pretable-bg-grid")
      .trim();
    expect(
      darkBg,
      "material dark mode did not override --pretable-bg-grid",
    ).not.toBe(lightBg);
    cleanup();
  });

  test("grid.css references no --pt-color-* tokens (consolidated into --pretable-*)", () => {
    const gridCss = fs.readFileSync(GRID_CSS, "utf8");
    const stale = [...gridCss.matchAll(/var\((--pt-color-[a-z-]+)/g)].map(
      (m) => m[1],
    );
    expect(stale, `grid.css still references ${stale.join(", ")}`).toEqual([]);
  });

  for (const themeFile of ["excel.css", "material.css"]) {
    test(`grid.css has no unresolved var(--pretable-*) refs under ${themeFile}`, () => {
      const themeCleanup = loadCSS(path.join(THEMES_DIR, themeFile));
      const gridCss = fs.readFileSync(GRID_CSS, "utf8");
      const refs = new Set(
        Array.from(gridCss.matchAll(/var\((--pretable-[a-z-]+)/g)).map(
          (m) => m[1],
        ),
      );
      expect(
        refs.size,
        "grid.css references zero --pretable-* vars; this is suspicious",
      ).toBeGreaterThan(0);
      const computed = getComputedStyle(document.documentElement);
      for (const ref of refs) {
        // Runtime vars are per-element state written by @pretable/react, not
        // theme tokens, so they resolve on the element and never at :root.
        // Keep this list exact rather than pattern-matching a prefix — the
        // point of the check is that a typo'd or unthemed token still fails.
        if (RUNTIME_VARS.has(ref)) continue;
        expect(
          computed.getPropertyValue(ref).trim(),
          `grid.css references unresolved ${ref} under ${themeFile}`,
        ).not.toBe("");
      }
      themeCleanup();
    });
  }
});
