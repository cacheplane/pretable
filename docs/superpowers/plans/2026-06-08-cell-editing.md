# Cell Editing (v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline cell editing to pretable with a full async edit lifecycle (per-cell editable/validate/commit, each Promise-capable) exposed through a controlled `onCellEdit` API.

**Architecture:** The edit lifecycle lives as **synchronous state transitions** in the `@pretable-internal/grid-core` engine (`snapshot.editing` with a `status` phase). The `@pretable/react` surface drives the async hooks (`editable` → `validate` → `onCellEdit`) via a new `useCellEditController`, calling the engine's sync transition methods and guarding against stale resolutions with an edit token. Data flow is controlled: commit fires `onCellEdit` and the app feeds new `rows` back down.

**Tech Stack:** TypeScript, React 19, vitest + @testing-library/react (jsdom), api-extractor.

**Spec:** `docs/superpowers/specs/2026-06-08-cell-editing-design.md`

**Branch:** `claude/cell-editing` (off latest `main`).

---

## File structure

Modify:

- `packages/grid-core/src/types.ts` — new edit types; `editing` on snapshot; edit hooks on `PretableColumn`; edit methods on `PretableEngine`.
- `packages/grid-core/src/create-grid-core.ts` — `editing` state + transition methods + include in `getSnapshot`.
- `packages/core/src/types.ts` — re-export the new types.
- `packages/core/src/pretable-grid.ts` — edit methods on the public `PretableGrid` interface.
- `packages/core/src/create-grid.ts` — forward the new engine methods.
- `packages/core/src/public_api.ts` — export new public types.
- `packages/react/src/types.ts` — React `PretableColumn` gains `renderEditor`.
- `packages/react/src/pretable-surface.tsx` — keyboard/dblclick triggers, editor render, `onCellEdit` prop.
- `packages/react/src/pretable.tsx` — surface `onCellEdit` through `PretableProps`.
- `packages/react/src/public_api.ts` — export new public React types.

Create:

- `packages/react/src/use-cell-edit-controller.ts` — async orchestrator hook.
- `packages/react/src/cell-editor.tsx` — default text editor + editor input resolution.
- `apps/website/content/docs/grid/editing.mdx` + nav entry in `apps/website/app/docs/_nav.ts`.

Regenerate (required gate): `packages/core/core.api.md`, `packages/react/react.api.md`.

---

## Task 1: Edit types + column hooks + snapshot field (grid-core)

**Files:**

- Modify: `packages/grid-core/src/types.ts`

- [ ] **Step 1: Add the edit types** after `PretableSortDirection` (around line 18):

```ts
/**
 * Phase of an in-progress cell edit.
 *
 * @public
 */
export type PretableEditStatus =
  | "checking"
  | "editing"
  | "validating"
  | "saving"
  | "error";

/**
 * Input passed to a column's edit hooks (`editable`, `validate`, `parseEditValue`,
 * `formatEditValue`).
 *
 * @public
 */
export interface PretableEditInput<TRow extends PretableRow = PretableRow> {
  rowId: string;
  columnId: string;
  row: TRow;
  column: PretableColumn<TRow>;
  value: unknown;
}

/**
 * In-progress cell edit observed via `PretableGrid.getSnapshot().editing`.
 * `error` carries the validation message (status `"editing"`) or the commit
 * failure message (status `"error"`).
 *
 * @public
 */
export interface PretableEditState {
  rowId: string;
  columnId: string;
  draft: unknown;
  status: PretableEditStatus;
  error?: string;
}
```

- [ ] **Step 2: Add the edit hooks to `PretableColumn`** — inside the interface (after `reorderable?: boolean;`, before the closing brace):

```ts
  // cell editing (v1):
  editable?:
    | boolean
    | ((input: PretableEditInput<TRow>) => boolean | Promise<boolean>);
  validate?: (
    value: unknown,
    input: PretableEditInput<TRow>,
  ) => (true | string) | Promise<true | string>;
  parseEditValue?: (raw: string, input: PretableEditInput<TRow>) => unknown;
  formatEditValue?: (value: unknown, input: PretableEditInput<TRow>) => string;
```

- [ ] **Step 3: Add `editing` to `PretableGridSnapshot`** — inside the interface, after `visibleRange: PretableRowRange;`:

```ts
editing: PretableEditState | null;
```

- [ ] **Step 4: Add the edit methods to `PretableEngine`** — inside the interface, after `mergeColumnsFromProps(...)`:

```ts
  // cell editing (v1):
  beginEdit(
    addr: PretableCellAddress,
    opts?: { draft?: unknown; status?: "checking" | "editing" },
  ): void;
  setEditDraft(value: unknown): void;
  markEditing(): void;
  markEditValidating(): void;
  markEditSaving(): void;
  markEditInvalid(message: string): void;
  markEditError(message: string): void;
  commitEditSucceeded(): void;
  cancelEdit(): void;
```

