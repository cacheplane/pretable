---
"@pretable/react": patch
"@pretable/ui": patch
---

The grid's list-shaped menus — the tool panel's column kebab (pin placement +
auto width), the `+ Add group` menu and the header's `⋮` — now size to their
own labels, dim the item that is already the current state, and rule off the
mode bit from the commands.

All three shared `popoverStyle`, which stamps a fixed 240px width: the right
call for `FilterMenu`, a dialog whose form controls stretch to their container,
and wrong for a menu of four short labels, which was drawn as a mostly empty
rectangle spilling well past the grid. Menus now take `menuPopoverStyle` —
content width between a 160px floor and the dialog's 240px, still clamped
horizontally against 240 so the right edge stays safe without measuring.

The pin menu disables the placement the column is already in, but
`[data-pretable-menu-item]` had no disabled treatment at all: the disabled item
kept the enabled color, the pointer cursor, and the hover highlight, so the one
item that cannot be chosen read as the obvious one to click. It now takes the
tool pane's standard disabled treatment (`--pretable-text-dim`, default
cursor), and the hover rule skips it.

`ColumnRowMenu` gained a `role="separator"` between the one-shot pin commands
(which close the menu) and the auto-width checkbox (which stays open) —
`[data-pretable-menu-separator]`, styled by `grid.css`, and not a focus stop.

The same pass over the rest of the portaled surfaces, which cannot inherit
anything from the grid:

- The header's filter dialog declared `font: inherit`, a shorthand that pulls
  the HOST PAGE's size and line-height in — so it drew at the consumer's body
  font (16px on our own site) while every other popover sat at
  `--pretable-font-size-cell`. It now declares the whole trio, as the enum
  listbox and date popover already did, and `[data-pretable-column-menu]`
  gained the `color` it was missing.
- The dialog's operator `<select>` and value `<input>` were 28px and 33px in a
  stacked pair, because Chrome forces `line-height: normal` on a select and
  ignores what it is given. Both now take one explicit `block-size`, the way
  the tool pane's identical controls already do.
- Those fields kept the UA focus ring, which takes the CONSUMER's
  `accent-color` — a different colour, width and offset from the ring on the
  same controls in the tool pane. They now take `--pretable-focus-ring`.
- The column-reorder ghost is a copy of a header cell but declared neither
  size nor weight and took the cell colour, so the label under the cursor was
  bigger and lighter than the column it came from. It now mirrors the header.
- The date editor's month steppers disable at the calendar's min/max month
  with no disabled treatment and a live hover accent — the menu items' defect
  in a second place. Fixed the same way.

`grid.css`'s "portaled popovers declare the sans font themselves" guard is why
only half of this was caught: it checked `font-family` alone. It now checks
size and colour too, rejects the `font: inherit` shorthand, and is joined by
guards for the ghost's header type, the disabled treatment, the hover
guards, and the dialog's focus ring — each mutation-tested to fail.
