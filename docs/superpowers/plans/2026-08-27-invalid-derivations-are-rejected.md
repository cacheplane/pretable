# Rejecting Invalid Derivations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An invalid `aggregate` reaching the row model after mount becomes a rejected write — the grid keeps its previous derivations and stays interactive — instead of throwing out of a React commit and unmounting the subtree.

**Architecture:** One `try`/`catch` around the synchronous `rowModel.setDerivations(...)` call in `use-pretable.ts`'s derivations layout effect. That seam is the single path both doors take (the `columns` prop and `setColumnAggregate`'s merged overrides), so one guard covers both. grid-core and row-model are untouched — the compiler stays the sole authority on validity.

**Tech Stack:** TypeScript, vitest (jsdom), changesets. No CSS, no new components, no public API additions.

**Spec:** `docs/superpowers/specs/2026-08-27-invalid-derivations-are-rejected-design.md` — its six decisions are settled. Read it before Task 1.

---

## Ground truth (measured on `77e56cb0`, 2026-08-27)

- **Both doors are fatal on update**, not just `setColumnAggregate`. A probe rendering a grouped grid and pushing `aggregate: "nonsense"` through the **`columns` prop** on rerender produced: `CompiledQueryValidationError: Invalid compiled query at derivations[1].aggregate: unknown aggregate nonsense`, **group rows 1 → 0, container 0 bytes**. At mount the same value throws before anything renders.
- **The guard cannot import the error class.** `CompiledQueryValidationError` is declared at `packages/row-model/src/compiled-query.ts:207` and is **not** re-exported from `@pretable/core`; `packages/react` depends only on `@pretable/core` and `@pretable/ui`. Detect by **`name`**, which the class pins at `:208` as `readonly name = "CompiledQueryValidationError"`. This is also sturdier than `instanceof`, which can fail across duplicated module instances.
- **The effect, today** (`packages/react/src/use-pretable.ts`, ~`:484-497`):
  ```ts
  if (derivationsChanged) {
    lastDerivations.current = derivations as typeof lastDerivations.current;
    const transition = rowModel.setDerivations(
      derivations as unknown as PretableDerivationsFor<unknown>,
    );
    pendingDerivations.current = transition.finished;
    const clearPending = () => { /* … */ };
    void transition.finished.then(clearPending, clearPending);
    void transition.finished.catch(() => undefined);
  }
  ```
  Note `lastDerivations.current` is assigned **before** the throwing call — spec decision 4 depends on that and it must stay that way.
- **`warnOnce(key, message)`** lives at `packages/react/src/dev-warn.ts`, with `resetDevWarnings()` for tests. It is `@internal`, deliberately not build-flag gated, and **latches per key**.
- **Fixture shape:** columns are built with `createColumnHelper` from `@pretable/core` — `helper.accessor("qty", { type: "number", aggregate: "sum" })`. See `packages/react/src/__tests__/grouping-aggregate-overrides.test.tsx:31-33` for a working grouped fixture, and reuse its `Holding` shape.

## File map

| File | Responsibility |
|---|---|
| `packages/react/src/use-pretable.ts` | the guard: catch, keep last-good, warn |
| `packages/react/src/__tests__/invalid-derivations-rejected.test.tsx` | new — both doors, recovery, warning, mount |
| `packages/react/src/__tests__/compiled-query-error-name-pin.test.ts` | new — cross-package name pin |
| `.changeset/` | one `@pretable/react` patch changeset |

## Standing rules

TDD. Mutation-check every assertion. **The react package's `test` script supplies `--environment jsdom`; a bare `vitest run` reports hundreds of phantom failures — use `pnpm --filter @pretable/react test`.** This box runs parallel sessions and is often saturated (load was 51 during planning), so re-run a single failure in isolation before believing it. **This repo's vitest reporter swallows `console.log`** — if you need probe output, write to a file. Never `git stash` / `git checkout` — the stash stack is shared across worktrees; restore by targeted edit. No literal NUL bytes. Run prettier before trusting a final result.

---

### Task 1: the guard — reject instead of unmount

**Files:**
- Modify: `packages/react/src/use-pretable.ts` (the `derivationsChanged` block, ~`:484-497`)
- Create: `packages/react/src/__tests__/invalid-derivations-rejected.test.tsx`

