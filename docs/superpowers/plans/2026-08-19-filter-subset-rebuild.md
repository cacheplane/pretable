# Filter Subset Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter-only `setQuery` on ungrouped data settles at TanStack parity (50k: ~240ms → ≤ same-run TanStack ~58ms) via a synchronous subset rebuild that carries unflipped records by identity and never sorts the full set.

**Architecture:** `isFilterOnlyChange` classifier gate → new `packages/row-model/src/filter-rebuild.ts` (verdict diff; O(flipped) record + map updates; merge of surviving visible order with the sorted flipped-in subset; bulk tree build) → wired into `setQuery` beside the sort fast path, publishing an ordinary barrier.

**Spec:** `docs/superpowers/specs/2026-08-19-filter-subset-rebuild-design.md` — read first. Baseline + attribution: scratchpad `filter-baseline.md`.

**Conventions:** as the #457 arc (TDD, mutation-harden, constraints-only comments, prettier/lint/typecheck per commit, verify HEAD before amends, never touch ~/repos/pretable). Branch: `blove/filter-fast-path` off `a438efb0`.

**Grounding facts (verify only if contradicted):** classifier facets live in `classifyQueryDelta` (compiled-query.ts); `isSortOnlyChange` is the pattern to mirror. Sort-rebuild (`sort-rebuild.ts`) shows: guard style, `fillSortKeysFromPrevious` per-row fill, decorated `{record, keys}` entries feeding `createOrderStatisticTreeFromSortedEntries`, `publishCommittedRoot` publish, error semantics. The merged per-row cache entry holds sortKeys (unguarded) + metadata (guarded). `#finalizeMetadata` is the one metadata constructor. Filter predicates run in `evaluate` via `evaluateFilter(filter, column, value)` per active filter — locate and reuse, do not duplicate predicate semantics. `visible.rows` tree entries are `OrderedRowEntry {record, keys}`; in-order walk via `entries()`/`range`. Counters wire through diagnostics.ts (interface + init + reset list).

---

### Task F1: `isFilterOnlyChange` classifier

**Files:** `packages/row-model/src/compiled-query.ts`; test `__tests__/query-delta.test.ts`.

- [ ] TDD: mirror the `isSortOnlyChange` suite — true only when runtime filters differ and nothing else does; false for each other facet changing alongside; false when authorities differ; false under external filter authority both sides (runtime filters empty twice); false for foreign plans. Export `isFilterOnlyChange` beside `isSortOnlyChange`, derived from the same delta.
- [ ] Mutation: flip the derivation to ignore `sortChanged` → a combined sort+filter case must fail.
- [ ] Suite green (413 baseline), commit: `feat(row-model): classify filter-only plan changes`.

### Task F2: `filter-rebuild.ts` — the subset rebuild

**Files:** create `packages/row-model/src/filter-rebuild.ts`; modify `diagnostics.ts` (counters: `filterRebuilds`, `filterRowsFlipped`, `filterMergeSortedInsertions`, and `filterRebuildMs` or reuse — report choice); test `__tests__/filter-fast-path.test.ts` (create).

Signature mirrors `rebuildRootForSortOnlyChange`: `rebuildRootForFilterOnlyChange({captured, nextPlan, revision, now, instrumentation})`. Guards: TypeError unless `isFilterOnlyChange`; TypeError if grouped.

