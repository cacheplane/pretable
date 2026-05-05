# Pretable Docs v2 Follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the docs site v1 — Shiki-highlighted source tabs, a deterministic mock streaming demo, hand-authored frontmatter descriptions, MDX components used in flagship pages, tuned search ranking, OG metadata, and Playwright e2e hardening.

**Architecture:** Four small PRs, each shipped independently. PRs A and B touch components and content respectively (no overlap); PR C is small infra polish (search + metadata); PR D adds e2e against the deployed preview. Each PR branches from `main` and merges before the next starts (search ranking depends on real content from PR B; e2e depends on everything).

**Tech Stack:** Existing — Shiki (`shiki@4`) is already installed and used by `apps/website/app/components/CodeBlock.tsx`. Next 16 App Router metadata API. `fuzzysort@3`. Playwright. No new deps.

---

## Worktree / branch hygiene

This worktree is at `/Users/blove/repos/pretable/.claude/worktrees/nice-cerf-cac464`. Between PRs, reset to `origin/main`:

```bash
git fetch origin main
git checkout main 2>/dev/null || git checkout -B main origin/main
git reset --hard origin/main
git checkout -B claude/docs-v2-<pr-letter>
```

Open each PR with auto-merge on green:

```bash
gh pr create --title "..." --body "..."
gh pr merge --squash --auto
```

---

## File Structure

**PR A: Example polish**
- Modify: `apps/website/lib/docs/define-example.ts` — add `htmlSource` field
- Modify: `apps/website/content/examples/streaming-chat-grid/index.tsx` — pre-highlight via Shiki, deterministic mock Demo
- Modify: `apps/website/app/components/docs/mdx/Example.tsx` — render `htmlSource` when present, fallback to plain `<pre>`
- Test: `apps/website/app/components/docs/mdx/__tests__/Example.test.tsx` — assert highlighted markup
- Modify: `apps/website/__tests__/components/CodeExample.test.tsx` — assert mock demo renders rows

**PR B: Content quality**
- Modify: 24 files under `apps/website/content/docs/**/*.mdx` — hand-authored `description:` frontmatter
- Modify: `apps/website/content/docs/getting-started/index.mdx` — convert install steps to `<Steps>`, swap callouts for `<Callout>`
- Modify: `apps/website/content/docs/streaming/index.mdx` — convert "the two paths" intro to `<Tabs>` and use `<Card>` for Pages cross-links

**PR C: Discoverability**
- Modify: `apps/website/app/components/docs/DocsSearch.tsx` — exact-title boost, recent-page first when query is empty
- Modify: `apps/website/app/docs/[[...slug]]/page.tsx` — extend `generateMetadata` with `openGraph` and `twitter`

**PR D: E2E hardening**
- Modify: `apps/website/e2e/docs.spec.ts` — fix selectors against deployed preview, add baseURL fallback
- Modify: `apps/website/playwright.config.ts` — keep behavior, add note for PR-preview override
- Add: `.github/workflows/playwright-docs.yml` — run docs e2e on PR previews

---

# PR A — Example polish (Shiki source highlighting + mock streaming demo)

**Branch:** `claude/docs-v2-a-example-polish`

## Task A1: `htmlSource` field on `ExampleDef`

**Files:**
- Modify: `apps/website/lib/docs/define-example.ts`
- Test: `apps/website/lib/docs/__tests__/define-example.test.tsx`

- [ ] **Step 1: Update test to cover optional htmlSource**

```tsx
// apps/website/lib/docs/__tests__/define-example.test.tsx
import { describe, expect, it } from "vitest";

import { defineExample } from "../define-example";

describe("defineExample", () => {
  it("returns the input narrowed to ExampleDef", () => {
    const def = defineExample({
      title: "X",
      Demo: <div>demo</div>,
      files: [{ path: "page.tsx", lang: "tsx", source: "const x = 1;" }],
    });
    expect(def.title).toBe("X");
    expect(def.files[0].path).toBe("page.tsx");
  });
  it("accepts pre-highlighted htmlSource", () => {
    const def = defineExample({
      title: "X",
      Demo: <div />,
      files: [
        {
          path: "a.ts",
          lang: "ts",
          source: "const a = 1;",
          htmlSource: "<pre><code>const a = 1;</code></pre>",
        },
      ],
    });
    expect(def.files[0].htmlSource).toContain("<pre>");
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @pretable/app-website test -- define-example`
Expected: FAIL — `htmlSource` not on type.

- [ ] **Step 3: Implement**

