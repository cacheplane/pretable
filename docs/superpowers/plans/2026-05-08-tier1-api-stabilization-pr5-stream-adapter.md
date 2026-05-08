# Tier 1 Sub-project A — PR 5 (`@pretable/stream-adapter` audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add TSDoc + `@public` to every symbol in `@pretable/stream-adapter`, move to the `public_api.ts` convention, write the per-package README, and flip `ae-missing-release-tag` to `warning` (PR 2's deferred work) since this PR completes coverage across all four `@pretable/*` packages.

**Architecture:** Mechanical TSDoc additions on 9 declarations across 6 source files, one new `public_api.ts`, one collapsed `index.ts`, one new README, one config flip in `api-extractor.base.json`. The flip ships in its own commit at the end so reverting is trivial if it surfaces an untagged symbol elsewhere.

**Tech Stack:** TypeScript, `@microsoft/api-extractor`, `@microsoft/tsdoc`, pnpm workspaces, vitest.

**Source spec:** `docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr5-stream-adapter-design.md`

---

## File Structure

| Path                                                    | Responsibility                                       | Action                                              |
| ------------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------- |
| `packages/stream-adapter/src/types.ts`                  | `GridLike`, `TransactionBatcher`, `StreamConnection` | Modify (TSDoc + `@public` on each)                  |
| `packages/stream-adapter/src/create-batcher.ts`         | `createBatcher`                                      | Modify (TSDoc + `@public`)                          |
| `packages/stream-adapter/src/connect-element-stream.ts` | `connectElementStream`                               | Modify (TSDoc + `@public`)                          |
| `packages/stream-adapter/src/connect-partial-stream.ts` | `connectPartialStream` + `PartialStreamOptions`      | Modify (TSDoc + `@public` on each)                  |
| `packages/stream-adapter/src/parse-element-stream.ts`   | `parseElementStream`                                 | Modify (TSDoc + `@public`)                          |
| `packages/stream-adapter/src/parse-partial-stream.ts`   | `parsePartialStream`                                 | Modify (TSDoc + `@public`)                          |
| `packages/stream-adapter/src/public_api.ts`             | **NEW** curated public re-exports                    | Create                                              |
| `packages/stream-adapter/src/index.ts`                  | Package entry                                        | Modify (collapse to `export * from './public_api'`) |
| `packages/stream-adapter/README.md`                     | **NEW** per-package README                           | Create                                              |
| `packages/stream-adapter/stream-adapter.api.md`         | Generated baseline                                   | Regenerate                                          |
| `api-extractor.base.json`                               | Repo-root config                                     | Modify (flip `ae-missing-release-tag` to `warning`) |

---

## Task 1: TSDoc + `@public` on declarations across the 6 source files

**Files:**

- Modify: `packages/stream-adapter/src/types.ts`
- Modify: `packages/stream-adapter/src/create-batcher.ts`
- Modify: `packages/stream-adapter/src/connect-element-stream.ts`
- Modify: `packages/stream-adapter/src/connect-partial-stream.ts`
- Modify: `packages/stream-adapter/src/parse-element-stream.ts`
- Modify: `packages/stream-adapter/src/parse-partial-stream.ts`

For each declaration listed below, prepend the indicated TSDoc block immediately above the `export` line (no blank line between comment and `export`).

### `packages/stream-adapter/src/types.ts`

The file currently has three exported interfaces. The first (`GridLike`) already has a non-TSDoc `/** ... */` block — replace it with the structured version below.

For `GridLike<TRow>`:

```ts
/**
 * Structural type for any grid that supports `applyTransaction`. Avoids
 * hard coupling to `@pretable-internal/grid-core` so consumers can wire
 * up streaming against a custom grid implementation that conforms to the
 * same shape.
 *
 * @public
 */
export interface GridLike<TRow extends Record<string, unknown>> {
```

For `TransactionBatcher<TRow>`:

```ts
/**
 * RAF-batched mutator returned by {@link createBatcher}. Buffer
 * `add` / `update` / `remove` calls; the batcher coalesces them into a
 * single `applyTransaction` per animation frame. `flush()` forces an
 * immediate apply; `dispose()` cancels any pending RAF and stops
 * accepting new calls.
 *
 * @public
 */
export interface TransactionBatcher<TRow extends Record<string, unknown>> {
```

