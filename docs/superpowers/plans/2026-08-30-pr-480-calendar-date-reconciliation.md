# PR #480 Canonical Calendar Dates Reconciliation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct PR #480 on Pretable 0.13 so canonical calendar dates remain one strict, coherent engine and presentation contract, with current architecture, packaging, browser smoke coverage, and migration documentation.

**Architecture:** Retain the approved `YYYY-MM-DD | null` calendar-date domain and the private `@pretable-internal/calendar-date` primitive shared by the incremental row model and React. Replay the feature commits onto latest `main`, but resolve every conflict in favor of current 0.13 ownership: filter trees and synchronous fast paths stay in the row model, UI/tool-panel state stays in current React seams, and public packages keep the tsdown dual-format build contract. Diagnose all failures from evidence; new fixes follow RED-GREEN-REFACTOR.

**Tech Stack:** TypeScript 6, React 18/19, Vitest, Testing Library, Playwright, pnpm workspaces, tsdown, API Extractor, publint, Are the Types Wrong.

---

## Reassessment decision

The feature remains appropriate. The old implementation is not merged as a stale tree and is not closed as obsolete. It is partially replaced through a linear reconstruction on `origin/main`:

- treat `docs/superpowers/specs/2026-08-11-calendar-date-semantics-and-formatting-design.md` from `blove/calendar-date-formatting-design` as the approved contract; the Aug-18 spec/plan on `origin/pr-480` are historical implementation evidence and are not replayed as authority;
- preserve the strict date value contract, shared private primitive, typed query/aggregate semantics, native formatting, editing behavior, and existing focused tests;
- where the old PR differs from the approved contract, follow the approved contract: stored values remain exact and untrimmed, while user-entered editor text may be trimmed before strict validation;
- preserve every current-main behavior added after the PR base, especially filter trees, external authority, grouped-column identity, sync derivation fast paths, edit/paste guards, tool-panel state, scroll authority, Node 24, and tsdown packaging;
- regenerate API reports, generated examples, lockfile data, and build metadata from current tooling rather than resolving generated conflicts by hand;
- keep React peer support at `^18.0.0 || ^19.0.0` and prove both CJS and ESM packed consumers;
- treat the old preview-smoke failure as a defect hypothesis to reproduce after reconstruction, not as evidence that the feature contract is invalid.

## Task 1: Establish exact baseline and branch history

**Files:**

- Read: `.github/workflows/ci.yml`
- Read: `CONTRIBUTING.md`
- Read: `apps/website/AGENTS.md`
- Read: `apps/website/CLAUDE.md`
- Read: PR #480 timeline, reviews, comments, commits, check runs, and failed smoke logs

- [x] **Step 1: Fetch current main and PR refs**

  Run: `git fetch --prune origin && git fetch origin pull/480/head:refs/remotes/origin/pr-480`

  Expected: `origin/main` and `origin/pr-480` resolve locally.

- [x] **Step 2: Confirm isolation and attach a latest-main branch**

  Run: `git switch -c blove/pr-480-canonical-calendar-dates origin/main`

  Expected: clean branch tracking current `origin/main`.

- [x] **Step 3: Install with the pinned toolchain**

  Run: `source ~/.nvm/nvm.sh && nvm use 24.19.0 && pnpm install --frozen-lockfile`

  Expected: no lockfile changes.

- [x] **Step 4: Run the full baseline**

  Run: `pnpm test`

  Expected: package suites pass. If website tests time out under host contention, rerun serially and then rerun each residual file alone before classifying the result.

- [x] **Step 5: Record merge conflicts without touching the worktree**

  Run: `git merge-tree --write-tree origin/main origin/pr-480`

  Expected: a bounded conflict list identifying current architecture seams.

## Task 2: Reconstruct the feature test-first on main

**Files:**

