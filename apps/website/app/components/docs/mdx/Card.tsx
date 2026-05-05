import Link from "next/link";
import type { ReactNode } from "react";

export function CardGroup({
  cols = 2,
  children,
}: {
  cols?: 1 | 2 | 3;
  children: ReactNode;
}) {
  const grid = { 1: "grid-cols-1", 2: "md:grid-cols-2", 3: "md:grid-cols-3" }[
    cols
  ];
  return (
    <div className={`my-6 grid grid-cols-1 gap-3 ${grid}`}>{children}</div>
  );
}

export function Card({
  title,
  href,
  children,
}: {
  title: string;
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-[4px] border border-rule bg-bg-card/50 p-4 hover:border-rule"
    >
      <h4 className="font-display text-[15px] text-text-primary">{title}</h4>
      <p className="mt-1 text-[13px] text-text-secondary">{children}</p>
    </Link>
  );
}
