# Website Bucket D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote `@pretable-internal/stream-adapter` to public `@pretable/stream-adapter`, add a "streaming, by design" marketing section between HowItWorks and CodeExample, and ship a 5-page top-level Streaming docs group.

**Architecture:** One PR with three coupled deliverables that reference each other. Rename the package + sweep 7 internal consumers in a single atomic commit so the workspace never sits broken. Add a server component for the marketing section (no client state). Author 5 MDX docs pages under a new `/docs/streaming/*` route group, plus a `_nav.ts` entry.

**Tech Stack:** Next.js 16 (App Router) + Tailwind v4 + vitest + jsdom + Testing Library + MDX (remark-gfm + remark-frontmatter, already wired in Bucket A) + changesets release pipeline.

**Spec:** `docs/superpowers/specs/2026-05-03-website-bucket-d-streaming-story-design.md`

**Branch:** `feat/bucket-d-streaming-story` (already created off `main`, spec already committed at HEAD).

---

## File Structure

**Create:**

- `apps/website/app/components/StreamingByDesign.tsx` — server component, ~50 lines, eyebrow + H2 + thesis + 2 cards + footer link.
- `apps/website/__tests__/components/StreamingByDesign.test.tsx`
- `apps/website/app/docs/streaming/page.mdx` — overview
- `apps/website/app/docs/streaming/element-streams/page.mdx`
- `apps/website/app/docs/streaming/partial-streams/page.mdx`
- `apps/website/app/docs/streaming/parsers/page.mdx`
- `apps/website/app/docs/streaming/api-reference/page.mdx`
- `.changeset/promote-stream-adapter.md`

**Modify:**

- `packages/stream-adapter/package.json` — `name` + drop `private`
- `apps/streaming-demo/package.json` — dep rename
- `apps/streaming-demo/src/replay-engine.ts` — 2 imports
- `apps/streaming-demo/src/types.ts` — 1 comment
- `apps/bench/package.json` — dep rename
- `apps/bench/src/pretable-adapter.tsx` — imports
- `apps/website/app/bench/page.tsx` — imports
- `apps/website/app/components/CodeExample.tsx` — `chat-grid.tsx` snippet string
- `apps/website/app/components/DrawerHero.tsx` — `DRAWER_HERO_PROMPT` constant
- `apps/website/app/components/ComparisonTable.tsx` — source comment in `ROWS`
- `apps/website/app/page.tsx` — insert `<ScrollReveal><StreamingByDesign /></ScrollReveal>` between HowItWorks and CodeExample
- `apps/website/app/docs/_nav.ts` — add Streaming group between Grid and Theming
- `pnpm-lock.yaml` — automatically updated by `pnpm install`

**Won't touch:** `packages/stream-adapter/src/*` (no behavior changes), drawer mechanics, HeroGrid, DrawerHero structure outside the prompt string, ReceiptsBand, CredibilityCards, HowItWorks, FeatureGrid, CtaSection, MountainFooter.

---

### Task 1: Rename package + sweep all internal consumers + add changeset (atomic)

This task is one big commit because the workspace must never sit broken. After the rename, every reference to the old name must be updated in the same commit so `pnpm install` resolves cleanly.

**Files:**

- Modify: `packages/stream-adapter/package.json`
- Modify: `apps/streaming-demo/package.json`
- Modify: `apps/streaming-demo/src/replay-engine.ts`
- Modify: `apps/streaming-demo/src/types.ts`
- Modify: `apps/bench/package.json`
- Modify: `apps/bench/src/pretable-adapter.tsx`
- Modify: `apps/website/app/bench/page.tsx`
- Modify: `apps/website/app/components/CodeExample.tsx`
- Modify: `apps/website/app/components/DrawerHero.tsx`
- Modify: `apps/website/app/components/ComparisonTable.tsx`
- Create: `.changeset/promote-stream-adapter.md`
- Updated by `pnpm install`: `pnpm-lock.yaml`

- [ ] **Step 1.1: Verify the consumer list is exhaustive**

```bash
cd /Users/blove/repos/pretable/.worktrees/website-redesign
grep -rln "@pretable-internal/stream-adapter" --include="*.json" --include="*.ts" --include="*.tsx" --include="*.mdx" --include="*.md" -- apps packages | grep -v CHANGELOG
```

Expected exact list (10 files):

```
apps/bench/package.json
apps/bench/src/pretable-adapter.tsx
apps/streaming-demo/package.json
apps/streaming-demo/src/replay-engine.ts
apps/streaming-demo/src/types.ts
apps/website/app/bench/page.tsx
apps/website/app/components/CodeExample.tsx
apps/website/app/components/ComparisonTable.tsx
apps/website/app/components/DrawerHero.tsx
packages/stream-adapter/package.json
```

If the list differs, stop and report — the spec needs updating.

- [ ] **Step 1.2: Edit `packages/stream-adapter/package.json`**

Change:

```json
  "name": "@pretable-internal/stream-adapter",
  "version": "0.0.1",
  "private": true,
```

