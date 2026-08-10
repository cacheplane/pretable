---
"@pretable/ui": patch
---

Give the grid a real surface and elevation vocabulary, and fix three bugs it exposes.

Pinned body cells and group rows no longer borrow `--pretable-bg-header`; they have
`--pretable-bg-pinned` and `--pretable-bg-group-row`. Small affordances no longer borrow the card's
`--pretable-radius`; they have `--pretable-radius-control`, because a 12px card radius renders a
14px button as a circle. And `--pretable-reorder-ghost-shadow` — four of whose five uses were
popovers, not drag ghosts — is renamed `--pretable-shadow-overlay`, joined by
`--pretable-shadow-card` and `--pretable-shadow-seam`.

Every new token defaults to the value Excel and Material already resolved, so **neither theme
changes appearance**, verified in a browser across light and dark. The exception is Material's small
controls, which stop being circles.

Three fixes. Row hover was declared before the pinned-cell rules and, since every selector in
`grid.css` is `:where()`-flattened to specificity zero, lost to them — so hovering a row left its
frozen columns unhighlighted and the row visibly broke in half at the pinned edge.

Fixing that exposed a worse one. Hover and selection are translucent state layers, and both replaced
the surface fill rather than tinting it. Pinned cells are `position: sticky` with unpinned columns
scrolling underneath, so a hovered or selected pinned cell lost its opacity and let the scrolled-under
column print straight through it — under Excel, whose hover is `transparent`, completely. Both now
paint into the `background-image` layer and compose over whatever surface colour is beneath, which
also means hover finally tints a zebra row instead of erasing its stripe.

Third: Material's dark mode never overrode the shadow token, so every dark-mode menu, popover and
listbox cast a black shadow onto a near-black surface and nothing read as lifted.

If you have a custom theme, rename `--pretable-reorder-ghost-shadow` to `--pretable-shadow-overlay`
and add `--pretable-bg-pinned`, `--pretable-bg-group-row`, `--pretable-radius-control`,
`--pretable-shadow-card` and `--pretable-shadow-seam`. Aliasing the two surface tokens to
`--pretable-bg-header` reproduces the old appearance exactly.
