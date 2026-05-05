# Pretable Docs Site — Design Spec

**Date:** 2026-05-05
**Status:** Proposed
**Branch:** `claude/nice-cerf-cac464`

## Goal

Replace the current minimal `/docs` experience with a Mintlify-aligned docs site that fits Pretable's visual identity and supports live grid demos. AI-forward: copyable per-page Markdown, `/llms.txt`, `/llms-full.txt`, and `<Prompt>` blocks.

## Non-Goals (v1)

- Dark mode (site-wide effort, separate project)
- Versioning (docs are head-only)
- Mintlify "contextual menu" dropdown with Open-in-ChatGPT/Claude actions (deferred — single-action button reserves UI space)
- In-page AI chat / Ask-AI assistant
- MCP server, Algolia, or any external search backend
- Mintlify components not in the v1 list (see §6)

## Architecture

### Approach

Custom Next.js MDX pipeline. Pattern after [angular-agent-framework](https://github.com/cacheplane/angular-agent-framework) docs setup. Reasons over Fumadocs / Mintlify-hosted:

1. Pretable is a grid library — live `<Pretable>` demos in docs are essential. A SaaS doc host (Mintlify) cannot embed live React components from this repo.
2. Existing Alpenglow visual identity must extend cleanly into docs. Custom is easier to skin than a heavily-opinionated framework.
3. We already have working examples of every component we need from angular-agent-framework — port the philosophy, not the code.

### File structure

```
apps/website/
├── content/
│   ├── docs/                          # MDX source of truth
│   │   ├── getting-started/index.mdx
│   │   ├── getting-started/concepts.mdx
│   │   ├── grid/index.mdx
│   │   ├── grid/pretable-component.mdx
│   │   ├── grid/pretable-surface.mdx
│   │   ├── grid/custom-rendering.mdx
│   │   ├── grid/density-helpers.mdx
│   │   ├── grid/api-reference.mdx
│   │   ├── streaming/index.mdx
│   │   ├── streaming/element-streams.mdx
│   │   ├── streaming/partial-streams.mdx
│   │   ├── streaming/parsers.mdx
│   │   ├── streaming/api-reference.mdx
│   │   ├── theming/index.mdx
│   │   ├── theming/pick-a-theme.mdx
│   │   ├── theming/override-tokens.mdx
│   │   ├── theming/light-dark.mdx
│   │   ├── theming/density.mdx
│   │   ├── theming/custom-themes.mdx
│   │   ├── theming/tailwind-css-in-js.mdx
│   │   └── theming/token-reference.mdx
│   └── examples/                      # Live + source examples
│       └── streaming-chat-grid/
│           ├── ChatGrid.tsx
│           ├── columns.ts
│           ├── openai-client.ts
│           ├── page.tsx
│           └── index.ts               # defineExample(...)
├── app/
│   ├── docs/
│   │   ├── _nav.ts                    # existing — sidebar config
│   │   ├── layout.tsx                 # DocsShell (3-col)
│   │   └── [[...slug]]/page.tsx       # renders any docs page; also serves .md
│   ├── llms.txt/route.ts              # auto-generated index
│   ├── llms-full.txt/route.ts         # full content dump
│   └── middleware.ts                  # rewrites /docs/<slug>.md → format=md
├── components/docs/
│   ├── DocsShell.tsx                  # 3-col grid wrapper
│   ├── DocsSidebar.tsx                # left nav
│   ├── DocsTOC.tsx                    # right "On this page"
│   ├── DocsSearch.tsx                 # Cmd+K palette
│   ├── DocsPageHeader.tsx             # H1 + description + Copy as Markdown
│   ├── DocsBreadcrumb.tsx
│   ├── DocsPrevNext.tsx               # prev/next from _nav.ts
│   ├── MdxRenderer.tsx                # bundles MDX components
│   ├── CopyPageButton.tsx             # "Copy as Markdown"
│   ├── CopyPromptButton.tsx           # inline on <Prompt> blocks
│   └── mdx/
│       ├── Callout.tsx
│       ├── Steps.tsx                  (Step inside)
│       ├── Tabs.tsx                   (Tab inside)
│       ├── CodeGroup.tsx
│       ├── CodeBlock.tsx              # used by MdxRenderer for <pre>
│       ├── Card.tsx                   (CardGroup inside)
│       ├── Prompt.tsx
│       ├── Frame.tsx
│       └── Example.tsx                # live + source
└── lib/docs/
    ├── load.ts                        # read MDX file by slug array
    ├── enumerate.ts                   # walk content/docs → page list
    ├── extract-headings.ts            # H2/H3 → TOC items
    ├── search-index.ts                # build-time → JSON manifest
    ├── define-example.ts              # defineExample() helper + types
    └── prev-next.ts                   # neighbor resolution from _nav.ts
```

### Per-page `.md` URL implementation

Next.js cannot route a literal `.md` file extension via folder naming. Strategy: a Next.js middleware rewrites `/docs/<slug>.md` → `/docs/<slug>?format=md`. The catch-all page handler checks `searchParams.format === 'md'` and returns a plain-text `Response` instead of the rendered React tree.

```ts
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server';

export const config = { matcher: '/docs/:path*' };

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  if (url.pathname.endsWith('.md')) {
    url.pathname = url.pathname.replace(/\.md$/, '');
    url.searchParams.set('format', 'md');
    return NextResponse.rewrite(url);
  }
}
```

Single source for path → MDX file mapping (the same `loadDocsPage` used by the page).

## Layout shell (`DocsShell`)

3-column responsive grid. Replaces marketing's `max-w-[1240px]` cap with a wider `max-w-[1440px]` for docs.

```
NavBar (sticky, h-11, full-width)
┌────────┬────────────────────────┬─────────┐
│Sidebar │  Article (max-72ch)    │  TOC    │
│ 260px  │  centered in column    │  220px  │
│        │                        │         │
│ sticky │  H1 + Copy MD          │ sticky  │
│ scroll │  ...prose...           │ scroll  │
│        │  PrevNext              │ scroll- │
│        │                        │  spy    │
└────────┴────────────────────────┴─────────┘
```

### Dimensions

| Breakpoint | Sidebar | Content | TOC | Gap | Padding |
|---|---|---|---|---|---|
| ≥1280px | 260px | `minmax(0,1fr)` (article `max-w-72ch` self-centered) | 220px | 48px | `px-8` |
| 1024–1279px | 240px | `minmax(0,1fr)` | hidden | 40px | `px-8` |
| 768–1023px | 200px | `minmax(0,1fr)` | hidden | 32px | `px-6` |
| <768px | drawer | full | hidden | — | `px-5` |

Inner grid centered in `mx-auto max-w-[1440px]`.

### Stickiness

- NavBar: sticky `top-0` (existing)
- Sidebar `<aside>`: `position: sticky; top: 44px; max-height: calc(100vh - 44px); overflow-y: auto`
- TOC: same pattern
- Article: normal flow

### Mobile sidebar

Below 768px the sidebar becomes an off-canvas drawer. NavBar gets a `[Menu]` button slot when on `/docs/*` (passed via a layout-level prop or a context flag the existing NavBar reads). Drawer slides from the left, closes on link click and on Esc, traps focus while open. Implementation reuses the existing site drawer-handle CSS pattern where reasonable.

## Visual identity

Keeps Pretable Alpenglow tokens. No new color palette, no Inter — `font-display` for headings, existing Alpenglow accent and surfaces.

- H1: `font-display text-[36px] leading-[1.05] tracking-[-0.025em] text-text-primary`
- H2: `font-display text-[24px] tracking-[-0.02em] mt-12`
- H3: `font-display text-[18px] mt-8`
- Body: `font-display text-[15px] leading-[1.65] text-text-secondary`, `max-w-72ch`
- Inline code: `font-mono text-[13px] text-text-primary`
- Code blocks: `bg-bg-card border border-rule rounded-md`, Shiki `github-light` theme tuned to Alpenglow contrast

Sidebar links use the same accent treatment as TopControlBar (left border becomes accent on active).

## MDX pipeline

Server-rendered via RSC.

```ts
// lib/docs/load.ts
import { compileMDX } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypePrettyCode from 'rehype-pretty-code';

export async function loadDocsPage(slug: string[]) {
  const filePath = resolveContentPath(slug); // → content/docs/<...>.mdx
  const raw = await fs.readFile(filePath, 'utf8');

  const { content, frontmatter } = await compileMDX<DocsFrontmatter>({
    source: raw,
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [
          rehypeSlug,
          [rehypePrettyCode, { theme: 'github-light' }],
        ],
      },
    },
    components: docsMdxComponents,
  });

  const headings = extractHeadings(raw);
  return { content, frontmatter, headings, raw };
}
```

### Frontmatter contract

```yaml
---
title: <Pretable> component
description: The drop-in grid component with built-in streaming support.
nav: Grid                # group label, must match _nav.ts
order: 2                 # within group; tiebreaker for sort
---
```

### Component registry (v1)

| Component | Purpose |
|---|---|
| `Callout` | `type: "note" \| "warning" \| "tip" \| "info" \| "check"` |
| `Steps` / `Step` | Numbered procedures with vertical connector |
| `Tabs` / `Tab` | Generic tabbed content |
| `CodeGroup` | Multi-language code (curl/JS/Python). Tab labels = language |
| `Card` / `CardGroup` | Linked tiles, 1/2/3-col responsive grid |
| `Prompt` | Copyable AI prompt block (uses `CopyPromptButton`) |
| `Frame` | Bordered/captioned wrapper for images and live demos |
| `Example` | **Live demo + source files**. See below. |

### HTML element overrides

| Element | Override behavior |
|---|---|
| `pre` | Rendered as `CodeBlock` — copy button (top-right), optional language label, optional file title (parsed from fence info string after the language: ` ```ts lib/columns.ts `) |
| `h2` / `h3` | `id` injected by `rehype-slug`. Visually unchanged |
| `a` | If external (starts with `http`), append `↗` icon and `target="_blank" rel="noopener"` |
| `table` | Wrapped in `<div class="overflow-x-auto">` so reference tables scroll horizontally without breaking layout |

## `<Example>` component — live + source

For grid feature demos. Each example is a real folder under `content/examples/`:

```
content/examples/streaming-chat-grid/
├── ChatGrid.tsx
├── columns.ts
├── openai-client.ts
├── page.tsx
└── index.ts
```

`index.ts`:

```ts
import { defineExample } from '@/lib/docs/define-example';
import { ChatGrid } from './ChatGrid';

import pageSource from './page.tsx?raw';
import chatGridSource from './ChatGrid.tsx?raw';
import columnsSource from './columns.ts?raw';
import openaiSource from './openai-client.ts?raw';

export const streamingChatGrid = defineExample({
  title: 'Streaming chat grid',
  Demo: <ChatGrid prompt="Summarize the last 10 incidents" />,
  files: [
    { path: 'page.tsx', lang: 'tsx', source: pageSource },
    { path: 'ChatGrid.tsx', lang: 'tsx', source: chatGridSource },
    { path: 'columns.ts', lang: 'ts', source: columnsSource },
    { path: 'openai-client.ts', lang: 'ts', source: openaiSource },
  ],
});
```

`?raw` import suffix is supported by Next.js (Turbopack and Webpack) and yields the file's source as a string. **Single source of truth** — editing `ChatGrid.tsx` updates both the live demo and the displayed source. No string duplication.

`defineExample()` returns a strongly-typed `ExampleDef`. The `<Example>` prop is typed:

```ts
interface ExampleProps {
  example: ExampleDef;
  defaultOpen?: boolean;     // disclosure default; default false
  showLive?: boolean;        // default true
}
```

In MDX:

```mdx
import { streamingChatGrid } from '@/content/examples/streaming-chat-grid';

<Example example={streamingChatGrid} />
```

**No magic strings.** Renaming or deleting an example breaks the import at compile time.

### Render

```
┌──────────────────────────────────────────────────┐
│  Live demo                                       │
│  ┌────────────────────────────────────────────┐  │
│  │  <ChatGrid prompt="…" /> rendering         │  │
│  └────────────────────────────────────────────┘  │
│  [▾ Show source]    ← disclosure (default closed)│
│   ┌─ tabs ─────────────────────────────────────┐ │
│   │ page.tsx │ ChatGrid.tsx │ columns.ts ...   │ │
│   └────────────────────────────────────────────┘ │
│   <highlighted code>                  [Copy file]│
│                                       [Copy all] │
└──────────────────────────────────────────────────┘
```

- Live demo is primary; source is on demand.
- "Copy file" copies the active tab's source.
- "Copy all" emits all files as a single fenced markdown blob (each file in its own ` ```<lang> <path> ` block) — pasting into Claude/Cursor reproduces the feature.
- `defaultOpen` per-page override.
- `showLive={false}` for non-runnable examples (e.g., a config-file walkthrough).

### Migration of existing marketing `CodeExample`

`apps/website/app/components/CodeExample.tsx` currently hard-codes the chat-grid example as four `TabSource` strings, code-only. After this design lands, that component becomes:

```tsx
import { streamingChatGrid } from '@/content/examples/streaming-chat-grid';

export function CodeExample() {
  return (
    <section ...>
      ...
      <Example example={streamingChatGrid} defaultOpen showLive />
    </section>
  );
}
```

Marketing landing page now shows a *real running grid* instead of static syntax-highlighted strings. Eliminates duplication.

## Sidebar (`DocsSidebar`)

- Reads `_nav.ts` (existing `docsNav` export)
- All groups always-expanded (v1)
- Group title: `font-mono text-[11px] uppercase tracking-[0.14em] text-text-dim pt-5 pb-2`
- Link: `text-[13px] text-text-secondary py-1.5 pl-3 border-l border-rule-soft hover:text-text-primary hover:border-rule`
- Active link: `text-accent border-l-2 border-l-accent -ml-px font-medium`. Match by `usePathname()` exact equality (so `/docs/grid` does not highlight `/docs/grid/api-reference`).
- Mobile drawer behavior described in Layout § Mobile sidebar.

## TOC (`DocsTOC`)

Server-rendered list, client-enhanced scrollspy.

- Server: `extractHeadings(raw)` returns `[{ depth: 2|3, text, slug }]`. H2/H3 only; H1 (page title) and H4+ excluded.
- Render: mono uppercase eyebrow `ON THIS PAGE`, then list. H3 indented `pl-4`.
- Empty state: if 0 H2s, `DocsTOC` returns `null`; layout grid drops the column for that page.
- Client enhancement (`"use client"` leaf): `IntersectionObserver` on every heading element; topmost-visible heading sets `aria-current="location"` on the matching list item. Active item gets `text-accent`.
- Click: `event.preventDefault()`, smooth-scrolls to target, sets `window.location.hash` without navigation.

## Search (`DocsSearch`)

### Build-time index

`lib/docs/search-index.ts` enumerates `content/docs/**/*.mdx` and produces a JSON manifest. Served as a static asset at `/docs/search-index.json` via a Next.js route handler that runs `loadDocsPage` for every slug at build (`force-static` + `revalidate: false`).

```json
[
  {
    "slug": "/docs/grid/pretable-component",
    "title": "<Pretable> component",
    "description": "The drop-in grid component...",
    "nav": "Grid",
    "headings": ["Props", "Slots", "Examples"],
    "body": "First 2KB of plain-text MDX with custom-component tags stripped"
  }
]
```

The client loads it lazily on first Cmd+K open via `fetch('/docs/search-index.json')`.

### Client palette (`DocsSearch`)

`"use client"`. Mounted globally inside `DocsLayout`.

- `Cmd+K` / `Ctrl+K` opens centered modal: `position: fixed; inset: 0; z-index: 50; backdrop-filter: blur(4px); background: rgb(0 0 0 / 0.4)`. Inner card `max-w-[640px] mx-auto mt-[15vh] bg-bg-card border border-rule rounded-md shadow-lg`.
- Input on top, results list below (max ~8 visible, scroll for more).
- Search via [`fuzzysort`](https://github.com/farzher/fuzzysort) — ~6KB, zero deps. Weight: title 4, headings 2, description 1, body 0.5. Combined score sorts results.
- Result row: title (highlighted match) + breadcrumb (`Grid › <Pretable> component`) + matched snippet (~120 chars).
- Arrow keys navigate; Enter opens with `router.push`; Esc closes.
- Empty state: "Search the docs" + up to 5 recent pages from `sessionStorage` (`pretable:recentDocs`).
- Index loaded lazily on first open via `fetch('/docs/search-index.json')`.

## AI features (scope B)

### Per-page `.md` URLs

Discovery via `<link rel="alternate" type="text/markdown" href={`${pathname}.md`} />` injected into each docs page `<head>`.

Implementation: middleware rewrites `/docs/<slug>.md` → `/docs/<slug>?format=md`. Page handler returns `text/markdown; charset=utf-8` with `# <title>\n\n<description>\n\n<raw MDX>`. Custom MDX component tags (`<Example example={…} />`, `<Callout>…</Callout>`) pass through as their JSX form — sufficient for LLM context. Embedding example file contents inline is a deferred enhancement.

### `/llms.txt`

`app/llms.txt/route.ts`:

```
# Pretable Docs

> The drop-in React data grid built for streaming.

## Getting Started
- [Install + first grid](/docs/getting-started.md): The five-minute path …
- [Concepts](/docs/getting-started/concepts.md): Snapshots, patches, …

## Grid
- [<Pretable> component](/docs/grid/pretable-component.md): The drop-in …
- ...

## Streaming
- ...

## Theming
- ...
```

Sections from `_nav.ts` group titles. Item descriptions from each MDX's `description` frontmatter. Ordered per `_nav.ts`. `Cache-Control: public, s-maxage=3600`.

### `/llms-full.txt`

Same enumeration, but inlines each page's raw MDX separated by `---\n## <title>\n\n` headers. One large plaintext file. ~50–200KB depending on content. `Cache-Control: public, s-maxage=3600`.

### Discovery headers

Add to docs `<head>` (in `app/docs/layout.tsx`):

```tsx
<link rel="alternate" type="text/markdown" href={`${pathname}.md`} />
<link rel="llms-txt" href="/llms.txt" />
```

`Link: rel="llms-txt"` HTTP header (Mintlify's pattern) added at the same time via Next.js `headers()` config or middleware:

```ts
// next.config.ts headers
{ source: '/docs/:path*', headers: [{ key: 'Link', value: '</llms.txt>; rel="llms-txt"' }] }
```

### `<Prompt>` MDX component + `CopyPromptButton`

```mdx
<Prompt>
  Build a streaming grid that displays incidents as they arrive from
  an OpenAI Responses stream. Use @pretable/react and connectElementStream.
</Prompt>
```

Renders as a card with prompt text and a `CopyPromptButton` that copies the inner text on click. Used sparingly — for canonical "ask the AI to scaffold this" prompts.

### `CopyPageButton` ("Copy as Markdown")

Sits in `DocsPageHeader` next to H1. Single action button in v1, but built as a `<details>`/dropdown shell so future "Open in ChatGPT/Claude" items drop in cleanly. On click: `fetch(currentPath + '.md')`, copy response body to clipboard, show "Copied!" affordance for 2s.

## Content migration

24 existing pages move from `app/docs/<group>/<slug>/page.mdx` → `content/docs/<group>/<slug>.mdx`.

| From | To |
|---|---|
| `app/docs/getting-started/page.mdx` | `content/docs/getting-started/index.mdx` |
| `app/docs/getting-started/concepts/page.mdx` | `content/docs/getting-started/concepts.mdx` |
| `app/docs/grid/page.mdx` | `content/docs/grid/index.mdx` |
| `app/docs/grid/pretable-component/page.mdx` | `content/docs/grid/pretable-component.mdx` |
| (and the rest, same pattern) | |

Each migrated file gets frontmatter (`title`, `description`, `nav`, `order`). Then the old `app/docs/<group>/[*]` page files are deleted; the new `app/docs/[[...slug]]/page.tsx` catch-all takes over. URLs unchanged → no redirects.

`_nav.ts` stays as the source of truth for sidebar order and group labels.

## Testing

### Unit (Vitest + React Testing Library)

- `lib/docs/extract-headings`: H2/H3 extraction, slug correctness, depth tracking
- `lib/docs/enumerate`: walks fixture content tree, returns expected slug list ordered per `_nav.ts`
- `lib/docs/define-example` + raw loader: parses files, exposes raw source, types resolve
- `lib/docs/prev-next`: returns correct neighbors at start/end/middle
- `<Callout>`, `<Steps>`, `<Tabs>`, `<CodeGroup>`, `<Card>`, `<Prompt>`, `<Frame>`: render variants
- `<Example>`: live demo renders; clicking "Show source" reveals tabs; tab click switches; "Copy file" and "Copy all" write expected content to clipboard
- `CopyPageButton`, `CopyPromptButton`: clipboard write succeeds; "Copied!" state shows then resets
- `DocsSidebar`: active state matches pathname exactly; group structure renders
- `DocsTOC`: empty headings list → component returns null; click sets hash
- `DocsSearch`: Cmd+K opens modal, Esc closes, fuzzy ranks title above body, result click navigates

### Integration

- `app/docs/[[...slug]]/page.tsx` renders fixture MDX with title from frontmatter
- `/docs/<slug>.md` middleware rewrite returns `text/markdown` with raw MDX body
- `/llms.txt` route returns expected format for fixture content tree
- `/llms-full.txt` includes every fixture page with separator headers

### E2E (Playwright)

- Visit `/docs/grid/pretable-component`: sidebar + content + TOC all render; H1 matches frontmatter title; "Copy as Markdown" button present
- Click "Copy as Markdown" → `navigator.clipboard.readText()` returns expected markdown
- `Cmd+K` opens search; type "streaming" → results update; Enter on first result navigates
- TOC scrollspy: scroll to second H2 → corresponding TOC item gets active class
- Mobile (375px viewport): sidebar drawer toggles via NavBar Menu button; TOC hidden; content full-width
- `/llms.txt` returns 200 with `text/plain` body matching expected structure
- `/docs/grid.md` returns 200 with `text/markdown` body containing frontmatter title

## Risks & open questions

- **`?raw` imports**: Next.js 16 with Turbopack supports `?raw` for files inside the app, but verify before relying on it. Fallback: a small `next.config.ts` Webpack loader, or a build-time codegen step that emits `<file>.source.ts` next to each example file.
- **Middleware vs sibling route** for `.md` URLs: middleware is cleaner; the implementation plan should validate it runs server-side only and adds no client overhead.
- **Search index size**: at 24 pages × ~2KB body = ~50KB. Comfortable. Reassess when it crosses ~500KB.
- **Live demo SSR**: `<ChatGrid>` in `streamingChatGrid` example will need to handle SSR cleanly. Either mark example components `"use client"` end-to-end, or accept that demos hydrate after first paint.

## Out of scope (explicit follow-ups)

- AI scope C: contextual menu dropdown with "Open in ChatGPT", "Open in Claude", "Open in Cursor", "Ask assistant"
- In-page AI chat / Ask-AI assistant
- MCP server for docs
- Mintlify components: Accordion, Expandable, Banner, Update, Badge, Tooltip, ParamField, ResponseField, Mermaid diagrams, Tree, Columns, Panel, Tiles
- Site-wide dark mode
- Docs versioning (multi-version routing, version switcher)
- Algolia or any external search backend
- Collapsible sidebar groups with localStorage persistence (revisit when content > ~40 pages)
