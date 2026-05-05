import Link from "next/link";

import type { PrevNext } from "../../../lib/docs/prev-next";

export function DocsPrevNext({ prev, next }: PrevNext) {
  if (!prev && !next) return null;
  return (
    <nav
      aria-label="Page navigation"
      className="mt-12 flex items-center justify-between gap-4 border-t border-rule pt-6"
    >
      {prev ? (
        <Link
          href={prev.href}
          className="group flex flex-col text-text-secondary hover:text-text-primary"
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
            ← Prev
          </span>
          <span className="font-display text-[14px]">{prev.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          href={next.href}
          className="group flex flex-col items-end text-text-secondary hover:text-text-primary"
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
            Next →
          </span>
          <span className="font-display text-[14px]">{next.title}</span>
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
