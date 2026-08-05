# Typed Cell Editors — Sub-project 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the column type system (`filterType`→`type`, gains `boolean`), add boolean filtering + the instant boolean toggle cell, turn `CellEditor` into a type dispatcher, and ship the number + multi-line editors.

**Architecture:** One mechanical rename commit first (repo never holds mixed vocabulary on a compiling commit). Boolean filters ride the existing enum machinery via implicit True/False options (`String(cell)` coercion already matches). A pure `parseDraftForType` module gives the controller a built-in type-validation slot before `column.validate`; typed editors share field chrome via a `useEditorField` hook under a new `editors/` directory. Boolean cells render a checkbox control that toggles via the existing controller `begin`+`commit` (no lifecycle changes).

**Tech Stack:** TypeScript, React 19, vitest + @testing-library/react (jsdom), api-extractor, vanilla CSS (`@layer pretable`, `:where()`, `--pretable-*` tokens).

**Spec:** `docs/superpowers/specs/2026-08-05-typed-cell-editors-design.md` (§1–4.3, §4.6; combobox/calendar are sub-projects 2/3)

**Branch:** create `typed-editors-1` off latest `origin/main`.

---

## Verified ground truth (don't re-derive)

- `packages/grid-core/src/types.ts:62` `FilterType`, `:102` `FilterOption`, `:120-121` `filterType`/`filterOptions` on `PretableColumn`.
- `packages/grid-core/src/evaluate-filter.ts:42` `evaluateFilter(cell, filterType, operator, value)`; enum branch does `String(cell)` + `isAnyOf`/`isNoneOf`; `isEmpty`/`isNotEmpty` handled before the type switch.
- `packages/grid-core/src/derived-rows.ts:77` passes `column.filterType ?? "text"`.
- `packages/react/src/filter-menu/filter-operators.ts`: `ENUM_OPS = ["isAnyOf","isNoneOf"]`, `SHARED_OPS = ["isEmpty","isNotEmpty"]`, `operatorsForType` keys by string ternary; `defaultDraft`/`isComplete` are shape-driven (no per-type change needed for boolean).
- `packages/react/src/pretable-surface.tsx` ~line 2002: menu options resolved inline as `col.filterOptions ?? grid.distinctColumnValues(id).map(v=>({value:v}))`; `filterType={col.filterType ?? "text"}` passed to `<FilterMenu>`.
- Begin-edit keydown triggers: `pretable-surface.tsx` ~1048–1081 (`Enter`/`F2`/type-to-replace, gated on focused editable column). Editor render branch ~1760+ (`cellEdit` local). Funnel render ~1609.
- `packages/react/src/cell-editor.tsx` is the v1-polish single-file editor (input + chrome). `PretableEditorInput` = `{column, status, error?, draft, setDraft, commit(direction?), cancel}` + row/rowId/columnId/value.
- `useCellEditController.commit()` currently: `const value = input.column.parseEditValue ? input.column.parseEditValue(String(draft ?? ""), input) : draft;` then optional `validate` → `markEditSaving` → `onCellEdit`.
- Checkbox skin: `packages/ui/src/grid.css:150-179` styles `button[data-pretable-row-select]` (+`-all`) with `--pretable-checkbox-*` tokens and `aria-checked` selectors.
- **`apps/bench/src/ag-grid-adapter.tsx` uses `filterType` as AG Grid's OWN filter-model API — EXCLUDE it from the rename sweep.**

---

## File structure

