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
      // Keys ExampleShell to the example id, not just its position in the
      // tree: if a parent ever reconciles a different id into the same JSX
      // position (e.g. a caller that swaps `id` via state), `active` would
      // otherwise survive the swap while `files` didn't, and `files[active]`
      // could point past the new example's file list. A `key` change forces
      // a fresh mount instead of a broken reuse.
      key={id}
      title={example.meta.title}
      description={example.meta.description}
      height={example.meta.height ?? DEFAULT_EXAMPLE_HEIGHT}
      // Re-shaped rather than passed through: `LoadedFile.focusLines` only
      // exists to compute `.line-focus` classes into `html` at load time
      // (see load.ts) — the client shell only ever reads `path`/`lang`/
      // `source`/`html`, so shipping `focusLines` too would be dead weight
      // in every page's RSC payload for no reader-visible effect.
      files={example.files.map((f) => ({
        path: f.path,
        lang: f.lang,
        source: f.source,
        html: f.html,
      }))}
      // Level 1, matching `mdHref`'s standalone route: "Copy for agent"
      // puts this same bundle on the clipboard for pasting into an agent
      // chat, where it's read as its own document rather than as a
      // fragment of the docs page it was copied from — same reasoning as
      // the per-example route, see serialize.ts's `headingLevel` doc.
      agentMarkdown={toMarkdown(example, { headingLevel: 1 })}
      mdHref={examplePath(id)}
      initial={initial ?? (Demo ? "preview" : "code")}
    >
      {/*
        The demo crosses the server/client boundary as a rendered element
        (children), never as `Demo` itself: React can serialize an already-
        rendered Server Component tree across that boundary, but not a
        component *type* — `<ExampleShell demo={Demo} />` would ask
        ExampleShell (a Client Component) to call a function reference it
        received from the server, which isn't something the RSC wire format
        can carry. Instantiating it here, on the server side of the
        boundary, and handing ExampleShell the result sidesteps that
        entirely.
      */}
      {Demo ? <Demo /> : null}
    </ExampleShell>
  );
}
