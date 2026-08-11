---
"@pretable/ui": minor
---

Add `@pretable/ui/themes/pretable.css`, a first-party house theme.

Excel and Material are imitations of other products. This one is the grid's own voice, and its
identity is craft rather than hue: hairline rules, horizontal-only separation, a quiet header, honest
elevation, and a single functional interaction colour that reads as a system convention rather than a
brand.

The reference designs get away with near-invisible hairlines because their tables sit on a grey page.
pretable never paints the host's page, so it paints its own canvas _inside_ the component: the header
rail and the drag-to-group strip are tinted 1.14:1 off the data surface, which is what lets the rules
stay hairlines and gives them something to read against. Group rows sit half a step off that canvas,
so they read as structure without flattening into the records they contain, and pinned columns stay
the same white as the data — a frozen column is data, not chrome.

Vertical rules are dropped entirely (`--pretable-rule-vertical: transparent`); the frozen-column edge
is carried by `--pretable-seam-color` instead. That matters more as rows get taller, where a vertical
divider becomes a long empty channel running through whitespace.

Ships all 45 contract tokens at `:root` plus `--pretable-group-indent`, a `[data-theme="dark"]` block
that restates every colour rather than aliasing, and three `[data-density]` tiers. Default density is
standard: 48px rows under a 52px header.

Existing themes are untouched. One change reaches beyond the new file: `--pretable-shadow-card` was
declared by every theme and consumed by nothing, so the grid's container now actually applies it.
That lets a theme separate the grid from the host page with elevation instead of a drawn frame —
which the frame alone cannot do, because `--pretable-rule-strong` is also the sticky header's
underline and owes 3:1 there. Excel and Material set it to `none` and are visually unchanged; a
third-party theme that already declared a real value will now see it paint.
