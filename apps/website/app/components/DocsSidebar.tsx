import { docsNav } from "../docs/_nav";

import { DocsSidebarLink } from "./DocsSidebarLink";

// Sidebar renders two structures so mobile and desktop each get their natural
// pattern without one constraining the other:
//
// - Mobile (`<details>`, default closed): tap "Documentation" to expand. Custom
//   marker (› closed / rotates 90° when [open]) replaces the browser default ▼.
// - Desktop (plain <nav>): always visible. We can't share one <details> across
//   both viewports because Chromium implements <details> with Shadow DOM and
//   slots its non-summary children behind `display:none` when closed — CSS on
//   the light-tree children can't override that. Two trees keep semantics
//   correct on each side; `md:hidden` / `hidden md:block` removes the inactive
//   tree from the a11y tree.
//
// The shared `SidebarNav` keeps the section/item rendering DRY.

function SidebarNav() {
  return (
    <nav aria-label="Docs">
      {docsNav.map((section) => (
        <div key={section.title} className="mt-6 first:mt-0">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted">
            {section.title}
          </h3>
          <ul className="mt-2 space-y-1">
            {section.items.map((item) => (
              <li key={item.href}>
                <DocsSidebarLink href={item.href}>{item.title}</DocsSidebarLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function DocsSidebar() {
  return (
    <aside className="md:sticky md:top-24 md:self-start">
      <details className="group md:hidden">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted [&::-webkit-details-marker]:hidden">
          <span
            aria-hidden="true"
            className="inline-block text-accent transition-transform group-open:rotate-90"
          >
            ›
          </span>
          Documentation
        </summary>
        <div className="mt-4">
          <SidebarNav />
        </div>
      </details>
      <div className="hidden md:block">
        <SidebarNav />
      </div>
    </aside>
  );
}
