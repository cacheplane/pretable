# Typed Cell Editors — Sub-project 2 (Enum combobox) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the strict enum combobox editor (typeahead filter, keyboard selection, portal-rendered listbox) — and fix the popover-positioning bug it would otherwise inherit.

**Architecture:** A new shared `overlay/` module portals popovers into `document.body`, because the grid viewport sets `contain: content` — which makes it a containing block for `position: fixed` descendants _and_ clips them (verified empirically). The existing `FilterMenu` adopts the same portal, fixing a shipped mis-positioning bug. The combobox keeps the engine draft as the single source of truth (draft = input text; commit maps text → option value via a strict `parseDraftForType` enum branch), so it composes with the existing `useEditorField` chrome.

**Tech Stack:** TypeScript, React 19 (`createPortal`), vitest + @testing-library/react (jsdom), api-extractor, vanilla CSS (`@layer pretable`, `:where()`, `--pretable-*` tokens).

**Spec:** `docs/superpowers/specs/2026-08-05-typed-cell-editors-design.md` §4.4 (this sub-project), §3, §5.

**Branch:** `typed-editors-2` (already created off latest `origin/main`).

---

## Verified ground truth (don't re-derive)

- **Containment (measured, not assumed):** a `position: fixed` child of a `contain: content` scroller resolves against that scroller's box, not the browser viewport (test page: fixed `top/left: 200` inside a viewport at page `(120, 80)` resolved to `(321, 281)`), and paint containment clips it. `packages/react/src/styles.ts:14-22` (`getViewportStyle`) sets `contain: "content"`, and the surface's **root returned element IS the scroll viewport** (`pretable-surface.tsx:994-1000`, `data-pretable-scroll-viewport`, style applied ~1218). `<FilterMenu>` renders at ~2139, i.e. **inside** that contained element → the shipped filter popover is offset by the grid's page position and clipped. No `createPortal` exists anywhere in `packages/react/src` today.
- `packages/react/src/filter-menu/useFilterPopover.ts` exports `useFilterPopover()` (open state + Escape/scroll/resize close) and `popoverStyle(rect)` (fixed, width 240, right-edge flip).
- `packages/react/src/editors/use-editor-field.ts` — `useEditorField(input)` returns `{ ref, pending, errorId, fieldProps }`; `fieldProps` carries ARIA, `readOnly`, `onBlur` (commit-in-place, guarded to `status === "editing"`), and `onKeyDown` (Enter→`commit("down")`, Tab→`commit("right")`, Escape→`cancel()`), each with `preventDefault` + `stopPropagation`.
- `packages/react/src/editors/type-parsing.ts` — `parseDraftForType(column, draft)` → `{ok:true,value}|{ok:false,message}`; only the `number` case is implemented; doc comment already says enum/date join here.
- `packages/react/src/cell-editor.tsx` — `editorFor()`: number → `text && wrap` multiline → default text; `renderEditor` short-circuits in `CellEditor`.
- `packages/react/src/filter-menu/filter-operators.ts` — `BOOLEAN_OPTIONS` + `resolveColumnOptions(column, distinctValues)`; boolean currently ignores declared `column.options`, and non-enum/boolean types still run the `distinctValues()` scan.
- **Engine drafts are synchronous:** `input.setDraft(v)` → `grid.setEditDraft(v)` mutates engine state immediately, and `controller.commit()` reads `grid.getSnapshot().editing.draft`. So `setDraft(x); commit()` in one handler commits `x` — no React state round-trip needed.
- `ColumnOption` = `{ value: string; label?: string }` (`packages/core/core.api.md`).
- `packages/react/package.json` — `react-dom` is a **devDependency only**; peerDeps list `react` alone. A shipped `createPortal` import requires adding it to `peerDependencies` (checked by `lint:packaging` → publint + attw).
- Filter popover skin lives at `packages/ui/src/grid.css:285-315` (`[data-pretable-filter-menu]` + children), token-only, `:where()`-wrapped.

---

## File structure

Create:

- `packages/react/src/overlay/OverlayPortal.tsx` — portal to `document.body` (SSR/hydration-safe).
- `packages/react/src/overlay/popover-position.ts` — `popoverStyle` moved here (shared by filter menu + combobox).
- `packages/react/src/editors/enum-options.ts` — pure `optionLabel` / `matchOption` / `filterOptions`.
- `packages/react/src/editors/EnumCellEditor.tsx` — the combobox.
- Tests: `packages/react/src/__tests__/{enum-options,enum-cell-editor}.test.{ts,tsx}`.

Modify:

- `packages/react/package.json` — add `react-dom` peer dep.
- `packages/react/src/filter-menu/useFilterPopover.ts` — re-export/delegate `popoverStyle` from `overlay/`.
- `packages/react/src/filter-menu/FilterMenu.tsx` — wrap its root in `OverlayPortal`.
- `packages/react/src/filter-menu/filter-operators.ts` — `resolveColumnOptions` refinements.
- `packages/react/src/editors/type-parsing.ts` — strict enum branch.
- `packages/react/src/editors/index.ts` — barrel additions (internal only).
- `packages/react/src/cell-editor.tsx` — enum dispatch.
- `packages/ui/src/grid.css` (+ `__tests__/css-cascade.test.ts`) — listbox skin.
- `apps/website/content/docs/grid/editing.mdx` — enum editor docs.

---

## Task 1: Shared overlay portal + fix the filter popover position

**Files:**

- Create: `packages/react/src/overlay/OverlayPortal.tsx`, `packages/react/src/overlay/popover-position.ts`
- Modify: `packages/react/package.json`, `packages/react/src/filter-menu/useFilterPopover.ts`, `packages/react/src/filter-menu/FilterMenu.tsx`
- Test: `packages/react/src/__tests__/filter-menu-surface.test.tsx` (extend)

