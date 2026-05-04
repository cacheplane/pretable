interface Card {
  heading: string;
  body: React.ReactNode;
}

const CARDS: readonly Card[] = [
  {
    heading: "One shape, one path",
    body: (
      <>
        <code className="font-mono text-[12px] text-text-primary">
          applyTransaction(&#123; add, update, remove &#125;)
        </code>{" "}
        is the only entry point into the engine. Static rows hit it via{" "}
        <code className="font-mono text-[12px] text-text-primary">add()</code>;
        SSE tokens hit it via the same method per chunk. The streaming adapter
        is a thin batcher around that interface — not a separate code path.
      </>
    ),
  },
  {
    heading: "Selection survives every patch",
    body: (
      <>
        Row-id keys are first-class in the engine. Sort, filter, scroll
        position, focused row — none of it loses state mid-stream. Drag-select
        200 rows during a 25k/sec patch storm and they stay selected.
      </>
    ),
  },
];

export function StreamingByDesign() {
  return (
    <section
      id="streaming-by-design"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · streaming, by design
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Built streaming-first.{" "}
          <em className="italic text-accent">Not bolted-on.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Most grids accept streaming through an adapter layered onto a
          batch-era data model. Pretable's engine treats a 1,000-patch/sec
          stream and a static 3,000-row array as the same input shape — one
          reducer, one render path, one selection model. There's no "streaming
          mode" toggle.
        </p>

        <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {CARDS.map((card) => (
            <li
              key={card.heading}
              className="rounded-[8px] border border-rule bg-bg-card p-6"
            >
              <h3 className="font-display text-[18px] tracking-[-0.01em] text-text-primary">
                {card.heading}
              </h3>
              <p className="mt-3 font-display text-[14px] leading-[1.55] text-text-secondary">
                {card.body}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-8 font-mono text-[12px] text-text-muted">
          <a
            href="/docs/streaming"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            API reference → /docs/streaming
          </a>
        </p>
      </div>
    </section>
  );
}
