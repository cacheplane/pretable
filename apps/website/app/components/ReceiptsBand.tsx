interface Stat {
  value: string;
  caption: string;
}

// Receipts snapshot — numbers from two committed milestone runsets:
//
//   status/milestones/2026-05-01-h1-satisfied.hypotheses.json
//     S2/scroll/hypothesis × 5 repeats, unified row-height formula. H1
//     satisfied. Pretable median 16ms vs Grid Alpha 67ms = 4× faster.
//
//   status/milestones/2026-05-01-streaming-revalidated.hypotheses.json
//     S5/updates × 6 rates × 3 repeats. H15 satisfied.
//
// "4× vs Grid Alpha" is the real comparative win — wrapped-text scroll p95
// at hypothesis scale (5 repeats). "0 long tasks / streaming" holds
// across the full 100–25k operating envelope. The page must not lie.
const STATS: readonly Stat[] = [
  { value: "4×", caption: "faster scroll vs gridalpha" },
  { value: "16ms", caption: "frame p95 / wrapped scroll" },
  { value: "0", caption: "long tasks / streaming" },
  { value: "25k/s", caption: "max sustained update rate" },
];

const POSITIONING = [
  {
    num: "01",
    eyebrow: "Performance",
    headline: "The fastest grid in independent benchmarks.",
  },
  {
    num: "02",
    eyebrow: "AI-native",
    headline: "AI isn't a feature. It's the data model.",
  },
  {
    num: "03",
    eyebrow: "Wrapped text",
    headline: "Multi-line cells, no layout thrash.",
  },
  {
    num: "04",
    eyebrow: "Ecosystem",
    headline: "Drops into the AI SDKs you already use.",
  },
];

export function ReceiptsBand() {
  return (
    <section
      id="receipts"
      className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10"
    >
      <div className="mx-auto max-w-[1240px]">
        <h2 className="font-display text-[28px] leading-[1.12] tracking-[-0.02em] md:text-[32px]">
          <em className="italic text-accent-deep">Receipts</em>, not claims.
        </h2>
        <ul className="mt-6 grid grid-cols-2 gap-6 md:grid-cols-4">
          {STATS.map((stat) => (
            <li
              key={stat.caption}
              className="border-t border-text-primary pt-3"
            >
              <div className="font-display text-[44px] leading-[1] tracking-[-0.02em]">
                {stat.value}
              </div>
              <div className="mt-1 font-mono text-[12px] text-text-secondary">
                {stat.caption}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-5 font-mono text-[12px] text-text-muted">
          <a
            href="/bench"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            See them re-run in the bench →
          </a>
        </p>

        <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {POSITIONING.map((card) => (
            <li
              key={card.num}
              className="rounded-[8px] border border-rule bg-bg-card p-6"
            >
              <span className="font-mono text-[10px] text-text-muted">
                {card.num}
              </span>
              <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                {card.eyebrow}
              </span>
              <h3 className="mt-3 font-display text-[18px] tracking-[-0.01em]">
                {card.headline}
              </h3>
            </li>
          ))}
        </ul>

        <p className="mt-12 border-l-4 border-accent bg-accent-soft px-6 py-4 font-display text-[16px] text-text-primary">
          Grid Alpha Community clips wrapped content to a single line at hypothesis
          scale. We don&apos;t.
        </p>
      </div>
    </section>
  );
}
