# Remote Datasets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver read-only grouped remote browsing and same-version full-result CSV export while preserving existing local and manual-window behavior.

**Architecture:** An application provider feeds a session controller, bounded sibling-range cache and sparse hierarchical index. Local and remote models adapt to shared layout reads without changing local snapshots or manual window metadata. A separate server export adapter produces artifacts without accumulating the dataset in the browser.

**Tech Stack:** TypeScript, React, existing internal layout/renderer packages, Vitest, Playwright, Next.js reference routes, pnpm workspace tooling.

---

## Authority, scope and execution rules

The [approved behavioral design](../specs/2026-11-19-remote-datasets-design.md)
and its window compatibility matrix govern this plan. The user authorized
task-scoped implementation with review between tasks on 2026-11-19. Checkboxes
record reviewed completion; unchecked tasks make no passing-test or measured-default
claim. Research is in
[the evidence report](../../research/2026-11-19-remote-datasets-research.md).

Work in an isolated implementation worktree from the reviewed design branch;
leave the original `/Users/blove/repos/pretable` workspace and its modified
`.gitignore` untouched. Use a `blove/` branch. Record starting SHA and dirty-file
inventory before edits. Do not stash, reset or switch the original workspace.
Use the pinned Node/pnpm versions from package.json. Install with
`pnpm install --frozen-lockfile` in the implementation worktree only when needed.

The tasks are sequential dependencies unless explicitly noted. Each test case
within a task is a small red/green cycle: add one failing behavior, run it, make
the smallest implementation change, rerun, then take the next case. Commit each
coherent task. Do not write every failing suite before implementing any behavior.
Use @superpowers:test-driven-development during execution and
@superpowers:verification-before-completion before success claims.

This is one release, delivered through reviewable increments. The provider,
index, UI and export tasks are coupled by result identity, so they stay in one
ordered plan. Independent future live/edit/pivot features are excluded.

## File ownership and dependency direction

All new paths below are proposed files; existing paths are named as modifications.

| Area | Files and responsibility |
| --- | --- |
| Remote core | New `packages/core/src/remote/`: `types.ts`, `query.ts`, `validate-response.ts`, `session.ts`, `scheduler.ts`, `cache.ts`, `sparse-index.ts`, `selection.ts`, `summaries.ts`, `export-controller.ts`, `create-remote-model.ts`; one responsibility each |
| Public core | Existing `packages/core/src/public_api.ts`; expose reviewed types/factory through the existing entry point, no new dependency on React or DOM |
| Shared layout | New `packages/layout-core/src/read-layout.ts`; existing `viewport-plan.ts`, `row-height-index.ts`, `index.ts` only where adapter integration requires it |
| Renderer | New `packages/renderer-dom/src/remote-layout.ts`; existing `row-layout-controller.ts` preserves manual coordinate and anchoring behavior |
| React | New `packages/react/src/remote/`: `use-remote-model.ts`, `remote-read-adapter.ts`, `status-row.tsx`, `export-controls.tsx`; focused bridges rather than a second complete grid |
| React integration | Existing `pretable-surface.tsx`, `surface-types.ts`, `public_api.ts`, `copy.ts`, `csv.ts`, `use-summary.ts`; inspect `pretable.tsx` before extending the drop-in owner |
| Reference backend | New `apps/website/lib/remote-demo/`: `dataset.ts`, `provider.ts`, `export-jobs.ts`; bounded deterministic demo service, not a production hosted backend |
| Demo routes | New `apps/website/app/api/docs/remote/route.ts` and `apps/website/app/api/docs/remote-export/route.ts` |
| Demo and docs | New `apps/website/content/examples/remote-grouped/` and `content/docs/server-data/remote.mdx`; existing example registry and server-data docs |
| Evidence | New `status/remote-datasets/` reports; new remote benchmark fixture and browser specs |

Avoid a package dependency cycle: core uses existing lower-level contracts;
layout consumes structural read interfaces without importing the public core;
React composes both. Export protocol types belong in core, transport and artifact
storage in the application adapter. Inspect package export/build configuration
before adding cross-package imports; do not import another package's source path.

## Proposed protocol sketch to make tasks concrete

Names are provisional until Task 2 API review. Use existing filter/sort/aggregate
vocabulary where its semantics match; do not invent a second filter language.
The following is the minimum identity envelope, not an unchecked wire cast:

```ts
type RangeAddress = {
  sessionId: string;
  resultToken: string;
  route: readonly { columnId: string; key: string | number | boolean | null }[];
  start: number;
  end: number;
};
type Acceptance = {
  queryKey: string;
  generation: number;
  sessionId: string;
  resultToken: string;
  attempt: number;
};
function canPublish(current: Acceptance, incoming: Acceptance): boolean {
  return current.queryKey === incoming.queryKey &&
    current.generation === incoming.generation &&
    current.sessionId === incoming.sessionId &&
    current.resultToken === incoming.resultToken &&
    current.attempt === incoming.attempt;
}
```

Attempt ownership is maintained per range, not globally. Route and interval are
validated before publication. Extend typed keys only through versioned canonical
serialization; never stringify objects or join labels to manufacture identity.
Dates and server buckets use declared canonical scalar keys.

Required provider operations: open a typed query, read a sibling range, resolve
keyed summaries, and release a session; all asynchronous operations accept
cancellation. Required export operations: idempotent create, status, cancel,
release status subscriptions, and application-owned download delivery. Model
reads are synchronous and never initiate network calls; viewport demand is an
explicit controller input outside render.

## Verification commands

Commands run from the implementation worktree. Package-filtered `exec vitest`
uses the package working directory. New tests below are exact planned paths.

- Core unit: `pnpm --filter @pretable/core exec vitest run src/remote/__tests__`
- Layout: `pnpm --filter @pretable-internal/layout-core test`
- Renderer: `pnpm --filter @pretable-internal/renderer-dom test`
- React: `pnpm --filter @pretable/react test`
- Website unit: `pnpm --filter @pretable/app-website test`
- Browser: `pnpm bench:e2e apps/bench/tests/remote-datasets.spec.ts`
- Legacy browser: `pnpm bench:e2e apps/bench/tests/windowed-data.spec.ts apps/bench/tests/eviction.spec.ts`
- Website browser: `BASE_URL=http://127.0.0.1:3217 pnpm --filter @pretable/app-website smoke e2e/server-data.spec.ts e2e/remote-data.spec.ts`

Before browser runs inspect the repository Playwright configuration, reserve an
unused port using its supported configuration, and ensure it cannot reuse a
stale server from another worktree. For website tests, verify port 3217 is free,
start `pnpm --filter @pretable/app-website dev --port 3217` in a separate terminal,
and pass `BASE_URL=http://127.0.0.1:3217` explicitly: its Playwright configuration
otherwise targets production. If occupied, choose a free port and change both
commands together. Run performance workloads only on a quiet
machine, record environment/cadence, and do not loosen thresholds to clear a run.

## Execution record

Implementation branch: `blove/remote-datasets-implementation`, starting at
`8ce27c8bd`. Worktree: `/Users/blove/repos/pretable/.worktrees/remote-datasets-implementation`.
Original workspace remains on `blove/calendar-date-formatting-design`; its only
tracked modification is `.gitignore`, verified against the preserved binary diff
before implementation. No runtime source has changed at initialization.

Repository inspection correction: Task 2 core type tests live under
`type-tests/core/`, because `type-tests/tsconfig.json` includes that directory
and would silently omit a file placed directly under `type-tests/`.

Task 1 is in progress. Each task requires separate specification and code-quality
review before its completion checkboxes are checked. Record review commits and
observed test evidence here as execution proceeds.

## Tasks

### Task 1: Compatibility baseline and executable window matrix

**Files:** Existing tests listed in the spec window regression matrix; create `packages/react/src/__tests__/remote-window-compatibility.test.tsx` and `status/remote-datasets/baseline.md`.