- [ ] **Step 1: Write the failing tests.** Build a grouped fixture where the *declared* aggregate has a computed result you can see on screen — copy the `Holding`/`helper` shape from `grouping-aggregate-overrides.test.tsx:31-40`. `qty` declares `sum`; Tech rows `10` and `20` render `30`.

  Assertions must **disprove**: assert the previous aggregate is *still rendering*, not merely that nothing threw. A destroyed grid renders nothing and would pass a bare no-throw check.

  ```tsx
  test("an invalid aggregate on the columns prop is rejected, not fatal", () => {
    const view = render(surface(GOOD));
    expect(techAggregateText(view.container)).toBe("30");
    view.rerender(surface(BAD));           // aggregate: "nonsense"
    // The grid SURVIVES and keeps the derivations it had.
    expect(techAggregateText(view.container)).toBe("30");
  });

  test("an invalid aggregate written to the engine is rejected, not fatal", () => {
    const view = render(surface(GOOD));
    act(() => grid.setColumnAggregate("qty", "nonsense"));
    expect(techAggregateText(view.container)).toBe("30");
  });

  test("a valid update after a rejected one still lands", async () => {
    const view = render(surface(GOOD));
    view.rerender(surface(BAD));
    view.rerender(surface(COUNTING));       // qty: aggregate "count" → 2
    await expect.poll(() => techAggregateText(view.container)).toBe("2");
  });
  ```
  The third test is the one spec decision 4 puts at risk — leaving the rejected identity in the ref must not block recovery.
- [ ] **Step 2: Run and confirm they fail for the right reason** — a destroyed subtree (empty container / element not found), not a typo. `pnpm --filter @pretable/react test -- invalid-derivations-rejected`
- [ ] **Step 3: Implement.** Keep the assignment to `lastDerivations.current` **before** the call (spec decision 4 — it makes the failed update attempt once instead of recompiling every render):
  ```ts
  if (derivationsChanged) {
    lastDerivations.current = derivations as typeof lastDerivations.current;
    let transition: PretableDerivationTransition<unknown> | null = null;
    try {
      transition = rowModel.setDerivations(
        derivations as unknown as PretableDerivationsFor<unknown>,
      );
    } catch (error) {
      // Rejected, not fatal: the compiler refused these derivations, so the
      // row model keeps the ones it had and the grid stays interactive.
      // Detected by NAME, not `instanceof`: the class is not re-exported from
      // `@pretable/core` (react's only dependency here), and a name check
      // also survives duplicated module instances, where `instanceof` fails.
      if ((error as { name?: string })?.name !== "CompiledQueryValidationError")
        throw error;
      // Task 2 adds the warning here.
    }
    if (transition !== null) {
      pendingDerivations.current = transition.finished;
      // …existing body unchanged…
    }
  }
  ```
  **Catch only that name.** Every other error rethrows (spec decision 2) — a blanket catch inside a layout effect would hide unrelated faults, which is the exact class of bug this seam already produces.
- [ ] **Step 4: Green** — the new file, then the whole react package. Real counts.
- [ ] **Step 5: Mutation, both required.** Restore each by targeted edit.
  - Remove the `try`/`catch` → both destruction tests must fail.
  - Widen the catch to all errors (drop the name check) → add a temporary throw of a plain `Error` from the same call and confirm it **propagates**; if it does not, the narrow catch is not pinned and you must add a test that pins it. Record what you did.
- [ ] **Step 6: Commit** `fix(react): an invalid derivations update is rejected, not fatal`.

---

### Task 2: the warning, keyed so it cannot self-silence

**Files:**
- Modify: `packages/react/src/use-pretable.ts` (the catch block from Task 1)
- Modify: `packages/react/src/__tests__/invalid-derivations-rejected.test.tsx`

**The trap:** `warnOnce` **latches** — one fire disarms that key for the whole session. `pretable-surface.tsx:3614` records what that cost before: a render-order skew tripped the contiguous-window check, `warnOnce` latched, and the check was disarmed for the rest of the session. So the key must include the column id and the offending value.

- [ ] **Step 1: Write the failing tests.** Import `resetDevWarnings` from `../dev-warn` and call it in `beforeEach`; spy with `vi.spyOn(console, "warn").mockImplementation(() => {})`.
  ```tsx
  test("the rejection warns once, naming the column and the value", () => { /* … */ });

  test("a DIFFERENT invalid value still warns — the key is not a constant", () => {
    // reject "nonsense" on qty, then reject "bogus" on qty
    expect(warn).toHaveBeenCalledTimes(2);
  });
  ```
  The second test is the anti-latching pin and is the reason this task exists separately.
- [ ] **Step 2:** Confirm failures. **Step 3: Implement** in the catch:
  ```ts
  warnOnce(
    `invalid-derivations:${columnId}:${String(rejected)}`,
    `[pretable] rejected a derivations update: ${message}. The grid kept its previous derivations.`,
  );
  ```
  Derive `columnId` and `rejected` from the error where available — `CompiledQueryValidationError` carries `path` and `columnId` (see `compiled-query.ts:207-215`); read them rather than re-deriving. If a field is absent, fall back to the error's `path` so the key still varies per fault.
