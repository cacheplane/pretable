"use client";

import { CopyCommand } from "./CopyCommand";

const INSTALL_CMD = "npm install @pretable/react";

export function CtaSection() {
  return (
    <section id="cta" className="px-7 py-24 md:px-10 md:py-32 text-center">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
        Get started
      </p>
      <h2 className="mt-4 font-display text-[40px] leading-[1.05] tracking-[-0.025em] md:text-[56px] md:leading-none">
        One import. <em className="italic text-accent">Drop it in.</em>
      </h2>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <CopyCommand command={INSTALL_CMD} />
        <a
          className="inline-flex items-center gap-2 rounded-[2px] border border-text-primary bg-transparent px-[18px] py-[10px] font-mono text-[13px] text-text-primary hover:bg-bg-raised"
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
      </div>
      <p className="sr-only">{INSTALL_CMD}</p>
    </section>
  );
}
