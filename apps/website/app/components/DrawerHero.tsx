import { CopyCommand } from "./CopyCommand";
import { CopyPromptButton } from "./CopyPromptButton";

export const DRAWER_HERO_PROMPT = `Help me integrate @pretable/react — a high-performance streaming data
grid — into this React app.

Before writing code, ask me:
  1. Where should the grid live? (file path, route, or component name)
  2. What's the data source? (static array, REST, streaming, LLM tokens)
  3. What columns and row shape do you expect?

Then write a step-by-step implementation plan covering: install,
columns + getRowId setup, data wiring, and any streaming adapter
(use @pretable/stream-adapter for LLM / SSE sources). Wait
for my approval before implementing each step.

Docs: https://pretable.ai/docs
`;

export function DrawerHero() {
  return (
    <section
      id="hero"
      className="relative isolate border-b border-rule px-7 py-16 md:px-10 md:py-24"
    >
      <div className="mx-auto max-w-[860px] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          $ pretable — vol. 2 · no. 1
        </p>
        <h1 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] text-text-primary md:text-[56px] md:leading-none">
          The <em className="italic text-accent">fastest</em> data grid for
          React.
          <br />
          Built for the AI era.
        </h1>
        <p className="mx-auto mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          60fps under live market load. Zero row drift while an AI analyst
          streams wrapped commentary beside ticking prices — the grid built for
          live, AI-augmented data, not retrofitted from a batch-era table.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <CopyPromptButton prompt={DRAWER_HERO_PROMPT} />
          <CopyCommand command="npm install @pretable/react" />
          <a
            href="/docs"
            className="font-mono text-[13px] text-accent-deep underline-offset-2 hover:underline"
          >
            Read the docs →
          </a>
        </div>
        <p className="mt-8 font-mono text-[11px] text-text-muted">
          MIT licensed · open source
        </p>
        <p className="mt-2 font-mono text-[10px] text-text-muted">
          Demo uses illustrative, synthetic market data — not investment advice.
        </p>
      </div>
    </section>
  );
}
