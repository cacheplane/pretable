---
"@pretable/react": minor
"@pretable/ui": patch
---

The kit's field and its checkbox, and the fourteen controls in the grid rebuilt
on them.

`PretableTextInput` is an `<input>` and `PretableCheckbox` a
`button[role="checkbox"]`, with `PretableTextInputProps`,
`PretableCheckboxProps`, `PretableTextInputComponent` and
`PretableCheckboxComponent` alongside them and `TextInput` and `Checkbox` slots
on `PretableComponents` — `components={{ TextInput, Checkbox }}` on
`<PretableSurface>` and `<Pretable>` replaces the grid's seven chrome text
fields and all seven of its checkboxes, the same way `Button`, `IconButton` and
`Select` already do. The fields are the filter dialog's value and its two range
bounds, the tool panel's three filter-row values, and the Columns search box;
the checkboxes are row select, header select-all, the boolean cell, the column
visibility toggle, "hide grouped columns", and the two enum checklists.

**`PretableButtonSite` is now `PretableSite`, and `PretableBuiltInButtonSite` is
`PretableBuiltInSite`.** The type names where any kit control sits, not where a
button does, and a field and a checkbox have sites too. The union gains ten
names: `filter-value`, `filter-row-value`, `tool-search`, `row-select`,
`row-select-all`, `bool-cell`, `tool-column-toggle`, `hide-grouped`,
`filter-choice` and `filter-row-choice`.

**Three checkboxes are no longer `<input type="checkbox">`.** The filter
dialog's enum checklist, the tool panel's filter-builder enum checklist and the
"hide grouped columns" switch are now `button[role="checkbox"]` carrying
`aria-checked`. A test keyed on `.checked`, on Playwright's `.check()` or on an
`input[type=checkbox]` selector must read `aria-checked` and click the button
instead; `toBeChecked()` still works, because it reads the ARIA state.

**A listbox option is marked `data-pretable-option-value`, not `data-value`.**
The select's open list is the one place where an attribute a consumer could
already have written against `0.17.0` has been renamed: a selector like
`[data-pretable-option][data-value="open"]` now matches nothing, and must read
`data-pretable-option-value` instead. (This branch's own end-to-end suite broke
on exactly that selector.) The new name says which option an element **is**, as
against the select trigger's `data-pretable-value`, which is what that picker
has committed.

**Attributes.** Every kit field carries `data-pretable-text-input` and every kit
checkbox `data-pretable-checkbox`, and each site keeps the `data-pretable-*`
attribute it already had. The two enum checklists gain
`data-pretable-filter-choice` and `data-pretable-filter-row-choice`, and each
choice carries `data-pretable-option-value` too. The filter builder's checklist
_wrapper_ is now `data-pretable-filter-row-set` — the field alongside it keeps
`data-pretable-filter-row-value`, which the wrapper used to borrow.

**Look.** The three ex-native checkboxes become the kit's 16px square drawn from
the `--pretable-checkbox-*` tokens, in place of the browser's ~13px default. The
Columns search box and every kit checkbox now take the product focus ring
instead of the user agent's — visibly on the header select-all and the column
visibility toggle, and on row select and the boolean cell too, though both are
`tabIndex={-1}` and so out of a `Tab`'s reach. Nothing else moves: the seven
fields and the four checkboxes that were already buttons keep their boxes, their
element type and their spacing exactly.

**Behaviour.** A kit checkbox's keyboard is the native button's — Space and
Enter both activate. A consumer `onClick` runs before the toggle and may
`preventDefault()` to veto it, which is how a shift-click range select keeps its
click without a second write. `checked` accepts `"mixed"` for the header
select-all's partial selection; it renders the minus glyph and toggles to
`true`.
