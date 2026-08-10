# SP2b: First-Party Icon Set Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace seven glyph sources across three incompatible rendering systems with one stroked icon set on a single 16px grid.

**Architecture:** A single internal module in `@pretable/react` exporting one small component per glyph — inline SVG, `viewBox="0 0 16 16"`, `fill: none`, `stroke: currentColor`, `stroke-width: 1.5`, rounded caps and joins, sized from a new `--pretable-icon-size` token. No icon-library dependency; nothing new on the public API surface.

**Tech Stack:** React 19 + TypeScript in `@pretable/react`, vanilla CSS in `@pretable/ui`, vitest + jsdom.

---

## What exists today

Seven sources, three systems, no shared stroke weight or optical size:

| Glyph | Where | System |
|---|---|---|
| Funnel | `filter-menu/FunnelButton.tsx` | **filled** SVG, 11px from a 16 grid |
| Overflow ⋮ | `column-menu/MenuButton.tsx` | **filled** SVG circles, 11px |
| Sort `▲`/`▼` | `pretable-surface.tsx:944`, `labeled-grid-surface.tsx:191` | Unicode text |
| Twisty `▾` | `group-row.tsx:175` | Unicode text |
| Check `✓` | `pretable-surface.tsx:3373`, `:4371`, `editors/BooleanCellControl.tsx:50` | Unicode text |
| Close `✕` | `group-panel/GroupPanel.tsx:483` | Unicode text |
| Grip | `packages/ui/src/grid.css` `[data-pretable-chip-handle]` | CSS `radial-gradient` |

The Unicode glyphs re-render in whatever font the theme picked — Aptos Narrow under Excel, Roboto Flex under Material — so their size, weight and baseline change per theme and per platform.

**Appearance change is the goal here**, unlike SP2a. These icons are meant to look different.

## Constraints

- `packages/*` is vanilla CSS; the icons are React components, which is fine — they are `.tsx` emitting inline SVG, not CSS-in-JS.
- Every icon stays `aria-hidden="true"` and `focusable="false"`. Each already sits inside a button carrying an `aria-label`, or beside `aria-sort`. Adding titles would double-announce.
- Keep the icon components **internal** — do not add them to `packages/react/src/public_api.ts`. That keeps `react.api.md` unchanged.
- `css-cascade.test.ts` asserts a rule exists for `[data-pretable-chip-handle]`. The gradient goes, but a rule must remain.
- Prettier reformats; run `npx prettier --write` before trusting any regex assertion.

---

### Task 1: The icon module

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/__tests__/icons.test.tsx`:

```tsx
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import {
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  FunnelIcon,
  GripIcon,
  OverflowIcon,
  SortAscIcon,
  SortDescIcon,
} from "../icons";

const ICONS = [
  ["CheckIcon", CheckIcon],
  ["ChevronDownIcon", ChevronDownIcon],
  ["CloseIcon", CloseIcon],
  ["FunnelIcon", FunnelIcon],
  ["GripIcon", GripIcon],
  ["OverflowIcon", OverflowIcon],
  ["SortAscIcon", SortAscIcon],
  ["SortDescIcon", SortDescIcon],
] as const;

describe("icon set", () => {
  test.each(ICONS)("%s shares the 16px grid and is aria-hidden", (_n, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  test.each(ICONS)("%s inherits color and size, hard-codes neither", (_n, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    // Size comes from CSS (--pretable-icon-size), colour from currentColor, so
    // one theme change moves every glyph. A width/height attribute here would
    // silently win over the stylesheet.
    expect(svg.getAttribute("width")).toBeNull();
    expect(svg.getAttribute("height")).toBeNull();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  test.each(ICONS)("%s draws with strokes, not fills", (_n, Icon) => {
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("fill")).toBe("none");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("1.5");
    expect(svg.getAttribute("stroke-linecap")).toBe("round");
    expect(svg.getAttribute("stroke-linejoin")).toBe("round");
  });
});
```

Note: `OverflowIcon` and `GripIcon` are dot glyphs. They still carry the stroke attributes on the `<svg>` for consistency, but their `<circle>` children set `fill="currentColor"` and `stroke="none"` individually — dots read as mush at 1.5px stroke. The third test asserts the root element only, so this passes.

- [ ] **Step 2: Run and confirm it fails**

`pnpm --filter @pretable/react test -- icons` — expect a resolution failure on `../icons`.

- [ ] **Step 3: Create `packages/react/src/icons.tsx`**

```tsx
/**
 * The grid's icon set. Eight glyphs on one 16px grid, 1.5px stroke, rounded
 * caps and joins, drawn in `currentColor` and sized from `--pretable-icon-size`.
 *
 * Deliberately not a dependency: the whole set is a few hundred bytes, and an
 * icon library would be a bundle, licensing and tree-shaking commitment for
 * eight shapes. Deliberately not Unicode text either — `▲`, `▾`, `✓` and `✕`
 * re-render in whatever font the active theme picked, so their weight, size and
 * baseline shifted between Excel's Aptos Narrow and Material's Roboto.
 *
 * Every glyph is `aria-hidden`: each sits inside a button that already carries
 * an `aria-label`, or beside an `aria-sort`. A title here would double-announce.
 *
 * Internal on purpose — not re-exported from `public_api.ts`.
 */
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Glyph({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 6.5 8 10.5 12 6.5" />
    </Glyph>
  );
}

export function SortAscIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 9.5 8 5.5 12 9.5" />
    </Glyph>
  );
}

export function SortDescIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4 6.5 8 10.5 12 6.5" />
    </Glyph>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
    </Glyph>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M4.5 4.5 11.5 11.5M11.5 4.5 4.5 11.5" />
    </Glyph>
  );
}

