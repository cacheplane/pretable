interface Stat {
  value: string;
  caption: string;
}

// Receipts snapshot — numbers from two committed milestone runsets:
//
//   status/milestones/2026-05-01-h1-satisfied.hypotheses.json
//     S2/scroll/hypothesis × 3 repeats. H1 satisfied.
//
//   status/milestones/2026-05-01-streaming-revalidated.hypotheses.json
//     S5/updates × 6 rates × 3 repeats. H15 satisfied.
//
// "4.6× vs Grid Alpha" is the real comparative win — wrapped-text scroll p95
// at hypothesis scale (Pretable 9.3ms vs Grid Alpha 42.5ms, three repeats).
// "0 long tasks / streaming" holds across the full 100–25k operating
// envelope. The page must not lie.
const STATS: readonly Stat[] = [
  { value: "4.6×", caption: "faster scroll vs gridalpha" },
  { value: "9.3ms", caption: "frame p95 / wrapped scroll" },
  { value: "0", caption: "long tasks / streaming" },
  { value: "25k/s", caption: "max sustained update rate" },
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
      </div>
    </section>
  );
}
