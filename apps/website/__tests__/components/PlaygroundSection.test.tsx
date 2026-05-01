import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { PlaygroundSection } from "../../app/components/PlaygroundSection";

afterEach(() => {
  cleanup();
});

it("renders the playground section with a grid container", () => {
  const { container } = render(<PlaygroundSection />);
  // Section renders the grid surface inside an element with id="grid".
  expect(container.querySelector("#grid")).toBeInTheDocument();
});
