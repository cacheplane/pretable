import { afterEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const TOKENS = [
  "pretable-bg-grid",
  "pretable-bg-grid-alt",
  "pretable-bg-header",
  "pretable-bg-toolbar",
  "pretable-bg-tooltip",
  "pretable-text-cell",
  "pretable-text-header",
  "pretable-text-dim",
  "pretable-rule",
  "pretable-rule-strong",
  "pretable-radius",
  "pretable-bg-hover",
  "pretable-bg-selected",
  "pretable-text-selected",
  "pretable-focus-ring",
  "pretable-accent",
  "pretable-row-height",
  "pretable-header-height",
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
  "pretable-reorder-ghost-shadow",
  "pretable-reorder-drop-indicator",
];

const THEMES_DIR = path.resolve(__dirname, "../themes");
const GRID_CSS = path.resolve(__dirname, "../grid.css");

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
        expect(
          computed.getPropertyValue("--pretable-row-height").trim(),
          `${themeFile} @ ${density}: --pretable-row-height not <number>px`,
        ).toMatch(/^\d+(\.\d+)?px$/);
        expect(
          computed.getPropertyValue("--pretable-header-height").trim(),
          `${themeFile} @ ${density}: --pretable-header-height not <number>px`,
        ).toMatch(/^\d+(\.\d+)?px$/);
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

  test("grid.css has no unresolved var(--pretable-*) references when excel.css is loaded", () => {
    const themeCleanup = loadCSS(path.join(THEMES_DIR, "excel.css"));
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
      expect(
        computed.getPropertyValue(ref).trim(),
        `grid.css references unresolved ${ref}`,
      ).not.toBe("");
    }
    themeCleanup();
  });
});
