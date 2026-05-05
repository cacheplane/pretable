import type { MDXComponents } from "mdx/types";

import { Callout } from "./mdx/Callout";
import { Card, CardGroup } from "./mdx/Card";
import { CodeBlock } from "./mdx/CodeBlock";
import { CodeGroup } from "./mdx/CodeGroup";
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
};
