# Filter header menu — design (sub-project 2 of 3)

**Date:** 2026-06-19
**Branch:** `claude/filter-ui` (off `main` after #180)
**Status:** approved (pending written-spec review)

## Context

Sub-project 1 (PR #180) shipped the headless operator filter model: `setColumnFilter`,
`distinctColumnValues`, typed `ColumnFilter`/`FilterOperator`/`FilterType`/`FilterOption`
(exported from `@pretable/core` + `@pretable/react`), per-column `filterType`/`filterOptions`/
`filterable`. There is **no built-in filter UI** — the surface renders no filter affordance.

This is **sub-project 2 of 3**: a built-in, per-column **header filter menu** (funnel →
popover) in `@pretable/react`, styled in `@pretable/ui`. Sub-project 3 (later) does the
filtering docs page, hero adoption, and e2e.

## Goal

Give every `filterable` column a header funnel that opens a popover to edit that column's
filter — operator dropdown + a typed value control that matches the column's `filterType`
— applying live to the engine and firing `onFiltersChange`. Works uncontrolled (default)
or controlled via the existing `state.filters`.

## Decisions (locked in brainstorm)

- **Apply timing:** live. Text inputs debounced ~200ms; dropdown/number/checkbox/date
  apply immediately. No Apply button — a per-column **Clear** action only.
  Multi-part operators (`between`/`dateBetween`) **gate**: apply only when both bounds are
  valid; otherwise the column's filter is cleared (a half-range never blanks the grid).
- **Funnel visibility:** appears on header hover/focus; **permanently shown + accented**
  on any column with an active filter.
- **On by default:** the funnel renders for every column with `filterable !== false`
  (mirrors the resize/reorder precedent). Opt out per-column with `filterable: false`.
- **Deferred to sub-project 3:** hero adoption, docs page, Playwright e2e. RTL is the
  coverage here.

## Non-goals

- OR / boolean trees, a chip/filter bar, a global "clear all" toolbar (no toolbar exists).
- `packages/*` Tailwind (vanilla CSS only). No new runtime deps (no Floating UI etc.).
- Changes to the engine filter model (done in sub-project 1).
- A surface-level master on/off prop (per-column `filterable` is the control).

## Architecture

New, all under `packages/react/src/filter-menu/`:

- `filter-operators.ts` — **pure, no React.** The brains:
  - `operatorsForType(filterType): FilterOperator[]` — which operators a column offers
    (text/number/date/enum + shared isEmpty/isNotEmpty), in display order.
  - `OPERATOR_LABELS: Record<FilterOperator, string>` — human labels ("contains",
    "is between", "is any of", "is empty", …).
  - `operatorValueShape(op): "none" | "single" | "range" | "set"` — drives which value
    control renders.
  - `isComplete(filterType, op, draft): boolean` — is the draft value usable (gating for
    live-apply; e.g. `between` needs two parseable numbers).
  - `toColumnFilter(filterType, op, draft): ColumnFilter | null` — build the engine value
    (`null` when incomplete → clears). Parses number/date strings to the engine shape.
  - `fromColumnFilter(filter): draft` — hydrate the popover from an existing filter
    (controlled or re-open).
  - Fully unit-tested in isolation.
- `FunnelButton.tsx` — the header affordance. `<button aria-haspopup="dialog"
aria-expanded data-pretable-filter-funnel data-pretable-filter-active={active}>` with an
  inline-SVG funnel (no icon font). Calls back to toggle the popover for its column.
- `useFilterPopover.ts` — open state (`openColumnId | null`), anchor rect, outside-click +
  Escape close, and a fixed-position style computed from the funnel's
  `getBoundingClientRect()` with viewport-edge flip (open left/up when near the edge).
- `FilterMenu.tsx` — the popover dialog: operator `<select>` + value control by shape,
  Clear button. Owns local draft state; pushes changes through a callback (debounced for
  text). `role="dialog"`, labelled by the column header text.

Wiring in `packages/react/src/pretable-surface.tsx`:

- Render `<FunnelButton>` inside the header content (left of the resize handle). Its
  pointer/click handlers `stopPropagation()` so sort-on-header-click and reorder-drag are
  untouched.
- Render **one** `<FilterMenu>` at the surface root (a fixed-position layer, mirroring the
  reorder ghost) for the currently-open column — avoids header `overflow` clipping.
- New prop `onFiltersChange?: (filters: Record<string, ColumnFilter>) => void`.

## Data flow

- **Uncontrolled (default):** the menu calls `grid.setColumnFilter(columnId, filter)` (or
  `null` to clear), then `onFiltersChange(grid.getSnapshot().filters)`. The engine is the
  source of truth; the funnel's active state reads from `snapshot.filters[columnId]`.
- **Controlled:** when the consumer passes `state.filters`, that already flows through
  `usePretable` → `grid.replaceFilters`. The menu still calls `setColumnFilter` for
  responsiveness and fires `onFiltersChange`; the consumer updates its `state.filters` and
  the controlled apply re-asserts (same pattern as sort/selection today). The popover
  hydrates its draft from `snapshot.filters[columnId]` on open.
- **Enum options:** use `column.filterOptions` if present; else
  `grid.distinctColumnValues(columnId)` (computed when the popover opens).

## Styling (`@pretable/ui`)

- Vanilla CSS in `grid.css`, `:where()` + `data-pretable-filter-*` attributes (zero
  specificity, consumer-overridable), matching existing conventions.
- Reuse existing tokens: `--pretable-bg-tooltip` (popover bg), `--pretable-rule`,
  `--pretable-radius`, `--pretable-text-cell`, `--pretable-bg-hover`, `--pretable-accent`
  (active funnel + focus), `--pretable-focus-ring`. **Goal: no new tokens.** If an active-
  funnel color genuinely needs its own token, add it to **both** themes (excel; material
  light + dark) and the `contract.test.ts` `TOKENS` list (currently 42) — and only then.
- Funnel is hidden by default and revealed via
  `:where([data-pretable-header-cell]:hover [data-pretable-filter-funnel])`,
  `:focus-within`, and always shown when `[data-pretable-filter-active="true"]`.
- Popover reuses/extends the existing `[data-pretable-popover]` rule.

## Accessibility & keyboard

- Funnel: `<button>` with `aria-haspopup="dialog"`, `aria-expanded`, `aria-label`
  (`Filter {header}`).
- Popover: `role="dialog"`, `aria-label` referencing the column; on open, focus moves to
  the operator select; **Escape** closes and returns focus to the funnel; outside-click
  closes; Tab cycles native controls (select/inputs/checkboxes/Clear button).
- Native controls throughout (`<select>`, `<input>`, `<input type="checkbox">`,
  `<input type="date">`) for built-in keyboard support. Not a full focus trap (YAGNI);
  Escape + return-focus + outside-click is the contract.

## Testing (RTL, `packages/react/src/__tests__/`)

`filter-operators.test.ts` (pure):

- `operatorsForType` returns the right set per type; `operatorValueShape`/`isComplete`/
  `toColumnFilter`/`fromColumnFilter` round-trips incl. number/date parsing and the
  `between` gating (incomplete → `null`).

`filter-menu.test.tsx` (component, via `PretableSurface`):

- Funnel hidden until hover/focus; shown + `data-pretable-filter-active` when a filter
  exists.
- Open menu → operator select lists the type's operators; switching operator swaps the
  value control (text input ↔ two number inputs ↔ checkbox list ↔ none for isEmpty).
- Typing a text value (after debounce) narrows `visibleRows` and fires `onFiltersChange`
  with `{ col: { operator, value } }`.
- Enum checklist built from `filterOptions`; and from `distinctColumnValues` when options
  omitted.
- `between`: one bound → no filter applied; both bounds → applied.
- Clear removes the column's filter (funnel returns to inactive).
- Controlled `state.filters`: popover hydrates from it; ignoring `onFiltersChange` keeps
  the engine pinned to the prop.
- Funnel click does not trigger sort (stopPropagation).
- Use fake timers for the debounce assertions.

Plus `pnpm -r typecheck`/`lint`/`test`, `pnpm format`, and `pnpm api` (the new
`onFiltersChange` prop changes `react.api.md` — refresh + commit; second run a no-op).

## Risks

- **Popover positioning** (fixed-position from rect, edge-flip, scroll/resize) is the
  trickiest part and is weakly covered by jsdom. Keep the math in `useFilterPopover` small
  and obvious; real-viewport validation comes with the e2e in sub-project 3.
- **Default-on funnels** change every consumer's header UX. Accepted (matches
  resize/reorder); `filterable: false` opts out.
- **api gate**: `onFiltersChange` must land in `react.api.md` (required CI gate).
