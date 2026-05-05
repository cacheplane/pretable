import type { DocsNavItem, DocsNavSection } from "../../app/docs/_nav";

export interface PrevNext {
  prev: DocsNavItem | null;
  next: DocsNavItem | null;
}

export function resolvePrevNext(
  currentHref: string,
  nav: DocsNavSection[],
): PrevNext {
  const flat: DocsNavItem[] = nav.flatMap((g) => g.items);
  const i = flat.findIndex((it) => it.href === currentHref);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? flat[i - 1] : null,
    next: i < flat.length - 1 ? flat[i + 1] : null,
  };
}
