# Cell Renderers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-column display customization through layered hooks (`format` returning string, `render` returning ReactNode, `renderHeader` returning ReactNode), with engine-enforced React.memo on every cell to keep the wedge intact. Renames `column.getValue` → `column.value` and removes `column.formatForCopy` (copy uses `column.format`).

**Architecture:** `format` lives on `GridCoreColumn` (engine, returns string) and is reused by both display and copy. `render` and `renderHeader` live on `PretableColumn` (React adapter only, return ReactNode); `PretableColumn` becomes `extends PretableCoreColumn`. The React surface wraps each cell in `React.memo` with a custom `areEqual` that compares value, formattedValue, focus, selection, width, dataAttrs, and the column's render reference. `format` and `value` run unconditionally at the parent every render — their cost is bounded by the cheapness contract documented in the cell-renderers docs page.

**Tech Stack:** TypeScript, React 19, Vitest (jsdom), pnpm workspaces. Touched packages: `@pretable-internal/grid-core`, `@pretable-internal/layout-core`, `@pretable-internal/renderer-dom`, `@pretable-internal/scenario-data`, `@pretable/core`, `@pretable/react`, `apps/bench`, `apps/website` (docs).

**Spec:** [`docs/superpowers/specs/2026-05-06-cell-renderers-design.md`](../specs/2026-05-06-cell-renderers-design.md)

**Working directory:** All paths in this plan are relative to the repo root `/Users/blove/repos/pretable/`. Each phase ships from its own worktree.

---

## Phase Roadmap

Each phase below ships as one PR, merged on green before the next starts. Detail is filled in just-in-time: Phase D1 is fully task-decomposed in this document; subsequent phases have structured outlines and become fully detailed (appended to this file) when their predecessor merges.

| #   | Phase                                                                                                                                                       | Branch / worktree  | Mergeable test surface                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Engine + types: rename `getValue` → `value`, add `format` field, remove `formatForCopy`                                                                     | `d1-engine-format` | grid-core / layout-core / renderer-dom unit tests; copy serializer migrated to `format`; all in-repo callsites updated; existing 75+ grid-core tests still pass                    |
| D2  | React adapter: extend `PretableColumn` with `render` + `renderHeader`, wire format → render pipeline, implement `React.memo`'d cells with custom `areEqual` | `d2-react-render`  | jsdom tests for format pipeline, render override, renderHeader, memo bailout (cell DOM identity preserved across irrelevant parent re-renders), synthetic column ignores renderers |
| D3  | Bench Slab 1: H19 (format-only), H20 (cheap render), H21 (heavy render)                                                                                     | `d3-bench`         | repeated Chromium S2/hypothesis runs satisfy H19, H20, H21 with evidence in `status/runsets/`                                                                                      |

**Worktree per phase:** Implementation for each phase happens in `.worktrees/<branch-name>` (project-local, gitignored). The plan file lives on `d1-engine-format` for now; subsequent phases append their detail to the plan file in their own PRs.

**Just-in-time planning:** When D1 merges, the next phase's master-plan section gets fully detailed by appending to this file in the new worktree. Same pattern as B and C.

---

## Architectural Notes (shared across phases)

### Naming

- Engine type field: `value` (was `getValue`).
- Engine type field: `format` (new).
- React-only type fields: `render`, `renderHeader` (new in D2).
- The reserved synthetic row-select column id `__pretable_row_select__` (constant `ROW_SELECT_COLUMN_ID` from `packages/react/src/constants.ts`) ignores all three renderer hooks.

### Format = display = copy

`column.format` is the single string-formatter. Display (D2 onwards) uses it; copy serialization (`serializeRangesAsTsv` in `packages/react/src/copy.ts`) also uses it. The previous per-column `formatForCopy` field is removed. Copy's default coercion (`defaultCoerceForCopy` for primitives / Date / objects) remains as the fallback when `format` is not provided.

### Memoization (D2 detail)

Each cell wrapped in `React.memo(CellComp, areEqual)`. `areEqual` compares: rowId, columnId, value, formattedValue, isFocused, isSelected, width, dataAttrs, **`renderRef`** (column.render reference). `format` and `value` are NOT in the memo key — they run at the parent each render, but their result (`formattedValue` / `value`) is part of the memo key, so unchanged data → memo bailout.

### No backwards compatibility

Per `feedback_no_backcompat.md`: rename `getValue` → `value` everywhere in the same change. Remove `formatForCopy` in the same change. All in-repo callsites update; no aliases.

---

## File Structure (Phase D1 scope only)

```
packages/grid-core/src/
├── types.ts                                     (MODIFY: rename getValue→value, add format, remove formatForCopy)
├── derived-rows.ts                              (MODIFY: column.getValue → column.value)
└── __tests__/...                                (MODIFY: existing tests use new field name)

packages/layout-core/src/
├── types.ts                                     (MODIFY: rename getValue→value)
├── autosize-columns.ts                          (MODIFY: column.getValue → column.value)
└── __tests__/autosize-columns.test.ts           (MODIFY)

packages/renderer-dom/src/
└── create-renderer.ts                           (MODIFY: rename in column-value resolution)

packages/react/src/
├── rendering.ts                                 (MODIFY: resolveCellValue uses column.value)
├── copy.ts                                      (MODIFY: use column.format; drop formatForCopy branch)
└── __tests__/                                    (MODIFY: copy.test.ts, pretable-surface.test.tsx, others)

packages/scenario-data/src/
└── inspection-profile.ts                        (MODIFY: rename getValue→value)

packages/core/src/
└── (no change — type re-export carries new fields automatically)

apps/bench/src/
└── (search for getValue; update if any)

apps/website/content/docs/
├── getting-started/index.mdx                    (MODIFY: example uses column.value)
└── grid/clipboard.mdx                           (MODIFY: drop formatForCopy section, update for format)
```

