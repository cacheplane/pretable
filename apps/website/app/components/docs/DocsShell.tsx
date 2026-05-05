import type { ReactNode } from "react";

import { DocsMobileDrawer } from "./DocsMobileDrawer";
import { DocsSearch } from "./DocsSearch";

export interface DocsShellProps {
  sidebar: ReactNode;
  toc: ReactNode | null;
  children: ReactNode;
}

export function DocsShell({ sidebar, toc, children }: DocsShellProps) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-5 md:px-6 lg:px-8">
      <DocsSearch />
      <DocsMobileDrawer>{sidebar}</DocsMobileDrawer>
      <div className="grid gap-8 md:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_220px] xl:gap-12">
        <aside className="hidden md:block">
          <div className="sticky top-11 max-h-[calc(100vh-44px)] overflow-y-auto py-8">
            {sidebar}
          </div>
        </aside>
        <main className="min-w-0 py-8">
          <div className="mx-auto max-w-[72ch]">{children}</div>
        </main>
        {toc && (
          <aside className="hidden xl:block">
            <div className="sticky top-11 max-h-[calc(100vh-44px)] overflow-y-auto py-8">
              {toc}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
