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
  "pretable-group-indent",
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
  "pretable-seam-color",
  "pretable-edit-bg",
  "pretable-text-error",
  "pretable-icon-size",
  "pretable-positive",
  "pretable-negative",
  "pretable-warning",
  "pretable-info",
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

const THEMES_DIR = path.resolve(__dirname, "../../themes");
const GRID_CSS = path.resolve(__dirname, "../../grid.css");

/**
 * `--pretable-*` custom properties that are NOT theme tokens: @pretable/react
 * writes them per element as render state, so they resolve on the element and
 * are absent from `:root` by design. A theme must not define them — doing so
 * would imply they are themeable.
 *
 * - `--pretable-group-depth`: a row's grouping depth, set inline on group cells
 *   and once on the scroll content for leaf rows.
 * - `--pretable-pinned-left-edge` / `--pretable-pinned-right-edge`: where each
 *   frozen edge falls in viewport-x, published on the scroll viewport so the
 *   seam can be drawn as one gradient per plane instead of a shadow per cell.
 *   Layout math, not skin: a theme colours the seam through
 *   `--pretable-seam-color` and has no business moving it off its column.
 */
const RUNTIME_VARS = new Set([
  "--pretable-group-depth",
  "--pretable-pinned-left-edge",
  "--pretable-pinned-right-edge",
]);

/**
 * `--pretable-*` custom properties grid.css DECLARES on an element and then
 * reads back, rather than inheriting from a theme's `:root`. They resolve — on
 * `[data-pretable-header-overlays]`, where they are declared, and again inside
 * `@media (pointer: coarse)` where the touch geometry re-spaces them — so a
 * theme defining them at `:root` would be defining something it does not own.
 *
 * - `--pretable-header-resize-slot`: how far back from a column's trailing edge
 *   the resize strip starts. @pretable/react writes it as the strip's inline
 *   `left`, and the rule here derives the strip's WIDTH from the same value so
 *   a themed offset cannot detach the strip from the edge it hugs.
 *
 * Exempting a name from the `:root` check does NOT exempt it from resolving:
 * the loop below demands grid.css declare each of these itself, so a typo'd or
 * never-declared token still fails.
 */
