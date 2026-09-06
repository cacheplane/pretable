# Components SP2: Listbox and PretableSelect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the grid's four native `<select>`s with `PretableSelect`, a select-only combobox on the SP1 contract, built on a `Listbox` primitive extracted from the enum cell editor — with no trigger pixel moving and no test losing a claim.

**Architecture:** `components/listbox.tsx` holds the shared list (`Listbox`: portalled `ul[role=listbox]` placed by `menuPopoverStyle`, active-option scroll, outside-click close) and the shared keyboard (`useListboxKeys`: arrows/Home/End with wrap and disabled-skip, 500 ms typeahead, Enter/Space commit, Escape/Tab close, open-on-key). `EnumCellEditor` renders `Listbox` and keeps its filtering `<input>`. `components/select.tsx` is `PretableSelect`: a `button[role=combobox]` trigger carrying `data-pretable-select` / `-site` / `-value`. `PretableComponents` gains a `Select` slot. The four sites migrate keeping their `data-pretable-*` attributes; their CSS rules, which today select by element type (`… select`), are rewritten onto those attributes; test drivers move from native-select semantics (`fireEvent.change`, `.value`, `toHaveValue`, `selectOption`) to one `chooseOption` helper per layer and `data-pretable-value` assertions.

**Tech Stack:** React 18/19 (`forwardRef`), TypeScript, vitest + testing-library (jsdom), Playwright (website e2e + bench), api-extractor, changesets. Vanilla CSS in `packages/*`.

**Spec:** `docs/superpowers/specs/2026-09-05-components-sp2-select-design.md`. SP1's contract and traps: `docs/superpowers/specs/2026-09-04-components-sp1-button-design.md` and the memory note `project-components-kit-sp1`.

**Repo rules that bite here:**

- Run every verification from the **repo root**. `pnpm bench:e2e` is a separate Playwright project — run it. `pnpm build` before `pnpm api`. Only ONE agent may build at a time (concurrent builds produce phantom `Cannot find module` / missing-`dist` failures).
- Mutation-check every guard, and record it in the commit message. Revert a probe by re-editing, never `git checkout -- file` (it wipes all uncommitted work in that file).
- The build uses the classic JSX runtime: keep the `createElement` import in every `.tsx`.
- `usePretableComponents()` is the FIRST statement of a component body. Imports go in each file's sorted relative-import position.
- Never `git stash`; never touch `~/repos/pretable`.
- Commit attribution: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

**Create**

| file | responsibility |
| --- | --- |
| `packages/react/src/components/listbox.tsx` | `ListboxOption`, `Listbox` (the rendered portalled list), `useListboxKeys` (the trigger keyboard) — internal |
| `packages/react/src/components/select.tsx` | `PretableSelect`, `PretableSelectProps`, `PretableSelectOption` — public |
| `packages/react/src/__tests__/components-listbox.test.tsx` | the primitive's behaviour |
| `packages/react/src/__tests__/components-select.test.tsx` | the Select's behaviour |
| `packages/react/src/__tests__/select-helpers.ts` | `chooseOption`, `readOptions` for jsdom tests (not a test file) |
| `type-tests/react/components-select.types.tsx` | the compile-time contract |

**Modify**

| file | change |
| --- | --- |
| `packages/react/src/editors/EnumCellEditor.tsx` | render `Listbox`; navigation through `useListboxKeys`; filtering kept |
| `packages/react/src/components/button.tsx` | `PretableBuiltInButtonSite` gains four select sites |
| `packages/react/src/components/context.ts` | `Select` slot; resolution; `PretableSelectComponent` |
| `packages/react/src/filter-menu/FilterMenu.tsx` | operator `<select>` → `Select` (ref kept) |
| `packages/react/src/tool-panel/filters/FilterRow.tsx` | column + operator `<select>` → `Select` |
| `packages/react/src/tool-panel/grouping/GroupingSection.tsx` | aggregate `<select>` → `Select`, gains `data-pretable-aggregate` |
| `packages/react/src/__tests__/{filter-builder,filter-menu,filter-menu-surface,tool-panel-aggregates-picker,components-override,components-button}.test.tsx` | drivers → helpers; slot tests |
| `packages/ui/grid.css` | trigger rules; list rules renamed; site rules rewritten onto attributes; forced colours |
| `packages/ui/src/__tests__/css-cascade.test.ts` | select sites in the constants/OWN; kit-trigger guard; listbox guard |
| `packages/react/src/public_api.ts`, `packages/react/react.api.md` | exports |
| `apps/website/e2e/helpers.ts`, `apps/website/e2e/tool-panel.spec.ts`, `apps/website/e2e/components.spec.ts`, `apps/website/app/fixtures/components/page.tsx` | e2e helper; driver migration; Select proof |
| `apps/website/content/docs/grid/components.mdx`, `filtering.mdx`, `tool-panel.mdx`, `apps/website/lib/docs/__tests__/docs-api-surface.test.ts` | Select section; three sentences; registrations |
| `.changeset/components-sp2-select.md` | minor react, patch ui |

---

### Task 1: Record the four trigger boxes before anything moves

**Files:**
- Create (scratch, not committed): `<scratchpad>/measure-selects.mjs`
- Output: `<scratchpad>/selects-before.json`

- [ ] **Step 1: Build and serve**

```bash
pnpm build && (cd apps/website && pnpm exec next start -p 3117 > /tmp/pt-server.log 2>&1 &) && sleep 6 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3117/
```
Expected: last line `200`.

- [ ] **Step 2: Write the script**

```js
// <scratchpad>/measure-selects.mjs — run from apps/website
import { chromium } from "@playwright/test";
import fs from "node:fs";

const OUT = process.argv[2];
const PROPS = [
  "display", "alignItems", "justifyContent", "width", "height",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderTopColor", "borderRadius", "backgroundColor",
  "color", "fontSize", "fontFamily", "lineHeight", "cursor", "flex",
  "minWidth", "boxSizing",
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const read = (selector) =>
  page.evaluate(({ selector, PROPS }) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const at = (s) => Object.fromEntries(PROPS.map((p) => [p, s[p]]));
    const rest = at(getComputedStyle(el));
    el.focus();
    const f = getComputedStyle(el);
    const focus = { outline: f.outline, outlineOffset: f.outlineOffset };
    el.blur();
    const r = el.getBoundingClientRect();
    return { rest, focus, box: { w: Math.round(r.width), h: Math.round(r.height) } };
  }, { selector, PROPS });

const result = {};
await page.goto("http://localhost:3117/", { waitUntil: "networkidle" });
await page.waitForSelector('[data-pretable-hydrated="true"]');
const calm = page.getByRole("button", { name: /calm/i });
if (await calm.count()) await calm.first().click();
await page.hover("[data-pretable-header-row]");
await page.locator("[data-pretable-filter-funnel]").first().click();
result["filter-operator"] = await read("[data-pretable-filter-operator]");
await page.keyboard.press("Escape");
await page.locator("[data-pretable-tool-tab]").nth(1).click();
await page.locator("[data-pretable-filter-add]").first().click();
result["filter-row-column"] = await read("[data-pretable-filter-row-column]");
result["filter-row-operator"] = await read("[data-pretable-filter-row-operator]");

await page.goto("http://localhost:3117/fixtures/grouping", { waitUntil: "networkidle" });
await page.waitForSelector('[data-pretable-hydrated="true"]');
await page.locator("[data-pretable-tool-tab]").nth(2).click();
result["aggregate"] = await read("[data-pretable-aggregate-row] select");

fs.writeFileSync(OUT, JSON.stringify(result, null, 1));
const missing = Object.entries(result).filter(([, v]) => v === null).map(([k]) => k);
console.log(missing.length ? `MISSING: ${missing.join(", ")}` : "all 4 pickers measured");
await browser.close();
```

Note for Task 12: after migration the aggregate picker is no longer a `select` element; the re-measure run substitutes `[data-pretable-aggregate-row] [data-pretable-aggregate]` for that one selector (the script accepts an `AFTER=1` env: `process.env.AFTER ? "[data-pretable-aggregate]" : "[data-pretable-aggregate-row] select"`). Add that ternary now so the script is otherwise identical in both runs.

- [ ] **Step 3: Baseline**

```bash
cp <scratchpad>/measure-selects.mjs apps/website/measure.tmp.mjs && (cd apps/website && node measure.tmp.mjs <scratchpad>/selects-before.json); rm -f apps/website/measure.tmp.mjs
```
Expected: `all 4 pickers measured`. Fix a missing site's navigation before continuing; a baseline with a hole proves nothing.

- [ ] **Step 4: Stop the server**

```bash
pkill -f "next start -p 3117"
```
No commit.

---

### Task 2: The `Listbox` primitive and `useListboxKeys`