- [ ] **Step 5: Typecheck** — Run: `pnpm --filter @pretable-internal/grid-core typecheck`
      Expected: FAIL — `create-grid-core.ts` doesn't yet implement the new `PretableEngine` members / `getSnapshot` lacks `editing`. (This failure is expected; Task 2 implements them.)

- [ ] **Step 6: Commit**

```bash
git add packages/grid-core/src/types.ts
git commit -m "feat(grid-core): edit lifecycle types (PretableEditState/Status/Input) + column hooks + snapshot.editing"
```

---

## Task 2: Edit lifecycle state machine (grid-core engine)

**Files:**

- Modify: `packages/grid-core/src/create-grid-core.ts`
- Test: `packages/grid-core/src/__tests__/edit-lifecycle.test.ts` (create)

- [ ] **Step 1: Write the failing test** — create `packages/grid-core/src/__tests__/edit-lifecycle.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { createGridCore } from "../create-grid-core";

const COLUMNS = [{ id: "name" }, { id: "age" }];
const ROWS = [
  { id: "r1", name: "Ada", age: 36 },
  { id: "r2", name: "Linus", age: 54 },
];

function makeGrid() {
  return createGridCore({
    columns: COLUMNS,
    rows: ROWS,
    getRowId: (r) => r.id,
  });
}

describe("edit lifecycle", () => {
  it("starts with no edit", () => {
    expect(makeGrid().getSnapshot().editing).toBeNull();
  });

  it("beginEdit defaults to status 'editing' with the given draft", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "name" }, { draft: "Ad" });
    expect(g.getSnapshot().editing).toEqual({
      rowId: "r1",
      columnId: "name",
      draft: "Ad",
      status: "editing",
    });
  });

  it("supports the async-editable 'checking' → 'editing' path", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "name" }, { status: "checking" });
    expect(g.getSnapshot().editing?.status).toBe("checking");
    g.markEditing();
    expect(g.getSnapshot().editing?.status).toBe("editing");
  });

  it("runs validating → saving → success, clearing the edit", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "name" }, { draft: "Ada Lovelace" });
    g.setEditDraft("Ada L.");
    g.markEditValidating();
    expect(g.getSnapshot().editing?.status).toBe("validating");
    g.markEditSaving();
    expect(g.getSnapshot().editing?.status).toBe("saving");
    g.commitEditSucceeded();
    expect(g.getSnapshot().editing).toBeNull();
  });

  it("markEditInvalid returns to 'editing' with a message", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "age" });
    g.markEditValidating();
    g.markEditInvalid("must be a number");
    expect(g.getSnapshot().editing).toMatchObject({
      status: "editing",
      error: "must be a number",
    });
  });

  it("markEditError enters 'error' with a message; cancelEdit clears it", () => {
    const g = makeGrid();
    g.beginEdit({ rowId: "r1", columnId: "age" });
    g.markEditSaving();
    g.markEditError("network down");
    expect(g.getSnapshot().editing).toMatchObject({
      status: "error",
      error: "network down",
    });
    g.cancelEdit();
    expect(g.getSnapshot().editing).toBeNull();
  });

  it("transition methods no-op when there is no active edit (stale-callback safety)", () => {
    const g = makeGrid();
    g.markEditSaving();
    g.commitEditSucceeded();
    expect(g.getSnapshot().editing).toBeNull();
  });

  it("notifies subscribers on edit transitions", () => {
    const g = makeGrid();
    let calls = 0;
    g.subscribe(() => {
      calls += 1;
    });
    g.beginEdit({ rowId: "r1", columnId: "name" });
    g.setEditDraft("x");
    g.commitEditSucceeded();
    expect(calls).toBe(3);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @pretable-internal/grid-core test -- edit-lifecycle`
Expected: FAIL — `g.beginEdit is not a function`.

- [ ] **Step 3: Add the `editing` state field** — in `create-grid-core.ts`, next to the other state declarations (near `let focus`, around line 91):

```ts
let editing: PretableEditState | null = null;
```

Add `PretableEditState` (and `PretableCellAddress` if not already) to the `import type { ... } from "./types"` block at the top of the file.

- [ ] **Step 4: Implement the transition methods** — add to the returned engine object (alongside the other actions, before the closing of the returned object). Every method that changes state calls `emit()` (the existing notify+cache-invalidate helper):

