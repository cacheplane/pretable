import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

// `Example` is an async Server Component (it awaits `loadExample` on disk
// and runs Shiki). Plain @testing-library/react `render` uses the client
// renderer, which cannot resolve async components at all — real Next.js
// resolves it fine through its RSC pipeline, but that pipeline isn't
// available here. `Example`'s own behavior is covered by
// `app/components/docs/mdx/__tests__/ExampleShell.test.tsx`; this file's
// job is only to verify CodeExample wires the right id/initial view and
// renders its surrounding chrome.
vi.mock("../../app/components/docs/mdx/Example", () => ({
  Example: (props: { id: string; initial?: string }) => (
    <div
      data-testid="example-stub"
      data-id={props.id}
      data-initial={props.initial}
    />
  ),
}));

import { CodeExample } from "../../app/components/CodeExample";

afterEach(() => {
  cleanup();
});

it("renders the streaming-chat-grid example opened to Code", () => {
  render(<CodeExample />);
  const stub = screen.getByTestId("example-stub");
  expect(stub).toHaveAttribute("data-id", "streaming-chat-grid");
  expect(stub).toHaveAttribute("data-initial", "code");
});

it("links to the streaming docs", () => {
  render(<CodeExample />);
  expect(
    screen.getByRole("link", { name: /\/docs\/streaming/ }),
  ).toHaveAttribute("href", "/docs/streaming");
});
