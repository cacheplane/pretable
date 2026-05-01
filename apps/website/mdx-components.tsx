import type { MDXComponents } from "mdx/types";

import { CodeBlock } from "./app/components/CodeBlock";

// Next 16 calls this to obtain the global MDX component map. Per-page overrides
// are not used at this scope.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    pre: ({ children }) => {
      // MDX wraps fenced code blocks in <pre><code className="language-xxx">...</code></pre>.
      // Drop the <pre> wrapper and route the inner <code> through <CodeBlock>.
      // The child is a single <code> element by MDX convention.
      const codeEl = children as React.ReactElement<{
        children: string;
        className?: string;
      }>;
      const className = codeEl?.props?.className ?? "";
      const lang = className.replace(/^language-/, "") || "tsx";
      const source = codeEl?.props?.children ?? "";
      return <CodeBlock code={source} lang={lang} />;
    },
  };
}