For `StreamConnection`:

```ts
/**
 * Handle returned by the `connect*Stream` functions. `done` resolves
 * when the source stream ends (or rejects on stream error); `dispose()`
 * cancels the active read loop and resolves `done` immediately.
 *
 * @public
 */
export interface StreamConnection {
```

### `packages/stream-adapter/src/create-batcher.ts`

Above the existing `export function createBatcher<TRow ...>`:

````ts
/**
 * Create a `requestAnimationFrame`-batched mutator that coalesces
 * `add` / `update` / `remove` calls into a single `applyTransaction` per
 * frame. Use this when driving a grid from a stream that emits faster
 * than the browser can render — batching keeps DOM mutations to one per
 * frame regardless of stream rate.
 *
 * @example
 * ```ts
 * const batcher = createBatcher(grid);
 * batcher.add([{ id: "1", name: "Ada" }]);
 * batcher.update([{ id: "1", age: 36 }]);
 * batcher.flush(); // optional — RAF will flush automatically
 * ```
 *
 * @public
 */
export function createBatcher<TRow extends Record<string, unknown>>(
````

### `packages/stream-adapter/src/connect-element-stream.ts`

Above the `export function connectElementStream`:

```ts
/**
 * Drive a grid from an `AsyncIterable<TRow>`. Each yielded row is added
 * via a {@link createBatcher | RAF batcher}; the returned
 * {@link StreamConnection} resolves `done` when the stream ends and
 * supports `dispose()` for early cancellation.
 *
 * Pair with {@link parseElementStream} to turn a raw UTF-8 string stream
 * (e.g., from `fetch().body`) into a row stream end-to-end.
 *
 * @public
 */
export function connectElementStream<TRow extends Record<string, unknown>>(
```

### `packages/stream-adapter/src/connect-partial-stream.ts`

Above the `export interface PartialStreamOptions`:

```ts
/**
 * Options for {@link connectPartialStream}. `rowId` names the field on
 * each partial row used to identify it for upsert (the field must be
 * present in every emitted partial — partials missing the rowId are
 * ignored).
 *
 * @public
 */
export interface PartialStreamOptions {
```

Above the `export function connectPartialStream`:

```ts
/**
 * Drive a grid from an `AsyncIterable<Partial<TRow>>`. Each yielded
 * partial is upserted by `options.rowId` — new rowIds are added,
 * existing rowIds are merged via `applyTransaction.update`. Useful when
 * a stream emits incremental field updates (e.g., partial JSON parses)
 * rather than complete rows.
 *
 * Pair with {@link parsePartialStream} for end-to-end partial-update
 * streaming over UTF-8 strings.
 *
 * @public
 */
export function connectPartialStream<
```

### `packages/stream-adapter/src/parse-element-stream.ts`

Above the `export function parseElementStream` (or `export async function*` if it's async-generator-shaped — preserve whatever shape is there):

```ts
/**
 * Parse a UTF-8 string stream into an `AsyncIterable<TRow>`. Built on
 * `@cacheplane/json-stream`'s incremental JSON parser; emits each
 * complete top-level array element as a typed row.
 *
 * Pair with {@link connectElementStream} for end-to-end element-stream
 * → grid wiring.
 *
 * @public
 */
export async function* parseElementStream<TRow>(
```

(If the existing signature is `export function parseElementStream` without `async function*`, leave the function's shape unchanged — only prepend the TSDoc.)

### `packages/stream-adapter/src/parse-partial-stream.ts`

Above the `export async function* parsePartialStream`:

```ts
/**
 * Parse a UTF-8 string stream into an `AsyncIterable<Partial<TRow>>`.
 * Emits incremental partial rows as a streaming JSON parse fills out
 * each top-level array element — useful when an LLM is streaming
 * partial JSON and you want field-by-field updates instead of waiting
 * for each row to complete.
 *
 * Pair with {@link connectPartialStream} for end-to-end partial-stream
 * → grid wiring.
 *
 * @public
 */
export async function* parsePartialStream<TRow>(
```

### Step 1: Apply the TSDoc + tag for each declaration

Work file by file. Don't skip declarations.

### Step 2: Verify typecheck and tests

```bash
pnpm --filter @pretable/stream-adapter typecheck && \
pnpm --filter @pretable/stream-adapter test
```

Expected: both pass.

### Step 3: Commit

```bash
git add packages/stream-adapter/src
git commit -m "feat(stream-adapter): TSDoc + @public on every public symbol

Adds TSDoc summaries with @public release tags on every exported
symbol so api-extractor's report shows annotated API instead of
@public (undocumented). No behavior change.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Write `public_api.ts`; collapse `index.ts`

**Files:**

- Create: `packages/stream-adapter/src/public_api.ts`
- Modify: `packages/stream-adapter/src/index.ts`

### Step 1: Create `packages/stream-adapter/src/public_api.ts`

```ts
/**
 * Public API of `@pretable/stream-adapter`. Hand-curated re-exports —
 * do not edit `index.ts` directly.
 *
 * @packageDocumentation
 */

export { createBatcher } from "./create-batcher";
export { connectElementStream } from "./connect-element-stream";
export { connectPartialStream } from "./connect-partial-stream";
export type { PartialStreamOptions } from "./connect-partial-stream";
export { parseElementStream } from "./parse-element-stream";
export { parsePartialStream } from "./parse-partial-stream";
export type { GridLike, StreamConnection, TransactionBatcher } from "./types";
```

### Step 2: Replace `packages/stream-adapter/src/index.ts` with one line

```ts
export * from "./public_api";
```

### Step 3: Verify typecheck and tests

```bash
pnpm --filter @pretable/stream-adapter build && \
pnpm --filter @pretable/stream-adapter typecheck && \
pnpm --filter @pretable/stream-adapter test
```

Expected: all pass.

### Step 4: Commit

```bash
git add packages/stream-adapter/src/public_api.ts packages/stream-adapter/src/index.ts
git commit -m "feat(stream-adapter): hand-curated public_api.ts; collapse index.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Write `packages/stream-adapter/README.md`

**Files:**

- Create: `packages/stream-adapter/README.md`

### Step 1: Write the README

````markdown
# @pretable/stream-adapter

RAF-batched streaming integration for [pretable](https://pretable.dev/). Bridges async streams (HTTP SSE, WebSocket, partial-JSON from LLMs) into the grid with predictable per-frame batching.

## When to reach for this

Use `@pretable/stream-adapter` when you need to drive a grid from a live data stream and want one DOM mutation per animation frame regardless of incoming stream rate. The package ships:

- A **batcher** ([`createBatcher`](#createbatcher)) that coalesces `add` / `update` / `remove` into one `applyTransaction` per RAF tick.
- Two **connect** functions that wire an `AsyncIterable` source through the batcher into a grid.
- Two **parse** functions that turn raw UTF-8 string streams (e.g., `fetch().body`) into typed row iterables.

If you only need one-shot row mounting, use `<Pretable>` from `@pretable/react` instead — this package is for live streams.

## Install

```sh
npm install @pretable/stream-adapter
# or pnpm add @pretable/stream-adapter, yarn add @pretable/stream-adapter
```
````

## Minimal example — element stream

```ts
import { connectElementStream, parseElementStream } from "@pretable/stream-adapter";
import { createGrid } from "@pretable/core";

const grid = createGrid({ columns: [...], rows: [] });

const response = await fetch("/api/rows");
const stringStream = response.body!.pipeThrough(new TextDecoderStream());
const rowStream = parseElementStream<MyRow>(stringStream);

const connection = connectElementStream(grid, rowStream);
await connection.done; // resolves when the server closes the response
```

## Minimal example — partial-update stream (e.g., LLM)

When an LLM is streaming partial JSON, every chunk is an incomplete row. `connectPartialStream` upserts by row id so each chunk visibly fills out the corresponding row.

```ts
import {
  connectPartialStream,
  parsePartialStream,
} from "@pretable/stream-adapter";

const partialStream = parsePartialStream<MyRow>(stringStream);
const connection = connectPartialStream(grid, partialStream, { rowId: "id" });
```

## API

See **[`stream-adapter.api.md`](./stream-adapter.api.md)** for the full generated public-API report.

### `createBatcher`

Returns a `TransactionBatcher` that buffers add / update / remove calls and applies them once per `requestAnimationFrame`. Use directly when you have a custom stream source that doesn't fit the `connect*Stream` shape.

### `connectElementStream` / `parseElementStream`

`connectElementStream(grid, stream)` drives a grid from an `AsyncIterable<TRow>`. `parseElementStream(stream)` turns a string stream into an `AsyncIterable<TRow>` by parsing top-level array elements.

### `connectPartialStream` / `parsePartialStream`

Same shape, but for incremental field updates: `parsePartialStream` emits `Partial<TRow>` values as the streaming parser fills each element; `connectPartialStream` upserts by `options.rowId`.

### Types

`GridLike<TRow>` is the structural grid contract — any object with `applyTransaction({ add?, update?, remove? })` works, including a custom adapter. `TransactionBatcher<TRow>` and `StreamConnection` are the handle types returned by the constructors above. `PartialStreamOptions` is the options bag for `connectPartialStream`.

## License

MIT — see [LICENSE](../../LICENSE).

````

### Step 2: Commit

```bash
git add packages/stream-adapter/README.md
git commit -m "docs(stream-adapter): add per-package README

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
````

---

## Task 4: Regenerate `stream-adapter.api.md`; verify clean

**Files:**

- Modify: `packages/stream-adapter/stream-adapter.api.md`

### Step 1: Build and regenerate

```bash
pnpm --filter @pretable/stream-adapter build && \
pnpm --filter @pretable/stream-adapter api
```

Expected: `API Extractor completed successfully`.

### Step 2: Inspect

```bash
head -30 packages/stream-adapter/stream-adapter.api.md
grep -n "(undocumented)" packages/stream-adapter/stream-adapter.api.md | head
```

Expected: `// @public` annotation on every symbol with no `(undocumented)` at the type/function level. Member-level `(undocumented)` may still appear (we didn't add per-method TSDoc on `TransactionBatcher`'s methods, for instance) — that's acceptable.

### Step 3: Verify all 4 `api:check` pass

```bash
pnpm api:check
```

Expected: all four packages report success, exit 0.

### Step 4: Commit

```bash
git add packages/stream-adapter/stream-adapter.api.md
git commit -m "chore(api): regenerate stream-adapter.api.md after audit

Every public symbol now annotated @public with TSDoc.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Flip `ae-missing-release-tag` to `warning`

**Files:**

- Modify: `api-extractor.base.json`
- Modify (regenerate only, ideally no diff): all four `<package>.api.md` files

This is the moment of truth — sub-project A's coverage gate goes live. After this flip, any future PR that adds an exported symbol without a release tag fails CI until the author tags it.

### Step 1: Read the current config

```bash
grep -n "ae-missing-release-tag" api-extractor.base.json
```

The current setting (committed via PRs 2-3) is `"logLevel": "none"`.

### Step 2: Flip to `warning`

In `api-extractor.base.json`, find the entry:

```json
"ae-missing-release-tag": {
  "logLevel": "none"
}
```

Replace with:

```json
"ae-missing-release-tag": {
  "logLevel": "warning"
}
```

### Step 3: Regenerate all four reports

```bash
pnpm api
```

Expected: all four `API Extractor completed successfully`. If any package reports `Warning: ... (ae-missing-release-tag) "<symbol>" is part of the package's API, but it is missing a release tag` — that's a real coverage gap from PRs 2-4. Find the symbol, add the appropriate `@public` / `@beta` / `@internal` tag at its declaration, and regenerate. Repeat until clean.

### Step 4: Verify `api:check` clean

```bash
pnpm api:check
```

Expected: all four packages report success, exit 0. If `api:check` fails for any package, the regenerated `.api.md` is now stale; fix the missing tag (Step 3) and re-run.

### Step 5: Commit

```bash
git add api-extractor.base.json packages/*/[a-z]*.api.md
git commit -m "chore(api): flip ae-missing-release-tag to warning

Sub-project A is complete — every @pretable/* package has @public,
@beta, or @internal on every exported symbol. Flipping this rule to
'warning' makes it fatal in non-local mode (api-extractor's behavior),
so any future PR that adds an export without a release tag fails CI
until the author adds the tag. The intended coverage gate.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

If Step 3 surfaced any missing tags, those tag-additions ship in Task 1 / Task 5's commits depending on which file they touched. Re-attribute to whichever commit is most logical.

---

## Task 6: Repo-wide gates and PR

**Files:** none (verification + push + PR creation)

### Step 1: Run all repo-wide gates

```bash
pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format && pnpm api:check
```

Expected: every command exits 0. If `pnpm format` warns about markdown files (the spec/plan), run `pnpm format:write` and add a small format-pass commit.

### Step 2: Sanity check the PR scope

```bash
git diff main..HEAD --stat | tail -10
```

Expected: changes confined to `packages/stream-adapter/`, `api-extractor.base.json`, all four packages' `.api.md` files (regenerated), and the spec/plan docs. No source changes outside `stream-adapter/src/` (the tag flip might have surfaced small TSDoc additions in other packages — acceptable if so).

### Step 3: Push

```bash
git push -u origin api-stabilization-stream-adapter
```

### Step 4: Open the PR

```bash
gh pr create --title "refactor(stream-adapter): audit @pretable/stream-adapter; flip ae-missing-release-tag to warning" --body "$(cat <<'EOF'
## Summary

PR 5 of 5 — the **final** PR for [Tier 1 Sub-project A — Public API Stabilization](docs/superpowers/specs/2026-05-07-tier1-public-api-stabilization-design.md). After this lands, every \`@pretable/*\` package has \`public_api.ts\`, TSDoc + release tags on every public symbol, a per-package README, and a committed \`<unscoped>.api.md\`.

- **\`@pretable/stream-adapter\` audit** per [PR 5's design spec](docs/superpowers/specs/2026-05-08-tier1-api-stabilization-pr5-stream-adapter-design.md). 9 symbols (\`createBatcher\`, \`connectElementStream\`, \`connectPartialStream\`, \`parseElementStream\`, \`parsePartialStream\`, \`GridLike\`, \`TransactionBatcher\`, \`StreamConnection\`, \`PartialStreamOptions\`) all annotated \`@public\` with TSDoc.
- **\`public_api.ts\` convention** for stream-adapter; \`index.ts\` is one line.
- **Per-package \`README.md\`** with element-stream and partial-stream examples.
- **\`ae-missing-release-tag\` flipped from \`none\` → \`warning\`** in \`api-extractor.base.json\`. The coverage gate is now live: any future PR that adds an exported symbol without a release tag fails CI.

## Coverage check during the flip

The flip in Task 5 regenerates all four \`.api.md\` files and runs \`api:check\` to confirm zero \`ae-missing-release-tag\` warnings remain across the workspace. Any symbol surfaced as missing a tag during this PR's regeneration is a real coverage finding and gets tagged inline.

## Test plan
- [x] \`pnpm -w typecheck\` clean
- [x] \`pnpm -w test\` clean
- [x] \`pnpm -w lint\` clean
- [x] \`pnpm format\` clean
- [x] \`pnpm api:check\` clean (all 4 packages, with \`warning\` as the new logLevel)
- [x] \`stream-adapter.api.md\` shows \`@public\` on every symbol
- [x] \`packages/stream-adapter/README.md\` exists with examples for both element and partial streams

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### Step 5: Set auto-merge

```bash
gh pr merge --auto --squash
```

---

## Self-review checklist

- **Spec coverage:** TSDoc + `@public` on 9 symbols = Task 1. `public_api.ts` + index.ts collapse = Task 2. README = Task 3. Regenerate `stream-adapter.api.md` = Task 4. Flip `ae-missing-release-tag` to `warning` = Task 5. Gates + PR = Task 6. Every spec requirement maps to a task.
- **Placeholder scan:** no `TBD`, `TODO`, "implement later", or "etc." in any task body.
- **Type/name consistency:** every public symbol named in Task 1 appears in Task 2's `public_api.ts` and the README's "API" section.
- **Risk handled:** Task 5's flip surfaces real coverage gaps if PRs 2-4 missed any. The plan handles this inline rather than as a separate failure-recovery branch.
