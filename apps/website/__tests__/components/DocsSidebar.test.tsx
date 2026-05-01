import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { DocsSidebar } from "../../app/components/DocsSidebar";
import { docsNav } from "../../app/docs/_nav";

afterEach(() => {
  cleanup();
});

it("renders a heading for every section in _nav", () => {
  const { container } = render(<DocsSidebar />);
  const headings = container.querySelectorAll("h3");
  expect(headings.length).toBe(docsNav.length);
});

it("renders a link for every item in every section", () => {
  const { container } = render(<DocsSidebar />);
  const totalItems = docsNav.reduce(
    (acc, section) => acc + section.items.length,
    0,
  );
  const links = container.querySelectorAll("a");
  expect(links.length).toBe(totalItems);
});

it("renders a nav landmark with an accessible name", () => {
  const { container } = render(<DocsSidebar />);
  const nav = container.querySelector("nav");
  expect(nav).toBeInTheDocument();
  expect(nav).toHaveAttribute("aria-label", "Docs");
});