To:

```json
  "name": "@pretable/stream-adapter",
  "version": "0.0.1",
```

(Just the two lines: `name` value and remove the `private` line. Keep everything else exactly as is — `main`, `module`, `types`, `exports`, `dependencies`, `scripts` all stay.)

- [ ] **Step 1.3: Edit `apps/streaming-demo/package.json`**

Find the `dependencies` (or `devDependencies` — confirm with `cat apps/streaming-demo/package.json | grep stream-adapter`) and change:

```json
"@pretable-internal/stream-adapter": "workspace:*"
```

To:

```json
"@pretable/stream-adapter": "workspace:*"
```

- [ ] **Step 1.4: Edit `apps/streaming-demo/src/replay-engine.ts`**

Find lines 9 and 10:

```ts
import { createBatcher } from "@pretable-internal/stream-adapter";
import type { TransactionBatcher } from "@pretable-internal/stream-adapter";
```

Change to:

```ts
import { createBatcher } from "@pretable/stream-adapter";
import type { TransactionBatcher } from "@pretable/stream-adapter";
```

- [ ] **Step 1.5: Edit `apps/streaming-demo/src/types.ts`**

Find the comment at line 5 (`* constraint from @pretable-internal/stream-adapter (which is`) and replace `@pretable-internal/` with `@pretable/`.

- [ ] **Step 1.6: Edit `apps/bench/package.json`**

Same pattern as Step 1.3:

```json
"@pretable-internal/stream-adapter": "workspace:*"
```

→

```json
"@pretable/stream-adapter": "workspace:*"
```

- [ ] **Step 1.7: Edit `apps/bench/src/pretable-adapter.tsx`**

Replace every occurrence of `@pretable-internal/stream-adapter` with `@pretable/stream-adapter`. Use:

```bash
grep -n "@pretable-internal/stream-adapter" apps/bench/src/pretable-adapter.tsx
```

Then edit each matching line.

- [ ] **Step 1.8: Edit `apps/website/app/bench/page.tsx`**

Same — replace every occurrence.

```bash
grep -n "@pretable-internal/stream-adapter" apps/website/app/bench/page.tsx
```

- [ ] **Step 1.9: Edit `apps/website/app/components/CodeExample.tsx`**

This file has a `TABS` array defined as a `readonly TabSource[]`. The first entry's `code` property is a template literal string containing the `chat-grid.tsx` snippet. Inside that string is the line:

```
import { connectElementStream } from "@pretable-internal/stream-adapter";
```

Change it to:

```
import { connectElementStream } from "@pretable/stream-adapter";
```

(Single replacement inside the template literal.)

- [ ] **Step 1.10: Edit `apps/website/app/components/DrawerHero.tsx`**

This file exports `DRAWER_HERO_PROMPT` — a multi-line template literal. It mentions the package by name. Find:

```
(use @pretable-internal/stream-adapter for LLM / SSE sources)
```

Change to:

```
(use @pretable/stream-adapter for LLM / SSE sources)
```

- [ ] **Step 1.11: Edit `apps/website/app/components/ComparisonTable.tsx`**

In the source comments at the bottom of `ROWS`, find:

```
// @cacheplane/json-stream + @pretable-internal/stream-adapter is the
```

Change to:

```
// @cacheplane/json-stream + @pretable/stream-adapter is the
```

- [ ] **Step 1.12: Create the changeset entry**

Create `.changeset/promote-stream-adapter.md` with this content EXACTLY:

```
---
"@pretable/stream-adapter": minor
---

Promote stream-adapter from `@pretable-internal/` to the public
`@pretable/` namespace. Same exports, same behavior. The package was
previously private and unreachable from npm despite being referenced in
the marketing copy and the AI-agent setup prompt at https://pretable.ai.
```

- [ ] **Step 1.13: Verify no stragglers**

```bash
grep -rln "@pretable-internal/stream-adapter" --include="*.json" --include="*.ts" --include="*.tsx" --include="*.mdx" --include="*.md" -- apps packages | grep -v CHANGELOG
```

Expected: empty (no output). If any matches remain, edit them (every match must become `@pretable/stream-adapter`).

- [ ] **Step 1.14: Run `pnpm install` to update lockfile**

```bash
pnpm install
```

Expected: lockfile updates, no errors. The new package name resolves through `workspace:*` to the renamed package.

- [ ] **Step 1.15: Run typecheck + tests across the workspace**

```bash
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website typecheck
```

Expected: ALL PASS (≥ 99 tests). If anything fails, the failure is most likely a missed import — re-run the grep from Step 1.13 with broader patterns.

- [ ] **Step 1.16: Commit**

```bash
git add -A
git commit -m "feat(stream-adapter): promote to public @pretable/stream-adapter

Rename package + drop private flag. Update 9 internal consumers
(streaming-demo, bench, website snippets/prompt/comment) in the same
commit so the workspace stays resolvable through pnpm.

Adds a changeset for the next release pass."
```

---