Rename sweep (Task 1) touches: `packages/grid-core/src/{types,evaluate-filter,derived-rows,index}.ts`, `packages/core/src/{types,public_api}.ts`, `packages/react/src/{public_api.ts,pretable-surface.tsx}`, `packages/react/src/filter-menu/{filter-operators.ts,FilterMenu.tsx}`, `apps/website/app/components/heroGrid/positionColumns.tsx`, `apps/website/content/docs/headless/api-reference.mdx`, `apps/website/content/docs/grid/filtering.mdx` (new in #195 — the filtering docs page documents `filterType`/`filterOptions` and must adopt the new names), plus all `__tests__` referencing the old names. Regenerate `core.api.md` + `react.api.md`.

Create:

- `packages/react/src/editors/type-parsing.ts` (+ test) — pure per-type draft parsing.
- `packages/react/src/editors/use-editor-field.ts` — shared field chrome hook.
- `packages/react/src/editors/TextCellEditor.tsx` — extracted current input.
- `packages/react/src/editors/NumberCellEditor.tsx` (+ tests).
- `packages/react/src/editors/MultilineCellEditor.tsx` (+ tests).
- `packages/react/src/editors/BooleanCellControl.tsx` (+ tests).
- `packages/react/src/editors/index.ts` — internal barrel.

Modify:

- `packages/grid-core/src/{types,evaluate-filter}.ts` — `"boolean"` in `ColumnType`, boolean → enum evaluation; `step?: number` on the column.
- `packages/react/src/filter-menu/filter-operators.ts` — boolean ops mapping + `resolveColumnOptions`.
- `packages/react/src/pretable-surface.tsx` — menu options via `resolveColumnOptions`; boolean cell render + keydown special-case.
- `packages/react/src/use-cell-edit-controller.ts` — built-in parse slot.
- `packages/react/src/cell-editor.tsx` — becomes the dispatcher.
- `packages/ui/src/grid.css` — textarea/stepper rules; boolean control added to checkbox selectors.
- `apps/website/content/docs/grid/editing.mdx` — typed editors docs.

---

## Task 1: Rename sweep — `type`/`options`/`ColumnType`/`ColumnOption` (one commit)

**Files:** all sweep files listed above; NOT `ag-grid-adapter.tsx`.

- [ ] **Step 1: Rename in grid-core `types.ts`** — line 62 `export type FilterType` → `export type ColumnType` (same union for now); line 102 `export interface FilterOption` → `export interface ColumnOption` (same shape); on `PretableColumn`: `filterType?: FilterType` → `type?: ColumnType` and `filterOptions?: FilterOption[]` → `options?: ColumnOption[]`. Update every in-file reference (`ColumnFilter`, `PretableEngine`, etc. keep their names — only the four identifiers rename).

- [ ] **Step 2: Sweep the rest mechanically** — for each remaining sweep file, replace identifier usages: `FilterType`→`ColumnType`, `FilterOption`→`ColumnOption`, `.filterType`→`.type`, `filterType:`→`type:` (object keys/props), `.filterOptions`→`.options`, `filterOptions:`→`options:`. Includes: grid-core `evaluate-filter.ts` (param name `filterType` → `type`), `derived-rows.ts:77` (`column.type ?? "text"`), `index.ts` re-export list; core `types.ts` + `public_api.ts` re-exports; react `public_api.ts`, `FilterMenu.tsx` (prop `filterType` → `type`), `filter-operators.ts`, `pretable-surface.tsx` (`col.type ?? "text"`, `col.options`, menu prop); website `heroGrid/positionColumns.tsx`; docs `headless/api-reference.mdx` prose/tables. Sweep test files by grep: `grep -rln "filterType\|filterOptions\|FilterType\|FilterOption" packages apps --include="*.ts*" | grep -v node_modules | grep -v ag-grid-adapter` must come back empty when done.

- [ ] **Step 3: Typecheck + full workspace tests**

Run: `pnpm typecheck && pnpm -r --filter './packages/*' test`
Expected: PASS — behavior-neutral rename; every existing filter/editing test green.

- [ ] **Step 4: Regenerate API reports** (required gate)

Run: `pnpm --filter @pretable/core build && pnpm --filter @pretable/core api && pnpm --filter @pretable/react build && pnpm --filter @pretable/react api && pnpm api:check`
Expected: reports show `type`/`options`/`ColumnType`/`ColumnOption`; `api:check` exits 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(core,react)!: promote filterType/filterOptions to column type/options"
```

---

## Task 2: Boolean column type — engine + menu mapping + implicit options (TDD)

**Files:**

- Modify: `packages/grid-core/src/types.ts`, `packages/grid-core/src/evaluate-filter.ts`
- Modify: `packages/react/src/filter-menu/filter-operators.ts`, `packages/react/src/pretable-surface.tsx`
- Test: `packages/grid-core/src/__tests__/evaluate-filter-boolean.test.ts` (create), extend `packages/react/src/__tests__/` filter-operators test file (locate by `ls packages/react/src/__tests__ | grep -i filter`; create `filter-operators-boolean.test.ts` if none fits)

- [ ] **Step 1: Failing engine test** — create `packages/grid-core/src/__tests__/evaluate-filter-boolean.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { evaluateFilter } from "../evaluate-filter";

describe("boolean filtering (enum semantics)", () => {
  it("matches boolean cells against string option values via isAnyOf", () => {
    expect(evaluateFilter(true, "boolean", "isAnyOf", ["true"])).toBe(true);
    expect(evaluateFilter(false, "boolean", "isAnyOf", ["true"])).toBe(false);
    expect(evaluateFilter(false, "boolean", "isNoneOf", ["true"])).toBe(true);
  });

  it("treats an empty selection as no constraint", () => {
    expect(evaluateFilter(true, "boolean", "isAnyOf", [])).toBe(true);
  });

  it("supports isEmpty/isNotEmpty", () => {
    expect(evaluateFilter(null, "boolean", "isEmpty", undefined)).toBe(true);
    expect(evaluateFilter(false, "boolean", "isNotEmpty", undefined)).toBe(
      true,
    );
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @pretable-internal/grid-core test -- evaluate-filter-boolean`
Expected: FAIL (type error / falls to text branch — `"boolean"` not in `ColumnType`, no case).

- [ ] **Step 3: Implement** — in `types.ts`: `export type ColumnType = "text" | "number" | "date" | "enum" | "boolean";` and add to `PretableColumn` (after `sortable?`): `step?: number;` (used by the number editor; document inline: `/** Number-editor increment for ArrowUp/Down and steppers. Default 1. */`). In `evaluate-filter.ts`, route boolean through the enum branch by adding a fallthrough case label:

```ts
    case "boolean":
    case "enum": {
      const c = String(cell);
      // ...existing enum body unchanged
```

- [ ] **Step 4: Menu-side mapping + implicit options** — in `filter-operators.ts`: `operatorsForType` gains boolean → enum ops (extend the ternary: `type === "enum" || type === "boolean" ? ENUM_OPS : ...`). Add at the bottom:

```ts
const BOOLEAN_OPTIONS: ColumnOption[] = [
  { value: "true", label: "True" },
  { value: "false", label: "False" },
];

/**
 * The option set a column's enum-style UI should offer. Boolean columns get
 * implicit True/False; enum columns use their declared options, falling back
 * to the caller-supplied distinct values.
 */
export function resolveColumnOptions(
  column: { type?: ColumnType; options?: ColumnOption[] },
  distinctValues: () => string[],
): ColumnOption[] {
  if (column.type === "boolean") return BOOLEAN_OPTIONS;
  return column.options ?? distinctValues().map((value) => ({ value }));
}
```

(Import `ColumnOption`/`ColumnType` types from `@pretable/core`.) In `pretable-surface.tsx` ~line 2002, replace the inline resolution with:

```ts
const options = resolveColumnOptions(col, () =>
  grid.distinctColumnValues(filterOpenState.columnId),
);
```

- [ ] **Step 5: Failing menu test** — add (new file `packages/react/src/__tests__/filter-operators-boolean.test.ts` unless an existing filter-operators test file fits):

```ts
import { describe, expect, it } from "vitest";

import {
  operatorsForType,
  resolveColumnOptions,
} from "../filter-menu/filter-operators";

describe("boolean menu mapping", () => {
  it("boolean columns get enum operators", () => {
    expect(operatorsForType("boolean")).toEqual([
      "isAnyOf",
      "isNoneOf",
      "isEmpty",
      "isNotEmpty",
    ]);
  });

  it("boolean columns get implicit True/False options", () => {
    expect(resolveColumnOptions({ type: "boolean" }, () => ["x"])).toEqual([
      { value: "true", label: "True" },
      { value: "false", label: "False" },
    ]);
  });

  it("enum columns prefer declared options, else distinct values", () => {
    expect(
      resolveColumnOptions({ type: "enum", options: [{ value: "a" }] }, () => [
        "b",
      ]),
    ).toEqual([{ value: "a" }]);
    expect(resolveColumnOptions({ type: "enum" }, () => ["b"])).toEqual([
      { value: "b" },
    ]);
  });
});
```

- [ ] **Step 6: Run both suites, verify pass; run full grid-core + react tests**

Run: `pnpm --filter @pretable-internal/grid-core test && pnpm --filter @pretable/react test`
Expected: PASS, no regressions.

- [ ] **Step 7: Regenerate core api (ColumnType union + step changed)**

Run: `pnpm --filter @pretable/core build && pnpm --filter @pretable/core api && pnpm --filter @pretable/core api:check`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(core,react): boolean column type — enum-semantics filtering with implicit True/False options"
```

---

## Task 3: `parseDraftForType` + controller built-in validation slot (TDD)

**Files:**

- Create: `packages/react/src/editors/type-parsing.ts`
- Test: `packages/react/src/__tests__/type-parsing.test.ts` (create)
- Modify: `packages/react/src/use-cell-edit-controller.ts`
- Test: extend `packages/react/src/__tests__/use-cell-edit-controller.test.ts`

- [ ] **Step 1: Failing parse-module test** — `type-parsing.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseDraftForType } from "../editors/type-parsing";

describe("parseDraftForType", () => {
  it("passes text drafts through unchanged", () => {
    expect(parseDraftForType({ type: "text" }, "hi")).toEqual({
      ok: true,
      value: "hi",
    });
  });

  it("parses numeric strings for number columns", () => {
    expect(parseDraftForType({ type: "number" }, "42.5")).toEqual({
      ok: true,
      value: 42.5,
    });
  });

  it("rejects non-numeric drafts for number columns", () => {
    expect(parseDraftForType({ type: "number" }, "abc")).toEqual({
      ok: false,
      message: "Not a number",
    });
  });

  it("commits null for an empty number draft", () => {
    expect(parseDraftForType({ type: "number" }, "")).toEqual({
      ok: true,
      value: null,
    });
    expect(parseDraftForType({ type: "number" }, "   ")).toEqual({
      ok: true,
      value: null,
    });
  });

  it("passes boolean drafts through unchanged", () => {
    expect(parseDraftForType({ type: "boolean" }, true)).toEqual({
      ok: true,
      value: true,
    });
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`Cannot find module`)

Run: `pnpm --filter @pretable/react test -- type-parsing`

- [ ] **Step 3: Implement** — `packages/react/src/editors/type-parsing.ts`:

```ts
import type { ColumnType } from "@pretable/core";

export type DraftParseResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/**
 * Built-in per-type draft parsing, run at commit before the column's
 * `validate`. `parseEditValue` on the column overrides this entirely.
 * Enum strictness and date validity join here in sub-projects 2/3.
 */
export function parseDraftForType(
  column: { type?: ColumnType },
  draft: unknown,
): DraftParseResult {
  switch (column.type) {
    case "number": {
      if (typeof draft === "number") return { ok: true, value: draft };
      const raw = String(draft ?? "").trim();
      if (raw === "") return { ok: true, value: null };
      const n = Number(raw);
      if (Number.isNaN(n)) return { ok: false, message: "Not a number" };
      return { ok: true, value: n };
    }
    default:
      return { ok: true, value: draft };
  }
}
```

- [ ] **Step 4: Wire into the controller commit path** — in `use-cell-edit-controller.ts`, the commit currently computes:

```ts
const value = input.column.parseEditValue
  ? input.column.parseEditValue(String(draft ?? ""), input)
  : draft;
```

Replace with (import `parseDraftForType` from `./editors/type-parsing`):

```ts
let value: unknown;
if (input.column.parseEditValue) {
  value = input.column.parseEditValue(String(draft ?? ""), input);
} else {
  const parsed = parseDraftForType(input.column, draft);
  if (!parsed.ok) {
    grid.markEditInvalid(parsed.message);
    return;
  }
  value = parsed.value;
}
```

(Synchronous — runs before `markEditValidating`; token untouched.)

- [ ] **Step 5: Failing controller tests** — append to `use-cell-edit-controller.test.ts` (reuse the file's `setup` helper; give the column `type: "number"`):

```ts
it("rejects a non-numeric draft for a number column via built-in parsing", async () => {
  const onCellEdit = vi.fn();
  const { grid, controller } = setup({ type: "number" }, onCellEdit);
  await controller.begin({ rowId: "r1", columnId: "name" });
  grid.setEditDraft("abc");
  await controller.commit("down");
  expect(grid.getSnapshot().editing).toMatchObject({
    status: "editing",
    error: "Not a number",
  });
  expect(onCellEdit).not.toHaveBeenCalled();
});

it("commits a parsed number (and null for empty) for number columns", async () => {
  const onCellEdit = vi.fn().mockResolvedValue(undefined);
  const { grid, controller } = setup({ type: "number" }, onCellEdit);
  await controller.begin({ rowId: "r1", columnId: "name" });
  grid.setEditDraft("42.5");
  await controller.commit("down");
  expect(onCellEdit).toHaveBeenCalledWith(
    expect.objectContaining({ value: 42.5 }),
  );
});
```

- [ ] **Step 6: Run, verify pass; full react suite green**

Run: `pnpm --filter @pretable/react test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(react): built-in per-type draft parsing in the commit path"
```

---

## Task 4: Dispatcher split — `editors/` + `useEditorField` + `TextCellEditor`

Pure refactor: behavior identical, existing tests stay green (that IS the test).

**Files:**

- Create: `packages/react/src/editors/use-editor-field.ts`, `packages/react/src/editors/TextCellEditor.tsx`, `packages/react/src/editors/index.ts`
- Modify: `packages/react/src/cell-editor.tsx`

- [ ] **Step 1: Shared chrome hook** — `use-editor-field.ts`:

```ts
import { useEffect, useRef } from "react";

import type { PretableEditorInput } from "../types";

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  "checking",
  "validating",
  "saving",
]);

/**
 * Shared field chrome for typed cell editors: autofocus+select, ARIA
 * (label/invalid/errormessage/busy), readOnly-while-pending, blur-commit
 * guarded to the editing phase, and Enter/Tab/Escape commit keys.
 */
export function useEditorField<
  E extends HTMLInputElement | HTMLTextAreaElement,
>(input: PretableEditorInput) {
  const ref = useRef<E>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const pending = PENDING_STATUSES.has(input.status);
  const errorId = `pretable-edit-error-${input.rowId}-${input.columnId}`;

  return {
    ref,
    pending,
    errorId,
    fieldProps: {
      "aria-label": input.column.header ?? input.columnId,
      "aria-invalid": input.error ? true : undefined,
      "aria-errormessage": input.error ? errorId : undefined,
      "aria-busy": pending ? true : undefined,
      readOnly: pending,
      onBlur: () => {
        // Commit in place (no direction). Guarded to the editing phase so a
        // blur during an in-flight validate/save can't double-submit.
        if (input.status === "editing") input.commit();
      },
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          input.commit("down");
        } else if (e.key === "Tab") {
          e.preventDefault();
          e.stopPropagation();
          input.commit("right");
        } else if (e.key === "Escape" || e.key === "Esc") {
          e.preventDefault();
          e.stopPropagation();
          input.cancel();
        }
      },
    },
  };
}
```

- [ ] **Step 2: Extract `TextCellEditor.tsx`** (the current input, minus chrome):

```tsx
import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

export function TextCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, fieldProps } = useEditorField<HTMLInputElement>(input);
  return (
    <input
      ref={ref}
      className="pretable-cell-editor"
      value={String(input.draft ?? "")}
      onChange={(e) => input.setDraft(e.target.value)}
      {...fieldProps}
    />
  );
}
```

- [ ] **Step 3: Rewrite `cell-editor.tsx` as the dispatcher** (error element stays here, once, for all editors):

```tsx
import type { PretableEditorInput } from "./types";
import { TextCellEditor } from "./editors/TextCellEditor";

