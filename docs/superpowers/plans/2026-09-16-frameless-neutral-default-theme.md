# Frameless Neutral Default Theme Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default `pretable` theme frameless and neutral so an embedded grid reads as part of the host page, with the sticky-header seam supplied by a scroll-keyed shadow instead of a permanent dark line.

**Architecture:** `grid.css` keeps drawing the container frame, the header underline and a new header shadow, but every one of them reads a token, so the house theme can set them to nothing while Excel and Material set them to today's values. `packages/react` publishes one new DOM attribute, `data-pretable-scrolled`, on the scroll viewport; the header shadow keys on it. Tests pin the literals, the cascade, and the painted result.

**Tech Stack:** vanilla CSS in `packages/ui` (no Tailwind there), React + vitest/jsdom in `packages/react`, Playwright in `apps/website/e2e` against a fixture page, the docs guard in `apps/website/lib/docs/__tests__/docs-api-surface.test.ts`.

**Spec:** `docs/superpowers/specs/2026-09-16-frameless-neutral-default-theme-design.md`

**Branch:** work on `blove/pretable-visual-aesthetics-4fb28d` in this worktree. Never `git checkout` or `git stash` in the main repo. Node 24 is required (`node -v` must print `v24`); a phantom `Cannot find module '@pretable/core'` means the wrong node.

Run every command from the worktree root: `/Users/blove/repos/pretable/.claude/worktrees/dense-handle-filter-followups-3bb3d8`.

---

## File map

| File | Responsibility in this change |
|---|---|
| `packages/ui/grid.css` | Reads three new tokens: `--pretable-frame` (viewport, tool-layout wrapper, group panel), `--pretable-rule-header` (header underline and the error-strip seam inside the tool layout), `--pretable-shadow-header` (header row when `[data-pretable-scrolled]` is present). Deletes the now-pointless corner rule. |
| `packages/ui/themes/pretable.css` | Retuned literals per the spec, sets `--pretable-frame: 0`, `--pretable-shadow-card: none`, rewritten comments. |
| `packages/ui/themes/excel.css`, `material.css` | Declare the three new tokens with today's behaviour (`--pretable-frame: 1px solid var(--pretable-rule-strong)`, `--pretable-rule-header: var(--pretable-rule-strong)`, `--pretable-shadow-header: none`). |
| `packages/ui/src/__tests__/contract.test.ts` | Adds the three tokens to `TOKENS`; pins the house theme's literals and contrast ratios. |
| `packages/ui/src/__tests__/css-cascade.test.ts` | Rewrites the frame/underline assertions; adds the scrolled-shadow rule guard. |
| `packages/react/src/pretable-surface.tsx` | Sets `data-pretable-scrolled` on the viewport from the `onScroll` handler. |
| `packages/react/src/__tests__/scrolled-attribute.test.tsx` | New jsdom test for the attribute. |
| `apps/website/app/fixtures/scrolled-seam/page.tsx` | New fixture: one tall grid, house theme. |
| `apps/website/e2e/scrolled-seam.spec.ts` | New Playwright test: computed header `box-shadow` at rest and after scroll. |
| `apps/website/content/docs/theming/token-reference.mdx`, `index.mdx`, `custom-themes.mdx`, `pick-a-theme.mdx`, `override-tokens.mdx`, `grid/index.mdx`, `content/examples/custom-theme/brand.css` | Token tables, the token count, the attribute table, the example theme. |
| `.changeset/frameless-default-theme.md` | Minor bump for `@pretable/ui` and `@pretable/react`. |

---

### Task 1: grid.css reads the frame from a token; compatibility skins keep their frame

**Files:**
- Modify: `packages/ui/grid.css:53-67`, `:1197-1220`, `:1700-1722`
- Modify: `packages/ui/themes/excel.css`, `packages/ui/themes/material.css`
- Test: `packages/ui/src/__tests__/css-cascade.test.ts`, `packages/ui/src/__tests__/contract.test.ts`

- [ ] **Step 1: Write the failing contract test entries**

In `packages/ui/src/__tests__/contract.test.ts`, add three names to `TOKENS` directly after `"pretable-rule-strong",`:

```ts
  "pretable-rule-strong",
  "pretable-rule-header",
  "pretable-frame",
```

and after `"pretable-shadow-card",`:

```ts
  "pretable-shadow-card",
  "pretable-shadow-header",
```

- [ ] **Step 2: Run the contract test to see it fail for all three themes**

Run: `pnpm --filter @pretable/ui test -- contract`
Expected: three failures, one per theme, each naming `--pretable-rule-header is empty` (the first missing token the loop hits).

- [ ] **Step 3: Write the failing cascade assertions**

In `packages/ui/src/__tests__/css-cascade.test.ts`, inside the test titled `"the layout wrapper takes the card chrome and the viewport inside surrenders its own"`, replace

```ts
      expect(layout).toMatch(
        /border:\s*1px solid var\(--pretable-rule-strong\)/,
      );
```

with

```ts
      expect(layout).toMatch(/border:\s*var\(--pretable-frame\)/);
```

In the same file, in the assertion block ending at the `surrender` variable (around line 2019), replace

```ts
      expect(surrender).toMatch(
        /border-bottom:\s*1px solid var\(--pretable-rule-strong\)/,
      );
```

