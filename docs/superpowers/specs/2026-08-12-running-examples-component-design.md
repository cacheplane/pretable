# Running examples component

**Date:** 2026-08-12
**Status:** Approved design, ready for implementation planning
**Scope:** `apps/website` only. No changes to `packages/*`.

## Problem

The docs site has the beginnings of a runnable-example component — `Example`, `defineExample`, and three
example folders under `content/examples/` — but it does not scale and it does not reach agents.

Three concrete failures today:

1. **Every example needs a bespoke wrapper.** `GroupingExample.tsx` and `HeadlessExample.tsx` exist only to
   bind one example to `Example`, and each must be registered in `MdxRenderer`. Adding an example is a
   four-file change across three directories.
2. **Every example duplicates its own loader.** Each `content/examples/<slug>/index.tsx` repeats ~40 lines of
   `fs.readFileSync` + `SHIKI_LANG` map + `codeToHtml` boilerplate. Three copies exist and have already
   diverged in trivial ways.
3. **Agents get nothing.** `/docs-md/<slug>` and `/llms-full.txt` serve the raw MDX source. A page containing
   `<GroupingExample />` hands an agent a bare JSX tag and zero code. The audience most likely to need the
   full, runnable source currently receives none of it.

This design replaces that with a single component driven by a generated registry, and makes the same example
content reachable from four surfaces — the page, the raw-markdown route, a per-example route, and
`llms.txt` — from one serializer.

## Decisions

Settled during brainstorming, recorded here so the plan does not relitigate them:

| Question | Decision |
| --- | --- |
| How live is the code? | Real React demo, read-only source. No in-page editing, no external sandbox. |
| How is an example referenced? | Slug plus a generated registry: `<Example id="grouping-panel" />`. |
| Layout | One pane with a Preview / Code toggle. |
| Pane height | Both panes share one fixed height. Default 480px, overridable per example. |
| Demo required? | No. An example with no demo renders a code-only panel. |
| Focus lines | In-source comment markers, not numeric ranges in metadata. |
| Agent surfaces | All four: inline expansion, per-example route, copy-for-agent, `llms.txt` index. |

## Authoring contract

An example is a folder under `content/examples/<slug>/`:

```
content/examples/grouping-panel/
  example.ts             meta only: pure data, no JSX, no component imports
  demo.tsx               optional; default-exports the live demo
  GroupingPanelGrid.tsx
  columns.ts
  data.ts
```

```ts
// content/examples/grouping-panel/example.ts
import { defineExample } from "../../../lib/docs/examples/define";

export default defineExample({
  title: "Drag-to-group panel",
  description: "Enable the grouping panel and drag columns in to build levels.",
  files: ["GroupingPanelGrid.tsx", "columns.ts", "data.ts"],
  height: 480, // optional; defaults to 480
});
```

`files` is a list of plain filenames. Language is inferred from the extension, source is read from disk, array
order is tab order, and `files[0]` is the entry tab. The per-example Shiki and fs boilerplate disappears into
one shared loader.

Meta and demo are separate modules deliberately: `example.ts` imports no React, so the markdown routes can read
every example's metadata without pulling client components into a server route. It also makes an optional demo
free — an example with no `demo.tsx` is code-only.

### Type shapes

```ts
export interface ExampleMeta {
  title: string;
  description: string;
  files: readonly string[]; // at least one; order is tab order
  height?: number;          // px; both panes; default 480
}

export type ExampleLang = "ts" | "tsx" | "js" | "jsx" | "css" | "json" | "bash";

export interface LoadedFile {
  path: string;             // filename as declared
  lang: ExampleLang;
  source: string;           // markers stripped, trailing whitespace trimmed
  html: string;             // Shiki output, focus lines decorated
}

export interface LoadedExample {
  id: string;
  meta: ExampleMeta;
  files: readonly LoadedFile[];
  hasDemo: boolean;
}
```

`defineExample` is an identity function that pins the type, matching the existing `defineExample` idiom.

### Focus markers

Focus lives in the source file, not in metadata. Numeric ranges in metadata point at the wrong lines the moment
someone edits the file, and nothing catches it.

```ts
const columns = [
  column.accessor("region", { type: "text", header: "Region" }), // [!focus]
  // [!focus:start]
  column.accessor("amount", { type: "number", aggregate: "sum" }),
  column.accessor("owner", { type: "text", header: "Owner" }),
  // [!focus:end]
];
```

- `// [!focus]` — trailing marker; that line is focused.
- `// [!focus:start]` / `// [!focus:end]` — own-line markers; lines between them are focused, markers removed.

