# Cell Editing v1 Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two cell-editing follow-ups — blur-to-commit and surfacing validation/commit errors + pending state with a11y — and ship the editor skin for every theme.

**Architecture:** `@pretable/react` adds behavior + a11y + DOM hooks (blur-commit, an error element, `aria-*`, `readOnly`, and `status`/`error` on `PretableEditorInput`). `@pretable/ui` ships the skin: two new semantic tokens defined in every theme + `:where()`-wrapped `grid.css` rules. Controlled/pessimistic flow unchanged.

**Tech Stack:** TypeScript, React 19, vitest + @testing-library/react (jsdom), api-extractor, vanilla CSS (`@layer pretable`, `--pretable-*` tokens).

**Spec:** `docs/superpowers/specs/2026-06-09-cell-editing-v1-polish-design.md`

**Branch:** `editing-v1-polish` (off latest `main`).

---

## File structure

Modify:

- `packages/react/src/types.ts` — `PretableEditorInput` gains `status` + `error`.
- `packages/react/src/pretable-surface.tsx` — pass `status`/`error` into the editor input; drop the `?? "down"` commit default (so blur commits with no move).
- `packages/react/src/cell-editor.tsx` — blur-commit, error element, ARIA, `readOnly`.
- `packages/react/react.api.md` — regenerated (public type change).
- `packages/ui/src/themes/excel.css`, `packages/ui/src/themes/material.css` — new tokens.
- `packages/ui/src/grid.css` — editor/error/pending rules.
- `packages/ui/src/__tests__/contract.test.ts` — add the two tokens to the contract list.
- `apps/website/content/docs/grid/editing.mdx`, `apps/website/content/docs/theming/token-reference.mdx` — docs.

Test files touched/created:

- `packages/react/src/__tests__/cell-editor.test.tsx` (extend)
- `packages/react/src/__tests__/pretable-surface-editing.test.tsx` (extend)
- `packages/ui/src/__tests__/css-cascade.test.ts` (extend) or `contract.test.ts`

---

## Task 1: Extend `PretableEditorInput` + surface plumbing

**Files:**

- Modify: `packages/react/src/types.ts`
- Modify: `packages/react/src/pretable-surface.tsx`
- Regenerate: `packages/react/react.api.md`

- [ ] **Step 1: Add `status` + `error` to `PretableEditorInput`** — in `packages/react/src/types.ts`, the interface currently is:

```ts
export interface PretableEditorInput<
  TRow extends PretableRow = PretableRow,
> extends Omit<PretableEditInput<TRow>, "column"> {
  column: PretableColumn<TRow>;
  draft: unknown;
  setDraft: (value: unknown) => void;
  commit: (direction?: PretableFocusDirection) => void;
  cancel: () => void;
}
```

Add the two fields and import the status type:

```ts
import type { PretableEditStatus } from "@pretable/core";
```

```ts
  status: PretableEditStatus;
  error?: string;
```

(Place them after `column` / before `draft`, keeping the interface readable.)

