import { DEFAULT_EXAMPLE_HEIGHT } from "../../../../lib/docs/examples/define";
import { exampleDemos } from "../../../../lib/docs/examples/demos.generated";
import { loadExample } from "../../../../lib/docs/examples/registry";
import type { ExampleId } from "../../../../lib/docs/examples/registry.generated";
import { toMarkdown } from "../../../../lib/docs/examples/serialize";
import { examplePath } from "../../../../lib/docs/examples/urls";
import { ExampleShell } from "./ExampleShell";

export interface ExampleProps {
  id: ExampleId;
  /** Open on the source when the code, not the behavior, is the lesson. */
  initial?: "preview" | "code";
}

export async function Example({ id, initial }: ExampleProps) {
  const example = await loadExample(id);
  const Demo = exampleDemos[id];
  return (
    <ExampleShell
      title={example.meta.title}
      description={example.meta.description}
      height={example.meta.height ?? DEFAULT_EXAMPLE_HEIGHT}
      files={example.files.map((f) => ({
        path: f.path,
        lang: f.lang,
        source: f.source,
        html: f.html,
      }))}
      agentMarkdown={toMarkdown(example)}
      mdHref={examplePath(id)}
      initial={initial ?? (Demo ? "preview" : "code")}
    >
      {Demo ? <Demo /> : null}
    </ExampleShell>
  );
}
