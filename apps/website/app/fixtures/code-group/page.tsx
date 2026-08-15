import { compileMDX } from "next-mdx-remote/rsc";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import { docsMdxComponents } from "../../components/docs/MdxRenderer";

/**
 * Test fixture for `apps/website/e2e/docs-code-group.spec.ts`.
 *
 * `<CodeGroup>` labels each tab from the code surface it wraps. That label
 * used to be read off `p.props["data-language"]`, which can never resolve, and
 * every tab rendered as `tab 1` / `tab 2`. The read was replaced with a
 * bounded search for the surface's own `filename` / `language` props — but
 * nothing proved the replacement works, for two reasons that this route
 * exists to remove.
 *
 * The first is that `<CodeGroup>` appears on zero pages under `content/docs`,
 * so unlike `<Tabs>` there was no live page to check it against.
 *
 * The second is the one that matters. The bug is a property of the React
 * Server Components boundary, and jsdom cannot model that boundary. `Figure`,
 * `Pre` and `CodeBlock` are server components, so React renders them on the
 * server and serialises their OUTPUT: what actually reaches `<CodeGroup>` —
 * a `"use client"` module — is a host `<figure>` wrapping a `CodeSurface`
 * client reference, with `filename` and `language` on that inner element
 * rather than on the child `<CodeGroup>` was handed. Under `compileMDX` in a
 * plain vitest tree there is no client boundary at all, the server components
 * run inline, and a test can pass against a tree the browser never builds.
 * That is not hypothetical: the `<Tabs>` unit test passed for years on
 * `child.type === Tab` while the real page rendered nothing whatsoever (see
 * the note on `isTab` in `mdx/Tabs.tsx`).
 *
 * So this page compiles MDX the way `lib/docs/load.ts` compiles a docs page —
 * `compileMDX` with rehype-pretty-code, through `docsMdxComponents` — from a
 * server component, which is what puts the real boundary between the compiled
 * fences and `<CodeGroup>`. It deliberately does NOT import `CodeGroup`
 * directly or render it from a client component; either would rebuild the
 * jsdom blind spot in a browser instead of closing it.
 *
 * The two fences are chosen to discriminate. The first carries `title=`, so
 * its tab must read `grid.ts` — the `filename` branch. The second carries none,
 * so its tab must read `python` — the `language` branch, and a language that
 * appears nowhere else on the page. Neither can be confused with the `tab N`
 * fallback, and neither can be satisfied by the other branch.
 *
 * Deliberately not part of the product surface; `app/fixtures/layout.tsx`
 * keeps it out of search engines.
 */
const MDX_SOURCE = [
  "<CodeGroup>",
  "",
  '```ts title="grid.ts"',
  "export const columns = [{ id: 'symbol' }];",
  "```",
  "",
  "```python",
  "columns = [{'id': 'symbol'}]",
  "```",
  "",
  "</CodeGroup>",
].join("\n");

export default async function CodeGroupFixturePage() {
  const { content } = await compileMDX({
    source: MDX_SOURCE,
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

  return (
    <main style={{ padding: 24 }}>
      <h1>CodeGroup fixture</h1>
      {content}
    </main>
  );
}
