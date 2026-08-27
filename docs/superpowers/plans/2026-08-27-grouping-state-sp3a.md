# Grouping State (SP3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A column's `aggregate` and the `hideGroupedColumns` switch become engine state a pane can write, so SP3b's grouping section has something to compose against.

**Architecture:** Both follow the column-visibility precedent SP1 set — the prop is the *initial* value, the engine holds the live one. Aggregates are an **override layer merged where derivations are captured**, so the existing plan-reuse comparison sees them with no change to it. `hideGroupedColumns` becomes ordinary UI state on the grid core.

**Tech Stack:** TypeScript, vitest, API Extractor, changesets. No CSS, no components, no UI.

**Spec:** `docs/superpowers/specs/2026-08-27-grouping-state-design.md` — decisions there are settled: lift into engine state; aggregates are an override over the prop, not a replacement; strip and pane will coexist on one model.

---

## Ground truth (verified 2026-08-27 — anchors, not line numbers)

- **`derivationsEqualForPlan` ALREADY compares `aggregate`.** `packages/row-model/src/compiled-query.ts:~1164`: `if (!semanticValueEqual(column.aggregate, other.aggregate)) return false;` and the next line adds the column to `accessorIds` when an aggregate exists. **This is the single most important fact in this plan.** Merge the override where `RuntimeColumn`s are built and the plan-reuse gate is correct for free — do NOT add the override to this function. The spec named a two-directional trap here; this is why it collapses to "put the merge in the right place."
- **Aggregate capture:** `compiled-query.ts:~555-568` — `captureAggregator(rawAggregate, …)` for object aggregators, raw value otherwise, then `Object.freeze` on the `RuntimeColumn`.
- **React's derivations write:** `packages/react/src/use-pretable.ts:~411-432`, inside a `useLayoutEffect`, gated on `lastDerivations.current !== rowsOptions.columns` — **identity of the `columns` prop**. So a pane write that does not change that prop will not re-derive on its own; the override must live below this, in the engine.
- **`hideGroupedColumns` readers** (complete grep, non-test): `pretable-surface.tsx:1023` (prop decl), `:1619` (destructure), `:2086` (the live read feeding `effectiveColumns`), `:2122` (passed on), `:3443` + `:8101` (comments), `column-menu/ColumnMenu.tsx:25` and `group-panel/group-panel-model.ts:63` (comments), `apps/website/e2e/grouping.spec.ts:460` (comment). **Two real reads; the rest are prose** — verify that holds before relying on it.
- **The setter shape to mirror:** `setColumnVisible` in `packages/grid-core/src/create-grid-ui-core.ts` — `command()` wrapper, freeze, no-op early-return, strip-when-clearing. SP1's reviews hardened it; copy its discipline, including that `setColumns`' same-check must learn any new entry field.

## File map

| File | Responsibility |
|---|---|
| `packages/grid-core/src/types.ts` | `hideGroupedColumns` on the UI state; `setHideGroupedColumns` + `setColumnAggregate` on the model interface |
| `packages/grid-core/src/create-grid-ui-core.ts` | both setters, mirroring `setColumnVisible` |
| `packages/grid-core/src/__tests__/grouping-state.test.ts` | new — setter semantics |
| `packages/row-model/src/compiled-query.ts` | merge the aggregate override where `RuntimeColumn`s are captured |
| `packages/row-model/src/__tests__/aggregate-override.test.ts` | new — override semantics + plan reuse |
| `packages/react/src/pretable-surface.tsx` | seed both from props; `:2086` reads the engine value; audit verdicts |
| `packages/react/src/__tests__/` | extend the grouping/derivations suites |
| `packages/core` / `packages/react` `.api.md` + `.changeset/` | reports, changesets |

## Standing rules

TDD; prettier before trusting any test result; mutation-check every guard; `pnpm build` before `pnpm api`; no stash/checkout — restore by targeted edit; **the react package's `test` script supplies `--environment jsdom`, a bare `vitest run` reports hundreds of phantom failures**; this box is loaded, so re-run a single failure in isolation before believing it.

---

### Task 1: grid-core — `hideGroupedColumns` as UI state

**Files:** `packages/grid-core/src/types.ts`, `create-grid-ui-core.ts`, create `packages/grid-core/src/__tests__/grouping-state.test.ts`

Read `setColumnVisible` first and mirror it exactly.

