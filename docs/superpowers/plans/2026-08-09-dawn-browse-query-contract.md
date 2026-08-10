# Dawn Browse Query Contract (Slice 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Dawn's `BrowseQuery`/`BrowsePage` store contract with normalized filters, an exact-namespace field, a whitelisted sort order, an opaque keyset continuation, a shared validator, and snapshot-consistent `rows + total` — implemented identically in the SQLite and Postgres stores and pinned by the shared conformance suite.

**Architecture:** All _decisions that must agree across backends_ (validation, the sort-field whitelist, UTC day buckets, the namespace byte-range successor, the cursor codec and query fingerprint) live as pure modules in `@dawn-ai/memory`, exported from the barrel and from a new bundle-safe `@dawn-ai/memory/browse` subpath. Each store owns only its own SQL dialect (`?` + BINARY collation vs `$n` + `COLLATE "C"` + `::real` casts) through a small per-package SQL builder that is unit-tested as strings. `@dawn-ai/core` keeps a _named_ structural mirror (`BrowseQueryLike`/`BrowsePageLike`) guarded by a compile-time parity tripwire so the drift that shipped in #432 cannot recur.

**Tech Stack:** TypeScript 7.0.2 (ESM, NodeNext), Node 24, `node:sqlite` `DatabaseSync`, `pg` + pgvector (testcontainers `pgvector/pgvector:pg16`), vitest 4.1.10, Biome 2.5.6, changesets (single fixed version group), pnpm 10 + turbo.

---

> **Line anchors in this plan are approximate — locate by symbol, not by number.**
> `origin/main` moved during execution (pretable picked up #264, which added
> ~300 lines to `create-grid-core.ts`), and it will move again — Brian runs
> concurrent sessions. Drift is non-uniform, so no global offset corrects it.
> Every `file:line` below was accurate at authoring time; treat it as a hint and
> confirm by searching for the quoted symbol or code. If a cited line holds
> something unrelated, that is drift, not a missing prerequisite — do not "fix"
> the repo to match the plan.

## Where this file lives, and where the work happens

This plan file was written into the **pretable** worktree
(`/Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a/docs/superpowers/plans/`)
because the dawn checkout at `/Users/blove/repos/dawn` is **dirty and owned by another
session** (branch `blove/docs-heading-anchors`, unrelated `apps/web` changes). Task 1
creates a fresh dawn worktree off `origin/main`; copy this file into that worktree
(`docs/superpowers/plans/`) as the first commit if you want it versioned alongside the code.
**Never run any step of this plan inside `/Users/blove/repos/dawn` itself.**

Design source of truth: `docs/superpowers/specs/2026-08-09-server-controlled-exploration-design.md`
(in the pretable worktree above) — §1.3 baseline correction, §5 the Dawn query model,
§6.2 keyset continuation, §12.2 test strategy, §13 slice 2. Read §5 and §6.2 before Task 3.

---

## Conventions the engineer must follow

Read this section once; every task assumes it.

1. **There is no api-extractor in dawn.** The public surface of a package is exactly
   (a) what its `src/index.ts` barrel exports and (b) its `package.json` `exports` map.
   Adding a type without exporting it from the barrel means external implementors cannot
   see the obligation. There is no report file to regenerate.
2. **Changesets, single fixed version group.** Every `@dawn-ai/*` package moves together
   (`.changeset/config.json` `fixed`). One changeset for the whole slice (Task 18).
3. **Postgres tests are gated.** `DAWN_TEST_PGVECTOR=1` starts a real
   `pgvector/pgvector:pg16` testcontainer. Every behavior task below gives BOTH commands:
   the fast SQLite-only one you iterate on, and the gated Postgres one you MUST run before
   committing that task (CI runs it on every PR — `.github/workflows/ci.yml:209`).
4. **Timestamps are ISO-8601 TEXT compared lexicographically.** Full-ISO-Z
   (`YYYY-MM-DDTHH:MM:SS.sssZ`) is an _invariant_, not a preference: `2026-08-09T00:00:00Z`
   sorts wrong against `2026-08-09T00:00:00.000Z`. The validator enforces it; the Inspector
   route normalizes before validating.
5. **`node:sqlite` `DatabaseSync` is synchronous.** Window functions and row values are
   available, but the design measured and **rejected** `COUNT(*) OVER ()` (it materializes
   the whole filtered set: 439 ms vs 5.3 ms at 1M rows). Use two statements inside one
   transaction.
6. **User input never becomes a SQL identifier.** Sort fields and filter fields resolve
   through whitelist tables (`browse-order.ts`, the `switch` in each SQL builder). Every
   _value_ is a bound parameter. If you find yourself interpolating anything derived from
   `BrowseQuery` into SQL text other than through those whitelists, stop.