### Task 2: `<StreamingByDesign>` component — TDD

**Files:**

- Create: `apps/website/app/components/StreamingByDesign.tsx`
- Create: `apps/website/__tests__/components/StreamingByDesign.test.tsx`

- [ ] **Step 2.1: Write the failing test FIRST**

Create `apps/website/__tests__/components/StreamingByDesign.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { StreamingByDesign } from "../../app/components/StreamingByDesign";

describe("StreamingByDesign", () => {
  afterEach(() => cleanup());

  it("renders the eyebrow '05 · streaming, by design'", () => {
    render(<StreamingByDesign />);
    expect(screen.getByText(/05 · streaming, by design/i)).toBeInTheDocument();
  });

  it("renders the h2 with 'streaming-first' and an italic 'Not bolted-on.'", () => {
    render(<StreamingByDesign />);
    const h2 = screen.getByRole("heading", { level: 2 });
    expect(h2.textContent ?? "").toMatch(/built streaming-first/i);
    expect(h2.textContent ?? "").toMatch(/not bolted-on/i);
    // The "Not bolted-on." segment is wrapped in <em>.
    const em = h2.querySelector("em");
    expect(em).toBeInTheDocument();
    expect(em?.textContent ?? "").toMatch(/not bolted-on/i);
  });

  it("renders both card headings", () => {
    render(<StreamingByDesign />);
    expect(
      screen.getByRole("heading", { level: 3, name: /one shape, one path/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 3,
        name: /selection survives every patch/i,
      }),
    ).toBeInTheDocument();
  });

  it("card 1 body mentions applyTransaction", () => {
    const { container } = render(<StreamingByDesign />);
    expect(container.textContent ?? "").toMatch(/applyTransaction/);
  });

  it("card 2 body mentions row-id", () => {
    const { container } = render(<StreamingByDesign />);
    expect(container.textContent ?? "").toMatch(/row-id/i);
  });

  it("renders an api-reference link to /docs/streaming", () => {
    render(<StreamingByDesign />);
    const link = screen.getByRole("link", { name: /api reference/i });
    expect(link).toHaveAttribute("href", "/docs/streaming");
  });
});
```

- [ ] **Step 2.2: Run, confirm fails**

```bash
pnpm --filter @pretable/app-website test -- StreamingByDesign
```

Expected: FAIL — module not found.

- [ ] **Step 2.3: Implement StreamingByDesign**

Create `apps/website/app/components/StreamingByDesign.tsx`:

```tsx
interface Card {
  heading: string;
  body: React.ReactNode;
}

const CARDS: readonly Card[] = [
  {
    heading: "One shape, one path",
    body: (
      <>
        <code className="font-mono text-[12px] text-text-primary">
          applyTransaction(&#123; add, update, remove &#125;)
        </code>{" "}
        is the only entry point into the engine. Static rows hit it via{" "}
        <code className="font-mono text-[12px] text-text-primary">add()</code>;
        SSE tokens hit it via the same method per chunk. The streaming adapter
        is a thin batcher around that interface — not a separate code path.
      </>
    ),
  },
  {
    heading: "Selection survives every patch",
    body: (
      <>
        Row-id keys are first-class in the engine. Sort, filter, scroll
        position, focused row — none of it loses state mid-stream. Drag-select
        200 rows during a 25k/sec patch storm and they stay selected.
      </>
    ),
  },
];

export function StreamingByDesign() {
  return (
    <section
      id="streaming-by-design"
      className="text-text-primary px-7 py-16 md:px-10 md:py-28"
    >
      <div className="mx-auto max-w-[1240px]">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
          05 · streaming, by design
        </p>
        <h2 className="mt-4 font-display text-[36px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
          Built streaming-first.{" "}
          <em className="italic text-accent">Not bolted-on.</em>
        </h2>
        <p className="mt-5 max-w-[64ch] font-display text-[17px] leading-[1.55] text-text-secondary">
          Most grids accept streaming through an adapter layered onto a
          batch-era data model. Pretable's engine treats a 1,000-patch/sec
          stream and a static 3,000-row array as the same input shape — one
          reducer, one render path, one selection model. There's no "streaming
          mode" toggle.
        </p>

        <ul className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
          {CARDS.map((card) => (
            <li
              key={card.heading}
              className="rounded-[8px] border border-rule bg-bg-card p-6"
            >
              <h3 className="font-display text-[18px] tracking-[-0.01em] text-text-primary">
                {card.heading}
              </h3>
              <p className="mt-3 font-display text-[14px] leading-[1.55] text-text-secondary">
                {card.body}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-8 font-mono text-[12px] text-text-muted">
          <a
            href="/docs/streaming"
            className="text-accent-deep underline-offset-2 hover:underline"
          >
            API reference → /docs/streaming
          </a>
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2.4: Run, confirm passes**

```bash
pnpm --filter @pretable/app-website test -- StreamingByDesign
```

Expected: PASS, 6/6.

- [ ] **Step 2.5: Commit**

```bash
git add apps/website/app/components/StreamingByDesign.tsx apps/website/__tests__/components/StreamingByDesign.test.tsx
git commit -m "feat(website): StreamingByDesign — wedge thesis section with two proof cards"
```

---

### Task 3: Wire `<StreamingByDesign>` into `page.tsx`

**Files:**

- Modify: `apps/website/app/page.tsx`

- [ ] **Step 3.1: Replace `apps/website/app/page.tsx` with the new ordering**

Read the current file first:

```bash
cat apps/website/app/page.tsx
```

Then replace it with this content EXACTLY:

```tsx
import { CodeExample } from "./components/CodeExample";
import { ComparisonTable } from "./components/ComparisonTable";
import { CredibilityCards } from "./components/CredibilityCards";
import { CtaSection } from "./components/CtaSection";
import { DrawerHandle } from "./components/DrawerHandle";
import { DrawerHero } from "./components/DrawerHero";
import { DrawerNavSlot } from "./components/DrawerNavSlot";
import { DrawerShell } from "./components/DrawerShell";
import { FeatureGrid } from "./components/FeatureGrid";
import { HeroGrid } from "./components/HeroGrid";
import { ControlStateProvider } from "./components/heroGrid/controlState";
import { HomeStreamHeader } from "./components/HomeStreamHeader";
import { HowItWorks } from "./components/HowItWorks";
import { MountainFooter } from "./components/MountainFooter";
import { ReceiptsBand } from "./components/ReceiptsBand";
import { ScrollReveal } from "./components/ScrollReveal";
import { StreamingByDesign } from "./components/StreamingByDesign";