with

```ts
      expect(surrender).toMatch(
        /border-bottom:\s*1px solid var\(--pretable-rule-header\)/,
      );
```

Add a new test at the end of the same `describe` that holds the layout test:

```ts
    test("the frame, the header underline and the scrolled seam each read their own token", () => {
      // The house theme is frameless; the compatibility skins are not. The only
      // way one stylesheet serves both is for every edge to be a token the
      // theme can set to nothing. Three edges, three tokens, no literal 1px.
      const css = stripped();
      const viewport = css.match(
        /:where\(\[data-pretable-scroll-viewport\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(viewport, "no scroll-viewport rule").toBeDefined();
      expect(viewport).toMatch(/border:\s*var\(--pretable-frame\)/);

      const panel = css.match(
        /:where\(\[data-pretable-group-panel\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(panel, "no group-panel rule").toBeDefined();
      expect(panel).toMatch(/border:\s*var\(--pretable-frame\)/);
      expect(panel).toMatch(/border-bottom:\s*0/);

      const header = css.match(
        /:where\(\[data-pretable-header-row\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(header, "no header-row rule").toBeDefined();
      expect(header).toMatch(
        /border-bottom:\s*1px solid var\(--pretable-rule-header\)/,
      );
      expect(header).not.toMatch(/rule-strong/);

      const scrolled = css.match(
        /:where\(\[data-pretable-scroll-viewport\]\[data-pretable-scrolled\]\s+\[data-pretable-header-row\]\)\s*\{([\s\S]*?)\}/,
      )?.[1];
      expect(scrolled, "no scrolled header rule").toBeDefined();
      expect(scrolled).toMatch(/box-shadow:\s*var\(--pretable-shadow-header\)/);
      // Sticky header, scrolling rows: the shadow has to paint OVER the first
      // row, which needs the header above it in stacking order.
      expect(scrolled).toMatch(/z-index:\s*[1-9]/);

      // No literal frame survives anywhere the token now governs.
      const literalFrames = rulesSelecting(css, (s) =>
        /scroll-viewport\]\)|tool-layout\]\)\s*\{|group-panel\]\)\s*\{|header-row\]\)/.test(s),
      ).filter((m) => /border(-bottom)?:\s*1px solid var\(--pretable-rule-strong\)/.test(m[2]));
      expect(literalFrames.map((m) => m[1].trim())).toEqual([]);
    });
```

- [ ] **Step 4: Run the cascade test to see the new assertions fail**

Run: `pnpm --filter @pretable/ui test -- css-cascade`
Expected: the layout test fails on `border: var(--pretable-frame)`, and the new test fails with "no scrolled header rule".

- [ ] **Step 5: Edit grid.css**

At `packages/ui/grid.css:53-58`, replace the viewport rule's border line:

```css
  :where([data-pretable-scroll-viewport]) {
    background: var(--pretable-bg-grid);
    border: var(--pretable-frame);
    border-radius: var(--pretable-radius);
    box-shadow: var(--pretable-shadow-card);
    font-family: var(--pretable-font-sans);
    color: var(--pretable-text-cell);
  }
```

Replace the comment above it (lines 47-52) with:

```css
  /* Outer viewport (scrollable container).
     The frame is a token, not a literal: the house theme is frameless and
     sets --pretable-frame to 0, the compatibility skins set it to a 1px line.
     --pretable-rule-strong no longer takes part here — its remaining job is
     the edge of lifted surfaces (menus, popovers, the editor). */
```

At lines 62-67, the header row:

```css
  /* Header row. The resting underline is decorative and reads
     --pretable-rule-header; the load-bearing seam against rows scrolling
     underneath is the shadow keyed on [data-pretable-scrolled] below. */
  :where([data-pretable-header-row]) {
    background: var(--pretable-bg-header);
    border-bottom: 1px solid var(--pretable-rule-header);
    height: var(--pretable-header-height);
  }

  /* The sticky header earns its seam only once rows pass under it. The
     surface sets [data-pretable-scrolled] on the viewport at scrollTop > 0.
     z-index so the shadow paints over the first data row rather than under
     it: the header is sticky, so it already has a stacking context, but it
     still needs to sort above absolutely positioned rows. */
  :where([data-pretable-scroll-viewport][data-pretable-scrolled] [data-pretable-header-row]) {
    box-shadow: var(--pretable-shadow-header);
    z-index: 2;
  }
```

At line 1202, the group panel:

```css
    background: var(--pretable-bg-toolbar);
    border: var(--pretable-frame);
    border-bottom: 0;
    border-radius: var(--pretable-radius) var(--pretable-radius) 0 0;
```

Keep the `[data-pretable-group-panel-wrapper] > [data-pretable-scroll-viewport]` corner rule at line 1210-1218; it is still needed by Material's 12px radius.

At line 1701, the tool layout wrapper:

```css
  :where([data-pretable-tool-layout]) {
    border: var(--pretable-frame);
    border-radius: var(--pretable-radius);
    box-shadow: var(--pretable-shadow-card);
```

At line 1721, the surrender rule:

```css
    border-bottom: 1px solid var(--pretable-rule-header);
```

