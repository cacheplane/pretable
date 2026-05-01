import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const withMDX = createMDX({
  // No remark/rehype plugins yet; shiki runs inside our <CodeBlock> component.
});

const config: NextConfig = {
  reactStrictMode: true,
  pageExtensions: ["ts", "tsx", "mdx"],
};

export default withMDX(config);
