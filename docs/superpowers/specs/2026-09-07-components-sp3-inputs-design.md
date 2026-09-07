# Components SP3: TextInput and Checkbox

Date: 2026-09-07
Status: approved, ready for planning

## Purpose

The third sub-project of the component kit (program and contract:
`2026-09-04-components-sp1-button-design.md`; the list primitive and the
select: `2026-09-05-components-sp2-select-design.md`). The grid still renders
seven native text-like fields in its chrome and seven checkboxes drawn five
different ways — three native `<input type="checkbox">`s and four hand-built
`<button role="checkbox">`s that share one stylesheet rule. This spec puts all
fourteen on two kit components, `PretableTextInput` and `PretableCheckbox`, so
a consumer styles or replaces every field and every checkbox once.

## Decisions (each confirmed with the user)

1. **Chrome fields only.** The seven filter/search fields migrate. The five
   cell-editor inputs (text, number, date, the enum editor's combobox input,
   the multiline `<textarea>`) do not: they are cell-sized, run the editor
   lifecycle, and the date editor's native popup is its own decision. A later
   sub-project adopts the kit inside editors.
2. **Checkbox on `button[role="checkbox"]`, all seven sites.** The model four
   sites already use (row-select header and row, the Columns section's
   visibility toggle, the boolean cell control). One kit `Checkbox` absorbs
   those four and replaces the three native inputs (the filter dialog's enum
   checklist, the builder's enum checklist, the grouping section's "hide
   grouped columns"). Mixed state is `aria-checked="mixed"`.
3. **No Textarea in SP3.** Its only consumer is the multiline cell editor,
   which is out of scope; a component with no site ships untested against a
   placement and unmeasured. It lands with the cell-editor sub-project.
4. **Thin wrappers; sites keep their labels.** Neither component owns a label
   element. A `<button>` is a labelable element, so the checklist sites keep
   `<label><Checkbox/>text</label>`: the text names the control and clicking it
   activates the control. No adornment slots, no clear button, no error slot —
   nothing in the grid needs them.
5. **The placement union is renamed.** `PretableButtonSite` →
   `PretableSite`, `PretableBuiltInButtonSite` → `PretableBuiltInSite`. It
   names where any kit control sits, not a button's. Pre-1.0, no alias.

Inherited from SP1/SP2 without re-deciding: placement in
`packages/react/src/components/`; one `components` slot per type, read from
context as the first statement of a component body; `site` lands as
`data-pretable-site`; attributes + tokens + `className`/`style` passthrough;
kit base rules first in `grid.css`, kit state rules last; every migrated site
keeps its original `data-pretable-*` attribute; the pixel must not move; the
`createElement`/`Fragment` imports the classic JSX build needs (guarded).

## `PretableTextInput`

`packages/react/src/components/text-input.tsx`, public.

```ts
export interface PretableTextInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "children"
> {
  /** Where in the grid this field is; lands as `data-pretable-site`. */
  site?: PretableSite;
}
```

Renders `<input data-pretable-text-input data-pretable-site={site} …props>`
with `forwardRef` to the input. It is deliberately the native element: `type`
(`text`, `number`, `date`, `search`), `inputMode`, `value`, `onChange(e)`,
`placeholder`, `disabled`, `aria-*` pass straight through. The native date
picker on `type="date"` stays native (the SP2 "native fallback" that was put
out of scope; the themes' `color-scheme` still exists for it).

Accessible name: a field may be named by `aria-label`, `aria-labelledby`, or
a `<label for>`. The kit cannot see the third from props, so it warns in
development (`warnOnce`) only when the rendered input has none of `aria-label`,
`aria-labelledby`, or an `id` — checked once after mount through the ref.

## `PretableCheckbox`

`packages/react/src/components/checkbox.tsx`, public.

```ts
export interface PretableCheckboxProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "role" | "aria-checked" | "onChange" | "children"
> {
  checked: boolean | "mixed";
  /** The next value. `mixed` toggles to `true`, as the header select-all does. */
  onCheckedChange: (next: boolean) => void;
  site?: PretableSite;
}
```

Renders `<button type="button" role="checkbox" aria-checked={checked}
data-pretable-checkbox data-pretable-site={site} …props>` containing
`<CheckIcon/>` when `true`, `<MinusIcon/>` when `"mixed"`, nothing when
`false`. `onClick`: the consumer's handler runs first; unless it called
`preventDefault()`, the kit then calls `onCheckedChange(checked !== true)`.
That veto is how the row-select cell keeps its shift-click range branch
without a double toggle. Keyboard is the native button's (Space, Enter); the
component adds no key handler. `tabIndex`, `disabled`, `aria-busy`,
`aria-invalid`, `aria-errormessage`, `aria-label` pass through — the boolean
cell and the row-select roving model need them.

Accessible name: `aria-label` when given, otherwise the wrapping `<label>`.
The dev warning checks the DOM once after mount: warn when the button has no
`aria-label`, no `aria-labelledby`, and no `closest("label")`.

## Slots and the site vocabulary

`PretableComponents` gains `TextInput?: PretableTextInputComponent`
(`ComponentType<PretableTextInputProps & RefAttributes<HTMLInputElement>>`)
and `Checkbox?: PretableCheckboxComponent`
(`ComponentType<PretableCheckboxProps & RefAttributes<HTMLButtonElement>>`).
`useResolvedComponents` gains both — comparison, defaults, literal, deps —
and the changed-slot test covers each.

`PretableBuiltInSite` gains: `filter-value`, `filter-row-value`,
`tool-search`, `row-select`, `row-select-all`, `bool-cell`,
`tool-column-toggle`, `hide-grouped`, `filter-choice`, `filter-row-choice`.
`PretableButtonProps.site` and `PretableSelectProps.site` retype to
`PretableSite`. The docs guard's `STRING_UNIONS` entry, the type tests and the
Components page follow the rename.

## Migration

| site                        | today                                                                                    | becomes                                                                                             |
| --------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| filter dialog value/min/max | `<input type={inputType} {...numericProps} data-pretable-filter-value/-min/-max …>`      | `<TextInput site="filter-value" …same props>`                                                       |
| builder value/min/max       | `<input {...fieldProps} data-pretable-filter-row-value …>`                               | `<TextInput site="filter-row-value" …>`                                                             |
| Columns search              | `<input data-pretable-tool-search …>`                                                    | `<TextInput site="tool-search" …>`                                                                  |
| row-select header           | `<button role="checkbox" aria-checked data-pretable-row-select-all onClick={announce…}>` | `<Checkbox site="row-select-all" checked onCheckedChange onClick={existing}>`                       |
| row-select row              | same, `tabIndex={-1}`, shift-click range in `onClick`                                    | `<Checkbox site="row-select" tabIndex={-1} onClick={…}>`; the range branch calls `preventDefault()` |
| boolean cell                | `BooleanCellControl`'s button (busy/invalid/disabled/tabIndex -1)                        | `<Checkbox site="bool-cell" …>`; `data-pretable-bool-cell` and its state rules stay                 |
| column visibility toggle    | `<button role="checkbox" data-pretable-tool-column-toggle>`                              | `<Checkbox site="tool-column-toggle">`                                                              |
| hide grouped columns        | `<label><input type="checkbox" data-pretable-hide-grouped/>text</label>`                 | `<label><Checkbox site="hide-grouped" data-pretable-hide-grouped/>text</label>`                     |
| dialog enum checklist       | `<label><input type="checkbox"/>text</label>`                                            | `<label><Checkbox site="filter-choice" data-pretable-filter-choice data-value={…}/>text</label>`    |
| builder enum checklist      | same                                                                                     | `site="filter-row-choice"`, `data-pretable-filter-row-choice`                                       |

Every existing attribute is kept; the two checklists gain one each. The
row-select and boolean-cell sites live in `pretable-surface.tsx`, which reads
the same context (the provider wraps both surface return paths since SP1).

**Test drivers migrate with the sites, once.** Native-checkbox drivers
(`fireEvent.click(input)`, `.checked`) become a click on the button and a
shared `checkboxState(el): boolean | "mixed"` helper reading `aria-checked`.
Text-field drivers are unchanged (`fireEvent.change` on an `<input>` still
works). In Playwright, `toBeChecked()` reads `aria-checked` on
`role="checkbox"`, so those assertions survive; `.check()`/`.uncheck()` do not
and move to a `toggleCheckbox` helper in `e2e/helpers.ts`. No test loses a
claim.

## CSS

- Kit, first: `[data-pretable-text-input]` takes the field box the select
  trigger already draws — `box-sizing: border-box`, `border: 1px solid
var(--pretable-rule)`, `border-radius: var(--pretable-radius-control)`,
  `background: var(--pretable-bg-grid)`, `color: var(--pretable-text-cell)`,
  `font: inherit`, `padding-inline: 6px`. `[data-pretable-checkbox]` takes the
  existing four-site rule verbatim (the 16px square, `--pretable-checkbox-*`
  tokens, the `[aria-checked="true"]`/`"mixed"` fills, the glyph sizing).
- State, last: `:focus-visible` ring and `:disabled` ink for both; the
  forced-colours rule for the checked square retargeted from the four button
  selectors to `[data-pretable-checkbox][aria-checked]`.
- Sites keep size, flex and placement only: dialog fields `block-size: 28px;
padding-inline: 7px; width: 100%`; builder fields `flex: 1 1 auto;
min-inline-size: 24px; block-size: 24px`; the search box its inset. The
  checklist checkboxes keep their positive-offset ring override as a site state
  rule (its comment argues why); `bool-cell` keeps its busy/invalid/disabled
  reveals.
- The per-site checkbox selector list and every `input[data-pretable-…]` /
  `[…] input` type selector are deleted: an element-type selector stops
  matching after a migration (the SP2 lesson), and the kit attribute is the
  hook now.
- Guards: `TEXT_INPUT_SITES` and `CHECKBOX_SITES` join the site guard with
  their owned lists and OWN entries; kit guards for both components assert the
  declarations above; the bracket guard anchors on both base rules with
  `/selector\s*\{/`; all mutation-checked.

## Measurement

Before any code changes: the seven fields and the seven checkboxes — computed
longhands, box, and the focus ring under a real Tab (not `el.focus()`, which
does not match `:focus-visible` on a button) — plus the checked and mixed
boxes for the checkboxes. Definition of done: no pixel moves. None is
expected: the checkbox rule is copied verbatim and the field box matches the
select trigger's.

## Testing

- **Components** (jsdom): TextInput — attributes, passthrough of `type`,
  `value`/`onChange`, ref, the name warning (fires with no name, silent with
  `aria-label`, silent with `id`); Checkbox — attributes and glyph per state,
  `onCheckedChange` from false/true/mixed, consumer `onClick` veto, ref,
  `disabled` does not toggle, the name warning (silent inside a `<label>`).
- **Slots**: both resolve like the others; the deps mutation fails the test.
- **Override**: `components.TextInput`/`.Checkbox` replace all fourteen sites,
  including inside the portalled dialog and inside a body cell; all fourteen
  pinned to the kit component and site name.
- **Migrated suites**: enum checklists, hide-grouped, row selection
  (shift-click range still selects a range), boolean cell — re-expressed with
  no lost claim.
- **Browser** (`/fixtures/components` gains both): keyboard toggle via Space
  in webkit, label-click toggles, shift-click row range, a `type="date"` field
  is still an `input[type=date]`. `bench:e2e` and the website suites the
  migration touches.
- The `jsx-runtime-imports` guard covers the new files automatically.

## Docs

The Components page gains TextInput and Checkbox sections (prop tables
registered with the api-surface guard, `complete: true`), and the site rename
lands in its prose and in the guard's `STRING_UNIONS` entry. Sentences that
describe "a native checkbox" or "the search input" are checked. Changeset:
minor `@pretable/react` (new exports and slots; the site-type rename; the
three checklist/hide-grouped checkboxes are `button[role="checkbox"]` now, so
`.checked`/`.check()` drivers must move to `aria-checked`), patch
`@pretable/ui`.

## Out of scope

Cell-editor inputs and the textarea, a switch component (hide-grouped stays a
checkbox), radio, the DOM `indeterminate` property (aria only), form
association (`name`/`value` submission), adornment slots.