Check the header row's existing `position: sticky` and any existing `z-index` on it with `grep -n "header-row" packages/ui/grid.css`; if the base rule already sets a `z-index`, make the scrolled rule's value one higher than it rather than `2`.

- [ ] **Step 6: Give Excel and Material the three tokens with today's behaviour**

In `packages/ui/themes/excel.css`, directly after the `--pretable-rule-strong: #a6a6a6;` line:

```css
  --pretable-rule-header: var(--pretable-rule-strong); /* Excel underlines its header with the frame colour */
  --pretable-frame: 1px solid var(--pretable-rule-strong);
```

and directly after `--pretable-shadow-card: none;`:

```css
  --pretable-shadow-header: none; /* The drawn underline is the seam */
```

In `packages/ui/themes/material.css`, directly after `--pretable-rule-strong: #797979; /* outline */`:

```css
  --pretable-rule-header: var(--pretable-rule-strong);
  --pretable-frame: 1px solid var(--pretable-rule-strong);
```

and directly after `--pretable-shadow-card: none;`:

```css
  --pretable-shadow-header: none;
```

Material's dark block restates `--pretable-rule-strong`; the two aliases follow it, so nothing else is needed there.

In `packages/ui/themes/pretable.css` for this task only, add the same three lines as aliases so the contract passes before Task 3 retunes them. After `--pretable-rule-strong: #7e7e8b;`:

```css
  --pretable-rule-header: var(--pretable-rule-strong);
  --pretable-frame: 1px solid var(--pretable-rule-strong);
```

After the `--pretable-shadow-card:` declaration:

```css
  --pretable-shadow-header: none;
```

- [ ] **Step 7: Run the whole ui suite**

Run: `pnpm --filter @pretable/ui test`
Expected: all green. If `contract.test.ts` reports that `grid.css` reads a `var(--pretable-*)` no theme defines, a name is misspelt between grid.css and the themes.

- [ ] **Step 8: Mutation-test the new cascade guard**

Temporarily change `border: var(--pretable-frame);` on the viewport rule back to `border: 1px solid var(--pretable-rule-strong);`, run `pnpm --filter @pretable/ui test -- css-cascade`, confirm the new test fails on both the `frame` match and the `literalFrames` list, then revert the mutation. Do the same by deleting the scrolled rule; confirm "no scrolled header rule". Revert.

- [ ] **Step 9: Build ui and visually confirm nothing moved**

Run: `pnpm --filter @pretable/ui build && pnpm --filter @pretable/react build`
Then `pnpm --filter website dev` is NOT the check (dev server is unreliable for this); instead run the existing website e2e that covers the tool panel, which paints the frame: `pnpm --filter website exec playwright test grid-header-keyboard.spec.ts --workers=1` against a local `next build && next start` per `reference_local_smoke_run`. Expected: passes, since every theme still resolves to today's pixels.

- [ ] **Step 10: Commit**

```bash
git add packages/ui/grid.css packages/ui/themes packages/ui/src/__tests__
git commit -m "feat(ui): read the frame, header underline and header seam from tokens

No visual change. Every edge grid.css draws on the container and the
header now reads a token so a theme can set it to nothing. All three
themes declare the three new tokens at today's values.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `data-pretable-scrolled` on the viewport

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx:5953` (viewport attributes) and `:6370-6380` (`onScroll`)
- Create: `packages/react/src/__tests__/scrolled-attribute.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/__tests__/scrolled-attribute.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "vitest";

import { PretableSurface } from "../pretable-surface";

/**
 * `data-pretable-scrolled` is the hook the house theme's header seam keys on:
 * present at scrollTop > 0, absent at 0. It is a DOM contract like
 * `data-pretable-hydrated`, so it is pinned here on the real element rather
 * than inferred from a snapshot field.
 */

type Row = { id: string; name: string };
const ROWS: Row[] = Array.from({ length: 200 }, (_, i) => ({
  id: `r${i}`,
  name: `Row ${i}`,
}));
const COLUMNS = [{ id: "name", header: "Name", widthPx: 160 }];
const getRowId = (row: Row) => row.id;

afterEach(cleanup);

function viewport(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>(
    "[data-pretable-scroll-viewport]",
  );
  if (el === null) throw new Error("no viewport");
  return el;
}

describe("data-pretable-scrolled", () => {
  it("is absent at rest, present after a scroll, and absent again at zero", () => {
    const { container } = render(
      <PretableSurface<Row>
        ariaLabel="Scrolled"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={getRowId}
        height={240}
      />,
    );
    const el = viewport(container);
    expect(el).not.toHaveAttribute("data-pretable-scrolled");

    act(() => {
      el.scrollTop = 120;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(el).toHaveAttribute("data-pretable-scrolled", "");

    act(() => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(el).not.toHaveAttribute("data-pretable-scrolled");
  });
});
```

If `PretableSurface` in this repo takes its rows and height through different prop names, copy the exact props from `packages/react/src/__tests__/focus-scroll.test.tsx`, which renders a scrollable surface, and keep the assertions above unchanged.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @pretable/react test -- scrolled-attribute`
Expected: FAIL on `toHaveAttribute("data-pretable-scrolled", "")`, since the attribute is never set.

- [ ] **Step 3: Implement**

In `packages/react/src/pretable-surface.tsx`, next to the other viewport-level `useState` declarations (search for `const [viewportWidth, setViewportWidth]`), add:

```ts
  // Whether any rows have passed under the sticky header. Published as
  // `data-pretable-scrolled` so the stylesheet can draw the header's seam
  // only when there is something to separate. A boolean in state, not a
  // per-scroll attribute write: React dedupes the render when it does not
  // flip, and it flips twice per scroll gesture at most.
  const [scrolled, setScrolled] = useState(false);
