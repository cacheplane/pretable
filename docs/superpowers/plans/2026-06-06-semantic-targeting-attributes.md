# Semantic Targeting Attributes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the grid's styling/identity/state DOM attributes under a consistent `data-pretable-*` namespace, add header `data-pretable-column-id`, remove the dead `[data-pinned="right"]` CSS rule, and document the contract.

**Architecture:** A scoped rename of `@pretable/react`'s emitted attributes (and every reader: `grid.css`, the bench _pretable_ profile, tests, docs), plus one new emitted attribute (header column-id) and a structural test that locks the namespace. Pre-1.0, no backcompat aliases. Comparator adapters (TanStack/AG Grid/MUI) keep their own unprefixed attrs — do not touch them.

**Tech Stack:** React + TypeScript (`@pretable/react`), vitest (jsdom), CSS cascade layers (`@pretable/ui`), Playwright/bench harness, Next.js MDX docs.

**Spec:** `docs/superpowers/specs/2026-06-06-semantic-targeting-attributes-design.md`

**The rename map** (applies to `@pretable/react`'s emitted attrs ONLY — these strings appear in this codebase only as DOM attribute names / test query strings):

| Old                    | New                             |
| ---------------------- | ------------------------------- |
| `data-column-id`       | `data-pretable-column-id`       |
| `data-row-id`          | `data-pretable-row-id`          |
| `data-row-index`       | `data-pretable-row-index`       |
| `data-row-height`      | `data-pretable-row-height`      |
| `data-selected`        | `data-pretable-selected`        |
| `data-focused`         | `data-pretable-focused`         |
| `data-pinned`          | `data-pretable-pinned`          |
| `data-row-select-cell` | `data-pretable-row-select-cell` |

Already correct (do not change): `data-pretable-cell`, `data-pretable-header-cell`, `data-pretable-row`, `data-pretable-wrap`, `data-pretable-row-select-header`, `data-testid`, all `aria-*`, `role`.

---

### Task 1: Rename + header gap-fill in `@pretable/react`, with a namespace guard test

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx` (body cell ~1555, header cell ~1180, row ~1485)
- Modify: `packages/react/src/labeled-grid-surface.tsx` (~136, ~153)
- Modify: `packages/react/src/__tests__/pretable-surface.test.tsx`, `pretable.test.tsx`, `inspection-grid.test.tsx`, `labeled-grid-surface.test.tsx`
- Create: `packages/react/src/__tests__/attribute-contract.test.tsx`

- [ ] **Step 1: Write the namespace guard test (failing)**

Create `packages/react/src/__tests__/attribute-contract.test.tsx`:

```tsx
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { PretableSurface } from "../public_api";
import type { PretableColumn } from "../types";

type Row = { id: string; name: string; amount: number };

const columns: PretableColumn<Row>[] = [
  { id: "name", header: "Name", pinned: "left" },
  { id: "amount", header: "Amount" },
];
const rows: Row[] = [
  { id: "r1", name: "Alpha", amount: 1 },
  { id: "r2", name: "Beta", amount: 2 },
];

describe("attribute contract", () => {
  test("every Pretable-emitted data-* attribute is in the data-pretable-* namespace", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="Contract grid"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    const ALLOWED = new Set(["data-testid"]);
    const offenders = new Set<string>();
    for (const el of container.querySelectorAll("*")) {
      for (const attr of el.getAttributeNames()) {
        if (
          attr.startsWith("data-") &&
          !attr.startsWith("data-pretable-") &&
          !ALLOWED.has(attr)
        ) {
          offenders.add(attr);
        }
      }
    }
    expect([...offenders].sort()).toEqual([]);
  });

  test("header cells expose data-pretable-column-id", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="Header id grid"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    const amountHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="amount"]',
    );
    expect(amountHeader).not.toBeNull();
  });

  test("a left-pinned column's header carries data-pretable-pinned=left", () => {
    const { container } = render(
      <PretableSurface
        ariaLabel="Pinned grid"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />,
    );
    const nameHeader = container.querySelector(
      '[data-pretable-header-cell][data-pretable-column-id="name"]',
    );
    expect(nameHeader?.getAttribute("data-pretable-pinned")).toBe("left");
  });
});
```

> If `PretableSurface`'s prop names differ from `ariaLabel`/`columns`/`rows`/`getRowId`, mirror the props used by the existing `packages/react/src/__tests__/pretable-surface.test.tsx` render (read it first); the assertions are what matter.

- [ ] **Step 2: Run the guard test to verify it fails**

Run: `pnpm --filter @pretable/react exec vitest run src/__tests__/attribute-contract.test.tsx`
Expected: FAIL — the namespace test reports offenders like `data-column-id`, `data-row-id`, `data-selected`, `data-focused`, `data-pinned`, `data-row-index`, `data-row-height`, `data-row-select-cell`; and the header-column-id test fails (header has no `data-pretable-column-id` yet).

- [ ] **Step 3: Rename emitted attrs across `packages/react/src` (source + tests)**

Apply the rename map (top of plan) to every `.tsx`/`.ts` under `packages/react/src`. These exact strings appear only as DOM attribute names and test query strings, so a literal replace is safe. From the repo root:

```bash
cd packages/react/src
for pair in \
  "data-column-id:data-pretable-column-id" \
  "data-row-id:data-pretable-row-id" \
  "data-row-index:data-pretable-row-index" \
  "data-row-height:data-pretable-row-height" \
  "data-selected:data-pretable-selected" \
  "data-focused:data-pretable-focused" \
  "data-pinned:data-pretable-pinned" \
  "data-row-select-cell:data-pretable-row-select-cell"; do
  old="${pair%%:*}"; new="${pair##*:}"
  grep -rl --include='*.ts' --include='*.tsx' "$old" . \
    | xargs sed -i '' "s/$old/$new/g"
