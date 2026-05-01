import { CodeBlock } from "./CodeBlock";

const SNIPPET = `"use client";
import { useEffect, useState } from "react";
import { connectElementStream } from "@pretable-internal/stream-adapter";
import { PretableGrid } from "@pretable/react";
import { columns } from "./columns";
import { openai } from "./openai-client";

export function ChatGrid({ prompt }: { prompt: string }) {
  const [rows, setRows] = useState([]);

  useEffect(() => {
    void (async () => {
      const stream = await openai.responses.stream({
        model: "gpt-5",
        input: prompt,
      });
      connectElementStream(stream, {
        onElement: (row) => setRows((r) => [...r, row]),
      });
    })();
  }, [prompt]);

  return <PretableGrid rows={rows} columns={columns} />;
}`;

// Evaluate CodeBlock once at module load so CodeExample can remain synchronous.
// This mirrors the pre-refactor pattern where codeToHtml was awaited at the top
// level. CodeExample.test.tsx uses `await CodeExample()` which still works — the
// await is harmless on a non-async function.
const CODE_BLOCK_UI = await CodeBlock({ code: SNIPPET, lang: "tsx" });

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

        <div className="mt-8">{CODE_BLOCK_UI}</div>

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
