# Row Grouping SP3 — The Drag-to-Group Panel: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A strip above the header where columns are dropped to group by them,
showing the active grouping levels as chips that can be reordered and removed by
mouse and by keyboard — plus a real column menu so grouping is reachable without
a pointer.

**Architecture:** `PretableSurface` grows an outer wrapper (its root is
currently the scroll viewport itself and carries `role="grid"`, so the panel
cannot live inside it). The panel is a pure projection of `snapshot.rowGroups`
with no state of its own. The existing header reorder drag gains a second drop
zone; chip drags capture on the stable panel container rather than on a chip.
All mutations commit on drop, never on drag-leave.

**Tech Stack:** TypeScript, React 19, Vitest + Testing Library (jsdom),
Playwright (Chromium + WebKit), api-extractor, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-07-row-grouping-panel-design.md` — read
it before starting. It records _why_ several obvious implementations are wrong.

---

## Status — Tasks 1, 2 and 3 are DONE (`e22fd88`, `d747d0c`, `8c5a573`, `9d8dfd1`)

React is at **716 passing (41 files)**, up from 682. Nine negative controls run.

**What later tasks depend on:**

1. **`applyRowGroups` in `pretable-surface.tsx` is the single commit funnel.**
   It calls `setRowGroups` and then reports `getSnapshot().rowGroups` — the
   _sanitized_ list, not the argument. Tasks 4, 5 and 6 must call it rather than
   touching the engine directly.
2. **`group-panel-model.ts` helpers, with their edge semantics:** `moveGroupLevel`
   refuses an out-of-range index; `insertGroupLevel` **clamps** (it is a drop
   position) and **moves rather than duplicates** an already-grouped column. Each
   returns the original array reference on a no-op, which is how "no wrap at the
   ends" falls out for free. Drag paths must reuse these, not reimplement them.
3. **Chips emit `data-pretable-column-id` and `data-pretable-chip-label`** in
   addition to the Task 2 table.
4. **`--pretable-group-panel-height` is NOT yet defined in either theme.** Task 1
   was scoped out of `packages/ui/`, so the React side reads it reactively with a
   documented 36px fallback. **Task 7 must still add it** to both themes across
   all three density tiers; the values then flow through with no React change.

**Two test-integrity findings:**

- Task 2's empty-message snippet as I wrote it was **vacuous**: the rerender
  dropped `emptyMessage`, so the query would have returned null because the prop
  vanished, not because grouping appeared. Fixed in place.
- **"Focus follows the moved chip" is not provable in jsdom** — jsdom does not
  drop focus when React re-inserts a keyed node to reorder it, but real browsers
  do. The refocus effect is therefore only half-covered: its negative control
  fires on the post-removal test but not on the reorder one. Task 8 must add a
  keyboard assertion (see its Step 2, item 6).

**Known and accepted:** the ✕ sits inside `role="option"`, whose children ARIA
treats as presentational, so it is not reachable by a screen reader's own means.
That is exactly why the `Delete` binding exists. Do not "fix" this by moving the
button out of the option — it is documented at the call site.

---

## Ground rules for every task

- **Vanilla CSS in `packages/*`.** No Tailwind. `:where()` + existing
  `--pretable-*` tokens. New tokens go in **both** `themes/excel.css` and
  `themes/material.css`, in **all three density tiers** each — a token in one
  theme silently resolves to nothing in the other.
- **No backcompat shims.** Pre-1.0. Rename and replace; never alias.
- **jsdom has no layout engine.** Every claim about a _rectangle_ — which drop
  zone the pointer is in, where a chip sits — is a Playwright assertion or it is
  not verified. Right-pin shipped measurably broken past 316 green jsdom tests.
- **Negative control on every behavioural test.** Delete the one line the test
  targets, confirm it fails, restore. Three vacuous tests were found in this repo
  recently; SP2's agents ran 20 controls and every one fired. Match that bar.
- `pnpm format:write` before each commit (`pnpm format` is check-only).
- Test files are typechecked — a type error in a `.test.tsx` fails the build.

---

## File Structure

**Create:**

- `packages/react/src/group-panel/GroupPanel.tsx` — the panel and its chips.
- `packages/react/src/group-panel/group-panel-model.ts` — pure helpers:
  `moveGroupLevel(rowGroups, from, to)`, `removeGroupLevel`, `insertGroupLevel`,
  and the chip's accessible-name composer. Split out so the drag and keyboard
  paths share one implementation and it can be unit-tested without a DOM.
- `packages/react/src/column-menu/ColumnMenu.tsx` — `role="menu"` popover.
- `packages/react/src/column-menu/MenuButton.tsx` — the `⋮` header button.
- `packages/react/src/__tests__/group-panel.test.tsx`
- `packages/react/src/__tests__/group-panel-model.test.ts`
- `packages/react/src/__tests__/column-menu.test.tsx`

**Modify:**

- `packages/react/src/pretable-surface.tsx` — outer wrapper, height accounting,
  the panel render, the second drop zone on the existing reorder drag
  (`:2329-2453`), and the menu button in the overlay strip (`:2621-2650`).
- `packages/react/src/filter-menu/useFilterPopover.ts` → generalize; both the
  filter dialog and the column menu use it.
- `packages/react/src/styles.ts` — panel style helper.
- `packages/ui/src/grid.css`, `themes/excel.css`, `themes/material.css`.
- `apps/website/app/fixtures/grouping/page.tsx`, `apps/website/e2e/grouping.spec.ts`.

---

## Task 1: Outer wrapper, props, and height accounting

No panel UI yet — this task only makes room for it and proves nothing regressed.

**Files:**

- Modify: `packages/react/src/pretable-surface.tsx:1819-1832` (root),
  `:779` (`bodyViewportHeight`), `PretableSurfaceProps` (`:341-476`)
- Modify: `packages/react/src/styles.ts`
- Test: `packages/react/src/__tests__/group-panel.test.tsx`

**The structural fact that drives this.** The surface's root element _is_ the
scroll viewport: it carries `data-pretable-scroll-viewport`, `overflow: auto`,
`contain: content`, and `role="grid"`/`"treegrid"`. The panel cannot go inside it
(invalid ARIA inside a `grid` role, and `minWidth: totalWidth` would scroll it
sideways with the data). So add a wrapper _around_ it and change nothing about
the existing root.

- [ ] **Step 1: Write the failing tests**

```tsx
it("without groupPanel, the root is still the scroll viewport", () => {
  const view = renderGrid();
  const root = view.container.firstElementChild!;
  expect(root).toHaveAttribute("data-pretable-scroll-viewport");
});

it("with groupPanel, the viewport is wrapped and keeps every attribute", () => {
  const view = renderGrid({ groupPanel: { enabled: true } });
  const root = view.container.firstElementChild!;
  expect(root).toHaveAttribute("data-pretable-group-panel-wrapper");
  const viewport = root.querySelector("[data-pretable-scroll-viewport]")!;
  expect(viewport).toHaveAttribute("role", "grid");
  expect(viewport).toHaveAttribute("aria-label", "test-grid");
});

it("the panel consumes from viewportHeight rather than adding to it", () => {
  // The component must occupy exactly `viewportHeight` either way, so a
  // consumer's layout does not shift when they enable the panel.
  const plain = renderGrid({ viewportHeight: 400 });
  const plainVp = plain.container.querySelector(
    "[data-pretable-scroll-viewport]",
  ) as HTMLElement;
  expect(plainVp.style.height).toBe("400px");

  cleanup();
  const panelled = renderGrid({
    viewportHeight: 400,
    groupPanel: { enabled: true },
  });
  const vp = panelled.container.querySelector(
    "[data-pretable-scroll-viewport]",
  ) as HTMLElement;
  expect(parseInt(vp.style.height, 10)).toBeLessThan(400);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @pretable/react test group-panel
```

- [ ] **Step 3: Implement**

Add to `PretableSurfaceProps`:

```ts
/** Show the drag-to-group panel above the header. */
groupPanel?: { enabled: boolean; emptyMessage?: string };
/**
 * Called after the panel or the column menu mutates the grouping. Receives
 * the engine's full ordered list (index = grouping level; `[]` = ungrouped).
 * Programmatic `grid.setRowGroups` does not fire it, matching `moveColumn`.
 */
