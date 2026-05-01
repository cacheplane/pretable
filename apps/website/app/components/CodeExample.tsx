import { codeToHtml } from "shiki";

const SNIPPET = `import {
  connectElementStream,
} from "@pretable-internal/stream-adapter";
import { PretableGrid } from "@pretable/react";
import OpenAI from "openai";

export function ChatGrid() {
  const [rows, setRows] = useState([]);
  const stream = await openai.responses.stream({
    model: "gpt-5",
    input: prompt,
  });

  connectElementStream(stream, {
    onElement: (row) => setRows((r) => [...r, row]),
  });

  return <PretableGrid rows={rows} columns={columns} />;
}`;

// shiki theming: github-dark works well against the cool-slate page gradient.
// Server-side highlight at module load — pre-rendered HTML ships in the React
// tree, no client JS for highlighting.
const HIGHLIGHTED = await codeToHtml(SNIPPET, {
  lang: "tsx",
  theme: "github-dark",
});

export function CodeExample() {
  return (
    <section className="text-text-primary px-7 py-24 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · the import
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          One import. Stream tokens into a stable grid.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Connect any token-streaming source — OpenAI Responses, Anthropic, or
          your own SSE — to a pretable grid. Selection survives every chunk.
        </p>

        <div
          className="mt-8 overflow-x-auto rounded-[6px] border border-grid-rule bg-grid-bg p-4 font-mono text-[13px] leading-[1.6] [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:bg-transparent"
          dangerouslySetInnerHTML={{ __html: HIGHLIGHTED }}
        />

        <p className="mt-5 font-mono text-[12px] text-text-muted">
          Full example:{" "}
          <a
            href="https://github.com/cacheplane/pretable/tree/main/apps/streaming-demo"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            apps/streaming-demo
          </a>
        </p>
      </div>
    </section>
  );
}
