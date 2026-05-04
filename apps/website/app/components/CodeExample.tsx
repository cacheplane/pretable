import { CodeBlock } from "./CodeBlock";
import { CodeTabs, type CodeTabsPanel } from "./CodeTabs";

interface TabSource {
  filename: string;
  lang: "ts" | "tsx";
  code: string;
}

const TABS: readonly TabSource[] = [
  {
    filename: "chat-grid.tsx",
    lang: "tsx",
    code: `"use client";
import { useEffect, useState } from "react";
import { connectElementStream } from "@pretable/stream-adapter";
import { Pretable } from "@pretable/react";
import { columns, type ChatRow } from "./columns";
import { openai } from "./openai-client";

export function ChatGrid({ prompt }: { prompt: string }) {
  const [rows, setRows] = useState<ChatRow[]>([]);

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

  return <Pretable rows={rows} columns={columns} getRowId={(r) => r.id} />;
}`,
  },
  {
    filename: "columns.ts",
    lang: "ts",
    code: `import type { PretableColumn } from "@pretable/react";

export interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  latencyMs: number;
}

export const columns: PretableColumn<ChatRow>[] = [
  { id: "role",      header: "Role",     widthPx: 100 },
  { id: "content",   header: "Content",  widthPx: 480, wrap: true },
  { id: "tokens",    header: "Tokens",   widthPx: 80 },
  { id: "latencyMs", header: "Latency",  widthPx: 100 },
];`,
  },
  {
    filename: "openai-client.ts",
    lang: "ts",
    code: `import OpenAI from "openai";

export const openai = new OpenAI();`,
  },
  {
    filename: "page.tsx",
    lang: "tsx",
    code: `import { ChatGrid } from "./chat-grid";

export default function Page() {
  return <ChatGrid prompt="Summarize the last 10 incidents" />;
}`,
  },
];

// Pre-render each tab's code via shiki at module load. Mirrors the existing
// CodeExample pattern (top-level await on a static snippet).
const PANELS: CodeTabsPanel[] = await Promise.all(
  TABS.map(async (tab) => ({
    filename: tab.filename,
    lang: tab.lang,
    html: await CodeBlock({ code: tab.code, lang: tab.lang }),
  })),
);

export function CodeExample() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · for engineers
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          For engineers: how it looks in your codebase.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Connect any token-streaming source — OpenAI Responses, Anthropic, or
          your own SSE — to a pretable grid. Selection survives every chunk.
        </p>

        <div className="mt-8">
          <CodeTabs panels={PANELS} />
        </div>

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
