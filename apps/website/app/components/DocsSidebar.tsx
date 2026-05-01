import { docsNav } from "../docs/_nav";

import { DocsSidebarLink } from "./DocsSidebarLink";

export function DocsSidebar() {
  return (
    <aside className="md:sticky md:top-24 md:self-start">
      <details open className="md:[&>summary]:hidden">
        <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
          Documentation
        </summary>
        <nav aria-label="Docs" className="mt-4 md:mt-0">
          {docsNav.map((section) => (
            <div key={section.title} className="mt-6 first:mt-0">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
                {section.title}
              </h3>
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <DocsSidebarLink href={item.href}>
                      {item.title}
                    </DocsSidebarLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </details>
    </aside>
  );
}