**Files:**
- Create: `packages/react/src/components/listbox.tsx`
- Test: `packages/react/src/__tests__/components-listbox.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// packages/react/src/__tests__/components-listbox.test.tsx
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { createElement, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  Listbox,
  useListboxKeys,
  type ListboxOption,
} from "../components/listbox";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const OPTIONS: readonly ListboxOption[] = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "custom", label: "Custom", disabled: true },
  { value: "endsWith", label: "ends with" },
];
const RECT = { top: 10, left: 20, bottom: 30, right: 120, width: 100, height: 20, x: 20, y: 10, toJSON: () => ({}) } as DOMRect;

describe("Listbox", () => {
  test("renders the ARIA list from data, portalled to body, placed at the anchor", () => {
    const onSelect = vi.fn();
    render(
      <Listbox id="lb" options={OPTIONS} value="equals" activeIndex={0} anchor={RECT} onSelect={onSelect} onClose={() => {}} />,
    );
    const list = document.querySelector("[data-pretable-listbox]")!;
    expect(list.parentElement).toBe(document.body);
    expect(list).toHaveAttribute("role", "listbox");
    expect(list).toHaveAttribute("id", "lb");
    expect((list as HTMLElement).style.position).toBe("fixed");
    const options = list.querySelectorAll("[data-pretable-option]");
    expect(options).toHaveLength(4);
    expect(options[0]).toHaveAttribute("id", "lb-0");
    expect(options[0]).toHaveAttribute("role", "option");
    expect(options[0]).toHaveAttribute("data-value", "contains");
    // aria-selected is the COMMITTED value, not the highlight.
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    expect(options[2]).toHaveAttribute("aria-disabled", "true");
  });

  test("clicking an option selects it; a disabled option is inert", () => {
    const onSelect = vi.fn();
    render(<Listbox id="lb" options={OPTIONS} value={null} activeIndex={-1} anchor={RECT} onSelect={onSelect} onClose={() => {}} />);
    fireEvent.click(document.querySelector('[data-pretable-option][data-value="endsWith"]')!);
    expect(onSelect).toHaveBeenCalledWith("endsWith");
    fireEvent.click(document.querySelector('[data-pretable-option][data-value="custom"]')!);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test("renders nothing for an empty list, not a bare box", () => {
    render(<Listbox id="lb" options={[]} value={null} activeIndex={-1} anchor={RECT} onSelect={() => {}} onClose={() => {}} />);
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
  });

  test("an outside pointerdown closes; one inside does not", () => {
    const onClose = vi.fn();
    render(<Listbox id="lb" options={OPTIONS} value={null} activeIndex={0} anchor={RECT} onSelect={() => {}} onClose={onClose} />);
    fireEvent.pointerDown(document.querySelector("[data-pretable-option]")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("the active option is scrolled into view when the index changes", () => {
    const scrolled: string[] = [];
    Element.prototype.scrollIntoView = function () {
      scrolled.push((this as HTMLElement).id);
    };
    function Host() {
      const [i, setI] = useState(0);
      return (
        <>
          <button onClick={() => setI(3)}>go</button>
          <Listbox id="lb" options={OPTIONS} value={null} activeIndex={i} anchor={RECT} onSelect={() => {}} onClose={() => {}} />
        </>
      );
    }
    const view = render(<Host />);
    fireEvent.click(view.getByText("go"));
    expect(scrolled.at(-1)).toBe("lb-3");
  });
});

describe("useListboxKeys", () => {
  const key = (k: string) => ({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() }) as unknown as React.KeyboardEvent;

  function setup(open = true) {
    const onOpen = vi.fn();
    const onCommit = vi.fn();
    const onClose = vi.fn();
    const hook = renderHook(() =>
      useListboxKeys({ options: OPTIONS, open, initialIndex: 0, onOpen, onCommit, onClose }),
    );
    return { hook, onOpen, onCommit, onClose };
  }

  test("ArrowDown/ArrowUp move with wrap and skip a disabled option", () => {
    const { hook } = setup();
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(1);
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(3); // skipped "custom"
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    expect(hook.result.current.activeIndex).toBe(0); // wrapped
    act(() => hook.result.current.onKeyDown(key("ArrowUp")));
    expect(hook.result.current.activeIndex).toBe(3);
  });

  test("Home and End jump to the first and last enabled option", () => {
    const { hook } = setup();
    act(() => hook.result.current.onKeyDown(key("End")));
    expect(hook.result.current.activeIndex).toBe(3);
    act(() => hook.result.current.onKeyDown(key("Home")));
    expect(hook.result.current.activeIndex).toBe(0);
  });

  test("typeahead matches a label prefix and resets after 500ms", () => {
    vi.useFakeTimers();
    const { hook } = setup();
    act(() => hook.result.current.onKeyDown(key("e")));
    expect(hook.result.current.activeIndex).toBe(1); // "equals"
    act(() => hook.result.current.onKeyDown(key("n")));
    expect(hook.result.current.activeIndex).toBe(3); // "en…" → "ends with"
    act(() => vi.advanceTimersByTime(600));
    act(() => hook.result.current.onKeyDown(key("c")));
    expect(hook.result.current.activeIndex).toBe(0); // buffer reset: "c" → "contains" (Custom is disabled)
  });

  test("Enter and Space commit the active option; Escape and Tab close", () => {
    const { hook, onCommit, onClose } = setup();
    act(() => hook.result.current.onKeyDown(key("ArrowDown")));
    const enter = key("Enter");
    act(() => hook.result.current.onKeyDown(enter));
    expect(onCommit).toHaveBeenCalledWith("equals");
    expect(enter.preventDefault).toHaveBeenCalled();
    act(() => hook.result.current.onKeyDown(key(" ")));
    expect(onCommit).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.onKeyDown(key("Escape")));
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: true });
    const tab = key("Tab");
    act(() => hook.result.current.onKeyDown(tab));
    expect(onClose).toHaveBeenCalledWith({ restoreFocus: false });
    expect(tab.preventDefault).not.toHaveBeenCalled(); // Tab still moves
  });

  test("on a closed trigger, the navigation keys open rather than move", () => {
    const { hook, onOpen } = setup(false);
    for (const k of ["ArrowDown", "ArrowUp", "Enter", " "]) {
      act(() => hook.result.current.onKeyDown(key(k)));
    }
    expect(onOpen).toHaveBeenCalledTimes(4);
    expect(hook.result.current.activeIndex).toBe(0);
  });
});
```

- [ ] **Step 2: Run to see them fail**

```bash
cd packages/react && pnpm exec vitest run --environment jsdom src/__tests__/components-listbox.test.tsx; cd ../..
```
Expected: FAIL — `Cannot find module '../components/listbox'`.

- [ ] **Step 3: Write the primitive**

```tsx
// packages/react/src/components/listbox.tsx
/**
 * The kit's one list: what a select-only combobox and the enum cell editor
 * both pop open. Two pieces with two responsibilities, so each trigger keeps
 * its own shape:
 *
 * - `Listbox` RENDERS the portalled `role="listbox"` from data the trigger
 *   owns — the ARIA markup lives here and nowhere else.
 * - `useListboxKeys` is the trigger's KEYBOARD: arrows/Home/End with wrap and
 *   disabled-skip, typeahead, Enter/Space to commit, Escape/Tab to close, and
 *   the navigation keys opening a closed trigger — the native <select>
 *   contract a keyboard user expects.
 *
 * Portalled for the standing reason: the grid viewport's `contain: content`
 * would clip a fixed popover. Placed by `menuPopoverStyle`, so a list clamps
 * against the viewport exactly as the menus do.
 */
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { menuPopoverStyle } from "../overlay/popover-position";
import { OverlayPortal } from "../overlay/OverlayPortal";

/** One entry in a list. `disabled` is skipped by the keyboard and inert to click. */
export interface ListboxOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

/** How long two keystrokes stay one typeahead query. The native control's feel. */
const TYPEAHEAD_RESET_MS = 500;

/** Text for typeahead: a string label as is, a node by its rendered text. */
function labelText(label: ReactNode): string {
  if (typeof label === "string") return label;
  if (typeof label === "number") return String(label);
  return "";
}

export interface ListboxProps {
  /** The trigger's `aria-controls` target; option ids are `${id}-${index}`. */
  id: string;
  options: readonly ListboxOption[];
  /** The committed value — `aria-selected` — or null. */
  value: string | null;
  /** The roving highlight; -1 for none. Owned by the trigger via the hook. */
  activeIndex: number;
  /** The trigger's rect; the list is placed against it. */
  anchor: DOMRect;
  "aria-label"?: string;
  onSelect: (value: string) => void;
  /** Outside pointerdown. No focus return: the press chose a new target. */
  onClose: () => void;
  /** Extra attributes for the `<ul>` — a site's own `data-pretable-*`. */
  listProps?: Record<`data-${string}`, string>;
}

export function Listbox({
  id,
  options,
  value,
  activeIndex,
  anchor,
  "aria-label": ariaLabel,
  onSelect,
  onClose,
  listProps,
}: ListboxProps): ReactElement | null {
  const rootRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && !root.contains(e.target)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  useEffect(() => {
    if (activeIndex < 0) return;
    rootRef.current
      ?.querySelector<HTMLElement>(`[id="${id}-${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [id, activeIndex]);

  // An empty list is not a list: no bare box (the enum editor's rule).
  if (options.length === 0) return null;

  return (
    <OverlayPortal>
      <ul
        {...listProps}
        ref={rootRef}
        id={id}
        role="listbox"
        aria-label={ariaLabel}
        data-pretable-listbox=""
        style={menuPopoverStyle(anchor)}
        // Keep focus on the trigger: a blur before the click lands would
        // close (or, in the editor, commit) under the pointer.
        onMouseDown={(e) => e.preventDefault()}
      >
        {options.map((option, i) => (
          <li
            key={option.value}
            id={`${id}-${i}`}
            role="option"
            aria-selected={option.value === value}
            aria-disabled={option.disabled ? true : undefined}
            data-pretable-option=""
            data-value={option.value}
            data-active={i === activeIndex ? "" : undefined}
            onClick={() => {
              if (!option.disabled) onSelect(option.value);
            }}
          >
            {option.label}
          </li>
        ))}
      </ul>
    </OverlayPortal>
  );
}

