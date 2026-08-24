# Tool Panel SP1 — Shell + Columns Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the tool panel's rail-and-pane shell on `PretableSurface`, on by default, with the columns section (visibility, pinning, reorder, search, reset) — plus the one engine capability it needs, column visibility.

**Architecture:** Column visibility lands in `grid-core`'s `columnLayout` as a `hidden` flag, filtered out at the react side's drawn-order projections so the span-resolving consumers inherit correctness. The shell is React-owned chrome (`{ activeSection }`) rendered as a vertical `tablist` rail plus a full-height pane docked at the surface's right edge; sections register through an internal typed descriptor so SP2/SP3 slot in. All styling is new `data-pretable-tool-*` attributes in `grid.css`, `:where()`-wrapped in `@layer pretable`, reusing the existing 50-token contract.

**Tech Stack:** TypeScript, React 19, vanilla CSS in `@pretable/ui`, vitest + jsdom, Playwright, API Extractor, changesets.

**Spec:** `docs/superpowers/specs/2026-08-24-tool-panel-design.md` — read it first; decisions there are settled and not re-litigated here.

---

## File map

| File | Responsibility |
|---|---|
| `packages/grid-core/src/types.ts` | `hidden?: boolean` on `PretableGridUiColumn` + `PretableGridUiColumnLayout` (~:773-786); `setColumnVisible` on the model interface (beside `setColumnPinned`, ~:924) |
| `packages/grid-core/src/create-grid-ui-core.ts` | normalize `hidden` at layout intake (~:187); `setColumnVisible` implementation beside `setColumnPinned` (~:946); focus/selection repair on hide |
| `packages/grid-core/src/__tests__/column-visibility.test.ts` | new — engine visibility behavior |
| `packages/react/src/pretable-surface.tsx` | `toolPanel` prop; horizontal layout wrapper (grid area · pane · rail); drawn-order projection filters `hidden` (~:3147); audit every `columnLayout`/`setColumnOrder` reader (~:2034, :2387, :2610, :3821) |
| `packages/react/src/pretable-model.ts` | `getColumns()` excludes hidden |
| `packages/react/src/tool-panel/sections.ts` | new — internal `ToolPanelSectionDescriptor` contract |
| `packages/react/src/tool-panel/ToolPanel.tsx` | new — shell: pane container + section render |
| `packages/react/src/tool-panel/Rail.tsx` | new — vertical tablist, roving tabindex |
| `packages/react/src/tool-panel/ColumnsSection.tsx` | new — list, search, reset, checkboxes, kebab menu, drag |
| `packages/react/src/tool-panel/index.ts` | new — internal barrel (nothing public beyond config types) |
| `packages/react/src/icons.tsx` | `ColumnsIcon` (rail tab glyph) |
| `packages/react/src/public_api.ts` | `PretableToolPanelConfig`, `ToolPanelSectionId` |
| `packages/react/src/pretable.tsx` | preset forwards `toolPanel` (default-on reaches it automatically) |
| `packages/ui/src/grid.css` | tool rail/pane/section/row rules |
| `packages/ui/src/__tests__/css-cascade.test.ts` | structural guards for the new rules |
| `packages/react/src/__tests__/tool-panel.test.tsx` | new — shell + columns section jsdom suite |
| `packages/react/src/__tests__/attribute-contract.test.tsx` | extend for `data-pretable-tool-*` |
| `apps/website/e2e/tool-panel.spec.ts` | new — keyboard walk, drag, hidden-span e2e |
| `apps/website/content/docs/grid/tool-panel.mdx` | new docs page |
| `.changeset/*` | core (minor: visibility), react (minor: tool panel), ui (patch: css) |

## Standing rules for every task

- **TDD.** Write the failing test, watch it fail, implement, watch it pass, commit. Copy the harness of the nearest existing test file rather than inventing one.
- **Prettier before trusting a test result** — it rewrites regex literals, long arrays, and markdown tables in ways that have repeatedly broken assertions here. `pnpm exec prettier --write <files>` in the owning package.
- **Drawn order, never the `columns` prop**, for anything resolving a column span. Seven consumers got this wrong once; the invariant is test-pinned.
- **`pnpm build` before `pnpm api`** — a stale `dist/` silently strips exports and `api:check` will not catch it.
- **No new tokens, no unprefixed styling attributes.** If you believe a token is genuinely needed, stop and flag it — that is a contract change with its own test/theme/docs ritual.
- SSR'd controls are inert until `data-pretable-hydrated`; interactive tests must gate on it (the e2e helpers in `apps/website/e2e/helpers.ts` already do).