- [ ] **Step 1: Failing tests.** Copy the harness from the existing `create-grid-ui-core` tests:
  - the initial config's value survives into state; absent means `undefined` (NOT `false` — the surface's default lives above, and conflating them would make "unset" indistinguishable from "explicitly off");
  - `setHideGroupedColumns(true)` publishes once; calling it again with `true` publishes **nothing** (subscribe and count emissions — one emission per command is a pinned invariant here);
  - `setHideGroupedColumns(false)` is distinct from unset (assert with `"hideGroupedColumns" in state`, not `toEqual`, or the strip-vs-false distinction is untestable).
- [ ] **Step 2:** Run, confirm failures for the right reason. **Step 3:** Implement. **Step 4:** Green; whole package.
- [ ] **Step 5: Mutation** — make the setter always publish; the no-op test must fail. Restore by targeted edit.
- [ ] **Step 6: Commit** `feat(grid-core): hideGroupedColumns is UI state`.

---

### Task 2: grid-core — `setColumnAggregate`

**Files:** `packages/grid-core/src/types.ts`, `create-grid-ui-core.ts`, extend `grouping-state.test.ts`

The engine stores an **override per column id**, not a replacement for the derived value. Store it as its own map/field on the UI state — do NOT put it on `columnLayout` entries, which are visual geometry (id, width, pinned, hidden) and are consumed by span-resolving code that has no business seeing an aggregator.

- [ ] **Step 1: Failing tests:**
  - `setColumnAggregate("total", "sum")` records the override; `getState()` exposes it;
  - setting the same value again publishes nothing;
  - `setColumnAggregate("total", undefined)` **clears** the override (strip-when-clearing — assert with `"total" in overrides` being false, not a value comparison);
  - an override for an unknown column id is a no-op, matching `setColumnPinned`'s tolerance (verify that IS its behaviour before copying it).
- [ ] **Step 2:** Confirm failures. **Step 3:** Implement, mirroring `setColumnVisible`'s `command()`/freeze/early-return shape. **Step 4:** Green.
- [ ] **Step 5: Check `setColumns`' same-check.** SP2a's review found `setColumns` silently dropped a visibility-only change because its equality predicate did not know about the new field. If the override lives outside `columnLayout` this may not apply — **verify and say which**, and if it does apply, add the field and a test.
- [ ] **Step 6: Commit** `feat(grid-core): a per-column aggregate override`.

---

### Task 3: row-model — merge the override where derivations are captured

**Files:** `packages/row-model/src/compiled-query.ts`, create `packages/row-model/src/__tests__/aggregate-override.test.ts`

**Where:** the `RuntimeColumn` capture at `~:555-568`. The override is applied to `aggregate` **before** `captureAggregator`, so an overridden object aggregator is captured and frozen identically to a declared one.

**Why there and nowhere else:** `derivationsEqualForPlan` already compares `column.aggregate` and already adds an aggregating column to `accessorIds`. Merging at capture means the plan-reuse gate is correct with **zero changes to that function** — an override change makes the plan unequal (recompute) and an unchanged override keeps it equal (reuse). Applying the override later (at render, or in the react layer) would leave the gate blind to it.

How the override reaches the row model is a design call this task must make and record: either it rides on the derivations the surface already passes, or the row model reads it from the grid core. **Pick one, write down why, and make sure the choice keeps `use-pretable.ts`'s `derivationsChanged` gate honest** — that gate keys on the `columns` prop's identity, so an override change that does not touch the prop must still reach the engine.

