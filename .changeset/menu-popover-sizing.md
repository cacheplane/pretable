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