7. **Build before you typecheck a dependent.** `@dawn-ai/testing` and
   `@dawn-ai/memory-pgvector` compile against `@dawn-ai/memory`'s **dist**, not its source.
   A stale `dist/` silently typechecks against the old contract. When a task changes types
   in `packages/memory` or `packages/core`, run
   `pnpm turbo run build --filter=@dawn-ai/testing...` before `typecheck`/tests there.
   (`packages/memory`'s own tests import `../src/index.js` and need no build.)
8. **Biome formatting:** double quotes, **no semicolons**, 2-space indent, 100-col width.
   Run `pnpm lint` (or `pnpm lint:fix`) before every commit.
9. **TDD is mandatory and non-negotiable.** Every task writes the failing test first, runs
   it, sees the _named_ failure, then implements. A task ends green with one commit.
10. **Both backends land in the same commit.** The gated Postgres conformance run is part of
    CI, so a task that changes SQLite behavior without the matching Postgres change leaves
    `main` red. Never split them across tasks.

### Command cheat-sheet

```bash
# repo root of the NEW worktree for every command below
cd /Users/blove/repos/dawn/.worktrees/browse-query-contract

# memory unit tests (fast; no build needed)
pnpm --filter @dawn-ai/memory test
pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/<file>.test.ts

# shared conformance against SQLite (needs @dawn-ai/memory built)
pnpm turbo run build --filter=@dawn-ai/testing...
pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts

# same conformance against a real Postgres (docker required)
pnpm turbo run build --filter=@dawn-ai/memory-pgvector...
DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test

# pure Postgres SQL-string tests (no docker)
pnpm --filter @dawn-ai/memory-pgvector exec vitest --run --config vitest.config.ts test/browse-sql.test.ts

# compile-time contract parity
pnpm turbo run build --filter=@dawn-ai/testing...
pnpm --filter @dawn-ai/testing typecheck

# inspector param decoder (jsdom project, no build needed — alias added in Task 16)
pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/browse-params.test.ts

# inspector standalone e2e (builds Next; slow)
pnpm turbo run build --filter=@dawn-ai/inspector...
DAWN_TEST_INSPECTOR=1 pnpm --filter @dawn-ai/inspector test

# whole repo
pnpm lint && pnpm build && pnpm typecheck && pnpm test
```

---

## What is ALREADY DONE — do not re-implement

PR #432 (`fc0ec4f1`) landed before this slice. Task 1 verifies each still holds:

- `BrowseQuery.status` / `.kind` already accept `T | readonly T[]` with **empty-set-matches-nothing**
  semantics (`packages/memory/src/types.ts:54-71`).
- `normalizeSetFilter` in `packages/memory/src/browse-filter.ts` is the shared reading of
  that union; both stores use it (`sqlite-store.ts:442-451`, `pgvector-store.ts:456-467`).
- Five conformance tests pin it (`packages/testing/src/memory-conformance.ts:220-303`).
- The Inspector list route parses repeated params and 400s on any bad value
  (`packages/inspector/app/api/memory/list/route.ts:34-51`).

PR #437 (`95768c3f`, now `origin/main`) additionally merged the Inspector namespace-grouping
UI. It touches no store code; it is slice-4 territory and this plan does not modify it.

---

## File Structure

| File                                                                                                                          | Created / Modified                               | Single responsibility                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `packages/memory/src/types.ts`                                                                                                | Modify (`BrowseQuery` 54-71, `BrowsePage` 72-75) | The public query/page/filter/sort **types**. No logic.                                                                     |
| `packages/memory/src/browse-validate.ts`                                                                                      | Create                                           | `BrowseQueryError` + `validateBrowseQuery` + the numeric bounds. The single reading of "is this query legal".              |
| `packages/memory/src/browse-order.ts`                                                                                         | Create                                           | The sort-field → physical-column **whitelist** and `resolveBrowseOrder`. The only place a sort name becomes an identifier. |
| `packages/memory/src/browse-range.ts`                                                                                         | Create                                           | Pure range math: UTC day buckets and the code-point `succ()` upper bound for namespace prefixes.                           |
| `packages/memory/src/browse-cursor.ts`                                                                                        | Create                                           | Opaque keyset cursor: canonical query fingerprint, base64url codec, sort-key extraction.                                   |
| `packages/memory/src/browse-filter.ts`                                                                                        | Modify                                           | Keeps `normalizeSetFilter` (unchanged).                                                                                    |
| `packages/memory/src/browse.ts`                                                                                               | Create                                           | Barrel for the `@dawn-ai/memory/browse` subpath — pure, bundle-safe, no `node:sqlite`.                                     |
| `packages/memory/src/sqlite-browse-sql.ts`                                                                                    | Create                                           | SQLite dialect: filter clauses (`?`, `instr`, BINARY) and the keyset OR-chain with the redundant leading guard.            |
| `packages/memory/src/sqlite-store.ts`                                                                                         | Modify (migrations 61-95, `browse` 431-486)      | Wire validation, filters, order, keyset, transaction snapshot; migration v4 index.                                         |
| `packages/memory/src/index.ts`                                                                                                | Modify                                           | Barrel: export the new types and functions.                                                                                |
| `packages/memory/package.json`                                                                                                | Modify                                           | Add the `./browse` subpath to `exports`; add `bench` to the lint glob.                                                     |
| `packages/memory/bench/browse-plans.mts`                                                                                      | Create                                           | Reproducible seeded SQLite bench for the §5.5 plan table.                                                                  |
| `packages/memory-pgvector/src/browse-sql.ts`                                                                                  | Create                                           | Postgres dialect: `$n` params, `= ANY(::text[])`, `position()`, `::real` casts, `COLLATE "C"`.                             |
| `packages/memory-pgvector/src/pgvector-store.ts`                                                                              | Modify (`browse` 445-503)                        | Same wiring, on one pooled client inside `REPEATABLE READ`.                                                                |
| `packages/memory-pgvector/src/schema.ts`                                                                                      | Modify (`initSchema` 28-60)                      | Two new idempotent indexes.                                                                                                |
| `packages/core/src/capabilities/types.ts`                                                                                     | Modify (`MemoryStoreLike.browse` 76-92)          | Named `BrowseQueryLike`/`BrowsePageLike`/`BrowseFilterLike`/`BrowseSortEntryLike` mirror.                                  |
| `packages/core/src/index.ts`                                                                                                  | Modify                                           | Export the four new mirror types.                                                                                          |
| `packages/testing/src/memory-conformance.ts`                                                                                  | Modify                                           | The cross-backend contract: every new arm, tied order, cursor walks, snapshot totals.                                      |
| `packages/testing/test/memory-contract-parity.test.ts`                                                                        | Modify                                           | Compile-time tripwire, now covering the query/page types directly.                                                         |
| `packages/inspector/app/api/memory/list/route.ts`                                                                             | Modify                                           | HTTP boundary: decode params, 400 via the shared validator, pass `continuation` through.                                   |
| `packages/inspector/src/store/browse-params.ts`                                                                               | Create                                           | Pure `URLSearchParams → BrowseQuery` decoder (unit-testable without Next).                                                 |
| `packages/inspector/vitest.components.config.ts`                                                                              | Modify                                           | Alias `@dawn-ai/memory/browse` to source so the decoder test needs no build.                                               |
| `packages/inspector/test/components/browse-params.test.ts`                                                                    | Create                                           | Decoder unit tests.                                                                                                        |
| `packages/inspector/test/api.e2e.test.ts`                                                                                     | Modify                                           | Gated HTTP tests for the new params and 400s.                                                                              |
| `packages/memory/test/browse-validate.test.ts`                                                                                | Create                                           | Validator unit tests.                                                                                                      |
| `packages/memory/test/browse-order.test.ts`                                                                                   | Create                                           | Sort whitelist unit tests.                                                                                                 |
| `packages/memory/test/browse-range.test.ts`                                                                                   | Create                                           | Day-bucket + `succ()` unit tests.                                                                                          |
| `packages/memory/test/browse-cursor.test.ts`                                                                                  | Create                                           | Cursor codec + fingerprint unit tests.                                                                                     |
| `packages/memory/test/sqlite-browse-sql.test.ts`                                                                              | Create                                           | SQLite keyset/filter SQL-string tests (pins the redundant guard).                                                          |
| `packages/memory-pgvector/test/browse-sql.test.ts`                                                                            | Create                                           | Postgres keyset/filter SQL-string tests (ungated).                                                                         |
| `packages/memory/test/browse-stats.test.ts`                                                                                   | Modify (line 85)                                 | Existing assertion gains `continuation: null`.                                                                             |
| `packages/cli/test/helpers/fetch-entry-fixture.ts`                                                                            | Modify (line 87)                                 | Fake store returns `continuation`.                                                                                         |
| `packages/cli/test/store-injection.test.ts`                                                                                   | Modify (line 192)                                | Same.                                                                                                                      |
| `packages/cli/test/build-memory-context.test.ts`                                                                              | Modify (line 13)                                 | Same (typed `MemoryStoreLike`).                                                                                            |
| `packages/core/test/memory-capability-{episodic,recall,vector}.test.ts`, `packages/core/test/runtime-env-debug-flags.test.ts` | Modify                                           | Same, four inline fakes.                                                                                                   |
| `packages/cli/test/distill-guards.test.ts`                                                                                    | Modify (line 239)                                | Truncating fake preserves `continuation`.                                                                                  |
| `.changeset/browse-query-contract.md`                                                                                         | Create                                           | Minor changeset; "breaking for `MemoryStore` implementors".                                                                |

---

### Task 1: Fresh worktree off origin/main, verify the baseline

**Files:** none created or modified. Verification only — **this task has no commit.**

- [ ] **Step 1: Confirm the shared checkout is dirty and must not be touched.**
      Run `git -C /Users/blove/repos/dawn status --short | head`. You should see modified
      `apps/web/*` files from another session. Do not stash, commit, or revert anything —
      the stash stack is shared across worktrees. Leave it alone.
- [ ] **Step 2: Fetch and create the worktree.**
      `bash
    git -C /Users/blove/repos/dawn fetch origin
    git -C /Users/blove/repos/dawn worktree add -b blove/dawn-browse-query-contract \
      /Users/blove/repos/dawn/.worktrees/browse-query-contract origin/main
    `
      Expected: `Preparing worktree (new branch 'blove/dawn-browse-query-contract')` followed
      by `HEAD is now at 95768c3f feat(inspector): group the memory list by namespace (#437)`.
      If the commit differs, `origin/main` moved — that is fine, but re-read §1.3 of the
      design and re-run Step 4 carefully.
- [ ] **Step 3: Install dependencies in the new worktree.**
      `cd /Users/blove/repos/dawn/.worktrees/browse-query-contract && pnpm install --frozen-lockfile`
      Expected: `Done in ...`. (Worktrees do not share `node_modules`.)
- [ ] **Step 4: Verify the four #432 facts still hold.** Run each and eyeball the output:
      ``bash
    sed -n '54,71p' packages/memory/src/types.ts        # status/kind are `T | readonly T[]`
    cat packages/memory/src/browse-filter.ts             # normalizeSetFilter exists
    sed -n '220,303p' packages/testing/src/memory-conformance.ts   # 5 set-filter tests
    sed -n '34,51p' packages/inspector/app/api/memory/list/route.ts # parseEnumList + 400
    ``
      If any is missing, STOP — the baseline assumption in §1.3 is wrong and the plan needs
      re-scoping.
- [ ] **Step 5: Confirm the core mirror is still out of sync (the bug this slice closes).**
      `sed -n '76,92p' packages/core/src/capabilities/types.ts`
      Expected: an **anonymous inline** query object with scalar `readonly status?: MemoryStatusLike`
      and `readonly kind?: MemoryKindLike` — i.e. it never learned about #432's sets. This is
      the drift Task 2 makes impossible.
- [ ] **Step 6: Establish a green baseline.**
      `bash
    pnpm build && pnpm typecheck && pnpm --filter @dawn-ai/memory test && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
      Expected: build and typecheck succeed; memory tests all pass; the conformance file
      reports roughly 40 passing tests, 0 failed. Note the exact passing count — later tasks
      only ever add to it.
- [ ] **Step 7: Confirm docker is available for the gated lane.**
      `docker info > /dev/null && echo docker-ok`
      Expected `docker-ok`. If docker is unavailable you cannot complete Tasks 8-15 honestly;
      raise it now rather than committing Postgres code you never ran.

---

### Task 2: Name the core mirror and arm the parity tripwire

The existing parity test (`packages/testing/test/memory-contract-parity.test.ts`) compares
`MemoryStore` to `MemoryStoreLike`. TypeScript checks **method parameters bivariantly**, so a
narrower `browse(q?: …)` parameter in the mirror stays assignable — which is exactly why
#432's `status`/`kind` widening slipped through unnoticed. Comparing the _query type itself_
(not the method that takes it) is invariant enough to catch it.

**Files:**

- Modify: `packages/core/src/capabilities/types.ts` (extract lines 74-92 into named types)
- Modify: `packages/core/src/index.ts` (export block at lines 33-51)
- Modify: `packages/testing/test/memory-contract-parity.test.ts`
- Test: `packages/testing/test/memory-contract-parity.test.ts` via `pnpm --filter @dawn-ai/testing typecheck`

- [ ] **Step 1: Extract the anonymous browse shape into named mirror types.**
      In `packages/core/src/capabilities/types.ts`, immediately **above**
      `export interface MemoryStoreLike {` (line 44), insert:
      ```ts
      /** * Structural mirror of @dawn-ai/memory's `BrowseQuery`. Named (not inlined on * `MemoryStoreLike.browse`) so drift is a one-line diff instead of an invisible * parameter tweak: method parameters are checked BIVARIANTLY, so a narrower inline * shape stays assignable and silently rots. `memory-contract-parity.test.ts` * compares this type directly, which is invariant. Keep in lockstep with * packages/memory/src/types.ts.
      */
      export interface BrowseQueryLike {
      readonly namespacePrefix?: string
      readonly status?: MemoryStatusLike | readonly MemoryStatusLike[]
      readonly kind?: MemoryKindLike | readonly MemoryKindLike[]
      readonly sourceType?: MemorySourceTypeLike
      readonly limit?: number
      readonly offset?: number
      readonly since?: string
      readonly until?: string
      readonly now?: string
      }

      /** Structural mirror of @dawn-ai/memory's `BrowsePage`. See `BrowseQueryLike`. */
          export interface BrowsePageLike {
            readonly records: readonly MemoryRecordLike[]
            readonly total: number
          }
          ```
          Note this already fixes the scalar-`status` rot found in Task 1 Step 5.

- [ ] **Step 2: Point `MemoryStoreLike.browse` at the named types.**
      Replace the whole inline block at lines 74-92 (from the
      `/** Cross-namespace/status listing for inspection UIs. Ordered updated_at DESC, id ASC. */`
      comment through the closing `}>` of the return type) with:
      `ts
      /** Cross-namespace/status listing for inspection UIs. Ordered updated_at DESC, id ASC. */
      browse(q?: BrowseQueryLike): Promise<BrowsePageLike>
    `
- [ ] **Step 3: Export the mirror types from the core barrel.**
      In `packages/core/src/index.ts`, inside the `export type { … } from "./capabilities/types.js"`
      block (starts line 33), add `BrowsePageLike,` and `BrowseQueryLike,` in alphabetical
      position — i.e. before `CapabilityContribution,`.
- [ ] **Step 4: Add the direct type-level parity assertions.**
      In `packages/testing/test/memory-contract-parity.test.ts`, extend the imports and the
      assertions so the file reads:
      ```ts
      import type {
      BrowsePageLike,
      BrowseQueryLike,
      MemoryKindLike,
      MemorySourceTypeLike,
      MemoryStatusLike,
      MemoryStoreLike,
      } from "@dawn-ai/core"
      import type {
      BrowsePage,
      BrowseQuery,
      MemoryKind,
      MemorySource,
      MemoryStatus,
      MemoryStore,
      } from "@dawn-ai/memory"
      import { expect, it } from "vitest"

      type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never

          const kind: Mutual<MemoryKind, MemoryKindLike> = true
          const status: Mutual<MemoryStatus, MemoryStatusLike> = true
          const sourceType: Mutual<MemorySource["type"], MemorySourceTypeLike> = true
          const store: Mutual<MemoryStore, MemoryStoreLike> = true
          // The store-level check above is NOT enough on its own: `browse(q?: …)` is a method,
          // and TypeScript checks method parameters bivariantly — a mirror that forgot a union
          // member (as it did for #432's status/kind sets) stays assignable. Comparing the query
          // and page types DIRECTLY is invariant, so drift fails here instead of in production.
          const browseQuery: Mutual<BrowseQuery, BrowseQueryLike> = true
          const browsePage: Mutual<BrowsePage, BrowsePageLike> = true

          it("memory/core store contracts are mutually assignable (compile-time)", () => {
            expect([kind, status, sourceType, store, browseQuery, browsePage]).toEqual([
              true,
              true,
              true,
              true,
              true,
              true,
            ])
          })
          ```

- [ ] **Step 5: Build and typecheck — expect GREEN.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && pnpm --filter @dawn-ai/testing typecheck
    `
      Expected: no output, exit 0. (Green here only means the mirror currently matches.)
- [ ] **Step 6: Prove the tripwire actually fires.** Temporarily add a field to the real
      query type — in `packages/memory/src/types.ts`, inside `BrowseQuery` (after line 55),
      insert `readonly namespace?: string`. Then re-run:
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && pnpm --filter @dawn-ai/testing typecheck
    `
      Expected: a compile error in `test/memory-contract-parity.test.ts` on the
      `const browseQuery: Mutual<BrowseQuery, BrowseQueryLike> = true` line, of the form
      `Type 'boolean' is not assignable to type 'never'`. If it compiles, the tripwire is
      inert — stop and fix it before continuing.
- [ ] **Step 7: Revert the temporary field.** Remove the `readonly namespace?: string` line
      you just added to `packages/memory/src/types.ts` and re-run the command from Step 5.
      Expected: exit 0 again. Confirm with `git diff --stat packages/memory` → no output.
- [ ] **Step 8: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/core/src/capabilities/types.ts packages/core/src/index.ts \
      packages/testing/test/memory-contract-parity.test.ts
      git commit -m "refactor(core): name the BrowseQuery/BrowsePage structural mirror

The inline browse shape on MemoryStoreLike drifted silently in #432: method
parameters are checked bivariantly, so a mirror that never learned about the
status/kind sets stayed assignable. Name the types and compare them directly in
the parity tripwire, where drift is invariant and fails at typecheck."
```

---

### Task 3: Extend the query and page types (and repair every implementor)

This task is types-only: no store _behavior_ changes yet. `continuation` is a **required**
field on `BrowsePage`, so every fake store in the repo must be updated in the same commit or
`pnpm typecheck` is red.

**Files:**

- Modify: `packages/memory/src/types.ts` (lines 54-75)
- Modify: `packages/memory/src/index.ts` (type export block, lines 45-57)
- Modify: `packages/core/src/capabilities/types.ts` (the mirror added in Task 2)
- Modify: `packages/core/src/index.ts`
- Modify: `packages/memory/src/sqlite-store.ts:485` and `packages/memory-pgvector/src/pgvector-store.ts:499-502`
- Modify: `packages/testing/src/memory-conformance.ts:350`, `:395`
- Modify: `packages/memory/test/browse-stats.test.ts:85`
- Modify: `packages/cli/test/helpers/fetch-entry-fixture.ts:87`, `packages/cli/test/store-injection.test.ts:192`, `packages/cli/test/build-memory-context.test.ts:13`, `packages/cli/test/distill-guards.test.ts:239`
- Modify: `packages/core/test/memory-capability-episodic.test.ts:43`, `packages/core/test/memory-capability-recall.test.ts:26`, `packages/core/test/memory-capability-vector.test.ts:54`, `packages/core/test/runtime-env-debug-flags.test.ts:40`
- Test: `pnpm --filter @dawn-ai/testing typecheck` (the parity tripwire drives this task)

- [ ] **Step 1: Add the filter and sort types.** In `packages/memory/src/types.ts`, directly
      above `export interface BrowseQuery {` (line 54), insert:
      ```ts
      /** Sortable browse fields. A CLOSED whitelist: these are the only names that ever * reach a SQL identifier position (see browse-order.ts). */
      export type BrowseSortField =
      | "updatedAt"
      | "createdAt"
      | "confidence"
      | "namespace"
      | "kind"
      | "status"

      export interface BrowseSortEntry {
            readonly field: BrowseSortField
            readonly dir: "asc" | "desc"
          }

          /** One normalized predicate. AND-combined with the other filters and with the
           *  top-level shorthand fields. At most ONE filter per `field` (mirrors the
           *  one-filter-per-column model of the grid that drives this API); within-field
           *  multi-value exists only through `in`/`notIn`. */
          export type BrowseFilter =
            | {
                readonly field: "status" | "kind"
                readonly op: "in" | "notIn"
                readonly values: readonly string[]
              }
            | {
                readonly field: "content"
                readonly op:
                  | "contains"
                  | "notContains"
                  | "equals"
                  | "notEquals"
                  | "startsWith"
                  | "endsWith"
                readonly value: string
              }
            | {
                readonly field: "namespace"
                readonly op: "equals" | "startsWith"
                readonly value: string
              }
            | {
                readonly field: "confidence"
                readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
                readonly value: number
              }
            | {
                readonly field: "confidence"
                readonly op: "between"
                readonly min: number
                readonly max: number
              }
            | {
                readonly field: "updatedAt"
                readonly op: "onDay" | "beforeDay" | "afterDay"
                /** "YYYY-MM-DD", interpreted as a UTC day. */
                readonly day: string
              }
            | {
                readonly field: "updatedAt"
                readonly op: "betweenDays"
                /** Inclusive of both UTC days. */
                readonly fromDay: string
                readonly untilDay: string
              }
          ```

- [ ] **Step 2: Extend `BrowseQuery`.** Inside `export interface BrowseQuery { … }`, after
      the existing `readonly now?: string` (line 66), add:
      ``ts
      /** EXACT namespace. Distinct from `namespacePrefix`: byte-exact, case-sensitive,
       *  no prefix semantics. ANDed with everything else. */
      readonly namespace?: string
      /** AND-combined normalized predicates; at most one per field, at most 8 total. */
      readonly filters?: readonly BrowseFilter[]
      /** Applied in order, always terminated server-side by an `id ASC` tie-break so
       *  every window is deterministic. Absent or empty = `updatedAt DESC`. */
      readonly orderBy?: readonly BrowseSortEntry[]
      /** Opaque continuation from a prior `BrowsePage`. Belongs to the query that
       *  produced it: the store recomputes the fingerprint and rejects a mismatch. */
      readonly cursor?: string
    ``
- [ ] **Step 3: Extend `BrowsePage`.** Replace lines 72-75 with:
      ``ts
    export interface BrowsePage {
      readonly records: readonly MemoryRecord[]
      /** Exact count of the whole matching set — NOT of this window, and NOT reduced by
       *  a `cursor`. Read from the same transaction snapshot as `records`. */
      readonly total: number
      /** Opaque keyset continuation, or null when this window did not fill `limit`.
       *  A continuation is issued whenever the page filled, so following the last one
       *  may legitimately return zero rows. */
      readonly continuation: string | null
    }
    ``
- [ ] **Step 4: Export the new types from the memory barrel.** In
      `packages/memory/src/index.ts`, in the `export type { … } from "./types.js"` block,
      add `BrowseFilter,`, `BrowseSortEntry,` and `BrowseSortField,` in alphabetical order
      (after `BrowseQuery,`).
- [ ] **Step 5: See the tripwire fail.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && pnpm --filter @dawn-ai/testing typecheck
    `
      Expected: the build of `@dawn-ai/memory` succeeds, then typecheck fails in
      `test/memory-contract-parity.test.ts` on **both** `browseQuery` and `browsePage`
      (`Type 'boolean' is not assignable to type 'never'`). This is the drift guard doing
      its job.
- [ ] **Step 6: Mirror the new shape into core.** In
      `packages/core/src/capabilities/types.ts`, above `BrowseQueryLike`, add:
      ```ts
      /** Mirror of @dawn-ai/memory's `BrowseSortField`. */
      export type BrowseSortFieldLike =
      | "updatedAt"
      | "createdAt"
      | "confidence"
      | "namespace"
      | "kind"
      | "status"

      /** Mirror of @dawn-ai/memory's `BrowseSortEntry`. */
          export interface BrowseSortEntryLike {
            readonly field: BrowseSortFieldLike
            readonly dir: "asc" | "desc"
          }

          /** Mirror of @dawn-ai/memory's `BrowseFilter`. */
          export type BrowseFilterLike =
            | {
                readonly field: "status" | "kind"
                readonly op: "in" | "notIn"
                readonly values: readonly string[]
              }
            | {
                readonly field: "content"
                readonly op:
                  | "contains"
                  | "notContains"
                  | "equals"
                  | "notEquals"
                  | "startsWith"
                  | "endsWith"
                readonly value: string
              }
            | {
                readonly field: "namespace"
                readonly op: "equals" | "startsWith"
                readonly value: string
              }
            | {
                readonly field: "confidence"
                readonly op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
                readonly value: number
              }
            | {
                readonly field: "confidence"
                readonly op: "between"
                readonly min: number
                readonly max: number
              }
            | {
                readonly field: "updatedAt"
                readonly op: "onDay" | "beforeDay" | "afterDay"
                readonly day: string
              }
            | {
                readonly field: "updatedAt"
                readonly op: "betweenDays"
                readonly fromDay: string
                readonly untilDay: string
              }
          ```
          Then add to `BrowseQueryLike`, after `readonly now?: string`:
          ```ts
            readonly namespace?: string
            readonly filters?: readonly BrowseFilterLike[]
            readonly orderBy?: readonly BrowseSortEntryLike[]
            readonly cursor?: string
          ```
          and to `BrowsePageLike`, after `readonly total: number`:
          ```ts
            readonly continuation: string | null
          ```

- [ ] **Step 7: Export the new mirror types.** In `packages/core/src/index.ts`, add
      `BrowseFilterLike,`, `BrowseSortEntryLike,` and `BrowseSortFieldLike,` to the same
      `export type { … } from "./capabilities/types.js"` block, alphabetically.
- [ ] **Step 8: Make both stores return `continuation`.** In
      `packages/memory/src/sqlite-store.ts:485`, change
      `return { records: rows.map(rowToRecord), total }` to
      `return { records: rows.map(rowToRecord), total, continuation: null }`.
      In `packages/memory-pgvector/src/pgvector-store.ts:499-502`, add
      `continuation: null,` after the `total:` line. (Real cursors arrive in Task 14; a
      store that never fills `limit` legitimately returns null, and nothing reads it yet.)
- [ ] **Step 9: Repair the exact-equality assertions.** Three places compare a whole page: - `packages/testing/src/memory-conformance.ts:350` →
      `expect(await s.browse()).toEqual({ records: [], total: 0, continuation: null })` - `packages/testing/src/memory-conformance.ts:395` →
      `expect(await s.browse({ namespacePrefix: "Route=/X" })).toEqual({ records: [], total: 0, continuation: null })` - `packages/memory/test/browse-stats.test.ts:85` → same shape as the first.
- [ ] **Step 10: Repair the eight fake stores.** Add `continuation: null` to each returned
      page literal: - `packages/cli/test/helpers/fetch-entry-fixture.ts:87` - `packages/cli/test/store-injection.test.ts:192` - `packages/cli/test/build-memory-context.test.ts:13` - `packages/core/test/memory-capability-episodic.test.ts:43` - `packages/core/test/memory-capability-recall.test.ts:26` - `packages/core/test/memory-capability-vector.test.ts:54` - `packages/core/test/runtime-env-debug-flags.test.ts:40` - `packages/cli/test/distill-guards.test.ts:239` — this one wraps a real page, so keep
      its `total` override and thread the real continuation:
      `return { records: page.records, total: 10_002, continuation: page.continuation }`
- [ ] **Step 11: Typecheck the whole repo — expect GREEN.**
      `bash
    pnpm build && pnpm typecheck
    `
      Expected: exit 0. If `@dawn-ai/inspector` fails on `ListResponse`, note it — that
      interface (`packages/inspector/src/components/memory/list-page.tsx:15`) is a local
      shape, not `BrowsePage`, and must stay untouched in this slice; it only breaks if you
      widened it by mistake.
- [ ] **Step 12: Run the affected suites.**
      `bash
    pnpm --filter @dawn-ai/memory test && \
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts && \
    pnpm --filter @dawn-ai/cli test && pnpm --filter @dawn-ai/core test
    `
      Expected: all green, same test counts as Task 1 Step 6.
- [ ] **Step 13: Lint and commit.**
      ```bash
      pnpm lint
      git add -A
      git commit -m "feat(memory): extend BrowseQuery with filters/orderBy/cursor and BrowsePage with continuation

Types only — no store behavior yet. continuation is required rather than
optional so every implementor is forced to answer 'is there more?', which is
what the load-more consumer needs; the eight in-repo fakes are updated in the
same commit. The core mirror moves in lockstep, enforced by the parity tripwire."
```

---

### Task 4: The shared validator

**Files:**

- Create: `packages/memory/src/browse-validate.ts`
- Create: `packages/memory/test/browse-validate.test.ts`
- Test: `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-validate.test.ts`

> **Judgment call to review:** §11 of the design says the 1..1000 `limit` ceiling is
> "route- and store-clamped". A hard store-side ceiling would silently truncate
> `packages/cli/src/lib/memory/distill.ts:379`, which browses with `limit: 10_000`
> (`MAX_SCAN_RECORDS`) and then does offset arithmetic against `total` — a real regression in
> consolidation. So `validateBrowseQuery` enforces the ceiling **only when a `maxLimit` is
> supplied**, and the Inspector HTTP route (the untrusted boundary, Task 16) supplies
> `BROWSE_MAX_LIMIT`. In-process first-party callers stay exempt. Everything else in §5.3 is
> enforced everywhere.

- [ ] **Step 1: Write the failing test file.** Create
      `packages/memory/test/browse-validate.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest"
      import {
      BROWSE_MAX_LIMIT,
      BrowseQueryError,
      validateBrowseQuery,
      } from "../src/browse-validate.js"
      import type { BrowseQuery } from "../src/types.js"

      const ok = (q: BrowseQuery, opts?: { maxLimit?: number }) =>
            expect(() => validateBrowseQuery(q, opts)).not.toThrow()
          const bad = (q: BrowseQuery, match: RegExp, opts?: { maxLimit?: number }) =>
            expect(() => validateBrowseQuery(q, opts)).toThrow(match)

          describe("validateBrowseQuery — bounds", () => {
            it("accepts an empty query", () => ok({}))
            it("rejects a non-integer or sub-1 limit", () => {
              bad({ limit: 0 }, /limit must be an integer >= 1/)
              bad({ limit: 1.5 }, /limit must be an integer >= 1/)
              bad({ limit: Number.NaN }, /limit must be an integer >= 1/)
            })
            it("enforces the ceiling only when the caller supplies one", () => {
              ok({ limit: 10_000 })
              bad({ limit: BROWSE_MAX_LIMIT + 1 }, /limit must be at most 1000/, {
                maxLimit: BROWSE_MAX_LIMIT,
              })
              ok({ limit: BROWSE_MAX_LIMIT }, { maxLimit: BROWSE_MAX_LIMIT })
            })
            it("rejects a negative offset", () => bad({ offset: -1 }, /offset must be an integer >= 0/))
            it("rejects a cursor combined with a non-zero offset", () => {
              ok({ cursor: "abc", offset: 0 })
              bad({ cursor: "abc", offset: 10 }, /cursor and a non-zero offset/)
            })
            it("rejects an oversized cursor", () => bad({ cursor: "x".repeat(4097) }, /at most 4096/))
            it("rejects an oversized string value", () =>
              bad({ namespace: "n".repeat(1025) }, /namespace must be at most 1024 bytes/))
          })

          describe("validateBrowseQuery — instants and enums", () => {
            it("requires full ISO-Z instants", () => {
              ok({ since: "2026-08-09T00:00:00.000Z" })
              bad({ since: "2026-08-09T00:00:00Z" }, /since must be a full ISO-8601 UTC instant/)
              bad({ until: "2026-08-09" }, /until must be a full ISO-8601 UTC instant/)
              bad({ now: "not-a-date" }, /now must be a full ISO-8601 UTC instant/)
            })
            it("rejects unknown status/kind/sourceType values instead of matching zero rows", () => {
              bad({ status: "bogus" as never }, /invalid status "bogus"/)
              bad({ kind: ["semantic", "nope"] as never }, /invalid kind "nope"/)
              bad({ sourceType: "ghost" as never }, /invalid sourceType "ghost"/)
            })
            it("accepts an empty set (it means 'match nothing', not 'invalid')", () => ok({ status: [] }))
          })

          describe("validateBrowseQuery — filters", () => {
            it("rejects unknown fields and ops", () => {
              bad({ filters: [{ field: "tags", op: "in", values: ["a"] }] as never }, /unknown filter field "tags"/)
              bad({ filters: [{ field: "content", op: "isEmpty" }] as never }, /unknown op "isEmpty" for filter field "content"/)
            })
            it("caps the filter count and forbids two filters on one field", () => {
              const one = { field: "content", op: "contains", value: "x" } as const
              bad({ filters: [one, { field: "content", op: "equals", value: "y" }] }, /at most one filter per field; "content" appears twice/)
              bad({ filters: Array.from({ length: 9 }, () => one) }, /at most 8 filters/)
            })
            it("requires a non-empty, domain-valid value list for in/notIn", () => {
              ok({ filters: [{ field: "status", op: "in", values: ["active"] }] })
              bad({ filters: [{ field: "status", op: "in", values: [] }] }, /status values must not be empty/)
              bad({ filters: [{ field: "kind", op: "notIn", values: ["nope"] }] }, /invalid kind "nope"/)
            })
            it("requires non-empty text values", () => {
              bad({ filters: [{ field: "content", op: "contains", value: "" }] }, /content value must not be empty/)
              bad({ filters: [{ field: "namespace", op: "startsWith", value: "" }] }, /namespace value must not be empty/)
            })
            it("requires finite confidence numbers and an ordered between range", () => {
              ok({ filters: [{ field: "confidence", op: "gte", value: 0.5 }] })
              bad({ filters: [{ field: "confidence", op: "gte", value: Number.POSITIVE_INFINITY }] }, /confidence value must be a finite number/)
              ok({ filters: [{ field: "confidence", op: "between", min: 0.1, max: 0.9 }] })
              bad({ filters: [{ field: "confidence", op: "between", min: 0.9, max: 0.1 }] }, /confidence between requires min <= max/)
            })
            it("requires real YYYY-MM-DD days in order", () => {
              ok({ filters: [{ field: "updatedAt", op: "onDay", day: "2026-08-09" }] })
              bad({ filters: [{ field: "updatedAt", op: "onDay", day: "2026-8-9" }] }, /updatedAt day must be a "YYYY-MM-DD" UTC day/)
              bad({ filters: [{ field: "updatedAt", op: "onDay", day: "2026-02-30" }] }, /is not a real calendar day/)
              bad({ filters: [{ field: "updatedAt", op: "betweenDays", fromDay: "2026-08-09", untilDay: "2026-08-01" }] }, /updatedAt betweenDays requires fromDay <= untilDay/)
            })
          })

          describe("validateBrowseQuery — orderBy", () => {
            it("accepts whitelisted fields and directions", () =>
              ok({ orderBy: [{ field: "confidence", dir: "desc" }, { field: "namespace", dir: "asc" }] }))
            it("rejects unknown fields, bad directions, duplicates and overlong lists", () => {
              bad({ orderBy: [{ field: "content", dir: "asc" }] as never }, /unknown sort field "content"/)
              bad({ orderBy: [{ field: "kind", dir: "sideways" }] as never }, /sort direction must be "asc" or "desc"/)
              bad({ orderBy: [{ field: "kind", dir: "asc" }, { field: "kind", dir: "desc" }] }, /orderBy repeats the field "kind"/)
              bad(
                {
                  orderBy: [
                    { field: "kind", dir: "asc" },
                    { field: "status", dir: "asc" },
                    { field: "namespace", dir: "asc" },
                    { field: "confidence", dir: "asc" },
                  ],
                },
                /at most 3 orderBy entries/,
              )
            })
          })

          describe("BrowseQueryError", () => {
            it("is throwable, named, and carries a code", () => {
              try {
                validateBrowseQuery({ limit: 0 })
                expect.unreachable("should have thrown")
              } catch (error) {
                expect(error).toBeInstanceOf(BrowseQueryError)
                expect((error as BrowseQueryError).name).toBe("BrowseQueryError")
                expect((error as BrowseQueryError).code).toBe("invalid-query")
              }
            })
          })
          ```

- [ ] **Step 2: Run it and watch it fail for the right reason.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-validate.test.ts`
      Expected: `Error: Failed to load url ../src/browse-validate.js` (module does not exist yet).
- [ ] **Step 3: Create the validator module — header and constants.** Create
      `packages/memory/src/browse-validate.ts`:
      ```ts
      import type { BrowseQuery, BrowseSortField, MemoryKind, MemorySource, MemoryStatus } from "./types.js"

      /** Largest `limit` the UNTRUSTED boundary accepts. Enforced only when a caller passes
           *  `maxLimit` — in-process callers (the CLI's 10 000-row consolidation scan) are
           *  trusted and exempt; the HTTP route is not. */
          export const BROWSE_MAX_LIMIT = 1000
          /** Applied by the stores when `limit` is absent. */
          export const BROWSE_DEFAULT_LIMIT = 50

          const MAX_STRING_BYTES = 1024
          const MAX_CURSOR_CHARS = 4096
          const MAX_FILTERS = 8
          const MAX_ORDER_BY = 3

          export const BROWSE_SORT_FIELDS = [
            "updatedAt",
            "createdAt",
            "confidence",
            "namespace",
            "kind",
            "status",
          ] as const satisfies readonly BrowseSortField[]

          const STATUSES: readonly MemoryStatus[] = ["candidate", "active", "superseded"]
          const KINDS: readonly MemoryKind[] = ["semantic", "episodic", "procedural", "reflection"]
          const SOURCE_TYPES: readonly MemorySource["type"][] = ["run", "user", "tool", "eval", "human"]
          const FILTER_FIELDS = ["status", "kind", "content", "namespace", "confidence", "updatedAt"] as const
          const CONTENT_OPS = ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"] as const
          const NAMESPACE_OPS = ["equals", "startsWith"] as const
          const CONFIDENCE_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "between"] as const
          const UPDATED_AT_OPS = ["onDay", "beforeDay", "afterDay", "betweenDays"] as const
          const SET_OPS = ["in", "notIn"] as const

          const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
          const DAY = /^\d{4}-\d{2}-\d{2}$/

          /** Every rejection this module raises. The Inspector maps it to 400 `{error}`; the
           *  stores let it propagate, so a bad query fails loudly instead of silently matching
           *  zero rows. */
          export class BrowseQueryError extends Error {
            readonly code: string
            constructor(message: string, code = "invalid-query") {
              super(message)
              this.name = "BrowseQueryError"
              this.code = code
            }
          }

          function fail(message: string): never {
            throw new BrowseQueryError(message)
          }
          ```

- [ ] **Step 4: Add the primitive checkers.** Append to the same file:
      ```ts
      function checkString(value: unknown, label: string): void {
      if (typeof value !== "string") fail(`${label} must be a string`)
      if (value.length === 0) fail(`${label} must not be empty`)
      if (new TextEncoder().encode(value).length > MAX_STRING_BYTES)
      fail(`${label} must be at most ${MAX_STRING_BYTES} bytes`)
      }

      function checkFinite(value: unknown, label: string): void {
            if (typeof value !== "number" || !Number.isFinite(value))
              fail(`${label} must be a finite number`)
          }

          function checkInstant(value: unknown, label: string): void {
            // Full-ISO-Z only: the stores compare these TEXT columns lexicographically, so a
            // shorter or offset form silently windows wrong rather than failing.
            if (typeof value !== "string" || !ISO_Z.test(value))
              fail(`${label} must be a full ISO-8601 UTC instant ("YYYY-MM-DDTHH:MM:SS.sssZ")`)
          }

          function checkDay(value: unknown, label: string): void {
            if (typeof value !== "string" || !DAY.test(value))
              fail(`${label} must be a "YYYY-MM-DD" UTC day`)
            const parsed = Date.parse(`${value}T00:00:00.000Z`)
            if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value)
              fail(`${label} "${value}" is not a real calendar day`)
          }

          function checkEnumList(value: unknown, allowed: readonly string[], label: string): void {
            const values = typeof value === "string" ? [value] : value
            if (!Array.isArray(values)) fail(`${label} must be a value or an array of values`)
            for (const entry of values) {
              if (typeof entry !== "string" || !allowed.includes(entry))
                fail(`invalid ${label} ${JSON.stringify(entry)} (expected one of: ${allowed.join(", ")})`)
            }
          }
          ```

- [ ] **Step 5: Add the per-filter validator.** Append:
      ```ts
      function checkOp(op: unknown, allowed: readonly string[], field: string): string {
      if (typeof op !== "string" || !allowed.includes(op))
      fail(`unknown op ${JSON.stringify(op)} for filter field "${field}" (expected one of: ${allowed.join(", ")})`)
      return op
      }

      function validateFilter(raw: unknown, seen: Set<string>): void {
            const filter = raw as Record<string, unknown>
            const field = filter?.field
            if (typeof field !== "string" || !(FILTER_FIELDS as readonly string[]).includes(field))
              fail(`unknown filter field ${JSON.stringify(field)} (expected one of: ${FILTER_FIELDS.join(", ")})`)
            if (seen.has(field)) fail(`at most one filter per field; "${field}" appears twice`)
            seen.add(field)
            switch (field) {
              case "status":
              case "kind": {
                checkOp(filter.op, SET_OPS, field)
                const values = filter.values
                if (!Array.isArray(values)) fail(`${field} values must be an array`)
                // An empty list can only be a bug: an inactive filter is never sent.
                if (values.length === 0) fail(`${field} values must not be empty`)
                checkEnumList(values, field === "status" ? STATUSES : KINDS, field)
                return
              }
              case "content": {
                checkOp(filter.op, CONTENT_OPS, field)
                checkString(filter.value, "content value")
                return
              }
              case "namespace": {
                checkOp(filter.op, NAMESPACE_OPS, field)
                checkString(filter.value, "namespace value")
                return
              }
              case "confidence": {
                const op = checkOp(filter.op, CONFIDENCE_OPS, field)
                if (op === "between") {
                  checkFinite(filter.min, "confidence min")
                  checkFinite(filter.max, "confidence max")
                  if ((filter.min as number) > (filter.max as number))
                    fail("confidence between requires min <= max")
                  return
                }
                checkFinite(filter.value, "confidence value")
                return
              }
              default: {
                const op = checkOp(filter.op, UPDATED_AT_OPS, field)
                if (op === "betweenDays") {
                  checkDay(filter.fromDay, "updatedAt fromDay")
                  checkDay(filter.untilDay, "updatedAt untilDay")
                  if ((filter.fromDay as string) > (filter.untilDay as string))
                    fail("updatedAt betweenDays requires fromDay <= untilDay")
                  return
                }
                checkDay(filter.day, "updatedAt day")
              }
            }
          }
          ```
          Note the day comparison is a plain string compare — `YYYY-MM-DD` is uniform-width
          ASCII, so lexicographic order *is* chronological order.

- [ ] **Step 6: Add the entry point.** Append:
      ``ts
    /**
     * The single reading of "is this browse query legal". Runs at the Inspector HTTP
     * boundary (mapped to 400) and defensively inside every store (thrown). Pass
     * `maxLimit` at untrusted boundaries only — see BROWSE_MAX_LIMIT.
     */
    export function validateBrowseQuery(
      query: BrowseQuery,
      opts: { readonly maxLimit?: number } = {},
    ): void {
      // The query may arrive from JSON, so every field is treated as unknown.
      const q = query as Record<string, unknown>
      if (q.limit !== undefined) {
        if (!Number.isInteger(q.limit) || (q.limit as number) < 1)
          fail("limit must be an integer >= 1")
        if (opts.maxLimit !== undefined && (q.limit as number) > opts.maxLimit)
          fail(`limit must be at most ${opts.maxLimit}`)
      }
      if (q.offset !== undefined && (!Number.isInteger(q.offset) || (q.offset as number) < 0))
        fail("offset must be an integer >= 0")
      if (q.cursor !== undefined) {
        if (typeof q.cursor !== "string" || q.cursor.length === 0)
          fail("cursor must be a non-empty string")
        if (q.cursor.length > MAX_CURSOR_CHARS)
          fail(`cursor must be at most ${MAX_CURSOR_CHARS} characters`)
        if (q.offset !== undefined && q.offset !== 0)
          fail("cursor and a non-zero offset cannot be combined — a keyset continuation already carries the position")
      }
      if (q.namespace !== undefined) checkString(q.namespace, "namespace")
      if (q.namespacePrefix !== undefined) checkString(q.namespacePrefix, "namespacePrefix")
      if (q.since !== undefined) checkInstant(q.since, "since")
      if (q.until !== undefined) checkInstant(q.until, "until")
      if (q.now !== undefined) checkInstant(q.now, "now")
      if (q.status !== undefined) checkEnumList(q.status, STATUSES, "status")
      if (q.kind !== undefined) checkEnumList(q.kind, KINDS, "kind")
      if (q.sourceType !== undefined) checkEnumList(q.sourceType, SOURCE_TYPES, "sourceType")
      if (q.filters !== undefined) {
        if (!Array.isArray(q.filters)) fail("filters must be an array")
        if (q.filters.length > MAX_FILTERS) fail(`at most ${MAX_FILTERS} filters`)
        const seen = new Set<string>()
        for (const filter of q.filters) validateFilter(filter, seen)
      }
      if (q.orderBy !== undefined) {
        if (!Array.isArray(q.orderBy)) fail("orderBy must be an array")
        if (q.orderBy.length > MAX_ORDER_BY) fail(`at most ${MAX_ORDER_BY} orderBy entries`)
        const seenFields = new Set<string>()
        for (const raw of q.orderBy) {
          const entry = raw as Record<string, unknown>
          const field = entry?.field
          if (typeof field !== "string" || !(BROWSE_SORT_FIELDS as readonly string[]).includes(field))
            fail(`unknown sort field ${JSON.stringify(field)} (expected one of: ${BROWSE_SORT_FIELDS.join(", ")})`)
          if (entry.dir !== "asc" && entry.dir !== "desc")
            fail(`sort direction must be "asc" or "desc", got ${JSON.stringify(entry.dir)}`)
          if (seenFields.has(field)) fail(`orderBy repeats the field "${field}"`)
          seenFields.add(field)
        }
      }
    }
    ``
- [ ] **Step 7: Run the test and see it pass.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-validate.test.ts`
      Expected: `Test Files 1 passed`, all cases green.
- [ ] **Step 8: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/browse-validate.ts packages/memory/test/browse-validate.test.ts
      git commit -m "feat(memory): add validateBrowseQuery, the one reading of a legal browse query

Explicit failures for unknown fields/ops/sort names, empty value lists,
non-finite numbers, unreal calendar days, non-ISO-Z instants and oversized
inputs — replacing today's silently-match-zero behavior. The 1..1000 limit
ceiling applies only when a caller passes maxLimit, so the CLI's 10k-row
consolidation scan keeps working while the HTTP boundary stays bounded."
```

---

### Task 5: Sort whitelist and range math (pure)

**Files:**

- Create: `packages/memory/src/browse-order.ts`
- Create: `packages/memory/src/browse-range.ts`
- Create: `packages/memory/test/browse-order.test.ts`
- Create: `packages/memory/test/browse-range.test.ts`
- Test: `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-order.test.ts test/browse-range.test.ts`

- [ ] **Step 1: Write the failing order test.** Create `packages/memory/test/browse-order.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest"
      import { DEFAULT_BROWSE_ORDER, resolveBrowseOrder } from "../src/browse-order.js"

      describe("resolveBrowseOrder", () => {
            it("defaults to updated_at DESC when orderBy is absent or empty", () => {
              expect(resolveBrowseOrder()).toEqual(DEFAULT_BROWSE_ORDER)
              expect(resolveBrowseOrder([])).toEqual(DEFAULT_BROWSE_ORDER)
              expect(DEFAULT_BROWSE_ORDER).toEqual([
                { field: "updatedAt", column: "updated_at", dir: "desc", numeric: false, collateC: false },
              ])
            })
            it("maps every whitelisted field to its physical column", () => {
              expect(
                resolveBrowseOrder([
                  { field: "confidence", dir: "desc" },
                  { field: "namespace", dir: "asc" },
                  { field: "createdAt", dir: "asc" },
                ]),
              ).toEqual([
                { field: "confidence", column: "confidence", dir: "desc", numeric: true, collateC: false },
                { field: "namespace", column: "namespace", dir: "asc", numeric: false, collateC: true },
                { field: "createdAt", column: "created_at", dir: "asc", numeric: false, collateC: false },
              ])
            })
            it("marks only namespace as needing COLLATE \"C\" — timestamps must stay uncollated so the (updated_at DESC, id ASC) index is still usable", () => {
              expect(resolveBrowseOrder([{ field: "updatedAt", dir: "desc" }])[0]?.collateC).toBe(false)
              expect(resolveBrowseOrder([{ field: "status", dir: "asc" }])[0]?.collateC).toBe(false)
              expect(resolveBrowseOrder([{ field: "kind", dir: "asc" }])[0]?.collateC).toBe(false)
            })
            it("throws rather than passing an unknown field through to SQL", () => {
              expect(() => resolveBrowseOrder([{ field: "content" as never, dir: "asc" }])).toThrow(
                /unknown sort field "content"/,
              )
            })
          })
          ```

- [ ] **Step 2: Write the failing range test.** Create `packages/memory/test/browse-range.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest"
      import { namespacePrefixUpperBound, utcDayAfter, utcDayStart } from "../src/browse-range.js"

      describe("UTC day buckets", () => {
            it("brackets a day as [start, next start)", () => {
              expect(utcDayStart("2026-08-09")).toBe("2026-08-09T00:00:00.000Z")
              expect(utcDayAfter("2026-08-09")).toBe("2026-08-10T00:00:00.000Z")
            })
            it("rolls over months and years", () => {
              expect(utcDayAfter("2026-08-31")).toBe("2026-09-01T00:00:00.000Z")
              expect(utcDayAfter("2026-12-31")).toBe("2027-01-01T00:00:00.000Z")
              expect(utcDayAfter("2028-02-28")).toBe("2028-02-29T00:00:00.000Z")
            })
          })

          describe("namespacePrefixUpperBound", () => {
            it("increments the last code point so the prefix becomes a half-open range", () => {
              expect(namespacePrefixUpperBound("route=/a")).toBe("route=/b")
              expect(namespacePrefixUpperBound("50%")).toBe("50&")
            })
            it("carries past maximal trailing code points", () => {
              expect(namespacePrefixUpperBound(`a\u{10FFFF}`)).toBe("b")
            })
            it("returns undefined when there is no upper bound (all code points maximal)", () => {
              expect(namespacePrefixUpperBound(`\u{10FFFF}\u{10FFFF}`)).toBeUndefined()
              expect(namespacePrefixUpperBound("")).toBeUndefined()
            })
            it("never lands inside the surrogate range (those are not valid code points)", () => {
              expect(namespacePrefixUpperBound("퟿")).toBe("")
            })
            it("bounds every string that starts with the prefix", () => {
              const prefix = "route=/x"
              const upper = namespacePrefixUpperBound(prefix)
              expect(upper).toBeDefined()
              for (const suffix of ["", "y", "\u{1F600}", "\u{10FFFF}"]) {
                expect(prefix + suffix >= prefix).toBe(true)
                expect([...(prefix + suffix)].join("") < (upper as string)).toBe(true)
              }
            })
          })
          ```

- [ ] **Step 3: Run both and see them fail.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-order.test.ts test/browse-range.test.ts`
      Expected: two `Failed to load url ../src/browse-order.js` / `../src/browse-range.js` errors.
- [ ] **Step 4: Create `packages/memory/src/browse-order.ts`.**
      ```ts
      import { BrowseQueryError } from "./browse-validate.js"
      import type { BrowseSortEntry, BrowseSortField } from "./types.js"

      export interface ResolvedBrowseSort {
            readonly field: BrowseSortField
            /** Physical column. Comes from the table below and NOWHERE else — this is the
             *  only place a browse sort name becomes a SQL identifier. */
            readonly column: string
            readonly dir: "asc" | "desc"
            /** Postgres binds JS numbers as float8; a float4 column needs a `::real` cast on
             *  the parameter or equality against a stored value is false. */
            readonly numeric: boolean
            /** Postgres needs COLLATE "C" here to match SQLite's BINARY order. Deliberately
             *  FALSE for updated_at/created_at: they are uniform ASCII (so every collation
             *  agrees) AND the (updated_at DESC, id ASC) index is uncollated — a collated
             *  ORDER BY would stop matching it and turn the hot path into a sort. */
            readonly collateC: boolean
          }

          const COLUMNS: Readonly<
            Record<BrowseSortField, { readonly column: string; readonly numeric: boolean; readonly collateC: boolean }>
          > = {
            updatedAt: { column: "updated_at", numeric: false, collateC: false },
            createdAt: { column: "created_at", numeric: false, collateC: false },
            confidence: { column: "confidence", numeric: true, collateC: false },
            namespace: { column: "namespace", numeric: false, collateC: true },
            kind: { column: "kind", numeric: false, collateC: false },
            status: { column: "status", numeric: false, collateC: false },
          }

          /** The documented reset state: newest first, `id ASC` appended by the stores. */
          export const DEFAULT_BROWSE_ORDER: readonly ResolvedBrowseSort[] = [
            { field: "updatedAt", column: "updated_at", dir: "desc", numeric: false, collateC: false },
          ]

          export function resolveBrowseOrder(
            orderBy?: readonly BrowseSortEntry[],
          ): readonly ResolvedBrowseSort[] {
            if (!orderBy || orderBy.length === 0) return DEFAULT_BROWSE_ORDER
            return orderBy.map((entry) => {
              const meta = COLUMNS[entry.field]
              // Defence in depth: validateBrowseQuery already rejected this, but a store
              // must never interpolate an unmapped name.
              if (!meta) throw new BrowseQueryError(`unknown sort field ${JSON.stringify(entry.field)}`)
              return { field: entry.field, column: meta.column, dir: entry.dir, numeric: meta.numeric, collateC: meta.collateC }
            })
          }
          ```

- [ ] **Step 5: Create `packages/memory/src/browse-range.ts`.**
      ```ts
      const DAY_MS = 86_400_000

      /** Inclusive lower bound of a UTC day, in the stored full-ISO-Z form. */
          export function utcDayStart(day: string): string {
            return `${day}T00:00:00.000Z`
          }

          /** EXCLUSIVE upper bound of a UTC day — the next day's start. UTC has no DST, so
           *  adding 24h is exact. */
          export function utcDayAfter(day: string): string {
            return new Date(Date.parse(utcDayStart(day)) + DAY_MS).toISOString()
          }

          const MAX_CODE_POINT = 0x10ffff
          const SURROGATE_START = 0xd800
          const SURROGATE_END = 0xdfff

          /**
           * Smallest string strictly greater than every string starting with `prefix`, so a
           * prefix match becomes the sargable range `col >= prefix AND col < succ(prefix)`.
           * Strip trailing maximal code points, increment the last remaining one; an
           * all-maximal prefix has no upper bound (undefined = omit the clause).
           *
           * Defined over CODE POINTS, which is order-equivalent to UTF-8 byte order — the
           * order SQLite's BINARY collation and Postgres's COLLATE "C" both use.
           */
          export function namespacePrefixUpperBound(prefix: string): string | undefined {
            const points = Array.from(prefix)
            for (let i = points.length - 1; i >= 0; i -= 1) {
              const codePoint = points[i]?.codePointAt(0)
              if (codePoint === undefined || codePoint >= MAX_CODE_POINT) continue
              let next = codePoint + 1
              // Surrogates are not valid scalar values; skipping the block keeps the bound a
              // legal string while staying an upper bound (nothing sorts between D7FF and E000).
              if (next >= SURROGATE_START && next <= SURROGATE_END) next = SURROGATE_END + 1
              return points.slice(0, i).join("") + String.fromCodePoint(next)
            }
            return undefined
          }
          ```

- [ ] **Step 6: Run both tests and see them pass.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-order.test.ts test/browse-range.test.ts`
      Expected: `Test Files 2 passed`.
- [ ] **Step 7: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/browse-order.ts packages/memory/src/browse-range.ts \
      packages/memory/test/browse-order.test.ts packages/memory/test/browse-range.test.ts
      git commit -m "feat(memory): add the browse sort whitelist and range math

resolveBrowseOrder is the only place a sort name becomes a SQL identifier, and
it records per-column facts the dialects need (numeric -> ::real, collateC).
namespacePrefixUpperBound turns the byte-exact prefix into a sargable half-open
range without giving up its metacharacter-literal semantics."
```

---

### Task 6: The opaque keyset cursor

**Files:**

- Create: `packages/memory/src/browse-cursor.ts`
- Create: `packages/memory/test/browse-cursor.test.ts`
- Test: `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-cursor.test.ts`

> The fingerprint is a **mismatch detector, not a MAC**: cursors are server-issued and the
> Inspector is localhost-only. Use the pure FNV-1a below rather than `node:crypto` so this
> module stays isomorphic — slice 3's browser-side hook imports the same subpath.

- [ ] **Step 1: Write the failing test.** Create `packages/memory/test/browse-cursor.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest"
      import {
      BROWSE_CURSOR_VERSION,
      browseCursorKey,
      browseQueryFingerprint,
      decodeBrowseCursor,
      encodeBrowseCursor,
      } from "../src/browse-cursor.js"
      import { resolveBrowseOrder } from "../src/browse-order.js"
      import type { BrowseQuery, MemoryRecord } from "../src/types.js"

      const record: MemoryRecord = {
            id: "r1",
            kind: "semantic",
            namespace: "route=/x",
            content: "c",
            data: {},
            source: { type: "eval", id: "seed" },
            confidence: 0.25,
            tags: [],
            status: "active",
            createdAt: "2026-08-01T00:00:00.000Z",
            updatedAt: "2026-08-09T12:00:00.000Z",
          }

          describe("browseQueryFingerprint", () => {
            it("is stable across key order and filter order", () => {
              const a: BrowseQuery = {
                namespace: "route=/x",
                filters: [
                  { field: "status", op: "in", values: ["active", "candidate"] },
                  { field: "content", op: "contains", value: "acme" },
                ],
              }
              const b: BrowseQuery = {
                filters: [
                  { field: "content", op: "contains", value: "acme" },
                  { field: "status", op: "in", values: ["candidate", "active"] },
                ],
                namespace: "route=/x",
              }
              expect(browseQueryFingerprint(a)).toBe(browseQueryFingerprint(b))
            })
            it("changes when any identity field changes", () => {
              const base: BrowseQuery = { namespace: "route=/x" }
              const fp = browseQueryFingerprint(base)
              expect(browseQueryFingerprint({ ...base, namespace: "route=/y" })).not.toBe(fp)
              expect(browseQueryFingerprint({ ...base, status: "active" })).not.toBe(fp)
              expect(browseQueryFingerprint({ ...base, orderBy: [{ field: "confidence", dir: "asc" }] })).not.toBe(fp)
              expect(browseQueryFingerprint({ ...base, now: "2026-08-09T00:00:00.000Z" })).not.toBe(fp)
            })
            it("ignores paging, which is not part of dataset identity", () => {
              const fp = browseQueryFingerprint({ namespace: "route=/x" })
              expect(browseQueryFingerprint({ namespace: "route=/x", limit: 7, offset: 3, cursor: "z" })).toBe(fp)
            })
          })

          describe("browseCursorKey", () => {
            it("extracts the raw stored value for each ordered field", () => {
              expect(browseCursorKey(record, resolveBrowseOrder())).toEqual(["2026-08-09T12:00:00.000Z"])
              expect(
                browseCursorKey(
                  record,
                  resolveBrowseOrder([
                    { field: "confidence", dir: "desc" },
                    { field: "namespace", dir: "asc" },
                  ]),
                ),
              ).toEqual([0.25, "route=/x"])
            })
          })

          describe("cursor codec", () => {
            const fp = browseQueryFingerprint({ namespace: "route=/x" })

            it("round-trips key and id", () => {
              const cursor = encodeBrowseCursor(fp, { key: ["2026-08-09T12:00:00.000Z"], id: "r1" })
              expect(decodeBrowseCursor(cursor, fp, 1)).toEqual({
                key: ["2026-08-09T12:00:00.000Z"],
                id: "r1",
              })
            })
            it("round-trips non-ASCII and full-precision numbers", () => {
              const cursor = encodeBrowseCursor(fp, { key: [0.1 + 0.2, "ns=✓/日本"], id: "r1" })
              expect(decodeBrowseCursor(cursor, fp, 2)).toEqual({ key: [0.30000000000000004, "ns=✓/日本"], id: "r1" })
            })
            it("is base64url — no +, / or = to escape in a query string", () => {
              const cursor = encodeBrowseCursor(fp, { key: ["ÿÿÿÿ"], id: "r1" })
              expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
            })
            it("rejects a cursor from a different query", () => {
              const cursor = encodeBrowseCursor(fp, { key: ["x"], id: "r1" })
              const other = browseQueryFingerprint({ namespace: "route=/y" })
              expect(() => decodeBrowseCursor(cursor, other, 1)).toThrow(/continuation-invalid/)
            })
            it("rejects garbage, a wrong version, and a key of the wrong length", () => {
              expect(() => decodeBrowseCursor("!!!not-base64!!!", fp, 1)).toThrow(/continuation-invalid/)
              const wrongVersion = Buffer.from(
                JSON.stringify({ v: BROWSE_CURSOR_VERSION + 1, fp, key: ["x"], id: "r1" }),
              ).toString("base64url")
              expect(() => decodeBrowseCursor(wrongVersion, fp, 1)).toThrow(/continuation-invalid/)
              const cursor = encodeBrowseCursor(fp, { key: ["x"], id: "r1" })
              expect(() => decodeBrowseCursor(cursor, fp, 2)).toThrow(/continuation-invalid/)
            })
            it("carries the continuation-invalid code so the route can map it to 400", () => {
              try {
                decodeBrowseCursor("###", fp, 1)
                expect.unreachable("should have thrown")
              } catch (error) {
                expect((error as { code?: string }).code).toBe("continuation-invalid")
              }
            })
          })
          ```

- [ ] **Step 2: Run it and see it fail.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-cursor.test.ts`
      Expected: `Failed to load url ../src/browse-cursor.js`.
- [ ] **Step 3: Create `packages/memory/src/browse-cursor.ts` — encoding primitives.**
      ```ts
      import { normalizeSetFilter } from "./browse-filter.js"
      import type { ResolvedBrowseSort } from "./browse-order.js"
      import { resolveBrowseOrder } from "./browse-order.js"
      import { BrowseQueryError } from "./browse-validate.js"
      import type { BrowseFilter, BrowseQuery, MemoryRecord } from "./types.js"

      export const BROWSE_CURSOR_VERSION = 1

          export type BrowseCursorValue = string | number

          export interface BrowseCursorPayload {
            /** Raw stored sort-key values, one per ordered field, in order. */
            readonly key: readonly BrowseCursorValue[]
            readonly id: string
          }

          // btoa/atob + TextEncoder are available in Node 24 AND browsers; Buffer is not, and
          // slice 3's hook imports this module from client code.
          function toBase64Url(json: string): string {
            const bytes = new TextEncoder().encode(json)
            let binary = ""
            for (const byte of bytes) binary += String.fromCharCode(byte)
            return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
          }

          function fromBase64Url(cursor: string): string {
            const base64 = cursor.replace(/-/g, "+").replace(/_/g, "/")
            const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4)
            const binary = atob(padded)
            return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
          }

          // FNV-1a/32. A cursor is server-issued over localhost, so this is a mismatch
          // DETECTOR, not a MAC — and staying dependency-free keeps the module isomorphic.
          function fnv1a32(input: string): string {
            let hash = 0x811c9dc5
            for (let i = 0; i < input.length; i += 1) {
              hash ^= input.charCodeAt(i)
              hash = Math.imul(hash, 0x01000193) >>> 0
            }
            return hash.toString(16).padStart(8, "0")
          }
          ```

- [ ] **Step 4: Add the fingerprint.** Append:
      ```ts
      function canonicalFilter(filter: BrowseFilter): string {
      switch (filter.field) {
      case "status":
      case "kind":
      return `${filter.field}|${filter.op}|${[...filter.values].sort().join(",")}`
      case "content":
      case "namespace":
      return `${filter.field}|${filter.op}|${filter.value}`
      case "confidence":
      return filter.op === "between"
      ? `confidence|between|${filter.min}|${filter.max}`
      : `confidence|${filter.op}|${filter.value}`
      default:
      return filter.op === "betweenDays"
      ? `updatedAt|betweenDays|${filter.fromDay}|${filter.untilDay}`
      : `updatedAt|${filter.op}|${filter.day}`
      }
      }

      /**
           * Fingerprint of the query's DATASET IDENTITY — every field that changes which rows
           * match or in what order, and nothing else. `limit`/`offset`/`cursor` are paging,
           * not identity. Encoded into every cursor so a continuation can never smuggle its
           * own query into a different request.
           */
          export function browseQueryFingerprint(query: BrowseQuery): string {
            const canonical = JSON.stringify({
              namespace: query.namespace ?? null,
              namespacePrefix: query.namespacePrefix ?? null,
              status: normalizeSetFilter(query.status) ?? null,
              kind: normalizeSetFilter(query.kind) ?? null,
              sourceType: query.sourceType ?? null,
              since: query.since ?? null,
              until: query.until ?? null,
              now: query.now ?? null,
              filters: (query.filters ?? []).map(canonicalFilter).sort(),
              order: resolveBrowseOrder(query.orderBy).map((entry) => `${entry.field}:${entry.dir}`),
            })
            return fnv1a32(canonical)
          }
          ```
          Note `status`/`kind` sets are NOT sorted here: `["a","b"]` and `["b","a"]` select the
          same rows, but the test above only requires filter-array order and object-key order to
          be irrelevant. Sorting the top-level sets would also be correct; leaving them ordered
          keeps `normalizeSetFilter`'s output verbatim and a differing order merely invalidates a
          cursor, which is safe.

- [ ] **Step 5: Add key extraction and the codec.** Append:
      ```ts
      /** The raw stored values of `record` for the ordered fields, in order. */
      export function browseCursorKey(
      record: MemoryRecord,
      order: readonly ResolvedBrowseSort[],
      ): readonly BrowseCursorValue[] {
      return order.map((entry) => {
      switch (entry.field) {
      case "updatedAt":
      return record.updatedAt
      case "createdAt":
      return record.createdAt
      case "confidence":
      return record.confidence
      case "namespace":
      return record.namespace
      case "kind":
      return record.kind
      default:
      return record.status
      }
      })
      }

      export function encodeBrowseCursor(fingerprint: string, payload: BrowseCursorPayload): string {
            return toBase64Url(
              JSON.stringify({ v: BROWSE_CURSOR_VERSION, fp: fingerprint, key: payload.key, id: payload.id }),
            )
          }

          function invalid(reason: string): never {
            throw new BrowseQueryError(`continuation-invalid: ${reason}`, "continuation-invalid")
          }

          /** Decode and authenticate a continuation against the request's OWN parameters. */
          export function decodeBrowseCursor(
            cursor: string,
            fingerprint: string,
            expectedKeyLength: number,
          ): BrowseCursorPayload {
            let parsed: unknown
            try {
              parsed = JSON.parse(fromBase64Url(cursor))
            } catch {
              invalid("cursor is not decodable")
            }
            const decoded = parsed as { v?: unknown; fp?: unknown; key?: unknown; id?: unknown }
            if (decoded?.v !== BROWSE_CURSOR_VERSION) invalid("cursor version is not supported")
            if (decoded.fp !== fingerprint) invalid("cursor belongs to a different query")
            if (!Array.isArray(decoded.key) || decoded.key.length !== expectedKeyLength)
              invalid("cursor key does not match the requested sort order")
            for (const value of decoded.key) {
              if (typeof value !== "string" && !(typeof value === "number" && Number.isFinite(value)))
                invalid("cursor key holds a value that is neither a string nor a finite number")
            }
            if (typeof decoded.id !== "string" || decoded.id.length === 0) invalid("cursor id is missing")
            return { key: decoded.key as readonly BrowseCursorValue[], id: decoded.id }
          }
          ```

- [ ] **Step 6: Run the test and see it pass.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-cursor.test.ts`
      Expected: `Test Files 1 passed`. If the non-ASCII round-trip fails, `toBase64Url` is
      being handed a raw string instead of the `TextEncoder` bytes — re-check Step 3.
- [ ] **Step 7: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/browse-cursor.ts packages/memory/test/browse-cursor.test.ts
      git commit -m "feat(memory): add the opaque keyset cursor codec and query fingerprint

base64url of {v, fp, key, id}. The fingerprint covers dataset identity only, so
paging never invalidates a cursor while any filter/sort/window change does — and
the server recomputes it from the request's own parameters, so a continuation
can never smuggle a different query."
```

---

### Task 7: Publish the pure browse contract (barrel + `@dawn-ai/memory/browse` subpath)

Dawn has no api-extractor: a type that is not exported from the barrel is not part of the
contract. The `./browse` subpath exists so bundled consumers (the Inspector route now,
slice 3's hook later) can import validation and the cursor codec **without** pulling
`sqliteMemoryStore` and therefore `node:sqlite` — the same reason `./namespace` and
`./reconcile` exist (`packages/memory/package.json` exports map).

**Files:**

- Create: `packages/memory/src/browse.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: `packages/memory/package.json` (exports map)
- Test: `pnpm --filter @dawn-ai/memory build` + a Node resolution smoke check

- [ ] **Step 1: Create the subpath barrel** `packages/memory/src/browse.ts`:
      ``ts
    /**
     * The PURE browse contract: types, validation, the sort whitelist, range math and the
     * cursor codec. Deliberately imports nothing from `sqlite-store.ts`, so importing
     * `@dawn-ai/memory/browse` never pulls `node:sqlite` — bundled server routes and
     * browser code can both use it.
     */
    export { normalizeSetFilter } from "./browse-filter.js"
    export type { ResolvedBrowseSort } from "./browse-order.js"
    export { DEFAULT_BROWSE_ORDER, resolveBrowseOrder } from "./browse-order.js"
    export { namespacePrefixUpperBound, utcDayAfter, utcDayStart } from "./browse-range.js"
    export type { BrowseCursorPayload, BrowseCursorValue } from "./browse-cursor.js"
    export {
      BROWSE_CURSOR_VERSION,
      browseCursorKey,
      browseQueryFingerprint,
      decodeBrowseCursor,
      encodeBrowseCursor,
    } from "./browse-cursor.js"
    export {
      BROWSE_DEFAULT_LIMIT,
      BROWSE_MAX_LIMIT,
      BROWSE_SORT_FIELDS,
      BrowseQueryError,
      validateBrowseQuery,
    } from "./browse-validate.js"
    export type {
      BrowseFilter,
      BrowsePage,
      BrowseQuery,
      BrowseSortEntry,
      BrowseSortField,
      MemoryKind,
      MemoryRecord,
      MemorySource,
      MemoryStatus,
    } from "./types.js"
    ``
- [ ] **Step 2: Re-export the same runtime symbols from the main barrel.** In
      `packages/memory/src/index.ts`, replace the first line
      (`export { normalizeSetFilter } from "./browse-filter.js"`) with:
      `ts
    export { normalizeSetFilter } from "./browse-filter.js"
    export type { BrowseCursorPayload, BrowseCursorValue } from "./browse-cursor.js"
    export {
      BROWSE_CURSOR_VERSION,
      browseCursorKey,
      browseQueryFingerprint,
      decodeBrowseCursor,
      encodeBrowseCursor,
    } from "./browse-cursor.js"
    export type { ResolvedBrowseSort } from "./browse-order.js"
    export { DEFAULT_BROWSE_ORDER, resolveBrowseOrder } from "./browse-order.js"
    export { namespacePrefixUpperBound, utcDayAfter, utcDayStart } from "./browse-range.js"
    export {
      BROWSE_DEFAULT_LIMIT,
      BROWSE_MAX_LIMIT,
      BROWSE_SORT_FIELDS,
      BrowseQueryError,
      validateBrowseQuery,
    } from "./browse-validate.js"
    `
- [ ] **Step 3: Add the subpath to the exports map.** In `packages/memory/package.json`,
      inside `"exports"`, add after the `"."` entry (keys stay alphabetical after `.`):
      `json
        "./browse": {
          "types": "./dist/browse.d.ts",
          "default": "./dist/browse.js"
        },
    `
- [ ] **Step 4: Build and verify the subpath resolves without `node:sqlite`.**
      `bash
    pnpm --filter @dawn-ai/memory build
    node --input-type=module -e "
      const m = await import('@dawn-ai/memory/browse')
      console.log(typeof m.validateBrowseQuery, typeof m.encodeBrowseCursor, typeof m.resolveBrowseOrder)
      console.log('sqliteMemoryStore leaked:', 'sqliteMemoryStore' in m)
    " --experimental-default-type=module 2>/dev/null || \
    node -e "import('@dawn-ai/memory/browse').then(m => console.log(typeof m.validateBrowseQuery, typeof m.encodeBrowseCursor, typeof m.resolveBrowseOrder, 'leak:', 'sqliteMemoryStore' in m))"
    `
      Run from `packages/memory`. Expected: `function function function leak: false`.
- [ ] **Step 5: Verify packaging is still clean.** `pnpm pack:check` from the repo root.
      Expected: publint reports no errors for `@dawn-ai/memory` (it validates that every
      `exports` target exists in `dist/`). If it complains the target is missing, the build
      in Step 4 did not run or `src/browse.ts` is not in `include`.
- [ ] **Step 6: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/browse.ts packages/memory/src/index.ts packages/memory/package.json
      git commit -m "feat(memory): export the pure browse contract, incl. a @dawn-ai/memory/browse subpath

There is no api-extractor here: the barrel and the exports map ARE the public
surface. The subpath keeps validation and the cursor codec reachable from bundled
server routes and (later) browser code without dragging node:sqlite along."
```

---

### Task 8: Both stores validate defensively

First behavior change, so read Convention 10 again: **SQLite and Postgres land together.**

**Files:**

- Modify: `packages/memory/src/sqlite-store.ts` (imports at 1-10; `browse` at 431)
- Modify: `packages/memory-pgvector/src/pgvector-store.ts` (imports at 1-13; `browse` at 445)
- Modify: `packages/testing/src/memory-conformance.ts` (append tests after line 398)
- Test: `test/sqlite-conformance.test.ts` (fast) and the gated pgvector run

- [ ] **Step 1: Add the conformance tests.** In `packages/testing/src/memory-conformance.ts`,
      immediately after the `browse namespacePrefix is case-sensitive` test (ends line 398),
      insert:
      ``ts
        test("browse rejects an invalid query instead of silently matching zero rows", async () => {
          const s = await makeStore()
          try {
            // A store that quietly returns [] for a malformed filter teaches the caller
            // that its query was fine and the data was empty. Both are lies.
            await expect(s.browse({ status: "bogus" as never })).rejects.toThrow(/invalid status/)
            await expect(
              s.browse({ filters: [{ field: "tags", op: "in", values: ["x"] }] as never }),
            ).rejects.toThrow(/unknown filter field/)
            await expect(
              s.browse({ filters: [{ field: "status", op: "in", values: [] }] }),
            ).rejects.toThrow(/must not be empty/)
            await expect(
              s.browse({ orderBy: [{ field: "content" as never, dir: "asc" }] }),
            ).rejects.toThrow(/unknown sort field/)
            await expect(s.browse({ limit: 0 })).rejects.toThrow(/limit must be an integer >= 1/)
            await expect(s.browse({ since: "2026-08-09" })).rejects.toThrow(/full ISO-8601/)
          } finally {
            await close?.(s)
          }
        })
        test("browse does NOT impose the HTTP limit ceiling on in-process callers", async () => {
          const s = await makeStore()
          try {
            // The CLI's consolidation scan browses with limit 10_000 and does offset
            // arithmetic against `total`; a store-side clamp would silently truncate it.
            await s.put(rec({ id: "a", namespace: "ns", content: "a" }))
            const page = await s.browse({ limit: 10_000 })
            expect(page.total).toBe(1)
            expect(page.records.map((r) => r.id)).toEqual(["a"])
          } finally {
            await close?.(s)
          }
        })
    ``
- [ ] **Step 2: Run the conformance suite and watch the new tests fail.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
      Expected: 1 failed test — `browse rejects an invalid query…` with
      `promise resolved instead of rejecting`. The ceiling test passes already.
- [ ] **Step 3: Wire the validator into the SQLite store.** In
      `packages/memory/src/sqlite-store.ts`, add to the import block (after the
      `browse-filter.js` import on line 5):
      `ts
    import { BROWSE_DEFAULT_LIMIT, validateBrowseQuery } from "./browse-validate.js"
    `
      Then make `async browse(q = {})` (line 431) start with:
      `ts
        async browse(q = {}) {
          // Defence in depth: the HTTP boundary validates too, but a store that accepts
          // nonsense returns an empty page that looks like an answer.
          validateBrowseQuery(q)
    `
      and change the limit default on line 471 from `q.limit ?? 50` to
      `q.limit ?? BROWSE_DEFAULT_LIMIT`.
- [ ] **Step 4: Wire the validator into the Postgres store.** In
      `packages/memory-pgvector/src/pgvector-store.ts`, extend the `@dawn-ai/memory` import
      block (lines 1-13) with `BROWSE_DEFAULT_LIMIT,` and `validateBrowseQuery,` in
      alphabetical position. Then make `async browse(q = {})` (line 445) read:
      `ts
        async browse(q = {}) {
          validateBrowseQuery(q)
          await ready()
    `
      — validation **before** `ready()`, so a malformed query never pays for a connection.
      Change `q.limit ?? 50` to `q.limit ?? BROWSE_DEFAULT_LIMIT`.
- [ ] **Step 5: Run the SQLite conformance suite — expect GREEN.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
      Expected: 0 failed, two more passing tests than Task 1 Step 6.
- [ ] **Step 6: Run the gated Postgres conformance suite.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    `
      Expected: the container starts (first run pulls `pgvector/pgvector:pg16`), the whole
      conformance suite passes under the `pgvector real-Postgres conformance` describe.
- [ ] **Step 7: Check nothing else in the repo browses illegally.**
      `pnpm test 2>&1 | tail -40`
      Expected: no new failures. If `packages/cli` fails with a `BrowseQueryError`, some
      caller was relying on the silently-invalid behavior — fix the caller, not the validator.
- [ ] **Step 8: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-store.ts packages/memory-pgvector/src/pgvector-store.ts \
      packages/testing/src/memory-conformance.ts
      git commit -m "feat(memory): both stores validate the browse query and throw

An invalid enum used to match zero rows and look like an empty dataset. Now it
throws in-process and 400s over HTTP. The 1..1000 ceiling stays a boundary
concern: the conformance suite pins that a 10k in-process scan still works."
```

---

### Task 9: `filters` — status / kind / content

**Files:**

- Create: `packages/memory/src/sqlite-browse-sql.ts`
- Create: `packages/memory/test/sqlite-browse-sql.test.ts`
- Create: `packages/memory-pgvector/src/browse-sql.ts`
- Create: `packages/memory-pgvector/test/browse-sql.test.ts`
- Modify: `packages/memory/src/sqlite-store.ts` (`browse` clause assembly, 432-468)
- Modify: `packages/memory-pgvector/src/pgvector-store.ts` (`browse` clause assembly, 446-484)
- Modify: `packages/testing/src/memory-conformance.ts`
- Test: SQL-string unit tests + both conformance runs

- [ ] **Step 1: Write the SQLite SQL-string test.** Create
      `packages/memory/test/sqlite-browse-sql.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest"
      import { appendSqliteBrowseFilter } from "../src/sqlite-browse-sql.js"
      import type { BrowseFilter } from "../src/types.js"

      function build(filter: BrowseFilter) {
            const where: string[] = []
            const params: (string | number)[] = []
            appendSqliteBrowseFilter(filter, where, params)
            return { sql: where.join(" AND "), params }
          }

          describe("appendSqliteBrowseFilter — sets", () => {
            it("expands in/notIn to placeholders", () => {
              expect(build({ field: "status", op: "in", values: ["active", "candidate"] })).toEqual({
                sql: "status IN (?,?)",
                params: ["active", "candidate"],
              })
              expect(build({ field: "kind", op: "notIn", values: ["episodic"] })).toEqual({
                sql: "kind NOT IN (?)",
                params: ["episodic"],
              })
            })
          })

          describe("appendSqliteBrowseFilter — content", () => {
            it("uses literal substring primitives, never LIKE (no metacharacter escaping, ever)", () => {
              expect(build({ field: "content", op: "contains", value: "50%" })).toEqual({
                sql: "instr(lower(content), lower(?)) > 0",
                params: ["50%"],
              })
              expect(build({ field: "content", op: "notContains", value: "x" }).sql).toBe(
                "instr(lower(content), lower(?)) = 0",
              )
              expect(build({ field: "content", op: "startsWith", value: "x" }).sql).toBe(
                "instr(lower(content), lower(?)) = 1",
              )
              expect(build({ field: "content", op: "endsWith", value: "x" })).toEqual({
                sql: "substr(lower(content), -length(?)) = lower(?)",
                params: ["x", "x"],
              })
              expect(build({ field: "content", op: "equals", value: "x" }).sql).toBe("lower(content) = lower(?)")
              expect(build({ field: "content", op: "notEquals", value: "x" }).sql).toBe("lower(content) <> lower(?)")
            })
          })
          ```

- [ ] **Step 2: Write the Postgres SQL-string test.** Create
      `packages/memory-pgvector/test/browse-sql.test.ts`:
      ```ts
      import { describe, expect, it } from "vitest"
      import type { BrowseFilter } from "@dawn-ai/memory"
      import { appendPgBrowseFilter } from "../src/browse-sql.js"

      function build(filter: BrowseFilter, startIndex = 0) {
            const where: string[] = []
            const params: unknown[] = new Array(startIndex).fill("seed")
            appendPgBrowseFilter(filter, where, params)
            return { sql: where.join(" AND "), params: params.slice(startIndex) }
          }

          describe("appendPgBrowseFilter — sets", () => {
            it("binds one array parameter instead of expanding placeholders", () => {
              expect(build({ field: "status", op: "in", values: ["active", "candidate"] })).toEqual({
                sql: 'status = ANY($1::text[])',
                params: [["active", "candidate"]],
              })
              expect(build({ field: "kind", op: "notIn", values: ["episodic"] }).sql).toBe(
                'kind <> ALL($1::text[])',
              )
            })
            it("numbers placeholders from the caller's current parameter count", () => {
              expect(build({ field: "status", op: "in", values: ["active"] }, 3).sql).toBe(
                'status = ANY($4::text[])',
              )
            })
          })

          describe("appendPgBrowseFilter — content", () => {
            it("uses position()/starts_with()/right(), never LIKE", () => {
              expect(build({ field: "content", op: "contains", value: "50%" })).toEqual({
                sql: "position(lower($1) in lower(content)) > 0",
                params: ["50%"],
              })
              expect(build({ field: "content", op: "notContains", value: "x" }).sql).toBe(
                "position(lower($1) in lower(content)) = 0",
              )
              expect(build({ field: "content", op: "startsWith", value: "x" }).sql).toBe(
                "starts_with(lower(content), lower($1))",
              )
              expect(build({ field: "content", op: "endsWith", value: "x" })).toEqual({
                sql: "right(lower(content), length($1)) = lower($2)",
                params: ["x", "x"],
              })
              expect(build({ field: "content", op: "equals", value: "x" }).sql).toBe("lower(content) = lower($1)")
              expect(build({ field: "content", op: "notEquals", value: "x" }).sql).toBe("lower(content) <> lower($1)")
            })
          })
          ```

- [ ] **Step 3: Run both and see them fail.**
      `bash
    pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/sqlite-browse-sql.test.ts
    pnpm --filter @dawn-ai/memory-pgvector exec vitest --run --config vitest.config.ts test/browse-sql.test.ts
    `
      Expected: both fail with `Failed to load url` for the missing modules.
- [ ] **Step 4: Create `packages/memory/src/sqlite-browse-sql.ts`.**
      ```ts
      import type { SQLInputValue } from "node:sqlite"
      import type { BrowseFilter } from "./types.js"

      /**
           * Append one normalized filter to a SQLite WHERE list. Column names come from this
           * switch and nowhere else; every value is bound.
           *
           * Text matching uses literal substring primitives (`instr`, `substr`) rather than
           * LIKE, so `%`, `_` and `\` in a user's search term need no escaping and can never
           * change the predicate. Case-insensitivity is `lower()`, which is ASCII-only in
           * SQLite without ICU — a documented, conformance-pinned divergence from Postgres's
           * ctype-aware `lower()`.
           */
          export function appendSqliteBrowseFilter(
            filter: BrowseFilter,
            where: string[],
            params: SQLInputValue[],
          ): void {
            switch (filter.field) {
              case "status":
              case "kind": {
                const column = filter.field
                const placeholders = filter.values.map(() => "?").join(",")
                where.push(
                  filter.op === "in"
                    ? `${column} IN (${placeholders})`
                    : `${column} NOT IN (${placeholders})`,
                )
                params.push(...filter.values)
                return
              }
              case "content": {
                switch (filter.op) {
                  case "contains":
                    where.push("instr(lower(content), lower(?)) > 0")
                    params.push(filter.value)
                    return
                  case "notContains":
                    where.push("instr(lower(content), lower(?)) = 0")
                    params.push(filter.value)
                    return
                  case "startsWith":
                    where.push("instr(lower(content), lower(?)) = 1")
                    params.push(filter.value)
                    return
                  case "endsWith":
                    // Negative substr() takes the LAST n characters; a needle longer than the
                    // content yields the whole content, which cannot equal it. Correct by
                    // construction, no length guard needed.
                    where.push("substr(lower(content), -length(?)) = lower(?)")
                    params.push(filter.value, filter.value)
                    return
                  case "equals":
                    where.push("lower(content) = lower(?)")
                    params.push(filter.value)
                    return
                  default:
                    where.push("lower(content) <> lower(?)")
                    params.push(filter.value)
                    return
                }
              }
              default:
                throw new Error(`unhandled browse filter field: ${(filter as { field: string }).field}`)
            }
          }
          ```
          (The `namespace`, `confidence` and `updatedAt` arms are added in Tasks 10 and 11; the
          explicit `default` throw makes an unimplemented arm loud rather than silently unfiltered.)

- [ ] **Step 5: Create `packages/memory-pgvector/src/browse-sql.ts`.**
      ```ts
      import type { BrowseFilter } from "@dawn-ai/memory"

      /**
           * Append one normalized filter to a Postgres WHERE list, numbering `$n` from the
           * caller's current parameter count. Mirrors `appendSqliteBrowseFilter` clause for
           * clause; the conformance suite is what holds the two readings together.
           */
          export function appendPgBrowseFilter(
            filter: BrowseFilter,
            where: string[],
            params: unknown[],
          ): void {
            switch (filter.field) {
              case "status":
              case "kind": {
                const column = filter.field
                params.push(filter.values)
                // One bind for the whole set, and `<> ALL` is the exact NOT IN equivalent.
                where.push(
                  filter.op === "in"
                    ? `${column} = ANY($${params.length}::text[])`
                    : `${column} <> ALL($${params.length}::text[])`,
                )
                return
              }
              case "content": {
                switch (filter.op) {
                  case "contains":
                    params.push(filter.value)
                    where.push(`position(lower($${params.length}) in lower(content)) > 0`)
                    return
                  case "notContains":
                    params.push(filter.value)
                    where.push(`position(lower($${params.length}) in lower(content)) = 0`)
                    return
                  case "startsWith":
                    params.push(filter.value)
                    where.push(`starts_with(lower(content), lower($${params.length}))`)
                    return
                  case "endsWith": {
                    params.push(filter.value, filter.value)
                    const second = params.length
                    where.push(`right(lower(content), length($${second - 1})) = lower($${second})`)
                    return
                  }
                  case "equals":
                    params.push(filter.value)
                    where.push(`lower(content) = lower($${params.length})`)
                    return
                  default:
                    params.push(filter.value)
                    where.push(`lower(content) <> lower($${params.length})`)
                    return
                }
              }
              default:
                throw new Error(`unhandled browse filter field: ${(filter as { field: string }).field}`)
            }
          }
          ```

- [ ] **Step 6: Run both SQL-string tests and see them pass.**
      `bash
    pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/sqlite-browse-sql.test.ts
    pnpm --filter @dawn-ai/memory build && \
    pnpm --filter @dawn-ai/memory-pgvector exec vitest --run --config vitest.config.ts test/browse-sql.test.ts
    `
      Expected: both `Test Files 1 passed`. (The pgvector test imports the `BrowseFilter`
      **type** from the built package, hence the build.)
- [ ] **Step 7: Add the conformance semantics tests.** In
      `packages/testing/src/memory-conformance.ts`, after the tests added in Task 8, insert:
      `ts
        test("browse filters[] narrows by status/kind set, ANDed with everything else", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "a", namespace: "route=/x", content: "a" }))
            await s.put(rec({ id: "b", namespace: "route=/x", content: "b", status: "candidate" }))
            await s.put(rec({ id: "e", namespace: "route=/y", content: "e", kind: "episodic" }))
            const inSet = await s.browse({
              filters: [{ field: "status", op: "in", values: ["candidate", "superseded"] }],
            })
            expect(inSet.records.map((r) => r.id)).toEqual(["b"])
            expect(inSet.total).toBe(1)
            const notIn = await s.browse({ filters: [{ field: "kind", op: "notIn", values: ["episodic"] }] })
            expect(notIn.records.map((r) => r.id).sort()).toEqual(["a", "b"])
            expect(notIn.total).toBe(2)
            const anded = await s.browse({
              namespacePrefix: "route=/x",
              filters: [{ field: "status", op: "in", values: ["candidate"] }],
            })
            expect(anded.records.map((r) => r.id)).toEqual(["b"])
            expect(anded.total).toBe(1)
          } finally {
            await close?.(s)
          }
        })
        test("browse content filters are case-insensitive substring matches, not LIKE patterns", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "a", namespace: "ns", content: "Acme threshold is 500" }))
            await s.put(rec({ id: "b", namespace: "ns", content: "zed color is blue" }))
            await s.put(rec({ id: "pct", namespace: "ns", content: "50% off today" }))
            await s.put(rec({ id: "und", namespace: "ns", content: "50Xoff today" }))
            const contains = await s.browse({ filters: [{ field: "content", op: "contains", value: "ACME" }] })
            expect(contains.records.map((r) => r.id)).toEqual(["a"])
            expect(contains.total).toBe(1)
            expect(
              (await s.browse({ filters: [{ field: "content", op: "notContains", value: "acme" }] })).records
                .map((r) => r.id)
                .sort(),
            ).toEqual(["b", "pct", "und"])
            expect(
              (await s.browse({ filters: [{ field: "content", op: "startsWith", value: "acme " }] })).records.map(
                (r) => r.id,
              ),
            ).toEqual(["a"])
            expect(
              (await s.browse({ filters: [{ field: "content", op: "endsWith", value: "IS BLUE" }] })).records.map(
                (r) => r.id,
              ),
            ).toEqual(["b"])
            expect(
              (await s.browse({ filters: [{ field: "content", op: "equals", value: "zed color is blue" }] })).records.map(
                (r) => r.id,
              ),
            ).toEqual(["b"])
            expect(
              (await s.browse({ filters: [{ field: "content", op: "notEquals", value: "zed color is blue" }] })).total,
            ).toBe(3)
            // "%" and "_" are literal characters, not wildcards: this is why the stores
            // use instr/position instead of LIKE.
            const literal = await s.browse({ filters: [{ field: "content", op: "contains", value: "50% o" }] })
            expect(literal.records.map((r) => r.id)).toEqual(["pct"])
          } finally {
            await close?.(s)
          }
        })
    `
- [ ] **Step 8: Run the SQLite conformance suite and watch the two new tests fail.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
      Expected: 2 failed — the filters are accepted by validation but ignored by the stores,
      so every row comes back (`expected [ 'a', 'b', 'e' ] to deeply equal [ 'b' ]`).
- [ ] **Step 9: Apply filters in the SQLite store.** In `packages/memory/src/sqlite-store.ts`,
      add the import `import { appendSqliteBrowseFilter } from "./sqlite-browse-sql.js"`, then
      inside `browse`, immediately **after** the `if (q.now) { … }` block (ends line 467) and
      **before** `const clause = …` (line 468), insert:
      `ts
          for (const filter of q.filters ?? []) appendSqliteBrowseFilter(filter, where, params)
    `
- [ ] **Step 10: Apply filters in the Postgres store.** In
      `packages/memory-pgvector/src/pgvector-store.ts`, add
      `import { appendPgBrowseFilter } from "./browse-sql.js"` next to the existing
      `./schema.js` import, then insert the same loop after the `if (q.now) { … }` block
      (ends line 483) and before `const clause = …` (line 484):
      `ts
          for (const filter of q.filters ?? []) appendPgBrowseFilter(filter, where, params)
    `
- [ ] **Step 11: Both conformance runs — expect GREEN.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts && \
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    `
      Expected: 0 failed on both. If Postgres disagrees on `ACME` vs `Acme`, check that the
      clause lowercases **both** sides — the divergence the design accepts is non-ASCII
      folding only, and every fixture here is ASCII.
- [ ] **Step 12: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-browse-sql.ts packages/memory/src/sqlite-store.ts \
      packages/memory/test/sqlite-browse-sql.test.ts \
      packages/memory-pgvector/src/browse-sql.ts packages/memory-pgvector/src/pgvector-store.ts \
      packages/memory-pgvector/test/browse-sql.test.ts packages/testing/src/memory-conformance.ts
      git commit -m "feat(memory): apply status/kind/content browse filters in both stores

Text matching uses instr()/position() rather than LIKE so % and _ in a search
term stay literal and nothing ever needs escaping. The SQL builders are unit
tested as strings (fast, no container) and the conformance suite holds the two
dialects to one reading."
```

---

### Task 10: The indexes (SQLite migration v4, Postgres `initSchema`)

No behavior change — this is what makes the default order and the keyset walk a seek instead
of a scan (measured: 0.54 ms with the index vs 22.8 ms full index scan at 1M rows, §5.5/§6.2).
It lands before the keyset work so every later measurement is on the real plan.

**Files:**

- Modify: `packages/memory/src/sqlite-store.ts` (`MIGRATIONS`, lines 61-95)
- Modify: `packages/memory-pgvector/src/schema.ts` (`initSchema`, lines 47-59)
- Create: `packages/memory/test/browse-index.test.ts`
- Modify: `packages/memory-pgvector/test/pgvector-integration.test.ts`
- Test: `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-index.test.ts` and the gated pg run

- [ ] **Step 1: Write the failing SQLite migration test.** Create
      `packages/memory/test/browse-index.test.ts`:
      ```ts
      import { mkdtempSync, rmSync } from "node:fs"
      import { tmpdir } from "node:os"
      import { join } from "node:path"
      import { DatabaseSync } from "node:sqlite"
      import { afterEach, describe, expect, it } from "vitest"
      import { sqliteMemoryStore } from "../src/index.js"

      const dirs: string[] = []
          function dbPath() {
            const dir = mkdtempSync(join(tmpdir(), "dawn-idx-"))
            dirs.push(dir)
            return join(dir, "m.sqlite")
          }
          afterEach(() => {
            for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
          })

          function inspect(path: string) {
            const db = new DatabaseSync(path)
            try {
              const version = (db.prepare("SELECT max(version) AS v FROM schema_version").get() as { v: number }).v
              const index = db
                .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_mem_updated_id'")
                .get() as { sql: string } | undefined
              return { version, indexSql: index?.sql }
            } finally {
              db.close()
            }
          }

          describe("browse ordering index", () => {
            it("migration v4 creates (updated_at DESC, id ASC)", () => {
              const path = dbPath()
              sqliteMemoryStore({ path })
              const { version, indexSql } = inspect(path)
              expect(version).toBe(4)
              // Directions must be IN the DDL: a plain-ASC composite scanned backwards gives
              // the wrong tie-break direction, which silently breaks keyset paging.
              expect(indexSql).toContain("updated_at DESC")
              expect(indexSql).toContain("id ASC")
            })

            it("applies to an existing database that predates it, and is idempotent", () => {
              const path = dbPath()
              sqliteMemoryStore({ path })
              // Rewind to the pre-v4 world using the store's own DDL as the source of truth.
              const db = new DatabaseSync(path)
              db.exec("DROP INDEX idx_mem_updated_id")
              db.exec("DELETE FROM schema_version WHERE version = 4")
              db.close()
              expect(inspect(path).version).toBe(3)

              sqliteMemoryStore({ path })
              expect(inspect(path).version).toBe(4)
              sqliteMemoryStore({ path })
              expect(inspect(path).version).toBe(4)
            })
          })
          ```

- [ ] **Step 2: Run it and see it fail.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-index.test.ts`
      Expected: both cases fail — `expected 3 to be 4` and `expected undefined to contain "updated_at DESC"`.
- [ ] **Step 3: Add migration v4.** In `packages/memory/src/sqlite-store.ts`, append to the
      `MIGRATIONS` array (after the version-3 entry, before the closing `]` on line 95):
      ``ts
      {
        // The global browse order — every poll tick's hot path, and the index the keyset
        // guard seeks on. Directions are declared: a plain-ASC composite scanned backward
        // reverses the id tie-break, which would make windows non-deterministic.
        version: 4,
        up: `
          CREATE INDEX IF NOT EXISTS idx_mem_updated_id ON memories (updated_at DESC, id ASC);
        `,
      },
    ``
- [ ] **Step 4: Run the test and see it pass.**
      `pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/browse-index.test.ts`
      Expected: `Test Files 1 passed`.
- [ ] **Step 5: Write the failing Postgres index test.** In
      `packages/memory-pgvector/test/pgvector-integration.test.ts`, add inside the
      `describe.skipIf(!enabled)("pgvector integration", …)` block:
      ``ts
      test("initSchema creates the browse ordering and C-collated namespace indexes", async () => {
        const prefix = `t_${Math.random().toString(36).slice(2)}`
        const pool = new Pool({ connectionString: url })
        try {
          const client = await pool.connect()
          try {
            await initSchema(client, { prefix, schema: "public", dimensions: 3, m: 16, efConstruction: 64 })
            const res = await client.query<{ indexname: string; indexdef: string }>(
              "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1",
              [`${prefix}_memories`],
            )
            const byName = new Map(res.rows.map((r) => [r.indexname, r.indexdef]))
            expect(byName.has(`${prefix}_updated_id`)).toBe(true)
            expect(byName.get(`${prefix}_updated_id`)).toContain("updated_at DESC")
            expect(byName.get(`${prefix}_updated_id`)).toContain('COLLATE "C"')
            expect(byName.has(`${prefix}_ns_c`)).toBe(true)
            // Idempotent: a second init must not throw.
            await initSchema(client, { prefix, schema: "public", dimensions: 3, m: 16, efConstruction: 64 })
          } finally {
            client.release()
          }
        } finally {
          await pool.end()
        }
      })
    ``
- [ ] **Step 6: Run the gated pg test and see it fail.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector exec vitest --run --config vitest.config.ts test/pgvector-integration.test.ts
    `
      Expected: `expected false to be true` on `${prefix}_updated_id`.
- [ ] **Step 7: Add both indexes to `initSchema`.** In
      `packages/memory-pgvector/src/schema.ts`, after the `${prefix}_ns_kind_effective` index
      (line 54) insert:
      ``ts
      // The global browse order + keyset seek. `id COLLATE "C"` matches SQLite's BINARY
      // tie-break; `updated_at` is deliberately UNCOLLATED so the ORDER BY the store emits
      // (also uncollated — uniform ASCII, every collation agrees) keeps matching it.
      await client.query(
        `CREATE INDEX IF NOT EXISTS ${prefix}_updated_id ON ${t} (updated_at DESC, id COLLATE "C" ASC)`,
      )
      // Byte-order namespace index: the sargable prefix range compares with COLLATE "C",
      // which the default-collation composite above cannot serve.
      await client.query(`CREATE INDEX IF NOT EXISTS ${prefix}_ns_c ON ${t} (namespace COLLATE "C")`)
    ``
- [ ] **Step 8: Re-run the gated pg test — expect GREEN.** Same command as Step 6.
      Expected: `Test Files 1 passed`.
- [ ] **Step 9: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-store.ts packages/memory/test/browse-index.test.ts \
      packages/memory-pgvector/src/schema.ts packages/memory-pgvector/test/pgvector-integration.test.ts
      git commit -m "feat(memory): index the global browse order on both backends

(updated_at DESC, id ASC) is the plan the default order and every keyset seek
depend on; without it the guarded walk degrades to a full index scan. Directions
are declared in the DDL because a backward scan of a plain-ASC composite
reverses the tie-break. Postgres also gains a C-collated namespace index so the
byte-range prefix is sargable there."
```

---

### Task 11: `namespace` — exact field and sargable prefix

**Files:**

- Modify: `packages/memory/src/sqlite-browse-sql.ts` (add the `namespace` arm)
- Modify: `packages/memory-pgvector/src/browse-sql.ts` (add the `namespace` arm)
- Modify: `packages/memory/src/sqlite-store.ts` (`browse`, the `namespacePrefix` block at 434-439)
- Modify: `packages/memory-pgvector/src/pgvector-store.ts` (`browse`, the prefix block at 448-452)
- Modify: `packages/memory/test/sqlite-browse-sql.test.ts`, `packages/memory-pgvector/test/browse-sql.test.ts`
- Modify: `packages/testing/src/memory-conformance.ts`
- Test: SQL-string tests + both conformance runs

- [ ] **Step 1: Extend the SQL-string tests.** Append to
      `packages/memory/test/sqlite-browse-sql.test.ts`:
      `ts
    describe("appendSqliteBrowseFilter — namespace", () => {
      it("compares exactly for equals", () => {
        expect(build({ field: "namespace", op: "equals", value: "route=/x" })).toEqual({
          sql: "namespace = ?",
          params: ["route=/x"],
        })
      })
      it("turns startsWith into a half-open byte range (sargable, still metachar-literal)", () => {
        expect(build({ field: "namespace", op: "startsWith", value: "route=/a" })).toEqual({
          sql: "namespace >= ? AND namespace < ?",
          params: ["route=/a", "route=/b"],
        })
      })
      it("drops the upper bound when the prefix has none", () => {
        expect(build({ field: "namespace", op: "startsWith", value: "\u{10FFFF}" })).toEqual({
          sql: "namespace >= ?",
          params: ["\u{10FFFF}"],
        })
      })
    })
    `
      and to `packages/memory-pgvector/test/browse-sql.test.ts`:
      `ts
    describe("appendPgBrowseFilter — namespace", () => {
      it("compares with COLLATE \"C\" so byte order matches SQLite", () => {
        expect(build({ field: "namespace", op: "equals", value: "route=/x" })).toEqual({
          sql: 'namespace COLLATE "C" = $1',
          params: ["route=/x"],
        })
        expect(build({ field: "namespace", op: "startsWith", value: "route=/a" })).toEqual({
          sql: 'namespace COLLATE "C" >= $1 AND namespace COLLATE "C" < $2',
          params: ["route=/a", "route=/b"],
        })
      })
    })
    `
- [ ] **Step 2: Run both and see them fail.**
      `bash
    pnpm --filter @dawn-ai/memory exec vitest --run --config vitest.config.ts test/sqlite-browse-sql.test.ts
    pnpm --filter @dawn-ai/memory-pgvector exec vitest --run --config vitest.config.ts test/browse-sql.test.ts
    `
      Expected: both throw `unhandled browse filter field: namespace`.
- [ ] **Step 3: Add the SQLite `namespace` arm.** In
      `packages/memory/src/sqlite-browse-sql.ts`, add the import
      `import { namespacePrefixUpperBound } from "./browse-range.js"` and insert this case
      between the `content` case and the `default`:
      `ts
        case "namespace": {
          if (filter.op === "equals") {
            where.push("namespace = ?")
            params.push(filter.value)
            return
          }
          // Byte-exact prefix as a half-open RANGE rather than substr(): identical
          // semantics (metacharacters stay literal, comparison stays case-sensitive),
          // but the planner can seek the namespace-leading index instead of scanning.
          const upper = namespacePrefixUpperBound(filter.value)
          where.push(upper === undefined ? "namespace >= ?" : "namespace >= ? AND namespace < ?")
          params.push(filter.value)
          if (upper !== undefined) params.push(upper)
          return
        }
    `
- [ ] **Step 4: Add the Postgres `namespace` arm.** In
      `packages/memory-pgvector/src/browse-sql.ts`, add
      `import { namespacePrefixUpperBound } from "@dawn-ai/memory"` to the existing import and
      insert:
      ``ts
        case "namespace": {
          if (filter.op === "equals") {
            params.push(filter.value)
            where.push(`namespace COLLATE "C" = $${params.length}`)
            return
          }
          const upper = namespacePrefixUpperBound(filter.value)
          params.push(filter.value)
          const lower = params.length
          if (upper === undefined) {
            where.push(`namespace COLLATE "C" >= $${lower}`)
            return
          }
          params.push(upper)
          where.push(`namespace COLLATE "C" >= $${lower} AND namespace COLLATE "C" < $${params.length}`)
          return
        }
    ``
- [ ] **Step 5: Re-run both SQL-string tests — expect GREEN.** Same commands as Step 2 (rebuild
      `@dawn-ai/memory` first so the pgvector test sees the new export:
      `pnpm --filter @dawn-ai/memory build`).
- [ ] **Step 6: Add the conformance tests.** Append to
      `packages/testing/src/memory-conformance.ts` (after the content-filter test):
      `ts
        test("browse namespace is EXACT while namespacePrefix stays a prefix", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "exact", namespace: "route=/a", content: "exact" }))
            await s.put(rec({ id: "child", namespace: "route=/ab", content: "child" }))
            const byPrefix = await s.browse({ namespacePrefix: "route=/a" })
            expect(byPrefix.records.map((r) => r.id).sort()).toEqual(["child", "exact"])
            expect(byPrefix.total).toBe(2)
            // The exact field is what kills the Inspector's client-side narrowing, where
            // the server counted the prefix and the client displayed the equality.
            const byExact = await s.browse({ namespace: "route=/a" })
            expect(byExact.records.map((r) => r.id)).toEqual(["exact"])
            expect(byExact.total).toBe(1)
            const byFilter = await s.browse({
              filters: [{ field: "namespace", op: "equals", value: "route=/ab" }],
            })
            expect(byFilter.records.map((r) => r.id)).toEqual(["child"])
            expect(byFilter.total).toBe(1)
          } finally {
            await close?.(s)
          }
        })
        test("browse namespace startsWith keeps byte-exact, case-sensitive, metachar-literal semantics", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "u", namespace: "route=/foo_bar", content: "u" }))
            await s.put(rec({ id: "x", namespace: "route=/fooXbar", content: "x" }))
            await s.put(rec({ id: "unicode", namespace: "route=/日本語", content: "unicode" }))
            const underscore = await s.browse({
              filters: [{ field: "namespace", op: "startsWith", value: "route=/foo_" }],
            })
            expect(underscore.records.map((r) => r.id)).toEqual(["u"])
            expect(underscore.total).toBe(1)
            expect(
              (await s.browse({ filters: [{ field: "namespace", op: "startsWith", value: "ROUTE=/foo" }] })).total,
            ).toBe(0)
            // Multi-byte prefixes must not fall outside the computed range.
            const unicode = await s.browse({
              filters: [{ field: "namespace", op: "startsWith", value: "route=/日" }],
            })
            expect(unicode.records.map((r) => r.id)).toEqual(["unicode"])
            expect(unicode.total).toBe(1)
          } finally {
            await close?.(s)
          }
        })
    `
- [ ] **Step 7: Run the SQLite conformance suite and see the new tests fail.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
      Expected: the exact-namespace test fails (`expected [ 'child', 'exact' ] to deeply equal [ 'exact' ]` —
      the top-level `namespace` field is still ignored by the stores); the startsWith test
      passes already via the new filter arm.
- [ ] **Step 8: Handle the top-level `namespace` and re-implement the prefix in the SQLite store.**
      In `packages/memory/src/sqlite-store.ts`, replace the `if (q.namespacePrefix) { … }`
      block (lines 434-439) with:
      `ts
          if (q.namespace) {
            where.push("namespace = ?")
            params.push(q.namespace)
          }
          if (q.namespacePrefix) {
            // Byte-exact, case-sensitive prefix as a sargable half-open range —
            // deliberately NOT LIKE (so %/_/\ stay literal) and no longer substr()
            // (which was not sargable: 8.0 ms scan vs 0.63 ms seek at 100k).
            const upper = namespacePrefixUpperBound(q.namespacePrefix)
            where.push(upper === undefined ? "namespace >= ?" : "namespace >= ? AND namespace < ?")
            params.push(q.namespacePrefix)
            if (upper !== undefined) params.push(upper)
          }
    `
      and add `namespacePrefixUpperBound` to the imports from `./browse-range.js`.
      **Leave `stats()` and `prune()` on their existing `substr()` form** — they are outside
      this slice and their behavior is pinned by tests that must not move.
- [ ] **Step 9: Do the same in the Postgres store.** In
      `packages/memory-pgvector/src/pgvector-store.ts`, replace the `if (q.namespacePrefix) { … }`
      block (lines 448-452) with:
      ``ts
          if (q.namespace) {
            params.push(q.namespace)
            where.push(`namespace COLLATE "C" = $${params.length}`)
          }
          if (q.namespacePrefix) {
            const upper = namespacePrefixUpperBound(q.namespacePrefix)
            params.push(q.namespacePrefix)
            const lower = params.length
            if (upper === undefined) {
              where.push(`namespace COLLATE "C" >= $${lower}`)
            } else {
              params.push(upper)
              where.push(`namespace COLLATE "C" >= $${lower} AND namespace COLLATE "C" < $${params.length}`)
            }
          }
    ``
      and add `namespacePrefixUpperBound,` to the `@dawn-ai/memory` import block.
- [ ] **Step 10: Both conformance runs — expect GREEN.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts && \
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    `
      Expected: 0 failed on both. Pay attention to the pre-existing
      `browse/stats namespacePrefix treats LIKE metacharacters literally` and
      `browse namespacePrefix is case-sensitive` tests — they now exercise the range form and
      must still pass unchanged. If the `50%_off\` case fails on Postgres, the COLLATE is
      missing from one side of the comparison.
- [ ] **Step 11: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-browse-sql.ts packages/memory/src/sqlite-store.ts \
      packages/memory/test/sqlite-browse-sql.test.ts packages/memory-pgvector/src/browse-sql.ts \
      packages/memory-pgvector/src/pgvector-store.ts packages/memory-pgvector/test/browse-sql.test.ts \
      packages/testing/src/memory-conformance.ts
      git commit -m "feat(memory): add exact namespace and make the prefix a sargable byte range

The exact field is what lets the Inspector stop narrowing prefix results
client-side, where rows and total could disagree. The prefix becomes
[p, succ(p)) over code points — same byte-exact, metacharacter-literal
semantics, but the planner can seek instead of scan."
```