- [ ] **Step 1: Failing tests.** Fixtures must **disprove** — the override's computed *result* must differ from the prop's, not just its name:
  - a column declaring `sum` overridden to `count`, over rows where sum ≠ count, asserts the group row's aggregate equals the **count**;
  - clearing the override returns the **sum**;
  - a column with no declared aggregate, given an override, aggregates;
  - **plan reuse, both directions**: changing an override recomputes (assert through whatever the existing tests use to observe recompute-vs-reuse — find that mechanism, don't invent one); re-setting the same override reuses.
- [ ] **Step 2:** Confirm failures. **Step 3:** Implement. **Step 4:** Green; whole package.
- [ ] **Step 5: Mutation** — apply the override *after* capture instead of before; the object-aggregator test must fail (it will not be frozen/captured). Then make the override not participate in the merge at all; the plan-reuse tests must fail. Restore each by targeted edit.
- [ ] **Step 6: Commit** `feat(row-model): a column's aggregate override wins over its declaration`.

---

### Task 4: react — seed both, read the engine, and audit

**Files:** `packages/react/src/pretable-surface.tsx`, extend the react grouping/derivations tests

**The audit is the heart of this task.** `grep -rn "hideGroupedColumns\|aggregate" packages/react/src apps --include="*.ts*"` — every site gets a verdict (engine-aware / prop-only-by-design / display-only), recorded as a code comment where non-obvious. SP1's identical audit found seven consumers reading the wrong source.

Known: `pretable-surface.tsx:2086` is the live `hideGroupedColumns` read and must switch to the engine value; `:1619`/`:2122` thread the prop; `group-row.tsx:136` reads `group.aggregates[col.id]` (verdict it); `formatAggregate`, CSV/export, the bench adapters and docs examples all need verdicts.

- [ ] **Step 1: Failing tests:**
  - the `hideGroupedColumns` prop seeds the engine at mount, and `setHideGroupedColumns` afterwards changes what `effectiveColumns` yields **without** the prop changing;
  - an aggregate override set on the engine changes the rendered group-row aggregate **without** the `columns` prop changing (this is the one that proves `derivationsChanged`'s prop-identity gate did not swallow it);
  - a consumer that never touches either sees today's behaviour exactly (the survives-test — assert the old path still works, not just that the new one does).
- [ ] **Step 2:** Confirm failures. **Step 3:** Implement + write the audit verdicts. **Step 4:** Full react suite AND `pnpm --filter @pretable/app-website test` (docs examples may read these).
- [ ] **Step 5: Commit** `feat(react): the surface seeds grouping state and reads it from the engine`.

---

### Task 5: reports and changesets

- [ ] **Step 1:** `pnpm build && pnpm api && pnpm api:check` (**build FIRST** — a stale dist silently strips exports). Expected: `setColumnAggregate`, `setHideGroupedColumns`, and the state additions in `core.api.md` and `react.api.md`. **Anything else surfacing is a stop-and-report.**
- [ ] **Step 2:** Changesets — `@pretable/core` minor, `@pretable/react` minor. Both must name **the override semantic** (a column with no override still follows its prop; clearing returns to it), because that is what a CHANGELOG reader needs to know to predict behaviour.
- [ ] **Step 3: Commit** `chore: api reports and changesets for grouping state`.

---

### Task 6: final battery

- [ ] All package suites (grid-core, row-model, core, react, ui, website) — real counts; `typecheck`, `lint`, `pnpm format`.
- [ ] `pnpm build && pnpm api && pnpm api:check`; `git status` clean of stale reports.
- [ ] Website e2e, FULL suite, production build, root playwright binary from inside `apps/website`, `--workers=1`. **Note `grouping.spec.ts` exercises the strip, which this branch must not change** — a failure there is a real finding, not flake, unless it is the known WebKit chip-drag autoscroll case (which failed 3/3 on a preview lane last week and passed clean on re-run).
- [ ] Re-verify both changesets against what shipped, **and check no sibling changeset now contradicts them** — that has happened twice on this arc, both times in a file the branch never touched.
- [ ] Confirm the audit table is complete: re-run the grep, zero unverdicted sites.
- [ ] Sweep for TODO/placeholder/temporary markers, and for any literal NUL byte (`git diff --numstat` showing `- -` for a text file is the tell).

## Self-review

**Spec coverage:** engine state for both (T1, T2, T3), the override-layer semantic (T3), react seeding + the audit (T4), reports/changesets (T5), verification (T6). The `IsNever` probe the spec asked for is **not** a separate task — Task 3 must include it if it extends `PretableDerivationsFor`; if the override rides outside that type, the probe is moot and the task should say so.

**One spec claim this plan narrows:** the spec named a two-directional `derivationsEqualForPlan` trap. It is real but smaller than stated — that function *already* compares `aggregate`, so the trap reduces to "merge at capture, not later," which Task 3 states as its central constraint and mutation-tests both ways.

**Judgment call flagged:** Task 3 leaves *how* the override reaches the row model to the implementer, because both routes (riding the derivations, or the row model reading the grid core) are defensible and the right answer depends on coupling the plan cannot see from outside. The task requires the choice be recorded with its reasoning, and pins the one property that must hold either way.