```ts
    beginEdit(addr, opts) {
      editing = {
        rowId: addr.rowId,
        columnId: addr.columnId,
        draft: opts?.draft,
        status: opts?.status ?? "editing",
      };
      emit();
    },
    setEditDraft(value) {
      if (!editing) return;
      editing = { ...editing, draft: value };
      emit();
    },
    markEditing() {
      if (!editing || editing.status !== "checking") return;
      editing = { ...editing, status: "editing", error: undefined };
      emit();
    },
    markEditValidating() {
      if (!editing) return;
      editing = { ...editing, status: "validating", error: undefined };
      emit();
    },
    markEditSaving() {
      if (!editing) return;
      editing = { ...editing, status: "saving", error: undefined };
      emit();
    },
    markEditInvalid(message) {
      if (!editing) return;
      editing = { ...editing, status: "editing", error: message };
      emit();
    },
    markEditError(message) {
      if (!editing) return;
      editing = { ...editing, status: "error", error: message };
      emit();
    },
    commitEditSucceeded() {
      if (!editing) return;
      editing = null;
      emit();
    },
    cancelEdit() {
      if (!editing) return;
      editing = null;
      emit();
    },
```

- [ ] **Step 5: Include `editing` in the snapshot** — in `getSnapshot()`, add to the `cachedSnapshot = { ... }` object literal (after `visibleRange: { ... }`):

```ts
      editing: editing ? { ...editing } : null,
```

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm --filter @pretable-internal/grid-core test -- edit-lifecycle`
Expected: PASS (8 tests).

- [ ] **Step 7: Run the full grid-core suite + typecheck** (no regressions)

Run: `pnpm --filter @pretable-internal/grid-core test && pnpm --filter @pretable-internal/grid-core typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/grid-core/src/create-grid-core.ts packages/grid-core/src/__tests__/edit-lifecycle.test.ts
git commit -m "feat(grid-core): implement sync edit-lifecycle transitions + snapshot.editing"
```

---

## Task 3: Public surface (@pretable/core) + regenerate report

**Files:**

- Modify: `packages/core/src/types.ts`, `packages/core/src/pretable-grid.ts`, `packages/core/src/create-grid.ts`, `packages/core/src/public_api.ts`
- Regenerate: `packages/core/core.api.md`

- [ ] **Step 1: Re-export new types** — in `packages/core/src/types.ts`, add to the `export type { ... } from "@pretable-internal/grid-core"` list:

```ts
  PretableEditInput,
  PretableEditState,
  PretableEditStatus,
```

- [ ] **Step 2: Add edit methods to the public `PretableGrid` interface** — in `packages/core/src/pretable-grid.ts`, mirror the `PretableEngine` additions from Task 1 Step 4 (same nine signatures). Import `PretableCellAddress` if not already imported there.

```ts
  beginEdit(
    addr: PretableCellAddress,
    opts?: { draft?: unknown; status?: "checking" | "editing" },
  ): void;
  setEditDraft(value: unknown): void;
  markEditing(): void;
  markEditValidating(): void;
  markEditSaving(): void;
  markEditInvalid(message: string): void;
  markEditError(message: string): void;
  commitEditSucceeded(): void;
  cancelEdit(): void;
```

- [ ] **Step 3: Forward the methods in `createGrid`** — in `packages/core/src/create-grid.ts`, add to the returned object (alongside `applyTransaction: engine.applyTransaction,`):

```ts
    beginEdit: engine.beginEdit,
    setEditDraft: engine.setEditDraft,
    markEditing: engine.markEditing,
    markEditValidating: engine.markEditValidating,
    markEditSaving: engine.markEditSaving,
    markEditInvalid: engine.markEditInvalid,
    markEditError: engine.markEditError,
    commitEditSucceeded: engine.commitEditSucceeded,
    cancelEdit: engine.cancelEdit,
```

- [ ] **Step 4: Export public types** — in `packages/core/src/public_api.ts`, add `PretableEditInput`, `PretableEditState`, `PretableEditStatus` to the exported type list (matching the existing export style in that file).

- [ ] **Step 5: Typecheck core**

Run: `pnpm --filter @pretable/core typecheck`
Expected: PASS.

- [ ] **Step 6: Regenerate the API report** (required CI gate; clean env to match CI)

Run:

```bash
pnpm --filter @pretable/core build && pnpm --filter @pretable/core api
```

Expected: `core.api.md` updated with the new methods/types; `pnpm --filter @pretable/core api:check` then exits 0.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src packages/core/core.api.md
git commit -m "feat(core): expose edit lifecycle on PretableGrid + public edit types"
```

---

## Task 4: Async edit orchestrator (`useCellEditController`)

The controller owns the async hooks and stale-resolution guarding. It calls the engine's sync transitions. It is framework-thin (no DOM) so it unit-tests against a real `createGrid`.