- [ ] **Step 1:** Run the existing layout, renderer, React and legacy browser commands before changing shared code; record SHA, commands, failures and geometric evidence in baseline.md. Investigate pre-existing failures separately rather than changing expectations.
- [ ] **Step 2:** Add paired manual/local cases for nonzero window offsets, exact versus unknown totals, grouped/non-external downgrade, resultMeta-only boundary changes, datasetKey reset and simultaneous grid instances. Record legacy copy/CSV/edit behavior to preserve. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Keep current behavior unchanged; this task is a compatibility baseline, so already-covered passing cases need no duplicate tests. New remote-only assertions are introduced with their implementation tasks.
- [ ] **Step 4:** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/remote-window-compatibility.test.tsx`. Expected: All manual/local cases pass; geometric browser checks intersect real viewport rectangles and use real pointer clicks.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `docs: record remote window compatibility baseline`.

### Task 2: Provider types and public API feasibility

**Files:** Create `packages/core/src/remote/types.ts`, `query.ts`, `__tests__/query.test.ts`; modify `packages/core/src/public_api.ts`; create `type-tests/react/remote-model.types.tsx` and `type-tests/core/remote-model.types.ts`.

- [ ] **Step 1:** Write query identity cases for typed null/number/string keys, source/auth/schema changes, filters, group and leaf sorts, aggregate definitions, locale/projection/search and semantic registry versions.
- [ ] **Step 2:** Add compile-time cases for rows/model inference remaining unchanged and remote versus manual-window/write inputs being exclusive; stage React type assertions with Task 10 if the surface overload is not yet present. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Define provider/result/group/leaf/status/error discriminated unions, capability negotiation and the remote read-only handle. Require exact root/child counts. Canonicalize every supported data dependency and reject unsupported query operators. Keep placeholders out of existing local unions. Freeze the minimum type contract after reviewing generated declaration shape.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/query.test.ts`. Expected: Identity tests pass without network access; unsupported capabilities fail before open/read dispatch. Record API decisions and unresolved names before downstream implementation.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: define grouped remote provider contracts`.

### Task 3: Consistent reference provider and export feasibility

**Files:** Create `apps/website/lib/remote-demo/dataset.ts`, `provider.ts`, `__tests__/provider.test.ts`; create `packages/core/src/remote/__tests__/fixtures/provider.ts`.

- [ ] **Step 1:** Build a deterministic small orders fixture grouped region/customer with duplicate labels, typed keys, nulls and sortable aggregates. Capture a materialized version plus an authorized unfiltered base view; use explicit bounded TTL/storage.
- [ ] **Step 2:** Write mutation-between-reads tests for immutable results and a coherent revision-fence fixture. Include inserts/deletes with unchanged counts, group moves, two queries sharing a revision, filtered/all totals and source/auth revocation. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Implement sorting/filtering/grouping and exact range/count/aggregate responses with stable tie-breaks. The revision-fence fixture reads fence and values atomically in one server operation. Prove export can pin an immutable version or materialize it atomically before later mutations; a latest-data traversal must fail the test. Document storage/TTL exhaustion as typed errors. Do not hold an indefinite database transaction or rely on per-process Next.js state across separate requests.
- [ ] **Step 4:** Run `pnpm --filter @pretable/app-website exec vitest run --environment jsdom lib/remote-demo/__tests__/provider.test.ts`. Expected: Both strategies either return coherent values or explicitly expire. A fixture-only backend is labelled as such; production adapters must provide durable version/job storage. No SQL is required for the fixture; any SQL example uses trusted schema mappings and parameters.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: add versioned grouped provider fixtures`.

### Task 4: Sparse index and layout feasibility gate

**Files:** Create `packages/core/src/remote/sparse-index.ts`, `__tests__/sparse-index.test.ts`; create `packages/renderer-dom/src/remote-layout.ts`, `__tests__/remote-layout.test.ts`; create `status/remote-datasets/layout-feasibility.md`.

- [ ] **Step 1:** Write a small eager-tree oracle and seeded sequences of expand/collapse/rank lookup. Assert 20 + 10,000 + 50,000 = 60,020 display slots while resident payload remains bounded.
- [ ] **Step 2:** Add disjoint branch ranges, root-only flat ranges, depth limits, unknown expansion ancestors, far seeks and repeated collapse/refetch. Count allocated index nodes for 1M versus 100M logical leaves at equal residency. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Implement compressed sibling intervals and subtree extents with bounded topology. Prototype variable-height anchoring and actual browser scroll-height ceilings before committing to geometry. If segmentation is necessary, specify explicit physical/logical mapping in the evidence file and test reveal, hit testing, telemetry and scroll round trips; retain the existing manual global-coordinate contract. Resolve this gate before React integration.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/sparse-index.test.ts`. Expected: Oracle ranks match after every operation; no per-unseen-row allocation. Run renderer tests and a browser probe to record geometric limits separately; unit tests do not prove browser feasibility.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: add sparse grouped projection index`.

