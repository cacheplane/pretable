interface Logo {
  name: string;
  className: string;
}

const FEATURED_LOGOS: readonly Logo[] = [
  { name: "Santander", className: "font-display text-[18px] font-semibold" },
  { name: "M&T Bank", className: "font-display text-[18px] font-semibold" },
  { name: "The Motley Fool", className: "font-display text-[18px] italic" },
  {
    name: "Grid Alpha",
    className:
      "font-display text-[18px] font-semibold text-accent underline decoration-dotted underline-offset-4",
  },
];

const OTHER_LOGOS = "+ Google · FedEx · ClickUp · Runway";

export function TrustStrip() {
  return (
    <section className="px-7 py-12 md:px-10 md:py-16">
      <div className="mx-auto max-w-[1240px]">
        <div className="rounded-[10px] border border-rule border-t-2 border-t-accent bg-bg-card/55 p-7 md:p-8">
          {/* Pills row */}
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/8 px-3 py-1.5 font-mono text-[11px] text-text-secondary">
              <span className="font-bold text-accent">G</span> Google Developer
              Experts
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/6 px-3 py-1.5 font-mono text-[11px] text-text-secondary">
              cacheplane, Inc.
            </span>
          </div>

          {/* Attribution headline */}
          <p className="mt-4 max-w-[64ch] font-display text-[17px] leading-[1.4] text-text-primary">
            Pretable is built by{" "}
            <strong className="font-semibold text-accent">cacheplane</strong> —
            Google Developer Experts behind production data and analytics
            interfaces at:
          </p>

          {/* Logo row */}
          <div className="mt-5 flex flex-wrap items-center gap-x-9 gap-y-4 border-y border-rule py-4">
            {FEATURED_LOGOS.map((logo) => (
              <span
                key={logo.name}
                className={logo.className}
                title={
                  logo.name === "Grid Alpha" ? "yes, that Grid Alpha" : undefined
                }
              >
                {logo.name}
              </span>
            ))}
            <span className="font-mono text-[12px] text-text-muted">
              {OTHER_LOGOS}
            </span>
          </div>

          {/* Cheeky Grid Alpha line */}
          <p className="mt-3.5 font-mono text-[11px] italic text-accent">
            <span className="text-text-dim not-italic">↳ </span>
            yes, <em className="italic">that</em> Grid Alpha. We helped build the
            grid we're now competing with.
          </p>
        </div>
      </div>
    </section>
  );
}