**Files:**

- Create: `packages/react/src/use-cell-edit-controller.ts`
- Test: `packages/react/src/__tests__/use-cell-edit-controller.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

import { createGrid, type PretableColumn } from "@pretable/core";

import { createCellEditController } from "../use-cell-edit-controller";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}
const ROWS: Row[] = [{ id: "r1", name: "Ada" }];

function setup(
  columnOverrides: Partial<PretableColumn<Row>> = {},
  onCellEdit = vi.fn(),
) {
  const columns: PretableColumn<Row>[] = [
    { id: "name", editable: true, ...columnOverrides },
  ];
  const grid = createGrid<Row>({ columns, rows: ROWS, getRowId: (r) => r.id });
  const controller = createCellEditController({
    grid,
    getColumns: () => columns,
    getRowById: (id) => ROWS.find((r) => r.id === id) ?? null,
    onCellEdit,
  });
  return { grid, controller, onCellEdit };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("cell edit controller", () => {
  it("begins an edit immediately when editable === true", async () => {
    const { grid, controller } = setup();
    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing).toMatchObject({
      rowId: "r1",
      status: "editing",
    });
  });

  it("gates begin through 'checking' for async editable", async () => {
    let resolve!: (v: boolean) => void;
    const { grid, controller } = setup({
      editable: () => new Promise<boolean>((r) => (resolve = r)),
    });
    const p = controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing?.status).toBe("checking");
    resolve(true);
    await p;
    expect(grid.getSnapshot().editing?.status).toBe("editing");
  });

  it("does not begin when async editable resolves false", async () => {
    const { grid, controller } = setup({
      editable: () => Promise.resolve(false),
    });
    await controller.begin({ rowId: "r1", columnId: "name" });
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("validate failure returns to editing with the message", async () => {
    const { grid, controller } = setup({ validate: () => "too short" });
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("x");
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "editing",
      error: "too short",
    });
  });

  it("successful async commit calls onCellEdit then clears the edit", async () => {
    const onCellEdit = vi.fn().mockResolvedValue(undefined);
    const { grid, controller } = setup({}, onCellEdit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    grid.setEditDraft("Ada L.");
    await controller.commit("down");
    expect(onCellEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "Ada L.",
      }),
    );
    expect(grid.getSnapshot().editing).toBeNull();
  });

  it("commit rejection enters 'error'", async () => {
    const onCellEdit = vi.fn().mockRejectedValue(new Error("boom"));
    const { grid, controller } = setup({}, onCellEdit);
    await controller.begin({ rowId: "r1", columnId: "name" });
    await controller.commit("down");
    expect(grid.getSnapshot().editing).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("drops a stale async-editable resolution after cancel (staleness guard)", async () => {
    let resolve!: (v: boolean) => void;
    const { grid, controller } = setup({
      editable: () => new Promise<boolean>((r) => (resolve = r)),
    });
    const p = controller.begin({ rowId: "r1", columnId: "name" });
    controller.cancel();
    expect(grid.getSnapshot().editing).toBeNull();
    resolve(true);
    await p;
    expect(grid.getSnapshot().editing).toBeNull(); // stale true did not re-open
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @pretable/react test -- use-cell-edit-controller`
Expected: FAIL — `Cannot find module '../use-cell-edit-controller'`.

- [ ] **Step 3: Implement the controller** — create `packages/react/src/use-cell-edit-controller.ts`:

```ts
import { useMemo } from "react";

import type {
  PretableCellAddress,
  PretableColumn,
  PretableEditInput,
  PretableFocusDirection,
  PretableGrid,
  PretableRow,
} from "@pretable/core";

export interface CellEditController {
  begin(addr: PretableCellAddress, initialDraft?: unknown): Promise<void>;
  commit(moveDirection?: PretableFocusDirection): Promise<void>;
  cancel(): void;
}

export interface CellEditControllerOptions<TRow extends PretableRow> {
  grid: PretableGrid<TRow>;
  getColumns: () => PretableColumn<TRow>[];
  getRowById: (rowId: string) => TRow | null;
  onCellEdit?: (payload: {
    rowId: string;
    columnId: string;
    value: unknown;
    row: TRow;
  }) => void | Promise<void>;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Stand-alone factory (tested directly). `useCellEditController` wraps it in useMemo.
export function createCellEditController<TRow extends PretableRow>(
  opts: CellEditControllerOptions<TRow>,
): CellEditController {
  const { grid, getColumns, getRowById, onCellEdit } = opts;
  // Monotonic token: every begin()/cancel() bumps it, so a stale async
  // resolution (editable/commit) can detect it is no longer the active edit.
  let token = 0;

  const inputFor = (
    addr: PretableCellAddress,
  ): PretableEditInput<TRow> | null => {
    const column = getColumns().find((c) => c.id === addr.columnId);
    const row = getRowById(addr.rowId);
    if (!column || !row) return null;
    const value = column.value ? column.value(row) : row[addr.columnId];
    return { rowId: addr.rowId, columnId: addr.columnId, row, column, value };
  };

  return {
    async begin(addr, initialDraft) {
      const input = inputFor(addr);
      if (!input) return;
      const editable = input.column.editable ?? false;
      const seed =
        initialDraft !== undefined
          ? initialDraft
          : input.column.formatEditValue
            ? input.column.formatEditValue(input.value, input)
            : input.value;

      if (editable === false) return;
      if (editable === true) {
        grid.beginEdit(addr, { draft: seed, status: "editing" });
        token += 1;
        return;
      }
      // async / function editable
      const myToken = (token += 1);
      grid.beginEdit(addr, { draft: seed, status: "checking" });
      const allowed = await editable(input);
      if (myToken !== token) return; // stale
      if (allowed) grid.markEditing();
      else grid.cancelEdit();
    },

    async commit(moveDirection) {
      const editing = grid.getSnapshot().editing;
      if (!editing) return;
      const addr = { rowId: editing.rowId, columnId: editing.columnId };
      const input = inputFor(addr);
      if (!input) return;
      const myToken = (token += 1);
      const draft = editing.draft;
      const value = input.column.parseEditValue
        ? input.column.parseEditValue(String(draft ?? ""), input)
        : draft;

      if (input.column.validate) {
        grid.markEditValidating();
        const result = await input.column.validate(value, input);
        if (myToken !== token) return; // stale
        if (result !== true) {
          grid.markEditInvalid(result);
          return;
        }
      }

      grid.markEditSaving();
      try {
        await onCellEdit?.({
          rowId: addr.rowId,
          columnId: addr.columnId,
          value,
          row: input.row,
        });
        if (myToken !== token) return; // stale
        grid.commitEditSucceeded();
        if (moveDirection) grid.moveFocus(moveDirection);
      } catch (err) {
        if (myToken !== token) return; // stale
        grid.markEditError(errorMessage(err));
      }
    },

    cancel() {
      token += 1;
      grid.cancelEdit();
    },
  };
}

export function useCellEditController<TRow extends PretableRow>(
  opts: CellEditControllerOptions<TRow>,
): CellEditController {
  // grid identity is stable for the life of the surface; other opts read via
  // closures that always see latest. Recreate only if grid changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => createCellEditController(opts), [opts.grid]);
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @pretable/react test -- use-cell-edit-controller`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/use-cell-edit-controller.ts packages/react/src/__tests__/use-cell-edit-controller.test.ts
git commit -m "feat(react): async cell-edit orchestrator with staleness guard"
```

---

## Task 5: Default cell editor + React column `renderEditor`

**Files:**

- Create: `packages/react/src/cell-editor.tsx`
- Modify: `packages/react/src/types.ts` (React `PretableColumn` gains `renderEditor`)
- Test: `packages/react/src/__tests__/cell-editor.test.tsx` (create)

- [ ] **Step 1: Add `renderEditor` to the React column type** — in `packages/react/src/types.ts`, locate the React `PretableColumn` interface (it extends the core column and adds `render`/`renderHeader`) and add:

```ts
  renderEditor?: (input: PretableEditorInput<TRow>) => ReactNode;
```

Define `PretableEditorInput` in the same file:

```ts
import type {
  PretableEditInput,
  PretableFocusDirection,
  PretableRow,
} from "@pretable/core";
import type { ReactNode } from "react";

/**
 * Input passed to a column's `renderEditor`. Extends the engine edit input with
 * draft controls bound to the active edit. `commit` accepts the focus direction
 * to move after a successful commit (Enter → "down", Tab → "right").
 *
 * @public
 */
export interface PretableEditorInput<
  TRow extends PretableRow = PretableRow,
> extends PretableEditInput<TRow> {
  draft: unknown;
  setDraft: (value: unknown) => void;
  commit: (direction?: PretableFocusDirection) => void;
  cancel: () => void;
}
```

- [ ] **Step 2: Write the failing test** — create `packages/react/src/__tests__/cell-editor.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

function makeInput(
  over: Partial<PretableEditorInput> = {},
): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "name",
    row: { id: "r1", name: "Ada" },
    column: { id: "name" },
    value: "Ada",
    draft: "Ada",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  };
}

