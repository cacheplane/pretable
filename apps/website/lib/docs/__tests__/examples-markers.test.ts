import { describe, expect, it } from "vitest";

import { stripFocusMarkers } from "../examples/markers";

describe("stripFocusMarkers", () => {
  it("leaves unmarked source byte-identical and reports no focus", () => {
    const src = "const a = 1;\nconst b = 2;";
    expect(stripFocusMarkers(src)).toEqual({ source: src, focusLines: [] });
  });

  it("removes a trailing marker and focuses that line", () => {
    const result = stripFocusMarkers(
      ["const a = 1;", "const b = 2; // [!focus]", "const c = 3;"].join("\n"),
    );
    expect(result.source).toBe("const a = 1;\nconst b = 2;\nconst c = 3;");
    expect(result.focusLines).toEqual([2]);
  });

  it("removes a region's marker lines and focuses the lines between", () => {
    const result = stripFocusMarkers(
      [
        "const a = 1;",
        "// [!focus:start]",
        "const b = 2;",
        "const c = 3;",
        "// [!focus:end]",
        "const d = 4;",
      ].join("\n"),
    );
    expect(result.source).toBe(
      "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;",
    );
    expect(result.focusLines).toEqual([2, 3]);
  });

  it("accepts block-comment markers for languages without //", () => {
    const result = stripFocusMarkers(
      [".a { color: red; } /* [!focus] */", ".b { color: blue; }"].join("\n"),
    );
    expect(result.source).toBe(".a { color: red; }\n.b { color: blue; }");
    expect(result.focusLines).toEqual([1]);
  });

  it("throws on a start with no end", () => {
    expect(() => stripFocusMarkers("// [!focus:start]\nconst a = 1;")).toThrow(
      /\[!focus:start\] without a matching \[!focus:end\]/,
    );
  });

  it("throws on an end with no start", () => {
    expect(() => stripFocusMarkers("const a = 1;\n// [!focus:end]")).toThrow(
      /\[!focus:end\] without a matching \[!focus:start\]/,
    );
  });

  it("throws on a nested start", () => {
    expect(() =>
      stripFocusMarkers(
        ["// [!focus:start]", "// [!focus:start]", "// [!focus:end]"].join(
          "\n",
        ),
      ),
    ).toThrow(/\[!focus:start\] inside an open region/);
  });
});
