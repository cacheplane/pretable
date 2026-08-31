# Rejecting an Invalid Query Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An invalid `query` prop arriving after mount becomes a rejected write — the grid keeps its previous query and stays interactive — instead of throwing out of a React commit and unmounting the subtree.

**Architecture:** The sibling of the derivations guard already on `main` (#550), in the same layout effect. One `try`/`catch` around `applyQuery`'s `rowModel.setQuery(desiredQuery)` call, detecting `CompiledQueryValidationError` by `name`. Two already-correct behaviours are preserved and pinned rather than changed.

**Tech Stack:** TypeScript, vitest (jsdom), changesets. No public API additions.

**Spec:** `docs/superpowers/specs/2026-08-27-invalid-derivations-are-rejected-design.md`, the **2026-08-31 amendment** (decisions 7–12). Read it first.

---

## Ground truth (measured on `59835a48`, 2026-08-31)

Two realistic faults were probed: a filter whose operator requires an operand and has none (`compiled-query.ts:957`), and a `rowGroups` entry naming a column that does not exist.

| Path | Result |
|---|---|
| Invalid query at **mount** | throws; grid never renders |
| Invalid query on the **`query` prop**, on update | **throws; rows 3 → 0, bytes 8702 → 0** |
| `grid.setQuery` while **controlled** | no throw, no change — correct, and documented at `pretable-model.ts:375-390` |
| `grid.setQuery` while **uncontrolled** | throws, **grid survives intact** — correct, a catchable throw from the consumer's own call |
| A later valid `query` prop after a rejection | recovers; rows back to 3 |

**The code today** (`packages/react/src/use-pretable.ts:596-616`):
```ts
if (controlledQueryChanged) {
  lastControlledQuery.current = rowsOptions.query;   // ← BEFORE applyQuery, as with derivations
}
if (derivationsApplied || controlledQueryChanged) {
  queryReconciliationGeneration.current += 1;
}
if ((derivationsApplied || controlledQueryChanged) && rowsOptions.query !== undefined) {
  const desiredQuery = rowsOptions.query;
  const generation = queryReconciliationGeneration.current;
  const applyQuery = () => {
    if (queryReconciliationGeneration.current !== generation) return;
    const transition = rowModel.setQuery(desiredQuery);
    void transition.finished.catch(() => undefined);
  };
  const pending = pendingDerivations.current;
  if (pending === null) applyQuery();
  else void pending.then(applyQuery, applyQuery);
}
```

**The asymmetry that must not be assumed away:** `applyQuery` runs **synchronously** when no derivations transition is pending, but is **chained with `.then()`** when one is. A throw on the chained path becomes an unhandled rejection, not an unmount — so the fatal signature only appears on the synchronous path. Guard both; do not write tests that assume the synchronous one.

**Reuse, do not reinvent:** the derivations guard and its `warnOnce` key already exist a few lines above in the same file (search for `CompiledQueryValidationError`). Match their shape, their comment style, and their key construction (`columnId` + index-stripped `path` + `detail`).

## File map

| File | Responsibility |
|---|---|
| `packages/react/src/use-pretable.ts` | the guard on `applyQuery` |
| `packages/react/src/__tests__/invalid-query-rejected.test.tsx` | new — rejection, recovery, no `onQueryChange`, and the two preserved behaviours |
| `.changeset/` | one `@pretable/react` patch changeset |

## Standing rules

**Node:** default here is v22.14.0 but the repo needs `^24.15.0` — prefix every command with `export PATH="/Users/blove/.nvm/versions/node/v24.19.0/bin:$PATH"` or nothing builds and `typecheck` reports bogus "Cannot find module '@pretable/core'". **Filter names:** `grid-core` and `row-model` are `@pretable-internal/*`; a wrong `--filter` **exits 0 having run nothing**. The react package's `test` script supplies `--environment jsdom`. **This repo's vitest reporter swallows `console.log`** — write probe output to a file. This box is often saturated by parallel sessions; re-run a single failure in isolation before believing it. TDD; mutation-check every assertion; never `git stash` / `git checkout` (the stash stack is shared across worktrees) — restore by targeted edit. No NUL bytes. Prettier before trusting a result.

---

### Task 1: guard `applyQuery`, and pin what is already correct

**Files:**
- Modify: `packages/react/src/use-pretable.ts` (`applyQuery`, ~`:608-612`)
- Create: `packages/react/src/__tests__/invalid-query-rejected.test.tsx`

Fixture: a grouped-or-plain grid rendering **3 data rows**, driven by a controlled `query` prop. Two invalid queries — `{filters:[{columnId:"sector",operator:"contains"}], sort:[], rowGroups:[]}` (missing operand) and `{filters:[],sort:[],rowGroups:[{columnId:"nope"}]}` (unknown column).

- [ ] **Step 1: Write the failing tests.** Assertions must **disprove** — assert the grid is *still rendering its 3 rows*, not merely that nothing threw; a destroyed grid renders nothing and would satisfy a no-throw check.
  1. `an invalid query on the prop is rejected, not fatal` — render good, assert 3 rows; rerender with the missing-operand query; assert **still 3 rows** and a non-zero container.
  2. Same for the unknown-column query (the two faults take different validation paths).
  3. `a valid query after a rejected one still lands` — good → invalid → a *narrowing but valid* query; assert the row count actually changes to the filtered count. Recovery is what decision 9 puts at risk.
  4. `a rejected query does not fire onQueryChange` — spy the prop; assert zero calls attributable to the rejection. (Decision 10.)
  5. `mount still throws` — pins decision 12 against a future "make it consistent".
  6. `an uncontrolled grid.setQuery still throws to its caller` — render with **no `query` prop**, call `grid.setQuery(invalid)`, assert it **throws** and the grid still renders 3 rows. This is a correct, catchable API error; swallowing it would be a regression. (Decision 12.)
- [ ] **Step 2: Run; confirm 1–4 fail for the right reason** (destroyed subtree / element not found), not a fixture mistake. Tests 5 and 6 should pass immediately — they document existing behaviour. **If 5 or 6 fails, STOP and report `BLOCKED`**: that means a behaviour the spec calls correct is already broken.
- [ ] **Step 3: Implement.** Guard the `setQuery` call inside `applyQuery` so **both** invocation paths are covered (the synchronous call and the `.then()`-chained one). Catch by `name`, `CompiledQueryValidationError` only; rethrow everything else. Do **not** roll back `lastControlledQuery.current` (decision 9 — mirror the derivations comment). Add the `warnOnce` report with the same key construction the derivations rejection uses.
- [ ] **Step 4: Green** — the new file, then the whole react package. Real counts.
- [ ] **Step 5: Mutation, four required.** Restore each by targeted edit.
  - Remove the `try`/`catch` → tests 1 and 2 must fail.
  - Widen the catch to all errors → prove a non-validation error still propagates; if nothing observable distinguishes swallowed from propagated, **add a test that pins it** and say so.
  - Roll back `lastControlledQuery.current` in the catch → add/keep an assertion that fails (count `setQuery` calls across renders after a rejection, mirroring the derivations recompile-once test).
  - Key the warning on a constant → a second, different fault must still warn.
- [ ] **Step 6: Commit** `fix(react): an invalid query update is rejected, not fatal`.

---

### Task 2: changeset and the battery

- [ ] **Step 1: Changeset.** `@pretable/react` **patch**. Read two recent `.changeset/*.md` first and match their voice. It must say: an invalid `query` arriving **on the prop after mount** previously destroyed the grid; it is now a rejected write keeping the previous query, warning once per distinct fault; **mount still throws** and an **uncontrolled `grid.setQuery` still throws to its caller**, both deliberately. Do not describe the imperative path as fixed — it was never broken.
- [ ] **Step 2:** Verify no sibling changeset contradicts it.
- [ ] **Step 3: The battery.** All package suites with real counts **and exit codes** (`@pretable/react`, `@pretable/app-website`, `@pretable-internal/grid-core`, `@pretable-internal/row-model`, `@pretable/core`, `@pretable/ui`); `pnpm typecheck`, `pnpm lint`, `pnpm format`; then `pnpm build && pnpm api && pnpm api:check` — **build first**, a stale `dist/` silently strips exports. Expect **no** report change; if `api` rewrites one, stop and report.
- [ ] **Step 4: Hygiene** over `git diff origin/main...HEAD`: no TODO/placeholder markers, no `.only`/`.skip`, no debug logging, no leftover probe files, no NUL bytes.
- [ ] **Step 5: One hand probe, outside the suite.** Mount a grid showing 3 rows, push an invalid query **through the prop**, confirm it still renders 3 rows, then push a valid narrowing query and confirm the count changes. Delete the probe; confirm `git status` clean. Report the observed numbers.
- [ ] **Step 6: Commit** `chore: changeset for rejected query updates`.

## Self-review

**Spec coverage:** decision 7 → Task 1 Step 3; 8 → tests 1–2; 9 → Step 3 plus the third mutation; 10 → test 4; 11 → Step 3 and the fourth mutation; 12 → tests 5 and 6.

**Judgment call flagged:** Task 1 must cover the `.then()`-chained `applyQuery` path, where a throw is an unhandled rejection rather than an unmount. If the implementer cannot construct a test that reaches that path deterministically, they must say so explicitly rather than claiming coverage — an unreachable branch guarded but untested is worth knowing about.
