import type { DocsHeading } from "../../../lib/docs/extract-headings";

export function DocsTOC({ headings }: { headings: DocsHeading[] }) {
  if (headings.length === 0) return null;
  return (
    <nav aria-labelledby="toc-label">
      <p
        id="toc-label"
        className="mb-3 font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim"
      >
        On this page
      </p>
      <ul className="flex flex-col gap-1">
        {headings.map((h) => (
          <li key={h.slug} className={h.depth === 3 ? "pl-4" : ""}>
            <a
              className="text-[12.5px] text-text-secondary hover:text-text-primary"
              href={`#${h.slug}`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