```

In the `onScroll` handler at line 6370, after `const el = event.currentTarget;`:

```ts
        const isScrolled = el.scrollTop > 0;
        if (isScrolled !== scrolled) {
          setScrolled(isScrolled);
        }
```

On the viewport element at line 5953, directly after `data-pretable-scroll-viewport=""`:

```tsx
      data-pretable-scrolled={scrolled ? "" : undefined}
```

The layout effect at line 2949 that writes `viewport.scrollTop` from the snapshot does not fire a scroll event in jsdom but does in browsers, so the attribute follows programmatic scrolls too. No extra handling is needed.

- [ ] **Step 4: Run the test to see it pass, then the react suite**

Run: `pnpm --filter @pretable/react test -- scrolled-attribute`
Expected: PASS.

Run: `pnpm --filter @pretable/react test`
Expected: green. One or two random timeouts on this Mac are a known local flake; re-run those files singly before believing them.

- [ ] **Step 5: Typecheck and lint**

Run: `pnpm --filter @pretable/react typecheck && pnpm --filter @pretable/react lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/pretable-surface.tsx packages/react/src/__tests__/scrolled-attribute.test.tsx
git commit -m "feat(react): publish data-pretable-scrolled on the scroll viewport

Present while scrollTop > 0. The house theme keys the sticky header's
seam shadow on it so the seam exists only when rows are under the rail.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Retune pretable.css

**Files:**
- Modify: `packages/ui/themes/pretable.css`
- Test: `packages/ui/src/__tests__/contract.test.ts`

- [ ] **Step 1: Write the failing literal and contrast pins**

Append to the `describe("token contract"` block in `packages/ui/src/__tests__/contract.test.ts`, after the checkbox-mark contrast loop:

```ts
  describe("pretable.css is frameless and neutral", () => {
    // The literals the 2026-09-16 frameless spec chose. Pinned so a later
    // "small tweak" cannot quietly bring the frame back.
    const LIGHT: Record<string, string> = {
      "--pretable-frame": "0",
      "--pretable-shadow-card": "none",
      "--pretable-bg-header": "#f7f7f9",
      "--pretable-bg-toolbar": "#f7f7f9",
      "--pretable-bg-group-row": "#fafafb",
      "--pretable-text-header": "#6b6b76",
      "--pretable-rule": "#ececf0",
      "--pretable-rule-header": "#e6e6eb",
      "--pretable-rule-strong": "#c2c2cb",
      "--pretable-checkbox-border": "#94949f",
      "--pretable-selection-bg": "rgba(37, 84, 207, 0.07)",
    };
    const DARK: Record<string, string> = {
      "--pretable-frame": "0",
      "--pretable-shadow-card": "none",
      "--pretable-bg-header": "#1a1a20",
      "--pretable-bg-toolbar": "#1a1a20",
      "--pretable-bg-group-row": "#17171c",
      "--pretable-text-header": "#8f8f9c",
      "--pretable-rule": "#25252c",
      "--pretable-rule-header": "#2a2a32",
      "--pretable-rule-strong": "#3a3a44",
      "--pretable-checkbox-border": "#6a6a78",
      "--pretable-selection-bg": "rgba(138, 176, 255, 0.12)",
    };

    for (const [mode, expected] of [
      ["light", LIGHT],
      ["dark", DARK],
    ] as const) {
      test(`literals (${mode})`, () => {
        const cleanup = loadCSS(path.join(THEMES_DIR, "pretable.css"));
        if (mode === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        }
        const computed = getComputedStyle(document.documentElement);
        for (const [token, value] of Object.entries(expected)) {
          expect(computed.getPropertyValue(token).trim(), token).toBe(value);
        }
        expect(
          computed.getPropertyValue("--pretable-shadow-header").trim(),
          "the scrolled seam must exist in the house theme",
        ).not.toBe("none");
        cleanup();
      });

      test(`contrast floors (${mode})`, () => {
        const cleanup = loadCSS(path.join(THEMES_DIR, "pretable.css"));
        if (mode === "dark") {
          document.documentElement.setAttribute("data-theme", "dark");
        }
        const header = resolveToken("--pretable-bg-header");
        const grid = resolveToken("--pretable-bg-grid");
        // Header ink is text: 4.5:1 on the rail it sits on.
        expect(
          contrastRatio(resolveToken("--pretable-text-header"), header),
        ).toBeGreaterThanOrEqual(4.5);
        // The checkbox border is an affordance: 3:1 on the paper.
        expect(
          contrastRatio(resolveToken("--pretable-checkbox-border"), grid),
        ).toBeGreaterThanOrEqual(3);
        cleanup();
      });
    }
  });
```

`resolveToken` and `contrastRatio` already exist in this file; if `resolveToken` returns a raw string that is not `#rrggbb` for a token, the existing helpers handle `rgb()`; hex is what the theme writes, so no change is needed.

