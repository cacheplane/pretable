export type CiStatus = "green" | "amber" | "red";

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterProps {
  version: string;
  ciStatus: CiStatus;
  links?: FooterLink[];
  year?: number;
  className?: string;
}

export function Footer({
  version,
  ciStatus,
  links = [],
  year = new Date().getFullYear(),
  className,
}: FooterProps) {
  const classes = ["pt-footer", className].filter(Boolean).join(" ");
  const dotClass = `pt-footer-ci pt-footer-ci-${ciStatus}`;
  return (
    <footer className={classes}>
      <div className="pt-footer-left">
        <span>
          <b>pretable</b> · v{version}
        </span>
        <span>© {year} · MIT</span>
        <span>
          ci:{" "}
          <span className={dotClass} aria-hidden="true">
            ●
          </span>{" "}
          {ciStatus}
        </span>
      </div>
      <div className="pt-footer-right">
        {links.map((link) => (
          <a key={link.label} href={link.href}>
            {link.label}
          </a>
        ))}
      </div>
    </footer>
  );
}
