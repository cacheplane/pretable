import type { MDXComponents } from "mdx/types";

import { CodeBlock } from "./mdx/CodeBlock";

interface PreProps {
  children: React.ReactElement<{
    children?: string;
    className?: string;
    "data-language"?: string;
  }>;
  "data-rehype-pretty-code-figure"?: string;
}

function Pre(props: PreProps) {
  const codeProps = props.children.props;
  const raw = typeof codeProps.children === "string" ? codeProps.children : "";
  const lang = codeProps["data-language"];
  return (
    <CodeBlock raw={raw} lang={lang}>
      {props.children}
    </CodeBlock>
  );
}

export const docsMdxComponents: MDXComponents = {
  pre: Pre as unknown as MDXComponents["pre"],
};