onRowGroupsChange?: (rowGroups: string[]) => void;
```

When `groupPanel?.enabled`, wrap the existing root in a
`data-pretable-group-panel-wrapper` div and subtract the panel height from
`bodyViewportHeight` (`:779`) and from the viewport's own style height. When it
is not enabled, render exactly what is rendered today — no wrapper.

Add a `--pretable-group-panel-height` token (both themes, all three tiers) and a
`getGroupPanelStyle` helper in `styles.ts`.

- [ ] **Step 4: Verify green**

```bash
pnpm --filter @pretable/react test
```

All 682 existing tests must still pass — the no-panel path is unchanged.

- [ ] **Step 5: Negative control**

Remove the height subtraction; confirm the third test fails. Restore.

- [ ] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): outer wrapper and props for the group panel"
```

---

## Task 2: The panel and its chips

**Files:**

- Create: `packages/react/src/group-panel/GroupPanel.tsx`,
  `packages/react/src/group-panel/group-panel-model.ts`
- Test: `packages/react/src/__tests__/group-panel.test.tsx`,
  `packages/react/src/__tests__/group-panel-model.test.ts`

**The panel holds no state.** It is a pure projection of `snapshot.rowGroups`,
re-read every render. The only transient state SP3 ever adds is the in-flight
drag's insertion index (Task 5). Copy this from ag-grid wholesale — it is the
one design decision in their implementation that is unambiguously right.

