import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

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