const ELEMENT_SCOPED_VARS = new Set(["--pretable-header-resize-slot"]);

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
  for (const themeFile of ["excel.css", "material.css", "pretable.css"]) {
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

  test("pretable.css resolves dark mode (color override fires)", () => {
    // Assert on --pretable-bg-grid specifically: it is a literal in both the
    // light and dark blocks. jsdom does not substitute var(), so a token
    // declared as `var(--pretable-bg-grid)` would compare the identical
    // literal string "var(--pretable-bg-grid)" in both modes and fail for a
    // reason that has nothing to do with the theme.
    const cleanup = loadCSS(path.join(THEMES_DIR, "pretable.css"));
    const lightBg = getComputedStyle(document.documentElement)
      .getPropertyValue("--pretable-bg-grid")
      .trim();
    document.documentElement.setAttribute("data-theme", "dark");
    const darkBg = getComputedStyle(document.documentElement)
      .getPropertyValue("--pretable-bg-grid")
      .trim();
    expect(
      darkBg,
      "pretable dark mode did not override --pretable-bg-grid",
    ).not.toBe(lightBg);
    cleanup();
  });

  /**
   * jsdom does not substitute var(), so a token declared as
   * `var(--pretable-accent)` computes to that literal string. Follow the chain
   * by hand — otherwise every check below silently passes on an unparseable
   * value, which is exactly the shape of bug this file exists to catch.
   */
  function resolveToken(name: string, depth = 0): string {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    const ref = /^var\(\s*(--[a-z-]+)\s*\)$/.exec(raw);
    if (ref && depth < 8) return resolveToken(ref[1], depth + 1);
    return raw;
  }

  function relativeLuminance(hex: string): number {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!m) throw new Error(`not a hex color: "${hex}"`);
    // #abc and #aabbcc are the same color; both spellings ship in these files.
    const full =
      m[1].length === 3
        ? m[1]
            .split("")
            .map((c) => c + c)
            .join("")
        : m[1];
    const channels = [0, 2, 4].map((i) => {
      const srgb = parseInt(full.slice(i, i + 2), 16) / 255;
      return srgb <= 0.03928
        ? srgb / 12.92
        : Math.pow((srgb + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function contrastRatio(a: string, b: string): number {
    const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
      (x, y) => y - x,
    );
    return (hi + 0.05) / (lo + 0.05);
  }

  for (const themeFile of ["excel.css", "material.css", "pretable.css"]) {
    for (const mode of ["light", "dark"] as const) {
      test(`${themeFile}: the checkbox mark is legible on its own fill (${mode})`, () => {
        // WCAG 1.4.11 puts a 3:1 floor on graphical objects, and the check mark
        // is the entire signal that a row is selected — at 1.7:1 a user sees a
        // filled blue box and has to infer the rest.
        //
        // This is a live regression class, not a hypothetical: every theme
        // aliases --pretable-checkbox-checked-bg to --pretable-accent, so a
        // dark block that moves the accent (Material's goes from #0061a4 to a
        // pale #9ecaff, per M3) silently drags the fill out from under a mark
        // whose color was written as a literal #fff in the light block and
        // inherited unchanged. Only pretable.css originally paired the two.
        const cleanup = loadCSS(path.join(THEMES_DIR, themeFile));
        if (mode === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        }
        const fill = resolveToken("--pretable-checkbox-checked-bg");
        const mark = resolveToken("--pretable-checkbox-checked-fg");
        const ratio = contrastRatio(fill, mark);
        expect(
          ratio,
          `${themeFile} ${mode}: check mark ${mark} on fill ${fill} is ${ratio.toFixed(2)}:1, under the 3:1 floor`,
        ).toBeGreaterThanOrEqual(3);
        cleanup();
      });
    }
  }

  test("grid.css actually consumes the semantic ramp", () => {
    // The reverse of every other check in this file, and the one this project
    // keeps needing: four separate times a token has been declared by all three
    // themes and read by nothing — `data-pretable-numeric`, the toolbar rules,
    // the seam, the card shadow — and two of those shipped documented as
    // working. A token with no consumer is not a feature, it is a promise the
    // stylesheet never keeps. Comments are stripped so prose mentioning a token
    // cannot satisfy this.
    const gridCss = fs
      .readFileSync(GRID_CSS, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    for (const token of [
      "--pretable-positive",
      "--pretable-negative",
      "--pretable-warning",
      "--pretable-info",
    ]) {
      expect(
        gridCss,
        `${token} is defined by every theme and read by nothing in grid.css`,
      ).toContain(`var(${token})`);
    }
  });

  test("grid.css references no --pt-color-* tokens (consolidated into --pretable-*)", () => {
    const gridCss = fs.readFileSync(GRID_CSS, "utf8");
    const stale = [...gridCss.matchAll(/var\((--pt-color-[a-z-]+)/g)].map(
      (m) => m[1],
    );
    expect(stale, `grid.css still references ${stale.join(", ")}`).toEqual([]);
  });

  for (const themeFile of ["excel.css", "material.css", "pretable.css"]) {
    test(`grid.css has no unresolved var(--pretable-*) refs under ${themeFile}`, () => {
      const themeCleanup = loadCSS(path.join(THEMES_DIR, themeFile));
      // Comments stripped first, the same way every other prose-sensitive check
      // in this suite does it. Without that, a comment EXPLAINING a custom
      // property — "@pretable/react writes `left: var(--pretable-header-funnel-
      // slot)`" — reads as a reference, and the test then demands that every
      // theme define at `:root` a property that grid.css deliberately declares
      // on an element. Prose is not a reference.
      const gridCss = fs
        .readFileSync(GRID_CSS, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "");
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
        if (ELEMENT_SCOPED_VARS.has(ref)) {
          // Not "skip" — "resolves somewhere else, and prove it". grid.css has
          // to declare the property it reads back, or this arm would let a
          // misspelling through the moment it was added to the set.
          expect(
            gridCss,
            `${ref} is exempt from :root but grid.css never declares it`,
          ).toMatch(new RegExp(`\\${ref}:\\s*[^;\\s]`));
          continue;
        }
        expect(
          computed.getPropertyValue(ref).trim(),
          `grid.css references unresolved ${ref} under ${themeFile}`,
        ).not.toBe("");
      }
      themeCleanup();
    });
  }
});