---

## Phase D1 — Engine state + format field (FULLY DETAILED)

**Branch:** `d1-engine-format`. **Worktree:** `.worktrees/d1-engine-format`.

**Phase exit criteria:**

- `column.getValue` renamed to `column.value` across every package + app + test + doc. No `getValue` references remain in active code.
- New `column.format` field on `GridCoreColumn` — optional, returns string. Engine doesn't consume it directly; copy and (in D2) display use it.
- `column.formatForCopy` field removed from `GridCoreColumn`. `serializeRangesAsTsv` uses `column.format` instead.
- `pnpm -w typecheck` / `pnpm -w test` / `pnpm -w lint` / `pnpm format` clean.
- One PR opened, CI green, user merges.

### Worktree setup

- [ ] **Step D1.0.1: Verify worktree state**

```bash
cd /Users/blove/repos/pretable/.worktrees/d1-engine-format
git status
git log --oneline -3
```

Expected: clean worktree, branch `d1-engine-format`, recent commits include the spec.

- [ ] **Step D1.0.2: Verify clean baseline**

```bash
pnpm install --frozen-lockfile
pnpm --filter @pretable-internal/grid-core test
```

Expected: 76 grid-core tests pass.

### Task 1 — Update `GridCoreColumn` type

**Files:**

- Modify: `packages/grid-core/src/types.ts`

- [ ] **Step D1.1.1: Rename `getValue` → `value`, add `format`, remove `formatForCopy`**

Open `packages/grid-core/src/types.ts`. Find the `GridCoreColumn<TRow>` interface. Rename `getValue?: (row: TRow) => unknown` to `value?: (row: TRow) => unknown`. Remove the `formatForCopy?: (value: unknown, row: TRow) => string` line. Add `format?: (input: GridCoreFormatInput<TRow>) => string`.

Then add the `GridCoreFormatInput<TRow>` interface near `GridCoreColumn`:

```ts
export interface GridCoreFormatInput<TRow extends GridCoreRow = GridCoreRow> {
  value: unknown;
  row: TRow;
  column: GridCoreColumn<TRow>;
}
```

After this step the `GridCoreColumn` interface should look like:

```ts
export interface GridCoreColumn<TRow extends GridCoreRow = GridCoreRow> {
  id: string;
  header?: string;
  wrap?: boolean;
  widthPx?: number;
  pinned?: "left";
  sortable?: boolean;
  filterable?: boolean;
  value?: (row: TRow) => unknown;
  format?: (input: GridCoreFormatInput<TRow>) => string;
  minWidthPx?: number;
  maxWidthPx?: number;
  resizable?: boolean;
  reorderable?: boolean;
}
```

(Preserve any other existing fields on the interface. Do not remove `widthPx`, `pinned`, `sortable`, `filterable`, etc.)

- [ ] **Step D1.1.2: Export `GridCoreFormatInput` from index**

Open `packages/grid-core/src/index.ts`. Add `GridCoreFormatInput` to the type-export block. Keep the alphabetical-ish ordering matching what's already there.

- [ ] **Step D1.1.3: Run typecheck — expect failures**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: errors in `derived-rows.ts` (uses `column.getValue`). Tasks 2+ fix them.

### Task 2 — Update `derived-rows.ts`

**Files:**

- Modify: `packages/grid-core/src/derived-rows.ts`

- [ ] **Step D1.2.1: Rename `column.getValue` to `column.value`**

Open `packages/grid-core/src/derived-rows.ts`. Around line 143 (find via the existing `getValue` reference):

```ts
return column.getValue ? column.getValue(row) : row[column.id];
```

Change to:

```ts
return column.value ? column.value(row) : row[column.id];
```

This is the only line in this file that needs changing.

- [ ] **Step D1.2.2: Typecheck grid-core**

```bash
pnpm --filter @pretable-internal/grid-core typecheck
```

Expected: passes.

- [ ] **Step D1.2.3: Run grid-core tests**

```bash
pnpm --filter @pretable-internal/grid-core test
```

Expected: 76 tests pass (no test changes needed — none of the existing grid-core tests use `getValue`).

### Task 3 — Update layout-core

**Files:**

- Modify: `packages/layout-core/src/types.ts`
- Modify: `packages/layout-core/src/autosize-columns.ts`
- Modify: `packages/layout-core/src/__tests__/autosize-columns.test.ts`

- [ ] **Step D1.3.1: Rename in `layout-core/types.ts`**

Open `packages/layout-core/src/types.ts`. Around line 85, find `getValue?: (row: TRow) => unknown` and rename to `value?: (row: TRow) => unknown`.

