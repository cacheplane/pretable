"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface DocsSidebarLinkProps {
  href: string;
  children: React.ReactNode;
}

export function DocsSidebarLink({ href, children }: DocsSidebarLinkProps) {
  const pathname = usePathname();
  const active = pathname === href;
  const className = [
    "block rounded-[3px] px-2 py-1 text-[14px] transition-colors",
    active
      ? "bg-bg-raised text-text-primary"
      : "text-text-secondary hover:text-text-primary",
  ].join(" ");
  return (
    <Link
      href={href}
      className={className}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </Link>
  );
}
