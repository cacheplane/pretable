import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Problem } from "../../app/components/Problem";

afterEach(() => {
  cleanup();
});

it("renders the problem section with a heading", () => {
  const { container } = render(<Problem />);
  expect(container.querySelector("h2")).toBeInTheDocument();
});
