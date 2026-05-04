import { LAYERS } from "./howItWorksLayers";

// 4 arrow labels = the 4 output shapes that flow between the 5 stages.
// LAYERS[i].output is what STAGE i emits to STAGE i+1; we map the first
// four (Source..Renderer) onto the arrows. Frame's output ("60fps") is
// the terminal result and is not an arrow label.
const ARROW_LABELS = LAYERS.slice(0, -1).map((layer) => layer.output);

export function PipelineDiagram() {
  return (
    <div
      data-testid="pipeline-diagram"
      role="group"
      aria-label="Pretable's render pipeline"
      className="mt-10 rounded-[10px] border border-rule bg-bg-card/40 p-5 md:p-7"
    >
      <ol
        role="list"
        className="flex flex-col items-stretch gap-3 md:flex-row md:items-center md:gap-2"
      >
        {LAYERS.map((layer, i) => (
          <li key={layer.num} className="contents">
            {/* Stage box */}
            <div className="relative flex min-w-0 flex-1 flex-col rounded-[8px] border border-rule bg-bg-card px-4 py-3">
              {layer.core && (
                <span
                  aria-hidden="true"
                  className="absolute right-2 top-2 block h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--pt-accent)_15%,transparent)]"
                />
              )}
              <span className="font-mono text-[10px] tracking-[0.1em] text-text-dim">
                {layer.num}
              </span>
              <span className="mt-1 font-display text-[16px] leading-[1.15] text-text-primary">
                {layer.name}
              </span>
              <span className="mt-2 truncate font-mono text-[10px] text-accent">
                {layer.pkg}
              </span>
            </div>

            {/* Arrow + output-shape label between stages, except after the last */}
            {i < ARROW_LABELS.length && (
              <div className="flex flex-row items-center justify-center gap-2 px-1 md:flex-col md:gap-0.5">
                <span className="font-mono text-[10px] text-text-muted">
                  {ARROW_LABELS[i]}
                </span>
                <span aria-hidden="true" className="text-accent">
                  <span className="md:hidden">↓</span>
                  <span className="hidden md:inline">→</span>
                </span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