export default function HomePage() {
  return (
    <ControlStateProvider>
      <main>
        <HomeStreamHeader />
        <HeroGrid />
      </main>
      <DrawerHandle />
      <DrawerShell>
        <DrawerNavSlot />
        <DrawerHero />
        <CredibilityCards />
        <ReceiptsBand />
        <ScrollReveal>
          <ComparisonTable />
        </ScrollReveal>
        <ScrollReveal>
          <HowItWorks />
        </ScrollReveal>
        <ScrollReveal>
          <StreamingByDesign />
        </ScrollReveal>
        <ScrollReveal>
          <CodeExample />
        </ScrollReveal>
        <ScrollReveal>
          <FeatureGrid />
        </ScrollReveal>
        <ScrollReveal>
          <CtaSection />
        </ScrollReveal>
        <MountainFooter />
      </DrawerShell>
    </ControlStateProvider>
  );
}
```

The single change vs. the current file: a `StreamingByDesign` import + a new `<ScrollReveal><StreamingByDesign /></ScrollReveal>` between `<HowItWorks>` and `<CodeExample>`. Imports stay alphabetically sorted.

- [ ] **Step 3.2: Run the suite**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS.

- [ ] **Step 3.3: Commit**

```bash
git add apps/website/app/page.tsx
git commit -m "feat(website): insert StreamingByDesign between HowItWorks and CodeExample"
```

---

### Task 4: Renumber CodeExample (`05 → 06`) and FeatureGrid (`06 → 07`) eyebrows

The new section claims `05 · streaming, by design`, so the two sections after it shift up by one.

**Files:**

- Modify: `apps/website/app/components/CodeExample.tsx`
- Modify: `apps/website/app/components/FeatureGrid.tsx`

- [ ] **Step 4.1: Find current eyebrow text in CodeExample**

```bash
grep -n "for engineers\|05 ·\|· for engineers" apps/website/app/components/CodeExample.tsx
```

The eyebrow string is `05 · for engineers` inside a `<p>` element.

- [ ] **Step 4.2: Edit CodeExample.tsx — change `05 · for engineers` → `06 · for engineers`**

- [ ] **Step 4.3: Find current eyebrow in FeatureGrid**

```bash
grep -n "06 ·\|· what's in the box" apps/website/app/components/FeatureGrid.tsx
```

Should match `06 · what's in the box`.

- [ ] **Step 4.4: Edit FeatureGrid.tsx — change `06 · what's in the box` → `07 · what's in the box`**

- [ ] **Step 4.5: Run the suite**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS. The existing CodeExample/FeatureGrid tests assert on filenames and headings — neither asserts the eyebrow number, so this passes without test changes.

- [ ] **Step 4.6: Commit**

```bash
git add apps/website/app/components/CodeExample.tsx apps/website/app/components/FeatureGrid.tsx
git commit -m "feat(website): renumber section eyebrows 05→06, 06→07 for streaming insertion"
```

---

### Task 5: Add Streaming group to docs sidebar nav

**Files:**

- Modify: `apps/website/app/docs/_nav.ts`

- [ ] **Step 5.1: Replace the `docsNav` export**

Read the current file:

```bash
cat apps/website/app/docs/_nav.ts
```

