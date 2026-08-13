import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// `Example` is an async Server Component (it awaits `loadExample` on disk
// and runs Shiki). Plain @testing-library/react `render` uses the client
// renderer, which cannot resolve async components at all — real Next.js
// resolves it fine through its RSC pipeline, but that pipeline isn't
// available here. `getting-started/index.mdx` (the empty-slug page below)
// embeds `<Example id="first-grid" />`, so it's stubbed out the same way
// `__tests__/page.test.tsx` (homepage) and `CodeExample.test.tsx` do.
vi.mock("../../../components/docs/mdx/Example", () => ({
  Example: () => <div data-testid="example-stub" />,
}));

import Page from "../page";

describe("docs catch-all page", () => {
  it("renders frontmatter title for empty slug", async () => {
    const ui = await Page({
      params: Promise.resolve({ slug: undefined }),
    });
    render(ui as React.ReactElement);
    const headings = screen.getAllByRole("heading", {
      level: 1,
      name: /Install \+ first grid/,
    });
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });
});