### Task 5: Session acceptance and response validation

**Files:** Create `packages/core/src/remote/session.ts`, `validate-response.ts`, `__tests__/session.test.ts`, `__tests__/validate-response.test.ts`.

- [ ] **Step 1:** Write A→B→A, same-token different-query, same-range retry and independent out-of-order range cases with deferred promises and an abort-ignoring provider.
- [ ] **Step 2:** Add wrong route/level, duplicate identity, short middle range, count mismatch, aggregate definition mismatch and contradictory overlap cases. Test late errors as well as late success. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Implement per-range ownership plus query/generation/session/token acceptance. Atomically publish a new root; keep at most one coherent stale view. Expiry freezes reads until explicit Refresh; contradiction removes untrustworthy data; auth revocation purges protected state. Clear selection when Refresh/query change starts even if the new token is unchanged. Release replaced sessions best effort.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/session.test.ts src/remote/__tests__/validate-response.test.ts`. Expected: Only current owners publish; independent ranges both succeed; malformed/contradictory responses cannot leak partial state.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: enforce remote session consistency`.

### Task 6: Bounded scheduling and retries

**Files:** Create `packages/core/src/remote/scheduler.ts`, `__tests__/scheduler.test.ts`.

- [ ] **Step 1:** Use a fake clock to test focused demand before viewport, overscan and prefetch; coalesce superseded scroll ranges and deduplicate identical demands.
- [ ] **Step 2:** Write four active/64 queued limit tests, abort-ignoring and never-settling providers, 250 ms/1 s retry delays, bounded retry-after, 30 s deadline, and disposal. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Implement explicit permits held until invoked promises settle, bounded queue ownership and initial-plus-two transient attempts. Invalid capability/response/auth/consistency errors never retry automatically. Timeout reports failure without freeing unsettled physical invocation capacity. Expose stalled-provider diagnostics and prevent replacement loops.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/scheduler.test.ts`. Expected: Request counters stay bounded under rapid scrolling, cancellation and disposal; no real sleeps are used in unit tests.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: schedule bounded remote range reads`.

### Task 7: Cache admission, metadata and measurement budgets

**Files:** Create `packages/core/src/remote/cache.ts`, `__tests__/cache.test.ts`; extend sparse-index tests and `packages/renderer-dom/src/__tests__/remote-layout.test.ts`.

- [ ] **Step 1:** Write separate payload byte/entry, ingress reservation, branch-store, topology, expansion, selected-ID and measurement cap tests using oversized keys and payloads.
- [ ] **Step 2:** Cover current plus retiring sessions sharing budgets, offscreen eviction, visible-set-too-large errors, failed admission without refetch loops and externally retained snapshots. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Implement atomic admission and global accounting, cold payload eviction and bounded measurement LRU. Preserve required topology across store eviction. Refuse new expansion/selection rather than silently discarding intent. Release the stale body if it blocks new-root admission. Distinguish estimated accounted size from observed heap and require provider response limits.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/cache.test.ts src/remote/__tests__/sparse-index.test.ts`. Expected: All documented cardinality/size budgets hold; eviction never changes record identity or expanded ranks. Re-estimation after measurement eviction corrects anchors within tested tolerance.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: bound remote cache and topology retention`.

### Task 8: Read model composition and summary provenance

**Files:** Create `packages/core/src/remote/create-remote-model.ts`, `summaries.ts`, `__tests__/model.test.ts`, `__tests__/summaries.test.ts`; modify `packages/core/src/public_api.ts`.

- [ ] **Step 1:** Write headless consumer tests that subscribe, change query, expand, demand a viewport, retry and dispose. Assert synchronous reads dispatch no network work.
- [ ] **Step 2:** Cover filtered versus all-scope keyed totals, unsupported same-version base summary, stale answers, failed aggregates, width-only changes and definition changes. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Compose session, scheduler, cache and index with immutable publication and explicit lifecycle. Preserve 0.21.0 summary provenance and aggregateDefinitionKey; never compute server totals from cached pages. Export unavailable/error distinctly from zero. Expose counters and loaded-entry iteration without scanning the logical extent.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/model.test.ts src/remote/__tests__/summaries.test.ts`. Expected: Headless browsing works with the reference fixture, all summary scopes stay coherent, and disposal cannot publish or retain controller history.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: compose remote read model and summaries`.