export interface CellEditorProps {
  input: PretableEditorInput;
}

function editorFor(input: PretableEditorInput) {
  // Boolean columns never reach this popover path (the cell control commits
  // directly); enum/date fall back to text until sub-projects 2/3 land.
  return <TextCellEditor input={input} />;
}

/**
 * Dispatches the active edit to the column's editor: `renderEditor` wins,
 * else the built-in editor for `column.type`. Renders the shared error
 * element for every built-in editor.
 */
export function CellEditor({ input }: CellEditorProps) {
  if (input.column.renderEditor) {
    return <>{input.column.renderEditor(input)}</>;
  }
  const errorId = `pretable-edit-error-${input.rowId}-${input.columnId}`;
  return (
    <>
      {editorFor(input)}
      {input.error ? (
        <div id={errorId} data-pretable-edit-error role="alert">
          {input.error}
        </div>
      ) : null}
    </>
  );
}
```

Also create `editors/index.ts` re-exporting `TextCellEditor`, `useEditorField`, `parseDraftForType` (internal barrel; NOT added to `public_api.ts`).

- [ ] **Step 4: Full react suite — the refactor gate**

Run: `pnpm --filter @pretable/react test && pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react lint`
Expected: ALL existing cell-editor/surface-editing tests pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(react): CellEditor dispatcher + shared editor-field chrome under editors/"
```