export interface UseListboxKeysInput {
  options: readonly ListboxOption[];
  /** Whether the list is showing. Closed, the navigation keys OPEN. */
  open: boolean;
  /** Where the highlight starts when the list opens (the current value). */
  initialIndex: number;
  onOpen: () => void;
  onCommit: (value: string) => void;
  onClose: (why: { restoreFocus: boolean }) => void;
}

export interface UseListboxKeysResult {
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  onKeyDown: (event: KeyboardEvent) => void;
}

/** The next enabled index from `from` in `dir`, wrapping; `from` if none. */
function step(options: readonly ListboxOption[], from: number, dir: 1 | -1): number {
  const n = options.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + dir * k + n) % n;
    if (!options[i]?.disabled) return i;
  }
  return from;
}

function edge(options: readonly ListboxOption[], dir: 1 | -1): number {
  const n = options.length;
  for (let k = 0; k < n; k++) {
    const i = dir === 1 ? k : n - 1 - k;
    if (!options[i]?.disabled) return i;
  }
  return -1;
}

export function useListboxKeys({
  options,
  open,
  initialIndex,
  onOpen,
  onCommit,
  onClose,
}: UseListboxKeysInput): UseListboxKeysResult {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const buffer = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-seed the highlight from the value each time the list opens.
  useEffect(() => {
    if (open) setActiveIndex(initialIndex);
  }, [open, initialIndex]);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const { key } = e;
      if (!open) {
        if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
          e.preventDefault();
          onOpen();
        }
        return;
      }
      if (key === "ArrowDown" || key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setActiveIndex((i) => step(options, i < 0 ? -1 : i, key === "ArrowDown" ? 1 : -1));
        return;
      }
      if (key === "Home" || key === "End") {
        e.preventDefault();
        setActiveIndex(edge(options, key === "Home" ? 1 : -1));
        return;
      }
      if (key === "Enter" || key === " ") {
        e.preventDefault();
        e.stopPropagation();
        const option = options[activeIndex];
        if (option && !option.disabled) onCommit(option.value);
        return;
      }
      if (key === "Escape" || key === "Esc") {
        e.preventDefault();
        e.stopPropagation();
        onClose({ restoreFocus: true });
        return;
      }
      if (key === "Tab") {
        onClose({ restoreFocus: false });
        return;
      }
      // Typeahead: one printable character at a time, accumulated for
      // TYPEAHEAD_RESET_MS, matched against the labels' prefixes from the top.
      if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        buffer.current += key.toLowerCase();
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          buffer.current = "";
        }, TYPEAHEAD_RESET_MS);
        const query = buffer.current;
        const hit = options.findIndex(
          (o) => !o.disabled && labelText(o.label).toLowerCase().startsWith(query),
        );
        if (hit >= 0) setActiveIndex(hit);
      }
    },
    [open, options, activeIndex, onOpen, onCommit, onClose],
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return { activeIndex, setActiveIndex, onKeyDown };
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd packages/react && pnpm exec vitest run --environment jsdom src/__tests__/components-listbox.test.tsx; cd ../..
```
Expected: `Tests  10 passed (10)`. If the typeahead test's second press matches "equals" rather than "ends with", the buffer is not accumulating — the findIndex must run against the whole buffer, not the last key.

- [ ] **Step 5: Mutation-check two guards, then commit**

Temporarily make `step` ignore `disabled` → "skip a disabled option" must fail; revert by re-editing. Temporarily drop `e.stopPropagation()` from the Enter branch → no test fails (it is there for the grid's own key handling, covered in Task 5). Record the first in the message.

```bash
npx prettier --write packages/react/src/components/listbox.tsx packages/react/src/__tests__/components-listbox.test.tsx
git add packages/react/src/components/listbox.tsx packages/react/src/__tests__/components-listbox.test.tsx
git commit -m "feat(react): the Listbox primitive and its trigger keyboard

The kit's one list — the portalled role=listbox markup in one place — and
the keyboard both triggers need: arrows with wrap and disabled-skip,
Home/End, 500ms typeahead, Enter/Space, Escape/Tab, and open-on-key for a
closed trigger. Mutation-checked: ignoring disabled in the step fails the
skip test.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The enum editor renders the primitive

**Files:**
- Modify: `packages/react/src/editors/EnumCellEditor.tsx`
- Modify: `packages/ui/grid.css` (`[data-pretable-enum-listbox]`/`[data-pretable-enum-option]` rules → `[data-pretable-listbox]`/`[data-pretable-option]`)
- Test: `packages/react/src/__tests__/enum-cell-editor.test.tsx` must pass **unchanged** (that is the proof)

- [ ] **Step 1: Check what references the two enum attributes**

```bash
grep -rn "data-pretable-enum-listbox\|data-pretable-enum-option" packages apps --include="*.ts" --include="*.tsx" --include="*.css" --include="*.mdx" | grep -v node_modules | grep -v "/dist/"
```
Anything outside `EnumCellEditor.tsx` and `grid.css` (a test, an e2e locator, a docs sentence) keeps working through the passthrough below; list what you found in the commit message.

- [ ] **Step 2: Rewrite the editor's list and keyboard**

Replace the `<OverlayPortal>…</OverlayPortal>` block with:

```tsx
      <Listbox
        id={listId}
        options={visible.map((o) => ({ value: o.value, label: optionLabel(o) }))}
        value={active ? active.value : null}
        activeIndex={index}
        anchor={rect ?? EMPTY_RECT}
        onSelect={(value) => choose(visible.find((o) => o.value === value))}
        onClose={() => {
          // Outside press: the strict combobox reverts unmatched text, as
          // its onBlur does — the blur will fire on its own.
        }}
        listProps={{ "data-pretable-enum-listbox": "" }}
      />
```
with `const EMPTY_RECT = new DOMRect(0, 0, 0, 0);` at module scope guarded for SSR (`typeof DOMRect === "undefined" ? ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect) : new DOMRect(0, 0, 0, 0)`). Before the first measure the list is still rendered (as today) — the `rect ? popoverStyle(rect) : undefined` gap is closed by placing at the empty rect for one frame; keep `useLayoutEffect` measuring as is.

`aria-selected` semantics: today the editor marks the HIGHLIGHT selected (`aria-selected={i === index}`); the primitive marks the committed `value`. Pass `value={active ? active.value : null}` so the rendered `aria-selected` is exactly what it was (the editor has no separate committed value while editing) — the enum test suite asserts on it and must not change. The highlight is `data-active`.

Replace the ArrowDown/ArrowUp branch of the input's `onKeyDown` with the hook: above the return,

```tsx
  const keys = useListboxKeys({
    options: visible.map((o) => ({ value: o.value, label: optionLabel(o) })),
    open: true,
    initialIndex: index,
    onOpen: () => {},
    onCommit: (value) => choose(visible.find((o) => o.value === value), "down"),
    onClose: () => {},
  });
```
and in `onKeyDown`: `if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") { keys.onKeyDown(e); return; }` — then keep the editor's own Enter/Tab branch (it commits with a DIRECTION, which the hook does not know) and its fallthrough to `fieldProps.onKeyDown`. Replace `highlight`/`setHighlight` with `keys.activeIndex`/`keys.setActiveIndex` (the `onChange` handler's `setHighlight(0)` becomes `keys.setActiveIndex(0)`), keeping the clamp `const index = keys.activeIndex < visible.length ? keys.activeIndex : 0;`. Do NOT route the editor's typeahead through the hook — the editor filters by typing; typeahead would fight it. To make that explicit, the hook's printable-character branch must only run when the trigger delegates it; since the editor only forwards the four navigation keys, nothing else reaches the hook.