### Task 9: Shared layout adapter without manual regressions

**Files:** Create `packages/layout-core/src/read-layout.ts`; modify `packages/layout-core/src/index.ts`, `viewport-plan.ts` and `packages/renderer-dom/src/row-layout-controller.ts` only as required; extend `remote-layout.ts` and its tests.

- [ ] **Step 1:** Write paired local/manual/remote read-adapter tests for equal materialized rows, then sparse branches, nonzero offsets, width/theme changes, measurement retention and far reveal.
- [ ] **Step 2:** Assert published scrollTop and row top share coordinates, correct viewport intersection, clamping, hit testing and telemetry. Cover metadata-only updates using one committed geometry snapshot. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Introduce a structural read seam that preserves existing local fast paths and window spacers. Route remote ranges through the sparse layout mapping validated in Task 4. Reuse anchor/measurement primitives where proven; do not make the local model understand remote loading states.
- [ ] **Step 4:** Run `pnpm --filter @pretable-internal/layout-core test && pnpm --filter @pretable-internal/renderer-dom test`. Expected: All original window/eviction tests pass unchanged, alongside remote tests; no arbitrary coordinate arithmetic is duplicated in React.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `refactor: share layout reads with remote projection`.

### Task 10: React remote ownership and read-only surface

**Files:** Create `packages/react/src/remote/use-remote-model.ts`, `remote-read-adapter.ts`; modify `pretable-surface.tsx`, `surface-types.ts`, `public_api.ts`; create `packages/react/src/__tests__/remote-surface.test.tsx`.

- [ ] **Step 1:** Write remote input rendering and type cases, including rows/local model/manual window conflicts. Instrument every editor predicate/renderer/parser/validator/setter to throw if invoked.
- [ ] **Step 2:** Test external headless ownership versus React-created ownership, StrictMode mount/unmount, simultaneous manual and remote grids, source/auth change and no render-time requests. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Bind immutable reads and viewport demand outside render. Reject write callbacks and mixed inputs before rendering. Keep shared editor-configured columns inert. Preserve drop-in viewport ownership; explicitly review whether the existing drop-in accepts a managed model and add its inference cases without exposing manual telemetry it does not own. No second windowGap fetch loop.
- [ ] **Step 4:** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/remote-surface.test.tsx src/__tests__/remote-window-compatibility.test.tsx`. Expected: Provider call counts show one request owner; edit callbacks remain untouched; local/manual editing and inference pass. Run pnpm typecheck:public after adding the React overload.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: integrate read-only remote grid surface`.

### Task 11: Selection, loading slots and accessible navigation

**Files:** Create `packages/core/src/remote/selection.ts`, `__tests__/selection.test.ts`; create `packages/react/src/remote/status-row.tsx`, `packages/react/src/__tests__/remote-navigation.test.tsx`; create `apps/bench/tests/remote-datasets.spec.ts`.

- [ ] **Step 1:** Write retained-ID, loaded-expanded select-all, collapsed cache exclusion, no auto-selection of arriving rows, capacity refusal and query/Refresh clearing tests.
- [ ] **Step 2:** Add range projection-revision invalidation and pending keyboard targets; test Escape, Tab leaving, collapse fallback, failure Retry and late completion after focus leaves. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Render status slots with correct expanded indices and no record callbacks/selection semantics. Deduplicate Retry per visible failed range. Keep focus on the viewport while pending; restore only current targets. Distinguish unknown root metadata from known sparse extents and use one polite live region.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/selection.test.ts && pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/remote-navigation.test.tsx`. Expected: Unit interaction passes, then real pointer/keyboard browser tests verify focus, indices, branch errors and no fabricated records.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: add remote selection and loading navigation`.

### Task 12: Loaded copy, CSV and fixed summary integration

**Files:** Modify `packages/react/src/copy.ts`, `csv.ts`, `use-summary.ts`; create `packages/react/src/__tests__/remote-serialization.test.tsx`; extend existing summary tests.

