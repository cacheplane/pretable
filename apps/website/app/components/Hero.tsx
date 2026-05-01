import { AmbientBlob } from "./AmbientBlob";
import { CopyCommand } from "./CopyCommand";

export function Hero() {
  return (
    <section className="relative isolate px-7 py-24 md:py-32 lg:py-40">
      <AmbientBlob className="absolute -top-32 left-1/2 -translate-x-1/2 size-[640px]" />
      <div className="relative mx-auto max-w-[860px] text-center">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          $ pretable — vol. 2 · no. 1
        </p>
        <h1 className="mt-4 font-display text-[40px] leading-[1.02] tracking-[-0.025em] text-text-primary md:text-[56px] md:leading-none">
          The grid that treats <em className="italic text-accent">scroll</em> as
          a first-class feature.
        </h1>
        <p className="mx-auto mt-5 max-w-[56ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          500k rows. 60fps scroll. Selection survives filters. Built on a
          deterministic engine you can read.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#grid"
            className="inline-flex items-center gap-2 rounded-[4px] bg-accent px-5 py-2.5 text-[13px] font-semibold text-bg-page hover:bg-accent-deep focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
          >
            Try it live ↓
          </a>
          <CopyCommand command="npm i @pretable/react" />
        </div>
      </div>
    </section>
  );
}