---

## Task 5: NumberCellEditor (TDD) + skin

**Files:**

- Create: `packages/react/src/editors/NumberCellEditor.tsx`
- Test: `packages/react/src/__tests__/number-cell-editor.test.tsx` (create)
- Modify: `packages/react/src/cell-editor.tsx` (dispatch), `packages/ui/src/grid.css` (+ `packages/ui/src/__tests__/css-cascade.test.ts`)

- [ ] **Step 1: Failing tests** — `number-cell-editor.test.tsx` (mirror the `makeInput` helper from `cell-editor.test.tsx`, with `column: { id: "qty", type: "number" }`):

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);

function makeInput(
  over: Partial<PretableEditorInput> = {},
): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "qty",
    row: { id: "r1", qty: 5 },
    column: { id: "qty", type: "number", header: "Qty" },
    value: 5,
    status: "editing",
    draft: "5",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as PretableEditorInput;
}

describe("NumberCellEditor (via dispatcher)", () => {
  it("dispatches number columns to a decimal input", () => {
    render(<CellEditor input={makeInput()} />);
    const box = screen.getByRole("textbox");
    expect(box).toHaveAttribute("inputmode", "decimal");
  });

  it("ArrowUp/Down step the draft by column.step ?? 1", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ setDraft })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
    expect(setDraft).toHaveBeenCalledWith("6");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
    expect(setDraft).toHaveBeenCalledWith("4");
  });

  it("honors a custom step", () => {
    const setDraft = vi.fn();
    render(
      <CellEditor
        input={makeInput({
          setDraft,
          column: { id: "qty", type: "number", step: 0.5 },
        })}
      />,
    );
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
    expect(setDraft).toHaveBeenCalledWith("5.5");
  });

  it("stepper buttons step without committing", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(setDraft).toHaveBeenCalledWith("6");
    expect(commit).not.toHaveBeenCalled();
  });

  it("still commits on Enter (shared chrome intact)", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ commit })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(commit).toHaveBeenCalledWith("down");
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/react test -- number-cell-editor` (no inputmode/steppers; dispatcher sends text editor).

- [ ] **Step 3: Implement `NumberCellEditor.tsx`:**

```tsx
import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