```ts
// apps/website/lib/docs/define-example.ts
import type { ReactNode } from "react";

export type ExampleLang =
  | "ts"
  | "tsx"
  | "js"
  | "jsx"
  | "css"
  | "json"
  | "bash";

export interface ExampleFile {
  path: string;
  lang: ExampleLang;
  source: string;
  /** Optional Shiki-highlighted HTML; if present, Example renders it via dangerouslySetInnerHTML. */
  htmlSource?: string;
}

export interface ExampleDef {
  title: string;
  Demo: ReactNode;
  files: readonly ExampleFile[];
}

export function defineExample(def: ExampleDef): ExampleDef {
  return def;
}
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @pretable/app-website test -- define-example`
Expected: 2/2 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/website/lib/docs/define-example.ts apps/website/lib/docs/__tests__/define-example.test.tsx
git commit -m "feat(website): add htmlSource field to ExampleDef"
```

## Task A2: `<Example>` renders `htmlSource` when present

**Files:**
- Modify: `apps/website/app/components/docs/mdx/Example.tsx`
- Test: `apps/website/app/components/docs/mdx/__tests__/Example.test.tsx`

- [ ] **Step 1: Add failing test for htmlSource rendering**

Append to `apps/website/app/components/docs/mdx/__tests__/Example.test.tsx`:

```tsx
it("renders htmlSource markup when provided", () => {
  const def = defineExample({
    title: "Demo",
    Demo: <div />,
    files: [
      {
        path: "a.ts",
        lang: "ts",
        source: "const a = 1;",
        htmlSource: '<pre data-shiki><code>highlighted</code></pre>',
      },
    ],
  });
  render(<Example example={def} defaultOpen />);
  expect(document.querySelector("pre[data-shiki]")).not.toBeNull();
  expect(document.querySelector("pre[data-shiki]")).toHaveTextContent(
    "highlighted",
  );
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @pretable/app-website test -- Example.test`
Expected: FAIL — `pre[data-shiki]` not found.

- [ ] **Step 3: Update Example.tsx — render htmlSource branch**

Replace the `<pre>` block in `apps/website/app/components/docs/mdx/Example.tsx` (the one currently rendering `{file.source}`) with:

```tsx
{file.htmlSource ? (
  <div
    className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55] [&_pre]:m-0 [&_pre]:bg-transparent [&_code]:bg-transparent"
    dangerouslySetInnerHTML={{ __html: file.htmlSource }}
  />
) : (
  <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.55]">
    {file.source}
  </pre>
)}
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @pretable/app-website test -- Example.test`
Expected: 4/4 passing (3 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/docs/mdx/Example.tsx apps/website/app/components/docs/mdx/__tests__/Example.test.tsx
git commit -m "feat(website): Example renders pre-highlighted htmlSource when present"
```

## Task A3: Pre-highlight streaming-chat-grid source via Shiki at module load

**Files:**
- Modify: `apps/website/content/examples/streaming-chat-grid/index.tsx`

- [ ] **Step 1: Replace `index.tsx` with Shiki-pre-highlighted version**

```tsx
// apps/website/content/examples/streaming-chat-grid/index.tsx
import fs from "node:fs";
import path from "node:path";

import { codeToHtml } from "shiki";

import { defineExample } from "../../../lib/docs/define-example";
import type { ExampleLang } from "../../../lib/docs/define-example";

const DIR = path.join(process.cwd(), "content/examples/streaming-chat-grid");
const read = (f: string) => fs.readFileSync(path.join(DIR, f), "utf8");

interface FileSpec {
  path: string;
  lang: ExampleLang;
}

const SPEC: readonly FileSpec[] = [
  { path: "page.tsx", lang: "tsx" },
  { path: "ChatGrid.tsx", lang: "tsx" },
  { path: "columns.ts", lang: "ts" },
  { path: "openai-client.ts", lang: "ts" },
];

const SHIKI_LANG: Record<ExampleLang, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  css: "css",
  json: "json",
  bash: "bash",
};

// Pre-highlight every file at module load. Mirrors the existing CodeBlock
// pattern (top-level await on static input). No client JS needed.
const files = await Promise.all(
  SPEC.map(async (s) => {
    const source = read(s.path).trimEnd();
    const htmlSource = await codeToHtml(source, {
      lang: SHIKI_LANG[s.lang],
      theme: "github-light",
    });
    return { path: s.path, lang: s.lang, source, htmlSource };
  }),
);

// Demo component is local so the docs source files (which import `openai`)
// don't need to be bundled.
import { MockChatGrid } from "./MockChatGrid";

export const streamingChatGrid = defineExample({
  title: "Streaming chat grid",
  Demo: <MockChatGrid />,
  files,
});
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @pretable/app-website typecheck`
Expected: clean (MockChatGrid resolved by next task).

This task does not commit yet — A4 creates `MockChatGrid.tsx` and they ship together.

## Task A4: Deterministic mock streaming demo