Markers are inert comments, so the file still compiles and runs as part of the demo. The loader strips them
before anything is displayed, copied, or serialized: readers and agents always get clean source.

When a file has at least one focused line, unfocused lines render dimmed. When it has none, all lines render
normally. Focus decoration is applied by the loader as line-level markup, not by a Shiki transformer plugin, so
the same focus data is available to any consumer without re-parsing HTML.

Unbalanced markers (a `start` with no `end`, or `end` before `start`) are a load-time error, surfaced by the
loader test suite rather than silently producing a whole-file highlight.

## Registry and codegen

`scripts/gen-example-registry.mjs` scans `content/examples/*/example.ts` and emits two generated modules:

```ts
// lib/docs/examples/registry.generated.ts  — metadata only, safe for server routes
import groupingPanel from "../../../content/examples/grouping-panel/example";
import headlessCustomRenderer from "../../../content/examples/headless-custom-renderer/example";

export const exampleRegistry = {
  "grouping-panel": { meta: groupingPanel, hasDemo: true },
  "headless-custom-renderer": { meta: headlessCustomRenderer, hasDemo: true },
} as const;

export type ExampleId = keyof typeof exampleRegistry;
```

`hasDemo` is recorded here rather than inferred from the demo registry, so the
loader — and therefore every markdown surface — can answer "does this example
have a demo?" without importing any client component.

```ts
// lib/docs/examples/demos.generated.ts  — demo components, imported only by <Example>
import GroupingPanelDemo from "../../../content/examples/grouping-panel/demo";

export const exampleDemos = {
  "grouping-panel": GroupingPanelDemo,
} as const;
```

Codegen exists to do the one thing runtime JS cannot: produce static imports. Everything else is read at render
time. A folder with no `demo.tsx` is simply absent from `demos.generated.ts`.

Both files are committed, so a plain `next build` works without a preceding codegen run. Freshness is enforced
by `pnpm examples:gen --check`, which regenerates into memory and fails on any difference — the same shape as
the existing `api:check` gate. `examples:gen` also runs from `predev`, `prebuild`, and `pretest`, so local work
cannot drift.

Because ids are a union derived from the registry, `<Example id="typo" />` is a type error rather than a blank
panel in production.

## Loading

`lib/docs/examples/load.ts`:

```ts
export async function loadExample(id: ExampleId): Promise<LoadedExample>;
```

Reads each declared file from `content/examples/<id>/`, strips focus markers, records focus line numbers,
trims trailing whitespace, and highlights with Shiki. Results are memoised in a module-level `Map` keyed by id;
pages are statically rendered, so each file is read and highlighted once per build.

Highlighting uses one theme, configured in this module. The docs site is light-only today, so there is no
dual-theme output; centralising the theme choice here means adding dark mode later is a one-line change instead
of an edit in every example folder.

An unknown id, a declared file missing from disk, or an unbalanced focus marker throws. The guard tests below
make each of those unreachable in a shipped build.

## The component

`<Example id="grouping-panel" />`, registered once in `MdxRenderer`.

**Server half.** `Example` is a server component. It awaits `loadExample(id)`, looks up the demo in
`exampleDemos`, serializes the agent markdown once, and renders a client shell — passing the demo element as
`children` so no client boundary is crossed by the demo's own props.

**Client shell.** Owns only the toggle, the file tabs, and the copy actions.

Structure, top to bottom:

- **Header** — title and description. The description is the same string the agent bundle carries, so a fetched
  example explains itself without its surrounding page.
- **Bar** — a Preview / Code segmented control on the left; actions on the right (`Copy file` in Code view,
  `Copy for agent`, and a link to the per-example markdown route).
- **File tabs** — shown in Code view only, and only when the example has more than one file.
- **Pane** — fixed height from `meta.height` (default 480px), applied to both Preview and Code so toggling
  never shifts the page. Content taller than the pane scrolls inside it.

**Both panes stay mounted.** The inactive pane is hidden rather than unmounted. Toggling to Code and back does
not remount the demo, so a grid the reader had grouped, scrolled, or selected in keeps its state; the source is
also present for in-page browser search and for readers without JS. The cost — every demo on a page mounts even
if nobody opens it — is accepted.

**Default pane** is Preview when the example has a demo, Code when it does not. An `initial="code"` prop lets a
page open on the source where the code is the lesson.