---

### Task 1: Engine — `hidden` on the column layout, `setColumnVisible`

**Files:** `packages/grid-core/src/types.ts`, `packages/grid-core/src/create-grid-ui-core.ts`, create `packages/grid-core/src/__tests__/column-visibility.test.ts`

Read `create-grid-ui-core.ts:180-200` (layout normalization) and `:946-995` (`setColumnPinned` / `setColumnOrder`) before writing anything — the new setter must be a sibling in shape: same `command()` wrapper, same freeze discipline, same no-op early-return when the value is unchanged.

**Design decisions this task encodes (from the spec):**
- Hidden columns **stay in `columnLayout`** with `hidden: true` — width and pin state persist so re-showing restores them. They are filtered out downstream (Task 2), not removed here.
- `setColumnOrder` **continues to require every column in `columnLayout` exactly once, hidden included.** Its error message says "every visual column" — reword to "every column in the layout, hidden included" so the contract is explicit.
- Hiding the focused or selection-anchor column repairs focus/selection to the nearest still-visible neighbor (left first, then right), following the repair discipline already used for eviction — read `packages/grid-core/src/indexed-focus.ts` and reuse its helpers rather than writing new repair math.

- [ ] **Step 1: Write the failing tests.** In the new test file, using the same store-construction harness as the existing `create-grid-ui-core` tests (find them with `ls packages/grid-core/src/__tests__/`):
  - `hidden: true` in the initial column config survives normalization into `columnLayout`.
  - `setColumnVisible("qty", false)` sets `hidden: true` on that entry; width and pin state are untouched; the entry keeps its position.
  - `setColumnVisible` with an unchanged value publishes nothing (subscribe and count emissions — one engine emission per command is itself a pinned invariant).
  - `setColumnVisible("qty", true)` removes the flag (entry returns to `{ id, widthPx }` shape, matching how `setColumnPinned(null)` strips rather than writing `pinned: undefined`).
  - `setColumnOrder` omitting a hidden column's id throws `invalid-ui-state`.
  - Hiding the column that currently holds focus moves focus to the nearest visible neighbor; hiding a non-focused column leaves focus alone.
- [ ] **Step 2:** `pnpm --filter @pretable-internal/grid-core test -- column-visibility` — confirm every test fails for the right reason (missing method / missing field), not a harness error.
- [ ] **Step 3: Implement.** `hidden?: boolean` on both interfaces in `types.ts`; `setColumnVisible(columnId, visible)` on the model interface and in `create-grid-ui-core.ts`, shaped exactly like `setColumnPinned` (strip-when-clearing, freeze, `orderPinnedColumns` re-run not needed — visibility does not reorder). Add the focus/selection repair inside the same `command()`.
- [ ] **Step 4:** Tests pass. Run the whole package: `pnpm --filter @pretable-internal/grid-core test` — nothing else regressed.
- [ ] **Step 5: Commit** `feat(grid-core): column visibility with persistent width and pin state`.

---

### Task 2: React — hidden columns leave the drawn order, and every consumer survives

**Files:** `packages/react/src/pretable-surface.tsx`, `packages/react/src/pretable-model.ts`, extend the existing drawn-order/span tests in `packages/react/src/__tests__/`

This is the load-bearing task. The drawn-order projection at `pretable-surface.tsx:3147` (`indexedSnapshot.columnLayout.flatMap<PretableColumn<TRow>>`) and `pretable-model.ts`'s `getColumns` must filter `hidden` — then every span consumer (copy, paste, selection, announcements) inherits correctness because they already read the drawn order.

**The trap:** direct `columnLayout` readers bypass that projection. Known sites: `pretable-surface.tsx:2034`, `:2387`, `:2610`, `:3821` — and grep for more (`grep -n "columnLayout" packages/react/src/*.tsx packages/react/src/*.ts`). Each one must be audited: does it want *all* columns (a `setColumnOrder` call needs hidden ids too) or *drawn* columns (anything computing geometry or spans)? Record the verdict per site in a code comment where it isn't obvious.

