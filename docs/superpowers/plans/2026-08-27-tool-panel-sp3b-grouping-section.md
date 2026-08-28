# Tool Panel SP3b — Grouping Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the tool panel's grouping section — group-by list, expansion controls, hide-grouped switch, per-column aggregate picker — per `docs/superpowers/specs/2026-08-27-tool-panel-sp3b-grouping-section.md`.

**Architecture:** A third `ToolPanelSectionDescriptor` rendering a pure projection of engine state (row-model snapshot for `rowGroups`, indexed-grid state for `columnAggregates`/`hideGroupedColumns`), writing through stable handles. One small row-model change (the `null` "no aggregate" sentinel). The pane's grouping write routes through `queryWith`, paying the recorded `applyRowGroups` bypass debt.

**Tech Stack:** React 19, TypeScript, vitest (jsdom via the package's `test` script — never bare `vitest run`), Playwright, changesets, api-extractor.

**Read the spec first.** Every task below cites it. Also read (skim, before your task):
- `packages/react/src/tool-panel/sections.ts` — the descriptor contract.
- `packages/react/src/pretable-surface.tsx:2653-2710` (`pendingQueryRef`/`queryWith`), `:3488-3529` (`applyRowGroups`, `setFilterTree`), `:3577-3663` (the descriptor memo and its DEPS RULE comment — handles and props-derived values only, never engine state).
- `packages/react/src/tool-panel/ColumnsSection.tsx` and `filters/FiltersSection.tsx` — the two existing sections; copy their subscription and messages patterns, not your own.
- `packages/react/src/pretable-model.ts:144-216` — `setColumnVisible` / `setHideGroupedColumns` / `setColumnAggregate` TSDocs (the rows-mode gate, the invalid-aggregate destruction, the two-writer note).
- `packages/row-model/src/aggregate-overrides.ts` — the merge the sentinel extends.
- `packages/react/src/__tests__/grouping-aggregate-overrides.test.tsx` — SP3a's budget comments for grouped-grid jsdom tests (~4 derivation flips per grid, ~7 per module). **Respect them in every new grouped test file.**

**House rules that bite here:** react tests run via `pnpm --filter @pretable/react test` (the script supplies `--environment jsdom`); a wrong `--filter` exits 0 having run nothing — check the test-run header names real files; `pnpm build` before `pnpm api`; no `git stash`; commit after every task.

---

### Task 1: row-model — `null` becomes the "no aggregate" sentinel

**Files:**
- Modify: `packages/row-model/src/aggregate-overrides.ts`
- Test: `packages/row-model/src/__tests__/aggregate-overrides.test.ts` (extend the existing file; create only if absent — check first)
- Create: `.changeset/<generated-name>.md` (`@pretable-internal/row-model` minor)

- [ ] **Step 1: Write the failing tests.** Fixtures must be able to disprove (compute a RESULT, not a label, wherever a model is involved). Add:

```ts
describe("null sentinel", () => {
  const declared = [
    { id: "a", aggregate: "sum" },
    { id: "b" },
  ] as const;

  it("null strips a declared aggregate", () => {
    const merged = mergeColumnAggregateOverrides(declared, { a: null });
    expect("aggregate" in merged[0]).toBe(false);
    expect(merged[0].id).toBe("a");
  });

  it("null on a column that declares no aggregate returns the input array itself", () => {
    expect(mergeColumnAggregateOverrides(declared, { b: null })).toBe(declared);
  });

  it("undefined still means no override, even alongside null", () => {
    const merged = mergeColumnAggregateOverrides(declared, {
      a: undefined,
      b: null,
    });
    expect(merged).toBe(declared);
    expect((merged[0] as { aggregate?: unknown }).aggregate).toBe("sum");
  });
});
```

Then the **end-to-end disproof** through the model (this is the fixture whose computed result differs — a stripped `sum` shows NOTHING, a kept one shows a number). Use `createLocalRowModel` the way the file's existing tests do: a number column declaring `aggregate: "sum"`, group by another column, assert the group row's aggregate value exists; re-`setDerivations` with the null-merged list; assert the aggregate value is now ABSENT from the group snapshot (not `0`, not `""` — absent the way an undeclared aggregate is). Also assert the plan comparator sees it: if the file already tests `derivationsEqualForPlan`, add both directions — strip is a change; identical restated null (on an undeclaring column) is not.

- [ ] **Step 2: Run to verify the new tests fail** (`pnpm --filter @pretable-internal/row-model test -- aggregate-overrides`). Expected: the three unit tests fail (`null` currently flows into the derivation as its `aggregate`), and the model test throws `CompiledQueryValidationError` at compile.

- [ ] **Step 3: Implement.** In `mergeColumnAggregateOverrides`, replace the map body's override handling:

```ts
const merged = derivations.map((derivation) => {
  if (!Object.hasOwn(overrides, derivation.id)) return derivation;
  const aggregate = overrides[derivation.id];
  if (aggregate === undefined) return derivation;
  const declaredAggregate = (derivation as { readonly aggregate?: unknown })
    .aggregate;
  if (aggregate === null) {
    // The "no aggregate" sentinel: strip what the prop declared. A column
    // that declares none is already there — identity, not a change.
    if (declaredAggregate === undefined && !("aggregate" in derivation))
      return derivation;
    changed = true;
    const { aggregate: _stripped, ...rest } = derivation as {
      readonly aggregate?: unknown;
    } & { readonly id: string };
    return rest;
  }
  if (Object.is(declaredAggregate, aggregate)) return derivation;
  changed = true;
  return { ...derivation, aggregate };
});
```

Update the module TSDoc: the sentence "there is no value that says 'draw NO aggregate…'" (line ~45) is now false — rewrite it to document `null` as that value, keeping the `undefined`-means-no-override sentence intact.

- [ ] **Step 4: Run the package's full test suite** — green. Mutation-check one guard: temporarily make `null` fall through to the `{ ...derivation, aggregate }` branch and confirm the end-to-end test FAILS (this proves the model fixture can disprove). Revert the mutation.

- [ ] **Step 5:** `pnpm changeset` (minor, `@pretable-internal/row-model`: "`mergeColumnAggregateOverrides` treats a `null` override as 'no aggregate', stripping the declared one"). Commit.

---

### Task 2: react — `aggregate-options.ts`, the closed vocabulary (pure)

**Files:**
- Create: `packages/react/src/tool-panel/grouping/aggregate-options.ts`
- Create: `packages/react/src/tool-panel/grouping/index.ts` (exports `GroupingSection` later; for now the options module)
- Test: `packages/react/src/__tests__/grouping-aggregate-vocabulary-pin.test.ts` (NOTE: `grouping-aggregate-vocabulary.test.tsx` already exists from SP3a — this is a NEW file pinning the PANE's vocabulary; read the existing one first to avoid duplicating its ground)

- [ ] **Step 1: Write the module.** Pure, no React:

```ts
/**
 * The aggregate picker's closed vocabulary — the pane's validation.
 *
 * An invalid aggregate DESTROYS a mounted grid (see `setColumnAggregate`'s
 * TSDoc in pretable-model.ts): grid-core stores aggregates uninterpreted and
 * the throw happens inside a React commit. So the pane never offers a value
 * the compiler could reject: this module mirrors compiled-query's rule —
 * numeric builtins require `type: "number"`, `count` fits any type — and the
 * vocabulary-pin test holds the mirror against the real compiler.
 */

/** What the pane may write for a column: a builtin, or the null sentinel. */
export type AggregateChoice = "sum" | "avg" | "min" | "max" | "count" | null;

const NUMERIC: readonly Exclude<AggregateChoice, null>[] = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
];
const ANY_TYPE: readonly Exclude<AggregateChoice, null>[] = ["count"];

/** Builtins offerable for a column type (never the sentinel or "default" —
 * those are picker chrome, not aggregate values). */
export function builtinAggregatesForType(
  type: "text" | "number" | "date" | "enum" | "boolean" | undefined,
): readonly Exclude<AggregateChoice, null>[] {
  return type === "number" ? NUMERIC : ANY_TYPE;
}

/**
 * The effective aggregate a column shows, for picker display:
 * the override when the id is PRESENT in `columnAggregates` (key presence is
 * the signal — SP3a), else the prop-declared value.
 */
export function effectiveAggregate(
  columnId: string,
  declared: unknown,
  columnAggregates: Readonly<Record<string, unknown>>,
): { readonly value: unknown; readonly overridden: boolean } {
  if (Object.hasOwn(columnAggregates, columnId))
    return { value: columnAggregates[columnId], overridden: true };
  return { value: declared, overridden: false };
}
```

- [ ] **Step 2: Write the vocabulary-pin test.** For each column type × each of the five builtins, drive the REAL compiler via public row-model API (`createLocalRowModel` with a one-column schema of that type plus a text column to group by; `setDerivations` with the builtin as that column's `aggregate`): if `builtinAggregatesForType(type)` offers it, the set must succeed; if it withholds it, the model must throw `CompiledQueryValidationError`. Loop over the full cross product — 25 cases, both directions, so a drifting mirror fails the pin whichever way it drifts. Also pin `effectiveAggregate`: presence beats value (`{a: "sum"}` on a declared `"sum"` → `overridden: true`), and `null` present → `{ value: null, overridden: true }`.

- [ ] **Step 3: Run** the new test file — green. Mutation-check: add `"sum"` to `ANY_TYPE` locally; the pin must fail on every non-number type. Revert.

- [ ] **Step 4: Commit.**

---

### Task 3: surface — `applyRowGroups` routes through `queryWith` and becomes stable

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx:3488-3515` (`applyRowGroups`)
- Test: `packages/react/src/__tests__/grouping-query-write.test.tsx` (new)

- [ ] **Step 1: Write the failing regression test** — the `pendingQueryRef` bypass made observable. Render a `<PretableSurface>` (rows mode, small fixture; copy an existing grouping test's harness). In one act: commit a filter through the panel's write path, then immediately a grouping change, before the model settles (the model settles asynchronously — that's the window). After settle (`await`/`waitFor` on the snapshot), assert BOTH survive: the query holds the new filter AND the new grouping. Then the reverse order. Today the grouping write reads `rowModelSnapshot.query` directly, so the unsettled filter is resubmitted stale — one axis is lost. If reaching the panel's filter write is awkward from a test, call the same seam the sections use (drive `setFilterTree`/`applyRowGroups` through rendered UI — the strip's remove button and the funnel menu are both reachable; `apps/website/e2e` helpers show the selectors, and existing jsdom tests in `tool-panel.test.tsx` show the pattern). The test must FAIL against current `main`'s implementation — verify that before proceeding.

- [ ] **Step 2: Rework `applyRowGroups`.** Keep the signature `(next: readonly string[], focusIntent?: GroupingFocusIntent)`. Replace the body's query submission and drop the unstable deps by reading through `surfaceContextRef`:

```ts
const applyRowGroups = useCallback(
  (next: readonly string[], focusIntent?: GroupingFocusIntent) => {
    const schemaIds = new Set(
      indexed.rowModel.getColumns().map((column) => column.id),
    );
    const rowGroups = Array.from(new Set(next))
      .filter((columnId) => schemaIds.has(columnId))
      .map((columnId) => ({ columnId }));
    const expectedRowGroups = rowGroups.map((entry) => entry.columnId);
    pendingGroupingFocusRef.current = focusIntent
      ? { intent: focusIntent, expectedRowGroups }
      : null;
    // Through `queryWith`, never `indexedGrid.setQuery` directly: this was
    // the last `pendingQueryRef` bypass. `queryWith` re-submits the other
    // axes from the PENDING query when one is in flight, so a grouping
    // change no longer resurrects filters the panel just replaced (and its
    // own write is recorded for the next funnel commit to build on).
    queryWith({ rowGroups: rowGroups as never });
    if (
      groupingListsEqual(
        surfaceContextRef.current.snapshot.rowGroups,
        expectedRowGroups,
      )
    ) {
      pendingGroupingFocusRef.current = null;
    }
  },
  [indexed.rowModel, queryWith],
);
```

Check `surfaceContextRef` actually carries `snapshot` at this point in the file (it carries `rowModelSnapshot` and `renderSnapshot` — find where `snapshot.rowGroups` lives on it; if the surface context holds it under another name, read the same value the old dep read, via the ref). If `surfaceContextRef` does not include the projected `snapshot`, keep `snapshot.rowGroups` OUT of the deps by moving the already-settled check to read from `indexed.rowModel`'s current snapshot (`indexed.rowModel.getSnapshot().rowGroups` mapped to ids — verify the accessor name in `pretable-model.ts`). The invariant to preserve: **the deps array is `[indexed.rowModel, queryWith]` — both model-lifetime stable** — and the settled-check still compares against the CURRENT grouping.

- [ ] **Step 3: Run the new test (now green) plus every existing grouping/tool-panel test file** (`grouping-*`, `group-panel*`, `tool-panel*`, `pretable-surface-*`). The focus-intent behavior must survive — `group-panel-drag.test.tsx` and the surface tests cover it; if any focus test fails, the settled-check read moved to the wrong snapshot.

- [ ] **Step 4: Commit.**

---

### Task 4: shell wiring — section id, icon, messages, descriptor, attributes, css

**Files:**
- Modify: `packages/react/src/tool-panel/sections.ts` (union gains `"grouping"`)
- Modify: `packages/react/src/icons.tsx` (add `GroupingIcon`, copy `ColumnsIcon`'s shape conventions — 16px viewBox, `IconProps`; draw a simple indented-rows glyph)
- Modify: `packages/react/src/tool-panel/messages.ts` (+ `GroupingSectionMessages` Pick)
- Modify: `packages/react/src/pretable-surface.tsx` — `PretableSurfaceMessages` gains the new keys (optional fns, like `toolPanelFiltersLabel` at :633), `defaultMessages`/`effectiveMessages` resolve them (pattern at :1851-1858), descriptor memo gains the third entry, tool-panel config types (`defaultActiveSection`/`activeSection` unions) already reference `ToolPanelSectionId` — verify they widen automatically, and widen any hand-written `"columns" | "filters"` literal
- Create: `packages/react/src/tool-panel/grouping/GroupingSection.tsx` (skeleton this task; filled in Tasks 5–7)
- Modify: `packages/ui/src/grid.css` (locate the tool-panel block; add grouping-section rules in the same `@layer pretable` / `:where()` style; ZERO new tokens)
- Test: `packages/react/src/__tests__/attribute-contract.test.tsx` (register new attributes), `packages/react/src/__tests__/tool-panel.test.tsx` (rail shows three tabs; grouping pane opens)

New message keys (all with English defaults in `defaultMessages`, names following the existing `toolPanel*` scheme): `toolPanelGroupingLabel` (rail tab), `toolPanelGroupByLabel`, `toolPanelAddGroupLabel`, `toolPanelRemoveGroupLabel` (fn of column label), `toolPanelReorderGroupLabel` (fn of column label), `toolPanelNoGroupsMessage`, `toolPanelExpandAllLabel`, `toolPanelCollapseAllLabel`, `toolPanelHideGroupedColumnsLabel`, `toolPanelAggregatesLabel`, `toolPanelAggregateColumnLabel` (fn of column label), `toolPanelAggregateDefaultOption` (fn of the resolved default's label — renders "Default (Sum)"), `toolPanelAggregateNoneOption`, aggregate display names (`toolPanelAggregateSumLabel`, `…AvgLabel`, `…MinLabel`, `…MaxLabel`, `…CountLabel`, `…CustomLabel`).

New data attributes (add to the contract test in the same commit): `data-pretable-tool-grouping`, `data-pretable-group-row`, `data-pretable-add-group`, `data-pretable-expand-all`, `data-pretable-collapse-all`, `data-pretable-hide-grouped`, `data-pretable-aggregate-row` (+ reuse `data-pretable-section="grouping"` on the tab, which the existing attribute machinery already parametrizes).

- [ ] **Step 1: Failing test** in `tool-panel.test.tsx`: the rail renders a third tab (`data-pretable-section="grouping"`), activating it opens a pane containing `[data-pretable-tool-grouping]`.
- [ ] **Step 2:** Widen the union, add the icon, messages keys + defaults, the `GroupingSection` skeleton (renders the container div with `data-pretable-tool-grouping` and the four block placeholders as empty `<div>`s — real content lands in Tasks 5–7), and the descriptor entry. Descriptor `render` passes: `grid={indexedGrid}`, `rowModel={indexed.rowModel}`, `applyRowGroups`, `labelForColumn`, `columns` (a new memo `groupingSectionColumns` beside `filterSectionColumns`: `{ id, label, type?, declaredAggregate? }` from `authoritativeColumns` — props-derived, engine state excluded, same reasoning comment), `aggregatesEnabled={model === undefined}` (rows mode only — spec decision 6), `messages={effectiveMessages}`. Respect the memo's deps rule comment; extend that comment for the new deps.
- [ ] **Step 3:** css for the section's blocks (headings echo the columns section's uppercase subgroup labels; buttons/switch reuse existing control styling — grep how the filters section styles its Add button and copy). Attribute-contract registrations.
- [ ] **Step 4:** Run react tests (tool-panel, attribute-contract, icons) — green. Commit.

---

### Task 5: the group-by block — list, remove, reorder, add

**Files:**
- Modify: `packages/react/src/tool-panel/grouping/GroupingSection.tsx`
- Create: `packages/react/src/tool-panel/grouping/AddGroupMenu.tsx`
- Test: `packages/react/src/__tests__/tool-panel-grouping-section.test.tsx` (new — carries a grouped-grid BUDGET comment; copy the header wording from `grouping-aggregate-overrides.test.tsx`)

Behavior (spec decisions 2, 9; behavior bullets):
- The list is a projection of the row-model snapshot's `rowGroups` (subscribe with `useSyncExternalStore` exactly as `FiltersSection.tsx:346-355` does — cache the read so unrelated publishes bail on equality). NO local copy, NO optimistic state (the strip's TSDoc explains why — same rule).
- Row anatomy: grip · label (via `labelForColumn`) · remove button (`toolPanelRemoveGroupLabel`). Remove commits `applyRowGroups(current minus id)`.
- Drag-reorder within the list via `tool-panel-drop-target.ts` (read `ColumnsSection.tsx`'s usage; commit on release only, whole-array `applyRowGroups`). Keyboard reorder if the columns section offers one — mirror whatever it does, no more.
- `+ Add group` button opens `AddGroupMenu`: schema data columns not currently grouped, using the shared menu-keyboard extraction (grep for the module SP2b extracted — it serves the header column menu, the kebab, and the filter pickers; a FOURTH copy is a review-blocker). Selecting appends: `applyRowGroups([...current, id])`.
- Empty state: `toolPanelNoGroupsMessage`.
- A column hidden by SP1 visibility still lists here unmarked (spec behavior bullet).

- [ ] **Step 1: Failing tests** (jsdom): renders current groups in order; remove writes the shortened list; add menu lists only ungrouped columns and appends; reorder via the drop-target seam writes the full reordered list; strip and pane show the same list after either writes (render both, mutate through one, assert the other — this is the one-model invariant). Keep derivation-flipping mutations within the budget; grouping changes count.
- [ ] **Step 2: Implement.** Run — green.
- [ ] **Step 3: Mutation-check one assertion:** make `applyRowGroups`'s caller pass the UNSORTED old list on reorder and confirm the reorder test fails.
- [ ] **Step 4:** Full react suite. Commit.

---

### Task 6: expansion buttons + hide-grouped switch

**Files:**
- Modify: `packages/react/src/tool-panel/grouping/GroupingSection.tsx`
- Test: extend `packages/react/src/__tests__/tool-panel-grouping-section.test.tsx` **only if budget allows**; otherwise `tool-panel-grouping-controls.test.tsx` (new file, own budget comment)

Behavior (spec decisions 7, 8):
- `Expand all` / `Collapse all` buttons → `rowModel.expandAll()` / `rowModel.collapseAll()`. Disabled (standard disabled treatment, `disabled` attribute — not display:none) while `rowGroups` is empty.
- `Hide grouped columns` — a labelled checkbox/switch bound to indexed-grid state: read `hideGroupedColumns` via `useSyncExternalStore(grid.subscribe, …)` over `grid.getState()`, write `grid.setHideGroupedColumns(!current)`.

- [ ] **Step 1: Failing tests:** with two groups collapsed, Expand all makes child rows visible (assert on RENDERED ROWS, not on having called a method — assert-the-old-behavior discipline); Collapse all reverses; both buttons disabled when ungrouped; the switch reflects engine state seeded by the prop, toggles it, and the drawn columns actually change (the grouped column's header disappears/reappears — prove the pixel-adjacent fact, not the state write).
- [ ] **Step 2: Implement.** Run — green. Commit.

---

### Task 7: the aggregates block

**Files:**
- Modify: `packages/react/src/tool-panel/grouping/GroupingSection.tsx`
- Test: `packages/react/src/__tests__/tool-panel-aggregates-picker.test.tsx` (new file — aggregate tests flip derivations; budget comment mandatory, split again if you exceed ~7 flips)

Behavior (spec decisions 3, 4, 5, 6; behavior bullets):
- Rendered only when `aggregatesEnabled` (rows mode). In explicit-model mode the block is ABSENT (no disabled ghost).
- One row per schema data column (from the descriptor's `columns` — the synthetic group column can never appear). Row: column label + a `<select>`.
- Options: `Default (<label of declared>)` — where declared resolves to a builtin's label, `Custom` for an aggregator object, or `None` when the prop declares nothing — then `None`, then `builtinAggregatesForType(column.type)` labels.
- Select VALUE shows the effective state: no override → the Default option; override → the concrete option (`null` override → `None`). `effectiveAggregate` from Task 2 decides; "no override" and "overridden to the prop's own value" are therefore visibly different (Default (Sum) vs Sum) — spec decision 4.
- onChange: Default → `grid.setColumnAggregate(id, undefined)`; None → `(id, null)`; builtin → `(id, name)`. Never anything else — the closed vocabulary is the validation.
- The block stays rendered while ungrouped (rows mode) — overrides are per-column config.

- [ ] **Step 1: Failing tests:**
  - An override whose computed RESULT differs from the prop's: column declares `avg`, pane sets `sum`, assert the group row's rendered aggregate equals the sum (the numbers chosen so avg ≠ sum — choose-data-that-can-disprove).
  - `None` on a declaring column: group row shows no aggregate for it.
  - Clear (Default) after an override: rendered value returns to the prop's computed result.
  - Distinguishability: with override == declared value, the select's value is the concrete option, not Default (assert on the select's value AND that key presence in `grid.getState().columnAggregates` matches).
  - Mode gating: explicit-model surface renders no `[data-pretable-aggregate-row]`.
  - Non-number column's select offers only Default/None/Count.
- [ ] **Step 2: Implement.** Run — green.
- [ ] **Step 3: Mutation-check:** invert the `Object.hasOwn` presence check in `effectiveAggregate`'s caller (or feed `declared` where the override belongs) and confirm the distinguishability test fails.
- [ ] **Step 4:** Full react suite. Commit.

---

### Task 8: the filters-picker grouped marker + descriptor stability test

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx` (the `filters` descriptor's render-time read at :3618-3650; the undecided-presentation comment at :3536-3564 gets its answer), `packages/react/src/tool-panel/filters/FilterRow.tsx` (render the marker like the existing `hidden` marker), messages (+`toolPanelColumnGroupedMarker`, default "grouped")
- Test: extend `packages/react/src/__tests__/tool-panel.test.tsx` (marker), create `packages/react/src/__tests__/tool-panel-descriptor-stability.test.tsx`

- [ ] **Step 1 (marker):** Failing test: group by column X with `hideGroupedColumns` ON → the filters section's column picker marks X "grouped"; with the switch OFF → unmarked; a hidden-by-visibility column still says "hidden" (the two markers are distinct). Implement by extending the render-time read (the `hiddenIds` block) with `groupedAwayIds` — computed from `grid.getState().hideGroupedColumns && snapshot rowGroups` at RENDER time (the stale-closure rule; read the comment above the memo and follow it). Update the SP2b "undecided" comment to state the decision and point at the spec.
- [ ] **Step 2 (stability):** The missing test for the descriptor memo's deps rule (spec decision 12). Mechanism: `vi.mock` the `./tool-panel` module wrapping the real `ToolPanel` to record each render's `sections` prop identity (`vi.importActual`, re-export everything, wrap only `ToolPanel`). Assert BOTH directions:
  - engine-only change (hide a column through the handle, or toggle hide-grouped) → the recorded `sections` array identity is UNCHANGED across the re-render;
  - a `columns`-prop change → identity CHANGES.
  Then the freshness twin: after the engine-only change, the filters section still shows the fresh hidden marker (already covered by Step 1's test — reference it in a comment rather than duplicating).
- [ ] **Step 3:** Mutation-check the stability test: add `rowModelSnapshot` (any engine-state value) to the descriptor memo's deps locally and confirm the test fails. Revert.
- [ ] **Step 4:** Full react suite. Commit.

---

### Task 9: Playwright e2e + the two `expect.poll` conversions

**Files:**
- Modify: `apps/website/e2e/tool-panel.spec.ts` (grouping-section coverage)
- Modify: `apps/website/e2e/grouping.spec.ts:461` (raceable one-shot → `expect.poll`)
- Modify: `packages/react/src/__tests__/pretable-surface-editing.test.tsx` (group-collapse one-shot → poll/waitFor)

- [ ] **Step 1:** New e2e cases in `tool-panel.spec.ts`, following its existing hydration-gated helpers (`data-pretable-hydrated` before any click — the #1 flake cause):
  - open the grouping section from the rail; add a group level from the pane; a group row appears in the grid; remove it; the group rows disappear; the strip's chips matched the pane's list at both points (one-model invariant, end to end).
  - change an aggregate in the pane; the visible group row's aggregate cell text changes to a value computed differently (pick a column/fixture in the showcase whose sum ≠ avg).
  - keyboard: Tab reaches the rail (one stop), arrows to the grouping tab, Enter opens, Tab walks INTO the section, and forward-Tab from the last control EXITS the panel — `grid-tab-wrap-rows.spec.ts` names the rail stop; run it and confirm it still passes.
- [ ] **Step 2:** Convert `grouping.spec.ts:461`'s one-shot assertion to `expect.poll` (read the filed task's framing: the assertion races settle). Same for the group-collapse assertion in `pretable-surface-editing.test.tsx` (jsdom: `waitFor`/`expect.poll` equivalent).
- [ ] **Step 3:** Run locally per the recipe in memory: `next build` + `next start` + `--workers=1` against the local server. All targeted specs green ("destination stream closed early" noise in the server log is Next's bug — ignore it; failures are what count). Re-run any single failure in isolation before believing it (loaded box).
- [ ] **Step 4:** Commit.

---

### Task 10: docs, api reports, changesets, final verification

**Files:**
- Modify: `apps/website/content/docs/grid/tool-panel.mdx` — the grouping section: what it does, rows-mode-only aggregates (verbatim rationale from the handle TSDoc), the `None`/Default picker semantics, the hide-grouped two-writer note, strip coexistence. New message keys join the messages table; `ToolPanelSectionId`'s prose enumeration gains `"grouping"` (the docs guard's string-union check fails closed until it does — run the docs test suite and follow its error output for the registration mechanics).
- Modify: `packages/react/src/pretable-model.ts` — `setColumnAggregate` TSDoc documents the `null` sentinel ("`null` is a valid aggregate value meaning 'show none', stripped before compile; `undefined` clears the override").
- Create: changesets — `@pretable/react` minor ("tool panel grouping section"), `@pretable/ui` minor (css). (row-model's landed in Task 1.)

- [ ] **Step 1:** Write the docs page section + tables; run the website test/guard suite (`pnpm --filter website test` or the repo's docs-guard script — find it via `package.json`); satisfy every guard it names.
- [ ] **Step 2:** `pnpm build` then `pnpm api` (in that order — stale `dist/` silently strips exports); commit the regenerated `.api.md` reports. `pnpm api:check` green.
- [ ] **Step 3:** Full verification: `pnpm build`, react + row-model + grid-core test suites, `pnpm typecheck`/lint per repo scripts, the targeted e2e from Task 9. Re-run flaky-looking failures in isolation before believing them.
- [ ] **Step 4:** Commit. Push branch, open the PR (base `main`) titled `feat: the tool panel's grouping section (SP3b)`, body summarizing the spec's decisions (incl. the null sentinel, the applyRowGroups debt paid, the grouped-marker decision) — end with the standard generated-with footer. Merge on green only; never record a merge you haven't read back from `gh pr view`.

---

## Self-review notes

- Spec coverage: decisions 1–12 map to Tasks 4 (1), 5 (2, 9), 2+7 (3, 4), 1+7 (5), 7 (6), 6 (7, 8), 3 (10), 8 (11, 12); verification section maps to Tasks 1–2 (pure/row-model), 3/5/6/7/8 (jsdom), 9 (Playwright + poll conversions), 10 (docs/api/changesets).
- The setDerivations-stall budget is named in Tasks 5, 6, 7 — each new grouped test file carries its own budget comment.
- Types used across tasks: `AggregateChoice`/`builtinAggregatesForType`/`effectiveAggregate` (Task 2) consumed in Task 7; `applyRowGroups` signature unchanged (Task 3) consumed in Task 5; message keys named in Task 4 consumed in 5–8.