- [ ] **Step D1.3.2: Rename in `autosize-columns.ts`**

Open `packages/layout-core/src/autosize-columns.ts`. Around line 32, find:

```ts
const rawValue = column.getValue ? column.getValue(row) : row[column.id];
```

Change to:

```ts
const rawValue = column.value ? column.value(row) : row[column.id];
```

- [ ] **Step D1.3.3: Update layout-core tests**

Open `packages/layout-core/src/__tests__/autosize-columns.test.ts`. Around line 101, find:

```ts
getValue: (row: Record<string, unknown>) =>
```

Change to:

```ts
value: (row: Record<string, unknown>) =>
```

(Preserve the rest of the test setup; only the field name changes.)

- [ ] **Step D1.3.4: Typecheck + test layout-core**

```bash
pnpm --filter @pretable-internal/layout-core typecheck
pnpm --filter @pretable-internal/layout-core test
```

Expected: typecheck passes; layout-core tests pass.

### Task 4 — Update renderer-dom

**Files:**

- Modify: `packages/renderer-dom/src/create-renderer.ts`

- [ ] **Step D1.4.1: Rename in `create-renderer.ts`**

Open `packages/renderer-dom/src/create-renderer.ts`. Around line 185, find:

```ts
return column.getValue ? column.getValue(row) : row[column.id];
```

Change to:

```ts
return column.value ? column.value(row) : row[column.id];
```

- [ ] **Step D1.4.2: Typecheck + test renderer-dom**

```bash
pnpm --filter @pretable-internal/renderer-dom typecheck
pnpm --filter @pretable-internal/renderer-dom test
```

Expected: passes.

### Task 5 — Update React rendering helper

**Files:**

- Modify: `packages/react/src/rendering.ts`

- [ ] **Step D1.5.1: Rename in `resolveCellValue`**

Open `packages/react/src/rendering.ts`. Around line 55, find:

```ts
return column.getValue ? column.getValue(row) : row[column.id];
```

Change to:

```ts
return column.value ? column.value(row) : row[column.id];
```

- [ ] **Step D1.5.2: Typecheck @pretable/react**

```bash
pnpm --filter "@pretable*" build
pnpm --filter @pretable/react typecheck
```

Expected: typecheck passes (other react files still compile against the renamed field).

### Task 6 — Update copy serializer to use `format`

**Files:**

- Modify: `packages/react/src/copy.ts`

This is the most substantive change in D1: the copy path moves from `column.formatForCopy` to `column.format`.

- [ ] **Step D1.6.1: Read the current `serializeRangesAsTsv` cell-resolution loop**

Open `packages/react/src/copy.ts`. Around lines 110-120 (the per-cell resolution inside the row+column loop), the current code resolves a cell's text via:

```ts
const raw = col.getValue
  ? col.getValue(row.row)
  : (row.row as Record<string, unknown>)[col.id];
const text = col.formatForCopy
  ? col.formatForCopy(raw, row.row)
  : defaultCoerceForCopy(raw);
```

- [ ] **Step D1.6.2: Replace with `value` + `format` lookup**

Replace the block above with:

```ts
const raw = col.value
  ? col.value(row.row)
  : (row.row as Record<string, unknown>)[col.id];
const text = col.format
  ? col.format({ value: raw, row: row.row, column: col })
  : defaultCoerceForCopy(raw);
```

The `column` field in the format input is the column object itself (`col`), giving the consumer access to `col.id`, `col.header`, etc. inside their formatter.

- [ ] **Step D1.6.3: Typecheck @pretable/react**

```bash
pnpm --filter @pretable/react typecheck
```

Expected: passes.

- [ ] **Step D1.6.4: Run copy unit tests**

```bash
pnpm --filter @pretable/react test copy
```

Expected: tests fail because they still reference `formatForCopy`. Task 8 migrates them.

### Task 7 — Update scenario-data + bench

**Files:**

- Modify: `packages/scenario-data/src/inspection-profile.ts`

- [ ] **Step D1.7.1: Rename in `inspection-profile.ts`**

Open `packages/scenario-data/src/inspection-profile.ts`. Find both occurrences (around lines 36 and 56):

```ts
getValue?: (row: InspectionRow) => string;
```

and

```ts
getValue: (row) => row.tags.join(", "),
```

Rename both to `value` (the type signature and the implementation).

- [ ] **Step D1.7.2: Search for any bench callsites**

```bash
grep -rn "\.getValue\b\|getValue?:\|getValue:" apps/bench/src 2>/dev/null
```

Expected: no matches. If any appear, update them analogously.

- [ ] **Step D1.7.3: Typecheck workspace-wide**

```bash
pnpm --filter "@pretable*" build
pnpm -w typecheck
```

Expected: typecheck passes for all packages and apps. Tests still need migration (Task 8).

### Task 8 — Migrate tests

**Files:**

- Modify: `packages/react/src/__tests__/copy.test.ts`
- Modify: `packages/react/src/__tests__/pretable-surface.test.tsx`
- Modify: `packages/react/src/__tests__/labeled-grid-surface.test.tsx`
- Modify: `packages/react/src/__tests__/pretable.test.tsx`

