# Filter Builder (SP2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A filters section in the tool panel that builds the AND/OR tree the engine has spoken since #493 — add/remove/edit leaves, create and nest groups, change any join — inline, typed by column, committed live.

**Architecture:** The section is a projection of engine state, never a draft store: it subscribes to `query.filters` itself and writes through the surface's query path, holding local state only for debouncing text inputs. Nodes have no ids and are re-allocated on every commit, so everything addresses them by **positional path**; all path arithmetic lives in a pure module that React never touches.

**Tech Stack:** React 19 + TypeScript in `@pretable/react`, vanilla CSS in `@pretable/ui`, vitest + jsdom, Playwright, API Extractor, changesets.

**Spec:** `docs/superpowers/specs/2026-08-26-filter-builder-design.md` — decisions there are settled: full tree editing; per-row join over an indent rail; inline typed editing; live debounced commits.

---

## Ground truth (verified 2026-08-26 — anchors, not line numbers)

- **Section contract:** `packages/react/src/tool-panel/sections.ts` — `ToolPanelSectionId` is `"columns"` today; `ToolPanelSectionDescriptor` is `{ id, icon, label, render }` with props baked in by the surface. Descriptors are built in `pretable-surface.tsx`'s `toolPanelSections` memo (~:3251), whose comment records the rule your section must obey: **deps are stable HANDLES only; sections read live state through their own subscription.**
- **The tree helpers** shipped in SP2a: `packages/react/src/filter-tree.ts` exports `SurfaceFilterLeaf`, `SurfaceFilterGroup`, `SurfaceFilterNode`, `asSurfaceNodes`, `isSurfaceFilterGroup`, `columnHasFilter`, `topLevelColumnFilter`, `withTopLevelColumnFilter`.
- **The operator vocabulary already exists and is reusable** — `packages/react/src/filter-menu/filter-operators.ts` exports `operatorsForType`, `OPERATOR_LABELS`, `operatorValueShape` (`"none" | "single" | "range" | "set"`), `defaultDraft`, `isComplete`, `toColumnFilter`, `fromColumnFilter`, `resolveColumnOptions`, and the `FilterDraft`/`ValueShape` types. **Reuse it. Do not re-derive which operators a column type allows.**
- **Typed editors** live at `packages/react/src/editors/` — `EnumCellEditor`, `DateCellEditor`, `NumberCellEditor`, `TextCellEditor`, `MultilineCellEditor`, `BooleanCellControl`, plus `enum-options.ts`, `date-utils.ts`, `type-parsing.ts`.
- **Engine facts from SP2a:** groups are `{op:"and"|"or", children}`; the top-level array is an implicit AND; **an empty group evaluates TRUE under both ops**; nesting is bounded at **64 below the root** and a deeper tree makes `compileQuery` throw `code: "invalid-query"`; `compileQuery` re-captures (allocates + freezes) every node on every `setQuery`.
- **A spec claim that is WRONG, corrected here:** the spec says this is the "third `role=\"menu\"`" and therefore triggers the shared menu-keyboard extraction. There are only **two** (`column-menu/ColumnMenu.tsx`, `tool-panel/ColumnPinMenu.tsx`), and this section's pickers are combobox/listbox-shaped, not menus. **Task 7 verifies before extracting** — if the builder adds no third `role="menu"`, the extraction is NOT triggered and must not be done speculatively.

## File map

| File | Responsibility |
|---|---|
| `packages/react/src/tool-panel/filters/filter-paths.ts` | **Pure.** Path type, resolve, immutable spine rebuild, insert/remove/replace/regroup, depth measurement. No React. |
| `packages/react/src/tool-panel/filters/FiltersSection.tsx` | The section: subscribes to the query, renders the tree, owns debounce buffers |
| `packages/react/src/tool-panel/filters/FilterRow.tsx` | One leaf row: column picker · operator picker · typed value · remove |
| `packages/react/src/tool-panel/filters/JoinControl.tsx` | The between-rows connective (`Where` / `and ▾` / `or ▾`) |
| `packages/react/src/tool-panel/filters/index.ts` | Internal barrel |
| `packages/react/src/tool-panel/sections.ts` | `ToolPanelSectionId` gains `"filters"` |
| `packages/react/src/pretable-surface.tsx` | Descriptor construction; `messages` keys for the panel's strings |
| `packages/react/src/icons.tsx` | `FiltersIcon` for the rail tab |
| `packages/ui/src/grid.css` | Rail, rows, join control, add-actions |
| `packages/ui/src/__tests__/css-cascade.test.ts` | Structural guards |
| `packages/react/src/__tests__/filter-paths.test.ts` | Pure-unit suite |
| `packages/react/src/__tests__/filter-builder.test.tsx` | jsdom section suite |
| `apps/website/e2e/tool-panel.spec.ts` | Keyboard reachability + no-trap |
| `apps/website/content/docs/grid/tool-panel.mdx` | The filters section |