- [ ] **Step 2: Pass `status`/`error` from the surface + drop the commit default** — in `packages/react/src/pretable-surface.tsx`, find the `<CellEditor input={{ ... }} />` object (~line 1794, where `setDraft`/`commit`/`cancel` are defined and `cellEdit` is the local for this cell's `snapshot.editing`). Add to the input object:

```ts
                            status: cellEdit.status,
                            error: cellEdit.error,
```

and change the `commit` line from `(dir?: PretableFocusDirection) => void editController.commit(dir ?? "down")` to drop the default so a no-arg commit performs no focus move:

```ts
                            commit: (dir?: PretableFocusDirection) =>
                              void editController.commit(dir),
```

(Enter/Tab in the editor pass explicit `"down"`/`"right"`; blur will call `commit()` with no arg → no move.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @pretable/react typecheck`
Expected: PASS. (The editor doesn't yet read `status`/`error` — that's Task 2 — but the type + plumbing compile.)

- [ ] **Step 4: Regenerate the API report** (required gate)

Run: `pnpm --filter @pretable/react build && pnpm --filter @pretable/react api`
Expected: `react.api.md` updated (`PretableEditorInput` now has `status`/`error`); `pnpm --filter @pretable/react api:check` exits 0.

- [ ] **Step 5: Run existing react tests (no regression)**

Run: `pnpm --filter @pretable/react test`
Expected: PASS (existing editing tests still green; the input object now carries status/error but behavior is unchanged so far).

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/types.ts packages/react/src/pretable-surface.tsx packages/react/react.api.md
git commit -m "feat(react): add status/error to PretableEditorInput; blur commits without moving focus"
```

---

## Task 2: CellEditor — blur-commit, error element, a11y (TDD)

**Files:**

- Modify: `packages/react/src/cell-editor.tsx`
- Test: `packages/react/src/__tests__/cell-editor.test.tsx` (extend)

- [ ] **Step 1: Add the failing tests** — append to `cell-editor.test.tsx`. First update the existing `makeInput` helper to include the new required field `status` (default `"editing"`) so it stays type-correct:

```tsx
// in makeInput's returned object, add:
    status: "editing",
```

Then add these cases:

```tsx
it("commits in place (no direction) on blur while editing", () => {
  const commit = vi.fn();
  render(<CellEditor input={makeInput({ status: "editing", commit })} />);
  fireEvent.blur(screen.getByRole("textbox"));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith(); // no direction → no focus move
});

it("does NOT commit on blur while saving (no double-submit)", () => {
  const commit = vi.fn();
  render(<CellEditor input={makeInput({ status: "saving", commit })} />);
  fireEvent.blur(screen.getByRole("textbox"));
  expect(commit).not.toHaveBeenCalled();
});

it("renders the error message with role=alert and marks the input invalid", () => {
  render(
    <CellEditor input={makeInput({ status: "editing", error: "too short" })} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("too short");
  expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
});

it("is readOnly and aria-busy while saving", () => {
  render(<CellEditor input={makeInput({ status: "saving" })} />);
  const box = screen.getByRole("textbox");
  expect(box).toHaveAttribute("readonly");
  expect(box).toHaveAttribute("aria-busy", "true");
});

it("labels the input from column.header", () => {
  render(
    <CellEditor
      input={makeInput({ column: { id: "name", header: "Full name" } })}
    />,
  );
  expect(screen.getByRole("textbox")).toHaveAttribute(
    "aria-label",
    "Full name",
  );
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @pretable/react test -- cell-editor`
Expected: FAIL — no blur handler, no error element, no aria/readOnly.

- [ ] **Step 3: Rewrite `cell-editor.tsx`**

```tsx
import { useEffect, useRef } from "react";

import type { PretableEditorInput } from "./types";

export interface CellEditorProps {
  input: PretableEditorInput;
}

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  "checking",
  "validating",
  "saving",
]);

/**
 * Renders a column's `renderEditor` if present, otherwise a default text input
 * that drives the active edit's draft, commit/cancel, blur-to-commit, and
 * surfaces validation/commit errors + pending state with ARIA.
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

  const pending = PENDING_STATUSES.has(input.status);

  return (
    <>
      <input
        ref={ref}
        className="pretable-cell-editor"
        aria-label={input.column.header ?? input.columnId}
        aria-invalid={input.error ? true : undefined}
        aria-busy={pending ? true : undefined}
        readOnly={pending}
        value={String(input.draft ?? "")}
        onChange={(e) => input.setDraft(e.target.value)}
        onBlur={() => {
          // Commit in place (no direction → no focus move). Guarded to the
          // editing phase so a blur during an in-flight validate/save can't
          // double-submit; a blur from unmount-after-commit is a safe no-op.
          if (input.status === "editing") input.commit();
        }}
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
      {input.error ? (
        <div data-pretable-edit-error role="alert">
          {input.error}
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @pretable/react test -- cell-editor`
Expected: PASS (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/cell-editor.tsx packages/react/src/__tests__/cell-editor.test.tsx
git commit -m "feat(react): cell editor blur-commit + error/pending surfacing + a11y"
```

---

## Task 3: Surface-level async error-path tests

End-to-end through the real controller + surface (the unit tests above use a mock input).

**Files:**

- Test: `packages/react/src/__tests__/pretable-surface-editing.test.tsx` (extend)

- [ ] **Step 1: Add the failing tests** — append (reuse the file's existing `renderGrid`/cell helpers; if the helper signature differs, adapt to it):

```tsx
const flush = () => new Promise((r) => setTimeout(r, 0));

it("shows a validation message and keeps the editor open on reject", async () => {
  render(
    <PretableSurface<Row>
      ariaLabel="people"
      columns={[
        {
          id: "name",
          header: "Name",
          editable: true,
          validate: () => "too short",
        },
      ]}
      rows={ROWS}
      getRowId={(r) => r.id}
      viewportHeight={300}
      onCellEdit={vi.fn()}
    />,
  );
  const cell = firstNameCell();
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: "Enter" });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await flush();
  expect(screen.getByRole("alert")).toHaveTextContent("too short");
  expect(screen.getByRole("textbox")).toBeInTheDocument();
});

it("shows an error and allows Enter-retry when commit rejects then resolves", async () => {
  const onCellEdit = vi
    .fn()
    .mockRejectedValueOnce(new Error("save failed"))
    .mockResolvedValueOnce(undefined);
  render(
    <PretableSurface<Row>
      ariaLabel="people"
      columns={[{ id: "name", header: "Name", editable: true }]}
      rows={ROWS}
      getRowId={(r) => r.id}
      viewportHeight={300}
      onCellEdit={onCellEdit}
    />,
  );
  const cell = firstNameCell();
  fireEvent.click(cell);
  fireEvent.keyDown(cell, { key: "Enter" });
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Ada L." },
  });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await flush();
  expect(screen.getByRole("alert")).toHaveTextContent("save failed");
  // retry
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  await flush();
  expect(onCellEdit).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run them**

Run: `pnpm --filter @pretable/react test -- pretable-surface-editing`
Expected: PASS (these exercise code already implemented in Tasks 1–2 + the existing controller; if a test fails because of a helper-name mismatch, adapt the helper usage — do not change product code). If a genuine product gap surfaces, STOP and report.

- [ ] **Step 3: Commit**

```bash
git add packages/react/src/__tests__/pretable-surface-editing.test.tsx
git commit -m "test(react): surface-level validate-reject + commit-error retry paths"
```

---

## Task 4: Theme tokens — `--pretable-edit-bg` + `--pretable-text-error` (all themes)

**Files:**

- Modify: `packages/ui/src/themes/excel.css`, `packages/ui/src/themes/material.css`
- Modify: `packages/ui/src/__tests__/contract.test.ts`

- [ ] **Step 1: Add the tokens to the contract list (failing test first)** — in `contract.test.ts`, add to the `TOKENS` array:

```ts
  "pretable-edit-bg",
  "pretable-text-error",
```

- [ ] **Step 2: Run the contract test, verify it fails**

Run: `pnpm --filter @pretable/ui test -- contract`
Expected: FAIL — `excel.css: --pretable-edit-bg is empty` (themes don't define them yet).

- [ ] **Step 3: Define the tokens in `excel.css`** — in its `:root` block, add (matching the file's comment style):

```css
--pretable-edit-bg: #ffffff; /* editor field — matches grid surface */
--pretable-text-error: #b91c1c; /* invalid outline + error text */
```

- [ ] **Step 4: Define the tokens in `material.css`** — in the `:root` (light) block:

```css
--pretable-edit-bg: #fcfcfc; /* N99 — matches grid surface */
--pretable-text-error: #b3261e; /* M3 error (light) */
```

and in the `[data-theme="dark"]` block:

```css
--pretable-edit-bg: #1c1c1c; /* surface-container-low (dark) */
--pretable-text-error: #f2b8b5; /* M3 error (dark) */
```

- [ ] **Step 5: Run the contract test, verify it passes**

Run: `pnpm --filter @pretable/ui test -- contract`
Expected: PASS (both themes define the new tokens at `:root`).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/themes/excel.css packages/ui/src/themes/material.css packages/ui/src/__tests__/contract.test.ts
git commit -m "feat(ui): edit-bg + text-error tokens across excel + material (light/dark)"
```

---

## Task 5: `grid.css` editor/error/pending skin (`:where()`-wrapped)

Every selector MUST be `:where()`-wrapped (the cascade contract test enforces it).

**Files:**

- Modify: `packages/ui/src/grid.css`
- Test: `packages/ui/src/__tests__/css-cascade.test.ts` (extend)

- [ ] **Step 1: Add a presence assertion (failing first)** — append to `css-cascade.test.ts`:

```ts
test("grid.css styles the cell editor, error, and pending states", () => {
  const css = fs.readFileSync(GRID_CSS, "utf8");
  expect(css).toMatch(/:where\(\.pretable-cell-editor\)/);
  expect(css).toMatch(/:where\(\[data-pretable-edit-error\]\)/);
  expect(css).toMatch(/var\(--pretable-edit-bg\)/);
  expect(css).toMatch(/var\(--pretable-text-error\)/);
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @pretable/ui test -- css-cascade`
Expected: FAIL — those rules don't exist yet.

- [ ] **Step 3: Add the rules to `grid.css`** — inside the `@layer pretable { ... }` block, append (all selectors `:where()`-wrapped):

```css
/* Cell editor (inline editing) */
:where(.pretable-cell-editor) {
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: var(--pretable-cell-padding-y) var(--pretable-cell-padding-x);
  border: none;
  outline: 2px solid var(--pretable-focus-ring);
  outline-offset: -2px;
  background: var(--pretable-edit-bg);
  color: var(--pretable-text-cell);
  font-family: var(--pretable-font-sans);
  font-size: var(--pretable-font-size-cell);
}

:where(.pretable-cell-editor[aria-invalid="true"]) {
  outline-color: var(--pretable-text-error);
}

:where(.pretable-cell-editor[aria-busy="true"]) {
  opacity: 0.7;
  cursor: wait;
}

:where([data-pretable-edit-error]) {
  margin-top: 2px;
  color: var(--pretable-text-error);
  font-family: var(--pretable-font-sans);
  font-size: var(--pretable-font-size-cell);
}
```

- [ ] **Step 4: Run the css tests, verify they pass**

Run: `pnpm --filter @pretable/ui test`
Expected: PASS (new presence test + the existing `:where()`-wrapping contract still holds for the added selectors).

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "feat(ui): grid.css cell-editor + error + pending skin (layered, :where-wrapped)"
```

---

## Task 6: Docs — editing behavior + token reference

**Files:**

- Modify: `apps/website/content/docs/grid/editing.mdx`
- Modify: `apps/website/content/docs/theming/token-reference.mdx`

- [ ] **Step 1: Update `editing.mdx`** — add a short subsection documenting: blur commits the current draft in place (no focus move); validation/commit failures show an inline message and keep the editor open (`Enter` retries a failed commit); the input is read-only and `aria-busy` during async validate/save; the editing cell exposes `data-pretable-edit-status` and the error element `data-pretable-edit-error` for custom styling. Keep house voice; every claim must match the shipped behavior.

- [ ] **Step 2: Update `token-reference.mdx`** — add `--pretable-edit-bg` (editor field surface) and `--pretable-text-error` (invalid outline + error text) to the token table, matching the file's existing row format.

- [ ] **Step 3: Format + build**

Run: `pnpm exec prettier --write apps/website/content/docs/grid/editing.mdx apps/website/content/docs/theming/token-reference.mdx && pnpm --filter @pretable/app-website build`
Expected: build PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/website/content/docs/grid/editing.mdx apps/website/content/docs/theming/token-reference.mdx
git commit -m "docs(website): editing blur/error/pending behavior + new edit tokens"
```

---

## Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Package tests** — Run: `pnpm -r --filter './packages/*' test`
      Expected: PASS (react + ui suites incl. the new tests).

- [ ] **Step 2: Typecheck** — Run: `pnpm typecheck` → PASS.

- [ ] **Step 3: Lint** — Run: `pnpm lint` → PASS.

- [ ] **Step 4: Format** — Run: `pnpm format` → PASS (all files prettier-clean).

- [ ] **Step 5: API freshness (required gate)** — Run: `pnpm api:check` → exit 0. If it fails, regenerate in a clean env (`rm -rf node_modules && pnpm install --frozen-lockfile && pnpm api`) and commit.

- [ ] **Step 6: Website build** — Run: `pnpm --filter @pretable/app-website build` → PASS.

- [ ] **Step 7: Final commit (any fixups)**

```bash
git add -A && git commit -m "chore: cell editing v1 polish — verification fixups"
```

---

## Notes for the executor

- **`grid.css` selectors must be `:where()`-wrapped** — the `css-cascade` contract test fails otherwise.
- **New tokens must be in `contract.test.ts`'s `TOKENS` and defined at `:root` in BOTH themes** (the contract test checks excel + material `:root`); material also gets the values in `[data-theme="dark"]` for correctness even though the test only checks `:root`.
- **Regenerate `react.api.md`** after the `PretableEditorInput` change (required `API Extractor — report freshness` gate). If a local run disagrees with CI, regenerate in a clean env (`rm -rf node_modules && pnpm install --frozen-lockfile`) — see `project_dependabot_api_extractor_gap` memory. Worktree gotcha: if a run fails with an esbuild error, relink `node_modules/esbuild` → `.pnpm/esbuild@*/node_modules/esbuild`.
- **Match real local names in `pretable-surface.tsx`** — the editor input object is built around line 1794 with the cell's `cellEdit` local (= `snapshot.editing` for that cell). Add `status`/`error`, change the `commit` wrapper to not default the direction.
- The theme files are under active parallel theming work — additions here are purely additive (two tokens), but expect to reconcile at merge.