function stepDraft(draft: unknown, step: number, dir: 1 | -1): string {
  const n = Number(String(draft ?? "").trim());
  const base = Number.isNaN(n) ? 0 : n;
  // Round to the step's decimal places to dodge float drift (0.1+0.2).
  const decimals = (String(step).split(".")[1] ?? "").length;
  return (base + dir * step).toFixed(decimals);
}

export function NumberCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  const step = input.column.step ?? 1;
  const bump = (dir: 1 | -1) => {
    if (!pending) input.setDraft(stepDraft(input.draft, step, dir));
  };

  return (
    <span data-pretable-number-editor="">
      <input
        ref={ref}
        className="pretable-cell-editor"
        inputMode="decimal"
        value={String(input.draft ?? "")}
        onChange={(e) => input.setDraft(e.target.value)}
        {...fieldProps}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            e.stopPropagation();
            bump(e.key === "ArrowUp" ? 1 : -1);
            return;
          }
          fieldProps.onKeyDown(e);
        }}
      />
      <span data-pretable-number-steppers="">
        <button
          type="button"
          tabIndex={-1}
          aria-label="Increment"
          onClick={() => bump(1)}
        >
          ▲
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Decrement"
          onClick={() => bump(-1)}
        >
          ▼
        </button>
      </span>
    </span>
  );
}
```

Dispatcher: in `cell-editor.tsx` `editorFor`, add before the default:

```tsx
if (input.column.type === "number") return <NumberCellEditor input={input} />;
```

- [ ] **Step 4: Skin** — in `packages/ui/src/grid.css` inside `@layer pretable` (all `:where()`-wrapped): number editor container flexes input + steppers inside the cell; input right-aligned; steppers are compact token-colored buttons.

```css
:where([data-pretable-number-editor]) {
  display: flex;
  align-items: stretch;
  width: 100%;
  height: 100%;
}

