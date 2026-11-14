# Grand Totals and Summary Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build opt-in filtered and all-input totals, with independent engine/server authority and a labelled, fixed bottom summary area.

**Architecture:** Store immutable, incrementally maintained summary roots on row-model revisions and expose cached values through an optional snapshot capability. Per-consumer leases request the union of needed engine scopes. React resolves explicit server answers, formats cached values, and renders a sibling summary table using the existing column layout and scroll owner.

**Tech Stack:** TypeScript, persistent aggregate trees/scalar cells, React, Vitest, Testing Library, Playwright, pnpm.

**Approved specification:** `docs/superpowers/specs/2026-11-13-grand-totals-and-summary-rows-design.md`.

**Workspace:** `.worktrees/development-resume-2026-11`; never alter the original checkout's local changes. Execute sequentially; each task gets specification then quality review before moving on. Existing grouping semantics remain unchanged. API names below may be refined to fit established generic conventions without changing behavior.

## File and contract map

- New `packages/row-model/src/summary-types.ts`: scope (`filtered | all`), immutable cached engine result, optional acquisition capability types.
- New `packages/row-model/src/summary-index.ts`: per-scope aggregate roots using existing scalar/tree primitives, cached finalization, delta and rebuild helpers.
- Modify `internal-types.ts`, `create-local-row-model.ts`, `transaction-draft.ts`, `filter-rebuild.ts`, `sort-rebuild.ts`, `visible-index.ts`, `types.ts`, `index.ts` in row-model: revision integration, publication, optional `acquireSummaryScopes(scopes): () => void`, optional snapshot `getSummary(scope)`.
- New `packages/react/src/summary.ts`: public per-scope engine/server descriptors and pure normalization; server result provenance and compatibility checks. Keep core summary values framework-neutral.
- New `packages/react/src/use-summary.ts`: effect-owned engine leases and cached snapshot consumption.
- New `packages/react/src/summary-rows.tsx`: read-only summary table with captions/column associations and existing positioned column geometry.
- Modify React `types.ts`, `surface-types.ts`, `use-pretable.ts`, `pretable-surface.tsx`, `value-formatting.ts`, `messages.ts`, public exports; modify `packages/ui/grid.css` for bottom area.
- Modify core `public_api.ts`, typed column helper contracts as necessary, API reports, public type tests, server totals docs, changeset. Never add exports to generated `index.ts`.

## Task 1: Revision-owned engine summaries

- [x] Write `packages/row-model/src/__tests__/summaries.test.ts` failing tests using existing model fixtures: rows `{id:1,n:10},{id:2,n:30}`, sum/avg/count, acquire both scopes, filter to id2; expect all sum40/avg20 and filtered sum30/avg30. Collapse/expand and snapshot reads must not change totals. No synthetic rows or count changes.
- [x] Run `pnpm --filter @pretable-internal/row-model exec vitest run --maxWorkers=2 src/__tests__/summaries.test.ts`; confirm missing capability fails.
- [x] Add exported summary types and optional model/snapshot capabilities, preserving custom structural model compatibility. A missing/uncommitted scope returns unavailable, never a scan. Values keyed by canonical column IDs; nonaggregate columns absent, null retained.
- [x] Implement summary-index with existing scalar sum/avg/count and ordered min/max/custom trees. Use compiled comparator plus stable source order; external sort uses supplied order. Reuse calendar date guards and empty behavior. Cache final values on immutable roots, not on reads.
- [x] Integrate initial/acquisition rebuild, transaction insert/update/remove, setRows, query/filter/sort, derivation/override and authority changes. Full rebuilds participate in cooperative scheduling; publish rows and summaries atomically. Delta updates touch affected aggregates, not all source rows. Disabled models allocate no summary roots or extra row walks.
- [x] Implement independent leases with scope reference counts, idempotent release, union of live requests, harmless late release after disposal. Acquisition during pending transitions must not publish mismatched totals. Retained snapshots keep old values when leases or rows change.
- [x] Add meaningful regression tests: empty/invalid dates and numbers, weighted averages across nested groups, deterministic noncommutative custom folds after sorting, external authority, overrides, transactions/eviction/replacement, zero filter matches, two consumers releasing independently, disposal/pending rebuild cancellation and held snapshots.
- [x] Add work-counter tests on large input: one-row scalar/tree change bounded by affected aggregates/tree depth; repeated reads/expansion cost zero aggregation; disabled parity. Verify cooperative intermediate snapshots stay coherent and acquisition/release during pending transitions.
- [x] Run row-model complete tests and typecheck: `pnpm --filter @pretable-internal/row-model test` and `pnpm --filter @pretable-internal/row-model typecheck`. Commit engine feature after reviews.

