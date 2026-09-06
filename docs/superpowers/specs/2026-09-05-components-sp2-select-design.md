# Components SP2: Listbox, and PretableSelect

Date: 2026-09-05
Status: approved, ready for planning

## Purpose

The second sub-project of the component kit (program and contract:
`2026-09-04-components-sp1-button-design.md`). Four native `<select>`s remain
in the grid — the filter dialog's operator picker, the tool panel's column and
operator pickers, and the grouping section's aggregate picker — and each wears
the operating system's chrome inside an otherwise designed surface, with a
popup no theme can reach. This spec replaces them with `PretableSelect`, a
select-only combobox on the SP1 contract, built on a `Listbox` primitive
extracted from the enum cell editor so the grid has one list implementation.

## Decisions (each confirmed with the user)

1. **Custom select-only combobox**, not a styled native `<select>` and not a
   pointer-type hybrid: a kit-styled `button[role="combobox"]` trigger and a
   portalled `role="listbox"` popover — the WAI-ARIA select-only pattern, and
   the shape the enum cell editor already uses. Both halves are styleable; the
   grid owns the keyboard and ARIA contract; existing test drivers migrate.
2. **Extract a shared `Listbox` from the enum cell editor; migrate the four
   selects only.** The editor keeps its filtering `<input>` trigger and renders
   the same list. The group panel's chip listbox is out of scope.
3. **Data-driven options**: `options: readonly { value: string; label:
ReactNode; disabled?: boolean }[]`, `value: string`, `onChange(value)`. No
   children API, no generic value type, no `renderOption` until a site needs it.
4. **Primitive shape**: a rendered `Listbox` component (the portalled list
   both consumers render identically) plus a `useListboxKeys` hook (the
   keyboard both triggers need). Not hook-only (two copies of the ARIA markup),
   not a component that also owns the trigger (the two triggers differ).

Inherited from SP1 without re-deciding: placement in
`packages/react/src/components/`; one `components` slot per type; the
placement prop is `site`; attributes + tokens + `className`/`style` passthrough
as the styling channel; kit base rules first in `grid.css` and state rules
last; every migrated site keeps its original `data-pretable-*` attribute; the
pixel must not move.

## The primitive

### `Listbox` (internal, `packages/react/src/components/listbox.tsx`)

One responsibility: render a portalled list of options from data the trigger
owns.

```ts
export interface ListboxOption {
  readonly value: string;
  readonly label: ReactNode;
  readonly disabled?: boolean;
}

interface ListboxProps {
  /** The trigger's `aria-controls` target; option ids are `${id}-${index}`. */
  id: string;
  options: readonly ListboxOption[];
  /** `aria-selected` — the committed value, or null. */
  value: string | null;
  /** The roving highlight; -1 for none. Owned by the trigger via the hook. */
  activeIndex: number;
  /** The trigger's rect; placed by `menuPopoverStyle`. */
  anchor: DOMRect;
  "aria-label"?: string;
  onSelect: (value: string) => void;
  /** Outside pointerdown. No focus return: the click chose a new target. */
  onClose: () => void;
}
```

- Renders `<ul role="listbox" data-pretable-listbox>` inside `OverlayPortal`,
  styled by `menuPopoverStyle(anchor)`, with `<li role="option"
id={`${id}-${i}`} aria-selected aria-disabled data-pretable-option
data-value>` per option.
- Keeps the active option scrolled into view when `activeIndex` changes.
- Renders nothing when `options` is empty (the enum editor's rule: no bare
  box).
- Closes on outside pointerdown, without focus return — `useMenuKeyboard`'s
  contract, and the portal's standing reason.
- A disabled option is skipped by keyboard navigation and inert to click.

The enum editor's `[data-pretable-enum-listbox]` / `[data-pretable-enum-option]`
rules move to `[data-pretable-listbox]` / `[data-pretable-option]`; the editor
keeps passing its own attribute through, as the buttons did.

### `useListboxKeys` (same file)

Owns `activeIndex` and returns `{ activeIndex, setActiveIndex, onKeyDown }`
for a trigger:

- ArrowDown / ArrowUp move the highlight, wrapping, skipping `disabled`;
  Home / End jump.
- **Typeahead**: printable characters accumulate into a buffer that resets
  after 500 ms and matches an option label's prefix (case-insensitive) — the
  native `<select>` behaviour a keyboard user expects.
- Enter and Space commit the active option; Escape closes with focus return
  to the trigger; Tab closes without consuming the move.
- On a closed trigger, ArrowDown / ArrowUp / Enter / Space open it.

The enum editor adopts the hook's navigation and keeps its own filtering.

## `PretableSelect`

`packages/react/src/components/select.tsx`.

```ts
export type PretableSelectOption = ListboxOption;

export interface PretableSelectProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "type" | "value" | "onChange" | "aria-label"
> {
  options: readonly PretableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  /** REQUIRED. The picker's accessible name; a select with none is the
   *  IconButton problem again. An empty string warns in development. */
  "aria-label": string;
  /** Where in the grid this picker is; lands as `data-pretable-site`. */
  site?: PretableButtonSite;
}
```

Renders `<button type="button" role="combobox" aria-haspopup="listbox"
aria-expanded aria-controls={listId} aria-activedescendant
data-pretable-select data-pretable-site data-pretable-value={value}>`
containing the selected option's label and a `ChevronDownIcon`; opens the
`Listbox` anchored to its own rect on click or through the hook; commits on
option click or Enter / Space and closes; `disabled` takes the standard
treatment. `forwardRef` to the button — the filter dialog focuses its operator
picker on open through a ref.

A `value` absent from `options` renders the value string itself as the label
rather than a wrong option — the pruned-operator case both filter pickers
already guard.