- Create: `packages/calendar-date/**`
- Modify: `packages/row-model/package.json`
- Modify: `packages/row-model/src/column-types.ts`
- Modify: `packages/row-model/src/compiled-query.ts`
- Modify: `packages/row-model/src/cooperative-transition.ts`
- Modify: `packages/row-model/src/distinct-values.ts`
- Modify: `packages/row-model/src/errors.ts`
- Modify: `packages/row-model/src/query-equality.ts`
- Modify: `packages/row-model/src/group-index.ts`
- Modify: `packages/row-model/src/persistent/aggregate-tree.ts`
- Modify: `packages/row-model/src/transaction-draft.ts`
- Modify: `packages/row-model/src/types.ts`
- Modify: `packages/grid-core/src/types.ts`
- Modify: `packages/core/package.json`
- Modify: `packages/core/src/public_api.ts`
- Modify: `packages/core/tsdown.config.ts`
- Modify: `packages/core/src/__tests__/build-config.test.ts`
- Modify/Create: `packages/core/src/__tests__/calendar-date.test.ts`
- Modify: `packages/react/package.json`
- Modify: `packages/react/src/**`
- Modify: `packages/react/vitest.config.ts`
- Modify: `packages/react/tsconfig.build.json`
- Modify: `packages/react/tsconfig.typecheck.json`
- Modify: `type-tests/**`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Create the private package skeleton and regenerate the lockfile**

  Add only `package.json`, tsconfigs, empty source entry points, and workspace manifest edges needed for pnpm and TypeScript to resolve the package. Do not implement calendar behavior or public exports.

  Run: `pnpm install && pnpm install --frozen-lockfile`

  Expected: the first command records the new workspace graph in `pnpm-lock.yaml`; the second proves the committed graph is frozen-installable.

- [ ] **Step 2: Port primitive, public-export, and bundling tests**

  Copy the approved boundary/property tests from the old PR, plus `packages/core/src/__tests__/calendar-date.test.ts`, and change `packages/core/src/__tests__/build-config.test.ts` to require the third bundled private engine. Add only compileable `not implemented` stubs if necessary to turn module-load errors into assertion failures.

  Run: `pnpm --filter @pretable-internal/calendar-date test && pnpm --filter @pretable/core exec vitest run src/__tests__/calendar-date.test.ts src/__tests__/build-config.test.ts`

  Expected: RED because validation/arithmetic/public export/current tsdown bundling are not implemented.

- [ ] **Step 3: Implement the private primitive and current workspace edges**

  Add the package, current tsconfigs, row-model/core/React dev-dependency edges, and current tsdown bundling policy. Do not restore `tsup.config.ts`.

  Run: `pnpm install --frozen-lockfile && pnpm --filter '@pretable-internal/calendar-date...' build && pnpm --filter @pretable-internal/calendar-date test && pnpm --filter @pretable/core test`

  Expected: strict shape, leap year, low-year UTC conversion, bounded arithmetic, and public re-export tests pass.

- [ ] **Step 4: Port row-model date contract tests and verify RED**

  Port tests for typed columns, sorting, grouping, filters, distinct values, aggregates, type transitions, external authority, and fast-path parity before their implementation.

  Run: `pnpm --filter @pretable-internal/row-model exec vitest run src/__tests__/compiled-query.test.ts src/__tests__/flat-query.test.ts src/__tests__/grouping.test.ts src/__tests__/distinct-values.test.ts src/__tests__/calendar-date-aggregates.test.ts src/__tests__/transactions.test.ts src/__tests__/transitions.test.ts src/__tests__/types.test.ts`

  Expected: RED because current main still accepts mixed date values, uses mixed distinct/group semantics, and lacks date extrema.

- [ ] **Step 5: Implement row-model query and aggregate semantics**

  Resolve conflicts against the current filter tree, compiled predicate path, synchronous fast path, dense-handle derivation, scalar aggregate cells, and selected-root-only aggregation.

  Expected: no date code revives deleted row-model paths or bypasses current invalidation/work accounting.

- [ ] **Step 6: Run focused row-model tests**

  Run: `pnpm --filter @pretable-internal/row-model test`

  Expected: current 0.13 tests plus strict date sort/filter/group/distinct/aggregate/transition tests pass.

