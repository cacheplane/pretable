interface Logo {
  name: string;
  src: string;
  title?: string;
}

const FEATURED_LOGOS: readonly Logo[] = [
  { name: "Santander", src: "/brand-logos/santander.svg" },
  { name: "M&T Bank", src: "/brand-logos/m-and-t-bank.svg" },
  { name: "The Motley Fool", src: "/brand-logos/the-motley-fool.svg" },
  {
    name: "Grid Alpha",
    src: "/brand-logos/gridalpha-wordmark.svg",
    title: "yes, that Grid Alpha",
  },
  { name: "Google", src: "/brand-logos/google.svg" },
  { name: "FedEx", src: "/brand-logos/fedex.svg" },
  { name: "ClickUp", src: "/brand-logos/clickup.svg" },
  { name: "Runway", src: "/brand-logos/runway.svg" },
];

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

          {/* Logo marquee — duplicated so translateX(-50%) wraps seamlessly. */}
          <div
            className="mt-5 overflow-hidden border-y border-rule py-5 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
            aria-label="Featured customers"
          >
            <div className="pt-marquee-track flex w-max items-center">
              {[...FEATURED_LOGOS, ...FEATURED_LOGOS].map((logo, i) => (
                <img
                  key={i}
                  src={logo.src}
                  alt={i < FEATURED_LOGOS.length ? logo.name : ""}
                  title={logo.title}
                  aria-hidden={i >= FEATURED_LOGOS.length || undefined}
                  className="me-14 h-9 w-auto shrink-0 opacity-75 [filter:brightness(0)_invert(1)]"
                />
              ))}
            </div>
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
