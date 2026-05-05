import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Page from "../page";

describe("docs catch-all page", () => {
  it("renders frontmatter title for empty slug", async () => {
    const ui = await Page({
      params: Promise.resolve({ slug: undefined }),
      searchParams: Promise.resolve({}),
    });
    render(ui as React.ReactElement);
    const headings = screen.getAllByRole("heading", {
      level: 1,
      name: /Install \+ first grid/,
    });
    expect(headings.length).toBeGreaterThanOrEqual(1);
  });
});
