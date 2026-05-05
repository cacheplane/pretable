# Selection + Keyboard Navigation (Sub-project B)

## Goal

Round out pretable's selection and keyboard navigation surface so it matches the expectations of a real data-grid product. Cell-range is the primary selection model (Excel/Sheets semantics); row-selection derives from it. Keyboard navigation follows the ARIA grid pattern. Copy-to-clipboard ships with sensible defaults and a clean override surface. A built-in checkbox column covers the high-frequency row-select use case.

## Position in the Tier 1 Roadmap

Tier 1 is decomposed into four sub-projects, executed in this order:

1. **B — selection + keyboard nav** (this spec) including a Slab 1 pretable-internal bench claim.
2. **B2 — comparative bench** for selection/nav (vs Grid Alpha / GridBeta / GridGamma X). Selection-model parity makes this its own engineering project.
3. **A — public API stabilization** (audit, doc, contract tests). Locks the surface that B and B2 leave behind.
4. **C — column resize + reorder.** Depends on A.
5. **D — cell renderers** (separate comprehensive architecture brainstorm). Depends on A.

## Non-Goals

- Cell editing / paste. Paste is **Phase 2** of this strand and will reuse the per-column / grid-level override pattern established here (`parseFromCopy`, `onPaste`).
- Comparative bench coverage (deferred to B2).
- Cell-renderer customization of the selection visuals (consumers can override via CSS in v1; the renderer-level API lands in D).
- Right-pinned selection column (left only in v1; symmetry comes for free if/when right-pinning lands generally).
- Multi-tab clipboard behaviors (HTML alongside text, file lists). Out of scope; consumers can supply their own via `onCopy`.

## Selection Model

**Cell-range is primary; row-selection derives.** The engine stores cell ranges. "Selected rows" is computed from the range set.

Engine state replaces the current `{ rowIds, anchorRowId }`:

```ts
interface GridCoreCellAddress {
  rowId: string;
  columnId: string;
}

interface GridCoreCellRange {
  startRowId: string;
  endRowId: string;
  startColumnId: string;
  endColumnId: string;
}

interface GridCoreSelectionState {
  ranges: GridCoreCellRange[]; // discontiguous, in selection order
  anchor: GridCoreCellAddress | null; // for shift+arrow extend
}
```

**Invariants:**

- Ranges store **stable IDs**, not indices. Sort, filter, and column-reorder mutations move the data underneath; ranges follow.
- A range with a row currently filtered out is kept in state, but contributes zero cells to copy / "selected rows" derivations until the row reappears. Matches Grid Alpha.
- Selection is always at least the focused cell. There is no "focused cell with empty selection" state. Internally, focus collapses ranges to `[{focused…focused}]` with the anchor at the same address.

**Selected-row derivation (pure function over snapshot):**

| Row state     | Coverage of row's cells by some range              |
| ------------- | -------------------------------------------------- |
| Selected      | All cells in the row are inside at least one range |
| Indeterminate | Some but not all cells are inside any range        |
| Unselected    | No cells are inside any range                      |

This is what powers the checkbox column's three-state visual.

## Click Contract (Excel-style)

| Gesture                            | Effect                                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Click body cell                    | Move focus to cell; collapse selection to that single cell.                                                           |
| Shift+click body cell              | Extend range from current anchor to clicked cell (replaces the active range; keeps discontiguous extras).             |
| Cmd/Ctrl+click body cell           | Add a new single-cell range (discontiguous). New anchor = clicked cell.                                               |
| Drag body cell → body cell         | Marquee select; final range replaces the active range.                                                                |
| Click checkbox in selection column | Toggle full-row range membership for that row (additive — does not collapse other ranges, does not move focus).       |
| Shift+click checkbox               | Range-toggle full-row ranges from last-checked checkbox anchor to this row.                                           |
| Click select-all header checkbox   | Toggle "all currently visible rows are full-row ranges". When mixed (indeterminate), first click selects all visible. |

Pretable does not currently render a separate row-header gutter; the selection column is the only row-level click target in v1. Click-row-to-select-row behavior is reachable by consumers via `onSelectionChange` + a row-click handler if desired, and can be elevated to a built-in gesture later without breaking this contract.

The selection column does not move focus when clicked — checkbox interaction is independent of cell focus, even though it mutates the same range state.

## Keyboard Contract

ARIA grid pattern: the entire grid is a single tab stop. Focus enters lands on the focused cell (or first cell if none yet). Arrow keys navigate inside.

