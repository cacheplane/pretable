# Typed cell editors — design (umbrella, 3 sub-projects)

**Date:** 2026-08-05
**Status:** Approved (brainstorm, visual-companion session)
**Branch (spec):** `reassess-editing`

## Goal

Close the type gap between filtering and editing. The filter series (#180/#185)
gave columns a data type (`filterType: text | number | date | enum`) and a
type-aware header menu; editing (#174/#175) is still type-blind — every editable
cell opens the same bare text input. This effort ships **built-in typed editors
with richer UX**, keyed off a promoted column `type`, in the `--pretable-*` skin
for every theme.

Decisions were made interactively (visual companion): enum = **combobox with
typeahead**; date = **custom calendar popover**; plus **number**, **boolean
(instant toggle, with filtering)**, and **multi-line for wrapped text** — all in.

## 1. Column type promotion (`@pretable/core` / grid-core)

Pre-1.0 rename sweep, no aliases:

- `filterType` → **`type`** on `PretableColumn`; `FilterType` → **`ColumnType`**,
  union gains `"boolean"` → `"text" | "number" | "date" | "enum" | "boolean"`.
  Default `"text"`.
- `filterOptions` → **`options`**; `FilterOption` → **`ColumnOption`**
  (`{ value: string; label?: string }`, unchanged shape).
- New optional `step?: number` on `PretableColumn` (number editor increment;
  default 1).
- The filter engine (`evaluate-filter.ts`), filter menu, and all call sites
  re-key to `column.type` / `column.options`. All existing filter tests stay
  green under the rename. `core.api.md` + `react.api.md` regenerated (required
  gate).

## 2. Boolean filtering (in scope)

`type: "boolean"` filters as **enum semantics with implicit options**
`[{ value: "true", label: "True" }, { value: "false", label: "False" }]`.
Verified: the engine's enum branch already coerces cell values with
`String(cell)` (evaluate-filter.ts), so boolean cells match string option values
with no matcher changes. The implicit options are derived wherever the menu/
engine resolves a column's options (single helper, e.g.
`resolveColumnOptions(column)`); the funnel stays visible on boolean columns and
the standard enum checklist UI (True/False) applies, including
`isEmpty`/`isNotEmpty` if present for enum.

## 3. Component architecture (`@pretable/react`)

New `packages/react/src/editors/` directory mirroring `filter-menu/`:

- **`CellEditor` becomes a dispatcher:** `column.renderEditor` wins if present;
  else select by `column.type` (text → single/multi-line by `wrap`, number,
  enum, date; boolean never reaches the popover path — see §4.6).
- **Shared editor chrome** extracted from today's `cell-editor.tsx`: the error
  element (`data-pretable-edit-error`, `role="alert"`, `aria-errormessage`
  association), `aria-label`/`aria-invalid`/`aria-busy`, `readOnly` during
  pending, blur-commit-in-place guarded to `status === "editing"`, and
  direction-aware commit (Enter ↓, Tab →). Typed editors supply only their
  control.
- **Built-in type validation** slot in the commit path: an editor may map the
  draft to a typed value and reject with a message (number parse, enum
  strictness, date validity) **before** the column's `validate` runs — reusing
  the existing `markEditInvalid` path. `parseEditValue`, when provided,
  overrides the editor's built-in parsing.
- Editors are **internal** (like the filter-menu components); `renderEditor`
  remains the public composition point. Export on demand later.
- No engine lifecycle changes: drafts remain `unknown`; the controller
  (`useCellEditController`) is untouched except where the boolean toggle path
  needs a begin+commit convenience (§4.6).

## 4. The editors

### 4.1 Text (default — unchanged)

Single-line input, existing semantics: type-to-replace, Enter commit↓,
Tab commit→, Escape cancel, blur commit-in-place.

### 4.2 Multi-line (`type: "text"` + `wrap: true`)

Auto-growing textarea (grows with the draft; capped by a sane max-height via
skin). **Enter inserts a newline; Cmd/Ctrl+Enter commits ↓**; Tab commits →;
Escape/blur as today. Type-to-replace seeds the draft.

### 4.3 Number (`type: "number"`)

Right-aligned input, `inputmode="decimal"`. ArrowUp/Down step by `column.step ??
1`; clickable ▲/▼ steppers. Draft stays a string while typing; commit parses to
a number — `NaN` is a built-in validation reject ("Not a number") through the
invalid path. Empty draft commits `null`. Enter/Tab/Escape/blur as text.
Min/max are NOT built in (the column `validate` hook covers constraints).

### 4.4 Enum combobox (`type: "enum"` + `options`)

Text input seeded with the current value's label + filtered option list
popover. Typing filters options (case-insensitive substring over label, falling
back to value); ArrowUp/Down move the highlight, Enter commits the highlighted
option's **value**, click commits, Tab commits highlighted →. **Strict**: a
draft matching no option is a built-in validation reject ("Pick an option");
free-text/creatable behavior is explicitly `renderEditor` territory. Blur
commits only when the input text exactly matches an option label (else cancel/
revert). Type-to-replace seeds the filter text. ARIA combobox pattern
(`role="combobox"`, `aria-expanded`, `role="listbox"`/`option`,
`aria-activedescendant`). A `type: "enum"` column without `options` behaves as
text (documented).

### 4.5 Date calendar (`type: "date"`)

Popover containing an ISO `yyyy-mm-dd` text input **and** a month grid
(pretable-skinned, all themes, dark included). The value convention is ISO
`yyyy-mm-dd` strings — same as the filter engine. Interactions: click a day
commits; arrow keys move day focus in the grid (roving tabindex), Enter on the
focused day commits; PageUp/PageDown and ‹ › switch months; today and the
selected day are marked. Typing a full valid ISO date + Enter commits it;
invalid input is a built-in validation reject. Escape cancels; blur commits
in-place when the input holds a valid date, else reverts. **Out:** time-of-day,
ranges, min/max, locale-pluggable week start (ISO Monday start; revisit on
demand). ARIA: grid/gridcell pattern within the popover, labelled month header.

### 4.6 Boolean toggle (`type: "boolean"`)

No popover. The **cell itself renders a centered checkbox** (display rendering
for all boolean columns; interactive when editable). Enter/Space on the focused
cell or clicking the checkbox **toggles and commits immediately** through the
real lifecycle — a small controller convenience (`toggleBooleanAndCommit`-style:
begin with draft `!value`, then commit with no focus move) so async
`validate`/`onCellEdit` still run and `saving`/`error` states render on the cell
(dimmed checkbox / error element, as today). Type-to-replace/F2 do not apply.
ARIA: `role="checkbox"` + `aria-checked` on the cell control. Display of
non-boolean values in a boolean column falls back to unchecked + the raw value
via `format` if provided.

## 5. Skin (`@pretable/ui`, every theme)

- The combobox and calendar popovers **reuse the filter menu's popover/menu
  tokens and patterns** (shipped in #185 — surface names verified at plan
  time); the field chrome reuses the existing `--pretable-edit-bg` /
  `--pretable-text-error` / `--pretable-focus-ring` set.
- New tokens only where nothing fits (expected: calendar selected-day, possibly
  stepper hover) — defined in `excel.css` `:root` and `material.css` `:root` +
  `[data-theme="dark"]`, added to the ui contract test, documented in the token
  reference.
- All new `grid.css` rules `:where()`-wrapped inside `@layer pretable` (cascade
  contract test enforces).
- Boolean display checkbox reuses the existing row-select checkbox tokens.

## 6. Testing

- **grid-core/core:** rename sweep keeps the full filter suite green; boolean
  implicit-options resolution unit-tested; `ColumnType` union updated in
  `core.api.md`.
- **react (RTL):** dispatcher selection per type (+ `renderEditor` override,
  `wrap` split); per-editor semantics — number step/parse/NaN-reject/null-empty;
  combobox filter/highlight/strictness/blur-exact-match/ARIA; calendar
  keyboard nav (arrows/PageUp/Down/Enter), typed-ISO commit, invalid reject;
  multi-line Enter-newline vs Cmd-Enter-commit; boolean toggle async
  (saving/error render, staleness); existing editing + filter-menu suites stay
  green under the rename.
- **ui:** contract test for any new tokens; cascade test presence assertions for
  new rules.

## 7. Docs

- `docs/grid/editing.mdx` — typed-editors overhaul (per-type behavior tables,
  keyboard maps, strictness rules, `step`, boolean toggle).
- Filtering docs + column API reference — updated for the `type`/`options`
  rename and boolean filtering.
- Token reference — any new tokens.

## 8. Sequencing — three sub-projects (mirroring the filter series)

1. **Type promotion + boolean + simple editors.** The rename sweep
   (`type`/`options`/`ColumnType`/`ColumnOption`), boolean type + implicit-enum
   filtering + toggle cell, editor dispatcher + shared chrome extraction,
   number editor, multi-line editor. No popover components.
2. **Enum combobox.**
3. **Date calendar** (the largest single component).

Each sub-project gets its own implementation plan → PR → merge-on-green; this
document is the umbrella design and the authority on cross-cutting decisions.
Sub-projects 2/3 may add focused mini-specs at plan time only if new questions
surface.

## Out of scope (explicit)

Creatable/free-text combobox, multi-select enum values, time/datetime editing,
date min/max/ranges, async-loaded options, editor component exports, changes to
the edit lifecycle/controlled data flow, drag-fill/paste/multi-cell (tracked
elsewhere).

## Risks / open items

- **Rename blast radius:** `filterType`/`filterOptions` appear across engine,
  menu, hero/demo columns, and docs — the sweep must be completed in one PR
  (sub-project 1) so `main` never holds a mixed vocabulary.
- **Popover positioning inside the virtualized viewport** (clipping at grid
  edges): reuse whatever #185's menu does (portal vs in-cell) — decide at plan
  time by reading `useFilterPopover`.
- **Calendar scope creep** is the biggest schedule risk; the §4.5 cut list is
  the contract.
- Theme files remain under parallel theming work — additions are additive
  tokens; reconcile at merge.