- [ ] **Step 7: Port React contract tests and verify RED**

  Port editor, paste, filter-menu, display, aggregate, copy, CSV, explicit-model, SSR, formatter-cache, and race tests first. Adjust old tests where the approved contract permits trimming typed editor input.

  Run: `pnpm --filter @pretable/react exec vitest run src/__tests__/date-cell-editor.test.tsx src/__tests__/date-utils.test.ts src/__tests__/type-parsing.test.ts src/__tests__/filter-menu.test.tsx src/__tests__/filter-menu-surface.test.tsx src/__tests__/date-formatters.test.ts src/__tests__/date-formatting-surface.test.tsx src/__tests__/value-formatting.test.ts src/__tests__/group-row-render.test.tsx src/__tests__/copy.test.ts src/__tests__/csv.test.ts src/__tests__/paste-surface.test.tsx src/__tests__/pretable-surface-editing.test.tsx src/__tests__/use-cell-edit-controller.test.ts`

  Expected: RED because current main lacks strict shared dates and native date formatting.

- [ ] **Step 8: Implement React editing and formatting**

  Resolve conflicts against current edit ownership, grouped column space, filter-tree UI, tool-panel state, locale/number formatter registry, copy/CSV paths, and tsdown build inputs.

  Expected: no current main edit, paste, external-authority, or presentation behavior is discarded.

- [ ] **Step 9: Run focused React tests**

  Run: `pnpm --filter @pretable/react test`

  Expected: strict editor, paste, filtering, display, aggregate, copy, CSV, controlled-state, and race tests pass.

- [ ] **Step 10: Port documentation and release metadata against current main**

  Resolve prose against current 0.13 docs. Regenerate example registry and API reports instead of retaining stale generated output.

  Expected: exactly one `minor` changeset naming `@pretable/core` and `@pretable/react`, beginning with explicit **Breaking** migration prose so the fixed group advances all four public packages; no roadmap rollback.

- [ ] **Step 11: Debug every unexpected failure systematically**

  For any cherry-pick-equivalent port, compile, unit, type, browser, or CI failure: reproduce, read the full error, compare the current working pattern, state one root-cause hypothesis, add a failing test when behavior is defective, and only then implement a fix.

## Task 3: Prove current architecture invariants

**Files:**

- Modify when tests expose a defect: `packages/row-model/src/**`
- Modify when tests expose a defect: `packages/react/src/**`
- Test: `packages/row-model/src/__tests__/**`
- Test: `packages/react/src/__tests__/**`
- Test: `type-tests/**`

- [ ] **Step 1: Run current type-performance and public-type gates**

  Run: `pnpm typecheck:performance && pnpm typecheck:public`

  Expected: unchanged performance budgets and correct date-only inference.

- [ ] **Step 2: Add a failing test for every newly found architectural defect**

  Test must fail for the intended reason before production code changes.

- [ ] **Step 3: Implement the minimum root-cause fix**

  Preserve filter-tree ownership, sync fast paths, external authority, edit-session provenance, and formatting cache invalidation.

- [ ] **Step 4: Verify green and refactor only while green**

  Run the smallest affected suite, then the containing package suite.

## Task 4: Reproduce and fix the preview-smoke failures

**Files:**

- Read/Test: `apps/website/e2e/smoke.spec.ts`
- Read/Test: `apps/website/e2e/server-data.spec.ts`
- Modify only if root cause is feature-related: affected React or website implementation/tests

- [ ] **Step 1: Reproduce focused smoke locally in Chromium and WebKit**

  Build and serve the current branch using the same production path as CI, then run the two historically failing specs in both projects.

  Expected: either green (superseded environmental failure) or a consistent failure with trace/error context.

- [ ] **Step 2: Trace the failing data flow**

  For guardrail editing: DOM event -> editor draft -> edit-session token -> validation/save -> alert render.

  For server data: page request -> fixture API -> row state -> rendered row ids.

- [ ] **Step 3: Write a focused failing regression test**

  Expected: test fails on the reconstructed branch before the fix and names the actual ownership/race defect.

- [ ] **Step 4: Apply the minimal fix and rerun focused browser tests**

  Expected: Chromium and WebKit pass without retries, weakened assertions, or increased arbitrary sleeps.

## Task 5: Update developer documentation and migration surface

**Files:**

- Modify: `README.md`
- Modify: `apps/website/content/docs/grid/date-formatting.mdx`
- Modify: related grid docs and API reference
- Modify/Create: developer-oriented example under `apps/website/content/examples/**`
- Modify: `apps/website/app/api/docs/rows/dataset.ts`
- Modify: `apps/website/app/api/docs/rows/__tests__/dataset.test.ts`
- Modify: `.changeset/calendar-dates-format-natively.md`