export function FunnelIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <path d="M2.75 3.5h10.5L9.25 8.75v4L6.75 11.5V8.75z" />
    </Glyph>
  );
}

/* Dots, not strokes: a 1.5px-stroked 1px circle reads as mush at this size.
   The root keeps the shared stroke attributes so the set stays uniform; each
   circle opts out individually. */
export function OverflowIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      <circle cx="8" cy="3.25" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="12.75" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

export function GripIcon(props: IconProps) {
  return (
    <Glyph {...props}>
      {[5.5, 10.5].map((cx) =>
        [3.5, 8, 12.5].map((cy) => (
          <circle
            key={`${cx}-${cy}`}
            cx={cx}
            cy={cy}
            r="1"
            fill="currentColor"
            stroke="none"
          />
        )),
      )}
    </Glyph>
  );
}
```

- [ ] **Step 4: Verify and commit**

`pnpm --filter @pretable/react test -- icons` — 24 passing (8 icons × 3 tests).

```bash
git add packages/react/src/icons.tsx packages/react/src/__tests__/icons.test.tsx
git commit -m "feat(react): add a first-party stroked icon set"
```

---

### Task 2: The size token

- [ ] **Step 1:** Add `"pretable-icon-size"` to `TOKENS` in `packages/ui/src/__tests__/contract.test.ts` (44 → 45). Run `pnpm --filter @pretable/ui test -- contract`, confirm it fails for both themes.

- [ ] **Step 2:** Define it. `excel.css`: `--pretable-icon-size: 12px;` — Excel is dense, its header runs 13px. `material.css`: `--pretable-icon-size: 16px;` — Material's header runs 14px and its controls are larger. Comment both with the reasoning.

- [ ] **Step 3:** In `packages/ui/src/grid.css`, add a rule sizing every glyph, placed near the top with the other shared rules:

```css
  /* Every glyph in the set draws on a 16px grid in currentColor and takes its
     size from here, so one token moves all of them. `flex: none` because most
     sit inside flex containers that would otherwise squash them. */
  :where([data-pretable-icon]) {
    flex: none;
    width: var(--pretable-icon-size);
    height: var(--pretable-icon-size);
  }
