import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// `Example` is an async Server Component (it awaits `loadExample` on disk and
// runs Shiki). Plain @testing-library/react `render` uses the client
// renderer, which cannot resolve async components at all ("Only Server
// Components can be async at the moment") — real Next.js resolves it fine
// through its RSC pipeline, but this smoke test isn't that pipeline and
// doesn't care about the code example section's internals, so it's stubbed
// out here rather than left to abort the whole tree.
vi.mock("../app/components/docs/mdx/Example", () => ({
  Example: () => <div data-testid="example-stub" />,
}));

import HomePage from "../app/page";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-drawer");
});

it("renders the home page without crashing", () => {
  const { container } = render(<HomePage />);
  expect(container.firstChild).toBeInTheDocument();
});

it("renders content from multiple sections", () => {
  const { container } = render(<HomePage />);
  // Cheap assertion: page produces non-trivial DOM.
  expect(container.textContent?.length ?? 0).toBeGreaterThan(100);
});

it("renders the drawer shell", () => {
  render(<HomePage />);
  expect(screen.getByTestId("drawer-shell")).toBeInTheDocument();
});