## Task 2: Server provenance, formatting and React ownership

- [x] Write failing `packages/react/src/__tests__/summary-results.test.ts` for independently configured scopes and server states; ready matching current request/definition keys, mismatch unavailable; stale compatible definition preserves original key/context; stale incompatible definition unavailable; missing column unavailable, explicit null empty; loading/error never inherit values; unknown columns ignored.
- [x] Define `summaries` as optional per-scope descriptors (filtered/all), each discriminated by authority. Server descriptor requires current requestKey and aggregateDefinitionKey; ready/stale answers carry matching provenance, completeness and values; stale additionally requires explanatory label. Loading/error/unavailable carry no numeric result. Do not fetch or infer request keys. Export public types.
- [x] Implement pure result resolver in `summary.ts`; current request mismatch fails closed for ready. Engine partial/external inputs always labelled loaded rows regardless of exact resultMeta.total. Unsupported custom-model engine capability is unavailable; server mode remains functional.
- [x] Add `formatSummary` to column contracts: `{value,column,summary:{scope,authority,completeness,state}}`. Implement cached native number/date then generic fallback after callback; missing/status bypass all callbacks. Existing formatAggregate receives real groups only and remains unchanged. Update public helper inference and tests.
- [x] Implement effect-only scope leasing in `use-summary.ts`/composition integration. Acquire new scopes before releasing old; no model recreation, no render mutation, StrictMode-safe, shared model consumer safe. Test scope changes preserve selection/edit state; explicitly test answer invalidation after aggregate overrides and order-sensitive sort changes. Render only committed snapshot results.
- [x] Run focused tests (expected initial fail then pass), including mounted StrictMode two-consumer tests and callback/native/fallback/locale tests; run full React tests and typecheck. Commit reviewed changes.

## Task 3: Fixed summary area and interactions

- [x] Write failing `packages/react/src/__tests__/summary-rows.test.tsx`: two separately labelled value rows, first numeric column preserved; missing/loading/stale/partial/error visible; zero and null distinct from unavailable; disabled feature no region.
- [x] First validate a small accessible-table prototype with column associations and narrow captions, documenting unavailable screen-reader checks. Render accessible read-only summary table as sibling to grid in existing vertical stack. Captions immediately above each value row; column headers/associations present even for virtualized geometry. No live streaming announcements. Use existing planned widths, pinned offsets, normalized RTL horizontal scroll, scrollbar gutter and virtualization; no independent scroll/width authority. Region is fixed below data viewport and above any surrounding footer.
- [x] Verify resize/reorder/hide/pin, horizontal scroll, RTL, group/tool panel wrappers and constrained height. Keep summaries outside data row indices, IDs, editing/paste/selection/navigation and export. Nonaggregate cells blank; aggregate missing cells show status.
- [x] Add mounted tests for layout and keyboard semantics, SSR and locale; ensure disabled viewport has full available height. Add an existing benchmark/example fixture with both scopes and server state controls for browser tests, following app AGENTS instructions.
- [x] Add Playwright tests in the existing app browser suite for column alignment after scroll/pin/resize, bottom region placement, focus remaining in data grid and summary accessible table associations; inspect screenshots at narrow and wide widths. Automated accessibility assertions do not substitute for a documented manual screen-reader limitation if no screen reader is available.
- [ ] Run React tests plus relevant browser tests; commit reviewed renderer.

## Task 4: Public API, documentation and full validation

