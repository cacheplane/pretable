import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const withMDX = createMDX({
  options: {
    // remark-gfm: GitHub-flavored markdown — tables (| col | col |), strikethrough,
    // task lists, autolinks. Without it, pipe syntax renders as raw paragraphs.
    // remark-frontmatter: parses YAML frontmatter (--- blocks) so it doesn't leak
    // into rendered output as <hr> + <h2>. We don't consume the metadata yet —
    // this just removes it from the AST.
    // Plugin names are passed as strings for Turbopack serializability.
    // shiki still runs inside <CodeBlock> via mdx-components.
    remarkPlugins: [
      ["remark-gfm", {}],
      ["remark-frontmatter", "yaml"],
    ],
  },
});

const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ["ts", "tsx", "mdx"],
  async headers() {
    return [
      {
        source: "/docs/:path*",
        headers: [{ key: "Link", value: '</llms.txt>; rel="llms-txt"' }],
      },
    ];
  },
};

export default withMDX(config);
