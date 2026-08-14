import type { ReactNode } from "react";

import { CodeSurface } from "./CodeSurface";

export interface CodeBlockProps {
  children: ReactNode;
  raw: string;
  filename?: string;
}

// No `lang` prop: with the header now showing a real filename when one is
// authored (via fence `title="…"` meta — see MdxRenderer's `Figure`), a bare
// language tag left the bar saying nothing a reader couldn't already see
// from the syntax highlighting. See the design doc's "one shared code
// surface" decision.
export function CodeBlock({ children, raw, filename }: CodeBlockProps) {
  return (
    <figure className="my-6 overflow-hidden rounded-md border border-rule bg-bg-card">
      <CodeSurface filename={filename} raw={raw} variant="fence" showCopy>
        {children}
      </CodeSurface>
    </figure>
  );
}