done
cd -
```

(`sed -i ''` is the macOS/BSD form; on Linux use `sed -i`.) Then sanity-check no old names remain: `grep -rn 'data-column-id\|data-row-id\|data-row-index\|data-row-height\|data-selected\|data-focused\|data-pinned\|data-row-select-cell' packages/react/src` should print nothing.

- [ ] **Step 4: Add the header `data-pretable-column-id` (the one new emission)**

In `packages/react/src/pretable-surface.tsx`, the non-row-select header cell is the `<button … data-pretable-header-cell="" …>` (~line 1180 after the rename). Add `data-pretable-column-id={column.id}` to its attributes, next to `data-pretable-header-cell=""`:

```tsx
              data-pretable-header-cell=""
              data-pretable-column-id={column.id}
              data-pretable-pinned={
                plannedCol.pinned === "left" ? "left" : undefined
              }
```

(The `data-pretable-pinned` line is the renamed existing one — shown for placement. Leave the row-select header branch, which already uses `data-pretable-row-select-header`, as is.)

- [ ] **Step 5: Run the full `@pretable/react` suite + typecheck**

Run: `pnpm --filter @pretable/react exec vitest run`
Expected: PASS — the guard test now passes (all data-_ are `data-pretable-_`; header has `data-pretable-column-id`; left-pin header is `"left"`), and the renamed existing tests pass.

Run: `pnpm --filter @pretable/react typecheck`
Expected: PASS (no type errors from the rename).

Run: `pnpm exec prettier --write 'packages/react/src/**/*.{ts,tsx}'`
Expected: formatted.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src
git commit -m "feat(react): unify styling attrs under data-pretable-*, add header column-id

Renames data-column-id/-row-id/-row-index/-row-height/-selected/-focused/-pinned/
-row-select-cell to the data-pretable-* namespace, and adds data-pretable-column-id
to header cells (target a column's header via CSS). Adds an attribute-contract
test that fails if any unprefixed styling data-* leaks. data-pretable-pinned stays
left-only (right-pin unsupported)."
```

---

### Task 2: Rename attrs in `grid.css` + delete the dead right-pin rule

**Files:**

- Modify: `packages/ui/src/grid.css` (lines ~91-92, 99, 105, 120, 142)

- [ ] **Step 1: Apply the renames + remove the dead right rule**

Edit `packages/ui/src/grid.css` (keep the `@layer pretable { … }` wrapper and every `:where(…)` intact — only the attribute names inside change, and one selector line is deleted):

1. The pinned rule — change the selector group to a single left-only `:where`, dropping the `right` line:

```css
/* Pinned cells (sticky left) — reuse header background */
:where([data-pretable-cell][data-pretable-pinned="left"]) {
  background: var(--pretable-bg-header);
  z-index: 1;
}
```

(Replaces the previous two-line `:where([data-pretable-cell][data-pinned="left"], [data-pretable-cell][data-pinned="right"])` group.)