---

### Task 12: `filters` — confidence and updatedAt

**Files:**

- Modify: both SQL builders and both SQL-string tests
- Modify: `packages/testing/src/memory-conformance.ts`
- Test: SQL-string tests + both conformance runs

- [ ] **Step 1: Extend the SQLite SQL-string test.** Append to
      `packages/memory/test/sqlite-browse-sql.test.ts`:
      ```ts
      describe("appendSqliteBrowseFilter — confidence", () => {
      it("maps each comparison op and makes between inclusive", () => {
      expect(build({ field: "confidence", op: "eq", value: 0.5 })).toEqual({ sql: "confidence = ?", params: [0.5] })
      expect(build({ field: "confidence", op: "neq", value: 0.5 }).sql).toBe("confidence <> ?")
      expect(build({ field: "confidence", op: "gt", value: 0.5 }).sql).toBe("confidence > ?")
      expect(build({ field: "confidence", op: "gte", value: 0.5 }).sql).toBe("confidence >= ?")
      expect(build({ field: "confidence", op: "lt", value: 0.5 }).sql).toBe("confidence < ?")
      expect(build({ field: "confidence", op: "lte", value: 0.5 }).sql).toBe("confidence <= ?")
      expect(build({ field: "confidence", op: "between", min: 0.2, max: 0.8 })).toEqual({
      sql: "confidence >= ? AND confidence <= ?",
      params: [0.2, 0.8],
      })
      })
      })

      describe("appendSqliteBrowseFilter — updatedAt", () => {
            it("brackets UTC days against the stored full-ISO-Z text", () => {
              expect(build({ field: "updatedAt", op: "onDay", day: "2026-08-09" })).toEqual({
                sql: "updated_at >= ? AND updated_at < ?",
                params: ["2026-08-09T00:00:00.000Z", "2026-08-10T00:00:00.000Z"],
              })
              expect(build({ field: "updatedAt", op: "beforeDay", day: "2026-08-09" })).toEqual({
                sql: "updated_at < ?",
                params: ["2026-08-09T00:00:00.000Z"],
              })
              expect(build({ field: "updatedAt", op: "afterDay", day: "2026-08-09" })).toEqual({
                sql: "updated_at >= ?",
                params: ["2026-08-10T00:00:00.000Z"],
              })
              expect(build({ field: "updatedAt", op: "betweenDays", fromDay: "2026-08-01", untilDay: "2026-08-09" })).toEqual({
                sql: "updated_at >= ? AND updated_at < ?",
                params: ["2026-08-01T00:00:00.000Z", "2026-08-10T00:00:00.000Z"],
              })
            })
          })
          ```