- [ ] **Step D1.8.1: Migrate `copy.test.ts`**

Open `packages/react/src/__tests__/copy.test.ts`. Around line 123-128 there is a test titled `"formatForCopy on a column overrides default coercion"`. Rename the test to `"format on a column overrides default coercion"`. Inside the test, find `formatForCopy: (value) => `[${String(value)}]`` and change to:

```ts
format: ({ value }) => `[${String(value)}]`,
```

(Note the new input shape: destructure `{ value }` from the input object.)

Also search the file for any other `getValue:` test fixtures and rename to `value:`. The fixture column at the top of the file probably has these — preserve their behavior, just rename.

- [ ] **Step D1.8.2: Migrate `pretable-surface.test.tsx`**

Open `packages/react/src/__tests__/pretable-surface.test.tsx`. Around line 53:

```ts
getValue: (row: DemoRow) => row.tags.join(" / "),
```

Rename to:

```ts
value: (row: DemoRow) => row.tags.join(" / "),
```

Around line 2618 there is a test titled `"formatForCopy on a column overrides default coercion in the body"`. Rename to `"format on a column overrides default coercion in the body"`. Inside, find:

```ts
formatForCopy: (value: unknown) => `FORMATTED:${String(value)}`,
```

Change to:

```ts
format: ({ value }: { value: unknown }) => `FORMATTED:${String(value)}`,
```

Search the rest of the file for `getValue:` / `formatForCopy:` and rename analogously.

- [ ] **Step D1.8.3: Migrate `labeled-grid-surface.test.tsx`**

Open `packages/react/src/__tests__/labeled-grid-surface.test.tsx`. Around line 31:

```ts
getValue: (row: DemoRow) => row.tags,
```

Rename to:

```ts
value: (row: DemoRow) => row.tags,
```

- [ ] **Step D1.8.4: Migrate `pretable.test.tsx`**

Open `packages/react/src/__tests__/pretable.test.tsx`. Around line 92:

```ts
getValue: (row: { firstName: string; lastName: string }) =>
```

Rename to:

```ts
value: (row: { firstName: string; lastName: string }) =>
```

- [ ] **Step D1.8.5: Search for any remaining `getValue` in tests**

```bash
grep -rn "\.getValue\b\|getValue?:\|getValue:" packages/ apps/ 2>/dev/null | grep -v node_modules | grep -v dist
```

Expected: no matches in source or test files. (Matches in `node_modules` or `dist` are fine — those are build artifacts.)

- [ ] **Step D1.8.6: Run all tests**

```bash
pnpm -w test
```

Expected: passes. Test counts:

- grid-core: 76
- layout-core: existing count, unchanged
- renderer-dom: existing count, unchanged
- @pretable/core: existing count, unchanged
- @pretable/react: 192 (formatForCopy → format test renamed but still passes)
- apps/website: existing count, unchanged

### Task 9 — Update website docs

**Files:**

- Modify: `apps/website/content/docs/getting-started/index.mdx`
- Modify: `apps/website/content/docs/grid/clipboard.mdx`

- [ ] **Step D1.9.1: Update `getting-started/index.mdx`**

Open `apps/website/content/docs/getting-started/index.mdx`. Around line 34:

```mdx
{ id: "name", header: "Name", getValue: (r) => r.name },
```

Change to:

```mdx
{ id: "name", header: "Name", value: (r) => r.name },
```

- [ ] **Step D1.9.2: Update `clipboard.mdx`**

Open `apps/website/content/docs/grid/clipboard.mdx`. The page describes per-column `formatForCopy` extensively. Replace the per-column section heading and prose with the new model:

Find the section `## Per-column formatForCopy` (around line 21) and:

- Rename the heading to `## Per-column format`.
- Update the description to: "For domain-specific formatting (a Date that should copy as `YYYY-MM-DD` instead of full ISO, a number with grouping separators, a status enum that should copy as a label), supply `format` on the column. The same formatter drives display rendering (in a follow-up phase) and copy serialization, so consumers configure it once."
- Update any code examples in the section: `formatForCopy: (value) =>` → `format: ({ value }) =>`.

The frontmatter `description` (line 3) reads:

```
description: "Cmd+C copy with TSV defaults, per-column formatForCopy, grid-level onCopy override."
```

Update to:

```
description: "Cmd+C copy with TSV defaults, per-column format, grid-level onCopy override."
```

Search the file for any other `formatForCopy` references and rename. Verify the page builds.

- [ ] **Step D1.9.3: Search for any remaining `formatForCopy` in docs**

```bash
grep -rn "formatForCopy" apps/website/content/docs 2>/dev/null
```

Expected: no matches.

- [ ] **Step D1.9.4: Build the website**

```bash
pnpm --filter @pretable/app-website build
```

Expected: build succeeds; MDX compiles.

- [ ] **Step D1.9.5: Commit Tasks 1–9**

