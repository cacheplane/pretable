import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import GettingStarted from "../../../app/docs/getting-started/page.mdx";

afterEach(() => {
  cleanup();
});

it("renders an h1", () => {
  const { container } = render(<GettingStarted />);
  expect(container.querySelector("h1")).toBeInTheDocument();
});

it("includes the install command", () => {
  const { container } = render(<GettingStarted />);
  expect(container.textContent ?? "").toContain("npm i @pretable/react");
});
