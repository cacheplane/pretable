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

  it("includes the line number in start/end/nested errors", () => {
    expect(() => stripFocusMarkers("// [!focus:start]\nconst a = 1;")).toThrow(
      /\(line 1\)/,
    );
    expect(() => stripFocusMarkers("const a = 1;\n// [!focus:end]")).toThrow(
      /\(line 2\)/,
    );
    expect(() =>
      stripFocusMarkers(
        ["// [!focus:start]", "// [!focus:start]", "// [!focus:end]"].join(
          "\n",
        ),
      ),
    ).toThrow(/\(line 2\)/);
  });

  it("throws when a trailing marker has content after it", () => {
    expect(() =>
      stripFocusMarkers("const a = 1; // [!focus] explain why"),
    ).toThrow(/unrecognized "\[!focus\.\.\.\]" on line 1/);
  });

  it("throws on a mid-line block-comment marker", () => {
    expect(() => stripFocusMarkers("/* [!focus] */ const a = 1;")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
  });

  it("throws when a repeated marker leaves a residual behind", () => {
    expect(() =>
      stripFocusMarkers("const a = 1; // [!focus] // [!focus]"),
    ).toThrow(/unrecognized "\[!focus\.\.\.\]" on line 1/);
  });

  it("rejects a mismatched line/block-comment pair", () => {
    expect(() => stripFocusMarkers("// [!focus] */")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
    expect(() => stripFocusMarkers(".a { color: red; } /* [!focus]")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
  });

  it("drops a line that strips to nothing, without focusing a blank line", () => {
    const result = stripFocusMarkers(
      ["const a = 1;", "// [!focus]", "const b = 2;"].join("\n"),
    );
    expect(result.source).toBe("const a = 1;\nconst b = 2;");
    expect(result.focusLines).toEqual([]);
  });

  it("normalizes CRLF input to consistent LF line endings", () => {
    const result = stripFocusMarkers(
      "const a = 1;\r\nconst b = 2; // [!focus]\r\nconst c = 3;",
    );
    expect(result.source).toBe("const a = 1;\nconst b = 2;\nconst c = 3;");
    expect(result.source).not.toMatch(/\r/);
    expect(result.focusLines).toEqual([2]);
  });

  it("throws on typo'd markers that don't match any recognized form", () => {
    for (const line of [
      "// [!focus-start]",
      "// [!focus start]",
      "// [!focus_end]",
      "// [!focusx]",
    ]) {
      expect(() => stripFocusMarkers(line)).toThrow(
        /unrecognized "\[!focus\.\.\.\]" on line 1/,
      );
    }
  });

  it("keeps blank lines intact, focusing only the ones inside a region", () => {
    const result = stripFocusMarkers(
      [
        "const a = 1;",
        "",
        "// [!focus:start]",
        "const b = 2;",
        "",
        "const c = 3;",
        "// [!focus:end]",
        "",
        "const d = 4;",
      ].join("\n"),
    );
    expect(result.source).toBe(
      "const a = 1;\n\nconst b = 2;\n\nconst c = 3;\n\nconst d = 4;",
    );
    expect(result.focusLines).toEqual([3, 4, 5]);
  });

  it("accepts a block-comment start/end region", () => {
    const result = stripFocusMarkers(
      [
        ".a { color: red; }",
        "/* [!focus:start] */",
        ".b { color: blue; }",
        ".c { color: green; }",
        "/* [!focus:end] */",
        ".d { color: black; }",
      ].join("\n"),
    );
    expect(result.source).toBe(
      ".a { color: red; }\n.b { color: blue; }\n.c { color: green; }\n.d { color: black; }",
    );
    expect(result.focusLines).toEqual([2, 3]);
  });

  it("rejects a start/end marker with a mismatched comment pairing", () => {
    expect(() => stripFocusMarkers("// [!focus:start] */")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
    expect(() => stripFocusMarkers("/* [!focus:end]")).toThrow(
      /unrecognized "\[!focus\.\.\.\]" on line 1/,
    );
  });

  it("reports the correct line number for a residual marker beyond line 1", () => {
    expect(() =>
      stripFocusMarkers(
        [
          "const a = 1;",
          "const b = 2;",
          "const c = 3; // [!focus] trailing",
        ].join("\n"),
      ),
    ).toThrow(/unrecognized "\[!focus\.\.\.\]" on line 3/);
  });
});