The current order (post Bucket A) is: Getting Started → Grid → Theming. Insert a new "Streaming" group between Grid and Theming. Replace the file content with:

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
    items: [
      { title: "Install + first grid", href: "/docs/getting-started" },
      { title: "Concepts", href: "/docs/getting-started/concepts" },
    ],
  },
  {
    title: "Grid",
    items: [
      { title: "Overview", href: "/docs/grid" },
      {
        title: "<Pretable> component",
        href: "/docs/grid/pretable-component",
      },
      {
        title: "Custom rendering",
        href: "/docs/grid/custom-rendering",
      },
      { title: "Density helpers", href: "/docs/grid/density-helpers" },
      { title: "API reference", href: "/docs/grid/api-reference" },
    ],
  },
  {
    title: "Streaming",
    items: [
      { title: "Overview", href: "/docs/streaming" },
      { title: "Element streams", href: "/docs/streaming/element-streams" },
      { title: "Partial streams", href: "/docs/streaming/partial-streams" },
      { title: "Parsers", href: "/docs/streaming/parsers" },
      { title: "API reference", href: "/docs/streaming/api-reference" },
    ],
  },
  {
    title: "Theming",
    items: [
      { title: "Overview", href: "/docs/theming" },
      { title: "Pick a theme", href: "/docs/theming/pick-a-theme" },
      { title: "Override tokens", href: "/docs/theming/override-tokens" },
      { title: "Light / dark", href: "/docs/theming/light-dark" },
      { title: "Density", href: "/docs/theming/density" },
      { title: "Custom themes", href: "/docs/theming/custom-themes" },
      {
        title: "Tailwind + CSS-in-JS",
        href: "/docs/theming/tailwind-css-in-js",
      },
      { title: "Token reference", href: "/docs/theming/token-reference" },
    ],
  },
];
```

- [ ] **Step 5.2: Run the suite**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS. The existing `DocsSidebar.test.tsx` counts headings as `docsNav.length * 2` and links as `totalItems * 2` — both auto-grow with the array, so adding a new group does not break those assertions. The MDX pages targeted by these hrefs do not exist yet — that's fine, the sidebar test only renders the sidebar component, not the linked routes.

- [ ] **Step 5.3: Commit**

```bash
git add apps/website/app/docs/_nav.ts
git commit -m "docs(website): add top-level Streaming group between Grid and Theming"
```

---

### Task 6: Author 5 MDX docs pages under `/docs/streaming/*`

This task creates all 5 MDX pages in one commit. Each page is short (one-screen-readable), so a per-page commit would be needlessly granular. Verify the pages render at `/docs/streaming/...` after creation.

**Files:**

- Create: `apps/website/app/docs/streaming/page.mdx`
- Create: `apps/website/app/docs/streaming/element-streams/page.mdx`
- Create: `apps/website/app/docs/streaming/partial-streams/page.mdx`
- Create: `apps/website/app/docs/streaming/parsers/page.mdx`
- Create: `apps/website/app/docs/streaming/api-reference/page.mdx`

- [ ] **Step 6.1: Create `apps/website/app/docs/streaming/page.mdx` (overview)**

````mdx
---
title: Streaming
description: Pretable's streaming-adapter API — connectElementStream, connectPartialStream, parsers, and the createBatcher escape hatch.
---

# Streaming

`@pretable/stream-adapter` wires any async data source to a Pretable grid. It treats a 1,000-patch/sec stream and a static array of rows as the same input shape — one reducer, one render path, one selection model. There's no "streaming mode" toggle.

## Install

```bash
npm install @pretable/stream-adapter
```
````

The package depends on `@pretable/react` (for the grid surface) and exposes a small public API:

| Helper                 | When to use                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `connectElementStream` | Source emits one full row per chunk (LLM Responses, SSE, paginated REST). |
| `connectPartialStream` | Source emits successive partial updates to a single row (token-by-token). |
| `parseElementStream`   | Source emits raw JSON text chunks of an array; you need typed elements.   |
| `parsePartialStream`   | Source emits raw JSON text chunks of an object; you need typed partials.  |
| `createBatcher`        | Lower-level escape hatch; drive the lifecycle yourself.                   |

## Quick example

```tsx
"use client";
import { useEffect, useState } from "react";
import { connectElementStream } from "@pretable/stream-adapter";
import { Pretable } from "@pretable/react";
import { columns, type ChatRow } from "./columns";
import { openai } from "./openai-client";

export function ChatGrid({ prompt }: { prompt: string }) {
  const [rows, setRows] = useState<ChatRow[]>([]);
  useEffect(() => {
    void (async () => {
      const stream = await openai.responses.stream({
        model: "gpt-5",
        input: prompt,
      });
      connectElementStream(
        {
          applyTransaction: (tx) =>
            tx.add && setRows((r) => [...r, ...tx.add!]),
        },
        stream,
      );
    })();
  }, [prompt]);
  return <Pretable rows={rows} columns={columns} getRowId={(r) => r.id} />;
}
```

## Continue

- [Element streams →](/docs/streaming/element-streams) — full reference for `connectElementStream`.
- [Partial streams →](/docs/streaming/partial-streams) — token-by-token row growth.
- [Parsers →](/docs/streaming/parsers) — raw-JSON-string streams.
- [API reference →](/docs/streaming/api-reference) — types and the `createBatcher` escape hatch.

````

- [ ] **Step 6.2: Create `apps/website/app/docs/streaming/element-streams/page.mdx`**

```mdx
---
title: Element streams
description: connectElementStream — wire an AsyncIterable<Row> to a Pretable grid.
---

# Element streams

Use `connectElementStream` when the source emits one full row per chunk: LLM Responses elements, SSE messages where each event is a complete row, paginated REST results streamed in.

## Signature

```ts
function connectElementStream<TRow extends Record<string, unknown>>(
  grid: GridLike<TRow>,
  stream: AsyncIterable<TRow>,
): StreamConnection;
````

- `grid` — anything implementing `GridLike` (a method `applyTransaction({ add?, update?, remove? })`). The Pretable engine implements this directly; for React state you can supply a thin shim, as shown below.
- `stream` — any `AsyncIterable<TRow>`. The function reads it to completion and applies each yielded row via `applyTransaction({ add: [row] })`, batched per microtask.
- Returns a `StreamConnection` — `{ done: Promise<void>; dispose(): void }`.

## Lifecycle

- `done` resolves when the source iterator finishes; rejects if it throws.
- `dispose()` stops consuming the source. Already-buffered rows still flush; further chunks are ignored.

## Recipe — OpenAI Responses

```tsx
"use client";
import { useEffect, useState } from "react";
import { connectElementStream } from "@pretable/stream-adapter";
import { Pretable } from "@pretable/react";
import { openai } from "./openai-client";

interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export function ChatGrid({ prompt }: { prompt: string }) {
  const [rows, setRows] = useState<ChatRow[]>([]);
  useEffect(() => {
    const conn = connectElementStream<ChatRow>(
      {
        applyTransaction: (tx) => {
          if (tx.add) setRows((r) => [...r, ...tx.add!]);
        },
      },
      openai.responses.stream({ model: "gpt-5", input: prompt }),
    );
    return () => conn.dispose();
  }, [prompt]);
  return (
    <Pretable
      rows={rows}
      columns={[
        { id: "role", header: "Role", widthPx: 100 },
        { id: "content", header: "Content", widthPx: 480, wrap: true },
      ]}
      getRowId={(r) => r.id}
    />
  );
}
```

## Recipe — SSE / EventSource

```ts
async function* fromEventSource(url: string): AsyncIterable<Row> {
  const es = new EventSource(url);
  const queue: Row[] = [];
  let resolve!: () => void;
  let pending = new Promise<void>((r) => (resolve = r));

  es.onmessage = (e) => {
    queue.push(JSON.parse(e.data));
    resolve();
    pending = new Promise<void>((r) => (resolve = r));
  };

  while (true) {
    while (queue.length) yield queue.shift()!;
    await pending;
  }
}

connectElementStream(grid, fromEventSource("/api/events"));
```

## When you have raw JSON instead of typed values

If your source yields strings instead of objects (e.g. `Response.body` from `fetch`), pipe through `parseElementStream` first:

```ts
import { parseElementStream } from "@pretable/stream-adapter";

const res = await fetch("/api/events");
connectElementStream(grid, parseElementStream(res.body));
```

See [Parsers →](/docs/streaming/parsers).

````

- [ ] **Step 6.3: Create `apps/website/app/docs/streaming/partial-streams/page.mdx`**

```mdx
---
title: Partial streams
description: connectPartialStream — token-by-token row growth for LLM streaming.
---

# Partial streams

Use `connectPartialStream` when a single row grows over time. The canonical case: an assistant chat row whose `content` field accumulates token by token; `tokens` and `latencyMs` updated each chunk.

## Signature

```ts
function connectPartialStream<TRow extends Record<string, unknown> & { id: string }>(
  grid: GridLike<TRow>,
  stream: AsyncIterable<Partial<TRow>>,
  options: PartialStreamOptions,
): StreamConnection;

interface PartialStreamOptions {
  rowId: string;
}
````

Each yielded `Partial<TRow>` is merged into the row keyed by `options.rowId` via `applyTransaction.update`. The row must already exist (call `applyTransaction.add` once before connecting, or seed it through your engine state).

## Recipe — chat completion

```tsx
import { connectPartialStream } from "@pretable/stream-adapter";

// Seed the row first.
grid.applyTransaction({
  add: [
    { id: "msg-001", role: "assistant", content: "", tokens: 0, latencyMs: 0 },
  ],
});

connectPartialStream<ChatRow>(
  grid,
  openai.responses.stream({ model: "gpt-5", input: prompt }),
  { rowId: "msg-001" },
);
```

Each chunk's `Partial<ChatRow>` (whatever fields it carries — typically `content` deltas accumulated client-side) is merged into the seeded row. The grid's selection, scroll position, and focus state stay anchored to that row across every patch.

## Lifecycle

Same as `connectElementStream` — `done` resolves when the iterator finishes, `dispose()` stops consuming early.

## When you have raw JSON

If your source emits raw JSON strings (e.g. a single object whose keys arrive over time), pipe through `parsePartialStream` first. See [Parsers →](/docs/streaming/parsers).

````

- [ ] **Step 6.4: Create `apps/website/app/docs/streaming/parsers/page.mdx`**

```mdx
---
title: Parsers
description: parseElementStream + parsePartialStream — turn raw JSON string chunks into typed async iterables.
---

# Parsers

The `parse*` helpers sit one layer below `connect*`. They accept an `AsyncIterable<string>` (raw JSON chunks from `fetch`, `Response.body`, SSE, etc.) and yield typed values. Pipe their output into the connect helpers.

## `parseElementStream<TRow>(stream)`

Source emits a streaming JSON array. The parser yields each element as it parses — you don't wait for the array to close.

```ts
import { parseElementStream } from "@pretable/stream-adapter";

const res = await fetch("/api/events");
for await (const row of parseElementStream<Row>(res.body)) {
  console.log("got row", row);
}
````

In the connect-element pattern:

```ts
import {
  connectElementStream,
  parseElementStream,
} from "@pretable/stream-adapter";

const res = await fetch("/api/events");
connectElementStream<Row>(grid, parseElementStream<Row>(res.body));
```

## `parsePartialStream<TRow>(stream)`

Source emits a streaming JSON object. The parser yields successive `Partial<TRow>` snapshots as keys complete.

```ts
import { parsePartialStream } from "@pretable/stream-adapter";

const res = await fetch("/api/single-row-events");
for await (const partial of parsePartialStream<Row>(res.body)) {
  console.log("snapshot so far", partial);
}
```

In the connect-partial pattern:

```ts
import {
  connectPartialStream,
  parsePartialStream,
} from "@pretable/stream-adapter";

const res = await fetch("/api/single-row-events");
connectPartialStream<Row>(grid, parsePartialStream<Row>(res.body), {
  rowId: "row-001",
});
```

## Errors

Both parsers throw on malformed JSON. Wrap the consumer (or the connect call) in a try/catch and inspect via the `done` promise:

```ts
const conn = connectElementStream(grid, parseElementStream(res.body));
conn.done.catch((err) => console.error("stream failed:", err));
```

````

- [ ] **Step 6.5: Create `apps/website/app/docs/streaming/api-reference/page.mdx`**

```mdx
---
title: API reference
description: Type signatures for stream-adapter and the createBatcher escape hatch.
---

# API reference

## Types

| Type                       | Shape                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| `GridLike<TRow>`           | `{ applyTransaction({ add?, update?, remove? }): void }`                    |
| `StreamConnection`         | `{ done: Promise<void>; dispose(): void }`                                  |
| `TransactionBatcher<TRow>` | `{ add(rows), update(patches), remove(ids), flush(), dispose() }`           |
| `PartialStreamOptions`     | `{ rowId: string }`                                                         |

`GridLike` is structural — anything with an `applyTransaction` method that accepts `{ add?, update?, remove? }` works. The Pretable engine implements it directly; for React-state-driven scenarios you can supply a shim that pipes transactions into `setRows`.

## `createBatcher(grid): TransactionBatcher<TRow>`

Lower-level escape hatch when the connect helpers don't fit. Same batching semantics as the `connect*` helpers — transactions coalesce per microtask via `queueMicrotask` — but you drive the lifecycle yourself.

```ts
import { createBatcher } from "@pretable/stream-adapter";

const batcher = createBatcher(grid);
batcher.add([{ id: "1", role: "user", content: "Hello" }]);
batcher.update([{ id: "1", content: "Hello, world" }]);
batcher.flush();    // force the next tick's commit synchronously
batcher.dispose();  // release the queued microtask
````

Use this when you need to interleave streaming patches with imperative grid mutations (e.g. user-driven row removal during a stream), or when you're wiring an exotic source that doesn't fit the async-iterable shape.

## See also

- [Element streams](/docs/streaming/element-streams) — `connectElementStream`
- [Partial streams](/docs/streaming/partial-streams) — `connectPartialStream`
- [Parsers](/docs/streaming/parsers) — `parseElementStream` / `parsePartialStream`

````

- [ ] **Step 6.6: Run the suite**

```bash
pnpm --filter @pretable/app-website test
````

Expected: ALL PASS. The new MDX pages have no test files (they're content), but the existing DocsSidebar tests now generate links to all five new routes — Next.js will throw a 404 at runtime if a linked route doesn't exist, but unit tests don't exercise that. Manual verification covers it in Task 7.

- [ ] **Step 6.7: Commit**

```bash
git add apps/website/app/docs/streaming/
git commit -m "docs(website): streaming docs — overview, element/partial/parser/API-ref pages"
```

---

### Task 7: Manual Chrome verification + push + PR + merge on green

**Files:** none (verification + ship).

- [ ] **Step 7.1: Run the full website test suite**

```bash
pnpm --filter @pretable/app-website test
```

Expected: ALL PASS, ≥ 105 tests (99 baseline + 6 new from `StreamingByDesign.test.tsx`).

- [ ] **Step 7.2: Boot the dev server**

```bash
pkill -f "next dev"; sleep 2
pnpm --filter @pretable/app-website dev > /tmp/website-dev-bucket-d.log 2>&1 &
sleep 10 && grep -E "Ready|Local:|error" /tmp/website-dev-bucket-d.log | tail -3
```

Expected: `✓ Ready` and `http://localhost:3000`.

- [ ] **Step 7.3: Verify the marketing section via Assistant in Chrome MCP**

Navigate to `http://localhost:3000`, open the drawer, then:

```js
({
  streamingSection: !!document.querySelector("section#streaming-by-design"),
  eyebrow: document.querySelector("section#streaming-by-design p")?.textContent,
  h2: document
    .querySelector("section#streaming-by-design h2")
    ?.textContent?.trim(),
  cardHeadings: [
    ...document.querySelectorAll("section#streaming-by-design h3"),
  ].map((h) => h.textContent),
  apiLink: document
    .querySelector('section#streaming-by-design a[href="/docs/streaming"]')
    ?.textContent?.trim(),
});
```

Expected:

- `streamingSection: true`
- `eyebrow` matches `/05 · streaming, by design/i`
- `h2` matches `/Built streaming-first.*Not bolted-on/`
- `cardHeadings: ["One shape, one path", "Selection survives every patch"]`
- `apiLink` matches `/api reference/i`

- [ ] **Step 7.4: Verify the docs pages render**

Navigate to each route in turn and assert no 404 + the expected H1:

```js
// Run after navigating to each URL:
({
  url: location.pathname,
  h1: document.querySelector("article h1")?.textContent,
  noError: !document.body.textContent.includes("This page couldn't load"),
});
```

| URL                               | Expected H1       |
| --------------------------------- | ----------------- |
| `/docs/streaming`                 | `Streaming`       |
| `/docs/streaming/element-streams` | `Element streams` |
| `/docs/streaming/partial-streams` | `Partial streams` |
| `/docs/streaming/parsers`         | `Parsers`         |
| `/docs/streaming/api-reference`   | `API reference`   |

Also verify the docs sidebar shows the new "Streaming" group between "Grid" and "Theming" by reading `[...document.querySelectorAll('nav[aria-label="Docs"] h3')].map(h => h.textContent)` on `/docs/streaming` — expected output includes `["Getting Started", "Grid", "Streaming", "Theming", ...]` (each appears twice — once in the mobile <details> tree and once in the desktop <nav>).

- [ ] **Step 7.5: Stop the dev server**

```bash
pkill -f "next dev"
```

- [ ] **Step 7.6: Push the branch**

```bash
git push -u origin feat/bucket-d-streaming-story
```

- [ ] **Step 7.7: Open the PR**

```bash
gh pr create --title "feat(website): bucket D — promote stream-adapter + streaming story" \
  --body "Implements docs/superpowers/specs/2026-05-03-website-bucket-d-streaming-story-design.md.

Three coupled deliverables in one PR:

1. Promote @pretable-internal/stream-adapter to public @pretable/stream-adapter.
   Drops the private flag, adds a changeset, and renames imports across 9 internal
   consumers (apps/streaming-demo, apps/bench, marketing snippets/prompt/comment).
   The package becomes installable via npm install @pretable/stream-adapter,
   matching what the marketing copy and the AI-agent prompt have been promising.

2. New marketing section <StreamingByDesign> between HowItWorks and CodeExample.
   Eyebrow 05 · streaming, by design. Two-column proof cards (One shape, one path
   referencing applyTransaction; Selection survives every patch referencing row-id
   keys). Footer link → /docs/streaming. Renumbers CodeExample to 06 and FeatureGrid
   to 07.

3. New top-level Streaming group in the docs sidebar with 5 MDX pages: overview,
   element-streams, partial-streams, parsers, api-reference. Sits between Grid and
   Theming.

No code changes inside the package itself — same exports, same behavior."
```

- [ ] **Step 7.8: Watch CI**

```bash
gh pr checks <num> --watch --fail-fast
```

If `format` fails, run `pnpm exec prettier --write` on the affected files, commit `style: prettier --write`, push.

- [ ] **Step 7.9: Merge on green + verify production**

```bash
gh pr merge <num> --squash --delete-branch
```

Wait for the post-merge CI run on `main` to deploy via Vercel + Playwright smoke. Then verify pretable.ai with Chrome MCP:

- Drawer open → `<StreamingByDesign>` visible between HowItWorks and CodeExample.
- `/docs/streaming` index page renders, sidebar shows the new Streaming group.
- No console errors.

After merge, the changesets-release workflow will open a "Version Packages" PR that bumps `@pretable/stream-adapter`'s version and updates its CHANGELOG. When that secondary PR merges, the package publishes to npm. That second-stage publish is out of scope for this PR's verification (it's the existing release pipeline doing its job).