## Standing rules

TDD; prettier before trusting any test result; mutation-check every guard and every "this can't happen" branch; `pnpm build` before `pnpm api`; no stash/checkout — restore mutations by targeted edit; nothing outside the listed files without saying so.

---

### Task 1: `filter-paths.ts` — the pure core

**Files:** create `packages/react/src/tool-panel/filters/filter-paths.ts`, create `packages/react/src/__tests__/filter-paths.test.ts`

This is the module everything else stands on, and the one the repo's history says must be pure and directly tested (SP1's drop-target math is the precedent). **No React imports.**

The path type and the operations:

```ts
/** A node's position in the tree: root index, then child indices. `[1, 2]`
 * is `filters[1].children[2]`. Derived at render, never stored on a node —
 * `compileQuery` re-allocates every node on every commit, so identity dies. */
export type FilterPath = readonly number[];
```

Operations to implement (each with TSDoc saying what it does when the path is stale, because a debounced write WILL arrive after a sibling was removed):
- `resolveNode(nodes, path): SurfaceFilterNode | undefined` — undefined if any segment is out of range or a non-final segment is a leaf.
- `replaceNode(nodes, path, next): readonly SurfaceFilterNode[]` — immutable spine rebuild; siblings keep reference identity.
- `removeNode(nodes, path): readonly SurfaceFilterNode[]`
- `insertNode(nodes, path, node): readonly SurfaceFilterNode[]` — inserts AT that path (pushing the current occupant right); an out-of-range final index appends.
- `depthOf(path): number` and `treeDepth(nodes): number` — for the 64-bound refusal. Root nodes are depth 0, matching the engine.
- `setGroupOp(nodes, groupPath, op)` — changes one group's join.

- [ ] **Step 1: Write the failing tests.** Fixtures must distinguish outcomes (the repo rule): use a tree with a nested group and at least three siblings so an off-by-one is visible.
  - `resolveNode` finds a leaf at `[0]`, a group at `[1]`, a nested leaf at `[1,0]`; returns undefined for `[9]`, for `[0,0]` (leaf has no children), and for `[1,9]`.
  - `replaceNode` at `[1,0]` returns a new root array and a new `[1]` group, but `[0]` is the **same object** (`toBe`) — the spine is rebuilt, siblings are not.
  - `removeNode` at `[1,0]` leaves the group present with one child; removing the group's last child leaves an **empty group**, not a removed group.
  - `insertNode` at `[1,1]` pushes the occupant right; at `[1,99]` appends.
  - `treeDepth` returns 0 for a flat array, 1 for one nesting level; `depthOf([1,0,2])` is 2.
  - `setGroupOp` flips one group and leaves siblings identical (`toBe`).
- [ ] **Step 2:** Run, confirm failures. **Step 3:** Implement. **Step 4:** Green.
- [ ] **Step 5: Mutation round** — make `replaceNode` clone siblings (the identity test must fail); make `resolveNode` not check leaf-vs-group on non-final segments (the `[0,0]` test must fail); make `removeNode` delete an emptied group (that test must fail). Restore each by targeted edit.
- [ ] **Step 6: Commit** `feat(react): pure path arithmetic for the filter tree`.

---

### Task 2: CSS — rail, rows, join control

**Files:** `packages/ui/src/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts`