**Files:**
- Create: `apps/website/content/examples/streaming-chat-grid/MockChatGrid.tsx`
- Test: `apps/website/content/examples/streaming-chat-grid/__tests__/MockChatGrid.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// apps/website/content/examples/streaming-chat-grid/__tests__/MockChatGrid.test.tsx
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MockChatGrid } from "../MockChatGrid";

describe("MockChatGrid", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("starts empty and emits one row per tick up to a deterministic max", () => {
    render(<MockChatGrid intervalMs={100} maxRows={3} />);
    expect(screen.queryAllByRole("row")).toHaveLength(0);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(1);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // Header row + 3 data rows
    expect(screen.getAllByRole("row").length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @pretable/app-website test -- MockChatGrid`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// apps/website/content/examples/streaming-chat-grid/MockChatGrid.tsx
"use client";

import { useEffect, useState } from "react";

interface Row {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  latencyMs: number;
}

const SCRIPT: readonly Omit<Row, "id">[] = [
  {
    role: "user",
    content: "Summarize the last 10 incidents.",
    tokens: 9,
    latencyMs: 0,
  },
  {
    role: "assistant",
    content: "10 incidents over 30 days; 6 latency, 4 errors.",
    tokens: 15,
    latencyMs: 412,
  },
  {
    role: "assistant",
    content: "Top driver: cold-start regressions on the bench worker.",
    tokens: 11,
    latencyMs: 287,
  },
  {
    role: "assistant",
    content: "Recommend pinning the bench-worker pool size.",
    tokens: 8,
    latencyMs: 201,
  },
];

export interface MockChatGridProps {
  intervalMs?: number;
  maxRows?: number;
}

