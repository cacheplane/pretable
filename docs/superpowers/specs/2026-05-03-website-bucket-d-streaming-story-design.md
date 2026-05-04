# Website Bucket D — Streaming-adapter promotion + streaming story

Date: 2026-05-03
Status: design (pre-implementation)

## Background

The streaming pipeline is Pretable's biggest differentiator but it's currently invisible in the marketing arc and the package that powers it is marked private. The current `apps/website` CodeExample chat-grid.tsx tab and the new DrawerHero AI-agent prompt both instruct consumers to `import { connectElementStream } from "@pretable-internal/stream-adapter"` — but `packages/stream-adapter/package.json` carries `"name": "@pretable-internal/stream-adapter"` + `"private": true` and never publishes to npm. Telling users to depend on a package they can't install is the worst kind of marketing lie.

Bucket D resolves both problems in a single PR:

1. **Audit:** promote `@pretable-internal/stream-adapter` to `@pretable/stream-adapter`, drop `private`, ship via the existing changeset/release pipeline.
2. **Marketing:** add a new "streaming, by design" section between HowItWorks and CodeExample that gives the differentiator dedicated real estate.
3. **Docs:** new top-level Streaming group with 5 MDX pages covering install, the two main APIs (`connectElementStream` / `connectPartialStream`), parsers, and a types reference.

## Goals

1. Make the marketing copy truthful — `npm install @pretable/stream-adapter` actually works.
2. Give the streaming wedge dedicated real estate in the drawer marketing arc.
3. Document the public API of the streaming adapter package well enough that an external consumer (or an AI coding agent following the DrawerHero prompt) can integrate without reading the source.
4. No code changes inside the package itself — same exports, same behavior.

## Non-goals

