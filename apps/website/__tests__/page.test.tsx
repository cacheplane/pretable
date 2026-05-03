import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { ControlStateProvider } from "../app/components/heroGrid/controlState";
import HomePage from "../app/page";

afterEach(() => {
  cleanup();
});

it("renders the home page without crashing", () => {
  const { container } = render(
    <ControlStateProvider>
      <HomePage />
    </ControlStateProvider>,
  );
  expect(container.firstChild).toBeInTheDocument();
});

it("renders content from multiple sections", () => {
  const { container } = render(
    <ControlStateProvider>
      <HomePage />
    </ControlStateProvider>,
  );
  // Cheap assertion: page produces non-trivial DOM. If any section throws on
  // mount, this fails before reaching the length check.
  expect(container.textContent?.length ?? 0).toBeGreaterThan(100);
});