- [ ] **Step 2: Run to see the pins fail**

Run: `pnpm --filter @pretable/ui test -- contract`
Expected: `literals (light)` fails on `--pretable-frame` expecting `0` and getting `1px solid var(--pretable-rule-strong)` (or its resolved form).

- [ ] **Step 3: Edit the light block of pretable.css**

Replace these declarations in the `:root` block (keep everything not listed):

```css
  --pretable-bg-header: #f7f7f9;
  --pretable-bg-toolbar: #f7f7f9;
  --pretable-bg-group-row: #fafafb;
  --pretable-text-header: #6b6b76;
  --pretable-rule: #ececf0;
  --pretable-rule-header: #e6e6eb;
  --pretable-rule-strong: #c2c2cb;
  --pretable-frame: 0;
  --pretable-selection-bg: rgba(37, 84, 207, 0.07);
  --pretable-checkbox-border: #94949f;
  --pretable-shadow-card: none;
  --pretable-shadow-header:
    0 1px 2px rgba(16, 17, 26, 0.06), 0 6px 12px -8px rgba(16, 17, 26, 0.18);
```

Leave `--pretable-radius: 10px;` as is: the house theme sets `--pretable-frame: 0` and `--pretable-shadow-card: none`, and with no frame and no shadow a radius on the viewport paints nothing visible except at the corners of the header tint. Set it to `0` too:

```css
  --pretable-radius: 0;
```

- [ ] **Step 4: Edit the dark block**

In `[data-theme="dark"]`, replace:

```css
  --pretable-bg-header: #1a1a20;
  --pretable-bg-toolbar: #1a1a20;
  --pretable-bg-group-row: #17171c;
  --pretable-text-header: #8f8f9c;
  --pretable-rule: #25252c;
  --pretable-rule-header: #2a2a32;
  --pretable-rule-strong: #3a3a44;
  --pretable-frame: 0;
  --pretable-selection-bg: rgba(138, 176, 255, 0.12);
  --pretable-checkbox-border: #6a6a78;
  --pretable-shadow-card: none;
  --pretable-shadow-header:
    0 1px 0 rgba(0, 0, 0, 0.6), 0 6px 12px -8px rgba(0, 0, 0, 0.7);
```

- [ ] **Step 5: Rewrite the comments that are now false**

The file's header comment and the `Lines` and `Elevation` comment blocks describe a hairline-plus-shadow container and a 3:1 `--pretable-rule-strong`. Replace the file header's paragraph beginning `The container edge is a hairline plus --pretable-shadow-card` with:

```
 * There is no container edge. The grid is frameless: --pretable-frame is 0,
 * --pretable-shadow-card is none, --pretable-radius is 0. Embedded in a host
 * page it is one plane with the page, separated from it by whitespace and by
 * the header's tint alone. The sticky header's seam against rows scrolling
 * under it is --pretable-shadow-header, drawn only while the surface reports
 * [data-pretable-scrolled]; at rest the header ends in a decorative hairline.
```

Replace the `--- Lines ---` comment block with:

```css
  /* --- Lines ----------------------------------------------------------- */
  /* The row hairline. Decorative, faint on purpose (1.15:1). */
  --pretable-rule: #ececf0;
  /* The header's resting underline: one step darker than the row hairline so
     the rail ends somewhere, still decorative. The load-bearing seam is the
     scrolled shadow in Elevation below, not this line. */
  --pretable-rule-header: #e6e6eb;
  /* One job now: the edge of lifted surfaces — menus, popovers, the editor.
     It no longer frames the container or underlines the header, so it no
     longer owes 3:1 against either. */
  --pretable-rule-strong: #c2c2cb;
  /* No frame. The compatibility skins set this to a 1px line. */
  --pretable-frame: 0;
  /* No cage. ... (keep the existing rule-vertical comment) */
  --pretable-rule-vertical: transparent;
  --pretable-rule-width: 1px;
```

Replace the `--- Radii ---` comment: `/* No frame, so nothing for a container radius to round. Controls keep theirs. */`.

In `--- Elevation ---`, replace the `--pretable-shadow-card` comment and value with:

```css
  /* The container casts nothing. It is not a card. */
  --pretable-shadow-card: none;
  /* The sticky header's seam, present only while rows are underneath it. A
     contact layer plus a short ambient; the ambient's negative spread keeps
     it under the first row instead of washing three rows. */
  --pretable-shadow-header:
    0 1px 2px rgba(16, 17, 26, 0.06), 0 6px 12px -8px rgba(16, 17, 26, 0.18);
```

Update the `--pretable-text-header` comment's quoted ratios to the measured ones (the contrast test in Step 1 computes them; print them once with a `console.log` if needed, then remove the log). Update the Tier 1 comment's `1.14:1` to the new header-on-grid ratio. Do not leave a number in a comment that the test does not compute.

- [ ] **Step 6: Run the ui suite**

Run: `pnpm --filter @pretable/ui test`
Expected: green, including the density tests and the theme-parity tests. If a parity test insists every theme restates the same set of tokens in dark mode, the dark block above restates all three new tokens, so it should pass; if it fails, it names the token to add.

- [ ] **Step 7: Format**

