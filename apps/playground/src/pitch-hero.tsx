import { Receipt } from "@pretable/ui";

import { CopyCommand } from "./copy-command";

export function PitchHero() {
  return (
    <section className="bg-bg-page text-text-primary border-b border-rule px-7 py-16 md:px-10">
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-accent-deep">
          $ pretable — read-heavy wedge · vol. 1 · no. 4
        </p>
        <h1 className="mt-3 font-display text-[44px] leading-[1.02] tracking-[-0.025em] md:text-[60px] md:leading-none">
          the grid that treats <em className="italic text-accent-deep">scroll</em>{" "}
          as a first-class feature.
        </h1>
        <p className="mt-5 max-w-[760px] font-display text-[18px] leading-[1.44] text-text-secondary">
          Render 500k rows at <Receipt>60fps</Receipt>. Selection stays keyed by
          row id across filters. Every budget in the <Receipt>p99</Receipt>{" "}
          column is green.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#grid"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-[2px] bg-text-primary px-[18px] py-[12px] text-[13px] text-bg-card hover:bg-bg-raised focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Try the live playground ↓
          </a>
          <CopyCommand command="npm i @pretable/react" />
        </div>
      </div>
    </section>
  );
}