- [ ] **Step 1:** Write complete versus unloaded cell rectangle copying, eviction between selection/copy, no hidden fetch, empty selected-loaded export, retained unloaded IDs and collapsed branches.
- [ ] **Step 2:** Add status-slot exclusion, formula protection, omitted columns, partial metadata/filename, and filtered/all-scope summary presentation tests. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Use bounded loaded iterators; leave clipboard untouched on incomplete copy. Expose explicitly labelled loaded-view/selected-loaded actions without empty-selection fallback. Keep existing local/manual serialization behavior and fixed-bottom summary semantics unchanged; summary rows never enter export.
- [ ] **Step 4:** Run `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/remote-serialization.test.tsx src/__tests__/summary-rows.test.tsx src/__tests__/summary-results.test.ts`. Expected: No range read is caused by copy/loaded export; partial coverage is visible and summaries retain same-session provenance.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: support honest remote clipboard and loaded CSV`.

### Task 13: Server export protocol and job controller

**Files:** Create `packages/core/src/remote/export-controller.ts`, `__tests__/export-controller.test.ts`; extend `remote/types.ts`; create `apps/website/lib/remote-demo/export-jobs.ts`, `__tests__/export-jobs.test.ts`.

- [ ] **Step 1:** Write idempotent-start, queued/running/ready/failed/cancelled/expired, cancellation-race and bounded polling tests with a fake clock.
- [ ] **Step 2:** Test all matching leaves across collapsed/unloaded branches in server group/sort order, same-version output during mutations, zero-row header-only CSV, formatting/exclusion/formula protection, artifact expiry and auth revocation. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Capture query/version/column configuration at start. Pin or atomically materialize that version server-side, stream records into a bounded application-owned artifact sink, and expose download metadata without client byte buffering. Do not silently fall back to latest data. Later Refresh keeps existing job identity; source/auth replacement clears protected controls. Use explicit service storage abstraction and deterministic fixture storage; document required durable production implementation and cleanup TTL.
- [ ] **Step 4:** Run `pnpm --filter @pretable/core exec vitest run src/remote/__tests__/export-controller.test.ts`. Expected: Controller suite passes; also run website export-jobs test. Export count/order equals a full eager oracle while browser residency stays fixed. Unsupported custom serialization fails before job creation.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: implement version-bound remote export jobs`.

### Task 14: Reference routes, export UI and working grouped example

**Files:** Create `apps/website/app/api/docs/remote/route.ts`, `apps/website/app/api/docs/remote-export/route.ts`; create `apps/website/content/examples/remote-grouped/{example.ts,demo.tsx,columns.ts,RemoteGroupedGrid.tsx,provider.ts}`; create `packages/react/src/remote/export-controls.tsx` and its tests; create `apps/website/e2e/remote-data.spec.ts`.

- [ ] **Step 1:** Write route validation/authorization tests and UI tests for start/status/cancel/download, stale-origin labels, indeterminate progress and expired links.
- [ ] **Step 2:** Choose an explicit demo persistence model that survives separate requests: use a bounded durable service adapter, or a documented self-contained immutable fixture representation with verifiable session/job handles. Do not treat module globals as durable Next.js storage. Keep artifact bytes on the server/download path. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Wire the actual provider, full grouped grid and export adapter into one example. Show cache/request counters, filtering, sorting, expansion, summaries, explicit Refresh and failure/expiry controls. Demonstrate downloaded CSV includes unloaded/collapsed leaves; protect every job/status/download route and validate fields against trusted registries.
- [ ] **Step 4:** Run `BASE_URL=http://127.0.0.1:3217 pnpm --filter @pretable/app-website smoke e2e/remote-data.spec.ts e2e/server-data.spec.ts`. Expected: Real browser completes grouped browsing and full CSV download; original window example remains functional. No placeholder export callback or unbounded client accumulation qualifies.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `feat: demonstrate grouped remote browsing and server export`.

### Task 15: Public API, package and documentation integration

**Files:** Modify existing core/react API reports, `apps/website/lib/docs/examples/registry.ts` and server-data docs; create `apps/website/content/docs/server-data/remote.mdx`, `.changeset/remote-grouped-datasets.md`; extend `type-tests` remote cases and packed-consumer fixtures.