- [ ] **Step 2: Extend the Postgres SQL-string test.** Append to
      `packages/memory-pgvector/test/browse-sql.test.ts`:
      ```ts
      describe("appendPgBrowseFilter — confidence", () => {
      it("casts every parameter to ::real so float4 comparisons are exact", () => {
      // confidence is float4. A JS number binds as float8, and 0.9::real <> 0.9::float8 —
      // without the cast, equality against a stored value is simply false.
      expect(build({ field: "confidence", op: "eq", value: 0.9 })).toEqual({
      sql: "confidence = $1::real",
            params: [0.9],
          })
          expect(build({ field: "confidence", op: "between", min: 0.2, max: 0.8 })).toEqual({
            sql: "confidence >= $1::real AND confidence <= $2::real",
      params: [0.2, 0.8],
      })
      })
      })

      describe("appendPgBrowseFilter — updatedAt", () => {
            it("brackets UTC days identically to sqlite", () => {
              expect(build({ field: "updatedAt", op: "onDay", day: "2026-08-09" })).toEqual({
                sql: "updated_at >= $1 AND updated_at < $2",
                params: ["2026-08-09T00:00:00.000Z", "2026-08-10T00:00:00.000Z"],
              })
              expect(build({ field: "updatedAt", op: "afterDay", day: "2026-08-09" })).toEqual({
                sql: "updated_at >= $1",
                params: ["2026-08-10T00:00:00.000Z"],
              })
            })
          })
          ```

