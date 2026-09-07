# Components SP3: TextInput and Checkbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the grid's seven chrome text fields and seven checkboxes on two kit components, `PretableTextInput` and `PretableCheckbox`, on the SP1/SP2 contract — every site keeps its attribute, every test keeps its claim, and no pixel moves except the three native checkboxes that deliberately become the kit's 16px square.

**Architecture:** `components/text-input.tsx` is the native `<input>` plus `data-pretable-text-input`/`data-pretable-site` and a dev name-warning that inspects the DOM after mount (a `<label for>` cannot be seen from props). `components/checkbox.tsx` is `<button type="button" role="checkbox" aria-checked>` with the check/minus glyph, `checked: boolean | "mixed"`, `onCheckedChange(next)`, and a consumer `onClick` that runs first and can veto with `preventDefault()` (the row-select shift-range branch). `PretableComponents` gains `TextInput` and `Checkbox` slots. The placement union is renamed `PretableSite` / `PretableBuiltInSite` and gains ten names. Kit CSS: `[data-pretable-text-input]` takes the field box; `[data-pretable-checkbox]` takes the existing four-site checkbox rule verbatim; site rules keep size/flex/placement; element-type selectors (`input[...]`, `button[...]`) are deleted.

**Tech Stack:** React 18/19 (`forwardRef`), TypeScript, vitest + testing-library (jsdom), Playwright (website + bench), api-extractor, changesets. Vanilla CSS in `packages/*`.

**Spec:** `docs/superpowers/specs/2026-09-07-components-sp3-inputs-design.md`. Contract and traps: `2026-09-04-components-sp1-button-design.md`, `2026-09-05-components-sp2-select-design.md`, memory notes `project-components-kit-sp1/sp2`, `reference-classic-jsx-fragment-trap`.

**Repo rules that bite here:**

- Repo root for every verification. `pnpm build` before `pnpm api`. Only ONE agent builds at a time. `apps/website` reads `packages/react/dist`: rebuild the package before `next build` or an e2e "regression" is a stale dist.
- `packages/react`'s `pnpm test` supplies `--environment jsdom`; a bare `vitest run` fails on `document`.
- Classic JSX build: keep `createElement` (and `Fragment` where `<>` is used) imported in every shipped `.tsx` — `jsx-runtime-imports.test.ts` enforces it.
- `useEffect(() => setState(...))` is a lint ERROR; adjust state during render or use refs.
- Mutation-check every guard and say so in the commit. Revert probes by re-editing, never `git checkout -- file`.
- `usePretableComponents()` is the FIRST statement of a component body.
- A programmatic `el.focus()` does not match `:focus-visible` on a button; measure rings with a real Tab.
- Never `git stash`; never touch `~/repos/pretable`. Attribution: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File structure

**Create**

| file | responsibility |
| --- | --- |
| `packages/react/src/components/checkbox.tsx` | `PretableCheckbox`, `PretableCheckboxProps` — public |
| `packages/react/src/components/text-input.tsx` | `PretableTextInput`, `PretableTextInputProps` — public |
| `packages/react/src/components/accessible-name.ts` | `hasAccessibleName(el)` — the DOM check both dev warnings share (internal) |
| `packages/react/src/__tests__/components-checkbox.test.tsx`, `components-text-input.test.tsx` | component behaviour |
| `packages/react/src/__tests__/checkbox-helpers.ts` | `checkboxState(el)` for jsdom drivers (not a test file) |
| `type-tests/react/components-inputs.types.tsx` | the compile-time contract |

**Modify**

| file | change |
| --- | --- |
| `packages/react/src/components/button.tsx` | `PretableBuiltInButtonSite` → `PretableBuiltInSite`, `PretableButtonSite` → `PretableSite`, ten new names |
| `packages/react/src/components/select.tsx`, `context.ts`, `public_api.ts`, `react.api.md` | rename; slots; exports |
| `packages/react/src/filter-menu/FilterMenu.tsx` | 3 fields → `TextInput`; checklist → `Checkbox` |
| `packages/react/src/tool-panel/filters/FilterRow.tsx` | 3 fields → `TextInput`; checklist → `Checkbox` |
| `packages/react/src/tool-panel/ColumnsSection.tsx` | search → `TextInput`; column toggle → `Checkbox` |
| `packages/react/src/tool-panel/grouping/GroupingSection.tsx` | hide-grouped → `Checkbox` |
| `packages/react/src/editors/BooleanCellControl.tsx` | renders `Checkbox` |
| `packages/react/src/pretable-surface.tsx` | row-select header + row → `Checkbox` |
| `packages/ui/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts` | kit rules, site collapse, guards |
| jsdom suites: `pretable-surface-boolean`, `scoped-labels`, `filter-menu`, `tool-panel`, `tool-panel-grouping-controls`, `row-selection-callback`, `indexed-rendering`, `hidden-column-grouping-roundtrip`, `filter-builder`, `attribute-contract`, `tool-panel-aggregates-picker`, `row-select-streaming-layout-cost`, `components-override`, `components-button` | drivers; slot/site pins |
| `apps/website/e2e/helpers.ts` + `smoke`, `tool-panel`, `grid-keyboard-a11y`, `server-data`, `grouping`, `csv-export` specs; `apps/website/app/fixtures/components/page.tsx`; `apps/website/e2e/components.spec.ts` | `toggleCheckbox`; driver migration; fixture proof |
| `apps/website/content/docs/grid/components.mdx` (+ any page naming the site type or "native checkbox"), `apps/website/lib/docs/__tests__/docs-api-surface.test.ts` | sections; rename; registrations |
| `type-tests/react/components-button.types.tsx`, `components-select.types.tsx` | rename |
| `.changeset/components-sp3-inputs.md` | minor react, patch ui |