- [ ] **Step 3: Move the CSS**

In `grid.css`, rename the four enum-list rules' selectors: `[data-pretable-enum-listbox]` → `[data-pretable-listbox]`, `[data-pretable-enum-listbox]:empty` → `[data-pretable-listbox]:empty`, `[data-pretable-enum-option]` → `[data-pretable-option]` (three rules: base, `:hover`, `[aria-selected="true"]`). Add to the list's base rule `line-height: 1.5;` (the portaled-trio-plus-one rule from #580; the guard in Task 7 requires it). Update the comment above them: "the kit's list — the enum editor and PretableSelect both render it". Move this block so it sits in the kit section (after the button rules, before `Multi-sort priority badge`): it is a kit rule now. Then update the `portaled popovers declare the whole inherited trio themselves` guard in `css-cascade.test.ts`: its block regex for `[data-pretable-enum-listbox]` becomes `[data-pretable-listbox]`, and the listbox joins the two blocks that must declare `line-height`.

- [ ] **Step 4: Run — the enum suite unchanged, plus the cascade guards**

```bash
cd packages/react && pnpm exec vitest run --environment jsdom src/__tests__/enum-cell-editor.test.tsx src/__tests__/components-listbox.test.tsx; cd ../..
cd packages/ui && pnpm exec vitest run; cd ../..
pnpm typecheck; echo exit:$?
```
Expected: all pass, `enum-cell-editor.test.tsx` **without any edit** (`git diff --stat -- packages/react/src/__tests__/enum-cell-editor.test.tsx` is empty). If an enum test fails, the extraction changed behaviour — fix the editor/primitive, never the test.

- [ ] **Step 5: Commit**

```bash
npx prettier --write packages/react/src/editors/EnumCellEditor.tsx packages/ui/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git add packages/react/src/editors/EnumCellEditor.tsx packages/ui/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "refactor(react,ui): the enum editor renders the kit Listbox

Its list and its arrow keys come from the primitive; its filtering input,
its direction-aware commit and its strict blur stay its own. The enum
editor suite passes unchanged, which is the proof. The list rules move to
[data-pretable-listbox] / [data-pretable-option] in the kit section; the
editor passes its own attribute through.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `PretableSelect`

**Files:**
- Create: `packages/react/src/components/select.tsx`
- Modify: `packages/react/src/components/button.tsx` (`PretableBuiltInButtonSite` gains `"filter-operator" | "filter-row-column" | "filter-row-operator" | "aggregate"`)
- Test: `packages/react/src/__tests__/components-select.test.tsx`
- Create: `packages/react/src/__tests__/select-helpers.ts`

- [ ] **Step 1: The jsdom helpers every later test uses**

```ts
// packages/react/src/__tests__/select-helpers.ts
import { fireEvent } from "@testing-library/react";

/**
 * Drive a PretableSelect the way a pointer does: open it, click the option.
 * Replaces `fireEvent.change(select, { target: { value } })`, which a
 * button[role=combobox] cannot honour. The list is portalled to body.
 */
export function chooseOption(trigger: HTMLElement, value: string): void {
  fireEvent.click(trigger);
  const option = document.querySelector<HTMLElement>(
    `[data-pretable-listbox] [data-pretable-option][data-value="${value}"]`,
  );
  if (!option) {
    throw new Error(`chooseOption: no option "${value}" in the open list`);
  }
  fireEvent.click(option);
}

/** The option values and labels a PretableSelect offers, read by opening it. */
export function readOptions(trigger: HTMLElement): { values: string[]; labels: string[] } {
  fireEvent.click(trigger);
  const items = Array.from(
    document.querySelectorAll<HTMLElement>("[data-pretable-listbox] [data-pretable-option]"),
  );
  const result = {
    values: items.map((el) => el.getAttribute("data-value") ?? ""),
    labels: items.map((el) => el.textContent ?? ""),
  };
  fireEvent.keyDown(trigger, { key: "Escape" });
  return result;
}

/** The committed value, from the attribute the component writes for exactly this. */
export function selectValue(trigger: HTMLElement): string | null {
  return trigger.getAttribute("data-pretable-value");
}
```

- [ ] **Step 2: Write the failing tests**

```tsx
// packages/react/src/__tests__/components-select.test.tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PretableSelect } from "../components/select";
import { resetDevWarnings } from "../dev-warn";
import { chooseOption, readOptions, selectValue } from "./select-helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  resetDevWarnings();
});

const OPTIONS = [
  { value: "contains", label: "contains" },
  { value: "equals", label: "equals" },
  { value: "custom", label: "Custom", disabled: true },
];

function renderSelect(props: Partial<React.ComponentProps<typeof PretableSelect>> = {}) {
  const onChange = vi.fn();
  const view = render(
    <PretableSelect aria-label="Operator" options={OPTIONS} value="contains" onChange={onChange} site="filter-operator" data-pretable-filter-operator="" {...props} />,
  );
  const trigger = view.getByRole("combobox", { name: props["aria-label"] ?? "Operator" });
  return { view, trigger, onChange };
}