- [ ] **Step 1: Write the failing tests**

Pure helpers first, in `group-panel-model.test.ts` — `moveGroupLevel`,
`removeGroupLevel`, `insertGroupLevel`, each with an out-of-range and a no-op
case. Then the component:

```tsx
it("is role=presentation when empty and role=listbox when it has chips", () => {
  // A listbox with zero options fails axe, which is why this flips rather than
  // being statically `listbox`.
  const view = renderGrid({ groupPanel: { enabled: true } });
  expect(panel(view)).toHaveAttribute("role", "presentation");

  view.rerender(
    <Grid groupPanel={{ enabled: true }} state={{ rowGroups: ["sector"] }} />,
  );
  expect(panel(view)).toHaveAttribute("role", "listbox");
});

it("shows the empty message only when ungrouped", () => {
  const view = renderGrid({
    groupPanel: { enabled: true, emptyMessage: "Drop here" },
  });
  expect(view.getByText("Drop here")).toBeInTheDocument();

  view.rerender(
    <Grid groupPanel={{ enabled: true }} state={{ rowGroups: ["sector"] }} />,
  );
  expect(view.queryByText("Drop here")).toBeNull();
});

it("chips carry position in the set for screen readers", () => {
  const view = renderGrid({
    groupPanel: { enabled: true },
    state: { rowGroups: ["sector", "industry"] },
  });
  const chips = view.getAllByRole("option");
  expect(chips).toHaveLength(2);
  expect(chips[0]).toHaveAttribute("aria-posinset", "1");
  expect(chips[0]).toHaveAttribute("aria-setsize", "2");
  expect(chips[1]).toHaveAttribute("aria-posinset", "2");
});

it("the ✕ removes that level and reports the new list", () => {
  const onRowGroupsChange = vi.fn();
  const view = renderGrid({
    groupPanel: { enabled: true },
    state: { rowGroups: ["sector", "industry"] },
    onRowGroupsChange,
  });
  fireEvent.click(
    view
      .getAllByRole("option")[0]
      .querySelector("[data-pretable-chip-remove]")!,
  );
  expect(onRowGroupsChange).toHaveBeenCalledWith(["industry"]);
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @pretable/react test group-panel
```

- [ ] **Step 3: Implement**

Chip anatomy: a drag handle, the label, and a `✕` button. Emit these exactly —
Task 7's stylesheet and the tests both key on them:

