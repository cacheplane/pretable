import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import DocsIndex from "../../../app/docs/page.mdx";

afterEach(() => {
  cleanup();
});

it("renders the docs index with an h1", () => {
  const { container } = render(<DocsIndex />);
  expect(container.querySelector("h1")).toBeInTheDocument();
});

it("links to the getting-started guide", () => {
  const { container } = render(<DocsIndex />);
  const link = container.querySelector('a[href="/docs/getting-started"]');
  expect(link).toBeInTheDocument();
});