- [ ] **Step 4: Green** — new tests, then the package.
- [ ] **Step 5: Mutation** — key the warning on a constant string. The "different invalid value still warns" test **must** fail. Restore by targeted edit.
- [ ] **Step 6: Commit** `fix(react): a rejected derivations update warns once per fault`.

---

### Task 3: two pins — the error name, and mount

**Files:**
- Create: `packages/react/src/__tests__/compiled-query-error-name-pin.test.ts`
- Modify: `packages/react/src/__tests__/invalid-derivations-rejected.test.tsx`

The guard matches a **string** across a package boundary. Nothing makes row-model keep that string, so a rename there would silently disarm the guard — the same failure shape SP3b's `grouping-aggregate-vocabulary-pin.test.ts` exists to prevent. Read that file first and follow its approach.

- [ ] **Step 1: Write the name pin.** Provoke a real `CompiledQueryValidationError` through a public path (compiling a query with an invalid aggregate) and assert `error.name === "CompiledQueryValidationError"` — the exact literal the guard tests. Comment that the guard in `use-pretable.ts` depends on this string, so this test failing means the guard is disarmed, not that the test is stale.
- [ ] **Step 2: Write the mount pin.** Spec decision 6: mount stays fail-fast. Assert that rendering with an invalid `aggregate` **throws** — pinning the asymmetry against a future "make it uniform" change. Comment why: at mount there is no running grid to protect and a hard error surfaces a config bug at its cheapest moment.
- [ ] **Step 3:** Run; confirm both pass for the right reason (the name pin should pass immediately — it documents existing behaviour; if it fails, stop and report, because the guard is already wrong).
- [ ] **Step 4: Mutation** — change the guard's literal in `use-pretable.ts` to `"CompiledQueryValidationErrorX"`. Task 1's destruction tests must fail (the guard stops catching). This proves the pin guards something real. Restore by targeted edit.
- [ ] **Step 5: Commit** `test(react): pin the error name the derivations guard matches, and mount's fail-fast`.

---

### Task 4: changeset and the battery

- [ ] **Step 1: Changeset.** `@pretable/react` **patch** — this fixes a crash and adds no API. Read two recent `.changeset/*.md` files first and match their voice. It must say: an invalid `aggregate` arriving after mount previously destroyed the grid; it is now a rejected write that keeps the previous derivations and warns once; **mount still throws**, deliberately. Do not describe it as `setColumnAggregate`-only — the `columns` prop is the door most consumers can hit.
- [ ] **Step 2: Verify no sibling changeset contradicts it.** That has happened twice on this arc, both times in a file the branch never touched.
- [ ] **Step 3: The battery.** `pnpm --filter @pretable/react test`, `pnpm --filter @pretable/app-website test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`. Then `pnpm build && pnpm api && pnpm api:check` — **build first**, a stale `dist/` silently strips exports and `api:check` will not catch it. Expect **no** report change; if `api` rewrites one, stop and report, because this task adds no public surface.
- [ ] **Step 4: Hygiene.** No TODO/placeholder markers; no `.only`/`.skip`; no debug logging; no leftover probe files; `git status` clean.
- [ ] **Step 5: Commit** `chore: changeset for rejected derivations updates`.

## Self-review

**Spec coverage:** decision 1 (seam, not `setColumnAggregate`) → Task 1 Step 3; decision 2 (narrow catch) → Task 1 Steps 3 and 5; decision 3 (reject whole update) → Task 1 Step 1's two destruction tests; decision 4 (leave the rejected identity in the ref) → Task 1 Step 3 plus the recovery test; decision 5 (`warnOnce`) → Task 2; decision 6 (mount fail-fast) → Task 3 Step 2. The spec's four required mutations map to Task 1 Step 5 (two), Task 2 Step 5, and Task 3 Step 4.

**One spec item the plan sharpens:** the spec said "catch `CompiledQueryValidationError`". The class is not reachable from `packages/react`, so the plan specifies a **name** match plus a cross-package pin. That is a stronger implementation than `instanceof`, not a weaker one — but it introduces a string coupling, which is exactly why Task 3 exists.

**Judgment call flagged:** Task 2 reads `columnId`/`path` off the error to build the warning key. If those fields turn out not to be populated on every validation failure, the implementer must say so and fall back to the message text rather than silently keying on a constant — a constant key is the one outcome this task exists to prevent.
