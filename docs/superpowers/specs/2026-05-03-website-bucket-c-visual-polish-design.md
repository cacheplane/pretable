# Website Bucket C — Receipts boldness + Pipeline diagram + Code tabs

Date: 2026-05-03
Status: design (pre-implementation)

## Background

Three visual-polish items from the landing-page review, all on sections that exist in the drawer marketing arc. Bucket A shipped concrete fixes. Bucket B restored the in-drawer hero and reframed the grid. Bucket C is pure visual treatment of three drawer sections, no IA changes.

## Goals

1. **Receipts** — make the proof-numbers band visually bolder so it reads as a deliberate "now showing receipts" pivot in the page flow. Direction picked: **inverted slate band**.
2. **HowItWorks (Pipeline)** — unify the inconsistent border treatment on the 5 layer cards and add an architecture-at-a-glance diagram above the cards. Direction picked: **diagram + cards split**.
3. **CodeExample (For engineers)** — replace the single static snippet with a VS-Code-style tabbed interface showing 4 relevant files. Direction picked: **synthesized 4-tab interface**, content authored inline.

## Non-goals

- Streaming-story page or `@pretable-internal/stream-adapter` audit — Bucket D, separate spec.
- Section reordering — already locked in Bucket B.
- Drawer mechanics, HeroGrid framing, hero copy — already shipped in Buckets A and B.
- New tokens, palette additions — all colors come from existing `--pt-*` Alpenglow tokens.

## 1. Receipts — inverted slate band

### Visual

- Section background flips from cream to slate: `bg-text-primary` (the existing dark token used for text everywhere else; tokens.css resolves this to `--pt-slate-900` or equivalent; verify during implementation).
- Body text becomes cream: `text-bg-page` for the Receipts H2 and stat numbers; `text-text-muted` reads light-gray on dark and is reused for captions.
- Pretable's first stat (`4×`) keeps `text-accent` (warm orange) so the wedge number anchors visually.
- Top border per stat changes from 1px primary to 2px accent: `border-t-2 border-accent` instead of `border-t border-text-primary`.
- Stat numbers grow from 44px → 56px display.
- "See them re-run in the bench →" link stays the same anchor, but `text-accent` instead of `text-accent-deep` (better contrast on the dark band).

### Content

No copy changes. Same 4 stats, same headline, same link target.

### Component changes

- `apps/website/app/components/ReceiptsBand.tsx` — class swaps only, no structural change.
- `apps/website/__tests__/components/ReceiptsBand.test.tsx` — existing assertions hold (text content, stat values, no positioning cards). Add one regression assertion that the section root has the inverted background class so future "tidy ups" can't silently revert.

### Accessibility

- Existing semantic structure preserved (`section`, `h2`, `ul > li`).
- Color contrast: cream-on-slate easily clears WCAG AA at 56px display weight. Captions on `text-text-muted` against dark also need to clear AA — verify and adjust to a slightly brighter gray if needed (existing token `text-text-secondary` may serve better).

## 2. HowItWorks — pipeline diagram + cards split

### Component additions

- New file `apps/website/app/components/PipelineDiagram.tsx` — pure-SVG horizontal flow diagram for `md:` breakpoint and up; vertical stack with down-arrows below. Server component, no client-side state.

### Diagram structure

5 stages, in order, with output shape labels on the connecting arrows:

```
Source ─[Row[] | Patch]→ Engine ─[Snapshot]→ Viewport ─[RenderPlan]→ Renderer ─[Element[]]→ Frame
```

Stage box content:

- Stage number (mono, small): `01`–`05`
- Stage name (display, ~16px): `Source`, `Engine`, `Viewport`, `Renderer`, `Frame`
- Package badge below (mono, ~10px): `stream-adapter`, `grid-core`, `layout-core + text-core`, `renderer-dom`, `browser`

Stage chrome:

- All 5 boxes use the same neutral border (`border-rule` on `bg-bg-card`).
- Boxes 02 (Engine) and 03 (Viewport) keep a small accent dot in the corner (semantic hint that these are the "core" stages) but no border-color difference. This resolves the user's "different border colors" complaint.
- Connecting arrows are `var(--pt-accent)` with the output-shape label in mono ~10px above each arrow.