---

### Task 1: Baseline the fourteen controls before anything moves

**Files:** scratch only — `<scratchpad>/measure-inputs.mjs`, `<scratchpad>/inputs-before.json`. (`<scratchpad>` = the session scratch dir given to the agent.) `<scratchpad>/measure-selects.mjs` from SP2 is the navigation precedent: read it.

- [ ] **Step 1: Build and serve** — `pnpm build`, then `(cd apps/website && pnpm exec next start -p 3117 > /tmp/pt-server.log 2>&1 &)`; curl `/` → 200.

- [ ] **Step 2: Write the script.** For each control record `rest` (the PROPS list from SP2's script plus `width`, `height`, `minWidth`, `margin*`, `padding*`, `outline*`, `accentColor`, `appearance`), `box`, and — for checkboxes — the `checked` and `mixed` boxes where the site can show them, and the focus outline under a REAL Tab: focus a neighbour, `page.keyboard.press("Tab")` (or `Shift+Tab`) until `document.activeElement` is the target, then read `outline`/`outlineOffset`. Targets and navigation:

| key | page / steps | selector |
| --- | --- | --- |
| `filter-value` | `/` → hover header → click "Filter Symbol" funnel | `[data-pretable-filter-value]` |
| `filter-min`, `filter-max` | `/` → funnel on a NUMBER column (find one whose dialog shows min/max; `/fixtures/grouping` has `qty`) | `[data-pretable-filter-min]`, `[data-pretable-filter-max]` |
| `filter-choice` | funnel on an ENUM column (the fixture with a `type: "enum"` column — grep `apps/website/app/fixtures` for `enum`) | `[data-pretable-filter-set] input[type="checkbox"]` (first) |
| `filter-row-value` | `/docs/grid/tool-panel` figure "The filters section" (pane pre-open) → "+ filter" | `input[data-pretable-filter-row-value]` |
| `filter-row-choice` | same page: change the row's column picker to an enum column via `[data-pretable-listbox] [data-value=…]` | `div[data-pretable-filter-row-value] input[type="checkbox"]` (first) |
| `tool-search` | any tool panel, Columns tab | `[data-pretable-tool-search]` |
| `tool-column-toggle` | Columns tab | `[data-pretable-tool-column-toggle]` (first) — also record one with `aria-checked="true"` and one `"false"` |
| `hide-grouped` | `/fixtures/grouping` grouping tab | `input[data-pretable-hide-grouped]` |
| `row-select`, `row-select-all` | a page with row selection on (grep fixtures/e2e for `data-pretable-row-select`; `smoke.spec.ts` knows one) | `[data-pretable-row-select]` first row; `[data-pretable-row-select-all]`; click one row to get `true`, click all for header `true`, one for `mixed` |
| `bool-cell` | a page with a boolean column (`pretable-surface-boolean` fixture in e2e/docs — grep `data-pretable-bool-cell` in apps/website) | `[data-pretable-bool-cell]` checked and unchecked |

Print `MISSING: …` for any null; a baseline with a hole proves nothing. Accept an `AFTER=1` env that swaps the three native checkbox selectors to `[data-pretable-filter-choice]`, `[data-pretable-filter-row-choice]`, `[data-pretable-hide-grouped]` (the button form) so Task 10 runs the identical script.

- [ ] **Step 3: Run** — `cp <scratchpad>/measure-inputs.mjs apps/website/measure.tmp.mjs && (cd apps/website && node measure.tmp.mjs <scratchpad>/inputs-before.json); rm -f apps/website/measure.tmp.mjs` → `all 14 controls measured`. Stop the server; `git status --short` clean. No commit.

---

### Task 2: Rename the site vocabulary and add the ten names

**Files:** `packages/react/src/components/button.tsx`, `select.tsx`, `public_api.ts`; `type-tests/react/components-button.types.tsx`, `components-select.types.tsx`; `apps/website/lib/docs/__tests__/docs-api-surface.test.ts` (the `STRING_UNIONS` entry `react/PretableBuiltInButtonSite` → `react/PretableBuiltInSite`, its comment "sixteen names" → "twenty-six", naming the ten); `apps/website/content/docs/grid/components.mdx` (every `PretableButtonSite`/`PretableBuiltInButtonSite` mention); `packages/react/react.api.md` via `pnpm api`.

- [ ] **Step 1:** In `button.tsx` rename both types (keep the JSDoc; retitle it "where a kit control sits") and append to the union, with a comment "the input and checkbox sites (SP3)":
```ts
  | "filter-value"
  | "filter-row-value"
  | "tool-search"
  | "row-select"
  | "row-select-all"
  | "bool-cell"
  | "tool-column-toggle"
  | "hide-grouped"
  | "filter-choice"
  | "filter-row-choice";
```
`PretableButtonProps.site?: PretableSite`; in `select.tsx` `site?: PretableSite`. `public_api.ts`: export the new names. Grep the whole repo (`git grep -n "ButtonSite"`) and rename every hit outside CHANGELOGs and `docs/superpowers`.
- [ ] **Step 2:** In `components-button.types.tsx` the open-union assertion becomes `Expect<Equal<PretableSite, PretableBuiltInSite | (string & {})>>`; in `components-select.types.tsx` the `Extract<PretableBuiltInSite, …four…>` assertion stays and gains the ten (mutation-check by removing one name → tsc fails; restore).
- [ ] **Step 3:** `pnpm build && pnpm api && pnpm api:check && pnpm typecheck && pnpm typecheck:public; echo exit:$?` → 0; api.md diff shows the rename and the ten names only. `cd apps/website && pnpm exec vitest run --environment jsdom lib/docs` green (fix the guard's entry name, never loosen).
- [ ] **Step 4:** Commit `refactor(react): the site vocabulary is PretableSite, and it names the input and checkbox sites`.

---

### Task 3: `PretableCheckbox`

**Files:** create `packages/react/src/components/accessible-name.ts`, `components/checkbox.tsx`, `src/__tests__/components-checkbox.test.tsx`, `src/__tests__/checkbox-helpers.ts`.

- [ ] **Step 1: the helpers**

```ts
// packages/react/src/components/accessible-name.ts
/**
 * Whether a rendered control has an accessible name from the sources the kit
 * cannot see in props: `aria-label`, `aria-labelledby`, or a wrapping/for
 * `<label>`. Called once after mount by the dev warnings; never in a hot path.
 */
export function hasAccessibleName(el: HTMLElement): boolean {
  if ((el.getAttribute("aria-label") ?? "").trim() !== "") return true;
  if ((el.getAttribute("aria-labelledby") ?? "").trim() !== "") return true;
  if (el.closest("label")) return true;
  const id = el.id;
  if (id && el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`)) return true;
  return false;
}
```
(jsdom has `CSS.escape`? Check; if not, fall back to a simple quote-escape and say so.)

```ts
// packages/react/src/__tests__/checkbox-helpers.ts
/** The kit checkbox's state, from the attribute it renders for exactly this. */
export function checkboxState(el: Element): boolean | "mixed" {
  const v = el.getAttribute("aria-checked");
  return v === "mixed" ? "mixed" : v === "true";
}
```

- [ ] **Step 2: failing tests**

```tsx
// packages/react/src/__tests__/components-checkbox.test.tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PretableCheckbox } from "../components/checkbox";
import { resetDevWarnings } from "../dev-warn";
import { checkboxState } from "./checkbox-helpers";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { resetDevWarnings(); });

