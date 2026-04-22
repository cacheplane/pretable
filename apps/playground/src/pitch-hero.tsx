import { Receipt } from "@pretable/ui";

import { CopyCommand } from "./copy-command";

export function PitchHero() {
  return (
    <section className="bg-cream text-ink border-b border-cream-rule px-7 py-16 md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-amber-ink">
          $ pretable — read-heavy wedge · vol. 1 · no. 4
        </p>
        <h1 className="mt-3 font-display text-[44px] leading-[1.02] tracking-[-0.025em] md:text-[60px] md:leading-none">
          the grid that treats{" "}
          <em className="italic text-amber-ink">scroll</em>{" "}
          as a first-class feature.
        </h1>
        <p className="mt-5 max-w-[760px] font-display text-[18px] leading-[1.44] text-ink-dim">
          Render 500k rows at <Receipt>60fps</Receipt>. Selection stays keyed by
          row id across filters. Every budget in the{" "}
          <Receipt>p99</Receipt> column is green.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#grid"
            className="inline-flex items-center gap-2 rounded-[2px] bg-ink px-[18px] py-[10px] text-[13px] text-cream-hi hover:bg-ink/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-ink focus-visible:ring-offset-2 focus-visible:ring-offset-cream"
          >
            Try the live playground ↓
          </a>
          <CopyCommand command="npm i @pretable/react" />
        </div>
      </div>
    </section>
  );
}