**Assert the old behavior survives:** header drag-reorder calls `setColumnOrder`. With a hidden column present, a naive caller passes only visible ids and the engine now throws. The header-drag caller must splice hidden ids back in at their prior relative positions.

- [ ] **Step 1: Failing tests.** Extend the existing span/drawn-order test files (find the test that pinned the seven-consumer invariant: `grep -rln "getColumns" packages/react/src/__tests__/`):
  - A surface with a `hidden: true` column renders no header cell and no body cells for it.
  - Copying a range that visually spans across where the hidden column *would* be produces clipboard text without the hidden column's values.
  - `getColumns()` on the model excludes it; the full layout is still reachable for the panel (decide the accessor here: expose `columnLayout` via the existing state access rather than adding public API).
  - **Header drag-reorder still reorders correctly while a column is hidden** — this is the survives-test; simulate the drag the way the existing reorder tests do.
- [ ] **Step 2:** Run, confirm failures.
- [ ] **Step 3:** Implement the filter at `:3147` and in `getColumns`; fix the audited direct readers; fix the header-drag `setColumnOrder` caller (splice hidden ids at prior positions).
- [ ] **Step 4:** `pnpm --filter @pretable/react test` — full suite, not just the new file. Local flake note: 1–2 random timeouts per full run are known; re-run before believing a failure.
- [ ] **Step 5: Commit** `feat(react): hidden columns leave the drawn order everywhere at once`.

---

### Task 3: API reports and changesets for the engine change

- [ ] **Step 1:** `pnpm build && pnpm api` (build first — mandatory), then `pnpm api:check`. Expect real diffs in `core.api.md` and `react.api.md` (the `PretableGridUiColumn` shapes and the new setter flow through the public façade).
- [ ] **Step 2:** Changesets: `@pretable/core` minor ("column visibility: `hidden` on column config, `setColumnVisible` on the grid model"), `@pretable/react` minor (accumulates the SP1 feature; write it now, it ships with the branch).
- [ ] **Step 3: Commit** `chore: api reports and changesets for column visibility`.

---

### Task 4: CSS — the rail, pane, and columns-section rules

**Files:** `packages/ui/src/grid.css`, `packages/ui/src/__tests__/css-cascade.test.ts`

Every selector `:where()`-wrapped, inside `@layer pretable`, tokens only from the existing 50. **Pseudo-element trap:** `:where(x::before)` is invalid and silently matches nothing — write `:where(x)::before`. A paren-depth guard exists; keep it passing.