Run: `pnpm prettier --write packages/ui/themes/pretable.css packages/ui/src/__tests__/contract.test.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/ui/themes/pretable.css packages/ui/src/__tests__/contract.test.ts
git commit -m "feat(ui): frameless, neutral default theme

Drop the container frame, radius and card shadow; lighten the header
rail and its underline; move the sticky-header seam to a shadow keyed
on data-pretable-scrolled; lighten row hairlines and the selection tint
one step. Literals and contrast floors are pinned.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Playwright proves the seam paints

**Files:**
- Create: `apps/website/app/fixtures/scrolled-seam/page.tsx`
- Create: `apps/website/e2e/scrolled-seam.spec.ts`

- [ ] **Step 1: Write the fixture**

Create `apps/website/app/fixtures/scrolled-seam/page.tsx`:

```tsx
"use client";

import { Pretable, type PretableColumn } from "@pretable/react";

/**
 * Fixture for `apps/website/e2e/scrolled-seam.spec.ts`.
 *
 * One tall grid on the house theme, enough rows to scroll. The spec reads the
 * header's computed box-shadow at rest and after a scroll; jsdom cannot make
 * that claim because it computes no box-shadow from a token that a data
 * attribute rule supplies.
 */

type Row = { id: string; name: string; amount: number };

const ROWS: Row[] = Array.from({ length: 300 }, (_, i) => ({
  id: `r${i}`,
  name: `Payment ${i}`,
  amount: (i * 37) % 5000,
}));

const COLUMNS: PretableColumn<Row>[] = [
  { id: "name", header: "Payment", type: "text", widthPx: 240 },
  { id: "amount", header: "Amount", type: "number", widthPx: 140 },
];

export default function Page() {
  return (
    <main style={{ padding: 32 }}>
      <Pretable<Row>
        ariaLabel="Scrolled seam"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(row) => row.id}
        height={320}
      />
    </main>
  );
}
```

Match the component name and prop names to the sibling fixture `apps/website/app/fixtures/overlay-scope/page.tsx` (it uses `PretableSurface`; use whichever of `Pretable` or `PretableSurface` that file imports and its `height` prop spelling). The fixtures layout at `apps/website/app/fixtures/layout.tsx` already loads the house theme.

- [ ] **Step 2: Write the failing spec**

Create `apps/website/e2e/scrolled-seam.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

import { waitForGridReady } from "./helpers";

/**
 * The house theme is frameless, so the sticky header's only seam against rows
 * scrolling under it is a shadow keyed on `data-pretable-scrolled`. This
 * asserts the PAINTED longhand on the real component, per the
 * prove-the-pixel rule: a rule that matches and a token that resolves are
 * not proof anything draws.
 */

const FIXTURE = "/fixtures/scrolled-seam";

test("the header casts a seam only while scrolled", async ({ page }) => {
  await page.goto(FIXTURE);
  await waitForGridReady(page);

  const viewport = page.locator("[data-pretable-scroll-viewport]").first();
  const header = viewport.locator("[data-pretable-header-row]").first();

  await expect(viewport).not.toHaveAttribute("data-pretable-scrolled");
  await expect
    .poll(() => header.evaluate((el) => getComputedStyle(el).boxShadow))
    .toBe("none");

  await viewport.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(viewport).toHaveAttribute("data-pretable-scrolled", "");
  await expect
    .poll(() => header.evaluate((el) => getComputedStyle(el).boxShadow))
    .not.toBe("none");

  // The container itself is frameless.
  const frame = await viewport.evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: s.borderTopWidth, shadow: s.boxShadow, radius: s.borderTopLeftRadius };
  });
  expect(frame).toEqual({ border: "0px", shadow: "none", radius: "0px" });

  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await expect(viewport).not.toHaveAttribute("data-pretable-scrolled");
  await expect
    .poll(() => header.evaluate((el) => getComputedStyle(el).boxShadow))
    .toBe("none");
});
```

- [ ] **Step 3: Build and run it locally**

Per `reference_local_smoke_run`: build the packages, then the site, then start it, then run with one worker.

```bash
pnpm --filter @pretable/ui build && pnpm --filter @pretable/react build && pnpm --filter website build
```

```bash
pnpm --filter website start &
```

```bash
BASE_URL=http://localhost:3000 pnpm --filter website exec playwright test scrolled-seam.spec.ts --workers=1
```

Expected: PASS. If `boxShadow` at rest is not the string `"none"` but an empty string, the browser is reporting the unset longhand; change both `.toBe("none")` to `.toMatch(/^(none|)$/)` and keep the scrolled assertion as `.not.toMatch(/^(none|)$/)`.

- [ ] **Step 4: Mutation-test**

In `packages/ui/grid.css` temporarily delete the `[data-pretable-scrolled]` rule, rebuild ui, react and website, re-run the spec. Expected: fails on the scrolled `boxShadow` poll. Restore the rule and rebuild.

- [ ] **Step 5: Kill the server and commit**

```bash
kill %1
```

```bash
git add apps/website/app/fixtures/scrolled-seam apps/website/e2e/scrolled-seam.spec.ts
git commit -m "test(website): prove the frameless header seam paints on scroll

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Docs, attribute table, example theme, changeset

