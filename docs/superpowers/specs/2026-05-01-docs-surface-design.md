# Docs Surface (Phase 4) — Design Spec

**Date:** 2026-05-01
**Status:** Draft for review
**Scope:** Add `/docs` routes inside the existing `apps/website` Next.js app. Skeleton + a real "Install + first grid" getting-started page. MDX wired via `@next/mdx`.

---

## 1. Goal

The website's `<Nav>` already advertises a `docs` link (`href="/docs"`), but no route exists — clicks 404. This is the most visible gap on the marketing surface.

Phase 4 closes that gap by adding a small docs surface inside the same Next 16 app: a sidebar-driven `/docs` route group with one real getting-started page, an MDX pipeline ready for future content, and shared code-highlighting infrastructure.

Out of scope (deferred to future phases): API reference, recipes, migration guides, MDX search, auto-generated TOC, versioned docs, frontmatter-driven sidebar, wiring the `<Nav>` search button.

## 2. Non-goals

- New apps or workspaces (docs lives in `apps/website`).
- Touching `@pretable/core`, `@pretable/react`, or `@pretable/ui` — they are already shaped well enough to write minimal getting-started copy against today.
- API reference auto-extraction (TypeDoc, etc.). Future work.
- Right-side TOC pane.
- Mobile hamburger overlay (we use a `<details>` accordion instead — no client JS).
- Versioned docs.
- Theming / consumer overrides — separate brainstorm thread.

## 3. Architecture

### 3.1 Route structure

```
apps/website/app/docs/
├── layout.tsx              # 2-pane: <DocsSidebar /> + <article>{children}</article>
├── page.mdx                # /docs index
├── getting-started/
│   └── page.mdx            # /docs/getting-started
└── _nav.ts                 # sidebar config (DocsNavSection[])
```

Co-located MDX. `_nav.ts` starts with an underscore so Next does not treat it as a route segment.

### 3.2 MDX pipeline (`@next/mdx`)

- Add `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, `@types/mdx` to `apps/website/devDependencies`.
- Update `apps/website/next.config.ts` to wrap the export with `withMDX(...)` and set `pageExtensions: ['ts', 'tsx', 'mdx']`.
- Add `apps/website/mdx-components.tsx` (Next 16 convention) that maps:
  - `pre` / `code` blocks → existing shiki-based `<CodeBlock>` (extracted from `CodeExample.tsx`, see §3.5).
  - `h1` / `h2` / `h3` → tokenized typography matching the rest of the site.
  - `a` → docs-aware link wrapper that uses Next `Link` for relative URLs.

The mapping is one shared component file; per-page MDX overrides are not needed at this scope.

### 3.3 Docs layout

`apps/website/app/docs/layout.tsx` is a server component:

```tsx
import { DocsSidebar } from "../components/DocsSidebar";

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-8 px-7 py-12 md:grid-cols-[240px_minmax(0,1fr)] md:px-10 md:py-16">
      <DocsSidebar />
      <article className="prose prose-invert max-w-[68ch]">{children}</article>
    </div>
  );
}
```

(Final styling tuned to match the site's tokens; the `prose` utility is illustrative — actual implementation uses our own typography classes since we don't ship `@tailwindcss/typography`.)

The shared root `app/layout.tsx` continues to render `<Nav>` and `<Footer>` around `{children}`. The docs layout sits inside `<main>{children}</main>`.

### 3.4 Sidebar

**`apps/website/app/docs/_nav.ts`:**

```ts
export interface DocsNavItem {
  title: string;
  href: string;
}
export interface DocsNavSection {
  title: string;
  items: DocsNavItem[];
}
export const docsNav: DocsNavSection[] = [
  {
    title: "Getting Started",
    items: [{ title: "Install + first grid", href: "/docs/getting-started" }],
  },
];
```

**`apps/website/app/components/DocsSidebar.tsx`** — server component:

```tsx
import { docsNav } from "../docs/_nav";
import { DocsSidebarLink } from "./DocsSidebarLink";