- [ ] **Step 1: Add the failing test** — append to `packages/react/src/__tests__/filter-menu-surface.test.tsx` (reuse that file's existing helper for rendering the surface and opening a funnel; if its open helper has a different name, match it):

```tsx
it("renders the filter popover outside the contained scroll viewport", async () => {
  renderGrid();
  fireEvent.click(screen.getAllByRole("button", { name: /filter/i })[0]);
  const dialog = await screen.findByRole("dialog");
  // The viewport sets `contain: content`, which traps and clips fixed-position
  // descendants — the popover must be portaled out of that subtree.
  expect(dialog.closest("[data-pretable-scroll-viewport]")).toBeNull();
  expect(dialog.closest("body")).not.toBeNull();
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @pretable/react test -- filter-menu-surface`
Expected: FAIL — the dialog is currently inside `[data-pretable-scroll-viewport]`.

- [ ] **Step 3: Add `react-dom` as a peer dependency** — in `packages/react/package.json`, change `peerDependencies` to:

```json
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
```

- [ ] **Step 4: Create `packages/react/src/overlay/OverlayPortal.tsx`:**

```tsx
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into `document.body`.
 *
 * The grid viewport sets `contain: content`, which makes it a containing block
 * for `position: fixed` descendants *and* clips them to its box. Any popover
 * positioned from `getBoundingClientRect()` coordinates must therefore escape
 * the viewport subtree entirely. Mounting is deferred one tick so the server
 * render and the first client render agree (popovers only open on interaction).
 */
export function OverlayPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
```

- [ ] **Step 5: Create `packages/react/src/overlay/popover-position.ts`** — move `popoverStyle` here verbatim from `filter-menu/useFilterPopover.ts`:

```ts
import type { CSSProperties } from "react";

/** Fixed-position style from the anchor rect, flipped near the right/bottom edges. */
export function popoverStyle(rect: DOMRect): CSSProperties {
  const WIDTH = 240;
  const MARGIN = 8;
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const left = Math.min(rect.left, vw - WIDTH - MARGIN);
  return {
    position: "fixed",
    top: rect.bottom + 4,
    left: Math.max(MARGIN, left),
    width: WIDTH,
    zIndex: 50,
  };
}
```

Then in `filter-menu/useFilterPopover.ts`: delete the local `popoverStyle` definition and its now-unused `CSSProperties` import, and re-export from the new home so existing importers keep working:

```ts
export { popoverStyle } from "../overlay/popover-position";
```

- [ ] **Step 6: Portal the FilterMenu** — in `packages/react/src/filter-menu/FilterMenu.tsx`, import `OverlayPortal` (`import { OverlayPortal } from "../overlay/OverlayPortal";`) and wrap the returned root element:

```tsx
return (
  <OverlayPortal>
    {/* existing <div ref={rootRef} role="dialog" … > … </div> unchanged */}
  </OverlayPortal>
);
```

Change nothing inside the dialog (outside-click, focus, and close handlers all keep working — `rootRef` still wraps the portaled content, and the listeners are document/window level).

- [ ] **Step 7: Run the test, verify it passes; run the full react suite**

Run: `pnpm --filter @pretable/react test`
Expected: PASS — the new assertion plus every existing filter-menu test (open/close, operator select, live-apply, outside-click) still green.

- [ ] **Step 8: Packaging gate (new peer dep)**

Run: `pnpm --filter @pretable/react lint:packaging && pnpm --filter @pretable/react typecheck`
Expected: PASS (publint + attw accept the declared peer).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "fix(react): portal popovers out of the contained viewport

The grid viewport sets contain: content, which makes it a containing block for
fixed-position descendants and clips them — so the filter popover was offset by
the grid's page position. Adds a shared OverlayPortal + popover-position module
and routes FilterMenu through it."
```

---

## Task 2: Pure enum helpers + strict parsing + resolveColumnOptions refinements (TDD)

**Files:**

- Create: `packages/react/src/editors/enum-options.ts`
- Modify: `packages/react/src/editors/type-parsing.ts`, `packages/react/src/filter-menu/filter-operators.ts`
- Test: `packages/react/src/__tests__/enum-options.test.ts` (create), extend `packages/react/src/__tests__/type-parsing.test.ts` and `packages/react/src/__tests__/filter-operators.test.ts`

- [ ] **Step 1: Write the failing helper tests** — create `packages/react/src/__tests__/enum-options.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  filterOptions,
  matchOption,
  optionLabel,
} from "../editors/enum-options";

const OPTS = [
  { value: "running", label: "Running" },
  { value: "queued" },
  { value: "done", label: "Done" },
];

