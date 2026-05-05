import { describe, expect, it } from "vitest";

import type { DocsNavSection } from "../../../app/docs/_nav";
import { resolvePrevNext } from "../prev-next";

const NAV: DocsNavSection[] = [
  {
    title: "G1",
    items: [
      { title: "A", href: "/docs/a" },
      { title: "B", href: "/docs/b" },
    ],
  },
  { title: "G2", items: [{ title: "C", href: "/docs/c" }] },
];

describe("resolvePrevNext", () => {
  it("first page has no prev, has next", () => {
    expect(resolvePrevNext("/docs/a", NAV)).toEqual({
      prev: null,
      next: { title: "B", href: "/docs/b" },
    });
  });
  it("middle page has both", () => {
    expect(resolvePrevNext("/docs/b", NAV)).toEqual({
      prev: { title: "A", href: "/docs/a" },
      next: { title: "C", href: "/docs/c" },
    });
  });
  it("last page has prev, no next", () => {
    expect(resolvePrevNext("/docs/c", NAV)).toEqual({
      prev: { title: "B", href: "/docs/b" },
      next: null,
    });
  });
  it("unknown href returns nulls", () => {
    expect(resolvePrevNext("/docs/zzz", NAV)).toEqual({
      prev: null,
      next: null,
    });
  });
});