export function DocsSidebar() {
  return (
    <aside className="md:sticky md:top-24 md:self-start">
      <details className="md:open" open>
        <summary className="font-mono text-[11px] uppercase tracking-[0.14em] text-text-muted md:hidden">
          Documentation
        </summary>
        <nav aria-label="Docs">
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
```

**`apps/website/app/components/DocsSidebarLink.tsx`** — `"use client"`:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function DocsSidebarLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href;
  const className = [
    "block rounded-sm px-2 py-1 text-[14px] transition-colors",
    active
      ? "bg-bg-raised text-text-primary"
      : "text-text-secondary hover:text-text-primary",
  ].join(" ");
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
```

This isolates the only client boundary needed in the sidebar to a leaf component.

### 3.5 Shared code-block component

Today, `apps/website/app/components/CodeExample.tsx` calls `shiki`'s `codeToHtml` directly inside the section component. Extracting that path into a reusable shared component lets MDX `<pre>` blocks render through the same highlighter without forking the import or theme.

**`apps/website/app/components/CodeBlock.tsx`** — async server component:

```tsx
import { codeToHtml } from "shiki";

interface CodeBlockProps {
  code: string;
  lang?: string;
}

export async function CodeBlock({ code, lang = "tsx" }: CodeBlockProps) {
  const html = await codeToHtml(code, {
    lang,
    theme: "github-dark", // tuned to match cool-slate; final theme name decided at impl time
  });
  return (
    <div
      className="overflow-x-auto rounded-md border border-rule bg-grid-bg p-4 font-mono text-[13px] leading-[1.6]"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
```

Refactor `CodeExample.tsx` to use `<CodeBlock>` instead of inlining `codeToHtml`. The MDX `pre`/`code` mapping in `mdx-components.tsx` also routes through `<CodeBlock>` (parsing the `lang` from the className that MDX adds).

### 3.6 Nav integration

The website's root `app/layout.tsx` currently renders `<Nav active="website" version={APP_VERSION} />` — a hard-coded `active`. For the docs route, this would highlight the wrong link.

Fix: introduce `apps/website/app/components/RouteAwareNav.tsx` (`"use client"`) that calls `usePathname()` and computes the active `NavPage` from the path:

- `/docs` (or any subpath) → `"docs"`
- everything else → `"website"`
- (`bench`/`github` are not in-app routes, so they never become active here.)

Replace the literal `<Nav active="website" />` in `app/layout.tsx` with `<RouteAwareNav version={APP_VERSION} />`. This is a minimally invasive change: the existing `<Nav>` component is unchanged; the wrapper is the only new file.

### 3.7 Page content

**`apps/website/app/docs/page.mdx`** (the docs index):

A short MDX file. Heading "Documentation," one paragraph orienting the reader, and a single link/card pointing at `/docs/getting-started`. ~15 lines.

**`apps/website/app/docs/getting-started/page.mdx`** (the real content):

Sections, in order:

1. **Install** — `npm i @pretable/react @pretable/ui` (rendered through `CodeBlock` with `lang="bash"`).
2. **Import the styles** — show the two `@import` lines for `@pretable/ui/tokens.css` and `@pretable/ui/components.css` (`lang="css"`).
3. **Render your first grid** — minimal example (~15 lines of tsx) using actual public API: `Pretable`, `PretableColumn`, `PretableRow` from `@pretable/react`. Three columns, five rows.
4. **What's next** — one paragraph and a link to GitHub for now (no API reference yet).

Page is intentionally short (~80 lines of MDX). It is NOT marketing copy; it is a working install + first-render path.

## 4. File structure

**Created:**

- `apps/website/app/docs/layout.tsx`
- `apps/website/app/docs/page.mdx`
- `apps/website/app/docs/getting-started/page.mdx`
- `apps/website/app/docs/_nav.ts`
- `apps/website/app/components/DocsSidebar.tsx`
- `apps/website/app/components/DocsSidebarLink.tsx`
- `apps/website/app/components/CodeBlock.tsx`
- `apps/website/app/components/RouteAwareNav.tsx`
- `apps/website/mdx-components.tsx`
- `apps/website/__tests__/app/docs/page.test.tsx`
- `apps/website/__tests__/app/docs/getting-started.test.tsx`
- `apps/website/__tests__/components/DocsSidebar.test.tsx`
- `apps/website/__tests__/components/CodeBlock.test.tsx`

**Modified:**

- `apps/website/next.config.ts` — wrap with `withMDX(...)`, set `pageExtensions`.
- `apps/website/package.json` — add `@next/mdx`, `@mdx-js/loader`, `@mdx-js/react`, `@types/mdx` to devDependencies. (These do not exist in the workspace today — confirmed.)
- `apps/website/app/layout.tsx` — replace `<Nav active="website" />` with `<RouteAwareNav />`.
- `apps/website/app/components/CodeExample.tsx` — refactor to delegate to `<CodeBlock>`.

**Untouched:**

- `packages/ui/src/nav.tsx` — `NavPage` already includes `"docs"`.
- All other body-section components (`Hero`, `Problem`, etc.).
- All Phase 2/3 tests.

## 5. Testing strategy

Four new smoke tests, following the existing pattern (render + concrete assertion, no snapshots, no interaction):

- **`__tests__/app/docs/page.test.tsx`** — imports `DocsIndex` (the MDX-compiled default export), renders it, asserts an `<h1>` exists.
- **`__tests__/app/docs/getting-started.test.tsx`** — same pattern; asserts the install command string `"npm i @pretable/react"` appears.
- **`__tests__/components/DocsSidebar.test.tsx`** — renders `<DocsSidebar />`, asserts every section in `_nav.ts` produces a heading and every item produces a link.
- **`__tests__/components/CodeBlock.test.tsx`** — `await CodeBlock({ code: "const x = 1;" })`, render the returned JSX, assert a `<pre>` (shiki output) is present.

`RouteAwareNav` is not directly tested at this scope — it is exercised by the existing page smoke tests through `app/layout.tsx`. If a regression there proves hard to debug, a focused test can be added.

Existing 14 website tests continue to pass.

## 6. Performance + a11y

- Docs layout is a server component. The only client boundaries are `DocsSidebarLink` (1 leaf, `usePathname`) and `RouteAwareNav` (1 wrapper, `usePathname`). Aggregate client bundle delta is small.
- `<DocsSidebar>` uses semantic `<nav aria-label="Docs">` and `<details>`/`<summary>` for the mobile collapse. Keyboard accessible by default.
- Heading hierarchy: pages start with `<h1>` (from MDX), sections use `<h2>`. Sidebar section labels use `<h3>` with mono-uppercase styling (decorative; screen-reader accessible via the heading semantics).
- All link colors meet existing token contrast requirements (no new tokens introduced).

## 7. Verification

- `pnpm --filter @pretable/app-website test` — 18 passing (14 existing + 4 new).
- `pnpm --filter @pretable/app-website typecheck` — clean.
- `pnpm --filter @pretable/app-website lint` — 0 errors.
- `pnpm --filter @pretable/app-website build` — clean. Two new static routes (`/docs`, `/docs/getting-started`) appear in the build output.
- `pnpm format` — clean.
- Manual smoke (dev server): `/docs` and `/docs/getting-started` render with the sidebar; the `docs` link in the top nav highlights when on those routes; install command is copyable; "first grid" example renders with shiki highlighting.

## 8. Risks

- **Tailwind v4 + MDX class flow.** MDX adds default classes to `pre`/`code` (e.g., `language-tsx`). Our `mdx-components.tsx` mapping replaces the default `<pre>` with `<CodeBlock>`, so this is fine. Verify at impl time that no stray `prose` plugin churn happens (we don't use `@tailwindcss/typography`, so this should be a no-op).
- **shiki theme drift.** The current `CodeExample.tsx` may use a specific shiki theme name. Implementation extracts the existing call as-is into `CodeBlock` and references the same theme — no theme switch in this PR.
- **`page.mdx` recognition.** Next 16 + `@next/mdx` does support `page.mdx` files as route segments when `pageExtensions` includes `'mdx'`. Verify the version we install. If `page.mdx` doesn't resolve, fallback is a one-line `app/docs/page.tsx` that imports a sibling `_content.mdx` — but the spec assumes the cleaner default works.
- **`RouteAwareNav` and root layout caching.** Next caches RSC tree; `usePathname()` in a client wrapper inside a server layout is the standard pattern (see Next docs example). No special handling.
- **Vitest + MDX.** `vitest` won't compile `.mdx` files out of the box. Two options at impl time: (a) configure the existing vitest setup with `@mdx-js/rollup` (more work), or (b) keep MDX page tests at the integration level (`render` the compiled output via `await import("../../../app/docs/page")`). Option (b) works because vitest can import compiled MDX modules through Next's compilation when running under the Next loader, OR — simplest — we can write the MDX-page smoke tests against the React component object that `@mdx-js/loader` produces. Final approach: configure vitest with `@mdx-js/rollup` plugin in `apps/website/vitest.config.ts` so `.mdx` imports work in tests. This is one config block, ~5 lines.

## 9. Out of scope (explicit, see §1, §2)

- API reference, recipes, migration guides, search.
- Right-pane TOC.
- Frontmatter-driven sidebar.
- Theming / consumer overrides.
- Versioned docs.

## 10. Rollback

Revert the squash-merge commit. Lockfile updates with `pnpm install`. `<Nav>` reverts to `active="website"`. The MDX pipeline disappears with the `next.config.ts` revert.

## 11. Success criteria

- [ ] `/docs` and `/docs/getting-started` render in dev and in production build.
- [ ] Top `<Nav>`'s "docs" link is active on those routes.
- [ ] The getting-started page contains a working install command and a copy-pasteable first-grid example using actual public API.
- [ ] CodeBlock is the single shiki path; `CodeExample.tsx` is refactored to use it.
- [ ] 18 website tests pass (14 existing + 4 new).
- [ ] CI green.
- [ ] Single PR.
