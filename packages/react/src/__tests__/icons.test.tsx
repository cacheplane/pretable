import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  FunnelIcon,
  GripIcon,
  OverflowIcon,
  SortAscIcon,
  SortDescIcon,
} from "../icons";

const ICONS = [
  ["CheckIcon", CheckIcon],
  ["ChevronDownIcon", ChevronDownIcon],
  ["CloseIcon", CloseIcon],
  ["FunnelIcon", FunnelIcon],
  ["GripIcon", GripIcon],
  ["OverflowIcon", OverflowIcon],
  ["SortAscIcon", SortAscIcon],
  ["SortDescIcon", SortDescIcon],
] as const;

describe("icon set", () => {
  test.each(ICONS)("%s shares the 16px grid and is aria-hidden", (_n, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  test.each(ICONS)(
    "%s inherits color and size, hard-codes neither",
    (_n, Icon) => {
      const { container } = render(<Icon />);
      const svg = container.querySelector("svg")!;
      // Size comes from CSS (--pretable-icon-size), colour from currentColor, so
      // one theme change moves every glyph. A width/height attribute here would
      // silently win over the stylesheet.
      expect(svg.getAttribute("width")).toBeNull();
      expect(svg.getAttribute("height")).toBeNull();
      expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
      // The hook grid.css sizes it through. Without it the glyph falls back to
      // the SVG default of 300x150 and blows the row apart.
      expect(svg.getAttribute("data-pretable-icon")).toBe("");
    },
  );

  test.each(ICONS)("%s draws with strokes, not fills", (_n, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke-linejoin")).toBe("round");
  });
});
