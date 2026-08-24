# Tool Panel — Design

**Status:** approved direction, SP1 specced in full; SP2/SP3 outlined.
**Decided with:** visual companion session 2026-08-24 (mockups under `.superpowers/brainstorm/`).

## What this is

A rail-and-pane tool panel docked at the grid's right edge — the AG-Grid-class
answer to "where does advanced configuration live." Full scope is three
stacked capabilities: column management, an advanced filter builder over the
typed operator model, and grouping configuration. It ships as a **library
feature** in `@pretable/react`, themed by the token contract, **on by
default**.

This is the payoff of two prior threads: the design-system project (the panel
is the first large chrome surface built entirely on the house theme), and the
sidebar-precursor note that the hero's stacked control sidebar was rehearsing
this panel.

## Decomposition

Three sub-projects, each its own spec → plan → PR cycle:

- **SP1 — shell + columns section** (this spec, in full). The rail/pane
  container, its API, a11y and theming, plus the simplest real section.
  Ships with one engine addition: column visibility.
- **SP2 — filter builder section.** The full typed operator vocabulary
  (`between`, `before`/`after`, `isAnyOf`, `isEmpty`, date ranges, text
  operators) as a query builder: every active filter visible together,
  add/edit/remove across columns, typed value editors reusing the shipped
  cell-editor set (enum combobox, date calendar, number steppers).
- **SP3 — grouping section.** Group columns, expand defaults, and aggregate
  choices as a section; decides coexistence vs. replacement for the
  drag-to-group strip.

Ordering argument: the shell must exist before any deep section; the columns
section proves the shell's hardest generic interaction (drag inside a panel)
without inventing new state models; filters are the largest design surface
and deserve a settled shell; grouping is mostly rehoming.

## Decisions locked (and why)

1. **Library component, not a website pattern.** The hero already played
   precursor once; the capability belongs to every consumer.
2. **Full tool panel is the destination; filters-only was rejected** as
   underselling the panel architecture.
3. **Form: icon rail + one section at a time** (chosen over stacked
   collapsible sections and over an overlay drawer, from mockups). The rail
   advertises the capability even when the pane is closed; each section gets
   full height — which the SP2 filter builder genuinely needs; one visible
   section keeps each section's keyboard scope simple.
4. **On by default, configured by a prop, composable escape hatch later.**
   Applies to `PretableSurface` *and* the `<Pretable>` preset. The preset's
   "Limitations" doc text currently promises no config UI and must be
   updated in SP1. Pre-1.0 with no external consumers, so default-on costs
   nothing now and buys discoverability forever.
5. **React-owned chrome state; engine-owned operations.** The only new state
   is `{ activeSection }`. Engine state would be dead surface for headless
   consumers, who cannot render the chrome anyway. All operations flow
   through engine methods and render from the snapshot subscription.
6. **Columns section carries all four operations** — visibility, pinning,
   reorder, search + reset.
7. **Row anatomy: quiet row + per-row kebab menu** (chosen over an inline
   three-state pin control, from mockups). Rows are grip + checkbox + label
   + kebab; pinning lives in the menu, which also gives future per-column
   actions (autosize, SP3 group-by) a home without another row redesign.
   Pin *state* is communicated by which subgroup a row sits in.
8. **Zero new tokens.** Rail reuses `--pretable-bg-header`, pane
   `--pretable-bg-toolbar`, separators `--pretable-rule`, focus
   `--pretable-focus-ring`, drag indicator
   `--pretable-reorder-drop-indicator`. If implementation finds a real gap,
   adding a token is a deliberate contract change (contract test, all three
   themes, token reference — the docs guard now enforces all of it), never a
   quiet extra.

## SP1 in detail

### Architecture

`packages/react/src/tool-panel/`: `ToolPanel.tsx` (shell), `Rail.tsx`,
`ColumnsSection.tsx`, `sections.ts` (internal descriptor contract),
`index.ts`. The surface renders the tool panel as a right-edge column inside
its card; the grid area reflows width when the pane opens (the virtualizer
already observes resize).

Sections register via an internal typed descriptor:

```ts
interface ToolPanelSectionDescriptor {
  readonly id: ToolPanelSectionId;        // "columns" in SP1
  readonly icon: ComponentType;           // from the internal icon set
  readonly label: string;                 // rail tooltip + tab aria-label
  readonly render: (ctx: SectionContext) => ReactNode;
}
```

SP2/SP3 add descriptors. The "composable customization" future is: export
the descriptor type and accept custom descriptors through the `toolPanel`
prop. SP1 designs for that (nothing in the shell may assume a closed id
union at runtime) but does not build or export it.

### Public API

```ts
toolPanel?: boolean | {
  defaultActiveSection?: "columns" | null;   // uncontrolled initial
  activeSection?: "columns" | null;          // controlled
  onActiveSectionChange?: (s: "columns" | null) => void;
}
```

Default `true`: rail visible, pane closed. `false` removes rail and pane.
Controlled/uncontrolled per the surface's existing convention. New engine
surface (below) is the only other public API movement.