Responsive:

- `md:` and up: horizontal flow, full-width.
- `< md`: vertical stack, down-arrows between boxes.

### Existing LayerStack changes

The 5 detail cards stay below the diagram. Treatment changes:

- Remove the `accent: boolean` field from each `Layer` and remove the per-layer accent-vs-rule border switch in JSX. All 5 cards use `border-rule`.
- Keep the dot+glow on layers 02 (Engine) and 03 (Viewport) so the "core stages" hint is retained but not via border color. The dot uses `bg-accent` with the existing `shadow-[0_0_0_4px_color-mix(...)]` glow pattern.
- Output chip + pkg badge on the right (existing) keep their existing styling — they already use accent color and read fine with unified borders.

### Tests

- `apps/website/__tests__/components/PipelineDiagram.test.tsx` (new): all 5 stage names render; all 5 package names render; the SVG has an accessible `<title>` describing it as "Pretable's render pipeline."
- `apps/website/__tests__/components/HowItWorks.test.tsx` (existing): keep existing assertions; add one that the PipelineDiagram is rendered (`getByTestId("pipeline-diagram")` or equivalent).
- Visual / contrast: verified manually via Chrome MCP at desktop + 768px breakpoint.

### Constants

The 5-stage data lives in one source. Currently `LAYERS` in `HowItWorks.tsx` carries it. Extract to `apps/website/app/components/howItWorksLayers.ts` so both `<HowItWorks>` and `<PipelineDiagram>` consume the same array (single source of truth — stage names, package names, output shapes can't drift).

## 3. CodeExample — VS-Code-style tabs

### Tab set

Four tabs. `chat-grid.tsx` is the default-active tab. Tab order matches "logical reading order" so a reader can scan left-to-right.

| #   | Filename           | Lang | Purpose                                                                                   |
| --- | ------------------ | ---- | ----------------------------------------------------------------------------------------- |
| 1   | `chat-grid.tsx`    | tsx  | The component (the current snippet, with the `<PretableGrid>` typo fixed to `<Pretable>`) |
| 2   | `columns.ts`       | ts   | Column defs (id, role, content, tokens, latency)                                          |
| 3   | `openai-client.ts` | ts   | Provider setup — one-line export                                                          |
| 4   | `page.tsx`         | tsx  | App-Router page that mounts `<ChatGrid>`                                                  |

### Tab content (authored inline)

```
// chat-grid.tsx — fixed: <Pretable> instead of <PretableGrid>
"use client";
import { useEffect, useState } from "react";
import { connectElementStream } from "@pretable-internal/stream-adapter";
import { Pretable } from "@pretable/react";
import { columns } from "./columns";
import { openai } from "./openai-client";

export function ChatGrid({ prompt }: { prompt: string }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    void (async () => {
      const stream = await openai.responses.stream({ model: "gpt-5", input: prompt });
      connectElementStream(stream, {
        onElement: (row) => setRows((r) => [...r, row]),
      });
    })();
  }, [prompt]);
  return <Pretable rows={rows} columns={columns} getRowId={(r) => r.id} />;
}
```

```
// columns.ts
import type { PretableColumn } from "@pretable/react";

export interface ChatRow {
  id: string;
  role: "user" | "assistant";
  content: string;
  tokens: number;
  latencyMs: number;
}

export const columns: PretableColumn<ChatRow>[] = [
  { id: "role",      header: "Role",     widthPx: 100 },
  { id: "content",   header: "Content",  widthPx: 480, wrap: true },
  { id: "tokens",    header: "Tokens",   widthPx: 80 },
  { id: "latencyMs", header: "Latency",  widthPx: 100 },
];
```

```
// openai-client.ts
import OpenAI from "openai";

export const openai = new OpenAI();
```

```
// page.tsx
import { ChatGrid } from "./chat-grid";

export default function Page() {
  return <ChatGrid prompt="Summarize the last 10 incidents" />;
}
```

### Component architecture

- `apps/website/app/components/CodeExample.tsx` (modified, server component): defines the `TABS` array, calls `await CodeBlock(...)` once per tab at module-load (matches the existing pattern), passes pre-rendered HTML strings to `<CodeTabs>` as a `panels` prop, plus the tab metadata.
- `apps/website/app/components/CodeTabs.tsx` (new, client component): owns `activeIndex` state, renders the tab bar + active panel. Props: `panels: { filename: string; lang: "ts" | "tsx"; html: ReactNode }[]`, `defaultIndex?: number`.

### Tab bar UI

- Dark backdrop matching the shiki theme of the code blocks (uses the same `--pt-slate` family as Receipts inverted band; visual consistency between the two darker sections is intentional).
- File icon (small mono `TS` or `TSX` glyph in front of each filename — text-only, no SVG).
- Active tab: cream text + cream bottom border (1px) `border-bg-page`; inactive tabs: muted gray text.
- Hover (inactive): brighten text to `text-bg-page/80`.
- Keyboard nav: tabs are `<button role="tab">` inside a `<div role="tablist">`; arrow-left/right cycles activeIndex; tab content is `<div role="tabpanel">` with the right `aria-labelledby`.

### Tests

- `apps/website/__tests__/components/CodeTabs.test.tsx` (new): renders 4 tabs by filename, only one panel visible at a time, click switches active panel, arrow-key cycles, `role="tablist"` and `role="tab"` and `role="tabpanel"` present.
- `apps/website/__tests__/components/CodeExample.test.tsx` (existing): update to assert the tab bar exists with 4 tab labels (instead of asserting the single-snippet code block).

## File structure (delta)

**Create:**

- `apps/website/app/components/PipelineDiagram.tsx`
- `apps/website/app/components/howItWorksLayers.ts`
- `apps/website/app/components/CodeTabs.tsx`
- `apps/website/__tests__/components/PipelineDiagram.test.tsx`
- `apps/website/__tests__/components/CodeTabs.test.tsx`

**Modify:**

- `apps/website/app/components/ReceiptsBand.tsx` — class swaps for inverted band.
- `apps/website/__tests__/components/ReceiptsBand.test.tsx` — add bg regression assertion.
- `apps/website/app/components/HowItWorks.tsx` — drop `accent: boolean` field, render `<PipelineDiagram>` above the LayerStack, import LAYERS from the new shared file.
- `apps/website/__tests__/components/HowItWorks.test.tsx` — assert PipelineDiagram present, drop any `accent`-specific assertions.
- `apps/website/app/components/CodeExample.tsx` — rewrite to use TABS array + `<CodeTabs>`. Fix `<PretableGrid>` → `<Pretable>` typo (and add `getRowId`).
- `apps/website/__tests__/components/CodeExample.test.tsx` — update to assert tab bar.

**Won't touch:** any `packages/*` source, drawer mechanics, HeroGrid, page.tsx ordering, hero / credibility / CTA / footer sections.

## Migration / breaking-change risk

None for consumers. Internal-only `apps/website` changes. No public package APIs touched.

## Visual treatment / palette

All from existing Alpenglow tokens in `packages/ui/src/tokens.css`. If the slate Receipts background needs a token that isn't present (e.g. `--pt-slate-900` for full-section bg), use `bg-text-primary` (which already resolves to the dark slate via the text-primary token) and add a fallback comment.

## Open follow-ups (out of scope)

- DrawerHero copy revisit + AI-era streaming-story repositioning — Bucket D.
- `@pretable-internal/stream-adapter` audit (is "internal" correct?) — Bucket D.
- Real `apps/streaming-demo` content sourcing for code tabs — deferred. The synthesized inline content is a deliberate choice for Bucket C; if we later want the marketing snippets to track the actual demo app, we revisit.

## Implementation order (preview, formalized in writing-plans)

1. Extract `LAYERS` from `HowItWorks.tsx` to `howItWorksLayers.ts` (with the `accent` field dropped). Update `HowItWorks` import.
2. Add `<PipelineDiagram>` (pure SVG, all stages from the shared LAYERS), with tests.
3. Wire `<PipelineDiagram>` into `<HowItWorks>` above the LayerStack, drop the per-layer accent border switch.
4. Receipts inversion (class swaps), update test.
5. Add `<CodeTabs>` client component with tests.
6. Rewrite `CodeExample` to use the TABS array + `<CodeTabs>`, fix the `<Pretable>` typo, update test.
7. Manual Chrome verification + push.