- [ ] **Step 3: Run both and see them fail** with `unhandled browse filter field: confidence`.
      Commands as in Task 11 Step 2.
- [ ] **Step 4: Add both arms to the SQLite builder.** In
      `packages/memory/src/sqlite-browse-sql.ts`, add
      `import { utcDayAfter, utcDayStart } from "./browse-range.js"` and insert before the
      `default`:
      ``ts
        case "confidence": {
          if (filter.op === "between") {
            // Inclusive on both ends, matching the grid's local `between`.
            where.push("confidence >= ? AND confidence <= ?")
            params.push(filter.min, filter.max)
            return
          }
          const operators = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const
          where.push(`confidence ${operators[filter.op]} ?`)
          params.push(filter.value)
          return
        }
        case "updatedAt": {
          switch (filter.op) {
            case "onDay":
              where.push("updated_at >= ? AND updated_at < ?")
              params.push(utcDayStart(filter.day), utcDayAfter(filter.day))
              return
            case "beforeDay":
              where.push("updated_at < ?")
              params.push(utcDayStart(filter.day))
              return
            case "afterDay":
              where.push("updated_at >= ?")
              params.push(utcDayAfter(filter.day))
              return
            default:
              // Inclusive of BOTH days: the upper bound is the day AFTER untilDay.
              where.push("updated_at >= ? AND updated_at < ?")
              params.push(utcDayStart(filter.fromDay), utcDayAfter(filter.untilDay))
              return
          }
        }
    ``
- [ ] **Step 5: Add both arms to the Postgres builder.** In
      `packages/memory-pgvector/src/browse-sql.ts`, add `utcDayAfter, utcDayStart` to the
      `@dawn-ai/memory` import and insert before the `default`:
      ``ts
        case "confidence": {
          if (filter.op === "between") {
            params.push(filter.min, filter.max)
            const max = params.length
            where.push(`confidence >= $${max - 1}::real AND confidence <= $${max}::real`)
            return
          }
          const operators = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const
          params.push(filter.value)
          where.push(`confidence ${operators[filter.op]} $${params.length}::real`)
          return
        }
        case "updatedAt": {
          switch (filter.op) {
            case "onDay":
              params.push(utcDayStart(filter.day), utcDayAfter(filter.day))
              where.push(`updated_at >= $${params.length - 1} AND updated_at < $${params.length}`)
              return
            case "beforeDay":
              params.push(utcDayStart(filter.day))
              where.push(`updated_at < $${params.length}`)
              return
            case "afterDay":
              params.push(utcDayAfter(filter.day))
              where.push(`updated_at >= $${params.length}`)
              return
            default:
              params.push(utcDayStart(filter.fromDay), utcDayAfter(filter.untilDay))
              where.push(`updated_at >= $${params.length - 1} AND updated_at < $${params.length}`)
              return
          }
        }
    ``