:where([data-pretable-number-editor] .pretable-cell-editor) {
  text-align: right;
  flex: 1;
  min-width: 0;
}

:where([data-pretable-number-steppers]) {
  display: flex;
  flex-direction: column;
  justify-content: center;
}

:where([data-pretable-number-steppers] button) {
  border: none;
  background: var(--pretable-bg-header);
  color: var(--pretable-text-header);
  font-size: 8px;
  line-height: 1;
  padding: 2px 4px;
  cursor: pointer;
}

:where([data-pretable-number-steppers] button:hover) {
  background: var(--pretable-bg-hover);
}
```

Extend the css-cascade presence test with `expect(css).toMatch(/:where\(\[data-pretable-number-editor\]\)/);`.

- [ ] **Step 5: Run react + ui suites, verify pass**

Run: `pnpm --filter @pretable/react test && pnpm --filter @pretable/ui test`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(react,ui): number cell editor — decimal input, arrow/step buttons, right-aligned skin"
```

---

## Task 6: MultilineCellEditor for wrapped text columns (TDD) + skin

**Files:**

- Create: `packages/react/src/editors/MultilineCellEditor.tsx`
- Test: `packages/react/src/__tests__/multiline-cell-editor.test.tsx` (create)
- Modify: `packages/react/src/cell-editor.tsx` (dispatch on `type text/undefined + wrap`), `packages/ui/src/grid.css` (+ cascade test)

- [ ] **Step 1: Failing tests** (same `makeInput` shape, `column: { id: "msg", wrap: true }`):

```tsx
describe("MultilineCellEditor (via dispatcher)", () => {
  it("dispatches wrapped text columns to a textarea", () => {
    render(<CellEditor input={makeInput()} />);
    expect(screen.getByRole("textbox").tagName).toBe("TEXTAREA");
  });

  it("Enter does NOT commit (newline stays in the field)", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ commit })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("Cmd/Ctrl+Enter commits down", () => {
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ commit })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      metaKey: true,
    });
    expect(commit).toHaveBeenCalledWith("down");
    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it("Tab commits right; Escape cancels", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });
});
```

(Full file mirrors the Task 5 test-file scaffold: jest-dom import, `afterEach(cleanup)`, `makeInput` with `column: { id: "msg", wrap: true, header: "Message" }`, `draft: "line one"`.)

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/react test -- multiline-cell-editor`.

- [ ] **Step 3: Implement `MultilineCellEditor.tsx`:**

```tsx
import { useLayoutEffect } from "react";

import type { PretableEditorInput } from "../types";
import { useEditorField } from "./use-editor-field";

export function MultilineCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, fieldProps } = useEditorField<HTMLTextAreaElement>(input);

  // Auto-grow with the draft; the skin caps growth via max-height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [ref, input.draft]);

  return (
    <textarea
      ref={ref}
      className="pretable-cell-editor"
      data-pretable-multiline-editor=""
      rows={1}
      value={String(input.draft ?? "")}
      onChange={(e) => input.setDraft(e.target.value)}
      {...fieldProps}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
          // Plain Enter = newline: keep the default, stop the grid handler.
          e.stopPropagation();
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          input.commit("down");
          return;
        }
        fieldProps.onKeyDown(e);
      }}
    />
  );
}
```

Dispatcher: replace `editorFor` in `cell-editor.tsx` with the final form (multi-line applies only to text columns per spec):

```tsx
function editorFor(input: PretableEditorInput) {
  const type = input.column.type ?? "text";
  if (type === "number") return <NumberCellEditor input={input} />;
  if (type === "text" && input.column.wrap)
    return <MultilineCellEditor input={input} />;
  // enum/date fall back to text until sub-projects 2/3; boolean never reaches
  // this popover path (the cell control commits directly).
  return <TextCellEditor input={input} />;
}
```

- [ ] **Step 4: Skin** — grid.css additions (`:where()`-wrapped, in the layer):

```css
:where(textarea.pretable-cell-editor) {
  resize: none;
  overflow: auto;
  max-height: 160px;
  line-height: inherit;
}
```

Cascade test: `expect(css).toMatch(/:where\(textarea\.pretable-cell-editor\)/);`

- [ ] **Step 5: Run react + ui suites, verify pass** — `pnpm --filter @pretable/react test && pnpm --filter @pretable/ui test`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(react,ui): multi-line cell editor for wrapped text columns"
```