describe("PretableSelect", () => {
  test("is a select-only combobox carrying the kit attributes and the value", () => {
    const { trigger } = renderSelect();
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger).toHaveAttribute("type", "button");
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveAttribute("data-pretable-select", "");
    expect(trigger).toHaveAttribute("data-pretable-site", "filter-operator");
    expect(trigger).toHaveAttribute("data-pretable-filter-operator", "");
    expect(selectValue(trigger)).toBe("contains");
    expect(trigger).toHaveTextContent("contains");
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
  });

  test("opens on click with the current value highlighted, and commits a clicked option", () => {
    const { trigger, onChange } = renderSelect();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const list = document.querySelector("[data-pretable-listbox]")!;
    expect(trigger).toHaveAttribute("aria-controls", list.id);
    expect(trigger).toHaveAttribute("aria-activedescendant", `${list.id}-0`);
    fireEvent.click(list.querySelector('[data-value="equals"]')!);
    expect(onChange).toHaveBeenCalledWith("equals");
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  test("the keyboard opens, moves, commits and closes", () => {
    const { trigger, onChange } = renderSelect();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(trigger).toHaveAttribute("aria-activedescendant", expect.stringMatching(/-1$/));
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("equals");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(trigger, { key: " " });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  test("Tab closes without trapping, and an outside press closes", () => {
    const { trigger } = renderSelect();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("a value absent from the options renders as its own label, not a wrong option", () => {
    // The pruned-operator case: the applied operator is not in the permitted
    // list; a native <select> would silently display its first option.
    const { trigger } = renderSelect({ value: "endsWith" });
    expect(trigger).toHaveTextContent("endsWith");
    expect(selectValue(trigger)).toBe("endsWith");
  });

  test("the helpers drive it: chooseOption commits, readOptions lists", () => {
    const { trigger, onChange } = renderSelect();
    expect(readOptions(trigger)).toEqual({ values: ["contains", "equals", "custom"], labels: ["contains", "equals", "Custom"] });
    chooseOption(trigger, "equals");
    expect(onChange).toHaveBeenCalledWith("equals");
  });

  test("disabled takes the standard treatment and does not open", () => {
    const { trigger } = renderSelect({ disabled: true });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(document.querySelector("[data-pretable-listbox]")).toBeNull();
  });

  test("forwards its ref; className and style pass through", () => {
    const ref = createRef<HTMLButtonElement>();
    const { trigger } = renderSelect({ ref, className: "mine", style: { width: 120 } } as never);
    expect(ref.current).toBe(trigger);
    expect(trigger).toHaveClass("mine");
    expect(trigger.style.width).toBe("120px");
  });

  test("warns in development on an empty accessible name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PretableSelect aria-label="  " options={OPTIONS} value="contains" onChange={() => {}} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/PretableSelect/);
  });
});
```

- [ ] **Step 3: Run to see them fail**

```bash
cd packages/react && pnpm exec vitest run --environment jsdom src/__tests__/components-select.test.tsx; cd ../..
```
Expected: FAIL — `Cannot find module '../components/select'`.

- [ ] **Step 4: Extend the site union and write the component**

In `button.tsx`, add to `PretableBuiltInButtonSite`: `| "filter-operator" | "filter-row-column" | "filter-row-operator" | "aggregate"` with a comment: "the select sites — one vocabulary for every kit control's placement, not a per-component union".

```tsx
// packages/react/src/components/select.tsx
/**
 * A select-only combobox: the kit's answer to the native <select>, whose open
 * list no theme can reach. The trigger is a button carrying
 * role="combobox"; the list is the kit's `Listbox`, portalled and placed
 * against the trigger. Both halves are styled by grid.css through
 * `data-pretable-select` (trigger) and `data-pretable-listbox` /
 * `data-pretable-option` (list), and a site's own attribute still arrives on
 * the trigger through the spread.
 *
 * `data-pretable-value` is written for one reason: a button has no `.value`,
 * and every test that used to read one reads this instead.
 */
import {
  createElement,
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";

import { warnOnce } from "../dev-warn";
import { ChevronDownIcon } from "../icons";
import type { PretableButtonSite } from "./button";
import { Listbox, useListboxKeys, type ListboxOption } from "./listbox";

/**
 * One entry in a {@link PretableSelect}. A `disabled` option is shown, skipped
 * by the keyboard, and inert to click — how the aggregate picker shows a
 * consumer-written custom aggregate it must never write back.
 *
 * @public
 */
export type PretableSelectOption = ListboxOption;

/**
 * Props for {@link PretableSelect}.
 *
 * @public
 */
export interface PretableSelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "value" | "onChange" | "aria-label"
> {
  options: readonly PretableSelectOption[];
  /** The committed value. Absent from `options`, it renders as its own label. */
  value: string;
  onChange: (value: string) => void;
  /**
   * Required. A picker with no accessible name is the icon-button problem
   * again. An empty string warns in development.
   */
  "aria-label": string;
  /** Where in the grid this picker is; lands as `data-pretable-site`. */
  site?: PretableButtonSite;
}

const EMPTY_RECT: DOMRect =
  typeof DOMRect === "undefined"
    ? ({ top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    : new DOMRect(0, 0, 0, 0);

/**
 * A select-only combobox in the grid's own chrome.
 *
 * ```tsx
 * <PretableSelect
 *   aria-label="Filter operator"
 *   options={operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
 *   value={draft.operator}
 *   onChange={(op) => setOperator(op as FilterOperator)}
 * />
 * ```
 *
 * @public
 */
export const PretableSelect = forwardRef<HTMLButtonElement, PretableSelectProps>(
  function PretableSelect(
    { options, value, onChange, "aria-label": ariaLabel, site, disabled, onClick, ...buttonProps },
    ref,
  ): ReactElement {
    if ((ariaLabel ?? "").trim() === "") {
      warnOnce(
        "select-empty-name",
        "[pretable] <PretableSelect> rendered with an empty aria-label. A picker with no accessible name reads as an unnamed button to a screen reader. Name what it chooses, e.g. `Filter operator`.",
      );
    }
    const listId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    useImperativeHandle(ref, () => triggerRef.current as HTMLButtonElement);
    const [open, setOpen] = useState(false);
    const [rect, setRect] = useState<DOMRect>(EMPTY_RECT);

    const selectedIndex = options.findIndex((o) => o.value === value);
    const selected = options[selectedIndex];

    const close = useCallback((why: { restoreFocus: boolean }) => {
      setOpen(false);
      if (why.restoreFocus) triggerRef.current?.focus({ preventScroll: true });
    }, []);
    const commit = useCallback(
      (next: string) => {
        if (next !== value) onChange(next);
        close({ restoreFocus: true });
      },
      [value, onChange, close],
    );
    const openList = useCallback(() => {
      if (disabled) return;
      if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
      setOpen(true);
    }, [disabled]);

    const keys = useListboxKeys({
      options,
      open,
      initialIndex: selectedIndex >= 0 ? selectedIndex : 0,
      onOpen: openList,
      onCommit: commit,
      onClose: close,
    });

    // The list is `position: fixed` in a portal: re-anchor when anything
    // scrolls or resizes while it is open (capture catches the grid's own
    // scrollers, which do not bubble).
    useLayoutEffect(() => {
      if (!open) return;
      const measure = () => {
        if (triggerRef.current) setRect(triggerRef.current.getBoundingClientRect());
      };
      window.addEventListener("scroll", measure, true);
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("scroll", measure, true);
        window.removeEventListener("resize", measure);
      };
    }, [open]);

    return (
      <>
        <button
          {...buttonProps}
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && keys.activeIndex >= 0 ? `${listId}-${keys.activeIndex}` : undefined}
          disabled={disabled}
          data-pretable-select=""
          data-pretable-site={site}
          data-pretable-value={value}
          onClick={(e) => {
            onClick?.(e);
            if (e.defaultPrevented) return;
            if (open) close({ restoreFocus: true });
            else openList();
          }}
          onKeyDown={(e) => {
            buttonProps.onKeyDown?.(e);
            if (e.defaultPrevented) return;
            keys.onKeyDown(e);
          }}
        >
          <span data-pretable-select-label="">{selected ? selected.label : value}</span>
          <ChevronDownIcon />
        </button>
        {open ? (
          <Listbox
            id={listId}
            options={options}
            value={value}
            activeIndex={keys.activeIndex}
            anchor={rect}
            onSelect={commit}
            onClose={() => close({ restoreFocus: false })}
          />
        ) : null}
      </>
    );
  },
);
```

Note: `onKeyDown` is in `buttonProps` (not destructured) — the component reads `buttonProps.onKeyDown` then spreads it too; to avoid attaching it twice, destructure `onKeyDown` alongside `onClick`. Do that.

- [ ] **Step 5: Run the tests to see them pass**

```bash
cd packages/react && pnpm exec vitest run --environment jsdom src/__tests__/components-select.test.tsx; cd ../..
pnpm typecheck; echo exit:$?
```
Expected: `Tests  9 passed (9)`, typecheck 0. If `toHaveFocus()` fails after a click-commit in jsdom, `focus({ preventScroll })` is fine in jsdom; check that `close` runs after `onChange` (it does) and that the trigger is still mounted.

- [ ] **Step 6: Commit**

```bash
npx prettier --write packages/react/src/components/select.tsx packages/react/src/components/button.tsx packages/react/src/__tests__/components-select.test.tsx packages/react/src/__tests__/select-helpers.ts
git add packages/react/src/components/select.tsx packages/react/src/components/button.tsx packages/react/src/__tests__/components-select.test.tsx packages/react/src/__tests__/select-helpers.ts
git commit -m "feat(react): PretableSelect, a select-only combobox on the kit Listbox

A button[role=combobox] trigger carrying data-pretable-select / -site /
-value and the kit list beneath it; opens on click and on the navigation
keys, commits on option click or Enter/Space, closes on Escape (focus
returned), Tab and outside press. A value absent from the options renders
as its own label — the pruned-operator case. jsdom helpers replace the
native-select drivers every later test used.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The type contract

**Files:**
- Create: `type-tests/react/components-select.types.tsx` (imports from the SOURCE path until Task 9 switches it, with the same `TEMPORARY` marker SP1 used)

- [ ] **Step 1: Write it**

```tsx
// type-tests/react/components-select.types.tsx
// TEMPORARY: imported from source because `@pretable/react` does not export
// these yet. Task 9 of the SP2 plan switches this to the package.
import {
  PretableSelect,
  type PretableSelectOption,
  type PretableSelectProps,
} from "../../packages/react/src/components/select";
import type { PretableButtonSite } from "../../packages/react/src/components/button";
import type { Equal, Expect } from "../shared/assert";

const options: readonly PretableSelectOption[] = [{ value: "a", label: "A" }, { value: "b", label: "B", disabled: true }];

// The name is required.
// @ts-expect-error — aria-label is required
<PretableSelect options={options} value="a" onChange={() => {}} />;
<PretableSelect aria-label="Pick" options={options} value="a" onChange={() => {}} />;

// The value is a string, and onChange hands one back.
// @ts-expect-error — value is a string
<PretableSelect aria-label="Pick" options={options} value={1} onChange={() => {}} />;
<PretableSelect aria-label="Pick" options={options} value="a" onChange={(v) => { const s: string = v; void s; }} />;

// No `type`, no native `onChange`/`value` shapes leak through.
// @ts-expect-error — the element is always type="button"
<PretableSelect aria-label="Pick" options={options} value="a" onChange={() => {}} type="submit" />;

// The four select sites are in the kit's vocabulary, and it stays open.
<PretableSelect aria-label="Pick" options={options} value="a" onChange={() => {}} site="filter-operator" />;
<PretableSelect aria-label="Pick" options={options} value="a" onChange={() => {}} site="my-app-picker" />;
export type SelectSitesAreBuiltIn = Expect<
  Equal<Extract<PretableButtonSite, "aggregate" | "filter-row-column">, "aggregate" | "filter-row-column">
>;

// Refs and native attributes flow through.
const ref = { current: null as HTMLButtonElement | null };
<PretableSelect ref={ref} aria-label="Pick" options={options} value="a" onChange={() => {}} disabled className="x" />;

export type NameIsRequired = Expect<Equal<PretableSelectProps["aria-label"], string>>;
```

- [ ] **Step 2: Run, then mutation-check one directive**

```bash
pnpm exec tsc -p type-tests/tsconfig.react.json --noEmit; echo exit:$?
```
Expected exit 0. Comment out the `value={1}` directive → tsc must fail (`TS2322`); restore.

- [ ] **Step 3: Commit**

```bash
npx prettier --write type-tests/react/components-select.types.tsx
git add type-tests/react/components-select.types.tsx
git commit -m "test(react): pin the PretableSelect type contract

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The `Select` slot

**Files:**
- Modify: `packages/react/src/components/context.ts`
- Test: append to `packages/react/src/__tests__/components-button.test.tsx`'s `components context` block

- [ ] **Step 1: Write the failing tests** (append inside `describe("components context")`)

```tsx
  test("the Select slot resolves like the other two, and its own change is its own", () => {
    const MySelect = forwardRef<HTMLButtonElement, ComponentProps<typeof PretableSelect>>(
      (props, ref) => <button {...(props as object)} ref={ref} data-mine="" />,
    );
    const { result, rerender } = renderHook(
      ({ components }) => useResolvedComponents(components),
      { initialProps: { components: {} as { Select?: typeof MySelect } } },
    );
    expect(result.current).toBe(DEFAULT_COMPONENTS);
    expect(result.current.Select).toBe(PretableSelect);
    rerender({ components: { Select: MySelect } });
    expect(result.current.Select).toBe(MySelect);
    expect(result.current.Button).toBe(PretableButton);
    const withSelect = result.current;
    rerender({ components: { Select: MySelect } });
    expect(result.current).toBe(withSelect);
    // The four-part edit the SP1 review flagged: the slot must be in the
    // comparison, the defaults, the literal AND the deps. A slot left out of
    // the deps would make this rerender a stale hit.
    rerender({ components: {} });
    expect(result.current).toBe(DEFAULT_COMPONENTS);
  });
```
Add `PretableSelect` to the file's imports (from `../components/select`).

- [ ] **Step 2: Run to see it fail**, then **Step 3: add the slot**

In `context.ts`: import `PretableSelect, type PretableSelectProps` from `./select`; add

```ts
/**
 * The component a `components.Select` replacement must be: it receives
 * {@link PretableSelectProps} and forwards its `ref` to the trigger node —
 * the filter dialog focuses its operator picker on open through that ref.
 *
 * @public
 */
export type PretableSelectComponent = ComponentType<
  PretableSelectProps & RefAttributes<HTMLButtonElement>
>;
```
`PretableComponents` gains `/** Every select-only picker the grid draws; receives {@link PretableSelectProps}. */ readonly Select?: PretableSelectComponent;`; `ResolvedPretableComponents` gains `readonly Select: PretableSelectComponent;`; `DEFAULT_COMPONENTS` gains `Select: PretableSelect`; `useResolvedComponents` reads `const Select = components?.Select ?? DEFAULT_COMPONENTS.Select;`, the identity test adds `&& Select === DEFAULT_COMPONENTS.Select`, the literal becomes `Object.freeze({ Button, IconButton, Select })`, the deps `[Button, IconButton, Select]`.

- [ ] **Step 4: Run, mutation-check the deps, commit**

```bash
cd packages/react && pnpm exec vitest run --environment jsdom src/__tests__/components-button.test.tsx; cd ../..
```
Temporarily drop `Select` from the deps array → the new test must fail on the final `toBe(DEFAULT_COMPONENTS)` or the `MySelect` step; restore by re-editing.

```bash
npx prettier --write packages/react/src/components/context.ts packages/react/src/__tests__/components-button.test.tsx
git add packages/react/src/components/context.ts packages/react/src/__tests__/components-button.test.tsx
git commit -m "feat(react): the Select slot

Comparison, defaults, literal and deps all gain it — the four-part edit —
and the changed-slot test now covers it; mutation-checked by dropping the
dep.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The trigger and list CSS, and the guards

**Files:**
- Modify: `packages/ui/grid.css`
- Modify: `packages/ui/src/__tests__/css-cascade.test.ts`

- [ ] **Step 1: Write the failing guards**

Add after the kit-button guard:

```ts
  test("the kit select trigger carries the field box, and the list its surface", () => {
    const css = strippedCss();
    const trigger = rulesSelecting(css, (s) => s.includes("data-pretable-select]") && !s.includes("::") && !s.includes(":hover") && !s.includes(":focus") && !s.includes(":disabled"));
    expect(trigger.length, "no kit select rule").toBeGreaterThan(0);
    const body = trigger.map((m) => m[2]).join("");
    for (const decl of [
      /display:\s*inline-flex/, /align-items:\s*center/, /justify-content:\s*space-between/,
      /box-sizing:\s*border-box/, /border:\s*1px solid var\(--pretable-rule\)/,
      /border-radius:\s*var\(--pretable-radius-control\)/, /background:\s*var\(--pretable-bg-grid\)/,
      /color:\s*var\(--pretable-text-cell\)/, /font:\s*inherit/, /cursor:\s*pointer/, /text-align:\s*start/,
    ]) expect(body).toMatch(decl);
    // Ring and disabled ink in the state section, like the buttons.
    const state = rulesSelecting(css, (s) => s.includes("data-pretable-select]:focus-visible") || s.includes("data-pretable-select]:disabled")).map((m) => m[2]).join("");
    expect(state).toMatch(/outline:\s*2px solid var\(--pretable-focus-ring\)/);
    expect(state).toMatch(/cursor:\s*default/);
    // The list: the enum editor's surface, now the kit's.
    const list = rulesSelecting(css, (s) => s.includes("data-pretable-listbox]") && !s.includes(":empty")).map((m) => m[2]).join("");
    expect(list).toMatch(/max-height:\s*220px/);
    expect(list).toMatch(/border:\s*1px solid var\(--pretable-rule-strong\)/);
    expect(list).toMatch(/line-height:\s*[^;]+/);
    const selectedOption = rulesSelecting(css, (s) => s.includes('data-pretable-option][aria-selected="true"]')).map((m) => m[2]).join("");
    expect(selectedOption).toMatch(/background:\s*var\(--pretable-bg-selected\)/);
    // No enum-only list rule survives; the editor rides the kit rules.
    expect(rulesSelecting(css, (s) => s.includes("data-pretable-enum-listbox]") || s.includes("data-pretable-enum-option]")).length).toBe(0);
    // Forced colours: the selected option is the system's pair.
    const forced = forcedColorsBlock(css);
    expect(rulesSelecting(forced, (s) => s.includes('data-pretable-option][aria-selected="true"]')).map((m) => m[2]).join("")).toMatch(/background-color:\s*Highlight/);
  });
```
(`forcedColorsBlock` exists from #578.) Then extend the site constants at the top of the file: `const SELECT_SITES = ["filter-operator", "filter-row-column", "filter-row-operator", "aggregate"];` and, in the `a push-button site rule declares only what is its own` guard, add the select sites to its loop with their own owned list and OWN entries:

```ts
    const SELECT_OWNED = [
      /(?:^|[;{\s])display:\s*inline-flex/, /(?:^|[;{\s])border:\s*1px solid var\(--pretable-rule\)/,
      /border-radius:\s*var\(--pretable-radius-control\)/, /(?:^|[;{\s])background:\s*var\(--pretable-bg-grid\)/,
      /(?:^|[;{\s])color:\s*var\(--pretable-text-cell\)/, /(?:^|[;{\s])font:\s*inherit/, /(?:^|[;{\s])cursor:\s*pointer/,
    ];
    // OWN: the dialog's picker is 28px wide-open in a column; the builder's
    // and the aggregate picker are 24px flex items.
    "filter-operator": /block-size:\s*28px/,
    "filter-row-column": /block-size:\s*24px/,
    "filter-row-operator": /block-size:\s*24px/,
    "aggregate": /block-size:\s*24px/,
```
The loop runs `SELECT_OWNED` for select sites (and the shared ring/disabled/hover checks). This guard goes RED now (the site rules still declare the box) and green in Task 8.

- [ ] **Step 2: Add the rules**

In the kit section, after the button rules (before the listbox rules moved there in Task 3):

```css
  /* ---- Kit components: select ------------------------------------------
     The select-only combobox's trigger. It is a FIELD, not a button: the
     rule border, the grid surface, the cell ink, and the label at the start
     with the caret at the end. Sites keep their size and their flex
     participation; the list beneath it is the kit list above. */
  :where([data-pretable-select]) {
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding-inline: 6px;
    border: 1px solid var(--pretable-rule);
    border-radius: var(--pretable-radius-control);
    background: var(--pretable-bg-grid);
    color: var(--pretable-text-cell);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  :where([data-pretable-select-label]) {
    flex: 1 1 auto;
    min-inline-size: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  :where([data-pretable-select]) > [data-pretable-icon] {
    flex: none;
    color: var(--pretable-text-dim);
  }
  :where([data-pretable-option][data-active]) {
    background: var(--pretable-bg-hover);
  }
```
In the `Kit components: state` section add `[data-pretable-select]:focus-visible` to the ring rule's selector list and `[data-pretable-select]:disabled` to the disabled rule's; in the forced-colours block add `:where([data-pretable-option][aria-selected="true"]) { forced-color-adjust: none; background-color: Highlight; color: HighlightText; }` and `[data-pretable-select]:disabled` to the `GrayText` list.

- [ ] **Step 3: Run — kit guard green, site guard red by design**

```bash
cd packages/ui && pnpm exec vitest run; cd ../..
```
Expected: one failure, `a push-button site rule declares only what is its own`, naming a select site. Paste its first line.

- [ ] **Step 4: Commit**

```bash
npx prettier --write packages/ui/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git add packages/ui/grid.css packages/ui/src/__tests__/css-cascade.test.ts
git commit -m "feat(ui): the kit select rules; the site guard learns the four pickers

Trigger box, label ellipsis, caret, active option, ring and disabled in the
state section, Highlight/HighlightText under forced colours. The site
guard is red by design until the pickers' rules collapse.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Migrate the four sites, their CSS, and their jsdom drivers

**Files:**
- Modify: `FilterMenu.tsx`, `FilterRow.tsx`, `GroupingSection.tsx`, `grid.css`, and the four test files named below

- [ ] **Step 1: FilterMenu — the operator picker**

`const selectRef = useRef<HTMLSelectElement>(null);` → `useRef<HTMLButtonElement>(null)`. Extend the existing `const { Button } = usePretableComponents();` to `const { Button, Select } = …`. Replace the `<select …>…</select>` with:

```tsx
        <Select
          ref={selectRef}
          site="filter-operator"
          data-pretable-filter-operator=""
          aria-label="Filter operator"
          options={operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
          value={draft.operator}
          onChange={(op) => onOperatorChange(op as FilterOperator)}
        />
```
Keep the comment about `menuOperators` and the pruned operator above it.

- [ ] **Step 2: FilterRow — column and operator**

`const { IconButton, Select } = usePretableComponents();` (extend the existing line). Column:

```tsx
      <Select
        site="filter-row-column"
        data-pretable-filter-row-column=""
        aria-label={messages.toolPanelFilterColumnLabel({ hidden, groupedAway, groupedMarker: messages.toolPanelColumnGroupedMarker() })}
        options={columns.map((c) => ({ value: c.id, label: c.label }))}
        value={columnId}
        onChange={onColumnChange}
      />
```
(keep the SC 1.4.1 comment). Operator:

```tsx
      <Select
        site="filter-row-operator"
        data-pretable-filter-row-operator=""
        aria-label={messages.toolPanelFilterOperatorLabel()}
        options={operators.map((op) => ({ value: op, label: OPERATOR_LABELS[op] }))}
        value={draft.operator}
        onChange={(op) => onOperatorChange(op as FilterOperator)}
      />
```
(keep the "not a surface message" comment).

- [ ] **Step 3: GroupingSection — the aggregate picker**

`const { Button, IconButton, Select } = usePretableComponents();`. Replace the `<select …>…</select>` with:

```tsx
                <Select
                  site="aggregate"
                  data-pretable-aggregate=""
                  aria-label={messages.toolPanelAggregateColumnLabel({ label: column.label })}
                  options={[
                    { value: DEFAULT_OPTION, label: messages.toolPanelAggregateDefaultOption({ label: declaredFace }) },
                    { value: NONE_OPTION, label: messages.toolPanelAggregateNoneOption() },
                    ...builtins.map((name) => ({ value: name, label: builtinLabel(name) })),
                    // A consumer CAN write an aggregator object through the
                    // handle. The picker reflects it honestly: one extra
                    // selected `Custom` entry, present only while that state
                    // holds, disabled so it is never written back.
                    ...(selected === CUSTOM_OPTION
                      ? [{ value: CUSTOM_OPTION, label: messages.toolPanelAggregateCustomLabel(), disabled: true }]
                      : []),
                  ]}
                  value={selected}
                  onChange={(value) => {
                    // The closed vocabulary IS the validation … (keep the comment)
                    if (value === DEFAULT_OPTION) grid.setColumnAggregate(column.id, undefined);
                    else if (value === NONE_OPTION) grid.setColumnAggregate(column.id, null);
                    else if ((builtins as readonly string[]).includes(value)) grid.setColumnAggregate(column.id, value);
                  }}
                />
```

- [ ] **Step 4: CSS — rewrite the type-selected site rules onto attributes**

The builder rule `:where([data-pretable-filter-row-column], [data-pretable-filter-row-operator], input[data-pretable-filter-row-value], [data-pretable-aggregate-row] select)` — the two pickers already select by attribute; replace `[data-pretable-aggregate-row] select` with `[data-pretable-aggregate]`. Then split the rule: the `input[data-pretable-filter-row-value]` keeps the full field box (it is an input, not a kit control); the three pickers keep ONLY `flex: 1 1 auto; min-inline-size: 24px; block-size: 24px;` — write them as their own rule directly after it, with a comment. The dialog rule `:where([data-pretable-filter-menu]) select, … input …` — remove `select` from that list and add a rule `:where([data-pretable-filter-operator]) { width: 100%; block-size: 28px; padding-inline: 7px; }` with a comment (28px: the dialog's roomier padding; 7px matches its inputs). Focus lists: replace `[data-pretable-filter-menu] select:focus-visible` and `[data-pretable-filter-row-column]:focus-visible, [data-pretable-filter-row-operator]:focus-visible, [data-pretable-aggregate-row] select:focus-visible` entries — remove them (the kit state rule rings `[data-pretable-select]`); keep the input entries. Search the file for any other `select` type selector (`grep -n "select" packages/ui/grid.css`) and treat each the same way.

- [ ] **Step 5: Migrate the jsdom drivers**

- `filter-builder.test.tsx`: `operatorSelect`/`columnSelect` query `[data-pretable-filter-row-operator]`/`[data-pretable-filter-row-column]` (drop the `select` tag, type `HTMLElement`); every `fireEvent.change(operatorSelect(c), { target: { value: v } })` → `chooseOption(operatorSelect(c), v)`; every `.value` read → `selectValue(...)`; any `[...select.options]` read → `readOptions(...)`. Import from `./select-helpers`.
- `filter-menu.test.tsx`: `getByRole("combobox", { name: "Filter operator" })` still resolves (the trigger IS a combobox); `select.value` → `selectValue(select)`; `fireEvent.change(select, …)` → `chooseOption(select, …)`; `toHaveFocus()` on open stays (the ref focuses the trigger).
- `filter-menu-surface.test.tsx`: `select.value` → `selectValue`; `select.options[select.selectedIndex]?.value` → `selectValue`; `Array.from(select.options).map(o => o.value)` → `readOptions(select).values`.
- `tool-panel-aggregates-picker.test.tsx`: the picker query loses its `select` tag (`[data-pretable-aggregate-row] [data-pretable-aggregate]`); `optionValues`/`optionLabels` → `readOptions(picker).values/.labels`; `picker.value` → `selectValue(picker)`; `fireEvent.change(picker, {target:{value}})` → `chooseOption(picker, value)`; the "custom" entry assertions read `aria-disabled` on the option rather than expecting it selectable.
- `components-override.test.tsx`: add `Select` to the 12-site pin tests (four more `expectKit(...)` calls with kind `"select"`, adapting the helper to accept `"select"` → `data-pretable-select`), and one override test: `components={{ Select: MySelect }}` replaces the dialog's operator picker (portalled) and the builder's column picker.

- [ ] **Step 6: Run everything the migration touches**

```bash
cd packages/react && pnpm exec vitest run --environment jsdom src/__tests__/filter-builder.test.tsx src/__tests__/filter-menu.test.tsx src/__tests__/filter-menu-surface.test.tsx src/__tests__/tool-panel-aggregates-picker.test.tsx src/__tests__/components-override.test.tsx src/__tests__/tool-panel.test.tsx src/__tests__/grouping-options.test.tsx src/__tests__/grouping-aggregate-overrides.test.tsx; cd ../..
cd packages/ui && pnpm exec vitest run; cd ../..
pnpm typecheck && pnpm lint; echo exit:$?
```
Expected: all green, including the site guard from Task 7. A test that fails on a CLAIM (not a driver) is a behaviour change — investigate the site, not the test.

- [ ] **Step 7: Mutation-check and commit**

Add `border: 1px solid var(--pretable-rule);` back to the aggregate picker's site rule → site guard fails; revert by re-editing.

```bash
pnpm format:write >/dev/null; git add -A packages/react/src packages/ui
git commit -m "refactor(react,ui): the four pickers render the kit Select

Filter dialog operator (ref kept — the dialog focuses it on open), the
builder's column and operator, the aggregate picker (custom entry now a
disabled option, never written). Every site keeps its attribute; the
aggregate picker gains one. Site rules that selected by element type are
rewritten onto the attributes and keep only size and flex participation.
Test drivers move to chooseOption / readOptions / selectValue; no claim
changed. Site guard mutation-checked.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Public API and the type test against the package

- [ ] **Step 1:** In `public_api.ts` after the button exports: `export { PretableSelect } from "./components/select"; export type { PretableSelectOption, PretableSelectProps } from "./components/select"; export type { PretableSelectComponent } from "./components/context";` (add it to the existing context type-export block).
- [ ] **Step 2:** In `type-tests/react/components-select.types.tsx` drop the TEMPORARY comment; import from `"@pretable/react"` (both imports); append `const components: PretableComponents = { Select: PretableSelect }; void components;` with `type PretableComponents` imported.
- [ ] **Step 3:** `pnpm build && pnpm api && pnpm typecheck:public && pnpm api:check; echo exit:$?` — expect 0; only `packages/react/react.api.md` changes; no `ae-forgotten-export`; no `(undocumented)` on the new symbols.
- [ ] **Step 4:** Commit `feat(react): export PretableSelect and the Select slot type`.

---

### Task 10: Re-measure the four trigger boxes

- [ ] **Step 1:** `pnpm build`, serve on 3117, run the Task 1 script with `AFTER=1` into `<scratchpad>/selects-after.json`; expect `all 4 pickers measured`.
- [ ] **Step 2:** Diff with the Task 12 script from SP1 (same flatten/compare). Classify: (a) rendered-equal — `display block→inline-flex/flex` with unchanged box; `justifyContent normal→space-between` with unchanged box; `cursor default→pointer` (a select had `default`? if the baseline says `default`, this IS a deliberate change: record it); (b) deliberate — the product focus ring (a native select wore the UA ring), `text-align start`; (c) anything else — `box.w/h`, padding, border colour, background, font — is a finding: restore the lost declaration to the site rule (sites may keep size/flex/padding-inline/width) and re-measure. Note the width of a `<select>` was content-sized by its widest OPTION; the trigger is sized by its current LABEL — a narrower box for the dialog's picker (`width: 100%`) is unaffected, but the builder's pickers are `flex: 1 1 auto` and share the row, so their widths may legitimately differ by a few px when the row re-flows; treat a builder-picker width change as (a) only if the row's total width is unchanged and each picker still has `flex: 1 1 auto`.
- [ ] **Step 3:** Stop the server; commit only if a rule was corrected.

---

### Task 11: Docs

- [ ] `components.mdx`: a `### Select` section after IconButton — prose (select-only combobox, keyboard: arrows/Home/End/typeahead/Enter/Escape; options data shape; `disabled` options; a value outside the options renders as its label; `data-pretable-value`) and a `| Prop | Type | Notes |` table with rows `options`, `value`, `onChange`, `aria-label`, `site`; the Replacing table gains a `Select` row. Update the Styling paragraph: "a select carries `data-pretable-select` and writes `data-pretable-value`".
- [ ] `filtering.mdx:7` "an operator select" → "an operator picker"; `tool-panel.mdx:277` "one `<select>` per aggregate row" → "one aggregate picker per row — a select-only combobox"; and the same paragraph's "the same menu keyboard the filters pane's pickers use" is now literally true — add "(arrows, Home/End, typeahead, Enter, Escape)".
- [ ] `docs-api-surface.test.ts`: register `"grid/components.mdx#Select": { types: [{ pkg: "react", name: "PretableSelectProps" }], complete: true }` and `MEMBER_TABLE_TYPES` `true`; the Replacing table's binding stays `PretableComponents` (now three rows — the guard requires the new `Select` row).
- [ ] Run `cd apps/website && pnpm exec vitest run --environment jsdom lib/docs app/docs; cd ../..` — fix tables to satisfy guards, never the guards. Commit `docs: the Select on the Components page; three sentences stop saying select`.

---

### Task 12: Fixture, e2e helper, and the e2e migrations

- [ ] **Fixture** `apps/website/app/fixtures/components/page.tsx`: add a `FixtureSelect: PretableSelectComponent = forwardRef(({ site, options, value, onChange, ...props }, ref) => <button {...props} ref={ref} type="button" data-fixture-select={site ?? ""} data-fixture-value={value} onClick={() => onChange(options[1]?.value ?? value)}>{value}</button>)` and pass `Select: FixtureSelect` in `components`.
- [ ] **Helper** `apps/website/e2e/helpers.ts`: `export async function chooseOption(page: Page, trigger: Locator, value: string) { await trigger.click(); const option = page.locator(\`[data-pretable-listbox] [data-pretable-option][data-value="${value}"]\`); await expect(option).toBeVisible(); await option.click(); await expect(trigger).toHaveAttribute("data-pretable-value", value); }`.
- [ ] **`tool-panel.spec.ts`**: every `toHaveValue(x)` on a picker → `toHaveAttribute("data-pretable-value", x)`; `qtyPicker.selectOption("avg")` → `chooseOption(page, page.locator('[data-pretable-aggregate-row][data-pretable-column-id="qty"] [data-pretable-aggregate]'), "avg")`; the `" select"` in that locator goes. The keyboard-order assertions that list `data-pretable-filter-row-column` / `-operator` among tab stops still hold (a button is a tab stop as a select was).
- [ ] **`components.spec.ts`**: extend test 1 — the dialog's operator picker is `[data-fixture-select="filter-operator"]`; add a test: on the REAL (un-replaced) grid at `/docs/grid/tool-panel` or `/fixtures/grouping`, open the builder's operator picker with the keyboard (`focus`, `ArrowDown`), type `e` (typeahead → "equals" or "ends with" per the labels), `Enter`, and assert `data-pretable-value` — in webkit too.
- [ ] Build, serve, run `playwright test tool-panel components grid-header-keyboard grid-header-popover-scroll smoke --workers=1`; all pass. Commit `test(website): the pickers in a real browser; e2e drivers move to chooseOption`.

---

### Task 13: Verification, changeset, PR

- [ ] From the root, one builder at a time: `pnpm format:write >/dev/null; pnpm format && pnpm lint && pnpm typecheck && pnpm typecheck:public && pnpm api:check && pnpm test && pnpm bench:e2e` — all exit 0.
- [ ] Changeset `.changeset/components-sp2-select.md` (`@pretable/react` minor, `@pretable/ui` patch): `PretableSelect` and the `Select` slot; the four pickers now render it; the enum editor's list is the kit's; **for consumers**: the pickers are `button[role="combobox"]` carrying `data-pretable-value`, not `select` elements — tests and styles keyed on `select` must move; the aggregate picker gained `data-pretable-aggregate`; the `custom` aggregate entry is a disabled option; keyboard: arrows, Home/End, typeahead, Enter/Space, Escape.
- [ ] Commit, `git fetch origin && git log HEAD..origin/main` empty, push, `gh pr create` (body: what ships; the primitive proven by the enum suite passing unchanged; no pixel moved with the classified diff; guards mutation-checked; drivers migrated with no claim changed; browser keyboard/typeahead in webkit; the consumer-facing note), `gh pr merge --squash --auto`. Watch for FAILURE and CANCELLED.

---

## Self-review against the spec

- Primitive (Listbox + hook, portal, placement, scroll, empty, outside-click, disabled) → Task 2. Enum editor renders it, suite unchanged → Task 3. Select contract (combobox trigger, attributes, open/commit/close keys, absent value, `data-pretable-value`, required name + warning, ref) → Task 4; type contract → Tasks 5, 9. Slot + four-part memo → Task 6. CSS (trigger, list rename, state, forced colours, guards incl. OWN) → Tasks 3, 7, 8. Migration + attributes kept + type-selected rules rewritten + jsdom drivers → Task 8. Measurement → Tasks 1, 10. Docs + registrations → Task 11. Fixture/e2e/helper → Task 12. Changeset/PR → Task 13. Out of scope untouched.
- Names: `Listbox`, `ListboxOption`, `useListboxKeys` (`UseListboxKeysInput`/`Result`), `PretableSelect`, `PretableSelectProps`, `PretableSelectOption`, `PretableSelectComponent`; attributes `data-pretable-select`, `data-pretable-select-label`, `data-pretable-value`, `data-pretable-listbox`, `data-pretable-option`, `data-value`, `data-active`, `data-pretable-aggregate`; helpers `chooseOption`, `readOptions`, `selectValue`; sites `filter-operator`, `filter-row-column`, `filter-row-operator`, `aggregate`.