describe("enum option helpers", () => {
  it("optionLabel falls back to the value", () => {
    expect(optionLabel(OPTS[0])).toBe("Running");
    expect(optionLabel(OPTS[1])).toBe("queued");
  });

  it("matchOption matches label or value, case-insensitively", () => {
    expect(matchOption(OPTS, "running")?.value).toBe("running");
    expect(matchOption(OPTS, "  DONE ")?.value).toBe("done");
    expect(matchOption(OPTS, "queued")?.value).toBe("queued");
  });

  it("matchOption returns undefined for no match or empty text", () => {
    expect(matchOption(OPTS, "nope")).toBeUndefined();
    expect(matchOption(OPTS, "   ")).toBeUndefined();
  });

  it("filterOptions substring-filters on label and value; empty text = all", () => {
    expect(filterOptions(OPTS, "")).toHaveLength(3);
    expect(filterOptions(OPTS, "ru").map((o) => o.value)).toEqual(["running"]);
    expect(filterOptions(OPTS, "ue").map((o) => o.value)).toEqual(["queued"]);
    expect(filterOptions(OPTS, "zz")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/react test -- enum-options` → `Cannot find module '../editors/enum-options'`.

- [ ] **Step 3: Implement `packages/react/src/editors/enum-options.ts`:**

```ts
import type { ColumnOption } from "@pretable/core";

/** The text shown for an option — its `label`, or the raw `value`. */
export function optionLabel(option: ColumnOption): string {
  return option.label ?? option.value;
}

/**
 * The option a typed string selects: an exact (case-insensitive) label match
 * first, then an exact value match. Blank text selects nothing.
 */
export function matchOption(
  options: readonly ColumnOption[],
  text: string,
): ColumnOption | undefined {
  const needle = text.trim().toLowerCase();
  if (needle === "") return undefined;
  return (
    options.find((o) => optionLabel(o).toLowerCase() === needle) ??
    options.find((o) => o.value.toLowerCase() === needle)
  );
}

/** Typeahead filter: substring over label and value. Blank text keeps all. */
export function filterOptions(
  options: readonly ColumnOption[],
  text: string,
): ColumnOption[] {
  const needle = text.trim().toLowerCase();
  if (needle === "") return [...options];
  return options.filter(
    (o) =>
      optionLabel(o).toLowerCase().includes(needle) ||
      o.value.toLowerCase().includes(needle),
  );
}
```

- [ ] **Step 4: Write the failing parse tests** — append to `packages/react/src/__tests__/type-parsing.test.ts`:

```ts
describe("parseDraftForType — enum", () => {
  const column = {
    type: "enum" as const,
    options: [{ value: "running", label: "Running" }, { value: "done" }],
  };

  it("maps a matching label to the option value", () => {
    expect(parseDraftForType(column, "Running")).toEqual({
      ok: true,
      value: "running",
    });
  });

  it("accepts a raw value too", () => {
    expect(parseDraftForType(column, "done")).toEqual({
      ok: true,
      value: "done",
    });
  });

  it("rejects text that matches no option", () => {
    expect(parseDraftForType(column, "nope")).toEqual({
      ok: false,
      message: "Pick an option",
    });
  });

  it("commits null for an empty draft", () => {
    expect(parseDraftForType(column, "")).toEqual({ ok: true, value: null });
  });

  it("passes through when the column declares no options (text behavior)", () => {
    expect(parseDraftForType({ type: "enum" }, "anything")).toEqual({
      ok: true,
      value: "anything",
    });
  });
});
```

- [ ] **Step 5: Run, verify FAIL** — the enum drafts currently fall through the `default` arm unchanged.

- [ ] **Step 6: Implement the enum branch** — in `packages/react/src/editors/type-parsing.ts`, import the helper and widen the column parameter type, then add the case above `default`:

```ts
import type { ColumnOption, ColumnType } from "@pretable/core";

import { matchOption } from "./enum-options";
```

```ts
export function parseDraftForType(
  column: { type?: ColumnType; options?: ColumnOption[] },
  draft: unknown,
): DraftParseResult {
```

```ts
    case "enum": {
      const options = column.options ?? [];
      // An enum column without options behaves as a plain text column.
      if (options.length === 0) return { ok: true, value: draft };
      const raw = String(draft ?? "").trim();
      if (raw === "") return { ok: true, value: null };
      const match = matchOption(options, raw);
      return match
        ? { ok: true, value: match.value }
        : { ok: false, message: "Pick an option" };
    }
```

Also update the doc comment's trailing sentence from "Enum strictness and date validity join here in sub-projects 2/3." to "Date validity joins here in sub-project 3."

- [ ] **Step 7: Write the failing `resolveColumnOptions` tests** — append to `packages/react/src/__tests__/filter-operators.test.ts`:

```ts
describe("resolveColumnOptions refinements", () => {
  it("lets a boolean column override the implicit labels", () => {
    expect(
      resolveColumnOptions(
        {
          type: "boolean",
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
        },
        () => [],
      ),
    ).toEqual([
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ]);
  });

  it("skips the distinct-value scan for types without a checklist", () => {
    const distinct = vi.fn(() => ["a", "b"]);
    expect(resolveColumnOptions({ type: "text" }, distinct)).toEqual([]);
    expect(resolveColumnOptions({ type: "number" }, distinct)).toEqual([]);
    expect(distinct).not.toHaveBeenCalled();
  });
});
```

(Ensure `vi` is imported in that file's vitest import list.)

- [ ] **Step 8: Run, verify FAIL; implement** — in `filter-operators.ts` replace the body of `resolveColumnOptions` with:

```ts
export function resolveColumnOptions(
  column: { type?: ColumnType; options?: ColumnOption[] },
  distinctValues: () => string[],
): ColumnOption[] {
  // Only enum-style columns render a checklist; skip the scan for the rest.
  if (column.type === "boolean") return column.options ?? BOOLEAN_OPTIONS;
  if (column.type !== "enum") return [];
  return column.options ?? distinctValues().map((value) => ({ value }));
}
```

- [ ] **Step 9: Run the full react suite**

Run: `pnpm --filter @pretable/react test`
Expected: PASS — including every existing filter-menu test (text/number/date menus never render the checklist, so the `[]` return is inert).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(react): strict enum draft parsing + enum option helpers; resolveColumnOptions refinements"
```

---

## Task 3: EnumCellEditor + dispatch (TDD)

**Files:**

- Create: `packages/react/src/editors/EnumCellEditor.tsx`
- Modify: `packages/react/src/cell-editor.tsx`, `packages/react/src/editors/index.ts`
- Test: `packages/react/src/__tests__/enum-cell-editor.test.tsx` (create)

- [ ] **Step 1: Write the failing tests** — create `packages/react/src/__tests__/enum-cell-editor.test.tsx` (mirrors the scaffold of `number-cell-editor.test.tsx`):

```tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CellEditor } from "../cell-editor";
import type { PretableEditorInput } from "../types";

afterEach(cleanup);

const OPTIONS = [
  { value: "queued", label: "Queued" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
];

function makeInput(
  over: Partial<PretableEditorInput> = {},
): PretableEditorInput {
  return {
    rowId: "r1",
    columnId: "status",
    row: { id: "r1", status: "queued" },
    column: {
      id: "status",
      header: "Status",
      type: "enum",
      options: OPTIONS,
    },
    value: "queued",
    status: "editing",
    draft: "Queued",
    setDraft: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as PretableEditorInput;
}

describe("EnumCellEditor (via dispatcher)", () => {
  it("renders a combobox with every option listed", () => {
    render(<CellEditor input={makeInput()} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("typing filters the option list", () => {
    const setDraft = vi.fn();
    const { rerender } = render(<CellEditor input={makeInput({ setDraft })} />);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "run" },
    });
    expect(setDraft).toHaveBeenCalledWith("run");
    rerender(<CellEditor input={makeInput({ setDraft, draft: "run" })} />);
    const shown = screen.getAllByRole("option").map((o) => o.textContent);
    expect(shown).toEqual(["Running"]);
  });

  it("ArrowDown moves the highlight and Enter commits that option's label", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(setDraft).toHaveBeenCalledWith("Running");
    expect(commit).toHaveBeenCalledWith("down");
  });

  it("clicking an option commits it in place", () => {
    const setDraft = vi.fn();
    const commit = vi.fn();
    render(<CellEditor input={makeInput({ setDraft, commit })} />);
    fireEvent.click(screen.getByRole("option", { name: "Done" }));
    expect(setDraft).toHaveBeenCalledWith("Done");
    expect(commit).toHaveBeenCalledWith();
  });

  it("mousedown on the listbox is default-prevented so the input never blurs", () => {
    render(<CellEditor input={makeInput()} />);
    const notPrevented = fireEvent.mouseDown(screen.getByRole("listbox"));
    expect(notPrevented).toBe(false);
  });

  it("blur cancels when the text matches no option", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ draft: "zzz", commit, cancel })} />);
    fireEvent.blur(screen.getByRole("combobox"));
    expect(cancel).toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("blur commits when the text matches an option", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ draft: "Done", commit, cancel })} />);
    fireEvent.blur(screen.getByRole("combobox"));
    expect(commit).toHaveBeenCalledWith();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("Escape cancels; Tab commits right", () => {
    const commit = vi.fn();
    const cancel = vi.fn();
    render(<CellEditor input={makeInput({ commit, cancel })} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "Tab" });
    expect(commit).toHaveBeenCalledWith("right");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(cancel).toHaveBeenCalled();
  });

  it("re-seeds the field with the option's label when the draft holds the raw value", () => {
    const setDraft = vi.fn();
    render(<CellEditor input={makeInput({ draft: "queued", setDraft })} />);
    expect(setDraft).toHaveBeenCalledWith("Queued");
  });

  it("a type-to-replace seed filters the list immediately", () => {
    render(<CellEditor input={makeInput({ draft: "d" })} />);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Done",
    ]);
  });

  it("falls back to the text editor when the column declares no options", () => {
    render(
      <CellEditor
        input={makeInput({
          column: { id: "status", type: "enum" },
        })}
      />,
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/react test -- enum-cell-editor` (enum currently dispatches to the text editor: no combobox/listbox).

- [ ] **Step 3: Implement `packages/react/src/editors/EnumCellEditor.tsx`:**

```tsx
import { useId, useLayoutEffect, useRef, useState } from "react";

import type { ColumnOption, PretableFocusDirection } from "@pretable/core";

import { OverlayPortal } from "../overlay/OverlayPortal";
import { popoverStyle } from "../overlay/popover-position";
import type { PretableEditorInput } from "../types";
import { filterOptions, matchOption, optionLabel } from "./enum-options";
import { useEditorField } from "./use-editor-field";

/**
 * Strict enum combobox: the engine draft holds the input text, and commit maps
 * it to an option value (`parseDraftForType`). Free text that matches nothing
 * is rejected — `renderEditor` is the escape hatch for creatable comboboxes.
 */
export function EnumCellEditor({ input }: { input: PretableEditorInput }) {
  const { ref, pending, fieldProps } = useEditorField<HTMLInputElement>(input);
  const options = input.column.options ?? [];
  const listId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Until the user types, show every option (the seeded text is the current
  // value and would otherwise filter the list down to one). A seed that
  // matches nothing is a type-to-replace character, so filter right away.
  const [dirty, setDirty] = useState(
    () => !matchOption(options, String(input.draft ?? "")),
  );
  const [highlight, setHighlight] = useState(() => {
    const i = options.findIndex((o) => o.value === String(input.value ?? ""));
    return i >= 0 ? i : 0;
  });

  useLayoutEffect(() => {
    if (anchorRef.current) setRect(anchorRef.current.getBoundingClientRect());
  }, []);

  // The controller seeds the draft with the raw cell value; show the option's
  // label instead so the field reads the way the cell does. One-shot: it only
  // fires when the seed matches an option whose label differs.
  useLayoutEffect(() => {
    const seeded = String(input.draft ?? "");
    const match = matchOption(options, seeded);
    if (match && optionLabel(match) !== seeded)
      input.setDraft(optionLabel(match));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const text = String(input.draft ?? "");
  const visible = dirty ? filterOptions(options, text) : options;
  const active = visible[highlight];

  const choose = (
    option: ColumnOption | undefined,
    direction?: PretableFocusDirection,
  ) => {
    if (!option || pending) return;
    // setDraft mutates engine state synchronously, so the commit that follows
    // reads the option we just wrote.
    input.setDraft(optionLabel(option));
    input.commit(direction);
  };

  return (
    <span ref={anchorRef} data-pretable-enum-editor="">
      <input
        ref={ref}
        className="pretable-cell-editor"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active ? `${listId}-${highlight}` : undefined}
        value={text}
        onChange={(e) => {
          setDirty(true);
          setHighlight(0);
          input.setDraft(e.target.value);
        }}
        {...fieldProps}
        onBlur={() => {
          // Strict: clicking away with unmatched text reverts rather than
          // leaving a rejected edit stuck open on the cell.
          if (input.status !== "editing") return;
          if (matchOption(options, text)) input.commit();
          else input.cancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            const n = visible.length;
            if (n > 0) {
              setHighlight((h) =>
                e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n,
              );
            }
            return;
          }
          if ((e.key === "Enter" || e.key === "Tab") && active) {
            e.preventDefault();
            e.stopPropagation();
            choose(active, e.key === "Enter" ? "down" : "right");
            return;
          }
          // No highlighted option (or Escape): let the shared chrome commit
          // the raw text — parseDraftForType rejects it — or cancel.
          fieldProps.onKeyDown(e);
        }}
      />
      <OverlayPortal>
        <ul
          id={listId}
          role="listbox"
          data-pretable-enum-listbox=""
          style={rect ? popoverStyle(rect) : undefined}
          // Keep focus in the input; a blur would commit or revert before the
          // click lands (same hazard as the number steppers).
          onMouseDown={(e) => e.preventDefault()}
        >
          {visible.map((option, i) => (
            <li
              key={option.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === highlight}
              data-pretable-enum-option=""
              onClick={() => choose(option)}
            >
              {optionLabel(option)}
            </li>
          ))}
        </ul>
      </OverlayPortal>
    </span>
  );
}
```

- [ ] **Step 4: Dispatch enum columns** — in `packages/react/src/cell-editor.tsx`, import `EnumCellEditor` and update `editorFor` (an enum column with no options keeps text behavior, matching `parseDraftForType`):

```tsx
function editorFor(input: PretableEditorInput) {
  const type = input.column.type ?? "text";
  if (type === "number") return <NumberCellEditor input={input} />;
  if (type === "enum" && (input.column.options?.length ?? 0) > 0)
    return <EnumCellEditor input={input} />;
  if (type === "text" && input.column.wrap)
    return <MultilineCellEditor input={input} />;
  // date falls back to text until sub-project 3; boolean never reaches this
  // popover path (the cell control commits directly); an enum column without
  // options behaves as text.
  return <TextCellEditor input={input} />;
}
```

Add `EnumCellEditor`, `filterOptions`, `matchOption`, `optionLabel` to `packages/react/src/editors/index.ts` (internal barrel — do NOT export from `public_api.ts`).

- [ ] **Step 5: Run the tests, verify they pass; full suite + gates**

Run: `pnpm --filter @pretable/react test && pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react lint`
Expected: PASS (9 new enum-editor tests; no regressions).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(react): strict enum combobox cell editor with typeahead and portal listbox"
```

---

## Task 4: Listbox skin

**Files:**

- Modify: `packages/ui/src/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts`

- [ ] **Step 1: Add the failing presence assertion** — append to `css-cascade.test.ts`:

```ts
test("grid.css styles the enum combobox listbox", () => {
  const css = fs.readFileSync(GRID_CSS, "utf8");
  expect(css).toMatch(/:where\(\[data-pretable-enum-listbox\]\)/);
  expect(css).toMatch(
    /:where\(\[data-pretable-enum-option\]\[aria-selected="true"\]\)/,
  );
});
```

- [ ] **Step 2: Run, verify FAIL** — `pnpm --filter @pretable/ui test -- css-cascade`.

- [ ] **Step 3a: Fix the portaled filter menu's font** (review finding from Task 1) — `font-family: var(--pretable-font-sans)` was inherited from a real declaration on `[data-pretable-scroll-viewport]` (`grid.css:33`), not from a token on `:root`, so portaled popovers now inherit the host page's font instead. Add the declaration to the existing `:where([data-pretable-filter-menu])` block (~line 285), which currently only sets `font: inherit`:

```css
font-family: var(--pretable-font-sans);
```

- [ ] **Step 3b: Add the listbox rules** — inside the single `@layer pretable { }` block in `packages/ui/src/grid.css`, next to the filter-menu rules (all `:where()`-wrapped, tokens only; note the listbox block below already declares `font-family` for the same reason):

```css
/* Enum combobox listbox (cell editor) */
:where([data-pretable-enum-editor]) {
  display: block;
  width: 100%;
  height: 100%;
}

:where([data-pretable-enum-listbox]) {
  margin: 0;
  padding: 4px 0;
  list-style: none;
  max-height: 220px;
  overflow-y: auto;
  background: var(--pretable-bg-grid);
  border: 1px solid var(--pretable-rule-strong);
  border-radius: var(--pretable-radius);
  box-shadow: var(--pretable-reorder-ghost-shadow);
  font-family: var(--pretable-font-sans);
  font-size: var(--pretable-font-size-cell);
  color: var(--pretable-text-cell);
}

:where([data-pretable-enum-option]) {
  padding: var(--pretable-cell-padding-y) var(--pretable-cell-padding-x);
  cursor: pointer;
}

:where([data-pretable-enum-option]:hover) {
  background: var(--pretable-bg-hover);
}

:where([data-pretable-enum-option][aria-selected="true"]) {
  background: var(--pretable-bg-selected);
  color: var(--pretable-text-selected);
}
```

- [ ] **Step 4: Run the ui suite, verify pass** — `pnpm --filter @pretable/ui test` (the all-selectors-`:where()` contract must stay green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(ui): enum combobox listbox skin"
```

---

## Task 5: Docs

**Files:**

- Modify: `apps/website/content/docs/grid/editing.mdx`

- [ ] **Step 1: Update the typed-editors content** — change the dispatch table row for `"enum"` from the text fallback to the combobox, and add an "Enums" subsection documenting the shipped behavior (verify each claim against `EnumCellEditor.tsx` before writing): the cell opens a combobox seeded with the current option's label; typing filters the list (substring over label and value); ArrowUp/Down move the highlight; `Enter` commits the highlighted option and moves down, `Tab` commits it and moves right, clicking an option commits in place; it is **strict** — text matching no option is rejected with "Pick an option", and clicking away (blur) reverts rather than leaving an error open; an `enum` column **without** `options` behaves as a plain text column; `renderEditor` remains the escape hatch for creatable/multi-select comboboxes. Leave the `"date"` row as the text fallback (sub-project 3).

- [ ] **Step 2: Format + build**

Run: `pnpm exec prettier --write apps/website/content/docs/grid/editing.mdx && pnpm --filter @pretable/app-website build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs(website): enum combobox editor"
```

---

## Task 6: Full verification

- [ ] **Step 1:** `pnpm -r --filter './packages/*' test` → PASS
- [ ] **Step 2:** `pnpm typecheck` → PASS
- [ ] **Step 3:** `pnpm lint` → PASS
- [ ] **Step 4:** `pnpm format` → PASS (prettier-write anything flagged, fold into Step 8)
- [ ] **Step 5:** `pnpm api:check` → exit 0 (no public-surface change expected — editors stay internal; if it fails, run `pnpm api` in a clean env and commit)
- [ ] **Step 6:** `pnpm lint:packaging` → PASS (the new `react-dom` peer dep)
- [ ] **Step 7:** `pnpm --filter @pretable/app-website build` → PASS
- [ ] **Step 8:** `git add -A && git commit -m "chore: enum combobox — verification fixups"` (only if fixups exist)

---

## Notes for the executor

- **The portal is not optional.** `contain: content` on the grid viewport traps and clips `position: fixed` descendants — measured, not assumed (a fixed `top/left: 200` inside a viewport at page `(120, 80)` resolved to `(321, 281)`). Task 1 fixes this for the already-shipped filter popover as well; do it first so the combobox is built on correct machinery.
- **`setDraft` then `commit` in one handler is safe** — the engine draft is synchronous, so the commit reads what was just written. Don't add React state round-trips.
- **Listbox `onMouseDown` must `preventDefault`** — otherwise clicking an option blurs the input and the blur handler commits/reverts before the click lands. This is the same class of bug the number steppers hit in sub-project 1.
- `pretable-surface.tsx` is ~2400 lines; this sub-project shouldn't need to touch it at all. If you think you do, STOP and report.
- Editors stay **internal** — nothing new in `public_api.ts`, so `api:check` should be unaffected.
- Env gotchas: the `pyenv: cannot rehash` line on every shell is harmless noise; if a run fails with an esbuild error, relink `ESB=$(ls -d node_modules/.pnpm/esbuild@*/node_modules/esbuild | head -1); rm -rf node_modules/esbuild; ln -s "${ESB#node_modules/}" node_modules/esbuild`.
- Prettier-format every file you touch — the repo's `format` gate is required and has tripped on test files in each prior sub-project.