export function MockChatGrid({
  intervalMs = 700,
  maxRows = SCRIPT.length,
}: MockChatGridProps) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      if (i >= Math.min(maxRows, SCRIPT.length)) {
        clearInterval(id);
        return;
      }
      const next = SCRIPT[i];
      setRows((r) => [...r, { ...next, id: `r-${i}` }]);
      i += 1;
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, maxRows]);

  return (
    <table className="w-full border-collapse font-mono text-[12px]">
      <thead className="border-b border-rule bg-bg-card/50">
        <tr>
          <th className="px-3 py-2 text-left text-text-secondary">Role</th>
          <th className="px-3 py-2 text-left text-text-secondary">Content</th>
          <th className="px-3 py-2 text-right text-text-secondary">Tokens</th>
          <th className="px-3 py-2 text-right text-text-secondary">Latency</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-rule-soft">
            <td className="px-3 py-1.5 text-text-primary">{r.role}</td>
            <td className="px-3 py-1.5 text-text-primary">{r.content}</td>
            <td className="px-3 py-1.5 text-right text-text-dim">
              {r.tokens}
            </td>
            <td className="px-3 py-1.5 text-right text-text-dim">
              {r.latencyMs}ms
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run all tests**

Run: `pnpm --filter @pretable/app-website test`
Expected: all green; new MockChatGrid test passes; existing CodeExample test still passes (it doesn't assert on rows, only the demo container).

- [ ] **Step 5: Verify build**

Run: `pnpm --filter @pretable/app-website build`
Expected: success. The streaming-chat-grid index now produces highlighted source via Shiki at build.

- [ ] **Step 6: Update CodeExample test to assert mock demo presence**

```tsx
// apps/website/__tests__/components/CodeExample.test.tsx — add a new test
it("renders the mock chat grid demo with header row", () => {
  render(<CodeExample />);
  // Mock demo renders a table with header columns
  expect(screen.getByRole("columnheader", { name: /role/i })).toBeInTheDocument();
  expect(
    screen.getByRole("columnheader", { name: /content/i }),
  ).toBeInTheDocument();
});
```

- [ ] **Step 7: Run final tests**

Run: `pnpm --filter @pretable/app-website test`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/website/content/examples/streaming-chat-grid/ apps/website/__tests__/components/CodeExample.test.tsx
git commit -m "feat(website): mock streaming demo + Shiki-highlighted source tabs"
```

## Task A5: Open PR A and merge on green

- [ ] **Step 1: Run all checks locally**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website build
pnpm format:write
git add -A && git diff --cached --quiet || git commit -m "style: prettier format"
```

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin claude/docs-v2-a-example-polish
gh pr create --title "feat(website): docs Example — Shiki highlighting + live mock streaming demo" --body "$(cat <<'EOF'
## Summary

- \`<Example>\` source tabs now show Shiki-highlighted code (github-light theme) — pre-rendered at module load, no client JS for highlighting
- Marketing landing's chat-grid section ships a deterministic mock streaming demo (4 rows, 700ms cadence) so the live panel actually demos the streaming story instead of a placeholder
- New \`htmlSource\` field on \`ExampleDef\` is optional; falls back to plain \`<pre>\` when absent

## Test plan
- [x] \`pnpm test\` — Example renders htmlSource when present, MockChatGrid emits rows on a fake timer
- [x] \`pnpm build\` — module-load Shiki call succeeds in production build
- [ ] Manual: visit \`/\` — chat-grid section shows live demo with rows streaming in; toggle "Show source" — tabs render with syntax colors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --squash --auto
```

- [ ] **Step 3: Wait for merge, then reset for PR B**

```bash
gh pr view --json mergeStateStatus -q .mergeStateStatus
# When MERGED:
git fetch origin main
git reset --hard origin/main
git checkout -B claude/docs-v2-b-content-quality
```

---

# PR B — Content quality (descriptions + flagship MDX usage)

**Branch:** `claude/docs-v2-b-content-quality`

## Task B1: Hand-author descriptions for all 24 docs pages

**Files:**
- Modify: 24 files in `apps/website/content/docs/`

- [ ] **Step 1: Write descriptions inline**

For each file, replace the `description:` frontmatter line with a hand-authored sentence. Use the canonical descriptions below — they are scoped to ~80–140 chars, declarative, and avoid restating the title.

| File | New description |
|---|---|
| `getting-started/index.mdx` | `Install @pretable/react and render your first three-column grid in five minutes.` |
| `getting-started/concepts.mdx` | `One-page mental model: engine, theming, and streaming as three composable layers.` |
| `grid/index.mdx` | `Two paths for using the engine: the <Pretable> drop-in or the usePretable hooks for custom rendering.` |
| `grid/pretable-component.mdx` | `<Pretable> is the simplest way to render a grid — pass rows, columns, and getRowId, get a working table.` |
| `grid/pretable-surface.mdx` | `<PretableSurface> is the unopinionated grid component — bring your own header and chrome.` |
| `grid/custom-rendering.mdx` | `usePretableModel exposes the engine state so you can render rows your own way.` |
| `grid/density-helpers.mdx` | `Read density tokens (compact, standard, spacious) into JavaScript at runtime.` |
| `grid/api-reference.mdx` | `Type signatures for the public exports of @pretable/react.` |
| `streaming/index.mdx` | `@pretable/stream-adapter wires any async data source to a grid — one reducer, one render path.` |
| `streaming/element-streams.mdx` | `connectElementStream emits one full row per chunk — for SSE, LLM Responses elements, and paginated REST.` |
| `streaming/partial-streams.mdx` | `connectPartialStream is for sources where a single row grows over time, like token-streamed assistant replies.` |
| `streaming/parsers.mdx` | `Lower-level parse* helpers if you need to feed the engine yourself.` |
| `streaming/api-reference.mdx` | `Type signatures for @pretable/stream-adapter.` |
| `theming/index.mdx` | `Three cooperating layers: the prebuilt themes, the override CSS, and the density toggle.` |
| `theming/pick-a-theme.mdx` | `Two prebuilt themes ship with @pretable/ui — Excel for dense technical, Material 3 for modern.` |
| `theming/override-tokens.mdx` | `Override individual --pretable-* tokens with plain CSS cascade — no preprocessor required.` |
| `theming/light-dark.mdx` | `Material 3 ships both light and dark variants — toggle by setting data-theme on <html>.` |
| `theming/density.mdx` | `Three density tiers — compact, standard, spacious — selected by data-density on <html>.` |
| `theming/custom-themes.mdx` | `Author a theme file from a template when overrides grow beyond a handful of tokens.` |
| `theming/tailwind-css-in-js.mdx` | `@pretable/ui ships pure CSS, so it works in any styling toolchain.` |
| `theming/token-reference.mdx` | `The 24-token --pretable-* surface, with shape, default, and purpose for each.` |

For each file, edit only the line `description: "..."` (or unquoted variant) to the value above, preserving surrounding frontmatter and body.

- [ ] **Step 2: Run typecheck + tests + build**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website build
```

Expected: all green. Build smoke ensures every YAML description still parses.

- [ ] **Step 3: Commit**

```bash
git add apps/website/content/docs/
git commit -m "docs(website): hand-author frontmatter descriptions for all 24 pages"
```

## Task B2: Use `<Steps>` and `<Callout>` in Getting Started

**Files:**
- Modify: `apps/website/content/docs/getting-started/index.mdx`

- [ ] **Step 1: Rewrite the install + first grid flow as Steps**

Replace the body (everything after the closing `---`) of `apps/website/content/docs/getting-started/index.mdx` with:

```mdx
This guide installs `@pretable/react` and renders a three-column, five-row grid.

<Steps>
  <Step title="Install the packages">
    `npm i @pretable/react @pretable/ui` — the `react` package is the engine, `ui` ships the themes.
  </Step>
  <Step title="Import the styles">
    Pick a theme and import its CSS plus the grid skin once at your app's entry point:

    ```css
    @import "@pretable/ui/themes/excel.css";
    @import "@pretable/ui/grid.css";
    ```

    The theme file declares all `--pretable-*` tokens at `:root`; `grid.css` is the selector-based skin that targets the engine's `[data-pretable-*]` data attributes. Two themes ship today — `excel.css` (gray, dense, technical, light-only) and `material.css` (Material 3 light + dark; toggle dark mode by setting `data-theme="dark"` on `<html>`). If you only need the engine, skip both imports and the grid renders unstyled (functional but no visual chrome).
  </Step>
  <Step title="Render your first grid">
    ```tsx
    import {
      Pretable,
      type PretableColumn,
      type PretableRow,
    } from "@pretable/react";

    const columns: Array<PretableColumn> = [
      { id: "name", header: "Name", getValue: (r) => r.name },
      { id: "role", header: "Role", getValue: (r) => r.role },
      { id: "city", header: "City", getValue: (r) => r.city },
    ];

    const rows: Array<PretableRow> = [
      { id: "1", name: "Ada", role: "Engineer", city: "London" },
      { id: "2", name: "Grace", role: "Admiral", city: "New York" },
      { id: "3", name: "Linus", role: "Maintainer", city: "Helsinki" },
      { id: "4", name: "Margaret", role: "Director", city: "Boston" },
      { id: "5", name: "Tim", role: "Inventor", city: "London" },
    ];

    export function People() {
      return <Pretable rows={rows} columns={columns} />;
    }
    ```
  </Step>
</Steps>

<Callout type="tip">
  Tailwind v4 users can additionally import `@pretable/ui/tailwind.css` to get `bg-pt-*`/`text-pt-*` utility shortcuts that alias the `--pretable-*` tokens. Density (compact / standard / spacious) is runtime-switchable by toggling `data-density="..."` on `<html>`.
</Callout>

That's the full surface for a static grid. Sort, filter, selection, and streaming rows are layered on top — see [/docs/streaming](/docs/streaming) for the streaming-adapter API while a guide for the rest is being written.

## What's next

API reference and recipes are in flight. For now, browse the [public exports](https://github.com/cacheplane/pretable/blob/main/packages/react/src/index.ts) and [/docs/streaming](/docs/streaming) for the streaming-adapter API.
```

- [ ] **Step 2: Verify renders**

Run: `pnpm --filter @pretable/app-website build`
Expected: success. MDX compiles, no unknown components.

- [ ] **Step 3: Commit**

```bash
git add apps/website/content/docs/getting-started/index.mdx
git commit -m "docs(website): Getting Started uses Steps + Callout"
```

## Task B3: Use `<Tabs>` and `<Card>` in Streaming overview

**Files:**
- Modify: `apps/website/content/docs/streaming/index.mdx`

- [ ] **Step 1: Read current content** to preserve the existing prose structure

```bash
cat apps/website/content/docs/streaming/index.mdx
```

- [ ] **Step 2: Rewrite the body to lead with Tabs (element vs partial), close with CardGroup of next steps**

Replace the body (after frontmatter `---`) with:

```mdx
`@pretable/stream-adapter` wires any async data source to a Pretable grid. It treats a 1,000-patch/sec stream and a static array of rows as the same input shape — one reducer, one render path, one selection model. There's no "streaming mode" toggle.

## Pick the shape that matches your source

<Tabs>
  <Tab label="Element streams">
    Use `connectElementStream` when the source emits **one full row per chunk** — LLM Responses elements, SSE messages where each event is a complete row, paginated REST results streamed in.

    ```ts
    import { connectElementStream } from "@pretable/stream-adapter";

    connectElementStream(stream, {
      onElement: (row) => grid.applyTransaction({ add: [row] }),
    });
    ```
  </Tab>
  <Tab label="Partial streams">
    Use `connectPartialStream` when **a single row grows over time** — a token-streamed assistant message, an incrementally-parsed JSON object, a row whose `latencyMs` ticks up as the request is in-flight.

    ```ts
    import { connectPartialStream } from "@pretable/stream-adapter";

    connectPartialStream(stream, {
      getRowId: (chunk) => chunk.id,
      onPatch: (patch) => grid.applyTransaction({ update: [patch] }),
    });
    ```
  </Tab>
</Tabs>

<Callout type="tip">
  Both helpers share the same back-pressure model: the engine batches transactions to one render per animation frame. Selection survives every patch.
</Callout>

## Next

<CardGroup cols={3}>
  <Card title="Element streams" href="/docs/streaming/element-streams">
    The full `connectElementStream` API and reconnect semantics.
  </Card>
  <Card title="Partial streams" href="/docs/streaming/partial-streams">
    `connectPartialStream`, patching a row as it grows.
  </Card>
  <Card title="Parsers" href="/docs/streaming/parsers">
    Lower-level `parseElement` / `parsePartial` if you're feeding the engine yourself.
  </Card>
</CardGroup>
```

- [ ] **Step 3: Run build to verify**

Run: `pnpm --filter @pretable/app-website build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/docs/streaming/index.mdx
git commit -m "docs(website): Streaming overview uses Tabs + CardGroup"
```

## Task B4: Open PR B and merge on green

- [ ] **Step 1: Final checks**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website build
pnpm format:write
git add -A && git diff --cached --quiet || git commit -m "style: prettier format"
```

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin claude/docs-v2-b-content-quality
gh pr create --title "docs(website): hand-author descriptions + use MDX components on flagship pages" --body "$(cat <<'EOF'
## Summary

- Hand-authored \`description:\` frontmatter for all 24 docs pages (better SEO, better search results, better Mintlify-style page hover cards in the future)
- Getting Started rewritten with \`<Steps>\` for the install flow + \`<Callout type="tip">\` for the Tailwind aside
- Streaming overview leads with \`<Tabs>\` (element vs partial) and closes with \`<CardGroup>\` cross-links

## Test plan
- [x] \`pnpm build\` — every MDX page compiles, descriptions parse cleanly
- [ ] Manual: visit \`/docs/getting-started\` — three numbered steps, callout below
- [ ] Manual: visit \`/docs/streaming\` — tabs switch between element/partial, CardGroup at bottom

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --squash --auto
```

- [ ] **Step 3: Wait for merge, reset for PR C**

```bash
git fetch origin main
git reset --hard origin/main
git checkout -B claude/docs-v2-c-discoverability
```

---

# PR C — Discoverability (search ranking + OG metadata)

**Branch:** `claude/docs-v2-c-discoverability`

## Task C1: Search — exact-title boost

**Files:**
- Modify: `apps/website/app/components/docs/DocsSearch.tsx`
- Test: `apps/website/app/components/docs/__tests__/DocsSearch.test.tsx`

- [ ] **Step 1: Add failing test for exact-title-prefix priority**

Append to `apps/website/app/components/docs/__tests__/DocsSearch.test.tsx`:

```tsx
it("ranks exact-prefix title match above body match", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    json: () =>
      Promise.resolve([
        {
          slug: "/docs/api",
          title: "Other",
          description: "",
          nav: "Grid",
          headings: [],
          body: "Streaming is mentioned here in the body once.",
        },
        {
          slug: "/docs/streaming",
          title: "Streaming",
          description: "",
          nav: "Streaming",
          headings: [],
          body: "",
        },
      ]),
  }) as unknown as typeof fetch;
  render(<DocsSearch />);
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  const input = await screen.findByRole("combobox");
  fireEvent.change(input, { target: { value: "stream" } });
  const links = await screen.findAllByRole("link");
  // First result should be the page whose title starts with "Stream"
  expect(links[0]).toHaveAttribute("href", "/docs/streaming");
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `pnpm --filter @pretable/app-website test -- DocsSearch`
Expected: FAIL — body match may rank first (or order undefined).

- [ ] **Step 3: Update DocsSearch ranking**

In `apps/website/app/components/docs/DocsSearch.tsx`, replace the `results` computation with a custom ranking that boosts exact title-prefix matches:

```tsx
function rankResults(query: string, idx: SearchEntry[]): SearchEntry[] {
  if (!query) return idx.slice(0, 8);
  const q = query.toLowerCase();
  const fuzzy = fuzzysort.go(query, idx, {
    keys: ["title", "headings", "description", "body"],
    scoreFn: (a) =>
      Math.max(
        (a[0]?.score ?? -1000) * 4,
        (a[1]?.score ?? -1000) * 2,
        a[2]?.score ?? -1000,
        (a[3]?.score ?? -1000) * 0.5,
      ),
  });
  const out = fuzzy.map((r) => r.obj);
  // Stable boost: pages whose title starts with the literal query string
  // jump to the front, in their existing relative order.
  out.sort((a, b) => {
    const aPrefix = a.title.toLowerCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.title.toLowerCase().startsWith(q) ? 0 : 1;
    return aPrefix - bPrefix;
  });
  return out.slice(0, 8);
}

// ...inside DocsSearch component, replace the existing results computation:
const results = index ? rankResults(q, index) : [];
```

- [ ] **Step 4: Run, verify PASS**

Run: `pnpm --filter @pretable/app-website test -- DocsSearch`
Expected: 3/3 passing (2 existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add apps/website/app/components/docs/DocsSearch.tsx apps/website/app/components/docs/__tests__/DocsSearch.test.tsx
git commit -m "feat(website): docs search — exact-title-prefix boost"
```

## Task C2: OG + Twitter metadata for docs pages

**Files:**
- Modify: `apps/website/app/docs/[[...slug]]/page.tsx`

- [ ] **Step 1: Extend `generateMetadata`**

Replace the `generateMetadata` function in `apps/website/app/docs/[[...slug]]/page.tsx` with:

```tsx
export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug = [] } = await params;
  const path = pathFor(slug);
  let title = "Pretable Docs";
  let description = "The drop-in React data grid built for streaming.";
  try {
    const result = await loadDocsPage(slug);
    title = `${result.frontmatter.title} — Pretable`;
    description = result.frontmatter.description;
  } catch {
    // page not found; metadata falls back to defaults — page itself will 404
  }
  return {
    title,
    description,
    alternates: { types: { "text/markdown": `${path}.md` } },
    other: { "x-llms-txt": "/llms.txt" },
    openGraph: {
      type: "article",
      url: path,
      title,
      description,
      siteName: "Pretable",
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}
```

(`loadDocsPage` is already imported in this file.)

- [ ] **Step 2: Run typecheck + build**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website build
```

Expected: success. The build pre-renders metadata for every static path.

- [ ] **Step 3: Commit**

```bash
git add apps/website/app/docs/[[...slug]]/page.tsx
git commit -m "feat(website): docs pages emit openGraph + twitter metadata"
```

## Task C3: Open PR C and merge on green

- [ ] **Step 1: Final checks**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website test
pnpm --filter @pretable/app-website build
pnpm format:write
git add -A && git diff --cached --quiet || git commit -m "style: prettier format"
```

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin claude/docs-v2-c-discoverability
gh pr create --title "feat(website): docs search ranking + OG metadata" --body "$(cat <<'EOF'
## Summary

- Cmd+K search now boosts exact-prefix title matches above body matches (typing "stream" puts \`/docs/streaming\` first, even when other pages mention "stream" in their bodies)
- Every docs page emits per-page \`openGraph\` and \`twitter\` metadata derived from frontmatter \`title\` + \`description\` — share links to docs render correctly in Slack, Twitter, etc.

## Test plan
- [x] \`pnpm test\` — DocsSearch ranking test asserts title-prefix-first
- [x] \`pnpm build\` — metadata pre-renders for every page
- [ ] Manual: open Cmd+K, type "stream" — Streaming page is first
- [ ] Manual: \`curl -s /docs/grid | grep -i og:title\` — finds the meta tag

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --squash --auto
```

- [ ] **Step 3: Wait for merge, reset for PR D**

```bash
git fetch origin main
git reset --hard origin/main
git checkout -B claude/docs-v2-d-e2e-hardening
```

---

# PR D — E2E hardening (Playwright against deployed preview)

**Branch:** `claude/docs-v2-d-e2e-hardening`

## Task D1: Audit existing `e2e/docs.spec.ts` against the merged docs site

**Files:**
- Modify: `apps/website/e2e/docs.spec.ts`

- [ ] **Step 1: Inspect current spec**

Run: `cat apps/website/e2e/docs.spec.ts`

Read each test. Cross-reference against the deployed pages on `https://pretable.vercel.app/docs/...`. Likely problem areas (fix as you find them):

- "sidebar active state" — `getByRole("link", { name: /Pretable.*component/ })` — verify the `<` in `<Pretable> component` doesn't break the regex on real DOM.
- "Cmd+K opens" — verify `Meta+k` works on Linux CI runners (Playwright translates correctly, but the search component listens for `metaKey || ctrlKey`).
- "drawer toggles on mobile" — assumes `getByRole("button", { name: /menu/i })` is visible at 375px width. With the new docs shell, the drawer button is `fixed bottom-4 left-4 z-40 ... md:hidden`. Visible at 375px.

- [ ] **Step 2: Tighten selectors and add wait conditions**

Replace `apps/website/e2e/docs.spec.ts` with:

```ts
import { expect, test } from "@playwright/test";

test("docs page renders sidebar, content, and active state", async ({ page }) => {
  await page.goto("/docs/grid/pretable-component", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pretable");
  // Sidebar link to current page is marked aria-current="page"
  const active = page.locator('a[aria-current="page"]');
  await expect(active).toHaveCount(1);
  await expect(active).toHaveAttribute("href", "/docs/grid/pretable-component");
});

test("Copy as Markdown button is visible on docs pages", async ({ page }) => {
  await page.goto("/docs/grid/pretable-component", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: /copy as markdown/i }),
  ).toBeVisible();
});

test("Cmd+K opens search palette", async ({ page }) => {
  await page.goto("/docs", { waitUntil: "domcontentloaded" });
  await page.keyboard.press("Meta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("combobox")).toBeFocused();
});

test("/docs/<slug>.md returns markdown content", async ({ request }) => {
  const r = await request.get("/docs/grid/pretable-component.md");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/text\/markdown/);
  const body = await r.text();
  expect(body).toMatch(/^# /);
});

test("/llms.txt and /llms-full.txt return content", async ({ request }) => {
  const a = await request.get("/llms.txt");
  expect(a.status()).toBe(200);
  expect(await a.text()).toMatch(/^# Pretable Docs/);
  const b = await request.get("/llms-full.txt");
  expect(b.status()).toBe(200);
  expect((await b.text()).length).toBeGreaterThan(500);
});

test("HTTP Link rel=llms-txt header on /docs/*", async ({ request }) => {
  const r = await request.get("/docs/grid", { maxRedirects: 0 });
  const link = r.headers()["link"] ?? "";
  expect(link).toMatch(/<\/llms\.txt>;\s*rel="llms-txt"/);
});

test("mobile menu drawer opens on small viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/docs", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /menu/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
```

- [ ] **Step 3: Run locally against the deployed prod site**

```bash
cd apps/website
BASE_URL=https://pretable.vercel.app pnpm exec playwright test e2e/docs.spec.ts --project=chromium
```

Expected: all 7 tests pass.

If any fail, read the trace, fix the selector, re-run. Common fixes:
- If `aria-current` count is 2 — desktop sidebar + mobile drawer both rendered. Add a more specific locator (e.g. `nav[aria-label="Docs sections"] a[aria-current]`).
- If `/docs/grid` redirects (302) — `maxRedirects: 0` already prevents follow; the `Link` header should still be present on the 308.

- [ ] **Step 4: Commit**

```bash
cd /Users/blove/repos/pretable/.claude/worktrees/nice-cerf-cac464
git add apps/website/e2e/docs.spec.ts
git commit -m "test(website): tighten docs e2e selectors against deployed preview"
```

## Task D2: Add CI workflow for docs e2e on PR previews

**Files:**
- Create: `.github/workflows/playwright-docs.yml`

- [ ] **Step 1: Inspect existing workflows for the repo's pattern**

Run: `ls .github/workflows/ && cat .github/workflows/*.yml | head -80`

Find a workflow that runs Playwright (likely against a Vercel preview URL via the deployment status webhook). Mirror its structure.

- [ ] **Step 2: Create the workflow**

If an existing Playwright workflow already runs `e2e/smoke.spec.ts` on PR previews, edit that workflow to also run `e2e/docs.spec.ts` (single Playwright invocation with both files). If no such workflow exists, create:

```yaml
# .github/workflows/playwright-docs.yml
name: Playwright — docs e2e
on:
  deployment_status:

jobs:
  docs-e2e:
    if: github.event.deployment_status.state == 'success' && contains(github.event.deployment.environment, 'Preview')
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @pretable/app-website exec playwright install --with-deps chromium
      - name: Run docs e2e
        env:
          BASE_URL: ${{ github.event.deployment_status.target_url }}
        run: pnpm --filter @pretable/app-website exec playwright test e2e/docs.spec.ts --project=chromium
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-trace
          path: apps/website/test-results/
```

(Adjust to the repo's actual conventions found in Step 1 — pnpm version, node version, action versions.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/playwright-docs.yml
git commit -m "ci(website): run docs Playwright e2e on Vercel preview deployments"
```

## Task D3: Open PR D and merge on green

- [ ] **Step 1: Final checks**

```bash
pnpm --filter @pretable/app-website typecheck
pnpm --filter @pretable/app-website lint
pnpm --filter @pretable/app-website test
```

(Build is unnecessary — no app code changes.)

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin claude/docs-v2-d-e2e-hardening
gh pr create --title "test(website): docs Playwright e2e — tightened selectors + CI on PR previews" --body "$(cat <<'EOF'
## Summary

- Tightened \`e2e/docs.spec.ts\` selectors and added wait conditions; verified locally against \`pretable.vercel.app\`
- New CI workflow runs the docs e2e against every Vercel preview deployment on \`deployment_status.success\`
- Failures upload Playwright traces as artifacts for triage

## Test plan
- [x] \`pnpm exec playwright test e2e/docs.spec.ts --project=chromium\` against deployed prod — 7/7 pass
- [ ] After merge: PR previews trigger the workflow; failures are visible in the PR check tab

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --squash --auto
```

---

## Self-Review

**Spec coverage check:**
- ✅ Item #2 (Shiki highlighting in `<Example>`) — Tasks A1, A2, A3
- ✅ Item #3 (real live demo for streaming-chat-grid) — Task A4
- ✅ Item #4 (hand-authored descriptions) — Task B1
- ✅ Item #5 (use MDX components in flagship pages) — Tasks B2, B3
- ✅ Item #6 (search ranking quality) — Task C1
- ✅ Item #8 (OG metadata) — Task C2
- ✅ Item #1 (Playwright e2e fix + CI) — Tasks D1, D2

**Placeholder scan:** None of "TBD", "implement later", "similar to Task N", or vague "add error handling" appear. Every code-changing step has the exact code. Task D2 references "the repo's actual conventions" but instructs the engineer to read them in Step 1 first — that's "investigate then code", not a placeholder.

**Type consistency:** `ExampleFile.htmlSource` is added in A1 and consumed in A2 by the same name. `MockChatGrid` is defined in A4 and imported in A3 — order is fine because A3 and A4 ship in the same commit (Task A4 Step 8). `SearchEntry`, `Metadata`, `Params`, `pathFor` are all reused unchanged from PR #84.

**Inter-PR ordering:** PR A ships infra used by no later PR. PR B requires nothing from A. PR C's search test is content-agnostic (uses fixture data). PR D requires every prior PR's behavior to be live in production preview — that's why it's last.
