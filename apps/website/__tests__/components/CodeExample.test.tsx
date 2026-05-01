import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CodeExample } from "../../app/components/CodeExample";

afterEach(() => {
  cleanup();
});

it("renders the code example block with content", async () => {
  const ui = await CodeExample();
  const { container } = render(ui);
  // CodeExample uses shiki to render highlighted code in a <pre>.
  expect(container.querySelector("pre")).toBeInTheDocument();
});