**Files:**
- Modify: `apps/website/content/docs/theming/token-reference.mdx`
- Modify: `apps/website/content/docs/theming/index.mdx`, `custom-themes.mdx`, `pick-a-theme.mdx`, `override-tokens.mdx`
- Modify: `apps/website/content/docs/grid/index.mdx:89`
- Modify: `apps/website/content/examples/custom-theme/brand.css`
- Create: `.changeset/frameless-default-theme.md`

- [ ] **Step 1: Run the docs guard to see what it demands**

Run: `pnpm --filter website test -- docs-api-surface`
Expected: fails naming the three tokens in `TOKENS` that `theming/token-reference.mdx` does not document. Read the failure text; it names the section heading count convention too.

- [ ] **Step 2: Token reference tables**

In `token-reference.mdx`, the `## Lines and radii (6)` heading becomes `## Lines and radii (8)` and its table gains two rows after `--pretable-rule-strong`:

```md
| `--pretable-rule-header`    | Header row bottom border at rest                  | color  | `#e6e6eb`          | `var(--pretable-rule-strong)` | `var(--pretable-rule-strong)` |
| `--pretable-frame`          | Container outer edge (border shorthand)           | border | `0`                | `1px solid var(--pretable-rule-strong)` | `1px solid var(--pretable-rule-strong)` |
```

Update the existing rows: `--pretable-rule` pretable value to `#ececf0`; `--pretable-rule-strong` description to `Edge of lifted surfaces (menus, popovers, editor)` and pretable value to `#c2c2cb`; `--pretable-radius` pretable value to `0`.

The `## Elevation (3)` heading becomes `## Elevation (4)` and its table gains:

```md
| `--pretable-shadow-header`  | Sticky header seam while `[data-pretable-scrolled]` | shadow | `0 1px 2px rgba(16, 17, 26, 0.06), 0 6px 12px -8px rgba(16, 17, 26, 0.18)` | `none` | `none` |
```

Update `--pretable-shadow-card` pretable value to `none`. Replace the callout beginning `> \`--pretable-shadow-card\` lets a theme separate the grid` with:

```md
> The `pretable` theme is frameless: `--pretable-frame` is `0`, `--pretable-shadow-card` is `none`, and the grid is one plane with the page it sits in. Its sticky header separates from the rows sliding under it with `--pretable-shadow-header`, which `grid.css` draws only while the viewport carries `data-pretable-scrolled`. Both compatibility skins draw a frame instead and set the header shadow to `none`.
```

Update the Surfaces table's `--pretable-bg-header`, `--pretable-bg-toolbar`, `--pretable-bg-group-row` pretable values to `#f7f7f9`, `#f7f7f9`, `#fafafb`; the Text table's `--pretable-text-header` to `#6b6b76`; the Grid controls table's `--pretable-checkbox-border` to `#94949f` and `--pretable-selection-bg` to `rgba(37, 84, 207, 0.07)`. Verify each by grepping the theme, not from memory:

```bash
grep -n "bg-header\|bg-toolbar\|bg-group-row\|text-header\|checkbox-border\|selection-bg\|rule:" packages/ui/themes/pretable.css
```

- [ ] **Step 3: The token count**

The contract grows from 50 to 53. Update every prose mention:

```bash
grep -rn "50 tokens\|50-token" apps/website/content/docs | cut -d: -f1,2
```

Change each to `53 tokens` / `53-token`. In `theming/index.mdx` also update the grouped list: `Lines and radii (8)` adding `rule-header`, `frame`; `Elevation (4)` adding `shadow-header`; the ASCII box line `50 tokens defined` to `53 tokens defined`; and the paragraph at line 83 listing what the dark block restates to name all four of `shadow-overlay`, `shadow-card`, `shadow-header`, `seam-color`.

- [ ] **Step 4: The example theme**

`apps/website/content/examples/custom-theme/brand.css` claims to define every token. Add, in its light block next to `--pretable-rule-strong`:

```css
  --pretable-rule-header: var(--pretable-rule-strong);
  --pretable-frame: 1px solid var(--pretable-rule-strong);
```

and next to `--pretable-shadow-card`:

```css
  --pretable-shadow-header: none;
```

Restate `--pretable-shadow-header: none;` in its dark block if that block restates `--pretable-shadow-card`. Run `pnpm --filter website test -- custom-theme` if a test pins that example's completeness; the guard run in Step 6 catches it otherwise.

- [ ] **Step 5: The attribute table**

In `apps/website/content/docs/grid/index.mdx`, directly after the `[data-pretable-hydrated]` row:

```md
| `[data-pretable-scrolled]`          | the scrollable container                         | Present (empty string) while `scrollTop > 0`; the `pretable` theme draws the sticky header's seam shadow only while it is set                                                                    |
```

- [ ] **Step 6: Run the docs guard and the website unit suite**

Run: `pnpm --filter website test`
Expected: green. If the guard reports a `Lines and radii` count mismatch, the heading count and the row count disagree; fix the heading.

- [ ] **Step 7: Changeset**

Create `.changeset/frameless-default-theme.md`:

```md
---
"@pretable/ui": minor
"@pretable/react": minor
---

The default `pretable` theme is now frameless and neutral. The container draws no border, radius or shadow; the header rail is lighter and its resting underline is a hairline; row hairlines and the selection tint are one step lighter. The sticky header's seam against scrolling rows is a shadow drawn only while the viewport carries the new `data-pretable-scrolled` attribute, which `@pretable/react` publishes at `scrollTop > 0`. Three tokens are added to the contract: `--pretable-frame`, `--pretable-rule-header`, `--pretable-shadow-header`. Excel and Material are visually unchanged.
```

- [ ] **Step 8: Commit**

```bash
git add apps/website/content .changeset/frameless-default-theme.md
git commit -m "docs: document the frameless default theme and data-pretable-scrolled

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: API report, full verification, screenshots, PR

**Files:**
- Modify: `packages/*/etc/*.api.md` only if `pnpm api` changes them (it should not; no TS export changed).

- [ ] **Step 1: Clean build and API check**

```bash
pnpm build && pnpm api && git status --short
```

Expected: no `.api.md` changes. If there are, inspect them; a change means a public type moved, which this work does not do, so investigate before committing.

- [ ] **Step 2: Full test run**

```bash
pnpm test
```

Expected: green. Re-run any single timed-out react file before believing a failure.

- [ ] **Step 3: Look at it**

Start the built site (`pnpm --filter website start`) and open, in the built-in browser, `http://localhost:3000/fixtures/scrolled-seam` in light and then with `data-theme="dark"` set on `<html>` via the console. Then open the homepage hero grid (see `reference_website_showcase_browser_access` for reaching showcase grids). Take a screenshot of each and send them to the user with `SendUserFile`. What to check by eye:

- No frame, no radius, no shadow on the grid at rest.
- The header rail is a whisper lighter than the page, its underline barely visible.
- Scroll: a soft shadow appears under the header and disappears at the top.
- Dark mode: the seam is visible, the header is not lighter than the rows.
- The tool panel, if a page shows it, has no frame either and its rail meets the grid at a hairline.

If anything looks wrong, fix the token in `pretable.css`, update the pinned literal in `contract.test.ts` in the same commit, and re-run `pnpm --filter @pretable/ui test`.

- [ ] **Step 4: Commit any screenshot-driven fix, then push and open the PR**

```bash
git push -u origin blove/pretable-visual-aesthetics-4fb28d
```

```bash
gh pr create --title "feat: frameless, neutral default theme" --body "$(cat <<'EOF'
## Summary

- The default `pretable` theme drops its container frame, radius and card shadow, lightens the header rail and row hairlines, and moves the sticky-header seam to a shadow drawn only while scrolled.
- `@pretable/react` publishes `data-pretable-scrolled` on the scroll viewport at `scrollTop > 0`.
- Three tokens join the contract (`--pretable-frame`, `--pretable-rule-header`, `--pretable-shadow-header`); Excel and Material declare them at today's values and are visually unchanged.

Spec: `docs/superpowers/specs/2026-09-16-frameless-neutral-default-theme-design.md`

## Verification

- Contract test pins every changed literal and the 4.5:1 header-ink and 3:1 checkbox-border floors in both modes.
- Cascade guard pins the token reads and was mutation-tested by restoring the literal frame and by deleting the scrolled rule.
- Playwright `scrolled-seam.spec.ts` asserts the computed `box-shadow` on the real header at rest and after scroll, and the computed frame longhands on the viewport.
- Docs guard green with the token count at 53.

Out of scope, filed separately: columns not filling the container width in the motivating screenshot.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: File the column-fill follow-up**

```bash
gh issue create --title "Default column sizing leaves unused width in an embedded grid" --body "In an embedded grid (incoming-payments panel screenshot, 2026-09-16) the six columns end at ~1110px inside a ~1400px container, leaving a blank band on the right. Theming was fixed separately in the frameless-default-theme PR; this is the sizing default. Decide whether the last column should flex to fill, or whether a fill mode should be opt-in."
```

- [ ] **Step 6: Bind the PR and watch CI**

Use the `mcp__ccd_pr__bind_pr` tool with the PR number, read its status, and merge on green. A `Vercel – pretable` check is a misconfiguration, not a gate; the required checks are the GitHub Actions ones plus the preview smoke test.

---

## Self-review

**Spec coverage.** Container (Task 1 tokens, Task 3 values); header tint and `--pretable-rule-header` (Tasks 1, 3); scrolled seam attribute, rule, token (Tasks 1, 2, 3, 4); rows, selection, checkbox border with its 3:1 floor (Task 3); Excel and Material unchanged (Task 1 aliases, pinned by the existing parity tests); docs tables, count, attribute table, example theme (Task 5); screenshots and eyeballing (Task 6); column-fill follow-up filed (Task 6 Step 5). The spec's `--pretable-radius` stays a public token; Task 3 sets the house value to 0 and Task 5 documents it. Sequencing matches the spec's five commits plus one for the PR.

**Placeholders.** None. Every code step shows the code. The two places that say "match the sibling file's prop names" name the file and keep the assertions fixed.

**Consistency.** Attribute name is `data-pretable-scrolled` everywhere. Token names are `--pretable-frame`, `--pretable-rule-header`, `--pretable-shadow-header` everywhere. The cascade regex in Task 1 and the rule written in Task 1 Step 5 use the same selector text. The z-index note in Task 1 Step 5 tells the implementer to check the existing header rule rather than assume.