- [ ] **Step 1:** Add consumer tests importing the new factory and React types from packed packages; test generic column inference and forbidden remote/local/window/write combinations.
- [ ] **Step 2:** Document capability negotiation, exact counts, version retention, lifecycle ownership, cache limits, summary availability, status UI, selection, partial/full export and migration choice. Link manual windowing as supported; do not imply the controller manages existing rows mode. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Update generated docs registry using its existing generation command, API reports using pnpm api after build, and the changeset for public packages actually changed. Preserve release workflow; do not publish during implementation. Review runtime export surface, declaration reachability and any new bundled dependencies.
- [ ] **Step 4:** Run `pnpm build && pnpm api && pnpm api:check && pnpm typecheck:public && pnpm consumer:check`. Expected: Packed consumers and API reports pass; run website unit guards for docs links/navigation/registry and confirm no private type leaks.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `docs: publish grouped remote contracts and examples`.

### Task 16: Accessibility and performance release evidence

**Files:** Create `apps/bench/src/remote-fixture.ts`; modify `apps/bench/src/bench-app.tsx` only for fixture routing; create `apps/bench/tests/remote-memory.spec.ts`, `remote-performance.spec.ts`; create `status/remote-datasets/accessibility.md` and `performance.md`.

- [ ] **Step 1:** Build deterministic 1M/100M logical fixtures at fixed residency, with deep/wide groups, distant seeks, 10,000 expansion/eviction cycles, rapid queries and slow/failing reads. Do not allocate all logical records in the fixture.
- [ ] **Step 2:** Assert payload/ingress/metadata/store/request counts, controller retention after disposal, no request amplification loop and stable anchors. Record browser heap separately from accounted sizes and exclude intentional externally retained snapshots from controller guarantees. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Run quiet-machine workloads with existing 8 ms processing limits and measured-cadence frame gate. Record fill latency separately from network delay, anchor displacement and stale-response drops. Run Chromium/WebKit accessibility trees plus VoiceOver/Safari and NVDA/Firefox loading/Retry/expansion/focus flows; if a platform is unavailable, leave that release gate explicitly incomplete and arrange a human run, never substitute unit assertions.
- [ ] **Step 4:** Run `pnpm bench:e2e apps/bench/tests/remote-datasets.spec.ts apps/bench/tests/remote-memory.spec.ts apps/bench/tests/remote-performance.spec.ts`. Expected: Committed reproducible evidence establishes or adjusts provisional limits without weakening required correctness/processing gates; all screen-reader evidence is observed, not inferred.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `perf: verify grouped remote resource and interaction budgets`.

### Task 17: Final compatibility and release readiness review

**Files:** All touched files; update `status/remote-datasets/acceptance.md`, ROADMAP.md and the plan checkboxes with actual results.

- [ ] **Step 1:** Run legacy layout/renderer/React/window/eviction/server-data suites again on the final combined tree, plus new provider, export and browser suites. Compare original workspace diff to the preserved baseline.
- [ ] **Step 2:** Run pnpm test, pnpm typecheck, pnpm lint, pnpm format, pnpm api:check, pnpm consumer:check and pnpm react:compat after the final build; investigate failures rather than accepting unrelated-looking red gates without evidence. Run the relevant new test before implementation and confirm a behavioral failure (not a missing dependency or broken runner).
- [ ] **Step 3:** Request independent code review using @superpowers:requesting-code-review. Map every design acceptance item to tests/evidence, disclose remaining release gates, create reviewable PRs in dependency order and preserve the existing manual window API. Do not merge/publish without the user authorizing that next action.
- [ ] **Step 4:** Run `git diff --check`. Expected: No whitespace errors; all required evidence and CI checks are green before reporting ready. No claim of completion based only on unit tests or docs formatting.
- [ ] **Step 5:** Review the diff, stage only this task's files and commit as `docs: record remote datasets acceptance evidence`.

## Execution checkpoints

- After Tasks 1–4: review API and provider/layout feasibility evidence before
  shared layout integration. If the approach cannot satisfy variable heights,
  exact projection or versioned export, revise the technical design explicitly.
- After Tasks 5–9: headless correctness and unchanged legacy layout are required.
- After Tasks 10–14: review the working grouped browsing and complete export UX.
- After Tasks 15–17: review release evidence; implementation is not complete while
  any required compatibility, screen-reader, performance or export gate is open.

Implementation can run inline with checkpoint reviews, or via task-scoped agents
with review between tasks. No work has been executed merely by checking in this plan.
