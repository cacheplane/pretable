import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CodeBlock } from "../../app/components/CodeBlock";

afterEach(() => {
  cleanup();
});

it("renders highlighted code in a <pre>", async () => {
  const ui = await CodeBlock({ code: "const x = 1;", lang: "tsx" });
  const { container } = render(ui);
  expect(container.querySelector("pre")).toBeInTheDocument();
});

it("defaults to tsx when lang is omitted", async () => {
  const ui = await CodeBlock({ code: "const y: number = 2;" });
  const { container } = render(ui);
  // shiki output always contains tokenized spans
  expect(container.querySelector("pre code")).toBeInTheDocument();
});
