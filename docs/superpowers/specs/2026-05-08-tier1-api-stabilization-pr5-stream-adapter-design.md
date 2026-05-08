# Tier 1 Sub-project A — PR 5 (`@pretable/stream-adapter` audit) Design

> Status: spec. 2026-05-08. PR 5 of 5 — completes [Tier 1 Sub-project A — Public API Stabilization](2026-05-07-tier1-public-api-stabilization-design.md).

## Goal

Lock `@pretable/stream-adapter`'s public surface for 1.0. Move to the `public_api.ts` convention, add TSDoc + `@public` to every symbol, write the per-package README. With every `@pretable/*` package fully tagged after this PR merges, flip `ae-missing-release-tag` from `none` → `warning` in `api-extractor.base.json` so the gate covers future surface additions.

## Non-goals

- No symbol renames. The connect/parse pair (`connectElementStream`/`parseElementStream`, `connectPartialStream`/`parsePartialStream`) is already symmetric and idiomatically named.
- No `@beta` or `@internal` tags. Streaming has real website docs and every export is user-facing.
- No `ɵ`-prefix demotions. No internal-leakage candidates in this surface.
- No engine-coupling change. `GridLike` is structurally typed (no hard dep on `@pretable-internal/grid-core`) and that stays.
- No new tests. Behavior is unchanged.

## Architecture

### Public-surface layout

`@pretable/stream-adapter/src/` becomes:

```
src/
  index.ts                       // export * from './public_api';
  public_api.ts                  // hand-curated re-exports
  types.ts                       // GridLike, TransactionBatcher, StreamConnection
  create-batcher.ts              // createBatcher
  connect-element-stream.ts      // connectElementStream
  connect-partial-stream.ts      // connectPartialStream + PartialStreamOptions
  parse-element-stream.ts        // parseElementStream
  parse-partial-stream.ts        // parsePartialStream
```

`public_api.ts` is the only file whose contents are reviewed for public-API impact.

### `ae-missing-release-tag` flip

PR 2 set this rule's `logLevel` to `none` because most packages had untagged baselines. PR 5 — once every `@pretable/*` package is fully tagged — flips it to `warning`. In api-extractor's non-local mode `warning` is fatal, which is exactly what we want post-tagging: any future PR that adds an export without a release tag fails CI until the author adds the tag.

The flip happens in this PR's last task, *after* `pnpm api:check` has been verified clean across all 4 packages with the current `none` setting. Then we flip, regenerate, and confirm `api:check` still passes.

## Components — full audit decisions

Every export gets `@public` + a one-line TSDoc summary. No release-tag variation.

| Symbol | Summary |
|---|---|
| `createBatcher<TRow>(grid)` | "Create a `requestAnimationFrame`-batched mutator that coalesces add/update/remove calls into a single `applyTransaction` per frame." |
| `connectElementStream<TRow>(grid, stream)` | "Drive a grid from an `AsyncIterable<TRow>` — every yielded row is added via the batcher." |
| `connectPartialStream<TRow>(grid, stream, options)` | "Drive a grid from an `AsyncIterable<Partial<TRow>>` — partial rows are upserted by `options.rowId`." |
| `parseElementStream<TRow>(stream)` | "Parse a UTF-8 string stream into an `AsyncIterable<TRow>` — pair with `connectElementStream` for end-to-end JSON-element streaming." |
| `parsePartialStream<TRow>(stream)` | "Parse a UTF-8 string stream into an `AsyncIterable<Partial<TRow>>` — pair with `connectPartialStream` for partial-update streaming." |
| `GridLike<TRow>` | "Structural type for any grid that supports `applyTransaction`. Avoids hard coupling to `@pretable-internal/grid-core`." (existing comment becomes the TSDoc.) |
| `TransactionBatcher<TRow>` | "RAF-batched mutator returned by {@link createBatcher}. Buffer add/update/remove calls; the batcher flushes once per animation frame." |
| `StreamConnection` | "Handle returned by the `connect*Stream` functions. `done` resolves when the source stream ends or `dispose()` is called." |
| `PartialStreamOptions` | "Options for {@link connectPartialStream}. `rowId` names the field used to identify rows for upsert." |

## Data flow

1. Add TSDoc + `@public` to every declaration in the 6 source files.
2. Write `public_api.ts`; collapse `index.ts` to one line.
3. Write `packages/stream-adapter/README.md`.
4. Regenerate `stream-adapter.api.md`.
5. Verify `pnpm api:check` clean across all 4 packages.
6. **Flip** `ae-missing-release-tag` `none` → `warning` in `api-extractor.base.json`.
7. Regenerate all 4 reports; verify `api:check` still passes (i.e., zero `ae-missing-release-tag` warnings — confirmation that PR 2-5 left no untagged public symbols).
8. Repo-wide gates + PR.

## Error handling

- **`api:check` fails after flipping `ae-missing-release-tag` to `warning`.** Means PR 2, 3, or 4 missed tagging something. Fix is to find and tag the symbol — which is a real coverage finding, not a process error. The flip-then-regenerate dance in step 6/7 surfaces these.
- **Internal compile errors after `public_api.ts` move.** Caught by `pnpm -w typecheck`.

## Testing

Repo-wide gates: `pnpm -w typecheck`, `pnpm -w test`, `pnpm -w lint`, `pnpm format`, `pnpm api:check`.

Existing stream-adapter unit tests (in `packages/stream-adapter/src/__tests__/`) continue to be the behavioral suite. No new tests.

## Per-package README

`packages/stream-adapter/README.md` ~80 lines:

- One-paragraph "what is `@pretable/stream-adapter`" — RAF-batched streaming integration for pretable. Bridges async streams (HTTP SSE, WebSocket, partial-JSON) into the grid.
- "When to use" — when you need to drive a grid from a live data stream and want predictable per-frame batching instead of one DOM mutation per row.
- Install + minimal usage (one example with `createBatcher` + `connectElementStream`).
- "API" section with one paragraph per public symbol pointing to `stream-adapter.api.md` for full signatures.
- License/contributing footer.

## PR shape

Single PR. The TSDoc additions and `public_api.ts` move are mechanically simple; the `ae-missing-release-tag` flip is the one moment of risk and ships in a separate commit (last) so reverting is trivial if it surfaces a missed tag we want to defer.

Implementation tasks (subagent-driven):

1. Add TSDoc + `@public` on every declaration across the 6 source files.
2. Write `public_api.ts`; collapse `index.ts`.
3. Write `packages/stream-adapter/README.md`.
4. Regenerate `stream-adapter.api.md`; verify clean.
5. Flip `ae-missing-release-tag` to `warning` in `api-extractor.base.json`; regenerate all 4 reports; verify `api:check` clean.
6. Repo-wide gates + PR.

## Success criteria

- `stream-adapter.api.md` shows `@public` annotation on every symbol (no `(undocumented)` at the type level — member-level `(undocumented)` is acceptable).
- `packages/stream-adapter/src/public_api.ts` exists; `index.ts` is one line.
- `packages/stream-adapter/README.md` exists with the structure above.
- `api-extractor.base.json` has `"ae-missing-release-tag": { "logLevel": "warning" }`.
- All 4 packages' `api:check` clean after the flip.
- All repo-wide gates pass.
- Sub-project A is complete: every `@pretable/*` package has `public_api.ts`, TSDoc + release tags on every public symbol, a per-package README, and a committed `<unscoped>.api.md` snapshot.