**Accessibility.** Both switches use a real `tablist` / `tab` / `tabpanel` model with `aria-controls`, roving
`tabindex`, and arrow-key navigation. The current implementation uses `role="tab"` buttons with no tablist and
no keyboard model; that is fixed here rather than carried forward.

## Agent surfaces

One serializer, `lib/docs/examples/serialize.ts`:

```ts
export function toMarkdown(example: LoadedExample, opts?: { canonicalUrl?: string }): string;
```

Output shape:

````markdown
### Example: Drag-to-group panel

Enable the grouping panel and drag columns in to build levels.

Source: https://pretable.dev/examples-md/grouping-panel

```tsx GroupingPanelGrid.tsx
import { PretableSurface } from "@pretable/react";
...
```

```ts columns.ts
...
```
````

The fence info string is `<lang> <path>`, matching the format the current `Copy all` button already produces.
Focus markers are stripped, so the code pastes and runs.

Four consumers, all calling `toMarkdown`, so the code an agent gets cannot drift from the code a human sees:

1. **Inline expansion.** `expandExamples(raw: string): Promise<string>` replaces every `<Example id="…" />` tag
   in an MDX source string with the serialized block. Both `/docs-md/[[...slug]]` and
   `app/llms-full.txt/build.ts` already operate on raw MDX strings, so each gains one call. This is the change
   that turns a bare JSX tag into complete runnable source on both surfaces at once.
2. **Per-example route.** `app/examples-md/[slug]/route.ts` serves `toMarkdown` as `text/markdown`, mirroring
   the existing `/docs-md/<slug>` convention. Unknown slug returns 404.
3. **Copy for agent.** The serialized string, including its canonical URL line, is computed server-side and
   handed to the client shell as a prop.
4. **`llms.txt` index.** An `## Examples` section listing every registry entry as
   `- [title](/examples-md/<slug>): description`, so a crawler finds the catalog without walking every docs
   page.

## Verification

Guards are fail-closed, and each is proven to fail under mutation before it is considered done — a guard that
cannot see the thing it guards is worse than no guard, because it reads as coverage.

| Guard | What it catches |
| --- | --- |
| `examples:gen --check` in CI | A registry that no longer matches the folders on disk. |
| Every referenced id resolves | `<Example id="…">` in `content/docs/**/*.mdx` naming an example that does not exist. |
| Every example is referenced | An orphaned example. Scans `content/docs/**/*.mdx` **and** `app/**/*.tsx`, because the homepage consumes one directly. |
| `files` matches disk, both directions | A declared file missing from disk, **and** a source file present in the folder but never declared — the silent omission a one-directional check misses. |
| No marker leakage | Any `[!focus…]` comment surviving into displayed source or `toMarkdown` output. |

Unit tests:

- **Loader** — marker stripping, focus line computation, unbalanced-marker error, language inference.
- **Serializer** — exact expected markdown for a fixture example, including the canonical URL line.
- **`expandExamples`** — substitution in a representative MDX string; throws on unknown id; leaves an MDX
  document containing no `<Example>` tags byte-identical.
- **Shell** — toggling Code and back keeps the demo mounted; tabs expose correct roles and respond to arrow
  keys; `Copy file` copies the active tab; `Copy for agent` copies the serialized bundle; a demo-less example
  renders no Preview tab.

End-to-end: one smoke test on the grouping docs page — toggle to Code, toggle back, assert the demo retained
its state. Gated on `data-pretable-hydrated`, since SSR'd controls are painted but inert and early clicks are
silently dropped.

## Migration

Included in this project:

- Convert `grouping-panel`, `headless-custom-renderer`, and `streaming-chat-grid` to the folder shape.
- Delete `app/components/docs/mdx/GroupingExample.tsx` and `HeadlessExample.tsx`.
- Delete all three `content/examples/*/index.tsx` boilerplate loaders.
- `MdxRenderer` registers `Example` only.
- `content/docs/grid/grouping.mdx` and `content/docs/headless/getting-started.mdx` switch to `<Example id="…" />`.
- `app/components/CodeExample.tsx` (homepage) reads `streaming-chat-grid` through the registry.
- Replace `lib/docs/define-example.ts` and the existing `Example.tsx` rather than keeping compatibility
  shims — pretable is pre-1.0 with no external consumers of the docs internals.

## Out of scope

- In-page code editing, and external sandbox links.
- Dark-theme highlighting. The docs site is light-only; the theme is centralised so this stays a one-line change.
- "Try this" interaction hints under the preview.
- Per-example install/dependency blocks.
- **The docs rollout.** Deciding which pages get examples and authoring them is the follow-up pass once this
  component lands.