```bash
git add packages/ apps/website/content/docs/
git commit -m "feat(grid-core): rename column.getValue → column.value; add format field

Renames column.getValue to column.value across grid-core, layout-core,
renderer-dom, scenario-data, and react. Adds an optional format
field on GridCoreColumn (returns string) used by the copy serializer
in this phase and by display rendering in D2. Removes the
formatForCopy field; copy now uses format. Updates all in-repo
callsites and tests; no backwards-compat alias.

The format function takes a single GridCoreFormatInput { value, row,
column } argument, matching how render and renderHeader will be shaped
in D2.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 10 — Repo-wide gates and PR

- [ ] **Step D1.10.1: Run repo-wide typecheck**

```bash
pnpm -w typecheck
```

Expected: passes for every workspace.

- [ ] **Step D1.10.2: Run repo-wide tests**

```bash
pnpm -w test
```

Expected: all tests pass.

- [ ] **Step D1.10.3: Run lint and format**

```bash
pnpm -w lint
pnpm format
```

Expected: 0 lint errors. If `pnpm format` reports issues, run `pnpm prettier --write .` and commit as a follow-up `style: prettier --write` commit.

- [ ] **Step D1.10.4: Push branch and open PR**

```bash
git push -u origin d1-engine-format
gh pr create --title "feat(grid-core): rename getValue→value; add format field (Phase D1)" --body "$(cat <<'EOF'
## Summary

Phase D1 of sub-project D — engine type renames + new `format` field. Spec: \`docs/superpowers/specs/2026-05-06-cell-renderers-design.md\`. Plan: \`docs/superpowers/plans/2026-05-06-cell-renderers.md\` (§Phase D1 detail).

## Engine changes

- Rename \`column.getValue\` → \`column.value\` across \`@pretable-internal/grid-core\`, \`@pretable-internal/layout-core\`, \`@pretable-internal/renderer-dom\`, \`@pretable-internal/scenario-data\`, and \`@pretable/react\`.
- Add \`column.format?: (input: GridCoreFormatInput<TRow>) => string\` on \`GridCoreColumn\`. Optional, returns string. Engine doesn't consume directly; copy uses it now, display will in D2.
- Add \`GridCoreFormatInput<TRow>\` type: \`{ value, row, column }\`.
- Remove \`column.formatForCopy\`. Copy serializer uses \`column.format\` with fallback to \`defaultCoerceForCopy\`.

## What's NOT in this PR

- React adapter \`render\` / \`renderHeader\` per-column hooks — Phase D2.
- Cell-level \`React.memo\` with custom \`areEqual\` — Phase D2.
- Bench Slab 1 hypotheses (H19/H20/H21) — Phase D3.

## Test plan

- [x] grid-core: 76 unit tests pass
- [x] layout-core: existing tests migrated and pass
- [x] @pretable/react: 192 tests pass; copy.test.ts and surface tests migrated to use \`format\` instead of \`formatForCopy\`
- [x] @pretable/core: typechecks and tests pass
- [x] apps/website: build succeeds; getting-started + clipboard docs migrated
- [x] repo-wide pnpm -w typecheck / test / lint / format pass

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step D1.10.5: Set auto-merge and notify the user**

```bash
gh pr merge <pr-number> --auto --squash
```

Per the standing workflow preference, the user merges (auto-merge fires once CI passes; if merge requires approval workflow, defer to user).

---

## Phase D2 — React adapter: `render` + `renderHeader` + memoization (DETAILED)

**Branch:** `d2-react-render`. **Worktree:** `.worktrees/d2-react-render`.

**Phase exit criteria:**

- `PretableColumn<TRow>` extends `PretableCoreColumn<TRow>` with optional `render` + `renderHeader` ReactNode-returning fields.
- New input types: `PretableCellRenderInput<TRow>`, `PretableHeaderRenderInput<TRow>`, `PretableFormatInput<TRow>` (the React-side re-export of `GridCoreFormatInput`).
- `<PretableSurface>` body cell render path runs `format → render` pipeline. Precedence: per-column `render` → grid-level `renderBodyCell` → default `formattedValue` text.
- Header render path: per-column `renderHeader` → grid-level `renderHeaderCell` → default label + sort indicator.
- `<MemoizedCell />` and `<MemoizedHeader />` wrap the inner cell/header content in `React.memo` with custom `areEqual` per the spec.
- Synthetic row-select column ignores `format`, `render`, `renderHeader`.
- jsdom test count: 192 → 205+. Includes a DOM-identity test for memo bailout.
- `pnpm -w typecheck` / `test` / `lint` / `format` clean.
- One PR opened, CI green, user merges.

### Resolved open questions

- **Memo prop shape**: pass primitive props (rowId, columnId, value, formattedValue, isFocused, isSelected, width, dataAttrs, renderRef). Don't pass the full `column` object — its identity changes when consumer columns array changes, busting memo unnecessarily. The `renderRef` (= `column.render` or `null`) is the only column-derived reference compared.
- **Cell renderer access to row-state**: only `isFocused` / `isSelected` (cell-level booleans). Engine-level row-state derivations (selected row IDs map, etc.) stay at the grid surface level. Consumers who need row-level context can derive from `row` (passed in input).
- **DOM-identity test**: ref-capture the cell `<div>` DOM node on first render, force an irrelevant parent re-render (e.g., toggle a sibling state), assert the captured node is `===` the new render's node. Plus a mount-count counter via `useEffect(() => { mountsRef.current += 1; }, [])` that should stay at 1.

### Tasks

#### Task 1 — Restructure `PretableColumn` + new input types

**Files:**
- `packages/core/src/types.ts` — split out `PretableCoreColumn` from `PretableColumn`.
- `packages/react/src/types.ts` (CREATE if it doesn't exist) — add React-only types.
- `packages/react/src/index.ts` — export new types.

In `packages/core/src/types.ts`, find the existing `PretableColumn = GridCoreColumn` alias. Replace with:

```ts
import type { GridCoreColumn, GridCoreFormatInput } from "@pretable-internal/grid-core";