- [ ] **Step 1: Failing structural guards** in `css-cascade.test.ts`, mutation-tested per the house rule (delete the rule under test, watch the guard fail, restore):
  - a `[data-pretable-tool-rail]` rule exists and reads `--pretable-bg-header`;
  - a `[data-pretable-tool-pane]` rule exists and reads `--pretable-bg-toolbar`;
  - no `data-pretable-tool-*` rule introduces a `var(--` name outside the contract (reuse the file's existing token-extraction helper);
  - the hidden-row label rule reads `--pretable-text-dim` and does **not** use `opacity` (the entity-secondary precedent — every opacity-dimmed secondary here has failed AA).
- [ ] **Step 2:** Run, confirm failures.
- [ ] **Step 3: Add the rules.** New section at the end of `grid.css`, commented in the file's voice (explain *why*, not *what*):

```css
  /* ── Tool panel ─────────────────────────────────────────────────────────
     A rail of section tabs at the grid's right edge plus a full-height pane.
     The rail borrows the header's surface and the pane the toolbar's, so the
     panel reads as chrome, not content — same plane vocabulary as the rest
     of the grid. Docked planes meet at hairlines, not shadows. */
  :where([data-pretable-tool-rail]) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    inline-size: 36px;
    padding-block-start: 6px;
    background: var(--pretable-bg-header);
    border-inline-start: var(--pretable-rule-width) solid var(--pretable-rule);
  }
  :where([data-pretable-tool-tab]) {
    display: flex;
    align-items: center;
    justify-content: center;
    inline-size: 28px;
    block-size: 28px;
    border: 0;
    border-radius: var(--pretable-radius-control);
    background: transparent;
    color: var(--pretable-text-header);
    cursor: pointer;
  }
  :where([data-pretable-tool-tab]:hover) {
    background-image: linear-gradient(var(--pretable-bg-hover), var(--pretable-bg-hover));
  }
  :where([data-pretable-tool-tab][aria-selected="true"]) {
    background: var(--pretable-bg-toolbar);
    color: var(--pretable-accent);
  }
  :where([data-pretable-tool-tab]:focus-visible) {
    outline: 2px solid var(--pretable-focus-ring);
    outline-offset: -2px;
  }
  /* Pane width is a plain px, not a token: nothing themes it yet, and the
     flattened (0,0,0) specificity means a consumer can override it with any
     single attribute selector. It becomes a token when a theme needs it. */
  :where([data-pretable-tool-pane]) {
    inline-size: 264px;
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    background: var(--pretable-bg-toolbar);
    border-inline-start: var(--pretable-rule-width) solid var(--pretable-rule);
  }
  :where([data-pretable-tool-section]) {
    display: flex;
    flex-direction: column;
    min-block-size: 0;
    flex: 1;
    padding: 8px;
    overflow-y: auto;
  }
  :where([data-pretable-tool-column-row]) {
    display: flex;
    align-items: center;
    gap: 7px;
    block-size: 28px;
    padding-inline: 7px;
    border-radius: var(--pretable-radius-control);
  }
  :where([data-pretable-tool-column-row]:hover) {
    background-image: linear-gradient(var(--pretable-bg-hover), var(--pretable-bg-hover));
  }
  /* Hidden columns dim by COLOR, never by opacity: --pretable-text-dim holds
     a computed contrast; an opacity multiplies it away below AA. */
  :where([data-pretable-tool-column-row][data-pretable-column-hidden="true"]) {
    color: var(--pretable-text-dim);
  }
  :where([data-pretable-tool-group-label]) {
    font-size: 0.72em;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--pretable-text-dim);
    padding: 8px 2px 4px;
  }
  :where([data-pretable-tool-drop-indicator]) {
    block-size: 2px;
    border-radius: 1px;
    background: var(--pretable-reorder-drop-indicator);
  }
```

  Adjust to what the section markup actually needs, but hold the constraints: contract tokens only, hairline seams, no opacity dimming, focus as `outline`.
- [ ] **Step 4:** `pnpm --filter @pretable/ui test` — guards pass, contract test still green (it asserts every `var(--pretable-*)` in `grid.css` resolves in all three themes; a typo'd token name fails here).
- [ ] **Step 5: Commit** `feat(ui): tool panel rail, pane, and columns-section styling`.

---

### Task 5: Rail + shell — descriptor contract, tablist a11y, chrome state

**Files:** create `packages/react/src/tool-panel/sections.ts`, `Rail.tsx`, `ToolPanel.tsx`, `index.ts`; modify `packages/react/src/icons.tsx`; test `packages/react/src/__tests__/tool-panel.test.tsx`

**`sections.ts` — the internal contract (verbatim):**

```ts
import type { ComponentType, ReactNode } from "react";

/** Section ids are a closed union today; SP2 adds "filters", SP3 "grouping".
 * Nothing in the shell may assume the union is closed at runtime — the
 * future composable story widens this to consumer-supplied ids. */
export type ToolPanelSectionId = "columns";

export interface ToolPanelSectionDescriptor {
  readonly id: ToolPanelSectionId;
  readonly icon: ComponentType<{ className?: string }>;
  readonly label: string;
  /** Props are baked in by the surface when it constructs descriptors —
   * the shell renders sections without knowing what they need. */
  readonly render: () => ReactNode;
}
```

**`ColumnsIcon`** in `icons.tsx`: three vertical bars on the shared 16px grid, 1.5px stroke, `currentColor`, `data-pretable-icon` — copy the `Glyph` pattern the other nine use. Internal, not exported from `public_api.ts`.

**Rail behavior (the a11y contract from the spec):** `role="tablist"` `aria-orientation="vertical"`; each tab `role="tab"`, `aria-selected`, `aria-controls` pointing at the pane id; roving tabindex so the rail is **one** tab stop (active or first tab holds `tabIndex=0`, rest `-1`); ArrowUp/ArrowDown move focus between tabs; Enter/Space toggle; activating the already-active tab closes the pane. Pane: `role="tabpanel"`, `aria-labelledby` its tab, rendered only while open. Escape inside the pane returns focus to the pane's rail tab — implement as a keydown listener on the pane container.

- [ ] **Step 1: Failing tests** (jsdom, React Testing Library — copy the harness from an existing surface test):
  - rail renders one tab per descriptor with `role="tab"` and the label as accessible name;
  - no pane in the DOM when `activeSection` is null; clicking a tab renders the pane with `role="tabpanel"` wired via `aria-controls`/`aria-labelledby`;
  - clicking the active tab closes the pane;
  - ArrowDown from tab 1 moves DOM focus to tab 2 without changing `aria-selected` (activation is explicit, not focus-follows);
  - only one tab has `tabIndex=0` at any time;
  - Escape inside the pane moves focus to the active tab.
- [ ] **Step 2:** Run, confirm failures.
- [ ] **Step 3:** Implement `Rail.tsx` and `ToolPanel.tsx` (shell = rail + conditional pane; chrome state lives one level up, passed as props — the shell is controlled by its parent, full stop; the surface owns uncontrolled fallback in Task 6).
- [ ] **Step 4:** Tests pass; commit `feat(react): tool panel shell — rail, pane, section contract`.

---

### Task 6: Surface integration — `toolPanel` prop, layout, default-on

**Files:** `packages/react/src/pretable-surface.tsx`, `packages/react/src/public_api.ts`, extend `packages/react/src/__tests__/tool-panel.test.tsx` and `attribute-contract.test.tsx`

**Public config type (in `public_api.ts`, `@public`-tagged):**

```ts
export interface PretableToolPanelConfig {
  readonly defaultActiveSection?: ToolPanelSectionId | null;
  readonly activeSection?: ToolPanelSectionId | null;
  readonly onActiveSectionChange?: (section: ToolPanelSectionId | null) => void;
}
// on PretableSurfaceProps:
//   toolPanel?: boolean | PretableToolPanelConfig;   // default: true
```

Controlled/uncontrolled resolution follows the surface's existing convention (`state` + `onSelectionChange` precedent): `activeSection` present → controlled; else internal state seeded by `defaultActiveSection ?? null`.

**Layout:** today the surface stacks group panel / header / viewport vertically. Wrap that stack and the tool panel in a horizontal flex row *inside* the surface's card: `[existing vertical stack, flex:1 min-width:0] [pane?] [rail]`. The viewport's width-resize path already handles reflow — verify by reading how width is observed before assuming (`grep -n "ResizeObserver" packages/react/src/pretable-surface.tsx`). The rail/pane must sit inside the card so the card's border and shadow wrap them.

**Hydration:** rail tabs must be inert pre-hydration exactly like the surface's other controls — find how existing controls gate on `data-pretable-hydrated` and use the same mechanism, not a new one.

- [ ] **Step 1: Failing tests:**
  - default render (no `toolPanel` prop) shows the rail, no pane — **on by default**;
  - `toolPanel={false}` renders neither;
  - uncontrolled: `defaultActiveSection: "columns"` opens the pane at mount;
  - controlled: `activeSection` pins the pane; clicking a tab fires `onActiveSectionChange` without changing the DOM until the prop changes;
  - attribute contract: every new `data-pretable-tool-*` attribute is registered — extend `attribute-contract.test.tsx`'s allowlist and confirm the test FAILS before the allowlist edit (mutation-proof it sees the new attrs).
- [ ] **Step 2:** Run, confirm failures.
- [ ] **Step 3:** Implement. Surface constructs the descriptor array (just columns for now) with props baked in, resolves chrome state, renders `<ToolPanel>` in the new layout row.
- [ ] **Step 4:** Full `pnpm --filter @pretable/react test`. The website suite will exercise default-on across every docs example — run `pnpm --filter @pretable/app-website test` too and triage: examples that snapshot DOM may need updates; that churn is expected and belongs in this commit.
- [ ] **Step 5: Commit** `feat(react): tool panel on the surface, on by default`.

---

### Task 7: Columns section — list, visibility, search, reset

**Files:** `packages/react/src/tool-panel/ColumnsSection.tsx`, extend the tool-panel test file

List source: the full `columnLayout` (hidden included — the panel is the one place hidden columns remain visible), projected against the surface's column definitions for labels, **in layout order** (which is drawn order plus hidden entries in place). Excludes the derived group column and the selection column — find how the group column is marked in the layout (`grep -rn "group" packages/grid-core/src/create-grid-ui-core.ts | head`) rather than assuming an id convention.

Subgroups: **Pinned left / Columns / Pinned right**, from each entry's `pinned`. Empty subgroups render no label. Search filters by case-insensitive label substring; subgroup labels hide when their group empties. Reset restores the initial prop-declared order, pin, and visibility — capture the initial layout once at mount of the *surface* (not the section, which unmounts when the pane closes) and replay it via `setColumnOrder` + `setColumnPinned` + `setColumnVisible`.

Row: grip (`GripIcon`, drag handle, Task 9) · checkbox (native input, checked = visible, toggles `setColumnVisible`) · label (ellipsized) · kebab (Task 8). Hidden rows: unchecked, `data-pretable-column-hidden="true"` (dims via the Task 4 rule).

- [ ] **Step 1: Failing tests:**
  - rows appear in layout order, subgrouped by pin state, hidden rows present and marked;
  - the derived group column and selection column do not appear;
  - unchecking calls `setColumnVisible(id, false)`; the row stays, dimmed; the grid loses the column (assert via the drawn-order test helpers from Task 2);
  - search narrows rows and hides emptied subgroup labels;
  - reset after hide+pin+reorder restores the initial state (assert on the engine's layout, not the DOM).
- [ ] **Step 2:** Run, confirm failures. **Step 3:** Implement. **Step 4:** Pass, full react suite.
- [ ] **Step 5: Commit** `feat(react): columns section — visibility, search, reset`.

---

### Task 8: Kebab menu — pin left / pin right / unpin

**Files:** `packages/react/src/tool-panel/ColumnsSection.tsx`, test file

Use `OverlayPortal` (`packages/react/src/overlay/OverlayPortal.tsx`) exactly as `FilterMenu.tsx:287-392` does — **`contain: content` on the grid traps and clips `position: fixed`**, which is the documented reason that portal exists; do not position the menu inline. Trigger: `OverflowIcon` button, `aria-haspopup="menu"`, `aria-expanded`. Menu: `role="menu"`, items `role="menuitem"` — Pin left / Pin right / Unpin, current state disabled. Escape closes and returns focus to the trigger; so does selecting.

- [ ] **Step 1: Failing tests:** menu opens with three items; the row's current pin state is disabled; choosing "Pin right" calls `setColumnPinned(id, "right")` and the row moves to the Pinned-right subgroup; Escape returns focus to the kebab.
- [ ] **Step 2–4:** Fail → implement → pass.
- [ ] **Step 5: Commit** `feat(react): per-column pin menu in the columns section`.

---

### Task 9: Drag reorder, and cross-boundary re-pin

**Files:** `packages/react/src/tool-panel/ColumnsSection.tsx`, test file, create `apps/website/e2e/tool-panel.spec.ts`

Pointer-event drag on the grip (the header drag is the in-repo precedent — read its handler before writing this one; note its rule: **commit on drop, never on drag-leave**). While dragging: the dragged row at reduced emphasis, a `data-pretable-tool-drop-indicator` line at the insertion point. On drop within a subgroup: `setColumnOrder` with the full layout id list (hidden ids in place — Task 2's contract). On drop across a subgroup boundary: `setColumnPinned` to the target group's pin value, then order. Keyboard alternative (a11y hard gate — drag must not be the only path): with focus on the grip, ArrowUp/ArrowDown with a modifier moves the row; document the chosen chord in the docs page.

jsdom cannot express real pointer geometry — unit-test the pure insertion-index math (extract `dropTargetForPointer(y, rowRects, groups)` as a pure function and test it directly; the jsdom vacuous-scroll-test trap is the precedent for why), and prove the real interaction in Playwright.

- [ ] **Step 1: Failing unit tests** for the insertion math: mid-row boundaries, first/last positions, cross-group targets, hidden rows occupying slots.
- [ ] **Step 2–3:** Fail → implement (pure function + pointer handlers + keyboard moves).
- [ ] **Step 4: Playwright spec** (`apps/website/e2e/tool-panel.spec.ts`, using `helpers.ts` and the hydration gate): open panel on a showcase grid; drag a row two positions, assert header order changed; drag across the Pinned-left boundary, assert the column pinned (the header shows `data-pretable-pinned`); keyboard walk: Tab reaches the rail once, arrows move, Enter opens, Tab proceeds into the pane, forward-Tab from the last control **exits the panel** (no trap), Escape returns to the tab.
- [ ] **Step 5:** Run e2e per the local recipe: build + `next start`, root playwright binary from inside `apps/website`, `BASE_URL`, `--workers=1`.
- [ ] **Step 6: Commit** `feat(react): drag and keyboard reorder in the columns section`.

---

### Task 10: Preset + docs

**Files:** `packages/react/src/pretable.tsx`, create `apps/website/content/docs/grid/tool-panel.mdx`, modify `grid/pretable-component.mdx` (Limitations), `grid/pretable-surface.mdx` (Configuration table), `.changeset/`

- [ ] **Step 1:** Preset: `toolPanel` flows through the explicit prop list (`pretable.tsx:196` spreads a *named* list — add it; the file's comment explains why nothing passes implicitly). Default-on therefore reaches the preset with no further work; test: preset renders the rail, `toolPanel={false}` removes it.
- [ ] **Step 2:** `grid/pretable-component.mdx`'s Limitations paragraph currently promises no config UI — rewrite to reflect that the tool panel is on by default and how to disable it.
- [ ] **Step 3:** Write `grid/tool-panel.mdx`: what it is, the default-on stance, the config type, the columns section's operations, keyboard reference (including the reorder chord), and disabling. **Every prop table you add must be registered in the docs guard's rosters** (`apps/website/lib/docs/__tests__/docs-api-surface.test.ts` — it fails closed, and it checks member names AND optionality against the `.api.md` reports). Run `pnpm --filter @pretable/app-website test -- docs-api-surface` and satisfy it honestly — fix the docs, never the guard.
- [ ] **Step 4:** `pnpm --filter @pretable/app-website test` full; commit `docs(grid): the tool panel, and the preset's updated limitations`.

---

### Task 11: Full verification

- [ ] `pnpm --filter` each: grid-core, core, react, ui, app-website tests — all green.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm format`.
- [ ] `pnpm build && pnpm api && pnpm api:check` — reports fresh.
- [ ] Website e2e, full suite, production build, `--workers=1`.
- [ ] The Playwright cascade gate (`apps/bench/tests/cascade-override.spec.ts`) still green — the new css rules are in its jurisdiction.
- [ ] **Prove the pixel:** in a real browser, on the website's showcase grid, assert computed styles on the rendered rail (`background-color` resolves to the theme's header surface) — a matching selector and resolving token are not proof anything paints.
- [ ] **Look at it** under all three themes (`pretable`, forced `excel`, forced `material`) and in `pretable` dark. Report what the rail actually looks like in each — Excel's 0-radius sharp aesthetic will style the tabs differently, and that should look *intentional*, not broken. Screenshot each.
- [ ] Changesets present: core, react, ui.

## Self-review

**Spec coverage:** every spec section maps — engine change (T1–3), shell/API/a11y (T5–6), columns section incl. all four operations (T7–9), DOM/theming (T4), preset + docs (T10), verification incl. prove-the-pixel and no-trap (T11). Deferred items (custom sections, autosize, width resize) appear in no task, correctly.

**Two judgment calls made here, flagged for the reviewer:** (1) hidden columns stay in `columnLayout` and `setColumnOrder` keeps its all-ids contract, pushing a splice onto header-drag — chosen because one filter point beats a tolerant setter with reinsertion heuristics; (2) the reorder keyboard chord is left to the implementer to pick against existing grid chords, but its *existence* is a hard requirement with an e2e assertion.
