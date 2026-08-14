import { Children, isValidElement, type ReactNode } from "react";

import type { MDXComponents } from "mdx/types";

import { Callout } from "./mdx/Callout";
import { Card, CardGroup } from "./mdx/Card";
import { CodeBlock } from "./mdx/CodeBlock";
import { CodeGroup } from "./mdx/CodeGroup";
import { Example } from "./mdx/Example";
import { Frame } from "./mdx/Frame";
import { Prompt } from "./mdx/Prompt";
import { Step, Steps } from "./mdx/Steps";
import { Tab, Tabs } from "./mdx/Tabs";

interface PreProps {
  children: React.ReactElement<{
    children?: string;
    className?: string;
    "data-language"?: string;
  }>;
  /** Injected by `Figure` below, never by rehype-pretty-code itself — see there. */
  filename?: string;
}

function Pre({ children, filename }: PreProps) {
  const codeProps = children.props;
  const raw = typeof codeProps.children === "string" ? codeProps.children : "";
  // Threaded explicitly rather than sniffed off the DOM downstream: the
  // language is a prop of the compiled `<code>` node right here, and
  // `CodeSurface` should not have to reach into its own children to find the
  // identity it renders. It is the fallback when the fence carries no
  // `title=` — see `CodeBlock`.
  return (
    <CodeBlock
      raw={raw}
      filename={filename}
      language={codeProps["data-language"]}
    >
      {children}
    </CodeBlock>
  );
}

/**
 * rehype-pretty-code renames every fenced block's `<pre>` node to `<figure
 * data-rehype-pretty-code-figure>`, in place, and — only when the fence's
 * meta string carries `title="…"` — inserts a `<figcaption
 * data-rehype-pretty-code-title>` sibling ahead of a brand-new inner `<pre>`
 * holding the actual highlighted code. That inner `<pre>` is what our own
 * `pre` mapping (`Pre` above) receives; the title text lives one level up,
 * on this sibling, which `Pre` has no way to see on its own.
 *
 * This component is that one level up. It pulls the title (if any) off the
 * figcaption and clones it onto the `Pre` element as `filename`, then
 * renders only that clone — dropping rehype-pretty-code's own figure/
 * figcaption wrapper entirely, since `CodeBlock` already renders the
 * figure/header this codebase wants. Confirmed against the actual compiled
 * output (not just the plugin source) before writing this.
 */
function Figure(props: {
  children?: ReactNode;
  "data-rehype-pretty-code-figure"?: string;
}) {
  if (props["data-rehype-pretty-code-figure"] === undefined) {
    // Not a rehype-pretty-code figure (shouldn't occur given how `pre` is
    // always block-level code here) — render children as-is rather than
    // silently dropping content.
    return <>{props.children}</>;
  }
  let filename: string | undefined;
  let preElement: React.ReactElement<PreProps> | undefined;
  for (const child of Children.toArray(props.children)) {
    if (!isValidElement(child)) continue;
    const childProps = child.props as Record<string, unknown>;
    if (childProps["data-rehype-pretty-code-title"] !== undefined) {
      filename =
        typeof childProps.children === "string"
          ? childProps.children
          : undefined;
    } else if (child.type === Pre) {
      preElement = child as React.ReactElement<PreProps>;
    }
  }
  if (!preElement) return null;
  return <Pre {...preElement.props} filename={filename} />;
}

export const docsMdxComponents: MDXComponents = {
  pre: Pre as unknown as MDXComponents["pre"],
  figure: Figure as unknown as MDXComponents["figure"],
  Callout,
  Steps,
  Step,
  Tabs,
  Tab,
  CodeGroup,
  Card,
  CardGroup,
  Frame,
  Prompt,
  Example,
};
