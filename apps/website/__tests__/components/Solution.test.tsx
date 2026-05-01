import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Solution } from "../../app/components/Solution";

afterEach(() => {
  cleanup();
});

it("renders the solution section with a heading", () => {
  const { container } = render(<Solution />);
  expect(container.querySelector("h2")).toBeInTheDocument();
});
