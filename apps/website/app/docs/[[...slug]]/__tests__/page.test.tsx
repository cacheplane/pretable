// @vitest-environment jsdom

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

import Page, { generateMetadata } from "../page";

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

  it("renders distinct TechArticle and ordered BreadcrumbList data", async () => {
    const params = Promise.resolve({ slug: ["grid", "filtering"] });
    const metadata = await generateMetadata({ params });
    const ui = await Page({ params });
    const { container } = render(ui as React.ReactElement);
    const schemas = Array.from(
      container.querySelectorAll('script[type="application/ld+json"]'),
      (script) => JSON.parse(script.textContent ?? ""),
    );

    const article = schemas.find((schema) => schema["@type"] === "TechArticle");
    const breadcrumb = schemas.find(
      (schema) => schema["@type"] === "BreadcrumbList",
    );

    expect(metadata.alternates?.canonical).toBe(
      "https://pretable.ai/docs/grid/filtering",
    );
    expect(metadata.alternates?.types).toEqual({
      "text/markdown": "https://pretable.ai/docs/grid/filtering.md",
    });
    expect(metadata.other).toEqual({ "x-llms-txt": "/llms.txt" });
    expect(article).toMatchObject({
      url: "https://pretable.ai/docs/grid/filtering",
      headline: "Filtering",
      description: metadata.description,
    });
    expect(breadcrumb?.itemListElement).toEqual([
      {
        "@type": "ListItem",
        position: 1,
        name: "Grid",
        item: "https://pretable.ai/docs/grid",
      },
      {
        "@type": "ListItem",
        position: 2,
        name: "Filtering",
        item: "https://pretable.ai/docs/grid/filtering",
      },
    ]);
  });
});