```

Add `data-pretable-icon=""` to the `Glyph` wrapper in `icons.tsx` so this rule matches, and extend the icon test to assert every glyph carries it.

- [ ] **Step 4:** Verify both suites, commit as `feat(ui): add --pretable-icon-size and size the glyph set from it`.

---

### Task 3: Replace the two filled SVGs

- [ ] **Step 1:** In `packages/react/src/filter-menu/FunnelButton.tsx`, replace the inline `<svg>…</svg>` with `<FunnelIcon />`. In `packages/react/src/column-menu/MenuButton.tsx`, replace it with `<OverflowIcon />`. Import from `"../icons"`.

- [ ] **Step 2:** Delete the now-unused `width="11" height="11"` sizing — the CSS token owns it.

- [ ] **Step 3:** Run `pnpm --filter @pretable/react test`. The existing filter-menu and column-menu tests must stay green; they assert behaviour and `aria-*`, not SVG internals. If any asserts on path data, report rather than rewriting it.

- [ ] **Step 4:** Commit as `refactor(react): draw the funnel and overflow glyphs from the icon set`.

---

### Task 4: Replace the five Unicode glyphs

- [ ] **Step 1: Sort indicators.** `pretable-surface.tsx:944` renders `{sortDirection === "asc" ? "▲" : "▼"}`; `labeled-grid-surface.tsx:191` renders `{sortDirection === "desc" ? "▼" : "▲"}`. Replace both with `SortAscIcon` / `SortDescIcon`. **Preserve each file's existing direction logic exactly** — note they are written with opposite ternaries, which is fine; do not "normalise" them.

- [ ] **Step 2: Twisty.** `group-row.tsx:175` renders a bare `▾`. Replace with `<ChevronDownIcon />`. The stylesheet rotates the button `-90deg` while `aria-expanded="false"`; that still works. But the twisty rule sets `width: 1em; height: 1em` on the **button** — check the glyph is not double-sized now that the SVG has its own dimensions, and adjust the button rule if needed.

- [ ] **Step 3: Checks.** `pretable-surface.tsx:3373` and `:4371` and `editors/BooleanCellControl.tsx:50` render `"✓"` (BooleanCellControl renders `""` when unchecked). Replace with `<CheckIcon />`, rendering nothing when unchecked. The checkbox buttons set `font-size: 11px` in `grid.css` to size the text glyph — that is now dead for these buttons; leave the declaration (other content may rely on it) but confirm the glyph sizes from the token.

- [ ] **Step 4: Close.** `GroupPanel.tsx:483` renders `<span aria-hidden="true">✕</span>`. Replace with `<CloseIcon />` — the icon is already `aria-hidden`, so drop the wrapper span.

- [ ] **Step 5:** Run `pnpm --filter @pretable/react test`. Several tests may query by the literal glyph text. If any does, update it to query by role/label instead and say so in the report — an icon has no text content, so a text query is the wrong assertion regardless.

- [ ] **Step 6:** Commit as `refactor(react): replace the Unicode glyphs with the icon set`.

---

### Task 5: Replace the CSS gradient grip

- [ ] **Step 1:** In `GroupPanel.tsx`, the chip handle is an empty `aria-hidden` span carrying `data-pretable-chip-handle`. Render `<GripIcon data-pretable-chip-handle="" />` instead, dropping the span.

- [ ] **Step 2:** In `grid.css`, replace the `[data-pretable-chip-handle]` rule body — the `radial-gradient`, `background-size` and fixed 5×12 dimensions go. Keep a rule (`css-cascade.test.ts` asserts one exists) carrying only `color: var(--pretable-text-dim)`; sizing now comes from the shared icon rule.

- [ ] **Step 3:** Verify the drag-to-group panel tests still pass, and that `grid.css styles every element of the drag-to-group panel` is still green.

- [ ] **Step 4:** Commit as `refactor(ui): draw the chip grip from the icon set instead of a CSS gradient`.

---

### Task 6: Verification and a look

- [ ] **Step 1:** `pnpm --filter @pretable/ui test`, `pnpm --filter @pretable/react test`, `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- [ ] **Step 2:** `pnpm api:check` — expect NO diff. The icons are internal; if a report moves, something was exported by accident.
- [ ] **Step 3:** Confirm no Unicode glyph survives: grep `packages/react/src` for `▲ ▼ ▾ ✓ ✕` excluding tests and expect zero.
- [ ] **Step 4:** Rebuild `@pretable/ui` and `@pretable/react`, run the website dev server, and **look at the grid**. Hover a header to reveal the funnel and ⋮, expand a group, check a row-select box, and open the group panel. Report what you see. Screenshot the header at 3× so the stroke weight is legible.

## Self-review

**Coverage.** All seven sources in the table are replaced: funnel and overflow in Task 3, the five Unicode glyphs in Task 4, the CSS gradient in Task 5. The size token is Task 2.

**Not doing here, deliberately:** the two behavioural changes the spec floats alongside the icon work — per-column funnel reveal (today hovering any header lights every funnel) and showing a sort affordance only on the sorted column. Both change *when* chrome appears rather than what it looks like, both touch reveal logic rather than glyphs, and bundling them would make an appearance change hard to review. They belong in their own PR.

**Consistency.** Component names are spelled identically in the test, the module and every call site: `ChevronDownIcon`, `SortAscIcon`, `SortDescIcon`, `CheckIcon`, `CloseIcon`, `FunnelIcon`, `OverflowIcon`, `GripIcon`.
