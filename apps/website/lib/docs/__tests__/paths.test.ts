import { describe, it, expect } from "vitest";
import {
  slugToContentPath,
  contentPathToSlug,
  isValidSlugSegment,
} from "../paths";

describe("slugToContentPath", () => {
  it("maps empty slug to index.mdx", () => {
    expect(slugToContentPath([])).toBe("getting-started/index.mdx");
  });
  it("maps single segment to <segment>/index.mdx if dir, else <segment>.mdx", () => {
    expect(slugToContentPath(["grid"])).toBe("grid/index.mdx");
  });
  it("maps nested slug to nested file", () => {
    expect(slugToContentPath(["grid", "pretable-component"])).toBe(
      "grid/pretable-component.mdx",
    );
  });
});

describe("contentPathToSlug", () => {
  it("strips .mdx and index", () => {
    expect(contentPathToSlug("grid/index.mdx")).toEqual(["grid"]);
    expect(contentPathToSlug("grid/pretable-component.mdx")).toEqual([
      "grid",
      "pretable-component",
    ]);
    expect(contentPathToSlug("getting-started/index.mdx")).toEqual([]);
  });
});

describe("isValidSlugSegment", () => {
  it("accepts kebab-case", () => {
    expect(isValidSlugSegment("pretable-component")).toBe(true);
  });
  it("rejects path traversal", () => {
    expect(isValidSlugSegment("..")).toBe(false);
    expect(isValidSlugSegment("a/b")).toBe(false);
  });
});