- [ ] **Step 6: Re-run both SQL-string tests — expect GREEN** (rebuild memory first for the pg one).
- [ ] **Step 7: Add the conformance tests.** Append to
      `packages/testing/src/memory-conformance.ts`:
      `ts
        test("browse filters by confidence, with between inclusive on both ends", async () => {
          const s = await makeStore()
          try {
            // 0.9 is chosen deliberately: it is not representable in float4, so an
            // uncast Postgres comparison against a float8 bind silently matches nothing.
            await s.put(rec({ id: "low", namespace: "ns", content: "low", confidence: 0.2 }))
            await s.put(rec({ id: "mid", namespace: "ns", content: "mid", confidence: 0.5 }))
            await s.put(rec({ id: "high", namespace: "ns", content: "high", confidence: 0.9 }))
            const stored = (await s.get("high"))?.confidence as number
            expect((await s.browse({ filters: [{ field: "confidence", op: "eq", value: stored }] })).records.map((r) => r.id)).toEqual(["high"])
            expect((await s.browse({ filters: [{ field: "confidence", op: "gt", value: 0.5 }] })).records.map((r) => r.id)).toEqual(["high"])
            expect((await s.browse({ filters: [{ field: "confidence", op: "gte", value: 0.5 }] })).total).toBe(2)
            expect((await s.browse({ filters: [{ field: "confidence", op: "lt", value: 0.5 }] })).records.map((r) => r.id)).toEqual(["low"])
            expect((await s.browse({ filters: [{ field: "confidence", op: "lte", value: 0.5 }] })).total).toBe(2)
            expect((await s.browse({ filters: [{ field: "confidence", op: "neq", value: 0.5 }] })).total).toBe(2)
            const between = await s.browse({ filters: [{ field: "confidence", op: "between", min: 0.2, max: 0.5 }] })
            expect(between.records.map((r) => r.id).sort()).toEqual(["low", "mid"])
            expect(between.total).toBe(2)
          } finally {
            await close?.(s)
          }
        })
        test("browse filters updatedAt by UTC day buckets", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "d1", namespace: "ns", content: "d1", updatedAt: "2026-08-01T23:59:59.999Z" }))
            await s.put(rec({ id: "d2", namespace: "ns", content: "d2", updatedAt: "2026-08-02T00:00:00.000Z" }))
            await s.put(rec({ id: "d3", namespace: "ns", content: "d3", updatedAt: "2026-08-03T12:00:00.000Z" }))
            const onDay = await s.browse({ filters: [{ field: "updatedAt", op: "onDay", day: "2026-08-02" }] })
            expect(onDay.records.map((r) => r.id)).toEqual(["d2"])
            expect(onDay.total).toBe(1)
            expect((await s.browse({ filters: [{ field: "updatedAt", op: "beforeDay", day: "2026-08-02" }] })).records.map((r) => r.id)).toEqual(["d1"])
            expect((await s.browse({ filters: [{ field: "updatedAt", op: "afterDay", day: "2026-08-02" }] })).records.map((r) => r.id)).toEqual(["d3"])
            const span = await s.browse({
              filters: [{ field: "updatedAt", op: "betweenDays", fromDay: "2026-08-01", untilDay: "2026-08-02" }],
            })
            expect(span.records.map((r) => r.id).sort()).toEqual(["d1", "d2"])
            expect(span.total).toBe(2)
          } finally {
            await close?.(s)
          }
        })
    `
- [ ] **Step 8: Run the SQLite conformance and see the two new tests fail**, then pass after
      Steps 4-5 are in place (they are, so this run should already be green — if it is not,
      the store is not calling the builder for these fields; recheck Task 9 Step 9/10).
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
- [ ] **Step 9: Run the gated Postgres conformance.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    `
      Expected: 0 failed. If `confidence op eq` fails **only** on Postgres, the `::real` cast
      is missing — that is the exact failure mode the cast exists to prevent.
- [ ] **Step 10: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-browse-sql.ts packages/memory/test/sqlite-browse-sql.test.ts \
      packages/memory-pgvector/src/browse-sql.ts packages/memory-pgvector/test/browse-sql.test.ts \
      packages/testing/src/memory-conformance.ts
      git commit -m "feat(memory): add confidence and updatedAt browse filters

between is inclusive on both ends; day ops bracket UTC days against the stored
full-ISO-Z text. Postgres casts every confidence parameter to ::real because the
column is float4 and an uncast float8 bind makes equality silently false."
```

---

### Task 13: `orderBy` with the `id` tie-break

**Files:**

- Modify: `packages/memory/src/sqlite-store.ts` (`ORDER BY` at 479)
- Modify: `packages/memory-pgvector/src/pgvector-store.ts` (`ORDER BY` at 496-497)
- Modify: `packages/testing/src/memory-conformance.ts`
- Test: both conformance runs

- [ ] **Step 1: Add the conformance tests.** Append to
      `packages/testing/src/memory-conformance.ts`:
      `ts
        test("browse applies orderBy in order and always terminates with the id tie-break", async () => {
          const s = await makeStore()
          try {
            // Deliberately tied on the leading key so the tie-break is the ONLY thing
            // deciding the order — and mixed-case ids so a locale collation would
            // disagree with byte order if the tie-break were not pinned.
            await s.put(rec({ id: "B", namespace: "ns", content: "B", confidence: 0.5, updatedAt: D(1) }))
            await s.put(rec({ id: "a", namespace: "ns", content: "a", confidence: 0.5, updatedAt: D(1) }))
            await s.put(rec({ id: "C", namespace: "ns", content: "C", confidence: 0.5, updatedAt: D(1) }))
            await s.put(rec({ id: "z", namespace: "ns", content: "z", confidence: 0.9, updatedAt: D(2) }))
            expect((await s.browse({ orderBy: [{ field: "confidence", dir: "desc" }] })).records.map((r) => r.id)).toEqual([
              "z",
              "B",
              "C",
              "a",
            ])
            expect((await s.browse({ orderBy: [{ field: "confidence", dir: "asc" }] })).records.map((r) => r.id)).toEqual([
              "B",
              "C",
              "a",
              "z",
            ])
          } finally {
            await close?.(s)
          }
        })
        test("browse honors a multi-key orderBy with mixed directions", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "1", namespace: "ns=b", content: "1", confidence: 0.1 }))
            await s.put(rec({ id: "2", namespace: "ns=a", content: "2", confidence: 0.9 }))
            await s.put(rec({ id: "3", namespace: "ns=a", content: "3", confidence: 0.1 }))
            expect(
              (
                await s.browse({
                  orderBy: [
                    { field: "namespace", dir: "asc" },
                    { field: "confidence", dir: "desc" },
                  ],
                })
              ).records.map((r) => r.id),
            ).toEqual(["2", "3", "1"])
          } finally {
            await close?.(s)
          }
        })
        test("browse with an empty orderBy is the documented default order", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "old", namespace: "ns", content: "old", updatedAt: D(1) }))
            await s.put(rec({ id: "new", namespace: "ns", content: "new", updatedAt: D(2) }))
            expect((await s.browse({ orderBy: [] })).records.map((r) => r.id)).toEqual(["new", "old"])
            expect((await s.browse()).records.map((r) => r.id)).toEqual(["new", "old"])
          } finally {
            await close?.(s)
          }
        })
    `
      (`D(n)` and `rec` already exist at the top of the file — lines 4-20.)
- [ ] **Step 2: Run the SQLite conformance and see the ordering tests fail.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
      Expected: 2 failed — `orderBy` is ignored, so rows come back in `updated_at DESC` order
      (`expected [ 'z', 'B', 'C', 'a' ]` vs the received recency order).
- [ ] **Step 3: Apply the order in the SQLite store.** In
      `packages/memory/src/sqlite-store.ts`, add
      `import { resolveBrowseOrder } from "./browse-order.js"`, then inside `browse`, after
      the filter loop and before the `const rows = …` statement, insert:
      ``ts
          const order = resolveBrowseOrder(q.orderBy)
          // Every order terminates with `id ASC` so the total order is deterministic and
          // a keyset window can never skip or repeat a row.
          const orderSql = [
            ...order.map((entry) => `${entry.column} ${entry.dir === "desc" ? "DESC" : "ASC"}`),
            "id ASC",
          ].join(", ")
    ``
      and change the row query's `ORDER BY updated_at DESC, id ASC` (line 479) to
      `ORDER BY ${orderSql}`.
- [ ] **Step 4: Apply the order in the Postgres store.** In
      `packages/memory-pgvector/src/pgvector-store.ts`, add `resolveBrowseOrder,` to the
      `@dawn-ai/memory` import block, then insert before the `rowsRes` query:
      ``ts
          const order = resolveBrowseOrder(q.orderBy)
          // COLLATE "C" only where SQLite's BINARY order would otherwise differ (namespace,
          // id). Timestamps stay uncollated so the (updated_at DESC, id COLLATE "C" ASC)
          // index keeps serving the hot path.
          const orderSql = [
            ...order.map(
              (entry) =>
                `${entry.collateC ? `${entry.column} COLLATE "C"` : entry.column} ${entry.dir === "desc" ? "DESC" : "ASC"}`,
            ),
            'id COLLATE "C" ASC',
          ].join(", ")
    ``
      and change the row query's `ORDER BY updated_at DESC, id COLLATE "C" ASC` (line 497) to
      `ORDER BY ${orderSql}`.
- [ ] **Step 5: Both conformance runs — expect GREEN.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts && \
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    `
      Expected: 0 failed on both, and in particular the two backends return the **same**
      id sequences for the tied fixtures. A Postgres-only failure on `["B","C","a"]` means the
      `id` tie-break lost its `COLLATE "C"` (a locale collation sorts `a` before `B`).
- [ ] **Step 6: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-store.ts packages/memory-pgvector/src/pgvector-store.ts \
      packages/testing/src/memory-conformance.ts
      git commit -m "feat(memory): honor a whitelisted orderBy, always terminated by id ASC

Column names come from resolveBrowseOrder's table, never from the request. The
id tie-break is appended server-side so every order is total — which is what
makes a keyset window deterministic. Tied-value, mixed-case-id fixtures pin the
two backends to the same sequence."
```

---

### Task 14: Keyset continuation

The hardest new code in the slice. Two rules matter more than everything else:

1. **The redundant leading range guard is not optional.** `updated_at <= $u` is implied by the
   OR-chain, but without it the planner cannot seek: measured 0.54 ms with it vs 2.51 ms at
   100k / 22.8 ms at 1M without (§6.2).
2. **`total` is the whole matching set.** The keyset clause goes on the ROWS query only —
   never on the COUNT — or "N loaded of M matching" becomes "N loaded of M remaining".

**Files:**

- Modify: `packages/memory/src/sqlite-browse-sql.ts` (add `sqliteKeysetWhere`)
- Modify: `packages/memory-pgvector/src/browse-sql.ts` (add `pgKeysetWhere`)
- Modify: both SQL-string test files
- Modify: `packages/memory/src/sqlite-store.ts` (`browse`)
- Modify: `packages/memory-pgvector/src/pgvector-store.ts` (`browse`)
- Modify: `packages/testing/src/memory-conformance.ts`
- Test: SQL-string tests + both conformance runs

- [ ] **Step 1: Add the keyset SQL-string tests (SQLite).** Append to
      `packages/memory/test/sqlite-browse-sql.test.ts`:
      ```ts
      import { resolveBrowseOrder } from "../src/browse-order.js"
      import { sqliteKeysetWhere } from "../src/sqlite-browse-sql.js"

      describe("sqliteKeysetWhere", () => {
            it("emits the redundant leading guard plus the OR-chain, id last", () => {
              const params: (string | number)[] = []
              const sql = sqliteKeysetWhere(resolveBrowseOrder(), { key: ["2026-08-09T00:00:00.000Z"], id: "r1" }, params)
              expect(sql).toBe("updated_at <= ? AND (updated_at < ? OR (updated_at = ? AND id > ?))")
              expect(params).toEqual([
                "2026-08-09T00:00:00.000Z",
                "2026-08-09T00:00:00.000Z",
                "2026-08-09T00:00:00.000Z",
                "r1",
              ])
            })
            it("flips the guard and the chain operators for an ascending leading key", () => {
              const params: (string | number)[] = []
              const sql = sqliteKeysetWhere(
                resolveBrowseOrder([{ field: "createdAt", dir: "asc" }]),
                { key: ["2026-08-09T00:00:00.000Z"], id: "r1" },
                params,
              )
              expect(sql).toBe("created_at >= ? AND (created_at > ? OR (created_at = ? AND id > ?))")
            })
            it("nests one equality level per additional key", () => {
              const params: (string | number)[] = []
              const sql = sqliteKeysetWhere(
                resolveBrowseOrder([
                  { field: "namespace", dir: "asc" },
                  { field: "confidence", dir: "desc" },
                ]),
                { key: ["ns=a", 0.5], id: "r1" },
                params,
              )
              expect(sql).toBe(
                "namespace >= ? AND (namespace > ? OR (namespace = ? AND confidence < ?) OR (namespace = ? AND confidence = ? AND id > ?))",
              )
              expect(params).toEqual(["ns=a", "ns=a", "ns=a", 0.5, "ns=a", 0.5, "r1"])
            })
          })
          ```

- [ ] **Step 2: Add the keyset SQL-string tests (Postgres).** Append to
      `packages/memory-pgvector/test/browse-sql.test.ts`:
      ```ts
      import { resolveBrowseOrder } from "@dawn-ai/memory"
      import { pgKeysetWhere } from "../src/browse-sql.js"

      describe("pgKeysetWhere", () => {
            it("emits the guard, the OR-chain, and the C-collated id tie-break", () => {
              const params: unknown[] = []
              const sql = pgKeysetWhere(resolveBrowseOrder(), { key: ["2026-08-09T00:00:00.000Z"], id: "r1" }, params)
              expect(sql).toBe(
                'updated_at <= $1 AND (updated_at < $2 OR (updated_at = $3 AND id COLLATE "C" > $4))',
              )
              expect(params).toEqual([
                "2026-08-09T00:00:00.000Z",
                "2026-08-09T00:00:00.000Z",
                "2026-08-09T00:00:00.000Z",
                "r1",
              ])
            })
            it("collates namespace and casts confidence, and continues the caller's numbering", () => {
              const params: unknown[] = ["already-bound"]
              const sql = pgKeysetWhere(
                resolveBrowseOrder([
                  { field: "namespace", dir: "asc" },
                  { field: "confidence", dir: "desc" },
                ]),
                { key: ["ns=a", 0.5], id: "r1" },
                params,
              )
              expect(sql).toBe(
                'namespace COLLATE "C" >= $2 AND (namespace COLLATE "C" > $3 OR (namespace COLLATE "C" = $4 AND confidence < $5::real) OR (namespace COLLATE "C" = $6 AND confidence = $7::real AND id COLLATE "C" > $8))',
              )
            })
          })
          ```

- [ ] **Step 3: Run both and see them fail** with `sqliteKeysetWhere is not a function` /
      `pgKeysetWhere is not a function` (or a load error).
      Commands as in Task 11 Step 2.
- [ ] **Step 4: Implement `sqliteKeysetWhere`.** Append to
      `packages/memory/src/sqlite-browse-sql.ts` (add the two type imports at the top:
      `import type { BrowseCursorPayload } from "./browse-cursor.js"` and
      `import type { ResolvedBrowseSort } from "./browse-order.js"`):
      ```ts
      /** * Everything strictly after `cursor` in `order`, as a WHERE fragment. * * Row-value comparisons cannot express mixed asc/desc, so this is the expanded * OR-chain — plus a REDUNDANT leading range guard. The guard is logically implied by * the chain and is still mandatory: it is what lets the planner seek the leading index * column instead of scanning the whole index (0.54 ms vs 22.8 ms at 1M rows). * * Parameters are pushed in the exact textual order they appear, so the caller can * concatenate this fragment after its filter clauses without renumbering.
      */
      export function sqliteKeysetWhere(
      order: readonly ResolvedBrowseSort[],
      cursor: BrowseCursorPayload,
      params: SQLInputValue[],
      ): string {
      const first = order[0]
      if (!first) throw new Error("keyset requires at least one ordered key")
      const guard = `${first.column} ${first.dir === "desc" ? "<=" : ">="} ?`
      params.push(cursor.key[0] as SQLInputValue)

        const terms: string[] = []
            for (let i = 0; i < order.length; i += 1) {
              const parts: string[] = []
              for (let j = 0; j < i; j += 1) {
                parts.push(`${order[j]?.column} = ?`)
                params.push(cursor.key[j] as SQLInputValue)
              }
              parts.push(`${order[i]?.column} ${order[i]?.dir === "desc" ? "<" : ">"} ?`)
              params.push(cursor.key[i] as SQLInputValue)
              terms.push(parts.length === 1 ? (parts[0] as string) : `(${parts.join(" AND ")})`)
            }
            const tail: string[] = []
            for (let j = 0; j < order.length; j += 1) {
              tail.push(`${order[j]?.column} = ?`)
              params.push(cursor.key[j] as SQLInputValue)
            }
            tail.push("id > ?")
            params.push(cursor.id)
            terms.push(`(${tail.join(" AND ")})`)

            return `${guard} AND (${terms.join(" OR ")})`
          }
          ```

- [ ] **Step 5: Implement `pgKeysetWhere`.** Append to
      `packages/memory-pgvector/src/browse-sql.ts` (add
      `import type { BrowseCursorPayload, ResolvedBrowseSort } from "@dawn-ai/memory"`):
      ```ts
      /** Postgres twin of `sqliteKeysetWhere` — same shape, same guard, `$n` numbering * continued from `params`, COLLATE "C" where byte order matters and `::real` on the * float4 column. */
      export function pgKeysetWhere(
      order: readonly ResolvedBrowseSort[],
      cursor: BrowseCursorPayload,
      params: unknown[],
      ): string {
      const first = order[0]
      if (!first) throw new Error("keyset requires at least one ordered key")
      const col = (entry: ResolvedBrowseSort) =>
      entry.collateC ? `${entry.column} COLLATE "C"` : entry.column
      const bind = (entry: ResolvedBrowseSort, index: number) =>
      entry.numeric ? `$${index}::real` : `$${index}`

        params.push(cursor.key[0])
            const guard = `${col(first)} ${first.dir === "desc" ? "<=" : ">="} ${bind(first, params.length)}`

            const terms: string[] = []
            for (let i = 0; i < order.length; i += 1) {
              const parts: string[] = []
              for (let j = 0; j < i; j += 1) {
                const entry = order[j] as ResolvedBrowseSort
                params.push(cursor.key[j])
                parts.push(`${col(entry)} = ${bind(entry, params.length)}`)
              }
              const entry = order[i] as ResolvedBrowseSort
              params.push(cursor.key[i])
              parts.push(`${col(entry)} ${entry.dir === "desc" ? "<" : ">"} ${bind(entry, params.length)}`)
              terms.push(parts.length === 1 ? (parts[0] as string) : `(${parts.join(" AND ")})`)
            }
            const tail: string[] = []
            for (let j = 0; j < order.length; j += 1) {
              const entry = order[j] as ResolvedBrowseSort
              params.push(cursor.key[j])
              tail.push(`${col(entry)} = ${bind(entry, params.length)}`)
            }
            params.push(cursor.id)
            tail.push(`id COLLATE "C" > $${params.length}`)
            terms.push(`(${tail.join(" AND ")})`)

            return `${guard} AND (${terms.join(" OR ")})`
          }
          ```

- [ ] **Step 6: Re-run both SQL-string tests — expect GREEN** (rebuild memory first for the pg one).
- [ ] **Step 7: Add the conformance tests.** Append to
      `packages/testing/src/memory-conformance.ts`:
      ``ts
        test("browse walks the whole dataset through continuations, no gaps or repeats", async () => {
          const s = await makeStore()
          try {
            for (let i = 0; i < 7; i += 1) {
              await s.put(rec({ id: `r${i}`, namespace: "ns", content: `r${i}`, updatedAt: D(i + 1) }))
            }
            const seen: string[] = []
            let page = await s.browse({ limit: 3 })
            expect(page.total).toBe(7)
            expect(page.continuation).not.toBeNull()
            seen.push(...page.records.map((r) => r.id))
            while (page.continuation) {
              page = await s.browse({ limit: 3, cursor: page.continuation })
              // total is the WHOLE matching set on every window, never what remains.
              expect(page.total).toBe(7)
              seen.push(...page.records.map((r) => r.id))
            }
            expect(seen).toEqual(["r6", "r5", "r4", "r3", "r2", "r1", "r0"])
            expect(new Set(seen).size).toBe(7)
          } finally {
            await close?.(s)
          }
        })
        test("browse returns a null continuation when the window did not fill", async () => {
          const s = await makeStore()
          try {
            await s.put(rec({ id: "a", namespace: "ns", content: "a" }))
            expect((await s.browse({ limit: 10 })).continuation).toBeNull()
            expect((await s.browse()).continuation).toBeNull()
            // A page that fills EXACTLY still issues one; following it is a legal
            // zero-row window, not an error.
            const full = await s.browse({ limit: 1 })
            expect(full.continuation).not.toBeNull()
            const after = await s.browse({ limit: 1, cursor: full.continuation as string })
            expect(after.records).toEqual([])
            expect(after.total).toBe(1)
            expect(after.continuation).toBeNull()
          } finally {
            await close?.(s)
          }
        })
        test("browse continuations survive tied sort keys by falling through to id", async () => {
          const s = await makeStore()
          try {
            for (const id of ["a", "B", "c", "D"]) {
              await s.put(rec({ id, namespace: "ns", content: id, updatedAt: D(1) }))
            }
            const seen: string[] = []
            let page = await s.browse({ limit: 2 })
            seen.push(...page.records.map((r) => r.id))
            while (page.continuation) {
              page = await s.browse({ limit: 2, cursor: page.continuation })
              seen.push(...page.records.map((r) => r.id))
            }
            expect(seen).toEqual(["B", "D", "a", "c"])
          } finally {
            await close?.(s)
          }
        })
        test("browse continuations round-trip a float confidence key exactly", async () => {
          const s = await makeStore()
          try {
            // Postgres stores confidence as float4; a cursor key that is not cast back to
            // ::real compares false against the row it came from and the walk stalls or
            // repeats. These values are all inexact in float4.
            for (const [id, confidence] of [["a", 0.1], ["b", 0.2], ["c", 0.3]] as const) {
              await s.put(rec({ id, namespace: "ns", content: id, confidence }))
            }
            const seen: string[] = []
            let page = await s.browse({ limit: 1, orderBy: [{ field: "confidence", dir: "desc" }] })
            seen.push(...page.records.map((r) => r.id))
            while (page.continuation) {
              page = await s.browse({
                limit: 1,
                orderBy: [{ field: "confidence", dir: "desc" }],
                cursor: page.continuation,
              })
              seen.push(...page.records.map((r) => r.id))
            }
            expect(seen).toEqual(["c", "b", "a"])
          } finally {
            await close?.(s)
          }
        })
        test("browse rejects a continuation issued for a different query", async () => {
          const s = await makeStore()
          try {
            for (let i = 0; i < 3; i += 1) {
              await s.put(rec({ id: `r${i}`, namespace: "ns", content: `r${i}`, updatedAt: D(i + 1) }))
            }
            const page = await s.browse({ limit: 1 })
            const cursor = page.continuation as string
            // A cursor carries its query's fingerprint, so it can never be replayed
            // against a different filter/sort and silently answer the wrong question.
            await expect(s.browse({ limit: 1, cursor, status: "active" })).rejects.toThrow(
              /continuation-invalid/,
            )
            await expect(
              s.browse({ limit: 1, cursor, orderBy: [{ field: "confidence", dir: "asc" }] }),
            ).rejects.toThrow(/continuation-invalid/)
            await expect(s.browse({ limit: 1, cursor: "not-a-cursor" })).rejects.toThrow(
              /continuation-invalid/,
            )
          } finally {
            await close?.(s)
          }
        })
        test("browse continuations compose with filters, and total stays the filtered set", async () => {
          const s = await makeStore()
          try {
            for (let i = 0; i < 5; i += 1) {
              await s.put(
                rec({ id: `c${i}`, namespace: "ns", content: `c${i}`, status: "candidate", updatedAt: D(i + 1) }),
              )
            }
            await s.put(rec({ id: "keep", namespace: "ns", content: "keep", updatedAt: D(9) }))
            const query = { limit: 2, filters: [{ field: "status", op: "in", values: ["candidate"] }] } as const
            const seen: string[] = []
            let page = await s.browse(query)
            expect(page.total).toBe(5)
            seen.push(...page.records.map((r) => r.id))
            while (page.continuation) {
              page = await s.browse({ ...query, cursor: page.continuation })
              expect(page.total).toBe(5)
              seen.push(...page.records.map((r) => r.id))
            }
            expect(seen).toEqual(["c4", "c3", "c2", "c1", "c0"])
          } finally {
            await close?.(s)
          }
        })
    ``