---

## Task 7: Boolean toggle cell (TDD) + skin

**Files:**

- Create: `packages/react/src/editors/BooleanCellControl.tsx`
- Test: `packages/react/src/__tests__/pretable-surface-boolean.test.tsx` (create — integration via `PretableSurface`)
- Modify: `packages/react/src/pretable-surface.tsx`, `packages/ui/src/grid.css` (+ cascade test)

- [ ] **Step 1: Failing integration tests** — `pretable-surface-boolean.test.tsx` (mirror the scaffold of `pretable-surface-editing.test.tsx`: jest-dom, cleanup, `flush` helper, rows with a boolean field):

```tsx
const ROWS = [
  { id: "r1", name: "Ada", active: true },
  { id: "r2", name: "Linus", active: false },
];
const COLUMNS = [
  { id: "name", header: "Name" },
  { id: "active", header: "Active", type: "boolean" as const, editable: true },
];

it("renders boolean cells as checkboxes reflecting the value", () => {
  renderGrid();
  const boxes = screen.getAllByRole("checkbox");
  expect(boxes[0]).toHaveAttribute("aria-checked", "true");
  expect(boxes[1]).toHaveAttribute("aria-checked", "false");
});

it("click toggles and commits the negated value through onCellEdit", async () => {
  const { onCellEdit } = renderGrid();
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  await flush();
  expect(onCellEdit).toHaveBeenCalledWith(
    expect.objectContaining({ rowId: "r1", columnId: "active", value: false }),
  );
});

it("does not toggle when the column is not editable", async () => {
  const { onCellEdit } = renderGrid({ editable: false });
  fireEvent.click(screen.getAllByRole("checkbox")[0]);
  await flush();
  expect(onCellEdit).not.toHaveBeenCalled();
});

it("never opens a text editor popover for boolean columns", () => {
  renderGrid();
  const cell = screen.getAllByRole("checkbox")[0].closest('[role="gridcell"]')!;
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: "Enter" });
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});
```

(`renderGrid(colOver = {})` renders `<PretableSurface ariaLabel="bools" columns={[COLUMNS[0], {...COLUMNS[1], ...colOver}]} rows={ROWS} getRowId={(r)=>r.id} viewportHeight={300} onCellEdit={onCellEdit} />`.)

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/react test -- pretable-surface-boolean` (boolean cells render as text "true"/"false").

- [ ] **Step 3: Implement `BooleanCellControl.tsx`:**

```tsx
import type { PretableEditStatus } from "@pretable/core";

export interface BooleanCellControlProps {
  checked: boolean;
  editable: boolean;
  /** Edit status when this cell holds the active edit, else null. */
  status: PretableEditStatus | null;
  label: string;
  onToggle: () => void;
}

/**
 * In-cell boolean control: toggles-and-commits directly (no editor popover).
 * Non-editable cells render the same control disabled for a consistent look.
 */
export function BooleanCellControl({
  checked,
  editable,
  status,
  label,
  onToggle,
}: BooleanCellControlProps) {
  const busy =
    status === "checking" || status === "validating" || status === "saving";
  return (
    <button
      type="button"
      role="checkbox"
      data-pretable-bool-cell=""
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={!editable || busy}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {checked ? "✓" : ""}
    </button>
  );
}
```

- [ ] **Step 4: Wire into the surface** — three additive edits in `pretable-surface.tsx` (match real locals; anchors from ground truth):

  a. **Cell content branch** (where `cellEdit`-vs-content renders, ~1760+): for `column.type === "boolean"` (and not the row-select column), render the control instead of `MemoizedCellContent` AND instead of `CellEditor` (boolean edits never popover):

```tsx
column.type === "boolean" ? (
  <BooleanCellControl
    checked={Boolean(column.value ? column.value(row) : row[column.id])}
    editable={Boolean(column.editable)}
    status={cellEdit ? cellEdit.status : null}
    label={column.header ?? column.id}
    onToggle={() => void toggleBooleanCell(id, column)}
  />
) : cellEdit ? (
  /* existing CellEditor branch */
) : (
  /* existing content branch */
)
```

b. **Toggle helper** in the component body (near the `editController` creation) — begin+commit through the existing controller so async validate/onCellEdit/staleness all apply:

```ts
const toggleBooleanCell = async (
  rowId: string,
  column: PretableColumn<TRow>,
) => {
  if (!column.editable || snapshot.editing) return;
  const row = editVisibleRowsRef.current.find((r) => r.id === rowId)?.row;
  if (!row) return;
  const current = Boolean(column.value ? column.value(row) : row[column.id]);
  await editController.begin({ rowId, columnId: column.id }, !current);
  await editController.commit();
};
```

(Note: `begin`'s async-`editable` gate still runs — a `checking` phase renders busy. If the ref holding visible rows has a different name, match it.)

c. **Keydown special-case** (in the begin-edit trigger block ~1048–1081): for a focused boolean editable column, Enter or Space toggles instead of beginning a popover edit; F2/type-to-replace do NOT apply:

```ts
if (focusedColumn?.type === "boolean" && focusedColumn.editable) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    void toggleBooleanCell(focusAddr.rowId, focusedColumn);
  }
  return; // no popover editing for editable boolean columns
}
```

(Place at the top of the begin-edit trigger block, before the Enter/F2 branch. The `focusedColumn.editable` guard keeps existing Enter/Space row-selection behavior intact for non-editable boolean columns — they fall through untouched.)

- [ ] **Step 5: Skin** — extend the existing checkbox selector groups in `grid.css` (lines ~150–179) to include `button[data-pretable-bool-cell]` alongside `button[data-pretable-row-select]` in each selector list (base, `[aria-checked="true"]`, hover). Add a centering rule:

```css
:where(button[data-pretable-bool-cell]) {
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}

