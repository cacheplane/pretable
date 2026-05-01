interface UseCase {
  num: string;
  icon: string;
  eyebrow: string;
  headline: string;
  body: string;
  chips: readonly string[];
  variant?: "financial";
}

const USE_CASES: readonly UseCase[] = [
  {
    num: "01",
    icon: "⌗",
    eyebrow: "Use case 01",
    headline: "AI-driven analytics dashboards.",
    body: "Your product asks an LLM to summarize, classify, or rank data. Results stream into a table users actually scroll, sort, and filter. Selection survives the next streaming patch.",
    chips: ["OpenAI Responses", "Vercel AI SDK", "Anthropic"],
  },
  {
    num: "02",
    icon: "⤳",
    eyebrow: "Use case 02",
    headline: "Agent traces and tool-call output.",
    body: "LangGraph or your own agent runtime emits structured events — node transitions, tool calls, intermediate state. Pretable renders the live trace as it happens.",
    chips: ["LangGraph", "CrewAI", "your own SSE"],
  },
  {
    num: "03",
    icon: "$",
    eyebrow: "Use case 03",
    headline: "Real-time financial dashboards.",
    body: "Trading floors, portfolio analytics, risk monitors — thousands of patches/sec, multi-line annotations, no row drift when the market moves. The dashboards capital-markets and asset-management teams already need.",
    chips: ["Market data feeds", "WebSocket", "Server-Sent Events"],
    variant: "financial",
  },
];

export function UseCases() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          02 · built for
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          If you're shipping <em className="italic text-accent">live data</em>,
          you're shipping this.
        </h2>

        <ul
          role="list"
          className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-5"
        >
          {USE_CASES.map((uc) => {
            const isFinancial = uc.variant === "financial";
            const cardClass = [
              "flex flex-col gap-3 rounded-[8px] p-6 md:p-7",
              isFinancial
                ? "border border-accent/40 bg-bg-card/85"
                : "border border-rule bg-bg-card/65",
            ].join(" ");
            return (
              <li key={uc.num} className={cardClass}>
                <span
                  className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-accent/30 bg-accent/12 font-mono text-[16px] text-accent"
                  aria-hidden="true"
                >
                  {uc.icon}
                </span>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent">
                  {uc.eyebrow}
                </p>
                <h3 className="font-display text-[18px] leading-[1.2] text-text-primary">
                  {uc.headline}
                </h3>
                <p className="font-display text-[13px] leading-[1.55] text-text-secondary">
                  {uc.body}
                </p>
                <ul
                  role="list"
                  className="mt-2 flex flex-wrap gap-1.5 border-t border-rule pt-3"
                >
                  {uc.chips.map((chip) => (
                    <li
                      key={chip}
                      className="rounded-[3px] border border-rule bg-bg-raised/60 px-2 py-1 font-mono text-[10px] text-text-secondary"
                    >
                      {chip}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