// Re-export the engine-level column type (no React).
export type PretableCoreColumn<TRow extends Record<string, unknown>> = GridCoreColumn<TRow>;
export type PretableFormatInput<TRow extends Record<string, unknown>> = GridCoreFormatInput<TRow>;
```

`PretableColumn` moves to the React package. In `packages/react/src/types.ts` (CREATE):

```ts
import type { ReactNode } from "react";
import type {
  PretableCoreColumn,
  PretableFormatInput,
  PretableRow,
} from "@pretable/core";

export interface PretableColumn<TRow extends PretableRow = PretableRow>
  extends PretableCoreColumn<TRow> {
  render?: (input: PretableCellRenderInput<TRow>) => ReactNode;
  renderHeader?: (input: PretableHeaderRenderInput<TRow>) => ReactNode;
}

export interface PretableCellRenderInput<TRow extends PretableRow = PretableRow>
  extends PretableFormatInput<TRow> {
  formattedValue: string;
  rowId: string;
  rowIndex: number;
  isFocused: boolean;
  isSelected: boolean;
}

export interface PretableHeaderRenderInput<TRow extends PretableRow = PretableRow> {
  column: PretableColumn<TRow>;
  label: string;
  sortDirection: "asc" | "desc" | null;
  isSorted: boolean;
}

// Re-export the format input under the React name for symmetry with cell/header.
export type { PretableFormatInput };
```

In `packages/react/src/index.ts`, add the three new types to the exports. Move `PretableColumn` from being re-exported from `@pretable/core` to being defined in `./types` (the React package becomes the canonical source for `PretableColumn`).

**Critical**: every existing `import { PretableColumn } from "@pretable/core"` inside the React package becomes `import { PretableColumn } from "./types"` (or wherever it's defined locally). Outside the React package, `PretableColumn` is no longer exported from `@pretable/core` — only `PretableCoreColumn`. Search for usages and migrate.

In `packages/core/src/index.ts`, replace the `PretableColumn` export with `PretableCoreColumn` and `PretableFormatInput`.

**Commit:** `feat(react): split PretableColumn from PretableCoreColumn`.

#### Task 2 — Wire format → render pipeline

**Files:**
- `packages/react/src/pretable-surface.tsx`

Around line 1480 (the body cell render path), the current code reads:

```tsx
) : renderBodyCell ? (
  renderBodyCell(bodyInput)
) : (
  formatCellValue(value)
)}
```

The new pipeline:

```tsx
const formattedValue = column.format
  ? column.format({ value, row: row.row, column })
  : formatCellValue(value);

const cellRenderInput: PretableCellRenderInput<TRow> = {
  value,
  row: row.row,
  column,
  formattedValue,
  rowId: row.id,
  rowIndex: row.rowIndex,
  isFocused,
  isSelected,
};

// In the JSX:
{column.render ? (
  column.render(cellRenderInput)
) : renderBodyCell ? (
  renderBodyCell(cellRenderInput)
) : (
  formattedValue
)}
```

Note `renderBodyCell`'s input type changes from the old `PretableSurfaceBodyCellRenderInput` to the new `PretableCellRenderInput`. They're nearly the same — just renamed and `formattedValue` added.

For headers, around line 1106:

```tsx
{column.renderHeader
  ? column.renderHeader({ column, label, sortDirection, isSorted })
  : renderHeaderCell
    ? renderHeaderCell({ column, label, sortDirection })
    : <DefaultHeaderContent label={label} sortDirection={sortDirection} />
}
```

(Where `DefaultHeaderContent` is the existing default header rendering — extract it from the current inline JSX if needed.)

For the synthetic row-select column (`column.id === ROW_SELECT_COLUMN_ID`), skip the per-column render hooks entirely — render the existing checkbox path. Already true via the existing branch in pretable-surface.tsx that handles synthetic specially; verify and preserve.

**Commit:** `feat(react): per-column format + render + renderHeader pipeline`.

#### Task 3 — Memoized cell + header components

**Files:**
- `packages/react/src/pretable-surface.tsx`

Extract the body cell rendering into a `<MemoizedCell />` component:

```tsx
interface MemoizedCellProps<TRow extends PretableRow> {
  rowId: string;
  columnId: string;
  value: unknown;
  formattedValue: string;
  width: number;
  isFocused: boolean;
  isSelected: boolean;
  dataAttrs: HTMLAttributes<HTMLDivElement> | undefined;
  renderRef: ((input: PretableCellRenderInput<TRow>) => ReactNode) | null;
  // The full cell render input — needed when render is invoked.
  // Stable as long as the primitive props above are stable.
  cellRenderInput: PretableCellRenderInput<TRow>;
  // Existing surface-level fallback for when renderRef is null.
  fallbackRender: (input: PretableCellRenderInput<TRow>) => ReactNode;
  className: string | undefined;
  style: CSSProperties;
  onClick: ((event: ReactMouseEvent<HTMLDivElement>) => void) | undefined;
  // ... any other DOM-attaching props from the existing rendering
}

