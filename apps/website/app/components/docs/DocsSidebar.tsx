"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { docsNav } from "../../docs/_nav";

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs sections" className="flex flex-col">
      {docsNav.map((group) => (
        <div key={group.title} className="pt-5 first:pt-0">
          <p className="px-3 pb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim">
            {group.title}
          </p>
          <ul className="flex flex-col">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "block py-1.5 pl-3 text-[13px] border-l",
                      active
                        ? "border-l-2 -ml-px border-l-accent text-accent font-medium"
                        : "border-l-rule-soft text-text-secondary hover:text-text-primary hover:border-l-rule",
                    ].join(" ")}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