| Key                         | Action                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| ↑ / ↓ / ← / →               | Move focus by one cell. Collapses range to focused cell.                                          |
| Shift + arrow               | Extend active range from anchor by one cell.                                                      |
| Cmd/Ctrl + arrow            | Jump focus to grid edge in arrow direction. Collapses range to focused cell.                      |
| Cmd/Ctrl + Shift + arrow    | Extend active range from anchor to grid edge.                                                     |
| Home / End                  | Move focus to first / last column in current row.                                                 |
| Cmd/Ctrl + Home / End       | Move focus to first / last cell in grid.                                                          |
| Page Up / Page Down         | Move focus by one viewport height.                                                                |
| Shift + Page Up / Page Down | Extend range by one viewport height.                                                              |
| Tab                         | Move focus right; wrap to first cell of next row at end. **Default**: `tabBehavior: "wrap-rows"`. |
| Shift + Tab                 | Move focus left; wrap to last cell of previous row at start.                                      |
| Cmd/Ctrl + A                | Select all cells (single full-grid range).                                                        |
| Esc                         | Collapse range to focused cell. Discards discontiguous ranges.                                    |
| Cmd/Ctrl + C                | Copy selection per the copy contract below.                                                       |
| Space                       | (Reserved for future row-toggle when focus is in selection column.)                               |

**Configuration:**

```ts
type TabBehavior = "wrap-rows" | "exit";
```

`exit` matches strict ARIA (Tab leaves the grid). `wrap-rows` matches Grid Alpha / Sheets convention. Default is `wrap-rows` because pretable is a data-grid product, not an accessibility-purist component library.

`Cmd+arrow` does not implement Excel's "data block" semantics — every typed cell has a value. Jumping to grid edge is the predictable behavior and matches Grid Alpha.

## Built-in Checkbox Column

Grid-level config:

```ts
type RowSelectionColumnConfig = {
  enabled: true;
  position?: "left"; // v1: left only
  pinned?: boolean; // default true
  headerCheckbox?: boolean; // default true
  width?: number; // default 36
};
```

When enabled, the grid injects a synthetic column at the configured position. The column:

- Renders a built-in three-state checkbox per body row whose state derives from the selection rule above (selected / indeterminate / unselected).
- Renders a header checkbox bound to the visible rows: checked if every visible row is fully selected, indeterminate if some are, unchecked otherwise. Clicking it adds/removes full-row ranges for all visible rows.
- Does not participate in cell-range gestures (clicking the checkbox cell is a checkbox interaction, not a cell-selection gesture). The column's other event areas (gutter padding) behave as a row-header click.
- Cannot be sorted, filtered, resized, or reordered. Width is fixed.

The built-in does not depend on the cell-renderer subsystem (D). Once D ships, an exported `<RowSelectCheckbox />` component will let consumers compose the same checkbox into custom column layouts.

## Copy-to-Clipboard Contract

Default copy serializes the selection as TSV:

- Cell delimiter: `\t`. Row delimiter: `\n`.
- One block per range, ranges joined by `\n\n` when more than one. Cells in a block are emitted in row-then-column order over the visible (non-filtered) cells in that range.
- Cell value resolution: `column.formatForCopy?.(value, row) ?? defaultCoerce(value)`. The default coercion stringifies primitives, ISO-formats `Date`, JSON-stringifies plain objects, and emits empty string for `null` / `undefined`.
- `copyWithHeaders?: boolean` (default false) prepends each block with a header row of the corresponding column headers, separated from the body by a blank line.

Override surface:

```ts
type CopyResult = string | { text: string; html?: string };

type PretableSelectionConfig = {
  rowSelectionColumn?: RowSelectionColumnConfig;
  tabBehavior?: TabBehavior;
  copyWithHeaders?: boolean;
  onCopy?: (args: { ranges; snapshot }) => CopyResult;
};
```

Per-column:

```ts
interface PretableColumn<TRow> {
  // existing: id, header, wrap, widthPx, pinned, sortable, filterable, getValue
  formatForCopy?: (value: unknown, row: TRow) => string;
}
```

`onCopy` is the grid-level escape hatch (custom delimiter, JSON output, suppress copy, HTML alongside text). Returning `string` writes only `text/plain`; returning the object form also writes `text/html`.

**Paste is out of scope for v1.** Phase 2 will mirror this shape: `parseFromCopy?` per column and `onPaste?` at grid level.

## Controlled vs Uncontrolled

The existing `interactionState` prop is renamed to **`state`** and absorbs all controllable state slices. New slices for selection and focus mirror the existing sort pattern.

```ts
type UsePretableOptions = {
  state?: {
    sort?: PretableSortState;
    filters?: Record<string, string>;
    selection?: PretableSelectionState;
    focus?: PretableFocusState;
  };
  onSortChange?: (next: PretableSortState) => void;
  onFiltersChange?: (next: Record<string, string>) => void;
  onSelectionChange?: (next: PretableSelectionState) => void;
  onFocusChange?: (next: PretableFocusState) => void;
};
```