- [ ] **Step 8: Run the SQLite conformance and watch the new tests fail.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    `
      Expected: 6 failed — every `continuation` is still hardcoded `null`, so the first
      assertion in each walk (`expected null not to be null`) fails.
- [ ] **Step 9: Wire the cursor into the SQLite store.** In
      `packages/memory/src/sqlite-store.ts`, extend the imports with
      `ts
    import { browseCursorKey, browseQueryFingerprint, decodeBrowseCursor, encodeBrowseCursor } from "./browse-cursor.js"
    import { appendSqliteBrowseFilter, sqliteKeysetWhere } from "./sqlite-browse-sql.js"
    `
      and replace everything in `browse` from `const clause = …` to the `return` with:
      ```ts
      // The COUNT must see the FILTERS ONLY: `total` is the size of the whole matching
      // set, not of what is left after the cursor.
      const filterParamCount = params.length
      const countClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""

            const fingerprint = browseQueryFingerprint(q)
                const rowWhere = [...where]
                if (q.cursor) {
                  const payload = decodeBrowseCursor(q.cursor, fingerprint, order.length)
                  rowWhere.push(sqliteKeysetWhere(order, payload, params))
                }
                const rowsClause = rowWhere.length > 0 ? `WHERE ${rowWhere.join(" AND ")}` : ""

                // Clamp: sqlite treats LIMIT -1 as unlimited while Postgres throws on
                // negatives — clamping to >= 0 integers unifies backend behavior.
                const limit = Math.max(0, Math.trunc(q.limit ?? BROWSE_DEFAULT_LIMIT))
                const offset = Math.max(0, Math.trunc(q.offset ?? 0))
                // Explicit columns: everything rowToRecord reads, EXCLUDING the embedding
                // BLOB (~6KB/row) that a listing UI would otherwise fetch and discard.
                const rows = db
                  .prepare(
                    `SELECT id, kind, namespace, content, data, source, confidence, tags, status,
                            supersedes, created_at, updated_at, effective_at, expires_at
                     FROM memories ${rowsClause} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
                  )
                  .all(...params, limit, offset) as Record<string, unknown>[]
                const total = (
                  db
                    .prepare(`SELECT COUNT(*) AS n FROM memories ${countClause}`)
                    .get(...params.slice(0, filterParamCount)) as { n: number }
                ).n
                const records = rows.map(rowToRecord)
                const last = records.at(-1)
                // A continuation is issued whenever the window FILLED: the store cannot know
                // whether more rows follow without another read, and an exact-multiple walk
                // ending in one empty window is cheaper than that read.
                const continuation =
                  last && records.length === limit
                    ? encodeBrowseCursor(fingerprint, { key: browseCursorKey(last, order), id: last.id })
                    : null
                return { records, total, continuation }
          ```

- [ ] **Step 10: Wire the cursor into the Postgres store.** In
      `packages/memory-pgvector/src/pgvector-store.ts`, add
      `browseCursorKey, browseQueryFingerprint, decodeBrowseCursor, encodeBrowseCursor,` to the
      `@dawn-ai/memory` import block and `pgKeysetWhere` to the `./browse-sql.js` import, then
      replace everything from `const clause = …` to the `return` with:
      ```ts
      const filterParamCount = params.length
      const countClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""

            const fingerprint = browseQueryFingerprint(q)
                const rowWhere = [...where]
                if (q.cursor) {
                  const payload = decodeBrowseCursor(q.cursor, fingerprint, order.length)
                  rowWhere.push(pgKeysetWhere(order, payload, params))
                }
                const rowsClause = rowWhere.length > 0 ? `WHERE ${rowWhere.join(" AND ")}` : ""

                const limit = Math.max(0, Math.trunc(q.limit ?? BROWSE_DEFAULT_LIMIT))
                const offset = Math.max(0, Math.trunc(q.offset ?? 0))
                const rowsRes = await pool.query(
                  `SELECT ${RECORD_COLUMNS} FROM ${T} ${rowsClause}
                   ORDER BY ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                  [...params, limit, offset],
                )
                const totalRes = await pool.query(
                  `SELECT COUNT(*)::int AS n FROM ${T} ${countClause}`,
                  params.slice(0, filterParamCount),
                )
                const records = (rowsRes.rows as Record<string, unknown>[]).map(rowToRecord)
                const last = records.at(-1)
                const continuation =
                  last && records.length === limit
                    ? encodeBrowseCursor(fingerprint, { key: browseCursorKey(last, order), id: last.id })
                    : null
                return { records, total: (totalRes.rows[0] as { n: number }).n, continuation }
          ```
          (The two round-trips become one transaction in Task 15; leave them as-is here.)

- [ ] **Step 11: Both conformance runs — expect GREEN.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts && \
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    `
      Expected: 0 failed on both. Two failure modes to recognise: - a walk that never terminates or repeats a row on **Postgres only** → the `::real`
      cast is missing from the keyset chain (Step 5's `bind`); - `total` shrinking window by window → the keyset clause leaked into the COUNT.
- [ ] **Step 12: Prove the guard is doing its job.** From the worktree root:
      `bash
    node -e "
    const { DatabaseSync } = require('node:sqlite')
    " 2>/dev/null || true
    pnpm --filter @dawn-ai/memory exec node --input-type=module -e "
    import { DatabaseSync } from 'node:sqlite'
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE memories (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL)')
    db.exec('CREATE INDEX idx_mem_updated_id ON memories (updated_at DESC, id ASC)')
    const guarded = db.prepare(\"EXPLAIN QUERY PLAN SELECT id FROM memories WHERE updated_at <= ? AND (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id ASC LIMIT 200\").all('x','x','x','y')
    const unguarded = db.prepare(\"EXPLAIN QUERY PLAN SELECT id FROM memories WHERE (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id ASC LIMIT 200\").all('x','x','y')
    console.log('guarded  :', guarded.map(r => r.detail).join(' | '))
    console.log('unguarded:', unguarded.map(r => r.detail).join(' | '))
    "
    `
      Expected: the guarded plan says `SEARCH memories USING INDEX idx_mem_updated_id (updated_at<?)`
      while the unguarded one says `SCAN memories USING INDEX idx_mem_updated_id`. Paste both
      lines into the commit message. If the guarded plan also says SCAN, the guard is not
      being emitted first — recheck Step 4.
- [ ] **Step 13: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-browse-sql.ts packages/memory/src/sqlite-store.ts \
      packages/memory/test/sqlite-browse-sql.test.ts packages/memory-pgvector/src/browse-sql.ts \
      packages/memory-pgvector/src/pgvector-store.ts packages/memory-pgvector/test/browse-sql.test.ts \
      packages/testing/src/memory-conformance.ts
      git commit -m "feat(memory): keyset continuation with a redundant leading range guard

Offset paging over this write workload silently omits rows (an approve hoists a
row above the seam); keyset does not. Every page carries an opaque cursor
fingerprinted with its own query, so it can never be replayed elsewhere. The
guard is redundant logically and mandatory practically — EXPLAIN says SEARCH
with it and SCAN without. The COUNT deliberately never sees the cursor clause:
total is the whole matching set."
```

---

### Task 15: One snapshot for rows and total

**Files:**

- Modify: `packages/memory/src/sqlite-store.ts` (`browse`)
- Modify: `packages/memory-pgvector/src/pgvector-store.ts` (`browse`)
- Modify: `packages/testing/src/memory-conformance.ts`
- Test: both conformance runs

- [ ] **Step 1: Add the conformance test.** Append to
      `packages/testing/src/memory-conformance.ts`:
      ``ts
        test("browse reads records and total from ONE snapshot, even under concurrent writes", async () => {
          const s = await makeStore()
          try {
            for (let i = 0; i < 60; i += 1) {
              await s.put(rec({ id: `r${String(i).padStart(2, "0")}`, namespace: "ns", content: `r${i}` }))
            }
            // Two non-transactional statements can count 30 and return 60 (or the
            // reverse) when a delete lands between them, and the UI then renders
            // "60 loaded of 30 matching". Inside one snapshot that is unrepresentable.
            const [page] = await Promise.all([
              s.browse({ limit: 1000 }),
              (async () => {
                for (let i = 0; i < 30; i += 1) await s.delete(`r${String(i).padStart(2, "0")}`)
              })(),
            ])
            expect(page.records.length).toBe(page.total)
            // And the model converges on the next read.
            const after = await s.browse({ limit: 1000 })
            expect(after.total).toBe(30)
            expect(after.records.length).toBe(30)
          } finally {
            await close?.(s)
          }
        })
    ``
      Note this is a best-effort race on Postgres (it is trivially true on the synchronous
      SQLite store): it _can_ catch the skew, and the transaction is what _guarantees_ it.
- [ ] **Step 2: Run the gated Postgres conformance and see it fail (usually).**
      `bash
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    `
      Expected: `expected 60 to be 42` (or similar mismatch) in the new test. If it happens to
      pass, do not skip the implementation — run it two more times; the point of Step 3-4 is
      that the guarantee stops depending on scheduling.
- [ ] **Step 3: Wrap the SQLite pair in `BEGIN DEFERRED`.** In
      `packages/memory/src/sqlite-store.ts`, add this helper next to `openDb` (after line 29):
      `ts
    function rollbackQuietly(db: DatabaseSync): void {
      try {
        db.exec("ROLLBACK")
      } catch {
        // Swallow: propagate the root-cause error from the caller's catch instead.
      }
    }
    `
      Then wrap the two statements inside `browse`:
      ``ts
          // One WAL read snapshot across both statements, so `records` and `total` can
          // never describe different versions of the table. Cost is ~0 — there is no
          // write here — and nothing awaits between the two, so no other caller can
          // interleave on this single connection.
          db.exec("BEGIN DEFERRED")
          let rows: Record<string, unknown>[]
          let total: number
          try {
            rows = db
              .prepare(
                `SELECT id, kind, namespace, content, data, source, confidence, tags, status,
                        supersedes, created_at, updated_at, effective_at, expires_at
                 FROM memories ${rowsClause} ORDER BY ${orderSql} LIMIT ? OFFSET ?`,
              )
              .all(...params, limit, offset) as Record<string, unknown>[]
            total = (
              db
                .prepare(`SELECT COUNT(*) AS n FROM memories ${countClause}`)
                .get(...params.slice(0, filterParamCount)) as { n: number }
            ).n
            db.exec("COMMIT")
          } catch (err) {
            rollbackQuietly(db)
            throw err
          }
    ``
      (`COUNT(*) OVER ()` would collapse this to one statement and was measured and rejected:
      the window aggregate materializes the entire filtered set — 439 ms vs 5.3 ms at 1M rows
      — and destroys the lazy top-k path for the rows themselves. Say so in a comment.)
- [ ] **Step 4: Put the Postgres pair on one `REPEATABLE READ` client.** In
      `packages/memory-pgvector/src/pgvector-store.ts`, replace the two `pool.query` calls
      with:
      ``ts
          // READ COMMITTED takes a fresh snapshot per STATEMENT, which is exactly the skew
          // we are removing — so this pair runs on one client at REPEATABLE READ.
          const client = await pool.connect()
          let rowsRes: Awaited<ReturnType<typeof client.query>>
          let totalRes: Awaited<ReturnType<typeof client.query>>
          try {
            await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ")
            rowsRes = await client.query(
              `SELECT ${RECORD_COLUMNS} FROM ${T} ${rowsClause}
               ORDER BY ${orderSql} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
              [...params, limit, offset],
            )
            totalRes = await client.query(
              `SELECT COUNT(*)::int AS n FROM ${T} ${countClause}`,
              params.slice(0, filterParamCount),
            )
            await client.query("COMMIT")
          } catch (err) {
            await rollbackQuietly(client)
            throw err
          } finally {
            client.release()
          }
    ``
      `rollbackQuietly(client)` already exists at line 136.
- [ ] **Step 5: Both conformance runs — expect GREEN, three times in a row for Postgres.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/testing... && \
    pnpm --filter @dawn-ai/testing exec vitest --run --config vitest.config.ts test/sqlite-conformance.test.ts
    pnpm turbo run build --filter=@dawn-ai/memory-pgvector... && \
    for i in 1 2 3; do DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test || break; done
    `
      Expected: 0 failed every time. A `client.release()` that never runs shows up as the
      suite hanging at the end — check the `finally`.
- [ ] **Step 6: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/src/sqlite-store.ts packages/memory-pgvector/src/pgvector-store.ts \
      packages/testing/src/memory-conformance.ts
      git commit -m "feat(memory): read browse records and total from one transaction snapshot

sqlite BEGIN DEFERRED, Postgres one client at REPEATABLE READ. Every response is
now internally exact — 'N loaded of M matching' can no longer be two different
versions of the table. COUNT(*) OVER () was measured and rejected: it
materializes the whole filtered set and kills the lazy top-k path."
```

---

### Task 16: The HTTP boundary

**Files:**

- Create: `packages/inspector/src/store/browse-params.ts`
- Create: `packages/inspector/test/components/browse-params.test.ts`
- Modify: `packages/inspector/vitest.components.config.ts`
- Modify: `packages/inspector/app/api/memory/list/route.ts`
- Modify: `packages/inspector/test/api.e2e.test.ts`
- Test: decoder unit tests (fast) + the gated standalone e2e

> **Two traps.** (1) The route must **not** statically import `@dawn-ai/memory` — its barrel
> pulls `node:sqlite`, which is why `src/store/runtime-imports.ts` exists. The new
> `@dawn-ai/memory/browse` subpath is pure, so importing _that_ is safe and is the whole
> reason it exists. (2) The store is loaded through `importMemory()` from real
> `node_modules` while the decoder may be bundled — two module copies, so
> `error instanceof BrowseQueryError` can be false for a store-thrown error. Detect by
> `error.name` instead.

- [ ] **Step 1: Write the failing decoder test.** Create
      `packages/inspector/test/components/browse-params.test.ts` (this project's `include` is
      `test/components/**/*.test.{ts,tsx}`, and it already hosts non-JSX pure units like
      `column-filters.test.ts`):
      ```ts
      import { describe, expect, it } from "vitest"
      import { isBrowseQueryError, parseBrowseQuery } from "../../src/store/browse-params"

      const parse = (qs: string, now?: string) =>
            parseBrowseQuery(new URLSearchParams(qs), now === undefined ? {} : { now })

          describe("parseBrowseQuery", () => {
            it("defaults to limit 50 and no filters", () => {
              expect(parse("")).toEqual({ limit: 50, offset: 0 })
            })
            it("keeps the existing scalar and repeated params working", () => {
              expect(parse("status=active&status=candidate&kind=episodic&sourceType=human&namespacePrefix=route%3D%2Fx&limit=200&offset=10")).toEqual({
                namespacePrefix: "route=/x",
                status: ["active", "candidate"],
                kind: ["episodic"],
                sourceType: "human",
                limit: 200,
                offset: 10,
              })
            })
            it("normalizes instants to full ISO-Z before validating", () => {
              expect(parse("since=2026-08-09T00:00:00%2B02:00").since).toBe("2026-08-08T22:00:00.000Z")
            })
            it("threads `now` so expired rows are hidden unless includeExpired=1", () => {
              expect(parse("", "2026-08-09T00:00:00.000Z").now).toBe("2026-08-09T00:00:00.000Z")
              expect(parse("includeExpired=1", "2026-08-09T00:00:00.000Z").now).toBeUndefined()
            })
            it("lets the caller pin `now` so one walk holds it across every page", () => {
              // `now` is part of the cursor fingerprint, so a `now` stamped per request would
              // reject every continuation the previous request issued.
              expect(parse("now=2026-01-02T03:04:05.000Z", "2026-08-09T00:00:00.000Z").now).toBe("2026-01-02T03:04:05.000Z")
              expect(parse("now=2026-01-02T03:04:05%2B02:00", "2026-08-09T00:00:00.000Z").now).toBe("2026-01-02T01:04:05.000Z")
              expect(parse("now=2026-01-02T03:04:05.000Z&includeExpired=1").now).toBeUndefined()
            })
            it("decodes the new JSON params", () => {
              const filters = [{ field: "content", op: "contains", value: "acme" }]
              const orderBy = [{ field: "confidence", dir: "desc" }]
              const query = parse(
                `namespace=route%3D%2Fx&cursor=abc&filters=${encodeURIComponent(JSON.stringify(filters))}&orderBy=${encodeURIComponent(JSON.stringify(orderBy))}`,
              )
              expect(query.namespace).toBe("route=/x")
              expect(query.cursor).toBe("abc")
              expect(query.filters).toEqual(filters)
              expect(query.orderBy).toEqual(orderBy)
            })
            it("omits offset entirely when a cursor is supplied", () => {
              expect(parse("cursor=abc").offset).toBeUndefined()
            })
            it("dedupes a repeated enum value so one narrowing has one spelling", () => {
              expect(parse("status=active&status=active&status=candidate").status).toEqual(["active", "candidate"])
            })
          })

          describe("parseBrowseQuery — rejections", () => {
            const rejects = (qs: string, match: RegExp) => {
              try {
                parse(qs)
                expect.unreachable(`expected ${qs} to be rejected`)
              } catch (error) {
                expect(isBrowseQueryError(error)).toBe(true)
                expect((error as Error).message).toMatch(match)
              }
            }
            it("rejects unknown enum values", () => rejects("status=bogus", /invalid status "bogus"/))
            it("rejects unparseable instants with the message the e2e pins", () =>
              rejects("since=notadate", /invalid since "notadate"/))
            it("rejects an unparseable pinned now", () => rejects("now=notadate", /invalid now "notadate"/))
            it("rejects malformed JSON params", () => rejects("filters=%7Bnot-json", /filters must be valid JSON/))
            it("hands a falsy JSON param to the validator rather than dropping it", () => {
              rejects("filters=0", /filters must be an array/)
              rejects("filters=null", /filters must be an array/)
              rejects("orderBy=false", /orderBy must be an array/)
            })
            it("rejects a cursor sent with a non-zero offset instead of ignoring the offset", () =>
              rejects("cursor=abc&offset=50", /cursor and a non-zero offset cannot be combined/))
            it("rejects a non-numeric limit", () => rejects("limit=abc", /limit must be a number/))
            it("enforces the 1000 ceiling that in-process callers are exempt from", () =>
              rejects("limit=5000", /limit must be at most 1000/))
            it("rejects an unknown sort field", () =>
              rejects(`orderBy=${encodeURIComponent(JSON.stringify([{ field: "content", dir: "asc" }]))}`, /unknown sort field/))
          })
          ```

- [ ] **Step 2: Alias the pure subpath in the components project.** In
      `packages/inspector/vitest.components.config.ts`, add above `test:`:
      ```ts
      import { dirname, resolve } from "node:path"
      import { fileURLToPath } from "node:url"

      const rootDir = dirname(fileURLToPath(import.meta.url))
          ```
          and inside the config object:
          ```ts
            resolve: {
              alias: {
                // Subpath alias only — the bare "@dawn-ai/memory" specifier must stay resolving
                // to the built package (its barrel pulls node:sqlite and has no business in a
                // jsdom project). Mirrors packages/cli/vitest.config.ts:18-20.
                "@dawn-ai/memory/browse": resolve(rootDir, "../memory/src/browse.ts"),
              },
            },
          ```

- [ ] **Step 3: Run the decoder test and see it fail.**
      `pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/browse-params.test.ts`
      Expected: `Failed to resolve import "../../src/store/browse-params"`.
- [ ] **Step 4: Create the decoder.** Create `packages/inspector/src/store/browse-params.ts`:
      ```ts
      import {
      BROWSE_DEFAULT_LIMIT,
      BROWSE_MAX_LIMIT,
      type BrowseFilter,
      type BrowseQuery,
      type BrowseSortEntry,
      BrowseQueryError,
      validateBrowseQuery,
      } from "@dawn-ai/memory/browse"

      /**
           * Recognise a rejection from the shared validator WITHOUT `instanceof`.
           *
           * The store is loaded through `importMemory()` from real node_modules while this
           * module may be bundled by Next — two copies of the class, so `instanceof` is false
           * for anything the store throws (a bad continuation, for instance). The name is
           * stable across copies.
           */
          export function isBrowseQueryError(error: unknown): error is Error & { code?: string } {
            return error instanceof Error && error.name === "BrowseQueryError"
          }

          function parseInstant(value: string | null, name: string): string | undefined {
            if (value === null) return undefined
            // Normalize FIRST: the store compares these lexicographically against stored
            // full-ISO-Z text, so an offset form ("...+02:00") would window silently wrong.
            const parsed = Date.parse(value)
            if (!Number.isFinite(parsed))
              throw new BrowseQueryError(`invalid ${name} "${value}" (expected an ISO-8601 date-time)`)
            return new Date(parsed).toISOString()
          }

          function parseJsonParam<T>(value: string | null, name: string): T | undefined {
            if (value === null) return undefined
            try {
              return JSON.parse(value) as T
            } catch {
              throw new BrowseQueryError(`${name} must be valid JSON`)
            }
          }

          function parseCount(value: string | null, name: string, fallback: number): number {
            if (value === null) return fallback
            const parsed = Number(value)
            if (!Number.isFinite(parsed)) throw new BrowseQueryError(`${name} must be a number`)
            return parsed
          }

          /** A repeated param is a SET, so a duplicate is not a second narrowing. The cursor
           *  fingerprint is taken over this list, so leaving one in would give a single dataset
           *  two fingerprints and reject its own continuation. */
          function uniqueValues(values: readonly string[]): string[] {
            return [...new Set(values)]
          }

          /**
           * `URLSearchParams` → a validated `BrowseQuery`. Throws `BrowseQueryError`; the route
           * maps that to 400. Pure, so it is unit-tested without booting Next.
           */
          export function parseBrowseQuery(
            sp: URLSearchParams,
            opts: { readonly now?: string },
          ): BrowseQuery {
            const statuses = uniqueValues(sp.getAll("status"))
            const kinds = uniqueValues(sp.getAll("kind"))
            const namespace = sp.get("namespace")
            const namespacePrefix = sp.get("namespacePrefix")
            const sourceType = sp.get("sourceType")
            const cursor = sp.get("cursor")
            const rawOffset = sp.get("offset")
            // includeExpired=1 drops the expiry cutoff; a caller-pinned past `now` moves it. Both
            // reveal expired-but-unpruned rows to this local-only caller, the flag strictly more.
            const includeExpired = sp.get("includeExpired") === "1"
            const since = parseInstant(sp.get("since"), "since")
            const until = parseInstant(sp.get("until"), "until")
            // Pinned by the caller, not stamped per request: `now` is part of the cursor
            // fingerprint, so a fresh stamp on each page rejects the continuation the page before
            // it issued.
            const now = parseInstant(sp.get("now"), "now") ?? opts.now
            // Passed on even when falsy, so `filters=0` is the validator's "must be an array"
            // rather than a silently unfiltered 200.
            const filters = parseJsonParam<readonly BrowseFilter[]>(sp.get("filters"), "filters")
            const orderBy = parseJsonParam<readonly BrowseSortEntry[]>(sp.get("orderBy"), "orderBy")
            const query: BrowseQuery = {
              ...(namespace ? { namespace } : {}),
              ...(namespacePrefix ? { namespacePrefix } : {}),
              // A param that appears zero times is ABSENT, not an empty set — the store's
              // "empty matches nothing" rule is deliberately unreachable over HTTP.
              // The casts are `NonNullable`: under exactOptionalPropertyTypes the bare indexed
              // access carries `undefined`, which TS2375-rejects in a key only written when set.
              ...(statuses.length > 0 ? { status: statuses as NonNullable<BrowseQuery["status"]> } : {}),
              ...(kinds.length > 0 ? { kind: kinds as NonNullable<BrowseQuery["kind"]> } : {}),
              ...(sourceType ? { sourceType: sourceType as NonNullable<BrowseQuery["sourceType"]> } : {}),
              ...(since === undefined ? {} : { since }),
              ...(until === undefined ? {} : { until }),
              ...(includeExpired || now === undefined ? {} : { now }),
              ...(filters === undefined ? {} : { filters }),
              ...(orderBy === undefined ? {} : { orderBy }),
              ...(cursor ? { cursor } : {}),
              limit: parseCount(sp.get("limit"), "limit", BROWSE_DEFAULT_LIMIT),
              // Only the DEFAULT is conditional. An offset the caller actually sent alongside a
              // cursor has to reach the validator, which is the one place that pair is named.
              ...(cursor && rawOffset === null ? {} : { offset: parseCount(rawOffset, "offset", 0) }),
            }
            validateBrowseQuery(query, { maxLimit: BROWSE_MAX_LIMIT })
            return query
          }
          ```