Every selector `:where()`-wrapped inside `@layer pretable`; **tokens only from the existing contract** (the panel's section already uses `--pretable-bg-toolbar`, `--pretable-rule`, `--pretable-text-dim`, `--pretable-radius-control`, `--pretable-accent`, `--pretable-focus-ring`). **Pseudo-element trap:** `:where(x::before)` is invalid and matches nothing — write `:where(x)::before`.

Attributes to style (these become the DOM contract; Task 4/5 must emit them exactly): `data-pretable-filter-rail`, `data-pretable-filter-row`, `data-pretable-filter-join`, `data-pretable-filter-add`, `data-pretable-filter-empty`, and `data-pretable-filter-column-hidden="true"` for a row whose column is hidden.

- [ ] **Step 1: Failing structural guards**, mutation-tested (delete the rule, watch the guard fail, restore by targeted edit):
  - a `[data-pretable-filter-rail]` rule exists and draws its indent with `border-inline-start` using `--pretable-rule` (the rail IS the nesting cue);
  - the hidden-column row reads `--pretable-text-dim` and uses **no `opacity`** (every opacity-dimmed secondary in this repo has failed AA);
  - no `data-pretable-filter-*` rule introduces a `var(--` outside the contract, and none DECLARES a custom property (reuse the tool-panel guards' existing extraction helper).
- [ ] **Step 2:** Confirm failures. **Step 3:** Add the rules in the file's voice, in the Tool panel section, **before** the coarse-pointer block (which is declared last on purpose). Give the join control a real hit target — it is a `<button>` in a narrow pane.
- [ ] **Step 4:** `pnpm --filter @pretable/ui test` green (the contract test resolves every `var()` across all three themes — a typo'd token fails there).
- [ ] **Step 5: Commit** `feat(ui): filter builder rail, rows, and join control`.

---

### Task 3: `JoinControl` — the connective

**Files:** create `packages/react/src/tool-panel/filters/JoinControl.tsx`, extend `packages/react/src/__tests__/filter-builder.test.tsx` (create it)

The first row of a sibling run shows a non-interactive `Where` label; every later row shows a control carrying that run's join. **Changing any one changes the whole run** (a sibling list has ONE `op`), which is the behavior most likely to surprise — so it is the first thing tested.

Shape: a `<button>` with `aria-label` naming what it does, toggling `and`↔`or` on click, `aria-pressed`-free (it is not a toggle of itself, it sets a value) — read how `ColumnPinMenu` labels its items and follow that voice. Emit `data-pretable-filter-join`.

- [ ] **Step 1: Failing tests:** the first sibling renders `Where` and no control; the second renders a control reading `and`; clicking it calls back with `"or"`; a run of three shows **one** control state shared by rows 2 and 3 (not two independent controls).
- [ ] **Step 2–4:** Fail → implement → green.
- [ ] **Step 5: Commit** `feat(react): the filter builder's join control`.

---

### Task 4: `FilterRow` — one leaf, inline and typed

**Files:** create `packages/react/src/tool-panel/filters/FilterRow.tsx`, extend `filter-builder.test.tsx`

Row anatomy: column picker · operator picker · value control · remove button. **Reuse `filter-operators.ts` wholesale** — `operatorsForType(type)` for the operator list, `OPERATOR_LABELS` for display, `operatorValueShape(op)` to decide which value control to render (`"none"` → none, `"single"` → one, `"range"` → two, `"set"` → multi), and `resolveColumnOptions` for enum choices. **Do not re-derive any of this.**

Value control by `column.type`, from `packages/react/src/editors/`: enum → `EnumCellEditor`, date → `DateCellEditor`, number → `NumberCellEditor`, boolean → `BooleanCellControl`, else `TextCellEditor`. Read one of them first — they have a props contract (value, onChange, commit semantics) you must adapt to, not fight.

Changing the **column** re-derives the operator list; if the current operator is not valid for the new type, fall back to `defaultDraft(newType)`'s operator rather than leaving an impossible pair.

Emit `data-pretable-filter-row`, and `data-pretable-filter-column-hidden="true"` when the column is hidden (SP1 visibility) — the filter still applies; the row says so.

- [ ] **Step 1: Failing tests:** a text column renders text operators and one value input; a number column offers `between` and renders **two** inputs for it; an enum column renders a multi-select for `isAnyOf`; `isEmpty` renders **no** value control; switching a text column to a number column resets an incompatible operator; a hidden column's row carries the attribute and still shows its value.
- [ ] **Step 2–4:** Fail → implement → green. **Step 5: Mutation** — make the value-shape switch always render one input; the `between` and `isEmpty` tests must both fail. Restore.
- [ ] **Step 6: Commit** `feat(react): the filter builder's typed leaf row`.

---

### Task 5: `FiltersSection` — subscription, tree render, debounce

**Files:** create `packages/react/src/tool-panel/filters/FiltersSection.tsx`, `index.ts`, extend `filter-builder.test.tsx`

**Subscription (non-negotiable):** the section takes the stable grid handle as a prop and subscribes itself with `useSyncExternalStore(grid.subscribe, () => grid.getState().snapshot.query.filters)` — read how `ColumnsSection` does it and follow exactly. Do NOT capture a snapshot in the descriptor's `render` closure.

**Rendering:** walk the tree, rendering `JoinControl` between siblings and `FilterRow` for leaves; a group renders its children inside a `data-pretable-filter-rail` element. **React keys are the positional path joined** (`path.join(".")`) — nodes have no ids.

**Writes:** every mutation goes `resolve path → build next array via filter-paths → surface query write`. Discrete changes (operator, enum, join, add, remove, regroup) write immediately.

**Debounce — the trap this task exists to get right.** Text values buffer locally (~200ms). **When the timer fires, re-resolve the path and abort the write if the node is gone or is no longer a leaf for the same column.** Removing a sibling mid-typing otherwise lands the write on a different node. This is a required test, not an optimization. Clear buffers on unmount and cancel the pending timer.

**Actions:** `+ filter` appends a leaf for the first column with `defaultDraft`'s operator; `+ group` appends an empty group. **`+ group` must be DISABLED when `depthOf(targetPath) + 1` would exceed the engine's 64 bound** — NOT when `treeDepth(nodes)` is at it. Correction recorded after Task 1's review: `treeDepth` measures OCCUPIED depth and skips empty groups, so a `treeDepth`-only gate wrongly allows one extra level (nest two groups, leave the inner empty, drop a leaf in — `treeDepth` never saw it coming). Gate the action against the target path, not the whole tree.** (a deeper tree throws `invalid-query` out of `setQuery`, which no consumer catches) — disabled with a reason, not silently inert.

An empty tree renders `data-pretable-filter-empty` with a line explaining the panel is unfiltered.

- [ ] **Step 1: Failing tests:**
  - a tree with a nested group renders rows in order with the rail;
  - adding a group does **not** blank the grid (assert visible row count is unchanged — this is SP2a's empty-group-TRUE rule earning its keep);
  - a text edit writes once after the debounce, not per keystroke (advance fake timers; assert the write count);
  - **debounce-abort:** start editing a leaf's text, remove a preceding sibling, fire the timer → the engine's tree is unchanged by the aborted write and the surviving nodes are intact;
  - `+ group` is disabled at depth 64 and enabled at 63;
  - changing a join rewrites that sibling run's `op` and leaves other groups identical.
- [ ] **Step 2–4:** Fail → implement → green (full react suite).
- [ ] **Step 5: Mutation** — remove the debounce-abort re-resolution; the abort test must fail. Remove the depth guard; the disabled test must fail. Restore each.
- [ ] **Step 6: Commit** `feat(react): the filters section — tree editing, live and debounced`.

---

### Task 6: Wire it to the panel

**Files:** `packages/react/src/tool-panel/sections.ts`, `packages/react/src/pretable-surface.tsx`, `packages/react/src/icons.tsx`, extend the tool-panel tests, `.changeset/`

- [ ] **Step 1: Failing tests:** the rail shows two tabs; opening `filters` renders the section; `ToolPanelSectionId` accepts `"filters"` (type-level, in whatever type-test file the package uses).
- [ ] **Step 2:** `ToolPanelSectionId` gains `"filters"`; add `FiltersIcon` to `icons.tsx` (three stacked lines narrowing — the funnel is taken; copy the `Glyph` pattern, 16px grid, 1.5px stroke, `currentColor`); append the descriptor in the surface's `toolPanelSections` memo **keeping deps to stable handles only** (the memo's own comment states the rule).
- [ ] **Step 3:** `pnpm build && pnpm api && pnpm api:check` — `ToolPanelSectionId` widening moves `react.api.md`. Changesets: `@pretable/react` minor, `@pretable/ui` minor.
- [ ] **Step 4: Commit** `feat(react): the filters section joins the tool panel rail`.

---

### Task 7: The two deferred debts — verify the trigger, then pay what is owed

**Files:** `packages/react/src/pretable-surface.tsx` (messages), the tool-panel components, possibly a shared menu-keyboard module

- [ ] **Step 1: i18n — this one IS owed.** The panel's hardcoded English (`"Pinned left"`, `"Search columns"`, `"Reset columns"`, `"No columns match"`, `"Pin left"`/`"Pin right"`/`"Unpin"`, plus everything your new section added) moves to the surface's `messages` mechanism. Read how `toolPanelLabel`/`toolPanelColumnsLabel` are declared, defaulted, and threaded, and follow it exactly. This moves `react.api.md` again (new message keys) — regenerate.
- [ ] **Step 2: menu-keyboard extraction — VERIFY THE TRIGGER FIRST.** The spec claimed this section would be the third `role="menu"`. Grep: `grep -rln 'role="menu"' packages/react/src`. Today there are **two** (`column-menu/ColumnMenu.tsx`, `tool-panel/ColumnPinMenu.tsx`), and this section's pickers are combobox/listbox-shaped. **If your section added no third `role="menu"`, do NOT extract** — record in the commit body that the trigger did not fire and the debt stays open. If it did, extract the shared keyboard behavior (arrow roving skipping disabled items, Escape closing to the trigger) into one module and adopt it in all three.
- [ ] **Step 3:** Full react suite; `pnpm api:check`. **Commit** `refactor(react): the tool panel speaks through messages`.

---

### Task 8: Docs and e2e

**Files:** `apps/website/content/docs/grid/tool-panel.mdx`, `apps/website/e2e/tool-panel.spec.ts`

- [ ] **Step 1:** Document the filters section: what it builds, the per-row join and that it applies to the whole sibling run, nesting, live-debounced commits, the depth limit, and that the header funnel and the builder are one model (a funnel-written filter appears here; a filter written here relights the funnel). **`ToolPanelSectionId` now has two members and the docs guard binds string unions to prose** — the page must enumerate both or the guard fails.
- [ ] **Step 2: e2e** — open the filters section, add a filter, assert the grid's row count drops; add a group and assert the count does **not** change; keyboard-walk the section and confirm forward-Tab still **exits** the panel (`grid-tab-wrap-rows.spec.ts` names the rail stop explicitly and fails loudly on a trap — run it too).
- [ ] **Step 3:** Run e2e per the local recipe: production build, `npx next start` from `apps/website`, the **root** playwright binary from inside `apps/website`, `BASE_URL`, `--workers=1`. Kill the server.
- [ ] **Step 4: Commit** `docs(grid): the tool panel's filters section`.

---

### Task 9: Final battery

- [ ] All suites (row-model, core, react, ui, website) — real counts; `typecheck`, `lint`, `pnpm format`.
- [ ] `pnpm build && pnpm api && pnpm api:check`; `git status` clean of stale reports.
- [ ] Website e2e, FULL suite, production build, `--workers=1`.
- [ ] The Playwright cascade gate (`apps/bench/tests/cascade-override.spec.ts`) — new `grid.css` rules are its jurisdiction.
- [ ] **Prove the pixel:** in a real browser, assert computed styles on the rendered rail and a row — a resolving token and a matching selector are not proof anything paints. Screenshot the section under `pretable` light and dark.
- [ ] Re-verify both changesets against what shipped.
- [ ] Sweep for temporary markers and TODOs introduced by the intermediate tasks.

## Self-review

**Spec coverage:** full tree editing (T1, T5), per-row join (T3), indent rail (T2, T5), inline typed editing (T4), live debounce + abort (T5), depth refusal (T5), empty-group safety (T5), hidden-column rows (T4), one-model funnel (T8 docs; behavior is SP2a's and needs no new code), i18n (T7), menu extraction (T7, **trigger verified rather than assumed**), verification (T8, T9).

**One spec correction made here:** the spec's "third `role=\"menu\"`" claim is wrong — there are two, and this section's pickers are not menus. Task 7 checks before acting rather than performing a refactor nothing triggered.

**Judgment call flagged:** `+ group` appends an **empty** group rather than wrapping the current selection. Wrapping is the more powerful gesture but needs a selection model the panel does not have; appending is honest and composable with drag-in later.