:where(button[data-pretable-bool-cell][aria-busy="true"]) {
  opacity: 0.5;
  cursor: wait;
}
```

Cascade test: `expect(css).toMatch(/data-pretable-bool-cell/);`

- [ ] **Step 6: Run react + ui suites, verify pass; full workspace tests**

Run: `pnpm --filter @pretable/react test && pnpm --filter @pretable/ui test && pnpm -r --filter './packages/*' test`
Expected: PASS (existing selection/keyboard tests unaffected — boolean intercepts only editable boolean columns).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(react,ui): boolean columns — instant checkbox toggle through the edit lifecycle"
```

---

## Task 8: Docs

**Files:**

- Modify: `apps/website/content/docs/grid/editing.mdx`

- [ ] **Step 1: Update `editing.mdx`** — add a "Typed editors" section documenting (claims must match shipped behavior; keep house voice): `column.type` drives the editor (text default; `wrap: true` text → multi-line with Enter-newline / Cmd-Ctrl-Enter-commit; number → decimal input with ArrowUp/Down + steppers + `step`, NaN rejects with "Not a number", empty commits `null`; boolean → instant checkbox toggle, no popover, async states on the cell). Note enum/date currently fall back to the text editor (combobox + calendar coming), `renderEditor` overrides everything, `parseEditValue` overrides built-in parsing. Update any `filterType`/`filterOptions` references on the filtering-adjacent pages ONLY if Task 1's grep left stragglers in `content/docs` (re-grep to confirm none).

- [ ] **Step 2: Format + build**

Run: `pnpm exec prettier --write apps/website/content/docs/grid/editing.mdx && pnpm --filter @pretable/app-website build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(website): typed editors — number, multi-line, boolean; column type promotion"
```

---

## Task 9: Full verification

- [ ] **Step 1:** `pnpm -r --filter './packages/*' test` → PASS
- [ ] **Step 2:** `pnpm typecheck` → PASS
- [ ] **Step 3:** `pnpm lint` → PASS
- [ ] **Step 4:** `pnpm format` → PASS (prettier-write any flagged files and fold into Step 7)
- [ ] **Step 5:** `pnpm api:check` → exit 0 (if CI later disagrees, regenerate in a clean env: `rm -rf node_modules && pnpm install --frozen-lockfile && pnpm api`)
- [ ] **Step 6:** `pnpm --filter @pretable/app-website build` → PASS
- [ ] **Step 7:** `git add -A && git commit -m "chore: typed editors foundation — verification fixups"` (only if fixups exist)

---

## Notes for the executor

- **Task 1 is one atomic commit** — the repo must never hold mixed `filterType`/`type` vocabulary in a compiling state. Sweep by grep, not memory; the done-check is the empty grep. **Never touch `apps/bench/src/ag-grid-adapter.tsx`** (its `filterType` is AG Grid's own API).
- **Anchors in `pretable-surface.tsx` are descriptions, not gospel line numbers** (~2400-line file): match the real local names (`cellEdit`, `effectiveColumns`, `editVisibleRowsRef`, `focusedColumn`, the begin-edit trigger block). If an anchor doesn't exist as described, STOP and report rather than forcing it.
- **The worktree is shared** — before reviewing/verifying, confirm `git branch --show-current` is `typed-editors-1`.
- Env gotchas: ignore `pyenv: cannot rehash` noise; if a run fails with an esbuild error, relink `ESB=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild | head -1); rm -rf node_modules/esbuild; ln -s "${ESB#node_modules/}" node_modules/esbuild`.
- API reports are a REQUIRED CI gate (`API Extractor — report freshness`); Tasks 1, 2 regenerate them — keep them fresh in the same commit as the surface change.
- Boolean display for non-boolean cell values: `Boolean(value)` coercion is the shipped behavior (spec §4.6's `format` fallback nuance is out — YAGNI'd to coercion; the spec's cut list governs).