| Element                         | Attribute                           |
| ------------------------------- | ----------------------------------- |
| the panel                       | `data-pretable-group-panel`         |
| a chip                          | `data-pretable-group-chip`          |
| its drag handle                 | `data-pretable-chip-handle`         |
| its remove button               | `data-pretable-chip-remove`         |
| the empty message               | `data-pretable-group-panel-empty`   |
| the drag gap indicator (Task 5) | `data-pretable-chip-drop-indicator` |

The chip's **visible label must be `aria-hidden`**, with the accessible name
composed onto the `role="option"` root (name + position + available keys).
Otherwise a screen reader reads the column name twice and never announces the
key hints.

Default `emptyMessage`: `"Drag a column here to group by it"`.

- [ ] **Step 4: Verify green** — `pnpm --filter @pretable/react test`

- [ ] **Step 5: Negative control**

Force the role to a constant `listbox`; confirm the role-flip test fails. Restore.

- [ ] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): group panel with projected chips"
```

---

## Task 3: Chip keyboard model

**Files:** modify `GroupPanel.tsx`; extend `group-panel.test.tsx`.

Matching ag-grid's model, which is real and working — this is not a place where
shipping less is acceptable.

| Key                        | Effect                          |
| -------------------------- | ------------------------------- |
| `ArrowLeft` / `ArrowRight` | move focus between chips        |
| `Shift` + arrow            | move the focused grouping level |
| `Delete` / `Backspace`     | remove the focused level        |

Each reduces to one `setRowGroups` with a rearranged array, via the Task 2
helpers.

- [ ] **Step 1: Write the failing tests** — one per row of that table, plus:
  - `Shift+ArrowLeft` on the first chip is a no-op (not a wrap)
  - focus follows the moved chip, so repeated `Shift+ArrowRight` walks it along
  - `Delete` on the last remaining chip empties the panel and flips the role
    back to `presentation`

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement.** Roving tabindex: the focused chip is `tabIndex={0}`,
      the rest `-1`.

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Negative controls — one per binding.** Remove each branch
      individually and confirm only its own tests fail.

- [ ] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): keyboard reorder and removal of grouping levels"
```

---

## Task 4: Header → panel drag

**Files:** modify `pretable-surface.tsx:2329-2453` (the existing reorder drag).

The header already has a complete pointer drag: 5px threshold
(`REORDER_THRESHOLD_PX`, `:252`), capture on the header button, live
`computeColumnDropTarget`, Escape cancel at `:1833-1843`, and a
`wasReorderingRef` guard so the trailing click does not sort. **Extend it. Do
not write a second drag.**

The drop zone is decided purely by which rectangle the pointer is over — panel
rect ⇒ group, header/body rect ⇒ reorder, neither ⇒ nothing. No modifier key.

- [ ] **Step 1: Write the failing tests**

jsdom can assert the _plumbing_ (that a pointerup while the panel reports a hit
calls `setRowGroups`) but **not** the rect test itself — jsdom has no layout, so
`getBoundingClientRect` returns zeros. Write the jsdom tests against an injected
hit-test result, and put the real geometry in Task 8's Playwright spec. Say so
in a comment in the test file, so the next reader does not mistake these for
proof that the disambiguation works.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

Two rules from the research that are easy to get wrong:

- **The ghost must keep `pointer-events: none`** (`packages/ui/src/grid.css:341-362`),
  or it sits under the cursor and makes both drop zones unhittable.
- **A hidden or zero-size panel must be excluded from hit-testing**, not just
  visually hidden — otherwise a collapsed panel silently swallows drops.

**Commit on drop only.** Nothing calls `setRowGroups` before pointerup. Escape
and pointercancel restore the pre-drag state. Do not copy ag-grid's
mutate-on-drag-leave model (`pillDropZonePanel.ts:386-403`) — see the spec.

- [ ] **Step 4: Verify green** — all existing reorder tests must still pass
      (`pretable-surface.test.tsx:3854+`, ~12 cases).

- [ ] **Step 5: Negative control** — make the panel hit-test always return false;
      confirm the grouping tests fail and every reorder test still passes. Restore.

