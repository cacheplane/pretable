import { streamingChatGrid } from "../../content/examples/streaming-chat-grid";
import { Example } from "./docs/mdx/Example";

export function CodeExample() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          06 · for engineers
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          For engineers: how it looks in your codebase.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Connect any token-streaming source — OpenAI Responses, Anthropic, or
          your own SSE — to a pretable grid. Selection survives every chunk.
        </p>
        <div className="mt-8">
          <Example example={streamingChatGrid} defaultOpen showLive />
        </div>
        <p className="mt-5 font-mono text-[12px] text-text-muted">
          Full reference:{" "}
          <a
            href="/docs/streaming"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            /docs/streaming
          </a>
        </p>
      </div>
    </section>
  );
}