Omitting a slice means the engine owns it (uncontrolled). Providing a slice means the consumer owns it; the engine reads the prop, fires the corresponding `on…Change` callback on user interaction, and the consumer chooses whether to commit.

Existing call sites (`apps/website`, `apps/bench`, `apps/playground`-as-retired) are updated to the new `state` prop in the same change. No backcompat alias.

## ARIA & Accessibility

- Root: `role="grid"`, `aria-rowcount`, `aria-colcount`, `aria-multiselectable="true"`.
- Each row: `role="row"`, `aria-rowindex` (1-based, includes header), `aria-selected` when fully selected, omitted otherwise.
- Each cell: `role="gridcell"`, `aria-colindex`, `aria-selected` based on range membership, `tabIndex={isFocused ? 0 : -1}` (single-tab-stop pattern).
- Header cells: `role="columnheader"`, `aria-sort` when sortable.
- Selection-column header: `role="columnheader"` containing `<button role="checkbox" aria-checked="true|false|mixed">`.
- Off-screen `aria-live="polite"` region announces:
  - Selection size after Cmd+A or programmatic select-all ("12 rows × 4 columns selected").
  - Copy success ("12 rows × 4 columns copied").

Announcement strings are exposed via a `messages?` prop for i18n (matching Grid Alpha's pattern). English defaults ship in v1.

## New Engine Actions

`GridCoreStore` additions / changes:

| Action                                                           | Description                                                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `setSelection(state)`                                            | Imperative replace, used by controlled-mode adapters.                                                |
| `setFocus(addr)`                                                 | Existing; now also collapses ranges to focused cell and updates anchor.                              |
| `moveFocus(direction, opts?: { extend?, jumpToEdge?, byPage? })` | Generalizes the current 1D `moveFocus(delta)`. `direction` is `"up" \| "down" \| "left" \| "right"`. |
| `selectAll()`                                                    | Single full-grid range; anchor at top-left.                                                          |
| `clearSelection()`                                               | Collapse to focused cell.                                                                            |
| `addRange(range)`                                                | Append a discontiguous range; updates anchor to range start.                                         |
| `extendRangeFromAnchor(addr)`                                    | Replace active range with `[anchor…addr]`.                                                           |
| `toggleRowSelection(rowId)`                                      | Add or remove a full-row range. Used by the checkbox column.                                         |
| `setSelectAllVisible(checked)`                                   | Header-checkbox semantics; replaces or removes all visible-row full-row ranges.                      |
| ~~`selectRow`~~                                                  | Removed.                                                                                             |

The legacy 1D `moveFocus(delta)` is replaced by the generalized form. Existing call sites update.

## Bench (Slab 1, pretable-internal)

New scripts under `apps/bench/scripts`:

- `select-range-extend` — focused at top-left, then 30× shift+ArrowDown, capturing per-step interaction latency.
- `select-all` — single Cmd+A keystroke, capturing single-event latency.
- `keyboard-nav-row` — focused at top-left, then 60× ArrowDown, capturing per-step latency.

New hypotheses:

- **H13 — selection extend latency.** `S2/hypothesis` with `pretable` adapter: shift+ArrowDown extend p95 < 16ms (single-frame budget at 60Hz) across 30 repeated extensions, ×3 repeated runs.
- **H14 — keyboard scroll-nav latency.** `S2/hypothesis` with `pretable` adapter: ArrowDown nav p95 < 16ms across 60 navigations, ×3 repeated runs.
- **H15 — select-all latency.** `S2/hypothesis` with `pretable` adapter: Cmd+A end-to-end < 33ms (two-frame budget — select-all is rarer than per-step nav and a one-time cost is acceptable), ×3 repeated runs.

Hypotheses are **pretable-internal absolute thresholds**. They are not comparative. Comparative selection/nav hypotheses are deferred to sub-project B2.

`evaluate.ts` is extended to read the new metric shapes. Hypotheses are gated in CI alongside the existing scroll/sort/filter set.

## Hero Demo Update

The website hero grid (`apps/website/app/components/heroGrid`) is updated to demonstrate the new surface:

- Add a left-pinned selection column with `headerCheckbox: true`.
- Visually demonstrate the three-state checkbox (some rows partially selected via shift+drag).
- Update `Scoreboard` (or sibling) to read selected row IDs from the derived selection.

The current ski-race replay narrative is preserved; the checkbox column is layered on, not a replacement.

## Visual Defaults

Default selection visuals use the existing `--pt-*` token system:

- Selected cell background: `var(--pt-color-selection-bg, rgb(blue 4% alpha))`.
- Active-range border: `var(--pt-color-selection-border, rgb(blue 60% alpha))` 1px.
- Focused-cell ring: `var(--pt-color-focus-ring, rgb(blue))` 2px inside the cell.
- Checkbox column: standard checkbox styled via existing `@pretable/ui` button/checkbox tokens.

New tokens are added to `@pretable/ui/tokens.css` deliberately (per the established "no silent token additions" rule). The broader theming-architecture question (open per `project_theming_architecture_followup.md`) is unblocked by, but not solved by, this work.

## Documentation

The website docs surface at `apps/website/app/docs/grid/` is updated alongside the implementation. Documentation is a first-class deliverable, not a follow-up.

**New pages:**

- `apps/website/app/docs/grid/selection/page.mdx` — selection model overview: cell-range primary, IDs-not-indices invariant, derived row state, three-state checkbox semantics, controlled vs uncontrolled. Embeds a runnable example mirroring the hero demo's checkbox column.
- `apps/website/app/docs/grid/keyboard/page.mdx` — full keyboard contract table (mirrors the spec), `tabBehavior` config, ARIA notes, focus-management guarantees.
- `apps/website/app/docs/grid/clipboard/page.mdx` — copy contract: TSV defaults, `formatForCopy` per-column, `onCopy` grid-level override, `copyWithHeaders`, multi-range serialization. Forward-pointer to Phase 2 paste with the symmetric `parseFromCopy` / `onPaste` shape.

**Updated pages:**

- `apps/website/app/docs/grid/page.mdx` — feature list updated to include selection, keyboard nav, clipboard.
- `apps/website/app/docs/grid/pretable-component/page.mdx` and `…/pretable-surface/page.mdx` — new `state` prop (replacing `interactionState`), new `onSelectionChange` / `onFocusChange` callbacks, new `rowSelectionColumn` / `tabBehavior` / `copyWithHeaders` / `onCopy` config.
- `apps/website/app/docs/grid/api-reference/page.mdx` — full type reference for `PretableSelectionState`, `PretableCellRange`, `PretableCellAddress`, `PretableFocusState`, `RowSelectionColumnConfig`, `CopyResult`. New / changed engine actions.
- `apps/website/app/docs/getting-started/concepts/page.mdx` — selection added to the conceptual model alongside sort and filter.
- `apps/website/app/docs/_nav.ts` — new entries for the three new pages, ordered: Pretable component → Surface → **Selection → Keyboard → Clipboard** → Custom rendering → Density helpers → API reference.

**Documentation contract:**

- Every public type and prop introduced or changed by this work appears in `api-reference/page.mdx` with a one-sentence purpose, the exact type, and at least one inline usage snippet.
- Every code example in the new pages is type-checked and compiles against the published package types (existing MDX example pipeline).
- The hero demo's checkbox column is referenced by name from the selection page, with a working `<CodeExample>` showing the equivalent minimal setup.

## Exit Criteria

- New engine state and actions are implemented in `@pretable-internal/grid-core` with focused unit tests covering: range invariants under sort/filter/reorder, derived selected-row state, range extension and collapse semantics, checkbox three-state derivation.
- `@pretable/react` exports the renamed `state` prop, the new selection/focus controlled callbacks, and the `RowSelectionColumnConfig` config. The `<Pretable>` and `<PretableSurface>` adapters wire the keyboard contract end-to-end. Tests cover controlled and uncontrolled modes for both selection and focus.
- Default copy produces correct TSV (including discontiguous range serialization, header opt-in, per-column `formatForCopy`). `onCopy` override is exercised by tests.
- ARIA attributes appear on rendered DOM as specified. The off-screen live region is wired and exercised by a jsdom test asserting announcement content for Cmd+A and Cmd+C flows.
- Bench: H13, H14, H15 are satisfied on repeated `S2/hypothesis` Chromium runs. Hypothesis evidence is checked in under `status/runsets/`. The full pre-existing scroll + sort + filter hypothesis set continues to pass (no regression).
- Hero demo on the website ships with the selection column visible and exercised in the smoke test (`apps/website/e2e/smoke.spec.ts`).
- All documentation pages listed in the **Documentation** section are added or updated. The new pages are reachable from `_nav.ts`. API reference covers every introduced or changed public type/prop. Existing MDX examples continue to compile.

## Open Items Tracked Elsewhere

- Theming architecture for external consumers — `project_theming_architecture_followup.md`.
- Cell renderer architecture (sub-project D) — separate comprehensive brainstorm.
- AI integrations beyond LLM streaming — `project_ai_integrations_future.md`.
- Comparative selection/nav bench (sub-project B2) — follows immediately after this spec lands.
- Public API stabilization (sub-project A) — follows B2.