- [ ] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): drag a column header onto the group panel"
```

---

## Task 5: Chip reorder by drag

**Files:** modify `GroupPanel.tsx`.

**Do not capture the pointer on the chip.** Chips re-render as the insertion
index changes, and a capture on a node React moves or replaces is lost
mid-gesture. Capture on the **panel container**, which is stable, and listen on
the document. This is the single most important structural rule in this task —
ag-grid's entire drag service exists in the shape it does because of it
(`baseDragService.ts:161-176`).

Capture the dragged column **id** at drag start rather than reading it from the
chip during the drag, for the same reason.

- [ ] **Step 1: Write the failing tests** — drag chip 0 past chip 1 reorders and
      reports; releasing outside the panel is a no-op (**not** a removal — that is
      ag-grid's behaviour and we are deliberately not copying it); Escape mid-drag
      restores the original order.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement.** Insertion feedback is a gap indicator between chips.

- [ ] **Step 4: Verify green**

- [ ] **Step 5: Negative controls** — move the capture onto the chip and confirm
      a reorder test fails or the gesture breaks; remove the Escape branch and
      confirm its test fails. Restore both.

- [ ] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): reorder grouping levels by dragging chips"
```

---

## Task 6: The column menu

**Files:**

- Create: `packages/react/src/column-menu/ColumnMenu.tsx`, `MenuButton.tsx`
- Modify: `packages/react/src/filter-menu/useFilterPopover.ts` (generalize),
  `pretable-surface.tsx:2621-2650` (the overlay strip)
- Test: `packages/react/src/__tests__/column-menu.test.tsx`

**There is no column menu today.** The only header popover is `FilterMenu` —
`role="dialog"`, filter-specific form controls, no `role="menu"` or `menuitem`
anywhere in the package. Build one; reuse `useFilterPopover`'s positioning,
`OverlayPortal`, outside-click and Escape handling by **generalizing** it, not
by duplicating it. Leave the funnel and the filter dialog untouched.

Note `FunnelButton` stops propagation on `pointerdown` (`FunnelButton.tsx:19-51`)
— without it the document outside-click listener closes the menu and the
following click reopens it, so it can never be dismissed by its own button. The
menu button needs the same guard, and there is a test pinning that behaviour for
the funnel to copy.

Which item shows, per the spec:

| Column                                | Item                     |
| ------------------------------------- | ------------------------ |
| ungrouped                             | **Group by this column** |
| grouped, `hideGroupedColumns: false`  | **Ungroup this column**  |
| grouped, default (no header rendered) | n/a                      |
| the derived group column              | no menu at all           |

- [ ] **Step 1: Write the failing tests** — each row of that table; the menu is
      `role="menu"` with `role="menuitem"` children; Escape closes and returns focus
      to the button; clicking Group by fires `onRowGroupsChange` with the column
      appended.

- [ ] **Step 2: Run and watch them fail**

- [ ] **Step 3: Implement**

- [ ] **Step 4: Verify green** — the existing filter-menu tests must all still
      pass; generalizing the hook must not change its behaviour.

- [ ] **Step 5: Negative control** — remove the `pointerdown` stop-propagation
      and confirm the "closes on a click on its own button" test fails. Restore.