`data-pretable-value` is the test-visible truth that replaces a native
`.value`.

`PretableButtonSite` gains four built-in names: `filter-operator`,
`filter-row-column`, `filter-row-operator`, `aggregate`. (The type keeps its
name; it is the kit's site vocabulary, not the button's.)

## The override slot

`PretableComponents` gains `Select?: PretableSelectComponent`
(`ComponentType<PretableSelectProps & RefAttributes<HTMLButtonElement>>`).
`useResolvedComponents` resolves it like the other two — the memo's
comparison, defaults object and dependency array each gain the slot, and the
changed-slot test is extended to it, because that four-part edit is exactly
what the SP1 review flagged as easy to get wrong. A replacement receives the
options array, `value`, `onChange`, the name and `site`, and owes a forwarded
`ref`.

## Migration

| site                   | today                                                                                 | becomes                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| filter dialog operator | `<select ref={selectRef} data-pretable-filter-operator aria-label="Filter operator">` | `<Select site="filter-operator" ref={selectRef} …>`; the open-focus keeps working through the ref            |
| builder column picker  | `<select data-pretable-filter-row-column aria-label={…hidden/groupedAway…}>`          | `<Select site="filter-row-column" …>`; the state-in-the-name label unchanged                                 |
| builder operator       | `<select data-pretable-filter-row-operator>`                                          | `<Select site="filter-row-operator" …>`                                                                      |
| aggregate picker       | `<select aria-label={…}>` with DEFAULT / NONE / built-ins / `custom`                  | `<Select site="aggregate" …>`; `custom` is `disabled: true`; the closed-vocabulary check stays in `onChange` |

Every site keeps its `data-pretable-*` attribute (the aggregate picker gains
`data-pretable-aggregate` so it has one). `OPERATOR_LABELS` stays the one
un-localised string set, as the docs record.

**Test drivers migrate with the sites, once.** The jsdom helpers that
`fireEvent.change` a native select become one shared `chooseOption(trigger,
value)` — click the trigger, click `[data-pretable-option][data-value]` in
`document.body` — and `.value` assertions become
`toHaveAttribute("data-pretable-value", …)`. The e2e `toHaveValue` checks in
`tool-panel.spec.ts` become the same attribute assertion, with picker
interactions through a `chooseOption` in `e2e/helpers.ts`. No test loses a
claim; each is re-expressed against the DOM the component renders.

## CSS

- Trigger, in the kit section after the button rules: the shared box on
  `[data-pretable-select]` — `inline-flex`, `justify-content: space-between`,
  `gap`, `border: 1px solid var(--pretable-rule)`, `border-radius:
var(--pretable-radius-control)`, `background: var(--pretable-bg-grid)`,
  `color: var(--pretable-text-cell)`, `font: inherit`, `padding-inline`,
  `cursor: pointer`; the caret in `--pretable-text-dim`. Ring and disabled in
  the state section.
- Sites keep only their size: the builder's pickers and the aggregate picker
  `block-size: 24px`; the dialog's `28px`.
- List: `[data-pretable-listbox]` / `[data-pretable-option]` take the enum
  rules verbatim (`max-height: 220px`, `--pretable-bg-grid` surface,
  `--pretable-rule-strong` border, `--pretable-shadow-overlay`, the portaled
  font trio plus `line-height`, hover and selected tints, `:empty` hidden).
- Guards: the site guard's `OWN` table gains the four select sites; the kit
  guard asserts the trigger declarations; the bracket guard already covers
  ordering. Forced colours: `[data-pretable-option][aria-selected="true"]`
  takes `Highlight` / `HighlightText` with `forced-color-adjust: none`, the
  same answer as cell selection. Reduced motion: nothing animates.

## Measurement

The measurement script gains four entries — the trigger boxes at rest and on
focus — recorded before any code changes. The native popup was never
measurable, so the list has no baseline; its look is the enum editor's, which
is unchanged by the extraction. Definition of done: no trigger pixel moves.

## Testing

- **Primitive** (jsdom): `useListboxKeys` — every key, wrapping, disabled
  skipping, typeahead accumulate and reset, open-on-key; `Listbox` — markup
  and ARIA per option, active scroll-into-view, empty renders nothing,
  outside click closes. Each negative claim with its positive twin;
  mutation-checked.
- **Select**: opens on click / ArrowDown / Enter / Space; commits on option
  click / Enter; Escape closes and refocuses; Tab closes;
  `aria-activedescendant` tracks; an absent `value` renders as its own label;
  `data-pretable-value` is written; the name is a type error to omit (type
  test) and warns when empty.
- **Enum editor**: its existing suite passes unchanged after the extraction.
- **Override**: `components.Select` replaces all four sites, including the one
  in the portalled dialog; a stable map does not remount; all four sites
  pinned to the kit component and site name.
- **Browser** (`/fixtures/components` gains the pickers): keyboard-only
  selection in webkit including typeahead; the dialog's operator picker
  focused on open; a replaced Select receives that open-focus through its
  ref. `bench:e2e` and the website suites the migration touches.

## Docs

The Components page gains a Select section (props table registered with the
api-surface guard). Three sentences stop saying "select": `filtering.mdx`'s
"an operator select", `tool-panel.mdx`'s "one `<select>` per aggregate row",
and its note that the add-group menu shares the pickers' keyboard — now
literally true. Changeset: minor `@pretable/react`, patch `@pretable/ui`, with
the note that consumers who located these pickers as `select` elements now
find a `button[role="combobox"]` carrying `data-pretable-value`.

## Out of scope

Rich option rendering, multi-select, a search input inside the Select (the
enum editor's job), the group panel's chip listbox, a native-`<select>`
fallback for coarse pointers, and every input control (SP3).
