import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { DocsSidebar } from "../../app/components/DocsSidebar";
import { docsNav } from "../../app/docs/_nav";

afterEach(() => {
  cleanup();
});

// The sidebar renders two parallel structures (mobile <details> + desktop
// <nav>) so each viewport gets its natural pattern. Tests assert per-tree
// counts: one section heading and one item link inside each.

it("renders a heading for every section in _nav, in each tree", () => {
  const { container } = render(<DocsSidebar />);
  const headings = container.querySelectorAll("h3");
  expect(headings.length).toBe(docsNav.length * 2);
});

it("renders a link for every item in every section, in each tree", () => {
  const { container } = render(<DocsSidebar />);
  const totalItems = docsNav.reduce(
    (acc, section) => acc + section.items.length,
    0,
  );
  const links = container.querySelectorAll("a");
  expect(links.length).toBe(totalItems * 2);
});

it("renders two nav landmarks (mobile + desktop), both labeled 'Docs'", () => {
  const { container } = render(<DocsSidebar />);
  const navs = container.querySelectorAll("nav");
  expect(navs.length).toBe(2);
  for (const nav of navs) {
    expect(nav).toHaveAttribute("aria-label", "Docs");
  }
});

it("renders a <details> with a custom marker on the mobile tree", () => {
  const { container } = render(<DocsSidebar />);
  const details = container.querySelector("details");
  expect(details).toBeInTheDocument();
  const summary = details?.querySelector("summary");
  expect(summary).toBeInTheDocument();
  // Marker is an aria-hidden span, so the assertion is structural.
  const marker = summary?.querySelector('[aria-hidden="true"]');
  expect(marker).toBeInTheDocument();
});
