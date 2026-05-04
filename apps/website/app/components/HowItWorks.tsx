import { LayerStack, type LayerStackItem } from "./LayerStack";
import { LAYERS } from "./howItWorksLayers";
import { PipelineDiagram } from "./PipelineDiagram";

interface Callout {
  heading: string;
  body: React.ReactNode;
}

const CALLOUTS: readonly Callout[] = [
  {
    heading: "Built for agentic apps.",
    body: (
      <>
        LLM streams, partial JSON, tool-call traces — bursts of 100 to 25,000
        patches/sec all collapse to one snapshot per animation frame. No
        per-token reflow. Selection survives every patch.
      </>
    ),
  },
  {
    heading: "Engine is a pure function.",
    body: (
      <>
        <code className="font-mono text-[11.5px] text-text-primary">
          (rows, columns, sort, filter, selection) → Snapshot
        </code>
        . No imperative DOM. Streaming patches and batch arrays hit the same
        reducer — that's why selection survives every update.
      </>
    ),
  },
  {
    heading: "RAF batches the stream.",
    body: (
      <>
        100 to 25,000 patches/sec all collapse to one snapshot per animation
        frame. Long tasks: zero across the operating envelope.
      </>
    ),
  },
  {
    heading: "Telemetry stays off-DOM.",
    body: (
      <>
        Render counts, viewport range, planned height — all data emitted by the
        engine, never read from the DOM. Zero measurement-induced thrash.
      </>
    ),
  },
];

export function HowItWorks() {
  return (
    <section className="text-text-primary px-7 py-16 md:px-10 md:py-28">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          02 · how it works
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          DOM measuring sucks. We use math.{" "}
          <em className="italic text-accent">It's hard.</em>
        </h2>
        <p className="mt-5 max-w-[65ch] font-display text-[15px] leading-[1.6] text-text-secondary">
          Wrapped row heights are computed with character-width tables and font
          metrics — pure arithmetic. No{" "}
          <code className="font-mono text-[13.5px] text-text-primary">
            getBoundingClientRect
          </code>
          , no forced reflow, no measure-on-mount. The DOM is touched exactly
          once per frame, at commit. The five-stage pipeline below is what
          enforces that discipline.
        </p>

        <PipelineDiagram />

        <LayerStack
          testId="howitworks-layers"
          className="mt-6 flex flex-col gap-2"
          items={LAYERS.map(
            (layer): LayerStackItem => ({
              key: layer.num,
              // All cards use the same neutral border. The core-stage hint is
              // carried by the dot+glow on the number column, not the border.
              className:
                "grid grid-cols-[44px_1fr] gap-4 rounded-[6px] border border-rule bg-bg-card/65 p-5 md:grid-cols-[56px_1fr_auto] md:gap-5 md:p-6",
              children: (
                <>
                  <div className="flex flex-col items-center gap-2 pt-1">
                    <span className="font-mono text-[11px] font-bold tracking-[0.1em] text-text-dim">
                      {layer.num}
                    </span>
                    <span
                      aria-hidden="true"
                      className={[
                        "block h-2 w-2 rounded-full",
                        layer.core
                          ? "bg-accent shadow-[0_0_0_4px_color-mix(in_srgb,var(--pt-accent)_12%,transparent)]"
                          : "bg-text-dim",
                      ].join(" ")}
                    />
                  </div>
                  <div>
                    <h3 className="font-display text-[18px] leading-[1.2] text-text-primary">
                      {layer.name}
                    </h3>
                    <p className="mt-1 font-display text-[13px] leading-[1.5] text-text-secondary">
                      {layer.responsibility}
                    </p>
                    <ul role="list" className="mt-3 flex flex-col gap-1">
                      {layer.bullets.map((bullet, i) => (
                        <li
                          key={i}
                          className="relative pl-4 text-[12.5px] leading-[1.55] text-text-muted"
                        >
                          <span
                            aria-hidden="true"
                            className="absolute left-0 text-accent opacity-70"
                          >
                            ▸
                          </span>
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="col-span-full flex flex-row items-center gap-2 pl-12 pt-2 md:col-auto md:flex-col md:items-end md:gap-2 md:pl-0 md:pt-0">
                    <span className="rounded-[3px] border border-rule bg-bg-raised/50 px-2 py-0.5 font-mono text-[10px] text-text-secondary">
                      <span className="text-text-dim">→ </span>
                      {layer.output}
                    </span>
                    <span className="rounded-[3px] border border-accent/20 bg-accent/8 px-2.5 py-1 font-mono text-[11px] text-accent">
                      {layer.pkg}
                    </span>
                  </div>
                </>
              ),
            }),
          )}
        />

        <ul
          role="list"
          data-testid="howitworks-callouts"
          className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2"
        >
          {CALLOUTS.map((callout) => (
            <li
              key={callout.heading}
              className="rounded-[4px] border border-rule border-l-2 border-l-accent bg-bg-card/50 p-4 md:p-5"
            >
              <h4 className="font-display text-[15px] leading-[1.25] text-text-primary">
                {callout.heading}
              </h4>
              <p className="mt-1.5 font-display text-[12.5px] leading-[1.55] text-text-secondary">
                {callout.body}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-5 font-mono text-[12px] text-text-muted">
          <span className="text-text-dim">↳ </span>
          Read the source:{" "}
          <a
            href="https://github.com/cacheplane/pretable/tree/main/packages"
            className="text-accent underline decoration-dotted underline-offset-[3px] hover:text-accent-deep"
          >
            packages/grid-core, layout-core, text-core, renderer-dom
          </a>{" "}
          — under 3,000 lines combined.
        </p>
      </div>
    </section>
  );
}
