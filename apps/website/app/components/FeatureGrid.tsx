import { TrailMarker, type TrailMarkerVariant } from "./TrailMarker";

interface Feature {
  title: string;
  description: string;
  marker: TrailMarkerVariant;
  markerLabel: string;
}

const FEATURES: readonly Feature[] = [
  {
    title: "60fps performance",
    description:
      "Sub-frame scroll p95 on wrapped text — at parity with the best full-grid comparator (MUI X) and ~1.7× ahead of AG Grid Community and TanStack. Zero blank gaps, zero anchor shift, ≤1 px row-height drift.",
    marker: "green",
    markerLabel: "Beginner-friendly",
  },
  {
    title: "Wrapped text, no jank",
    description:
      "Multi-line cells, variable row heights, smooth scrolling. Multilingual content tested.",
    marker: "blue",
    markerLabel: "Intermediate setup",
  },
  {
    title: "Stream-aware",
    description:
      "Token-by-token rendering for OpenAI, Anthropic, your own SSE — sustained from 100 to 25,000 updates/sec.",
    marker: "black",
    markerLabel: "Advanced — bring your own SSE",
  },
  {
    title: "Selection survives filters",
    description:
      "Filter, sort, and reorder without losing your selection. Stable focus across mutations.",
    marker: "blue",
    markerLabel: "Intermediate — interaction state",
  },
];

export function FeatureGrid() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          07 · what's in the box
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Engineering credibility points.
        </h2>
        <p className="mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Each feature backed by a bench scenario or demo. No claim without a
          click-to-prove.
        </p>

        <ul role="list" className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="border-t border-rule pt-5">
              <div className="flex items-center gap-3">
                <TrailMarker
                  variant={feature.marker}
                  label={feature.markerLabel}
                />
                <h3 className="font-display text-[20px] tracking-[-0.01em] text-text-primary">
                  {feature.title}
                </h3>
              </div>
              <p className="mt-3 text-text-secondary leading-[1.55]">
                {feature.description}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