function CellComp<TRow extends PretableRow>(props: MemoizedCellProps<TRow>) {
  return (
    <div
      {...props.dataAttrs}
      className={props.className}
      style={props.style}
      onClick={props.onClick}
      role="gridcell"
      aria-colindex={...}
      tabIndex={props.isFocused ? 0 : -1}
    >
      {props.renderRef
        ? props.renderRef(props.cellRenderInput)
        : props.fallbackRender(props.cellRenderInput)}
    </div>
  );
}

const cellPropsEqual = <TRow extends PretableRow>(
  prev: MemoizedCellProps<TRow>,
  next: MemoizedCellProps<TRow>,
) =>
  prev.rowId === next.rowId &&
  prev.columnId === next.columnId &&
  prev.value === next.value &&
  prev.formattedValue === next.formattedValue &&
  prev.isFocused === next.isFocused &&
  prev.isSelected === next.isSelected &&
  prev.width === next.width &&
  prev.dataAttrs === next.dataAttrs &&
  prev.renderRef === next.renderRef &&
  prev.className === next.className;

const MemoizedCell = React.memo(CellComp, cellPropsEqual) as typeof CellComp;
```

In the existing render path, replace the inline cell `<div>` with `<MemoizedCell {...props} />`. The parent computes all props each render; React.memo bails out if the relevant fields are reference-equal.

Do the same for `<MemoizedHeader />`. Header `areEqual`:

```ts
prev.columnId === next.columnId &&
prev.label === next.label &&
prev.sortDirection === next.sortDirection &&
prev.width === next.width &&
prev.isSorted === next.isSorted &&
prev.isSortable === next.isSortable &&
prev.renderHeaderRef === next.renderHeaderRef
```

**Commit:** `feat(react): React.memo on cell + header with custom areEqual`.

#### Task 4 — jsdom tests for the pipeline + memoization

**Files:**
- `packages/react/src/__tests__/pretable-surface.test.tsx` — extend with new `describe("cell renderers", ...)` block.

Tests:

1. **`column.format` runs on every cell** — column with `format: ({ value }) => \`F:\${value}\``; assert rendered cells contain `F:<value>` text.
2. **`column.render` returning custom ReactNode** — `render: ({ formattedValue }) => <span data-testid="custom">{formattedValue}</span>`; assert `data-testid="custom"` element rendered for that column.
3. **`column.renderHeader` returning custom ReactNode** — `renderHeader: ({ label }) => <em>{label}</em>`; assert `<em>` element in header.
4. **Per-column `render` overrides grid-level `renderBodyCell`** — both provided; per-column wins for that column; grid-level applies to other columns.
5. **`format` result reaches grid-level `renderBodyCell`** — column has `format` but no `render`; grid-level `renderBodyCell` receives `formattedValue` in its input.
6. **Synthetic row-select column ignores `format`/`render`/`renderHeader`** — render with `rowSelectionColumn={{enabled:true}}` and a `render` set on the synthetic column id (which won't exist as the consumer can't define it, but verify via check that the synthetic column's checkbox cell ignores any per-column hook by inspecting the rendered DOM).
7. **Memo bailout: cell DOM identity preserved across irrelevant parent re-renders** — render harness with a parent state toggle that doesn't affect cells; capture cell DOM via ref before toggle; toggle state; assert ref still points to the same DOM node. Augment with a mount-count `useEffect` counter inside a custom render function that asserts mount count stays at 1.
8. **Memo busts when value changes** — change underlying row data (re-render with new rows array containing updated value for the cell); assert cell DOM identity changes (new mount) OR text content updates.
9. **Memo busts when `column.render` reference changes** — re-render with a new column array containing a new (different reference) render function; assert cell re-renders.
10. **Header memoization parallel** — analogous test for the header.
11. **Default rendering uses `formattedValue`** — neither `render` nor grid-level `renderBodyCell`; column has `format`; rendered cell text is `format`'s output, not raw value.

Test count target: 192 → 205+.

**Commit:** `test(react): cell renderers pipeline + memoization coverage`.

#### Task 5 — Doc updates

**Files:**
- Create: `apps/website/content/docs/grid/cell-renderers.mdx`
- Modify: `apps/website/content/docs/grid/api-reference.mdx` (add new types)
- Modify: `apps/website/app/docs/_nav.ts` (add nav entry)
- Modify: `apps/website/content/docs/grid/custom-rendering.mdx` (point at per-column renderers as canonical)

`cell-renderers.mdx` covers:
- Pipeline overview (value → format → render → memo)
- `format` examples (date ISO, number with units, status enum → label)
- `render` examples (badge component, status with color)
- `renderHeader` example (icon + label)
- Memoization contract: `areEqual` fields, `useMemo` your column array
- Perf warnings: heavy `format` / inline `render` in column defs
- Synthetic row-select column note
- Forward pointer to D2 editing (deferred)

Frontmatter `nav: Grid`, `order: 8`. Bump existing pages: custom-rendering 8→9, density-helpers 9→10, api-reference 10→11.

In `api-reference.mdx`, add `PretableColumn` (now React-package), `PretableCoreColumn` (engine), `PretableCellRenderInput`, `PretableHeaderRenderInput`, `PretableFormatInput` types.

Update `_nav.ts` to insert `Cell renderers` between Column Layout and Custom Rendering.

**Commit:** `docs(website): cell-renderers page + api-reference + nav`.

#### Task 6 — Repo-wide gates + PR

`pnpm -w typecheck` / `test` / `lint` / `format` clean. Push, open PR titled `feat(react): cell renderers — format + render + memoization (Phase D2 of D)`.

---

## Phase D3 — Bench Slab 1: H19 / H20 / H21 (OUTLINE)

**Branch:** `d3-bench`. **Detail:** added when D2 merges.

**Work items:**

- New `BenchScriptName` enum values in `packages/bench-runner/src/index.ts`: `scroll-with-format`, `scroll-with-render`, `scroll-with-heavy-render`.
- New scripts in `apps/bench/src/`: each opts into a different `format` / `render` configuration on the columns when running. Pretable adapter wires through; comparator adapters mark unsupported.
- Hypothesis evaluators in `scripts/bench-matrix.mjs`:
  - **H19** (`evaluateH19`): `S2/hypothesis/pretable/scroll-with-format` — scroll p95 ≤ baseline + 2ms.
  - **H20** (`evaluateH20`): `S2/hypothesis/pretable/scroll-with-render` — scroll p95 ≤ 16ms (single-frame budget).
  - **H21** (`evaluateH21`): `S2/hypothesis/pretable/scroll-with-heavy-render` — scroll p95 ≤ 20ms (≤ 25% above single-frame budget).
- Repeated Chromium S2/hypothesis runs to capture evidence in `status/runsets/`. ×3 repeats per hypothesis.
- Update `docs/research/repo-memory.md` with the new checkpoint.

**Open questions to resolve when detailing:**

- Threshold realism: 16ms / 20ms are theoretical budgets. Real measurements may come in higher; if so, fix the cause (per the project's discipline) rather than relax the threshold. May require a small D3.5 fix phase before the hypotheses can ship.
- Comparator support: out of scope for D3 (Slab 1 only). Comparative validation is a future sub-project, similar to B2.
- Bench wall-clock cost: each hypothesis run takes ~5 minutes per repeat. ×3 repeats × 3 hypotheses = ~45 minutes of real runtime. Plan accordingly when picking up D3.

---

## Self-Review

**Spec coverage check** (against `2026-05-06-cell-renderers-design.md`):

| Spec section                                       | Covered by                                                 |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Goal: layered hooks (format, render, renderHeader) | D1 (engine field), D2 (React surface + render path)        |
| Engine vs React separation                         | D1 (engine GridCoreColumn), D2 (PretableColumn extends)    |
| Column type: rename getValue→value, add format     | D1 Tasks 1-7                                               |
| `formatForCopy` removal; copy uses format          | D1 Task 6                                                  |
| Synthetic row-select column ignores renderers      | D2 Outline + tests                                         |
| Render pipeline (value → format → render)          | D1 sets up format; D2 wires the pipeline                   |
| Engine-enforced memoization with custom areEqual   | D2 Outline                                                 |
| Interaction with grid-level renderBodyCell         | D2 Outline (precedence: per-column → grid-level → default) |
| Phase structure (D1/D2/D3)                         | This plan's roadmap                                        |
| Bench plan (H19/H20/H21)                           | D3 Outline                                                 |
| Test layering (engine, adapter, bench)             | D1 Tasks 8-9, D2 Outline, D3 Outline                       |
| Documentation (cell-renderers.mdx + api-reference) | D2 Outline (docs land alongside React adapter)             |
| Exit criteria                                      | Cumulative across D1-D3                                    |

All spec sections are covered.

**Placeholder scan:** None remain. The phase outlines are explicitly outlines (not bite-sized tasks); they will be detailed before their phase begins. The "Open questions to resolve when detailing" subsections record decisions to make at detail-time, not skipped detail.

**Type consistency check:**

- `GridCoreFormatInput<TRow>` is defined in Task 1.1.1 (`{ value, row, column }`) and used by Task 6.6.2 (`column.format({ value: raw, row: row.row, column: col })`). Match.
- `column.value(row)` signature consistent across Tasks 2 (derived-rows), 3 (autosize-columns), 4 (renderer-dom), 5 (rendering.ts), 6 (copy.ts), 7 (scenario-data).
- `column.format` returns `string` everywhere.
- `formatForCopy` removal is consistent: removed in Task 1 (engine type), removed in Task 6 (copy serializer), tests renamed in Task 8, docs updated in Task 9.

**Scope check:** Phase D1 is bounded to engine + types + copy migration. No React adapter render-path changes (those land in D2). The phase produces a working, testable engine update with all callsites migrated.

---

## After Phase D1 merges

When D1 lands on `main`, append a "## Phase D2 — Detailed Tasks" section to this file (in a new `d2-react-render` worktree), replacing the D2 outline above with bite-sized tasks. Then execute. Repeat for D3.
