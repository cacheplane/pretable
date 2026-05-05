import { describe, it, expect } from "vitest";
import { extractHeadings } from "../extract-headings";

const SAMPLE = `---
title: x
---
# Title (skipped)

## First section

Body.

### Sub one

### Sub two

## Second section

#### Too deep (skipped)
`;

describe("extractHeadings", () => {
  it("returns H2/H3 only with slugs", () => {
    expect(extractHeadings(SAMPLE)).toEqual([
      { depth: 2, text: "First section", slug: "first-section" },
      { depth: 3, text: "Sub one", slug: "sub-one" },
      { depth: 3, text: "Sub two", slug: "sub-two" },
      { depth: 2, text: "Second section", slug: "second-section" },
    ]);
  });
  it("returns [] when no h2", () => {
    expect(extractHeadings("# Only H1\n\nbody")).toEqual([]);
  });
});
