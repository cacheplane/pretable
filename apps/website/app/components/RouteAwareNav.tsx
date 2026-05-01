"use client";

import { Nav, type NavPage } from "@pretable/ui";
import { usePathname } from "next/navigation";

interface RouteAwareNavProps {
  version?: string;
}

function activeFromPathname(pathname: string | null): NavPage {
  if (pathname?.startsWith("/docs")) return "docs";
  return "website";
}

export function RouteAwareNav({ version }: RouteAwareNavProps) {
  const pathname = usePathname();
  return <Nav active={activeFromPathname(pathname)} version={version} />;
}
