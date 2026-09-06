---
"@pretable/react": minor
"@pretable/ui": patch
---

The kit's picker, and the four `<select>` elements in the grid rebuilt on it.

`PretableSelect` is a `button[role="combobox"]` that opens a portalled listbox,
with `PretableSelectProps`, `PretableSelectOption` and `PretableSelectComponent`
alongside it and a `Select` slot on `PretableComponents` —
`components={{ Select }}` on `<PretableSurface>` and `<Pretable>` replaces every
picker in the grid, the same way `Button` and `IconButton` already do.
`PretableBuiltInButtonSite` gains four names: `filter-operator`,
`filter-row-column`, `filter-row-operator` and `aggregate`.

**The four pickers are no longer `<select>` elements.** The filter dialog's
operator, the tool panel's filter column and filter operator, and the grouping
aggregate picker are now `button[role="combobox"]` triggers carrying
`data-pretable-value`, which open a `[data-pretable-listbox]` of
`[data-pretable-option][data-value]` in `document.body`. A test keyed on
`select`, on `.value`, on Playwright's `selectOption()` or on `toHaveValue()`
must read the attribute and click the option instead. Every site keeps the
`data-pretable-*` attribute it already had, and the aggregate picker gains
`data-pretable-aggregate`.

**Keyboard.** Arrows, Enter and Space open a closed picker; arrows wrap and skip
disabled options; Home and End jump to the ends; typing a prefix jumps to the
first match (the buffer clears after 500ms); Enter or Space commits; Escape
closes back to the trigger; Tab closes and moves on. `onChange` fires only when
the value actually changes. The trigger is an explicit tab stop in every
browser, which the native control was not in WebKit.

A disabled option is shown, skipped and inert rather than hidden — that is the
aggregate picker's `Custom` entry, a consumer-written aggregator the grid
displays but never writes back.

**Styling.** The enum cell editor's list is now the kit list, so
`data-pretable-enum-listbox` and `data-pretable-enum-option` are gone, replaced
by `data-pretable-listbox` and `data-pretable-option` — plus `[data-active]` for
the roving highlight and `[aria-selected="true"]` for the current value. Tokens
are unchanged.

**Layout.** The tool panel's filter rows wrap less: a picker now sizes to its
own label, with an ellipsis, instead of to its longest option.
