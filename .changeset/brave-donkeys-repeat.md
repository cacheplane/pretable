---
"@pretable/ui": patch
---

Wire the frozen-column seam, and stop it notching group bands.

`--pretable-shadow-seam` was declared by every theme and read by nothing. That left a latent hole:
a theme that drops the vertical rule **and** gives `--pretable-bg-pinned` no tone step has no
frozen-column boundary at all — and because unpinned cells scroll underneath pinned ones, text would
appear clipped mid-glyph at an invisible line. Both shipped themes escape only because they mark
that edge twice over, with a tone step and a vertical rule.

It is renamed `--pretable-seam-color` and now holds a colour rather than a whole shadow. The right
edge needs the mirror of the left edge's offset, and a single shadow value cannot be reversed, so
`grid.css` owns the geometry — which is structural — and the theme owns the strength. Excel and
Material set it to `transparent` and are visually unchanged.

Also fixes a defect introduced when pinned cells and group rows got their own surface tokens: both
pinned rules follow the group-row rule at equal specificity, so any theme that stops aliasing
`--pretable-bg-pinned` and `--pretable-bg-group-row` together would see a frozen column punch a
visible notch through every group band. The shipped themes were immune only by accident.

Custom themes: rename `--pretable-shadow-seam` to `--pretable-seam-color` and give it a colour
(`transparent` opts out).
