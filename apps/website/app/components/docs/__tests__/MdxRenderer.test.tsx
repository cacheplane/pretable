import { fireEvent, render, screen } from "@testing-library/react";
import { compileMDX } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { describe, expect, it, vi } from "vitest";

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

  it("falls back to the fence's own language when there is no title=", async () => {
    // End-to-end through the real compile pipeline, which is the only thing
    // that proves `data-language` is actually present on the compiled
    // `<code>` for `Pre` to thread through — a hand-built element tree would
    // just assert our own assumption back at us.
    await renderFence(["```css", ":root { --y: 2; }", "```"].join("\n"));
    expect(screen.getByRole("button", { name: /copy/i })).toBeInTheDocument();
    expect(document.querySelectorAll("figure")).toHaveLength(1);
    const header = screen
      .getByRole("button", { name: /copy/i })
      .closest("div")!;
    expect(header).toHaveTextContent(/^css/i);
  });

  it("copies the fence's real source, not an empty string", async () => {
    // The defect this pins: `Pre` derived `raw` with
    // `typeof codeProps.children === "string" ? … : ""`, and that ternary can
    // never take its true branch — rehype-pretty-code replaces the `<code>`'s
    // string child with per-token `<span>`s. Every fence in the docs copied 0
    // characters. Measured on production before the fix.
    //
    // Every other case in `CodeBlock.test.tsx` passes `raw` explicitly, which
    // is why they all passed while the button did nothing: they exercise the
    // copy plumbing and never the derivation. This one goes through the real
    // compile pipeline, so the children are token spans exactly as they ship.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const source = ["const a = 1;", "  const b = 2;"].join("\n");
    await renderFence(["```ts", source, "```"].join("\n"));

    fireEvent.click(screen.getByRole("button", { name: /copy/i }));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).not.toBe("");
    // Indentation must survive too — it is what the `<pre>` fix exists to keep.
    expect(copied).toContain("  const b = 2;");
    expect(copied.split("\n")).toEqual(["const a = 1;", "  const b = 2;"]);
  });

  it("prefers a fence's title= over its language", async () => {
    await renderFence(
      ['```css title="brand.css"', ":root { --x: 1; }", "```"].join("\n"),
    );
    const header = screen
      .getByRole("button", { name: /copy/i })
      .closest("div")!;
    expect(header).toHaveTextContent(/^brand\.css/);
    expect(header.textContent).not.toMatch(/brand\.css\s*css/i);
  });

  it("highlights the fence's actual code", async () => {
    await renderFence(["```ts", "export const answer = 42;", "```"].join("\n"));
    expect(screen.getByText(/answer/)).toBeInTheDocument();
  });
});