- [ ] Add public type tests for headless snapshots/leases, helper `formatSummary` inference, scope descriptor discrimination and custom models without optional capabilities. Ensure raw values are accessible without React.
- [ ] Update `apps/website/content/docs/server-data/totals.mdx` and relevant local grouping/column docs with both scopes, loaded-vs-complete truth, server keyed ready/stale/loading/error examples, definition/query/order invalidation responsibilities, shared group/summary formatter example and lease disposal. Add a runnable both-scope example and changeset for affected public packages.
- [ ] Build packages, regenerate API reports (`pnpm api`), inspect intended exported additions only. Run `pnpm typecheck:public`, `pnpm api:check`, `pnpm lint:packaging`, `pnpm typecheck:performance`.
- [ ] Run full `pnpm test`, `pnpm typecheck`, `pnpm lint`, formatting check for touched files, app production build and `pnpm consumer:check`. Run appropriate browser regressions and row-model performance gate. Investigate failures, retain useful evidence, do not claim checks not run.
- [ ] Final independent specification review then quality review; resolve findings and rerun affected tests. Inspect git diff/status, commit, prepare reviewable PR with outcome and validation. User changes in original checkout remain preserved.

## Acceptance record

Record exact checks/results and limitations here as implementation proceeds. Done means both scopes, server authority, compatible explicit stale values, coherent incremental snapshots, fixed accessible layout, and public consumers validated together—not merely a visual mockup.

Plan review: approved; accessibility prototype and explicit override/order invalidation checks incorporated.

Initial validation: locked dependency install and React dependency build passed. The unconstrained React baseline was stopped after a timeout; the affected grouping-options file passed all 5 tests with a bounded-worker direct Vitest invocation. Use `pnpm exec vitest run --maxWorkers=2 ...` within a package; a script-level `--` causes Vitest to ignore intended filtering and worker flags.

Validation scheduling: host load rose to 177.61 (1 minute) while the full row-model suite ran. Its existing 100k-value distinct search exceeded its explicit30s budget (34.9s). Heavy run stopped; do not relax timeouts. Continue focused verification and independent review, then rerun full suites when load permits. This is deferred validation, not a passing full-suite claim.

Task 1 committed `d2b74d52`:17 focused tests, row-model typecheck and lint pass; independent specification and quality reviews approved. Full suite remains deferred as described above. Reviewer-found initializer failure and self-review-found acquisition rebasing failure both have regression tests.

Accessibility prototype: browser accessibility snapshot exposes two separate caption-labelled native tables with columnheader/cell structure adjacent to the grid. At360px width, both captions fit without page overflow; Tab moves from the grid cell to the following external button, skipping summary values. Screenshot: `/private/tmp/pretable-summary-prototype/summary-semantics-narrow.png` (temporary artifact). This validates the proposed structure, not final renderer geometry or actual screen-reader speech; manual screen-reader testing remains unavailable. Temporary server/browser closed.

Task 2 committed `178135a9`:29 focused tests across5 files, React typecheck, scoped ESLint, row-model compilation and core build pass. Independent specification and quality reviews approved. Surface props/invocation intentionally moved into Task3 alongside renderer integration; broad React suite remains part of final load-aware validation.

Recovered engine validation: formerly timed-out100k distinct search passed in2.75s at lower load (same30s limit). Full final row-model suite passed47 files/772 tests in65.24s with1worker, exit0; log `/private/tmp/pretable-summary-engine-final.log`. No production or test changes were needed for the earlier timing failure.

Task 3 runtime committed `87f7e3f7`; spec/quality reviews approved after adding optional committed aggregate-column metadata for server-only supplied-model derivations.19 summary tests and64 focused React tests, row-model metadata tests/typecheck, React typecheck and scoped lint pass. Chromium geometry/live resize/scroll/layout, narrowRTL, states and AX/SSR pass; WebKit geometry/states/AX pass, tab-target fixture corrected after confirming identical native-button skipping with summaries disabled. Final8-case rerun pending. Dark/narrow manual screenshot verified. Next dev needed `WATCHPACK_POLLING=1000` locally to discover nested routes (existing routes also affected); no application config workaround committed.
