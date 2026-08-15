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
    children?: ReactNode;
    className?: string;
    "data-language"?: string;
  }>;
  /** Injected by `Figure` below, never by rehype-pretty-code itself — see there. */
  filename?: string;
}

/**
 * The fence's source text, recovered by walking the highlighted tree.
 *
 * This used to read `typeof codeProps.children === "string" ? … : ""`. That
 * ternary can never take its true branch: rehype-pretty-code replaces the
 * `<code>`'s string child with per-token `<span>`s, so `raw` was `""` on every
 * fence in the docs and the Copy button silently put nothing on the clipboard.
 * Measured on production: a fence displaying real code copied 0 characters.
 *
 * `CodeBlock.test.tsx` could not catch it — every case there passes `raw`
 * explicitly, so the tests exercise the copy plumbing but never the derivation.
 * The test added alongside this fix feeds token `<span>`s instead.
 *
 * The newlines are already there as text nodes between the line elements —
 * verified, after an earlier version of this walk appended one per `data-line`
 * and produced a blank line between every real line. Plain concatenation is
 * correct; do not "restore" the separator.
 */
function fenceText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(fenceText).join("");
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode };
    return fenceText(props.children);
  }
  return "";
}

function Pre({ children, filename }: PreProps) {
  const codeProps = children.props;
  // Trailing newlines, plural: rehype-pretty-code emits a final empty
  // `data-line` for the fence's closing newline, so the walk yields one more
  // than the source had.
  const raw = fenceText(codeProps.children).replace(/\n+$/, "");
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
