interface Card {
  num: string;
  eyebrow: string;
  headline: string;
  body: React.ReactNode;
}

const CARDS: readonly Card[] = [
  {
    num: "01",
    eyebrow: "Performance",
    headline: "The fastest grid in independent benchmarks.",
    body: (
      <>
        9 ms frame p95 under 1,000 patches/sec streaming load. Zero long tasks.
        Zero row drift. Verifiable:{" "}
        <code className="font-mono text-[13px] text-accent">
          pnpm bench:matrix
        </code>{" "}
        against AG Grid, TanStack Virtual, MUI X.
      </>
    ),
  },
  {
    num: "02",
    eyebrow: "AI-native",
    headline: "AI isn't a feature. It's the data model.",
    body: (
      <>
        Pretable's engine was designed around streaming and partial data — the
        shape AI agents and live feeds actually produce. Most grids retrofit a
        streaming adapter onto a batch-era data model. Pretable doesn't.
      </>
    ),
  },
  {
    num: "03",
    eyebrow: "Wrapped text",
    headline: "Multi-line cells, no layout thrash.",
    body: (
      <>
        Auto-height rows with wrapped content — at 60fps under streaming. No
        row-jump on hover, no layout shift on scroll, no row-height recalc churn
        when an agent writes longer text mid-stream. Most grids force fixed
        heights to avoid this.
      </>
    ),
  },
  {
    num: "04",
    eyebrow: "Ecosystem",
    headline: "Drops into the AI SDKs you already use.",
    body: (
      <>
        Vercel AI SDK · OpenAI Responses · Anthropic streams · LangGraph · your
        own SSE. One import. The streaming pipeline is purpose-built — every
        other grid leaves it to you.
      </>
    ),
  },
];

export function PositioningStrip() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <ul
          role="list"
          className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5"
        >
          {CARDS.map((card) => (
            <li
              key={card.num}
              className="relative rounded-[8px] border border-rule bg-bg-card/65 p-6 md:p-7"
            >
              <span className="absolute right-4 top-4 font-mono text-[10px] text-text-dim">
                {card.num}
              </span>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                {card.eyebrow}
              </p>
              <h3 className="mt-3 font-display text-[19px] leading-[1.2] tracking-[-0.015em] text-text-primary">
                {card.headline}
              </h3>
              <p className="mt-2 font-display text-[14px] leading-[1.55] text-text-secondary">
                {card.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
