export type NavPage = "playground" | "bench" | "docs" | "github";

export interface NavCta {
  label: string;
  href: string;
}

export interface NavProps {
  active: NavPage;
  version?: string;
  githubStars?: number;
  cta?: NavCta;
  onSearchClick?: () => void;
  className?: string;
}

const LINKS: Array<{ id: NavPage; label: string; href: string }> = [
  { id: "playground", label: "playground", href: "/" },
  { id: "bench", label: "bench", href: "/bench" },
  { id: "docs", label: "docs", href: "/docs" },
  {
    id: "github",
    label: "github",
    href: "https://github.com/cacheplane/pretable",
  },
];

function formatStars(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k.toFixed(1)}k`;
  }
  return String(n);
}

export function Nav({
  active,
  version,
  githubStars,
  cta,
  onSearchClick,
  className,
}: NavProps) {
  const classes = ["pt-nav", className].filter(Boolean).join(" ");

  return (
    <header className={classes}>
      <div className="pt-nav-brand-cell">
        <span className="pt-nav-brand">
          pretable<span className="pt-nav-caret">.</span>
        </span>
        {version ? (
          <span className="pt-nav-version">
            v<b>{version}</b>
          </span>
        ) : null}
      </div>
      <nav className="pt-nav-links-cell" aria-label="Primary">
        {LINKS.map((link) => {
          const linkClass = [
            "pt-nav-link",
            link.id === active ? "active" : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <a key={link.id} className={linkClass} href={link.href}>
              {link.label}
            </a>
          );
        })}
      </nav>
      {onSearchClick ? (
        <button
          type="button"
          className="pt-nav-search"
          onClick={onSearchClick}
          aria-label="Search the docs"
        >
          <span className="pt-nav-search-icon" aria-hidden="true">
            ⌕
          </span>
          <span>Search the docs…</span>
          <span className="pt-nav-kbd">⌘K</span>
        </button>
      ) : null}
      <div className="pt-nav-right">
        {githubStars !== undefined ? (
          <span className="pt-nav-gh">
            <span className="pt-nav-star" aria-hidden="true">
              ★
            </span>
            <b>{formatStars(githubStars)}</b>
          </span>
        ) : null}
        {cta ? (
          <a className="pt-nav-cta" href={cta.href}>
            {cta.label}
          </a>
        ) : null}
      </div>
    </header>
  );
}