describe("PretableCheckbox", () => {
  test("is a button with the checkbox role, the kit attributes and the glyph per state", () => {
    const { rerender, getByRole } = render(
      <PretableCheckbox aria-label="Pick" checked={false} onCheckedChange={() => {}} site="hide-grouped" data-pretable-hide-grouped="" />,
    );
    const box = getByRole("checkbox", { name: "Pick" });
    expect(box.tagName).toBe("BUTTON");
    expect(box).toHaveAttribute("type", "button");
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toHaveAttribute("data-pretable-checkbox", "");
    expect(box).toHaveAttribute("data-pretable-site", "hide-grouped");
    expect(box).toHaveAttribute("data-pretable-hide-grouped", "");
    expect(box.querySelector("[data-pretable-icon]")).toBeNull();
    rerender(<PretableCheckbox aria-label="Pick" checked onCheckedChange={() => {}} />);
    expect(checkboxState(box)).toBe(true);
    expect(box.querySelector("[data-pretable-icon]")).not.toBeNull();
    rerender(<PretableCheckbox aria-label="Pick" checked="mixed" onCheckedChange={() => {}} />);
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(box.querySelector("[data-pretable-icon]")).not.toBeNull();
  });

  test("a click reports the next value: false→true, true→false, mixed→true", () => {
    const onCheckedChange = vi.fn();
    const { rerender, getByRole } = render(<PretableCheckbox aria-label="Pick" checked={false} onCheckedChange={onCheckedChange} />);
    fireEvent.click(getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    rerender(<PretableCheckbox aria-label="Pick" checked onCheckedChange={onCheckedChange} />);
    fireEvent.click(getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    rerender(<PretableCheckbox aria-label="Pick" checked="mixed" onCheckedChange={onCheckedChange} />);
    fireEvent.click(getByRole("checkbox"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    expect(onCheckedChange).toHaveBeenCalledTimes(3);
  });

  test("a consumer onClick runs first and can veto the toggle with preventDefault", () => {
    const onCheckedChange = vi.fn();
    const order: string[] = [];
    const { getByRole } = render(
      <PretableCheckbox aria-label="Pick" checked={false} onCheckedChange={() => { order.push("toggle"); onCheckedChange(); }}
        onClick={(e) => { order.push("consumer"); if (e.shiftKey) e.preventDefault(); }} />,
    );
    fireEvent.click(getByRole("checkbox"));
    expect(order).toEqual(["consumer", "toggle"]);
    fireEvent.click(getByRole("checkbox"), { shiftKey: true });
    expect(onCheckedChange).toHaveBeenCalledTimes(1); // vetoed
  });

  test("disabled does not toggle; tabIndex and aria state attributes pass through", () => {
    const onCheckedChange = vi.fn();
    const { getByRole } = render(
      <PretableCheckbox aria-label="Pick" checked={false} onCheckedChange={onCheckedChange} disabled tabIndex={-1} aria-busy="true" aria-invalid="true" />,
    );
    const box = getByRole("checkbox");
    expect(box).toBeDisabled();
    fireEvent.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(box).toHaveAttribute("tabindex", "-1");
    expect(box).toHaveAttribute("aria-busy", "true");
    expect(box).toHaveAttribute("aria-invalid", "true");
  });

  test("forwards its ref; className and style pass through", () => {
    const ref = createRef<HTMLButtonElement>();
    const { getByRole } = render(<PretableCheckbox ref={ref} aria-label="Pick" checked={false} onCheckedChange={() => {}} className="mine" style={{ margin: 2 }} />);
    expect(ref.current).toBe(getByRole("checkbox"));
    expect(ref.current).toHaveClass("mine");
    expect(ref.current?.style.margin).toBe("2px");
  });

  test("a wrapping label names it and clicking the label toggles it", () => {
    const onCheckedChange = vi.fn();
    const { getByRole, getByText } = render(
      <label><PretableCheckbox checked={false} onCheckedChange={onCheckedChange} />Hide grouped</label>,
    );
    expect(getByRole("checkbox", { name: "Hide grouped" })).toBeInTheDocument();
    fireEvent.click(getByText("Hide grouped"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  test("warns in development when nothing names it, and not when a label or aria-label does", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PretableCheckbox checked={false} onCheckedChange={() => {}} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/PretableCheckbox/);
    warn.mockClear(); resetDevWarnings();
    render(<label><PretableCheckbox checked={false} onCheckedChange={() => {}} />Named</label>);
    render(<PretableCheckbox aria-label="Named" checked={false} onCheckedChange={() => {}} />);
    expect(warn).not.toHaveBeenCalled();
  });
});
```
(jsdom: does clicking a `<label>` dispatch a click on a wrapped `<button>`? It does for labelable elements — verify; if jsdom does not, assert via `label.control === button` instead and keep the click claim for the browser test in Task 12.)

- [ ] **Step 3: run → fails** (`Cannot find module '../components/checkbox'`).

- [ ] **Step 4: implement**

```tsx
// packages/react/src/components/checkbox.tsx
/**
 * The kit's checkbox: a `button[role="checkbox"]`, the model the row-select
 * cell, the column toggle and the boolean cell already used, now one
 * component for every site — the three native inputs included. A button
 * rather than a styled native input because mixed state, the roving
 * tabindex in body cells and a glyph that takes the theme's tokens are all
 * plain on a button and fights on an `<input>`.
 *
 * Styled by grid.css through `data-pretable-checkbox` and `aria-checked`;
 * a site's own attribute arrives through the spread. The glyph is the grid's
 * CheckIcon / MinusIcon. Keyboard is the native button's (Space, Enter): no
 * key handler here. The consumer's `onClick` runs first and may
 * `preventDefault()` to veto the toggle — how a shift-click range select
 * keeps the click without a second write.
 */
import { createElement, forwardRef, useEffect, useRef, type ButtonHTMLAttributes, type ReactElement } from "react";

import { warnOnce } from "../dev-warn";
import { CheckIcon, MinusIcon } from "../icons";
import { hasAccessibleName } from "./accessible-name";
import type { PretableSite } from "./button";

/**
 * Props for {@link PretableCheckbox}.
 *
 * @public
 */
export interface PretableCheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "role" | "aria-checked" | "onChange" | "children"> {
  /** The state. `"mixed"` is the header select-all's partial selection. */
  checked: boolean | "mixed";
  /** The next value after a click. `"mixed"` toggles to `true`. */
  onCheckedChange: (next: boolean) => void;
  /** Where in the grid this checkbox is; lands as `data-pretable-site`. */
  site?: PretableSite;
}

/**
 * A checkbox in the grid's own chrome.
 *
 * ```tsx
 * <label>
 *   <PretableCheckbox checked={hide} onCheckedChange={setHide} />
 *   Hide grouped columns
 * </label>
 * ```
 *
 * @public
 */
export const PretableCheckbox = forwardRef<HTMLButtonElement, PretableCheckboxProps>(
  function PretableCheckbox({ checked, onCheckedChange, site, onClick, ...buttonProps }, ref): ReactElement {
    const ownRef = useRef<HTMLButtonElement>(null);
    const setRef = (node: HTMLButtonElement | null) => {
      ownRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };
    // The name may come from a wrapping <label>, which props cannot see:
    // check the DOM once, after mount.
    useEffect(() => {
      const el = ownRef.current;
      if (el && !hasAccessibleName(el)) {
        warnOnce("checkbox-empty-name",
          "[pretable] <PretableCheckbox> rendered with no accessible name. Give it an aria-label or wrap it in a <label> with text.");
      }
    }, []);
    return (
      <button
        {...buttonProps}
        ref={setRef}
        type="button"
        role="checkbox"
        aria-checked={checked}
        data-pretable-checkbox=""
        data-pretable-site={site}
        onClick={(e) => {
          onClick?.(e);
          if (e.defaultPrevented) return;
          onCheckedChange(checked !== true);
        }}
      >
        {checked === true ? <CheckIcon /> : checked === "mixed" ? <MinusIcon /> : null}
      </button>
    );
  },
);
```
`MinusIcon` exists in `icons.tsx` (the header uses it) — confirm the export name.

- [ ] **Step 5: run → pass; mutation-check** the veto (remove `if (e.defaultPrevented) return;` → veto test fails) and the mixed→true rule (change to `!checked` → mixed test fails); restore. eslint 0, typecheck 0. Commit `feat(react): PretableCheckbox`.

---

### Task 4: `PretableTextInput`

**Files:** create `components/text-input.tsx`, `__tests__/components-text-input.test.tsx`.

- [ ] **Step 1: failing tests**

```tsx
// packages/react/src/__tests__/components-text-input.test.tsx
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { PretableTextInput } from "../components/text-input";
import { resetDevWarnings } from "../dev-warn";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { resetDevWarnings(); });

describe("PretableTextInput", () => {
  test("is the native input carrying the kit attributes; type/inputMode/value/onChange pass through", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <PretableTextInput aria-label="Filter value" site="filter-value" data-pretable-filter-value="" type="text" inputMode="decimal" value="4" onChange={onChange} />,
    );
    const input = getByRole("textbox", { name: "Filter value" }) as HTMLInputElement;
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveAttribute("data-pretable-text-input", "");
    expect(input).toHaveAttribute("data-pretable-site", "filter-value");
    expect(input).toHaveAttribute("data-pretable-filter-value", "");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input.value).toBe("4");
    fireEvent.change(input, { target: { value: "42" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("a date field stays a native date input", () => {
    const { container } = render(<PretableTextInput aria-label="Min" type="date" value="" onChange={() => {}} />);
    expect(container.querySelector('input[type="date"]')).not.toBeNull();
  });

  test("forwards its ref; className, style and disabled pass through", () => {
    const ref = createRef<HTMLInputElement>();
    const { getByRole } = render(<PretableTextInput ref={ref} aria-label="Q" className="mine" style={{ width: 80 }} disabled />);
    expect(ref.current).toBe(getByRole("textbox"));
    expect(ref.current).toHaveClass("mine");
    expect(ref.current?.style.width).toBe("80px");
    expect(ref.current).toBeDisabled();
  });

  test("warns in development when nothing can name it; silent for aria-label, aria-labelledby, or a label-for", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<PretableTextInput />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatch(/PretableTextInput/);
    warn.mockClear(); resetDevWarnings();
    render(<PretableTextInput aria-label="A" />);
    render(<><span id="lbl">B</span><PretableTextInput aria-labelledby="lbl" /></>);
    render(<><label htmlFor="q">C</label><PretableTextInput id="q" /></>);
    expect(warn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: run → fails. Step 3: implement**

```tsx
// packages/react/src/components/text-input.tsx
/**
 * The kit's text field: the native `<input>`, no more. Deliberately — the
 * native element is the accessible one, the date type keeps its native
 * picker, and what a theme needs is only the box, which grid.css draws
 * through `data-pretable-text-input`. A site's own attribute arrives through
 * the spread; `site` lands as `data-pretable-site`.
 */
import { createElement, forwardRef, useEffect, useRef, type InputHTMLAttributes, type ReactElement } from "react";

import { warnOnce } from "../dev-warn";
import { hasAccessibleName } from "./accessible-name";
import type { PretableSite } from "./button";

/**
 * Props for {@link PretableTextInput}: the native input's, plus `site`.
 *
 * @public
 */
export interface PretableTextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "children"> {
  /** Where in the grid this field is; lands as `data-pretable-site`. */
  site?: PretableSite;
}

/**
 * A text field in the grid's own chrome.
 *
 * ```tsx
 * <PretableTextInput aria-label="Filter value" value={text} onChange={(e) => setText(e.target.value)} />
 * ```
 *
 * @public
 */
export const PretableTextInput = forwardRef<HTMLInputElement, PretableTextInputProps>(
  function PretableTextInput({ site, ...inputProps }, ref): ReactElement {
    const ownRef = useRef<HTMLInputElement>(null);
    const setRef = (node: HTMLInputElement | null) => {
      ownRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };
    // A <label for> names it and props cannot see one: check the DOM once.
    useEffect(() => {
      const el = ownRef.current;
      if (el && !hasAccessibleName(el)) {
        warnOnce("text-input-empty-name",
          "[pretable] <PretableTextInput> rendered with no accessible name. Give it an aria-label, aria-labelledby, or a <label for> its id.");
      }
    }, []);
    return <input {...inputProps} ref={setRef} data-pretable-text-input="" data-pretable-site={site} />;
  },
);
```
- [ ] **Step 4: run → pass; mutation-check** the warning (make `hasAccessibleName` ignore `label[for]` → the label-for case warns → test fails; restore). Commit `feat(react): PretableTextInput`.

---

### Task 5: The type contract

**Files:** create `type-tests/react/components-inputs.types.tsx` (imports from SOURCE with the `TEMPORARY … Task 9` marker, as SP2 did). Assert: Checkbox requires `checked` and `onCheckedChange` (`@ts-expect-error` twins), `checked` accepts `"mixed"` and rejects `"yes"`, `type="submit"`/`role`/`children` are errors, `site="row-select"` and `site="mine"` compile, ref is `HTMLButtonElement`; TextInput accepts `type="date"`, `inputMode`, `value`+`onChange`, rejects `children`, ref is `HTMLInputElement`; `Expect<Equal<Extract<PretableBuiltInSite, ten>, ten>>` (mutation-check by removing one). `// prettier-ignore` on single-line directive pairs (SP2 lesson). Commit `test(react): pin the TextInput and Checkbox type contracts`.

---

### Task 6: The two slots

**Files:** `context.ts`, `__tests__/components-button.test.tsx`.
- [ ] Add `PretableTextInputComponent = ComponentType<PretableTextInputProps & RefAttributes<HTMLInputElement>>` and `PretableCheckboxComponent = ComponentType<PretableCheckboxProps & RefAttributes<HTMLButtonElement>>` (`@public`, JSDoc: a replacement owes a forwarded ref — the boolean cell and row-select are reached through refs? no: say "the search box is focused through its ref by the Columns section" only if true — check `ColumnsSection.tsx`; otherwise say the ref is the styling/measurement handle). `PretableComponents.TextInput?`/`.Checkbox?` with member JSDoc; `Resolved…` required; `DEFAULT_COMPONENTS` both; `useResolvedComponents` four-part edit for each. Tests: two copies of SP2's changed-slot test (one per slot); mutation-check by dropping each dep. Commit `feat(react): the TextInput and Checkbox slots`.

---

### Task 7: Kit CSS and the guards (site guard red by design)

**Files:** `packages/ui/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts`.

- [ ] **Step 1: guards first.** Add `TEXT_INPUT_SITES = ["filter-value", "filter-row-value", "tool-search"]` and `CHECKBOX_SITES = ["row-select", "row-select-all", "bool-cell", "tool-column-toggle", "hide-grouped", "filter-choice", "filter-row-choice"]`. Site attributes for lookup: the site name suffix (`data-pretable-filter-value` covers the dialog's three fields via the min/max twins — extend the lookup so `filter-value` also matches `[data-pretable-filter-min]`/`[-max]`; `filter-row-value` matches `input[data-pretable-filter-row-value]` — NOTE the builder's checklist wrapper is `div[data-pretable-filter-row-value]`: the guard must look at rules whose selector names the attribute, and the wrapper's rules (`flex-basis: 100%` etc.) are that DIV's own — keep them out of the field's OWN check by matching `input[data-pretable-filter-row-value]`… no: after migration there is no `input` type selector. Resolution: rename the WRAPPER's attribute to `data-pretable-filter-row-set` in FilterRow.tsx and grid.css in Task 8 (grep tests/e2e for `div[data-pretable-filter-row-value]` and update), so the field attribute names only fields. Record this in the commit.) `TEXT_INPUT_OWNED` (forbidden at a site: `border: 1px solid var(--pretable-rule)`, `border-radius`, `background: var(--pretable-bg-grid)`, `color: var(--pretable-text-cell)`, `font: inherit`, `box-sizing`), `CHECKBOX_OWNED` (`width: 16px`, `height: 16px`, `border: 1px solid var(--pretable-checkbox-border)`, `background: var(--pretable-checkbox-bg)`, `border-radius: 3px`, `cursor: pointer`, `display: inline-flex`). OWN: `filter-value` `/block-size:\s*28px/`, `filter-row-value` `/block-size:\s*24px/`, `tool-search` `/inline-size:\s*100%/`, `bool-cell` `/margin:\s*0 auto/`; the other five checkbox sites have NO site rule of their own — the guard's OWN map gets `null` for them meaning "no base rule may exist for this attribute" (a state rule like `:focus-visible` with a positive offset is allowed: exclude `:` pseudo selectors from the base lookup as the loop already does). Kit guards: "the kit text input carries the field box" (the six declarations + `padding-inline: 6px`), "the kit checkbox carries the square" (the CHECKBOX_OWNED list + `[aria-checked="true"]` and `"mixed"` fills + the icon sizing rule), state section has `[data-pretable-text-input]:focus-visible`, `[data-pretable-checkbox]:focus-visible` (ring), `:disabled` for both; forced colours: `[data-pretable-checkbox][aria-checked="true"]`/`"mixed"` → `forced-color-adjust: none; background-color: Highlight; color: HighlightText` (mirror the option rule), and `[data-pretable-text-input]:disabled` in the GrayText list. Bracket guard: anchor both base rules with `/:where\(\[data-pretable-text-input\]\)\s*\{/` and `/:where\(\[data-pretable-checkbox\]\)\s*\{/`; add both site lists. Also assert no element-type selector for these controls remains: `expect(rulesSelecting(css, s => /(^|[\s,(])input\[data-pretable-|(^|[\s,(])button\[data-pretable-(row-select|bool-cell|tool-column-toggle)/.test(s))).toHaveLength(0)` — RED now, green after Task 8.
- [ ] **Step 2: rules.** In the kit section after the select rules:
```css
  /* ---- Kit components: text input --------------------------------------
     The native input in the grid's box: the same rule border, grid surface
     and cell ink the select trigger draws, so a field and the picker beside
     it are one family. Sites keep their size, inset and flex participation. */
  :where([data-pretable-text-input]) {
    box-sizing: border-box;
    padding-inline: 6px;
    border: 1px solid var(--pretable-rule);
    border-radius: var(--pretable-radius-control);
    background: var(--pretable-bg-grid);
    color: var(--pretable-text-cell);
    font: inherit;
  }
  /* ---- Kit components: checkbox ----------------------------------------
     The 16px square every checkbox in the grid is — the row-select cell, the
     header select-all, the boolean cell, the column toggle, the checklists
     and the hide-grouped switch — from one rule, so a theme edit reaches all
     of them. aria-checked is the state channel; the glyph is the kit icon. */
  :where([data-pretable-checkbox]) {
    width: 16px;
    height: 16px;
    border: 1px solid var(--pretable-checkbox-border);
    background: var(--pretable-checkbox-bg);
    border-radius: 3px;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    line-height: 1;
    color: var(--pretable-checkbox-checked-fg);
  }
  :where([data-pretable-checkbox][aria-checked="true"]),
  :where([data-pretable-checkbox][aria-checked="mixed"]) {
    background: var(--pretable-checkbox-checked-bg);
    border-color: var(--pretable-checkbox-checked-bg);
    color: var(--pretable-checkbox-checked-fg);
  }
```
Delete the old four-site checkbox rules (lines ~866-905) — the comment above them ("The tool panel's visibility toggle is enrolled here…") moves to the kit rule. State section: add both to the ring and disabled lists; forced-colours rules as above; the `GrayText` list gains `[data-pretable-text-input]:disabled`, `[data-pretable-checkbox]:disabled`. Run the ui suite: exactly the site guard + the no-type-selector assertion red. Mutation-check the kit checkbox guard (delete `border-radius: 3px` → fails). Commit `feat(ui): the kit text-input and checkbox rules; the site guard learns fourteen controls`.

---

### Task 8: Migrate the fourteen sites, collapse their CSS, move the drivers

**Files:** the six site files, `grid.css`, `css-cascade.test.ts`, the jsdom suites listed in the file table.

- [ ] **Step 1: text fields.** FilterMenu: `const { Button, Select, TextInput, Checkbox } = usePretableComponents();` — the three `<input type={inputType} {...numericProps} …>` become `<TextInput site="filter-value" type={inputType} {...numericProps} data-pretable-filter-value="" aria-label … value onChange />` (min/max keep `data-pretable-filter-min/-max`). FilterRow: `<TextInput site="filter-row-value" {...fieldProps} data-pretable-filter-row-value="" …>` ×3; the checklist WRAPPER `<div data-pretable-filter-row-value>` → `data-pretable-filter-row-set` (grep `div[data-pretable-filter-row-value]` in grid.css, tests, e2e — update each). ColumnsSection: `<TextInput site="tool-search" data-pretable-tool-search="" …>`.
- [ ] **Step 2: checkboxes.** FilterMenu checklist: `<label key><Checkbox site="filter-choice" data-pretable-filter-choice="" data-value={opt.value} checked={checked} onCheckedChange={(next) => toggleSelected(opt.value, next)} />{label}</label>`. FilterRow checklist likewise with `filter-row-choice`. GroupingSection: `<label><Checkbox site="hide-grouped" data-pretable-hide-grouped="" checked={hideGroupedColumns} onCheckedChange={() => grid.setHideGroupedColumns(!hideGroupedColumns)} />{label}</label>`. ColumnsSection toggle: `<Checkbox site="tool-column-toggle" data-pretable-tool-column-toggle="" checked={visible} aria-label={…} onCheckedChange={(next) => grid.setColumnVisible(entry.id, next)} />` (delete the manual `<CheckIcon/>` child and the "row-select checkbox's exact recipe" comment — it IS the kit now). BooleanCellControl: `const { Checkbox } = usePretableComponents();` first; render `<Checkbox site="bool-cell" data-pretable-bool-cell="" checked={checked} aria-label={label} aria-busy aria-invalid aria-errormessage disabled={!editable || busy} tabIndex={-1} onClick={(e) => e.stopPropagation()} onCheckedChange={() => onToggle()} />`. pretable-surface header: `<Checkbox site="row-select-all" data-pretable-row-select-all="true" checked={headerCheckState === "true" ? true : headerCheckState === "mixed" ? "mixed" : false} aria-label onClick={(event) => { event.stopPropagation(); …existing body… }} onCheckedChange={() => {}} />` — hmm: the existing onClick DOES the write (`grid.setSelectAllVisible`). Keep the write in `onClick` and call `event.preventDefault()` at its end so the kit toggle is a no-op? Cleaner: move the write into `onCheckedChange(next)` (`setSelectAllVisible(next)`, then the emit/announce logic which reads `setting = next`) and keep `onClick={(e) => e.stopPropagation()}`. Do the cleaner form; the row cell likewise: `onCheckedChange={() => grid.toggleRowSelection(rowId)}` with `onClick` keeping `stopPropagation`, the shift-range branch (`selectRowRange` + `preventDefault()`), and `lastCheckedRowAnchorRef.current = rowId`. Read both blocks fully first; preserve every comment. The surface reads components from context already for Buttons — find that destructure and add `Checkbox`.
- [ ] **Step 3: CSS collapse.** Dialog: the `input[type="text"], input[type="date"], input:not([type])` rule → `:where([data-pretable-filter-value], [data-pretable-filter-min], [data-pretable-filter-max]) { width: 100%; block-size: 28px; padding-inline: 7px; }` (comment: size and the dialog's 7px inset; the kit draws the box); its focus rule → delete the `input:focus-visible` entry (kit ring). Builder: `input[data-pretable-filter-row-value]` rule → `:where([data-pretable-filter-row-value]) { flex: 1 1 auto; min-inline-size: 24px; block-size: 24px; }`; the checklist wrapper selectors → `[data-pretable-filter-row-set]`; the checklist ring rule `div[…] input:focus-visible` → `:where([data-pretable-filter-row-choice]:focus-visible) { outline-offset: 1px; }` (keep its comment; only the offset is the site's — the ring itself is the kit's); hide-grouped ring likewise → `[data-pretable-hide-grouped]:focus-visible { outline-offset: 1px }`; dialog checklist gets the same positive-offset rule on `[data-pretable-filter-choice]`. `tool-search` rule keeps `inline-size: 100%; margin-block-end: 6px; padding: 5px 7px;` only (comment updated). `bool-cell`: keep `margin: 0 auto; display: flex` (display: flex overrides the kit's inline-flex — allowed? It is a placement declaration; add `display` to the bool-cell OWN allowance rather than the forbidden list, and say why in the guard). Delete every `button[data-pretable-row-select…]` selector. Run the ui suite → all green including Task 7's red guards. Mutation-check: add `border: 1px solid var(--pretable-rule)` to the builder field rule → site guard fails; restore.
- [ ] **Step 4: jsdom drivers.** For each suite in the table: native `input[type=checkbox]` queries → `[role="checkbox"]`/the site attribute; `fireEvent.click(input)` stays a click (now on the button); `.checked` → `checkboxState(el)`; `toBeChecked()` works on `aria-checked` (testing-library supports role=checkbox); `fireEvent.change(checkbox, …)` (if any) → `fireEvent.click`. `pretable-surface-boolean` (14 hits) and `scoped-labels` (10) are the biggest — read each assertion and re-express with the SAME claim; count `expect(` before/after per file. `components-override.test.tsx`: `kind` gains `"text-input" | "checkbox"`; pin all fourteen sites; override test replaces `TextInput` and `Checkbox` (a `MyCheckbox` that destructures `checked/onCheckedChange/site` away) and proves it inside the portalled dialog (filter-value + filter-choice on an enum column), inside the body (row-select cell, bool cell) and in the pane. `attribute-contract.test.tsx`: add the two new attributes + `data-pretable-filter-row-set`.
- [ ] **Step 5: run the FULL react suite** (`cd packages/react && pnpm test`), eslint, `pnpm typecheck`. A claim failure is a behaviour change — fix the site. Commit `refactor(react,ui): the fourteen fields and checkboxes render the kit`, listing the wrapper rename and the header select-all write moving into onCheckedChange.

---

### Task 9: Public API + type tests against the package
- [ ] `public_api.ts`: export `PretableCheckbox`, `PretableTextInput`, their props, `PretableCheckboxComponent`, `PretableTextInputComponent`. `components-inputs.types.tsx` → `@pretable/react` imports + `const c: PretableComponents = { TextInput: PretableTextInput, Checkbox: PretableCheckbox }`. `pnpm build && pnpm api && pnpm api:check && pnpm typecheck:public` → 0; no `(undocumented)` on new symbols (member JSDoc on `checked`, `onCheckedChange`, `site`). Commit.

---

### Task 10: Re-measure and classify
- [ ] Rebuild, serve, run the Task 1 script with `AFTER=1` → `inputs-after.json`; diff per control/property. Expected classes: (a) rendered-equal on the seven fields (box/padding/border/colours/font unchanged; `display` may read the same); (b) DELIBERATE on the three ex-native checkboxes (`filter-choice`, `filter-row-choice`, `hide-grouped`): UA ~13px box → 16px kit square, UA colours → `--pretable-checkbox-*`, `appearance auto → none`-equivalent — record every value; their labels' row height may change by ≤3px — measure the `<label>` box too and report; (c) FINDING on anything else, esp. the four button checkboxes (must be byte-identical) and the search box. Fix findings in site rules; commit only if CSS changed.

---

### Task 11: Docs
- [ ] `components.mdx`: `### TextInput` and `### Checkbox` sections after Select (voice of the others; prop tables registered `complete: true` — TextInput's table lists only `site` since the rest are native attributes: say so in prose and register with `complete: true` against `PretableTextInputProps` — the guard reads own members only? Verify how it treats inherited members (SP1's Button table lists `variant`+`site` only, so own-members it is); Checkbox: `checked`, `onCheckedChange`, `site`); Replacing table gains both rows; Styling paragraph gains `[data-pretable-text-input]`, `[data-pretable-checkbox]`, `[aria-checked]`; the intro's "three that ship today" → five. Grep docs for "native checkbox", "the search input", `<input type="checkbox">`, and the row-select checkbox description (`grid/selection.mdx`?) — fix prose. Run docs vitest; mutation-check a table row. Commit.

---

### Task 12: Fixture, e2e helper, spec migrations
- [ ] Fixture: `FixtureTextInput` (`<input data-fixture-text-input={site} …>`) and `FixtureCheckbox` (`<button data-fixture-checkbox={site} data-fixture-checked={String(checked)} onClick={() => onCheckedChange(checked !== true)}>`), passed in `components`. Helper `toggleCheckbox(page, locator)` = click + `expect(locator).toHaveAttribute("aria-checked", …)`; replace `.check()`/`.uncheck()` everywhere in `apps/website/e2e` (grep found smoke 17, tool-panel 14, grid-keyboard-a11y 9, server-data 3, grouping 3, csv-export 2 hits — most are `toBeChecked`, which keeps working on `role=checkbox`; migrate only what fails, list each). `components.spec.ts`: override test covers a text field and a checkbox in the dialog + the row-select cell; new real-grid test (webkit too): Space toggles hide-grouped from the keyboard; clicking the label text toggles it; shift-click selects a row range (existing smoke/grid tests may already cover — reuse). Build package + website, `--workers=1`, all projects. Commit.

---

### Task 13: Verification, changeset, PR
- [ ] Root: `pnpm format && pnpm lint && pnpm typecheck && pnpm build && pnpm api && pnpm api:check && pnpm typecheck:public && pnpm test && pnpm bench:e2e` → 0 each; website e2e smoke + touched specs. Changeset `.changeset/components-sp3-inputs.md`: react minor (new components/slots; `PretableButtonSite`→`PretableSite` rename; the three checklist/hide-grouped checkboxes are `button[role=checkbox]` — `.checked`/`.check()` drivers move to `aria-checked`; `data-pretable-filter-row-set` wrapper rename; the header select-all and row-select are kit checkboxes now), ui patch. PR with the honest measurement table (the three deliberate checkbox changes called out), guards mutation-checked, review provenance. Auto-merge is enabled by the controller after the final review.

---

## Self-review against the spec

Purpose/decisions → Tasks 2-8; components → 3, 4 (name warnings via `hasAccessibleName`); slots → 6; site rename → 2; migration table → 8 (plus the `filter-row-set` wrapper rename that the guard forced — a deviation the spec did not foresee, recorded in the changeset); test-driver rule → 8, 12; CSS → 7, 8; measurement → 1, 10 (with the three deliberate changes); testing → 3-8, 12; docs → 11; changeset → 13; out of scope untouched. Names used consistently: `PretableSite`/`PretableBuiltInSite`, `data-pretable-text-input`, `data-pretable-checkbox`, `checkboxState`, `toggleCheckbox`, `hasAccessibleName`, `data-pretable-filter-row-set`, `data-pretable-filter-choice`, `data-pretable-filter-row-choice`.
