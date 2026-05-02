"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function isDocsPath(pathname: string | null): boolean {
  return !!pathname?.startsWith("/docs");
}

export function RouteAwareNav() {
  const pathname = usePathname();
  const onDocs = isDocsPath(pathname);

  return (
    <header
      className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between border-b border-rule-soft bg-bg-card/85 px-7 py-3 backdrop-blur-sm md:px-10"
      role="banner"
    >
      <Link className="flex items-center gap-2 font-mono text-[13px]" href="/">
        <span className="text-accent">●</span>
        <span className="font-semibold text-text-primary">pretable.ai</span>
      </Link>
      <nav className="flex items-center gap-5 font-mono text-[12px] text-text-muted">
        <Link
          className={onDocs ? "text-text-primary" : "hover:text-text-primary"}
          href="/docs"
        >
          /docs
        </Link>
        <a
          className="inline-flex items-center gap-1 hover:text-text-primary"
          href="https://github.com/cacheplane/pretable"
        >
          GitHub →
        </a>
      </nav>
    </header>
  );
}
