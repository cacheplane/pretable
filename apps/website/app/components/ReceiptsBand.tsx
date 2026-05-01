interface Stat {
  value: string;
  caption: string;
}

// Receipts snapshot — numbers from the streaming rate sweep documented at
// docs/superpowers/specs/2026-04-30-streaming-rate-envelope.md and the
// scroll-side comparative work in PR #15 (H1 + H13). Source of truth:
// status/runsets/*.hypotheses.json from `pnpm bench:matrix`.
//
// The previous version had four placeholder values. The most egregious was
// "4.1× vs ag-grid" — real bench data shows Pretable and AG Grid are
// essentially tied on streaming frame p95 (9 vs 10 ms). Replaced with a
// receipt that actually holds: zero jank events under streaming load
// (Pretable's stream-adapter batches via RAF, no long tasks across the
// full 100–25k operating envelope).
const STATS: readonly Stat[] = [
  { value: "500k", caption: "rows rendered (S7 target)" },
  { value: "9ms", caption: "frame p95 / streaming" },
  { value: "0", caption: "long tasks / streaming" },
  { value: "25k/s", caption: "max sustained update rate" },
];

export function ReceiptsBand() {
  return (
    <section className="text-text-primary border-b border-rule px-7 py-[52px] md:px-10">
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