2. Selection: `:where([data-pretable-cell][data-selected="true"])` → `:where([data-pretable-cell][data-pretable-selected="true"])`
3. Focus: `:where([data-pretable-cell][data-focused="true"])` → `:where([data-pretable-cell][data-pretable-focused="true"])`
4. Role-based focus: `:where([role="gridcell"][data-focused="true"])` → `:where([role="gridcell"][data-pretable-focused="true"])`
5. Row-select cell: `:where([data-pretable-cell][data-row-select-cell="true"], …)` → `:where([data-pretable-cell][data-pretable-row-select-cell="true"], …)` (the second selector in that group, `[data-pretable-header-cell][data-pretable-row-select-header]`, is already correct — leave it).

Verify nothing stale remains: `grep -n 'data-selected\|data-focused\|data-pinned\|data-row-select-cell\|data-column-id\|data-row-id' packages/ui/src/grid.css` should print nothing.

- [ ] **Step 2: Verify the ui suite (cascade + token contract still green) + format**

Run: `pnpm --filter @pretable/ui exec vitest run`
Expected: PASS — `css-cascade.test.ts` still passes (the `@layer`/`:where()` structure is unchanged), and `contract.test.ts`/`density.test.ts`/`build-config.test.ts` are unaffected.

Run: `pnpm exec prettier --write packages/ui/src/grid.css`
Expected: formatted.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/grid.css
git commit -m "feat(ui): rename grid.css attrs to data-pretable-*, drop dead right-pin rule

