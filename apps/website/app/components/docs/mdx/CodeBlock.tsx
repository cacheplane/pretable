import type { ReactNode } from "react";

import { CodeSurface } from "./CodeSurface";

export interface CodeBlockProps {
  children: ReactNode;
  raw: string;
  /** From the fence's `title="…"` meta, threaded by `MdxRenderer`'s `Figure`. */
  filename?: string;
  /** From rehype-pretty-code's `data-language`, threaded by `MdxRenderer`'s `Pre`. */
  language?: string;
}

// Titles where practicable, falling back to the language tag. The original
// call was to show nothing rather than a lone language tag — but that assumed
// some fences would be titled, and none were: all 139 carried a language and
// zero carried a title, so every fence header rendered as a blank band with a
// Copy button floated at its right. A quiet language label is worth more than
// an empty bar. See the design doc's "identity in the header" decision.
export function CodeBlock({
  children,
  raw,
  filename,
  language,
}: CodeBlockProps) {
  return (
    <figure className="my-6 overflow-hidden rounded-md border border-rule bg-bg-card">
      <CodeSurface
        filename={filename}
        language={language}
        raw={raw}
        variant="fence"
        showCopy
      >
        {children}
      </CodeSurface>
    </figure>
  );
}
