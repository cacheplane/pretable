import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { CodeExample } from "../../app/components/CodeExample";

afterEach(() => {
  cleanup();
});

it("renders a tablist with the four expected file tabs", async () => {
  const ui = await CodeExample();
  render(ui);
  expect(screen.getByRole("tablist")).toBeInTheDocument();
  for (const filename of [
    "chat-grid.tsx",
    "columns.ts",
    "openai-client.ts",
    "page.tsx",
  ]) {
    expect(
      screen.getByRole("tab", { name: new RegExp(filename) }),
    ).toBeInTheDocument();
  }
});

it("defaults to the chat-grid tab and renders highlighted code", async () => {
  const ui = await CodeExample();
  const { container } = render(ui);
  const active = container.querySelector('[role="tab"][aria-selected="true"]');
  expect(active?.textContent ?? "").toMatch(/chat-grid\.tsx/);
  expect(container.querySelector('[role="tabpanel"] pre')).toBeInTheDocument();
});
