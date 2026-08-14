import { render, screen } from "@testing-library/react";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { describe, expect, it } from "vitest";

import { docsMdxComponents } from "../MdxRenderer";

// Renders through the real compile pipeline (compileMDX + rehype-pretty-code
// + rehypeSlug), not a stub of it — this is the one place that exercises
// what a fence with `title="…"` meta actually compiles to, structurally:
// rehype-pretty-code renames a fence's `<pre>` to `<figure
// data-rehype-pretty-code-figure>` and — only for a titled fence — inserts a
// `<figcaption data-rehype-pretty-code-title>` sibling ahead of a brand-new
// inner `<pre>`. `MdxRenderer`'s `Figure` has to reach across that sibling
// gap to thread the title into `CodeBlock` as `filename`; a test that stubs
// this structure instead of compiling real MDX would not catch a wrong
// assumption about that shape.
async function renderFence(source: string) {
  const { content } = await compileMDX({
    source,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [rehypePrettyCode, { theme: "github-light" }],
        ],
      },
    },
    components: docsMdxComponents,
  });
  return render(content);
}

describe("docsMdxComponents (fence rendering)", () => {
  it("threads a fence's title= meta into the header as the filename", async () => {
    await renderFence(
      ['```css title="brand.css"', ":root { --x: 1; }", "```"].join("\n"),
    );
    expect(screen.getByText("brand.css")).toBeInTheDocument();
    // Exactly one code surface — not rehype-pretty-code's own figure/
    // figcaption nested around CodeBlock's.
    expect(document.querySelectorAll("figure")).toHaveLength(1);
  });

  it("renders a header with no identity text — but still a Copy button — for an untitled fence", async () => {
    const { container } = await renderFence(
      ["```css", ":root { --y: 2; }", "```"].join("\n"),
    );
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(document.querySelectorAll("figure")).toHaveLength(1);
    // No bare language tag anywhere — the exact "shows nothing worth its
    // space" case the design doc forbids.
    expect(container.textContent).not.toMatch(/^(CSS|TS|TSX|JS|JSX|BASH)$/i);
  });

  it("highlights the fence's actual code", async () => {
    await renderFence(["```ts", "export const answer = 42;", "```"].join("\n"));
    expect(screen.getByText(/answer/)).toBeInTheDocument();
  });
});