### Engine change: column visibility (the one real one)

Column visibility does not exist in the engine today (verified against
`core.api.md`: `setColumnOrder` and `setColumnPinned` exist; nothing for
visibility). SP1 adds:

- `PretableColumn.hidden?: boolean` — initial visibility.
- `setColumnVisible(columnId, visible)` on the grid model.
- Hidden columns are **removed from the drawn order** (`getColumns()`).

Placement is load-bearing: every consumer that resolves a column span —
copy, paste, selection, announcements, seven at last count — reads the drawn
order, so they inherit hidden-column correctness from the same source of
truth, exactly as grouping's derived column already does. A hidden column's
widths/pin state persist so re-showing restores it.

Focus/selection repair: hiding the focused or selection-anchor column moves
focus to the nearest visible neighbor (same repair discipline as eviction).

### DOM, theming

New attributes, extending the `data-pretable-*` contract (attribute-contract
test extended in the same commit): `data-pretable-tool-rail`,
`data-pretable-tool-tab` (+ `data-pretable-section`),
`data-pretable-tool-pane`, `data-pretable-tool-section`, state via
`data-pretable-open` / `aria-selected`. All styling in `grid.css`,
`:where()`-wrapped inside `@layer pretable`; token reuse per decision 8; the
pane/grid seam is a hairline, not a shadow (docked planes, not floating
ones). Pane width is a plain px in `grid.css` — overridable by consumers at
(0,0,0) specificity, not a token until someone needs it themed.

### Accessibility and keyboard

- Rail is `role="tablist"` `aria-orientation="vertical"`; tabs are
  `role="tab"` with roving tabindex — the rail is **one** tab stop.
- Up/Down moves between tabs; Enter/Space toggles; activating the active tab
  closes the pane. Pane is `role="tabpanel"` labelled by its tab.
- Escape anywhere in the pane returns focus to the pane's rail tab.
- Focus ring is the `outline` pattern (composes with shadows — the box-shadow
  slot lesson).
- Rail controls are inert until `data-pretable-hydrated` (the SSR signal);
  the e2e helpers already gate on it.
- The panel must never trap Tab: forward-Tab from the last pane control
  exits the panel entirely (the WCAG-A history makes this a hard gate, not a
  nice-to-have).

### Columns section

- List source: `grid.getColumns()` — the **drawn** order, never the
  `columns` prop. Excludes the derived group column and the selection
  column.
- Subgrouped **Pinned left / Columns / Pinned right** with uppercase labels.
- Row: drag grip · visibility checkbox · label (ellipsized) · kebab menu.
  Hidden rows keep their position, unchecked, label dimmed via
  `--pretable-text-dim` (never opacity).
- Kebab menu (v1): Pin left / Pin right / Unpin. Rendered through the
  existing overlay/portal machinery — `contain: content` clips
  `position: fixed` inside the viewport, so no naive positioning.
- Drag within a subgroup reorders (`setColumnOrder` with the full drawn-order
  id list); drag across a subgroup boundary re-pins (`setColumnPinned`) —
  mirroring the header-drag behavior the showcase e2e already pins. Drop
  indicator uses `--pretable-reorder-drop-indicator`; drop commits on
  release, never on drag-leave.
- Search filters the list by label match; subgroup headers hide when empty.
- **Reset columns** restores the initial prop-declared order, pin state, and
  visibility.

### Verification

- **jsdom:** chrome state (controlled + uncontrolled), descriptor contract,
  ARIA wiring, attribute contract extension, visibility-in-drawn-order unit
  coverage in core.
- **Playwright (required, not optional — jsdom cannot see most of this):**
  rail keyboard walk (one stop in, arrows within, no trap out), pane
  open/close reflow, drag-reorder with the indicator, cross-boundary re-pin,
  hidden-column copy/paste span correctness, focus repair on hiding the
  focused column.
- **Docs:** `grid/tool-panel.mdx` plus the surface configuration-table
  update and the preset's Limitations correction. Every new member table
  must be registered in the docs guard's rosters — it fails closed.
- **Changesets:** core (visibility), react (feature), ui (css).
- Assert the old behavior survives: header drag-reorder and drag-to-group
  still work with the panel open.

## Traps carried forward (do not relearn)

- Column spans resolve against the **drawn** order (`getColumns()`), never
  the `columns` prop.
- `setQuery` settles asynchronously — subscribe to the snapshot, not
  `getState`.
- No token ships without a consumer; no styling attribute ships unprefixed.
- Prettier rewrites regex/table assertions — format before trusting a test.
- Prove the pixel: a resolving token and a matching selector are not proof
  anything paints; assert computed longhands on the real component.
- SSR'd controls are painted but inert until `data-pretable-hydrated`.

## Out of scope for SP1

Filter builder (SP2), grouping section (SP3), custom/composable sections
(designed-for, not built), panel width resizing, column autosize action in
the kebab (menu is built to take it later), any saved-views concept.