- Streaming-rate sustained-envelope chart (Q4's option B from brainstorm). Future Bucket E if we want a perf-under-load visual.
- Migrating `apps/streaming-demo` from its `useState`-driven row management to the actual `connectElementStream` API. The demo currently uses a shimmed pattern; rewriting it is a separate task.
- New tokens, palette additions, or drawer mechanics.

## 1. Package promotion

### Rename + publish-flag

`packages/stream-adapter/package.json`:

- `"name": "@pretable-internal/stream-adapter"` → `"name": "@pretable/stream-adapter"`
- Remove `"private": true`
- Keep `"version": "0.0.1"` (the changeset will bump it)

### Changeset entry

Create `.changeset/promote-stream-adapter.md`:

```
---
"@pretable/stream-adapter": minor
---

Promote stream-adapter from `@pretable-internal/` to the public
`@pretable/` namespace. Same exports, same behavior. The package was
previously private and unreachable from npm despite being referenced in
the marketing copy and the AI-agent setup prompt.
```

(Minor bump because we're publishing a new public package — the version stays 0.0.1 → 0.1.0 per the existing changesets convention. If the convention is different, follow what changeset-release expects.)

### Internal consumers to update

Search the repo for `@pretable-internal/stream-adapter` references and rename each:

- `apps/streaming-demo/package.json` and any imports under `apps/streaming-demo/src/`
- `apps/website/app/components/CodeExample.tsx` — the `chat-grid.tsx` snippet imports it; update the source string
- `apps/website/app/components/DrawerHero.tsx` — the `DRAWER_HERO_PROMPT` constant references it; update the prompt
- `apps/website/app/components/ComparisonTable.tsx` — the source comment at the bottom of the `ROWS` array
- Any other workspace package that depends on it (verify with `pnpm why @pretable-internal/stream-adapter` before changing)

After the rename, run `pnpm install` to update lockfile, then run the full suite to confirm no broken imports.

### Release pipeline

The existing changesets-release workflow handles the rest. After merge:

- Changesets PR will be opened against `main` to bump versions and update CHANGELOG.md
- When that PR merges, the package publishes to npm under `@pretable/stream-adapter`

We don't need to touch `.github/workflows/release.yml` for this — the workflow operates on whatever workspace packages aren't private.

## 2. Marketing section

### Position

Renumber drawer eyebrows so the new section becomes `05`:

| Old                    | New                                 |
| ---------------------- | ----------------------------------- |
| 03 · how we compare    | 03 · how we compare (unchanged)     |
| 04 · how it works      | 04 · how it works (unchanged)       |
| —                      | **05 · streaming, by design** ← NEW |
| 05 · for engineers     | **06 · for engineers**              |
| 06 · what's in the box | **07 · what's in the box**          |

`page.tsx` insertion: between `<HowItWorks>` and the `<ScrollReveal><CodeExample /></ScrollReveal>` wrapper. Use `<ScrollReveal>` to match the surrounding pattern.

### Component: `<StreamingByDesign>`

`apps/website/app/components/StreamingByDesign.tsx` (server component, no client state).

Structure:

```
<section class="text-text-primary px-7 py-16 md:px-10 md:py-28">
  <div class="mx-auto max-w-[1240px]">
    <p eyebrow>05 · streaming, by design</p>
    <h2>Built streaming-first. <em>Not bolted-on.</em></h2>
    <p subhead>{thesis paragraph}</p>
    <div grid 2-col>
      <div card>
        <h3>One shape, one path</h3>
        <p>{copy referencing applyTransaction}</p>
      </div>
      <div card>
        <h3>Selection survives every patch</h3>
        <p>{copy referencing row-id keys}</p>
      </div>
    </div>
    <p footer link>API reference → /docs/streaming</p>
  </div>
</section>
```

### Copy

**Thesis paragraph:**

> Most grids accept streaming through an adapter layered onto a batch-era data model. Pretable's engine treats a 1,000-patch/sec stream and a static 3,000-row array as the same input shape — one reducer, one render path, one selection model. There's no "streaming mode" toggle.

**Card 1 — One shape, one path:**

> Heading: One shape, one path
>
> Body: `applyTransaction({ add, update, remove })` is the only entry point into the engine. Static rows hit it via `add()`; SSE tokens hit it via the same method per chunk. The streaming adapter is a thin batcher around that interface — not a separate code path.

**Card 2 — Selection survives every patch:**

> Heading: Selection survives every patch
>
> Body: Row-id keys are first-class in the engine. Sort, filter, scroll position, focused row — none of it loses state mid-stream. Drag-select 200 rows during a 25k/sec patch storm and they stay selected.

### Visual treatment

- Section uses standard padding `px-7 py-16 md:px-10 md:py-28` and `max-w-[1240px]` — same as adjacent sections (Compare / How / Code).
- Eyebrow follows the `font-mono text-[11px] uppercase tracking-[0.14em] text-accent` pattern.
- H2 uses `font-display text-[36px] md:text-[44px]` matching adjacent sections.
- Cards: `rounded-[8px] border border-rule bg-bg-card p-6`, mirroring the CredibilityCards visual chrome (deliberately consistent — they're the same visual primitive).
- Footer link: `text-accent-deep hover:underline` matching the bench/methodology link style elsewhere.

### Tests

`apps/website/__tests__/components/StreamingByDesign.test.tsx`:

1. Renders the eyebrow `05 · streaming, by design`.
2. Renders the H2 with text matching `/built streaming-first/i` and an italic `Not bolted-on.` segment.
3. Renders both card headings: "One shape, one path" and "Selection survives every patch".
4. Card body for #1 mentions `applyTransaction`.
5. Card body for #2 mentions row-id (or "row-id keys" specifically).
6. Footer link with text matching `/api reference/i` and `href="/docs/streaming"`.

`page.test.tsx` (if exists) — assert section appears in the right position. (If no page-level test exists, skip.)

## 3. Docs — top-level Streaming group

### Sidebar nav update

`apps/website/app/docs/_nav.ts` — add a new entry between `Grid` and `Theming`:

```ts
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
```

The existing `DocsSidebar.test.tsx` counts headings as `docsNav.length * 2` and links as `totalItems * 2` — both auto-grow when the nav array grows.

### Page set

All under `apps/website/app/docs/streaming/`. All MDX with YAML frontmatter (parsed by `remark-frontmatter` per Bucket A). Each page has a `title` + `description` for SEO.

#### `streaming/page.mdx` — Overview

Frontmatter: `title: Streaming` / `description: Pretable's streaming-adapter API: connectElementStream, connectPartialStream, parsers.`

Sections:

- Lead paragraph (echoes the marketing thesis at lower fidelity, more API-focused)
- Install: `npm install @pretable/stream-adapter`
- Quick example: minimal `connectElementStream` from an async iterable to a `<Pretable>` grid
- Cross-links: → Element streams, → Partial streams, → Parsers, → API reference

#### `streaming/element-streams/page.mdx`

Frontmatter: `title: Element streams` / `description: connectElementStream — wire any AsyncIterable<Row> to a Pretable grid.`

Sections:

- When to use: full-row chunks (LLM Responses elements, SSE messages with one row per event, paginated REST).
- Signature: `connectElementStream<TRow>(grid, stream): StreamConnection`
- Lifecycle: `done` promise + `dispose()` semantics; what happens on error vs successful close.
- Recipe 1 — OpenAI Responses (mirrors the marketing CodeExample tab; reusing the same canonical example for muscle memory).
- Recipe 2 — SSE / EventSource adapter.
- Cross-link → Parsers (when your source emits raw JSON chunks instead of typed elements).

#### `streaming/partial-streams/page.mdx`

Frontmatter: `title: Partial streams` / `description: connectPartialStream — token-by-token row growth for LLM streaming.`

Sections:

- When to use: a single row grows over time (an assistant message streaming in token by token; not many rows arriving as units).
- Signature: `connectPartialStream<TRow>(grid, stream, options: PartialStreamOptions): StreamConnection`
- `PartialStreamOptions.rowId` — the stable id assigned to all incoming patches.
- Recipe — chat completion: a single chat row's `content` field grows per-token, `tokens` and `latencyMs` updated each chunk.
- Behavior: each yielded `Partial<TRow>` is merged into the row keyed by `rowId` via `applyTransaction.update`.

#### `streaming/parsers/page.mdx`

Frontmatter: `title: Parsers` / `description: parseElementStream + parsePartialStream — string chunks → typed async iterables.`

Sections:

- The two functions live one layer below the `connect*` helpers. Take an `AsyncIterable<string>` (raw JSON chunks from `fetch`/`Response.body`/SSE) and yield typed values.
- `parseElementStream<TRow>(stream)` — array-of-objects JSON; yields each element as it parses.
- `parsePartialStream<TRow>(stream)` — single-object JSON; yields `Partial<TRow>` snapshots as keys complete.
- Recipe — fetch + parse + connect:
  ```
  const res = await fetch("/api/events");
  await connectElementStream(grid, parseElementStream(res.body));
  ```

#### `streaming/api-reference/page.mdx`

Frontmatter: `title: API reference` / `description: Type signatures and the createBatcher escape hatch.`

Sections:

- Types table:
  | Type | Shape |
  | --- | --- |
  | `GridLike<TRow>` | `{ applyTransaction({ add?, update?, remove? }): void }` |
  | `StreamConnection` | `{ done: Promise<void>; dispose(): void }` |
  | `TransactionBatcher<TRow>` | `{ add, update, remove, flush, dispose }` |
  | `PartialStreamOptions` | `{ rowId: string }` |
- `createBatcher(grid): TransactionBatcher<TRow>` — lower-level escape hatch when the connect helpers don't fit. Same batching semantics; you drive the lifecycle.

### Content tone

Match the existing docs voice (Bucket A's docs PR set the precedent): concise, code-forward, minimal hedging. Each page should be skimmable on one screen at desktop width.

## File structure (delta)

**Create:**

- `apps/website/app/components/StreamingByDesign.tsx`
- `apps/website/__tests__/components/StreamingByDesign.test.tsx`
- `apps/website/app/docs/streaming/page.mdx`
- `apps/website/app/docs/streaming/element-streams/page.mdx`
- `apps/website/app/docs/streaming/partial-streams/page.mdx`
- `apps/website/app/docs/streaming/parsers/page.mdx`
- `apps/website/app/docs/streaming/api-reference/page.mdx`
- `.changeset/promote-stream-adapter.md`

**Modify:**

- `packages/stream-adapter/package.json` — name + `private` flag
- `apps/streaming-demo/package.json` (and any sources under `apps/streaming-demo/src/`) — dependency rename
- `apps/website/app/components/CodeExample.tsx` — `chat-grid.tsx` snippet import string
- `apps/website/app/components/DrawerHero.tsx` — `DRAWER_HERO_PROMPT` constant
- `apps/website/app/components/ComparisonTable.tsx` — source comment at bottom of `ROWS`
- `apps/website/app/page.tsx` — insert `<ScrollReveal><StreamingByDesign /></ScrollReveal>` between `<HowItWorks>` and `<CodeExample>`
- `apps/website/app/docs/_nav.ts` — add Streaming group between Grid and Theming
- `apps/website/__tests__/components/CodeExample.test.tsx` — if any test references the old import string in the rendered snippet, update it

**Won't touch:** `packages/stream-adapter/src/*` (no behavior changes), drawer mechanics, HeroGrid, DrawerHero structure (just the prompt string), ReceiptsBand, CredibilityCards, HowItWorks, the existing 5 layer cards.

## Migration / breaking-change risk

- **For internal workspace consumers:** breaking — `@pretable-internal/stream-adapter` no longer resolves. We update them all in this PR.
- **For external consumers:** none — the package was private, never published. The new `@pretable/stream-adapter` is a fresh public package as far as npm is concerned.
- **For this PR's CI:** `Packaging — publint + attw` will run on the new public package and must pass. No code changes inside the package, so it should pass with the same artifacts.

## Visual treatment / palette

All from existing Alpenglow tokens. No new tokens.

## Open follow-ups (out of scope this PR)

- `apps/streaming-demo` real-API rewrite (use `connectElementStream` instead of the current `useState`-driven shim).
- A streaming-rate sustained-envelope chart (Bucket E candidate).
- A "from scratch" streaming codelab walking through OpenAI Responses → Pretable end-to-end.

## Implementation order (preview, formalized in writing-plans)

1. Rename the package + drop `private` + add changeset.
2. Update internal consumers (streaming-demo, website CodeExample/DrawerHero/ComparisonTable comment).
3. Run `pnpm install` and verify lockfile + repo tests.
4. Build `<StreamingByDesign>` component + test (TDD).
5. Insert into `page.tsx` between HowItWorks and CodeExample.
6. Update `_nav.ts` with the new Streaming group (DocsSidebar tests grow automatically).
7. Author 5 MDX docs pages.
8. Manual Chrome verification of the marketing section + the docs index page rendering tables.
9. Push, open PR, watch CI, merge.