Algorithm (spec Design §subset rebuild — follow it exactly):
- One pass over `captured.sourceOrder.entries()`: per record — `fillSortKeysFromPrevious(nextPlan, captured.queryPlan, record, instrumentation)` (100% carries); compute the NEW verdict via the plan's predicate machinery over the row (reuse `evaluateFilter` + accessor reads — expose a plan-internal `filterVerdict(plan, row)` static+free function if needed; do NOT re-implement predicate semantics); diff vs `record.metadata.filterPasses`.
- Unflipped: carry. Flipped: build the new record through the existing metadata construction (a plan-internal helper that rebuilds metadata with a new `filterPasses` around carried values — the `#finalizeMetadata` seam; keys already in the store). Transient-set flipped rows only; zero flips → rows map carries by identity (pin this).
- Visible: in-order walk of `captured.visible.rows` collecting still-passing entries (reuse entry objects when the record carried; flipped-out skipped); flipped-in rows become fresh decorated entries of their NEW records, sorted among themselves with `compareWithSortKeys` + id tiebreak; single merge (both sequences already strictly sorted by the same total order) → `createOrderStatisticTreeFromSortedEntries`.
- Root: revision/parentRevision/cause as sort-rebuild; `sourceOrder`/`expansion` carried. Instrumentation: counts + wall time.

- [ ] TDD red-first per the spec's Testing list items 2–5 (equivalence incl. filter-to-empty/empty-to-filter/zero-flip; identity; merge fixture with interleaved + tied flip-ins; counters). Cold-model oracles throughout; fixture controls asserted (flip-ins interleave, tie pair's source order opposes id order).
- [ ] Mutations: (a) merge order broken (append instead of merge) → bulk constructor throw or equivalence fail; (b) rebuild ALL records → identity test fails; (c) verdict diff inverted → equivalence fails.
- [ ] Suite green, typecheck, lint, prettier. Commit: `feat(row-model): synchronous subset rebuild for filter-only changes`.

### Task F3: wire into `setQuery`

**Files:** `packages/row-model/src/create-local-row-model.ts`; test `__tests__/filter-fast-path.test.ts`.

- [ ] Branch beside the sort fast path (after it, same shape): `isFilterOnlyChange && ungrouped` → cancelActive("superseded"), rebuild, `publishCommittedRoot(root, prev, rev)` (default barrier reason — NOT "reorder"), resolved transition; error path mirrors the sort branch exactly (shared error-construction helper if extraction is clean — implementer judgment, report).
- [ ] TDD: mirror the sort fast-path model-level suite — synchronous (no scheduler entries), notify-once, supersede in-flight cooperative, accessor/predicate failure shape pinned against the slow path first, recovery, setRows-after behaves, equivalence vs cold model, `changesSince` reports a NORMAL barrier reason (pin "bulk-replace", NOT "reorder" — a wrong reorder here would corrupt the renderer; this is the highest-stakes assertion in the cycle, mutation-verify it: publish "reorder" → the test must fail).
- [ ] Existing cooperative-path tests that used filter-only changes as their subject vehicle now take the fast path — same edit discipline as cycle-1 Task 5 (justify each; keep cooperative subjects on cooperative changes, e.g. sort+filter combined).
- [ ] Full package suite green; root build+typecheck. Commit: `feat(row-model): filter-only setQuery completes synchronously on flat queries`.

### Task F4: verification

- [ ] Full repo: build, typecheck, lint, test, api (no report drift expected — nothing public changes).
- [ ] Bench protocol (filter-baseline.md method): both filter scripts × both scales × both adapters, repeats 3; PLUS the no-regression sweep: sort both scales, grouped gate (3 quiet runs or the paired-control method if loaded), mount metric. Evaluate the four spec bars.
- [ ] One trace of 50k filter-metadata: confirm the settle tail collapsed and the renderer replacement still runs its cooperative retained-state path.
- [ ] Write `<scratchpad>/filter-cycle-results.md` with verdicts. STOP: merge decision to the user with numbers.

## Self-review notes (applied)

- Spec coverage: classifier → F1; rebuild+counters → F2; wiring+journal pin → F3; bars → F4. Reserve lever and rejected approach have no tasks.
- Names: `isFilterOnlyChange`, `rebuildRootForFilterOnlyChange`, `filterRebuilds`/`filterRowsFlipped`/`filterMergeSortedInsertions`, plan-internal `filterVerdict` (working name; implementer may improve, reporting it).
- The one semantic decision delegated with a pin requirement: zero-flip behavior (new revision, wholesale carry) — F2 decides and pins it; the spec's Testing item 2 names it.
