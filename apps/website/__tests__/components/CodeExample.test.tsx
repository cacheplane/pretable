import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CodeExample } from "../../app/components/CodeExample";

afterEach(() => {
  cleanup();
});

it("renders the live demo by default", () => {
  render(<CodeExample />);
  expect(screen.getByText(/streaming chat grid — live/i)).toBeInTheDocument();
});

it("show source disclosure reveals tabs for each example file", () => {
  render(<CodeExample />);
  // defaultOpen=true, so tabs should be visible immediately
  for (const filename of [
    "page.tsx",
    "ChatGrid.tsx",
    "columns.ts",
    "openai-client.ts",
  ]) {
    expect(
      screen.getByRole("tab", { name: filename }),
    ).toBeInTheDocument();
  }
});

it("links to the streaming docs", () => {
  render(<CodeExample />);
  expect(
    screen.getByRole("link", { name: /\/docs\/streaming/ }),
  ).toHaveAttribute("href", "/docs/streaming");
});