describe("CellEditor (default)", () => {
  it("renders a text input seeded with the draft", () => {
    render(<CellEditor input={makeInput({ draft: "Ada" })} />);
    expect(screen.getByRole("textbox")).toHaveValue("Ada");
  });

  it("pushes keystrokes to setDraft", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ setDraft })} />);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Ada L." },
    });
    expect(setDraft).toHaveBeenCalledWith("Ada L.");
  });

  it("commits down on Enter, right on Tab, and cancels on Escape", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    const box = screen.getByRole("textbox");
    fireEvent.keyDown(box, { key: "Enter" });
    expect(commit).toHaveBeenCalledWith("down");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("delegates to column.renderEditor when provided", () => {
    const input = makeInput({
      column: { id: "name", renderEditor: () => <span>custom</span> },
    });
    render(<CellEditor input={input} />);
    expect(screen.getByText("custom")).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `pnpm --filter @pretable/react test -- cell-editor`
Expected: FAIL — `Cannot find module '../cell-editor'`.

- [ ] **Step 4: Implement the editor** — create `packages/react/src/cell-editor.tsx`:

```tsx
import { useEffect, useRef } from "react";

import type { PretableEditorInput } from "./types";

export interface CellEditorProps {
  input: PretableEditorInput;
}

/**
 * Renders a column's `renderEditor` if present, otherwise a default text input
 * that drives the active edit's draft and commit/cancel.
 */
export function CellEditor({ input }: CellEditorProps) {
  const ref = useRef<HTMLInputElement>(null);

  // Autofocus + select on mount so type-to-replace and immediate typing work.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  if (input.column.renderEditor) {
    return <>{input.column.renderEditor(input)}</>;
  }

  return (
    <input
      ref={ref}
      className="pretable-cell-editor"
      value={String(input.draft ?? "")}
      onChange={(e) => input.setDraft(e.target.value)}
      onKeyDown={(e) => {
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
      }}
    />
  );
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `pnpm --filter @pretable/react test -- cell-editor`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/cell-editor.tsx packages/react/src/types.ts packages/react/src/__tests__/cell-editor.test.tsx
git commit -m "feat(react): default CellEditor + renderEditor column hook + PretableEditorInput"
```

---

## Task 6: Wire editing into `PretableSurface` (triggers + render + props)

`packages/react/src/pretable-surface.tsx` is large (~2347 lines). Make **additive** changes at the named anchors; do not restructure the file.

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx`
- Test: `packages/react/src/__tests__/pretable-surface-editing.test.tsx` (create)

- [ ] **Step 1: Write the failing integration test** — create `packages/react/src/__tests__/pretable-surface-editing.test.tsx`:

```tsx
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import type { PretableColumn } from "../types";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
}
const ROWS: Row[] = [
  { id: "r1", name: "Ada" },
  { id: "r2", name: "Linus" },
];
const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Name", editable: true },
];

function renderGrid(onCellEdit = vi.fn()) {
  render(
    <PretableSurface<Row>
      ariaLabel="people"
      columns={COLUMNS}
      rows={ROWS}
      getRowId={(r) => r.id}
      viewportHeight={300}
      onCellEdit={onCellEdit}
    />,
  );
  return { onCellEdit };
}

function firstNameCell(): HTMLElement {
  // first body row, first cell
  return within(screen.getAllByRole("row")[1]).getAllByRole("gridcell")[0];
}

describe("PretableSurface editing", () => {
  it("enters edit mode on Enter and shows an input", () => {
    renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("commits on Enter and fires onCellEdit with the new value", async () => {
    const { onCellEdit } = renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Ada Lovelace" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await Promise.resolve();
    expect(onCellEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        rowId: "r1",
        columnId: "name",
        value: "Ada Lovelace",
      }),
    );
  });

  it("reverts on Escape without firing onCellEdit", () => {
    const { onCellEdit } = renderGrid();
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(onCellEdit).not.toHaveBeenCalled();
  });

  it("does not enter edit mode for a non-editable column", () => {
    render(
      <PretableSurface<Row>
        ariaLabel="people"
        columns={[{ id: "name", header: "Name" }]}
        rows={ROWS}
        getRowId={(r) => r.id}
        viewportHeight={300}
      />,
    );
    const cell = firstNameCell();
    fireEvent.click(cell);
    fireEvent.keyDown(cell, { key: "Enter" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @pretable/react test -- pretable-surface-editing`
Expected: FAIL — `onCellEdit` isn't a prop / no textbox appears.

- [ ] **Step 3: Add the `onCellEdit` prop** — in `pretable-surface.tsx`, add to `PretableSurfaceProps<TRow>`:

```ts
  onCellEdit?: (payload: {
    rowId: string;
    columnId: string;
    value: unknown;
    row: TRow;
  }) => void | Promise<void>;
```

- [ ] **Step 4: Instantiate the controller** — inside the `PretableSurface` component body, after the grid/model is available (the `grid` from `usePretable`/model and the resolved `columns` are in scope), add:

```ts
const editController = useCellEditController<TRow>({
  grid,
  getColumns: () => columns,
  getRowById: (id) =>
    snapshot.visibleRows.find((r) => r.id === id)?.row ?? null,
  onCellEdit,
});
```

Add imports at the top: `import { useCellEditController } from "./use-cell-edit-controller";` and `import { CellEditor } from "./cell-editor";`. (Use the component's existing names for the grid handle, resolved `columns`, and `snapshot`; if the snapshot variable has a different local name, match it.)

- [ ] **Step 5: Add begin-edit triggers to the grid keydown handler** — in the keydown handler function (the one containing the `if (key === "Enter" ...)` branch around line 2266), at the **top** of the handler, before the existing navigation/selection branches, add:

```ts
const editing = snapshot.editing;
if (!editing) {
  const focusAddr =
    snapshot.focus.rowId && snapshot.focus.columnId
      ? { rowId: snapshot.focus.rowId, columnId: snapshot.focus.columnId }
      : null;
  if (focusAddr) {
    if (key === "Enter" || key === "F2") {
      event.preventDefault();
      void editController.begin(focusAddr);
      return;
    }
    // type-to-replace: a single printable character seeds the draft
    if (key.length === 1 && !cmd && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      void editController.begin(focusAddr, key);
      return;
    }
  }
}
```

(`cmd` is the existing meta/ctrl flag in this handler; reuse it. If editing is active, the editor input owns keystrokes — Enter/Escape are handled inside `CellEditor` and stop-propagated, so the grid handler is not reached.)

- [ ] **Step 6: Add a double-click trigger** — at the existing cell `onDoubleClick` (around line 1448), add a call to begin editing for that cell's address (the row id + column id are in scope where the cell is rendered):

```ts
                onDoubleClick={(event) => {
                  // ...existing behavior...
                  if (column.editable) {
                    void editController.begin({ rowId, columnId: column.id });
                  }
                }}
```

- [ ] **Step 7: Render the editor in the active cell** — in the body-cell render path, when `snapshot.editing` targets this `{rowId, columnId}`, render `<CellEditor>` instead of the cell content:

```tsx
{snapshot.editing &&
snapshot.editing.rowId === rowId &&
snapshot.editing.columnId === column.id ? (
  <CellEditor
    input={{
      rowId,
      columnId: column.id,
      row,
      column,
      value: column.value ? column.value(row) : row[column.id],
      draft: snapshot.editing.draft,
      setDraft: (v) => grid.setEditDraft(v),
      commit: (dir) => void editController.commit(dir ?? "down"),
      cancel: () => editController.cancel(),
    }}
  />
) : (
  /* existing cell content render */
)}
```

(Use the component's existing `row`/`rowId`/`column` locals in the cell render scope. The `"saving"`/`"error"`/`"checking"` statuses may be surfaced via a `data-pretable-edit-status={snapshot.editing.status}` attribute on the cell for styling — optional, additive.)

- [ ] **Step 8: Run the editing test + full react suite**

Run: `pnpm --filter @pretable/react test -- pretable-surface-editing && pnpm --filter @pretable/react test`
Expected: PASS (4 new tests; no regressions in the existing suite).

- [ ] **Step 9: Typecheck**

Run: `pnpm --filter @pretable/react typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/react/src/pretable-surface.tsx packages/react/src/__tests__/pretable-surface-editing.test.tsx
git commit -m "feat(react): wire cell editing into PretableSurface (triggers, editor render, onCellEdit)"
```

---

## Task 7: Surface `onCellEdit` through `<Pretable>` + export public types

**Files:**

- Modify: `packages/react/src/pretable.tsx`, `packages/react/src/public_api.ts`
- Regenerate: `packages/react/react.api.md`

- [ ] **Step 1: Forward `onCellEdit` in `<Pretable>`** — in `packages/react/src/pretable.tsx`, add `onCellEdit` to `PretableProps` (delegating to the surface prop, matching how `onCopy`/`onColumnOrderChange` are forwarded):

```ts
  onCellEdit?: PretableSurfaceProps<TRow>["onCellEdit"];
```

and pass it through to the rendered `<PretableSurface ... onCellEdit={onCellEdit} />`.

- [ ] **Step 2: Export public types** — in `packages/react/src/public_api.ts`, export `PretableEditorInput` (and re-export `PretableEditInput`/`PretableEditState`/`PretableEditStatus` from core if the react entry point is expected to surface them, matching existing re-export style).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pretable/react typecheck`
Expected: PASS.

- [ ] **Step 4: Regenerate the API report** (required gate; clean env)

Run:

```bash
pnpm --filter @pretable/react build && pnpm --filter @pretable/react api
```

Expected: `react.api.md` updated; `pnpm --filter @pretable/react api:check` exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/pretable.tsx packages/react/src/public_api.ts packages/react/react.api.md
git commit -m "feat(react): expose onCellEdit on <Pretable> + export edit types"
```

---

## Task 8: Docs — `docs/grid/editing.mdx` + nav

**Files:**

- Create: `apps/website/content/docs/grid/editing.mdx`
- Modify: `apps/website/app/docs/_nav.ts`

- [ ] **Step 1: Write the docs page** — `apps/website/content/docs/grid/editing.mdx`. Frontmatter:

```mdx
---
title: Editing
description: "Controlled inline cell editing with an async editable / validate / commit lifecycle."
nav: Grid
order: 7
---
```

Required content (match the house voice in `docs/grid/clipboard.mdx`; every code sample type-correct against the shipped API):

- **Controlled model:** editing commits via `onCellEdit({ rowId, columnId, value, row })`; you update your own `rows`. No internal mutation.
- **Make a column editable:** `editable: true | (input) => boolean | Promise<boolean>` (note the async permission-gate use). Default off.
- **Validate:** `validate: (value, input) => true | string | Promise<...>` — return a string to reject and stay in edit.
- **Custom editors:** `renderEditor`, with `parseEditValue`/`formatEditValue`.
- **Lifecycle & async states:** the `checking → editing → validating → saving` phases, `invalid`/`error`, and that commit is pessimistic; `snapshot.editing.status` for headless/custom rendering.
- **Keyboard:** Enter/F2/double-click/type-to-replace to begin; Enter/Tab to commit; Escape to cancel.
- A short worked `onCellEdit` example updating React state.

- [ ] **Step 2: Add the nav entry** — in `apps/website/app/docs/_nav.ts`, add to the "Grid" section `items` (after Clipboard, before "Column layout"):

```ts
      { title: "Editing", href: "/docs/grid/editing" },
```

- [ ] **Step 3: Format + verify build picks up the page**

Run: `pnpm exec prettier --write apps/website/content/docs/grid/editing.mdx && pnpm --filter @pretable/app-website build`
Expected: build PASS; `/docs/grid/editing` present in the built search index.

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/docs/grid/editing.mdx apps/website/app/docs/_nav.ts
git commit -m "docs(website): cell editing page + nav entry"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Workspace tests** — Run: `pnpm -r --filter './packages/*' test`
      Expected: PASS (incl. the new grid-core + react edit suites).

- [ ] **Step 2: Typecheck (repo)** — Run: `pnpm typecheck`
      Expected: PASS.

- [ ] **Step 3: Lint (repo)** — Run: `pnpm lint`
      Expected: PASS.

- [ ] **Step 4: API freshness (required gate)** — Run: `pnpm api:check`
      Expected: exit 0 (core + react reports regenerated in Tasks 3 & 7). If it fails, run `pnpm api` in a clean env (`rm -rf node_modules && pnpm install --frozen-lockfile`) and commit the reports.

- [ ] **Step 5: Website build** — Run: `pnpm --filter @pretable/app-website build`
      Expected: PASS; editing docs route generated.

- [ ] **Step 6: Final commit (any verification fixups)**

```bash
git add -A && git commit -m "chore: cell editing — verification fixups"
```

---

## Notes for the executor

- **The required `API Extractor — report freshness` gate** blocks the PR until `core.api.md` and `react.api.md` are regenerated to match the new `@public` surface. Regenerate with `pnpm api` and, if CI disagrees with a local run, regenerate in a clean env (`rm -rf node_modules && pnpm install --frozen-lockfile`) — see the `project_dependabot_api_extractor_gap` memory. Worktree gotcha: if a run fails with an esbuild error, relink `node_modules/esbuild` to `.pnpm/esbuild@*/node_modules/esbuild`.
- **Don't restructure `pretable-surface.tsx`** — it's large; additions are at named anchors (keydown handler ~line 2266, `onDoubleClick` ~1448, the body-cell render path, the props interface). Match the file's existing local variable names for `grid`/`columns`/`snapshot`/`row`/`rowId`/`column`.
- **Controlled means pessimistic:** the grid shows the draft during `saving`; the row value only changes when the app updates `rows` in its `onCellEdit` handler. Tests use a resolved/rejected `onCellEdit` mock; they assert the callback payload and the `editing` status, not a mutated row.
- **Staleness** is the controller's job (the `token`); the engine transitions also no-op when `editing === null`, a second safety net.
- Keep all code type-correct against `packages/core/core.api.md` / `packages/grid-core/src/types.ts`.