- [ ] **Step 1: Document the storage contract with boundary examples**

  Show canonical `YYYY-MM-DD | null`, valid/invalid examples, and an explicit business-zone decision for instant-to-date projection.

- [ ] **Step 2: Document processing and presentation separation**

  Show `type: "date"` for sorting/filtering/editing and `dateFormat` for localized display.

- [ ] **Step 3: Document breaking migrations**

  Include migrations from `Date`, epoch milliseconds, RFC 3339 date-times, localized strings, and invalid controlled filter operands. Do not present `toISOString().slice(0, 10)` without its UTC semantics.

- [ ] **Step 4: Document copy/export round-trip limits**

  Explain that localized copy output is presentation text and strict built-in paste accepts only canonical values unless application hooks own conversion.

- [ ] **Step 5: Verify docs types, registry, and browser coverage**

  Run website unit/type tests and focused docs Playwright tests in Chromium and WebKit.

## Task 6: Regenerate and verify all public artifacts

**Files:**

- Modify: `packages/core/core.api.md`
- Modify: `packages/react/react.api.md`
- Modify: generated example registry if needed

- [ ] **Step 1: Regenerate API reports**

  Run: `pnpm api`

  Expected: only intended date exports and column fields appear.

- [ ] **Step 2: Check generated registries**

  Run: `pnpm --filter @pretable/app-website examples:check`

  Expected: committed registry is current.

- [ ] **Step 3: Review the complete branch diff**

  Run: `git diff --check && git diff --stat origin/main...HEAD && git range-diff $(git merge-base origin/main origin/pr-480)..origin/pr-480 origin/main..HEAD`

  Expected: every dropped or replaced old commit is explainable; no unrelated main behavior is reverted.

## Task 7: Run the complete local release gate

- [ ] **Step 1: Format and lint**

  Run: `pnpm format && pnpm lint`

- [ ] **Step 2: Test**

  Run: `pnpm test`

- [ ] **Step 3: Typecheck**

  Run: `pnpm typecheck && pnpm typecheck:performance && pnpm typecheck:public`

- [ ] **Step 4: Build and API check**

  Run: `pnpm build && pnpm api:check`

- [ ] **Step 5: Package and consumer compatibility**

  Run: `pnpm lint:packaging && pnpm consumer:check && pnpm react:compat`

  Expected: ESM/CJS packed consumers and exact React 18/19 matrix pass; React 17 remains rejected.

- [ ] **Step 6: Publish preflight and security audit**

  Run: `pnpm publish:preflight && pnpm security:audit`

- [ ] **Step 7: Browser smoke**

  First run focused date/docs/smoke/server-data Chromium and WebKit projects against the production build. Then run the complete CI-equivalent production smoke suite in both Chromium and WebKit using the local production `BASE_URL`, because the old defect appeared only under full-suite load.

- [ ] **Step 8: Development StrictMode smoke**

  Start the current built-package website under `next dev` and run `e2e/dev-mode.spec.ts --project=chromium` with `PRETABLE_DEV_SMOKE=1`, matching the CI `dev-smoke` lane.

## Task 8: Update PR #480 and merge only on green

- [x] **Step 1: Disable the stale auto-merge request**

  Run: `gh pr merge 480 --disable-auto`

  Expected: `autoMergeRequest` is `null` before any branch rewrite.

- [ ] **Step 2: Verify exact remote target and push the reconstructed branch**

  Verify PR base `main`, head `blove/calendar-date-reconciliation`, and remote head SHA `68df10803a8714b8f0c1ee4dfd9240ee937ee5ea` (or deliberately refresh the expected SHA if it has moved). Push with `--force-with-lease=refs/heads/blove/calendar-date-reconciliation:<verified-sha>`.

- [ ] **Step 3: Replace the PR description**

  Include architecture, contract, migration examples, breaking changes, exact verification, and known baseline test-load note if still relevant.

- [ ] **Step 4: Request review**

  Request the repository's available reviewer(s) only after local verification is green.

- [ ] **Step 5: Wait for every required check**

  Inspect failures and rerun locally before fixing. Do not enable auto-merge while required checks are pending or failing.

- [ ] **Step 6: Enable squash auto-merge only when mergeable and green**

  Expected: PR reports clean mergeability and all required contexts succeed.
