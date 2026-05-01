import type { MDXComponents } from "mdx/types";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { CodeBlock } from "./app/components/CodeBlock";

interface CodeProps {
  children?: string;
  className?: string;
}

// Extract the inner <code> element from MDX's `<pre><code>...</code></pre>` shape.
// Returns null for any shape we don't expect (raw <pre>, multi-child, fragments)
// so the caller can fall through to the default <pre> render.
function extractCodeChild(children: ReactNode): ReactElement<CodeProps> | null {
  if (Array.isArray(children) || typeof children === "string") return null;
  return isValidElement<CodeProps>(children) ? children : null;
}

// Next 16 calls this to obtain the global MDX component map. Per-page overrides
// are not used at this scope.
export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    pre: ({ children }) => {
      // MDX wraps fenced code blocks as <pre><code className="language-xxx">...</code></pre>.
      // For anything else (raw <pre> HTML, plugin-injected siblings, fragments),
      // fall back to the default <pre> render.
      const codeEl = extractCodeChild(children);
      if (!codeEl) return <pre>{children}</pre>;

      const rawClass = codeEl.props.className ?? "";
      const lang = rawClass.replace(/^language-/, "") || "tsx";
      const source = codeEl.props.children ?? "";
      return <CodeBlock code={source} lang={lang} />;
    },
  };
}