- [ ] **Step 6: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(react): column menu with group by / ungroup"
```

---

## Task 7: Styling

**Files:** `packages/ui/src/grid.css`, `themes/excel.css`, `themes/material.css`.

- [ ] **Step 1: Add tokens to BOTH themes, ALL THREE density tiers each.**
      `--pretable-group-panel-height` and any chip spacing token. Consult
      `excel.css` (`:root` compact, `[data-density="standard"]`,
      `[data-density="spacious"]`) and `material.css` (`:root` standard,
      `[data-density="compact"]`, `[data-density="spacious"]`).

- [ ] **Step 2: Add the rules to `grid.css`**, inside `@layer pretable`, using
      `:where()`. Panel strip, chip, drag handle, remove button, empty message, the
      drag gap indicator, and a `:focus-visible` ring on chips consistent with the
      rest of the grid.

- [ ] **Step 3: Verify** — `pnpm --filter @pretable/ui test` (the token contract
      test asserts every `var(--pretable-*)` in `grid.css` resolves at `:root` under
      each theme; if you add a _runtime_ var like the drag index, add it to
      `RUNTIME_VARS` in `packages/ui/src/__tests__/contract.test.ts` with a comment,
      as `--pretable-group-depth` did).

- [ ] **Step 4: Negative control** — delete one new token from one theme and
      confirm the contract test fails. Restore.

- [ ] **Step 5: Commit**

```bash
pnpm format:write && git add -A && git commit -m "feat(ui): style the group panel and its chips"
```

---

## Task 8: Real-browser verification, API report, full validation

**Files:** `apps/website/app/fixtures/grouping/page.tsx`,
`apps/website/e2e/grouping.spec.ts`.

**This is where the disambiguation is actually proven.** Everything in Tasks 4
and 5 passed in jsdom, and jsdom returns zeros from `getBoundingClientRect` — a
drop-zone rect test cannot be verified there at all.

- [ ] **Step 1: Extend the fixture** with `groupPanel={{ enabled: true }}` and at
      least one ungrouped column to drag in.

- [ ] **Step 2: Write the browser spec.** In Chromium and WebKit:

  1. Dragging an ungrouped header onto the panel adds that grouping level.
  2. Dragging a header **to the header row still reorders and does not group** —
     the disambiguation only exists as a rect test, so this is the assertion that
     proves it.
  3. Dragging a chip past another reorders the levels.
  4. **Escape mid-drag leaves grouping exactly as it was** — the behaviour we
     deliberately do differently from ag-grid.
  5. Releasing over neither zone changes nothing.
  6. **`Shift+ArrowRight` twice walks the same level two places** — focus must
     travel with the chip. This is the only place that can be verified: jsdom
     does not drop focus when React re-inserts a keyed node to reorder it, but
     browsers do, so the refocus effect is untestable in the unit suite.

  Follow `apps/website/e2e/smoke.spec.ts:885-983`: `waitForStablePosition`, the
  retry grab loop, and `mouse.move(..., { steps: 3 })` — WebKit only engages
  pointer capture after intermediate positions, so a single jump silently never
  starts the drag.

- [ ] **Step 3: Run it**

```bash
pnpm --filter @pretable/app-website exec playwright test grouping --workers=1
```

(There is no `test:e2e` script — the package is `@pretable/app-website` and the
script is `smoke`. Needs a production build and `next start`; see the fixture
notes from SP2.)

- [ ] **Step 4: Negative control** — make the panel hit-test always return true
      and confirm assertion 2 fails (a header-row drop would then also group).
      Restore.

- [ ] **Step 5: Refresh the API report**

```bash
pnpm build && pnpm api
```

New public surface: `groupPanel`, `onRowGroupsChange`. Build **before** `api` —
a stale `dist/` silently strips exports and `api:check` will not catch it.
Re-run until it is a clean no-op; "API Extractor — report freshness" is a
required gate.

- [ ] **Step 6: Full validation**

```bash
pnpm build && pnpm typecheck && pnpm lint && pnpm format && pnpm test
```

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "test(grouping): browser verification of the panel; refresh API report"
```

---

## Definition of done

- An enabled panel shows above the header, always visible, with an empty message
  when ungrouped, and consumes from `viewportHeight` rather than adding to it.
- A column can be grouped by dragging its header onto the panel or via the
  column menu; ungrouped via the chip ✕ or the menu.
- Levels reorder by dragging chips and by `Shift`+arrow; `Delete` removes.
- The panel is `role="listbox"` only when non-empty; chips are `role="option"`
  with `aria-posinset`/`aria-setsize` and an accessible name that is not a
  duplicate of the visible text.
- Escape mid-drag restores the pre-drag grouping, in a real browser.
- Playwright proves a header-row drop reorders and a panel drop groups.
- `onRowGroupsChange` fires for every UI mutation and never for programmatic
  `grid.setRowGroups`.
- `pnpm api` is a clean no-op; the five validation commands pass.
- Every negative control listed above has been run and fired.

## Out of scope — do not build

Per-chip aggregation pickers, panel autoscroll on overflow (chips wrap), locked
grouping levels, click-a-chip-to-sort, RTL insertion-index flipping, and
docs/hero adoption (SP4). Each is justified in the spec's "Deliberately not
doing" section.