Matches the data-pretable-* attribute contract from the react change. Removes the
[data-pinned=\"right\"] rule — right-pinning is unsupported, so it could never
match. @layer pretable + :where() wrapping unchanged."
```

---

### Task 3: Update the bench _pretable_ profile (not comparators)

**Files:**

- Modify: `apps/bench/src/bench-runtime.ts` (the `pretable:` profile, ~lines 157-158)
- Modify: `apps/bench/src/__tests__/bench-runtime.test.ts` (pretable-profile references only)

- [ ] **Step 1: Update the pretable profile's attribute config**

In `apps/bench/src/bench-runtime.ts`, find the `pretable:` profile object (its `viewportSelector` is `"[data-pretable-scroll-viewport]"`). Change ONLY its two attribute fields:

```ts
  pretable: {
    viewportSelector: "[data-pretable-scroll-viewport]",
    rowSelector: "[data-pretable-row]",
    cellSelector: "[data-pretable-cell]",
    rowIdAttribute: "data-pretable-row-id",
    rowIndexAttribute: "data-pretable-row-index",
    maxSettleFrames: 3,
    // …unchanged…
  },
```

**Do NOT change** the `tanstack:`, `ag-grid:`, or `mui:` profiles — they read `data-row-id`/`data-row-index` from their own comparator adapters, which are unchanged.

- [ ] **Step 2: Update the bench-runtime test's pretable-profile references**

In `apps/bench/src/__tests__/bench-runtime.test.ts`, update only the assertions/fixtures that exercise the **pretable** profile to use `data-pretable-row-id`/`data-pretable-row-index`. Leave comparator-profile fixtures (tanstack/ag-grid/mui) on `data-row-id`/`data-row-index`. Read the file first; the pretable cases are identifiable by the `data-pretable-*` viewport/row/cell selectors around them.

- [ ] **Step 3: Verify bench unit tests + typecheck**

Run: `pnpm --filter @pretable/app-bench exec vitest run src/__tests__/bench-runtime.test.ts`
Expected: PASS.

Run: `pnpm --filter @pretable/app-bench typecheck`
Expected: PASS.

- [ ] **Step 4: Integration verification — the cross-package coupling (merge gate)**

Run: `pnpm bench:matrix --adapters=pretable --scenarios=S2 --scripts=sort,filter-text --scale=hypothesis --repeats=1`
Expected: completes successfully and writes summaries to `status/` (the harness reads pretable rows via the renamed `data-pretable-row-id`/`-row-index`; if the profile weren't updated, the pretable interaction runs would fail to find rows / report status `partial`). Confirm the two summary files have `status: "completed"`:
`python3 -c "import json,glob; [print(f, json.load(open(f)).get('status')) for f in glob.glob('status/chromium-pretable-default-s2-hypothesis-{sort,filter-text}-*.summary.json')]"` → both `completed`.

- [ ] **Step 5: Commit**

```bash
git add apps/bench/src/bench-runtime.ts apps/bench/src/__tests__/bench-runtime.test.ts
git commit -m "chore(bench): read pretable rows via data-pretable-row-id/-index

The pretable profile now reads the renamed attributes; comparator profiles keep
their own data-row-id/-index. Verified with a pretable sort/filter matrix run."
```

---

### Task 4: Update docs to the new names + document the contract

**Files:**

- Modify: `apps/website/content/docs/grid/custom-rendering.mdx`, `index.mdx`, `pretable-component.mdx`, `api-reference.mdx`
- Modify: `apps/website/content/docs/theming/cascade-and-overrides.mdx`

- [ ] **Step 1: Replace old attribute names in the docs**

In the five files above, replace any shown old attribute name with its `data-pretable-*` equivalent (rename map at the top of this plan). Read each file's matches first (`grep -n 'data-column-id\|data-row-id\|data-row-index\|data-selected\|data-focused\|data-pinned\|data-row-select-cell' apps/website/content/docs/grid/*.mdx apps/website/content/docs/theming/cascade-and-overrides.mdx`) and update them in prose/code samples. Do not introduce `data-pinned="right"` anywhere.

- [ ] **Step 2: Document the targeting contract in `cascade-and-overrides.mdx`**

Add a section to `apps/website/content/docs/theming/cascade-and-overrides.mdx` (after the "Worked examples" section):

```mdx
## Targeting attributes

Pretable emits a stable set of `data-pretable-*` attributes you can target with CSS:

| Element                                   | Attributes                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Row `[data-pretable-row]`                 | `data-pretable-row-id`, `data-pretable-row-index`, `data-pretable-selected`, `data-pretable-focused`                              |
| Body cell `[data-pretable-cell]`          | `data-pretable-column-id`, `data-pretable-selected`, `data-pretable-focused`, `data-pretable-pinned="left"`, `data-pretable-wrap` |
| Header cell `[data-pretable-header-cell]` | `data-pretable-column-id`, `data-pretable-pinned="left"`                                                                          |

For example, style one column (header and body) and the selected cells in another:

\`\`\`css
[data-pretable-column-id="revenue"] {
font-variant-numeric: tabular-nums;
}
[data-pretable-cell][data-pretable-selected="true"] {
background: #1d4ed8;
color: white;
}
\`\`\`

These names are stable; `aria-*` and `role` are also targetable but follow ARIA semantics, not Pretable's namespace.
```

(Replace the outer `\`\`\`` fences with real backticks when writing the file.)

- [ ] **Step 3: Format + run the website docs-validation tests**

Run: `pnpm exec prettier --write 'apps/website/content/docs/**/*.mdx'`
Expected: formatted.

Run: `pnpm --filter @pretable/app-website exec vitest run lib/docs app/llms.txt`
Expected: PASS (docs loader/enumerate/search-index/llms tests still pass with the edited content).

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/docs
git commit -m "docs(theming): document the data-pretable-* targeting contract

Updates grid/theming docs to the renamed attributes and adds a targeting-attribute
table + examples to the cascade & overrides page."
```

---

## Final verification (after all tasks)

- [ ] `pnpm --filter @pretable/react exec vitest run` → pass (incl. attribute-contract guard).
- [ ] `pnpm --filter @pretable/ui exec vitest run` → pass (css-cascade + contract).
- [ ] `pnpm --filter @pretable/app-bench exec vitest run src/__tests__/bench-runtime.test.ts` → pass.
- [ ] `pnpm bench:matrix --adapters=pretable --scenarios=S2 --scripts=sort,filter-text --scale=hypothesis --repeats=1` → both summaries `completed`.
- [ ] `grep -rn 'data-column-id\|data-row-id\|data-row-index\|data-row-height\|data-selected\|data-focused\|data-pinned\|data-row-select-cell' packages/react/src packages/ui/src apps/website/content/docs` → only matches inside `data-pretable-*` (i.e., no truly-unprefixed remnants). Comparator files under `apps/bench/src/{tanstack,ag-grid,mui}-adapter.tsx` legitimately retain `data-row-id` — out of scope.
- [ ] Open a PR; let CI (test/typecheck/lint/format/build/packaging/api-report) gate the merge.

## Out of scope (do NOT implement here)

Brand/semantic token-alias layer; dark mode for Excel; unstyled/headless variant (headless docs shipped in #168); implementing right-pinning.
