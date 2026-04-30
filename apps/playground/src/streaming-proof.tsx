import { Receipt } from "@pretable/ui";

interface StreamingMetric {
  value: string;
  caption: string;
}

// Real numbers from H13 (S5 streaming-updates, hypothesis scale, 3 repeats,
// merged in PR #15). The hypothesis report at status/runsets/ is the source
// of truth; these get refreshed when bench:matrix re-runs.
const METRICS: readonly StreamingMetric[] = [
  { value: "9ms", caption: "frame p95 (≤ 16ms budget)" },
  { value: "0", caption: "long tasks" },
  { value: "1k/s", caption: "updates sustained" },
];

export function StreamingProof() {
  return (
    <section className="bg-bg-page text-text-primary border-b border-rule px-7 py-[52px] md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent-deep">
          Wedge · streaming
        </p>
        <h2 className="mt-3 font-display text-[36px] leading-[1.08] tracking-[-0.02em] md:text-[44px]">
          Stream <em className="italic text-accent-deep">tokens</em>.
          <br className="hidden md:block" /> Render <Receipt>500 rows</Receipt>{" "}
          in 30s.
        </h2>
        <p className="mt-5 max-w-[760px] font-display text-[18px] leading-[1.44] text-text-secondary">
          An OpenAI Responses stream, parsed live, batched on{" "}
          <Receipt>requestAnimationFrame</Receipt>, applied to the same grid
          that proved it scrolls. The frame budget stays under one 60Hz frame.
        </p>
        <ul className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {METRICS.map((metric) => (
            <li
              key={metric.caption}
              className="border-t border-text-primary pt-3"
            >
              <div className="font-display text-[36px] leading-[1] tracking-[-0.02em] md:text-[44px]">
                {metric.value}
              </div>
              <div className="mt-1 font-mono text-[12px] text-text-secondary">
                {metric.caption}
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-8">
          <a
            href="/streaming/"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-[2px] bg-text-primary px-[18px] py-[12px] text-[13px] text-bg-card hover:bg-bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Watch it stream →
          </a>
        </div>
      </div>
    </section>
  );
}
