import { describe, expect, it } from "vitest";

import {
  DEFAULT_EXAMPLE_HEIGHT,
  defineExample,
  langForFile,
} from "../examples/define";

describe("defineExample", () => {
  it("returns the meta unchanged", () => {
    const meta = {
      title: "T",
      description: "D",
      files: ["a.ts"],
    };
    expect(defineExample(meta)).toBe(meta);
    expect(defineExample(meta)).toEqual({
      title: "T",
      description: "D",
      files: ["a.ts"],
    });
  });
});

describe("langForFile", () => {
  it("maps known extensions", () => {
    expect(langForFile("a.tsx")).toBe("tsx");
    expect(langForFile("a.ts")).toBe("ts");
    expect(langForFile("a.jsx")).toBe("jsx");
    expect(langForFile("a.js")).toBe("js");
    expect(langForFile("a.css")).toBe("css");
    expect(langForFile("a.json")).toBe("json");
    expect(langForFile("a.sh")).toBe("bash");
  });

  it("throws on an extension it cannot highlight", () => {
    expect(() => langForFile("logo.svg")).toThrow(/logo\.svg/);
  });

  it("is case-insensitive", () => {
    expect(langForFile("Grid.TSX")).toBe("tsx");
  });

  it("uses the last dot", () => {
    expect(langForFile("a.test.ts")).toBe("ts");
  });

  it("throws on a filename with no extension", () => {
    expect(() => langForFile("Makefile")).toThrow(/Makefile/);
  });
});

describe("DEFAULT_EXAMPLE_HEIGHT", () => {
  it("is 480", () => {
    expect(DEFAULT_EXAMPLE_HEIGHT).toBe(480);
  });
});