- [ ] **Step 5: Run the decoder test and see it pass.**
      `pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/browse-params.test.ts`
      Expected: `Test Files 1 passed`.
- [ ] **Step 6: Rewrite the route around the decoder.** Replace the entire contents of
      `packages/inspector/app/api/memory/list/route.ts` with:
      ```ts
      import type { BrowseQuery } from "@dawn-ai/memory/browse"
      import { isBrowseQueryError, parseBrowseQuery } from "../../../../src/store/browse-params"
      import { assertLocalRequest } from "../../../../src/store/guard"
      import { storeOr500 } from "../../../../src/store/resolve"

      export const dynamic = "force-dynamic"

          /**
           * Browse the memory store.
           *
           * Every parameter is decoded and validated by the SHARED validator in
           * `@dawn-ai/memory/browse` — the same one the stores run defensively — so the HTTP
           * contract cannot drift from the store contract. `filters` and `orderBy` are
           * JSON-encoded; `cursor` is opaque. Note the import is the PURE `/browse` subpath:
           * a bare "@dawn-ai/memory" import here would drag node:sqlite into the Next bundle
           * (see src/store/runtime-imports.ts).
           *
           * A 400 body carries `code` beside `error`. Clients match on the code: the prose is the
           * only part that varies across the several ways one continuation can be wrong.
           */
          export async function GET(req: Request): Promise<Response> {
            const denied = assertLocalRequest(req)
            if (denied) return denied
            const sp = new URL(req.url).searchParams
            let query: BrowseQuery
            try {
              // Only a DEFAULT, and one that cannot walk: `now` is part of the cursor fingerprint,
              // so a caller paging through continuations pins its own.
              query = parseBrowseQuery(sp, { now: new Date().toISOString() })
            } catch (error) {
              if (isBrowseQueryError(error))
                return Response.json({ error: error.message, code: error.code }, { status: 400 })
              throw error
            }
            const resolved = await storeOr500()
            if (resolved instanceof Response) return resolved
            try {
              return Response.json(await resolved.store.browse(query))
            } catch (error) {
              // A store-side rejection (a stale or forged continuation, most likely) is a bad
              // request, not a server fault.
              if (isBrowseQueryError(error))
                return Response.json({ error: error.message, code: error.code }, { status: 400 })
              throw error
            }
          }
          ```

      > **`now` is a REQUEST parameter, not a route-internal stamp.** The route's
      > `new Date().toISOString()` is a first-page default only. `now` is part of the cursor
      > fingerprint (`browseQueryFingerprint`), so a caller walking pages must pin one `now`
      > across the whole walk or page 2 rejects the continuation page 1 issued. Any client
      > built on this route (slice 3) has to carry `now` alongside `cursor`.

- [ ] **Step 7: Add the gated e2e coverage.** In `packages/inspector/test/api.e2e.test.ts`,
      inside the `describe.skipIf(!gated)("memory JSON API", …)` block, after the existing
      `browse filters by namespacePrefix across namespaces` test, add:
      ```ts
      it("browse accepts JSON filters and orderBy, and reports a continuation", async () => {
      const filters = encodeURIComponent(JSON.stringify([{ field: "content", op: "contains", value: "acme" }]))
      const res = await fetch(`${server.base}/api/memory/list?filters=${filters}`)
      expect(res.status).toBe(200)
      const page = (await res.json()) as { records: MemoryRecord[]; total: number; continuation: string | null }
      expect(page.records.map((r) => r.id).sort()).toEqual(["active1", "cand1"])
      expect(page.total).toBe(2)
      expect(page.continuation).toBeNull()

          const orderBy = encodeURIComponent(JSON.stringify([{ field: "namespace", dir: "asc" }]))
              // ONE `now` for the whole walk: it is part of the cursor fingerprint, so letting the
              // route stamp a fresh one per request would reject the continuation it just issued.
              const walk = `orderBy=${orderBy}&limit=2&now=2026-08-09T00%3A00%3A00.000Z`
              const ordered = await fetch(`${server.base}/api/memory/list?${walk}`)
              const orderedPage = (await ordered.json()) as { records: MemoryRecord[]; continuation: string | null }
              // Pinned to the ids namespace-asc puts first, which the default updatedAt-desc order
              // does NOT (that leads with cand2) — otherwise a dropped `orderBy` would still pass.
              expect(orderedPage.records.map((r) => r.id)).toEqual(["active1", "cand1"])
              expect(orderedPage.continuation).not.toBeNull()

              const next = await fetch(
                `${server.base}/api/memory/list?${walk}&cursor=${encodeURIComponent(orderedPage.continuation as string)}`,
              )
              expect(next.status).toBe(200)
              const nextPage = (await next.json()) as { records: MemoryRecord[] }
              expect(nextPage.records.map((r) => r.id)).toEqual(["cand2", "other1"])
            })

            it("browse cannot walk a continuation unless the caller pins `now`", async () => {
              // The route's per-request stamp is a first-page default only: `now` is part of the
              // cursor fingerprint, so an unpinned walk rejects the continuation it was just handed.
              const orderBy = encodeURIComponent(JSON.stringify([{ field: "namespace", dir: "asc" }]))
              const first = await fetch(`${server.base}/api/memory/list?orderBy=${orderBy}&limit=2`)
              expect(first.status).toBe(200)
              const { continuation } = (await first.json()) as { continuation: string | null }
              expect(typeof continuation).toBe("string")
              // Far enough apart that the next request's stamp cannot land in the same millisecond.
              await new Promise((done) => setTimeout(done, 5))
              const next = await fetch(
                `${server.base}/api/memory/list?orderBy=${orderBy}&limit=2&cursor=${encodeURIComponent(continuation as string)}`,
              )
              expect(next.status).toBe(400)
              expect((await next.json()) as { error: string; code: string }).toMatchObject({ code: "continuation-invalid" })
            })

            it("browse narrows to an exact namespace", async () => {
              const res = await fetch(`${server.base}/api/memory/list?namespace=${encodeURIComponent("route=/other")}`)
              const page = (await res.json()) as { records: MemoryRecord[]; total: number }
              expect(page.records.map((r) => r.id)).toEqual(["other1"])
              expect(page.total).toBe(1)
            })

            it("browse rejects malformed filters, bad sorts, oversized limits and forged cursors", async () => {
              const badJson = await fetch(`${server.base}/api/memory/list?filters=%7Bnope`)
              expect(badJson.status).toBe(400)
              expect(((await badJson.json()) as { error: string }).error).toContain("filters must be valid JSON")

              const badSort = encodeURIComponent(JSON.stringify([{ field: "content", dir: "asc" }]))
              const sortRes = await fetch(`${server.base}/api/memory/list?orderBy=${badSort}`)
              expect(sortRes.status).toBe(400)
              expect(((await sortRes.json()) as { error: string }).error).toContain("unknown sort field")

              const overLimit = await fetch(`${server.base}/api/memory/list?limit=5000`)
              expect(overLimit.status).toBe(400)
              expect(((await overLimit.json()) as { error: string }).error).toContain("at most 1000")

              const forged = await fetch(`${server.base}/api/memory/list?cursor=not-a-real-cursor`)
              expect(forged.status).toBe(400)
              // Pinned on the CODE, not the prose: `continuation-invalid` is the BrowseQueryError's
              // `code`, never part of its message (see browse-cursor.ts `invalid()`), and a
              // continuation can be wrong several ways that share that one stable name.
              expect((await forged.json()) as { error: string; code: string }).toMatchObject({ code: "continuation-invalid" })
            })
          ```

- [ ] **Step 8: Update the existing page-shape assertions.** In the same file, the
      `browse lists all records with total` test (line 82) and its siblings type the body as
      `{ records; total }`. Add `continuation: string | null` to those inline types where the
      compiler complains; do not weaken any existing assertion.
- [ ] **Step 9: Build the standalone server and run the gated e2e.**
      `bash
    pnpm turbo run build --filter=@dawn-ai/inspector... && \
    DAWN_TEST_INSPECTOR=1 pnpm --filter @dawn-ai/inspector test
    `
      Expected: 0 failed. Two failures to recognise: - the build failing on `node:sqlite` → something imported the bare `@dawn-ai/memory`
      instead of `@dawn-ai/memory/browse`; - `continuation-invalid` coming back as a 500 → `isBrowseQueryError` is checking
      `instanceof` somewhere instead of the name (the two-copies trap).
- [ ] **Step 10: Confirm the UI still works untouched.** The list page still sends
      `limit=200` and reads `{records, total}` — `continuation` is additive JSON it ignores.
      `bash
    pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts
    `
      Expected: all component tests pass. This slice deliberately changes **no** UI.
- [ ] **Step 11: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/inspector/src/store/browse-params.ts packages/inspector/app/api/memory/list/route.ts \
      packages/inspector/vitest.components.config.ts packages/inspector/test/components/browse-params.test.ts \
      packages/inspector/test/api.e2e.test.ts
      git commit -m "feat(inspector): decode and validate the extended browse query at the HTTP boundary

filters/orderBy arrive as JSON params, cursor as an opaque string, namespace as
an exact match — all checked by the SAME validator the stores run, so the HTTP
contract cannot drift from the store contract. The 1..1000 limit ceiling is
enforced here, which is where untrusted input actually is. No UI change."
```

---

### Task 17: The reproducible store bench

§5.5 requires the benchmark scripts behind its plan table to be committed **with this slice**
so the baselines stay rerunnable. This is a script, not a test — it asserts nothing and runs
in no CI lane.

**Files:**

- Create: `packages/memory/bench/browse-plans.mts`
- Modify: `packages/memory/package.json` (lint glob)

- [ ] **Step 1: Create the bench script.** Create `packages/memory/bench/browse-plans.mts`:
      ```ts
      // Reproducible baselines for docs/superpowers/specs/2026-08-09-server-controlled-exploration-design.md §5.5.
      //
      // pnpm --filter @dawn-ai/memory build
      // node packages/memory/bench/browse-plans.mts [rowCount]
      //
      // Seeds rows with a direct bulk insert (the store's put() also tokenizes, which is
      // irrelevant here and 50x slower), then times the query shapes the design measured and
      // prints the SQLite plan for the guarded vs unguarded keyset.
      import { mkdtempSync, rmSync } from "node:fs"
      import { tmpdir } from "node:os"
      import { join } from "node:path"
      import { DatabaseSync } from "node:sqlite"
      import { sqliteMemoryStore } from "../dist/index.js"

      const rowCount = Number(process.argv[2] ?? 100_000)
          const dir = mkdtempSync(join(tmpdir(), "dawn-bench-"))
          const path = join(dir, "bench.sqlite")

          function seed(): void {
            const db = new DatabaseSync(path)
            const insert = db.prepare(
              `INSERT INTO memories
                 (id,kind,namespace,content,data,source,confidence,tags,status,supersedes,created_at,updated_at,effective_at,expires_at)
               VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,NULL)`,
            )
            const kinds = ["semantic", "episodic", "procedural", "reflection"]
            const statuses = ["candidate", "active", "superseded"]
            db.exec("BEGIN")
            for (let i = 0; i < rowCount; i += 1) {
              const stamp = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()
              insert.run(
                `r${String(i).padStart(9, "0")}`,
                kinds[i % kinds.length] as string,
                `route=/ns${i % 500}`,
                i % 9973 === 0 ? `rare needle ${i}` : `common filler content ${i}`,
                "{}",
                '{"type":"eval","id":"bench"}',
                (i % 100) / 100,
                "[]",
                statuses[i % statuses.length] as string,
                stamp,
                stamp,
              )
            }
            db.exec("COMMIT")
            db.close()
          }

          async function time(label: string, run: () => Promise<unknown>): Promise<void> {
            await run() // warm
            const started = performance.now()
            for (let i = 0; i < 5; i += 1) await run()
            console.log(`${label.padEnd(44)} ${((performance.now() - started) / 5).toFixed(2)} ms`)
          }

          function plan(label: string, sql: string, params: string[]): void {
            const db = new DatabaseSync(path)
            try {
              const rows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]
              console.log(`${label.padEnd(44)} ${rows.map((r) => r.detail).join(" | ")}`)
            } finally {
              db.close()
            }
          }

          try {
            const store = sqliteMemoryStore({ path })
            seed()
            console.log(`rows: ${rowCount}\n`)

            const first = await store.browse({ limit: 200 })
            await time("default order, limit 200", () => store.browse({ limit: 200 }))
            await time("keyset continuation, limit 200", () =>
              store.browse({ limit: 200, cursor: first.continuation as string }),
            )
            await time("status IN + default order", () =>
              store.browse({ limit: 200, filters: [{ field: "status", op: "in", values: ["active"] }] }),
            )
            await time("non-default sort (confidence DESC)", () =>
              store.browse({ limit: 200, orderBy: [{ field: "confidence", dir: "desc" }] }),
            )
            await time("content contains, rare term", () =>
              store.browse({ limit: 200, filters: [{ field: "content", op: "contains", value: "rare needle 9973" }] }),
            )
            await time("namespace prefix as byte range", () => store.browse({ limit: 200, namespacePrefix: "route=/ns1" }))
            await time("namespace exact", () => store.browse({ limit: 200, namespace: "route=/ns1" }))

            console.log("")
            const stamp = "2026-01-02T00:00:00.000Z"
            plan(
              "keyset WITH the leading guard",
              "SELECT id FROM memories WHERE updated_at <= ? AND (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id ASC LIMIT 200",
              [stamp, stamp, stamp, "r000000001"],
            )
            plan(
              "keyset WITHOUT the leading guard",
              "SELECT id FROM memories WHERE (updated_at < ? OR (updated_at = ? AND id > ?)) ORDER BY updated_at DESC, id ASC LIMIT 200",
              [stamp, stamp, "r000000001"],
            )
          } finally {
            rmSync(dir, { recursive: true, force: true })
          }
          ```

- [ ] **Step 2: Include `bench` in the package's lint glob.** In
      `packages/memory/package.json`, change the `lint` script to
      `"biome check --config-path ../config-biome/biome.json package.json bench src tsconfig.json vitest.config.ts"`.
      (`tsconfig.json` still includes `src/**/*.ts` only — the bench imports `dist`, so it is
      deliberately outside the typecheck graph.)
- [ ] **Step 3: Run the bench at 100k.**
      `bash
    pnpm --filter @dawn-ai/memory build && node packages/memory/bench/browse-plans.mts 100000
    `
      Expected: seeding takes a few seconds, then a timing table and two plan lines. The
      guarded plan must read `SEARCH memories USING INDEX idx_mem_updated_id (updated_at<?)`
      and the unguarded one `SCAN memories USING INDEX idx_mem_updated_id`.
- [ ] **Step 4: Compare against the design's table and record the result.** §5.5 expects, at
      100k: default-order window ~0.5 ms, filtered COUNT ~5 ms, non-default sort ~13 ms,
      content contains ~46 ms, namespace prefix ~0.6 ms. Note your numbers in the commit
      message. An order-of-magnitude miss on the default-order window means the new index is
      not being used — go back to Task 10 before continuing.
- [ ] **Step 5: Lint and commit.**
      ```bash
      pnpm lint
      git add packages/memory/bench/browse-plans.mts packages/memory/package.json
      git commit -m "chore(memory): commit the browse bench behind the design's plan table

Seeds a synthetic store and times the query shapes §5.5 measured, plus the
EXPLAIN QUERY PLAN proof that the redundant leading guard turns a full index
scan into a seek. Not a test — it asserts nothing and runs in no CI lane."
```

---

### Task 18: Changeset

**Files:**

- Create: `.changeset/browse-query-contract.md`

- [ ] **Step 1: Write the changeset.** Create `.changeset/browse-query-contract.md`:
      ```markdown
      \---
      "@dawn-ai/memory": minor
      "@dawn-ai/memory-pgvector": minor
      "@dawn-ai/core": minor
      "@dawn-ai/testing": minor
      "@dawn-ai/inspector": minor
      \---

      `BrowseQuery` grows a real query language, and `BrowsePage` grows a continuation.

          **Breaking for anyone who implements `MemoryStore` themselves.** `BrowsePage.continuation`
          is required, and `browse` must now honor `filters`, `namespace`, `orderBy` and `cursor`.
          Run `runMemoryStoreConformance` from `@dawn-ai/testing`: it is the definition of the new
          obligations, and it runs against SQLite in-process and against a real Postgres behind
          `DAWN_TEST_PGVECTOR=1`. Both bundled stores are updated.

          New on `BrowseQuery`:

          - `filters` — AND-combined normalized predicates, at most one per field and eight in
            total: `status`/`kind` (`in`/`notIn`), `content`
            (`contains`/`notContains`/`equals`/`notEquals`/`startsWith`/`endsWith`, case-insensitive
            substring — not LIKE, so `%` and `_` are literal), `namespace` (`equals`/`startsWith`,
            byte-exact), `confidence` (comparisons plus an inclusive `between`), and `updatedAt`
            (`onDay`/`beforeDay`/`afterDay`/`betweenDays` over UTC day buckets).
          - `namespace` — an EXACT namespace, distinct from the prefix. `namespacePrefix` keeps its
            byte-exact semantics and is now a sargable range instead of a `substr()` scan.
          - `orderBy` — up to three entries over a closed whitelist
            (`updatedAt`/`createdAt`/`confidence`/`namespace`/`kind`/`status`), always terminated by
            an `id` tie-break so every window is deterministic. Absent or empty is still
            `updated_at DESC`.
          - `cursor` — an opaque keyset continuation. It carries a fingerprint of the query that
            issued it, so replaying it against a different filter or sort is rejected rather than
            silently answering the wrong question.

          `BrowsePage.total` is now read from the same transaction snapshot as `records` (SQLite
          `BEGIN DEFERRED`, Postgres `REPEATABLE READ`), so a response can no longer report rows and
          a count from two different versions of the table. It remains the size of the whole
          matching set, never what is left after a cursor.

          `validateBrowseQuery` is exported (also from the pure `@dawn-ai/memory/browse` subpath,
          which never pulls `node:sqlite`). Both stores run it defensively and throw; the Inspector's
          list route runs it at the HTTP boundary and returns 400. An unknown enum value used to
          match zero rows and look like an empty dataset — now it is an error. `limit` is bounded to
          1..1000 at the HTTP boundary only; in-process callers such as the CLI's consolidation scan
          are unaffected.

          `@dawn-ai/core`'s structural mirror is now the named `BrowseQueryLike` / `BrowsePageLike`
          (plus `BrowseFilterLike` / `BrowseSortEntryLike`), compared directly by the contract-parity
          tripwire. The previous inline shape drifted silently because method parameters are checked
          bivariantly.

          Both backends gain an index on the global browse order (`updated_at DESC, id ASC`);
          Postgres also gains a C-collated namespace index so the prefix range is sargable there.
          ```

- [ ] **Step 2: Verify changesets accepts it.**
      `pnpm exec changeset status --since=origin/main`
      Expected: it lists the five packages with a `minor` bump (the fixed group will carry the
      rest along at version time).
- [ ] **Step 3: Commit.**
      `bash
    git add .changeset/browse-query-contract.md
    git commit -m "chore: changeset for the browse query contract"
    `

---

### Task 19: Full verification sweep and PR

**Files:** none expected; fix-ups only.

- [ ] **Step 1: Re-check `origin/main` for parallel work.** Concurrent sessions are normal in
      this repo:
      `bash
    git fetch origin && git log --oneline HEAD..origin/main
    `
      If anything landed, rebase (`git rebase origin/main`) and re-run the sweep from Step 2.
      Pay particular attention to any new `MemoryStore` implementation or new `browse` caller.
- [ ] **Step 2: Run the whole local validation chain.**
      `bash
    pnpm lint && pnpm build && pnpm typecheck && pnpm test
    `
      Expected: all four exit 0. `pnpm test` runs every vitest project through
      `vitest.workspace.ts`.
- [ ] **Step 3: Run both gated lanes exactly as CI does.**
      `bash
    pnpm build
    DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test
    pnpm turbo run build --filter=@dawn-ai/inspector...
    DAWN_TEST_INSPECTOR=1 pnpm --filter @dawn-ai/inspector test
    `
      Expected: 0 failed in both.
- [ ] **Step 4: Confirm the public surface is what you intended.** There is no api-extractor,
      so read the barrels:
      `bash
    node -e "import('@dawn-ai/memory').then(m => console.log(Object.keys(m).sort().join('\n')))"
    node -e "import('@dawn-ai/memory/browse').then(m => console.log(Object.keys(m).sort().join('\n')))"
    pnpm pack:check
    `
      Expected: `validateBrowseQuery`, `BrowseQueryError`, `BROWSE_MAX_LIMIT`,
      `BROWSE_DEFAULT_LIMIT`, `BROWSE_SORT_FIELDS`, `resolveBrowseOrder`,
      `DEFAULT_BROWSE_ORDER`, `namespacePrefixUpperBound`, `utcDayStart`, `utcDayAfter`,
      `encodeBrowseCursor`, `decodeBrowseCursor`, `browseQueryFingerprint`, `browseCursorKey`,
      `BROWSE_CURSOR_VERSION`, `normalizeSetFilter` on both; `sqliteMemoryStore` on the barrel
      only. `pack:check` green.
- [ ] **Step 5: Verify the slice boundary held.** This slice must contain **zero** Inspector UI
      changes (that is slice 4):
      `bash
    git diff --stat origin/main -- packages/inspector/src/components packages/inspector/app
    `
      Expected: only `app/api/memory/list/route.ts`. If any file under
      `src/components/memory/` appears, it does not belong in this slice — move it out.
- [ ] **Step 6: Read the whole diff once.**
      `git diff origin/main --stat && git diff origin/main -- packages/memory packages/memory-pgvector | less`
      Check specifically: no user-derived string reaches a SQL identifier position; the COUNT
      query never carries the keyset clause; every `client.release()` is in a `finally`.
- [ ] **Step 7: Push and open the PR.**
      ```bash
      git push -u origin blove/dawn-browse-query-contract
      gh pr create --title "feat(memory): server-controlled browse query contract (slice 2)" \
      --body "$(cat <<'BODY'
      Slice 2 of the server-controlled data exploration design
      (`docs/superpowers/specs/2026-08-09-server-controlled-exploration-design.md` §5, §6.2, §13).

      Store and query only — **no Inspector UI changes** (slice 4).

          - `BrowseQuery` gains normalized `filters`, exact `namespace`, whitelisted `orderBy` and an
            opaque `cursor`; `BrowsePage` gains `continuation`.
          - Shared `validateBrowseQuery` runs at the HTTP boundary (400) and defensively in both
            stores (throw).
          - Keyset paging with the redundant leading range guard (EXPLAIN: SEARCH with it, SCAN
            without) and an `id` tie-break; rows and total come from one transaction snapshot.
          - New `(updated_at DESC, id ASC)` index on both backends; sargable namespace prefix range.
          - `@dawn-ai/core`'s mirror is now named and compared directly by the parity tripwire, so
            the drift that shipped in #432 cannot recur.

          Conformance runs against SQLite always and real Postgres behind `DAWN_TEST_PGVECTOR=1`.
          BODY
          )"
          ```

- [ ] **Step 8: Watch CI and merge on green.**
      `gh pr checks --watch`
      Expected: every required check green, including the `pgvector-docker` and inspector e2e
      lanes. Merge only on green.

---

## Appendix: things that will bite you

- **Stale `dist/`.** `@dawn-ai/testing` and `@dawn-ai/memory-pgvector` typecheck and run against
  `@dawn-ai/memory`'s **built** output. A conformance test that "passes" without a rebuild may be
  testing the old contract. Always `pnpm turbo run build --filter=<pkg>...` first.
- **The COUNT must not see the cursor.** The single most likely correctness regression in this
  slice: `total` silently becomes "rows remaining" and every count in the UI is wrong.
- **`COLLATE "C"` on `updated_at` breaks the index.** It looks like extra safety and it is a
  performance regression: the DDL is uncollated, so a collated ORDER BY stops matching it.
- **float4.** Postgres `confidence` is `real`. Every parameter compared against it needs
  `::real`, including cursor keys. Symptom: a keyset walk that repeats or stalls on Postgres
  only.
- **Two module copies in Next.** The route's decoder may be bundled while the store is loaded
  from `node_modules`; `instanceof BrowseQueryError` is unreliable across that boundary. Check
  `error.name`.
- **Never work in `/Users/blove/repos/dawn`.** It is dirty and owned by another session, and the
  git stash stack is shared across worktrees.
