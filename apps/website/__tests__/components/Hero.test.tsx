import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Hero } from "../../app/components/Hero";

afterEach(() => {
  cleanup();
});

it("renders the hero with a heading", () => {
  const { container } = render(<Hero />);
  expect(container.querySelector("h1")).toBeInTheDocument();
});
