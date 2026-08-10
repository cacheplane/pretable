---
"@pretable/core": patch
"@pretable/react": patch
"@pretable/ui": patch
---

Split the grid's line vocabulary and give numeric columns real alignment.

`--pretable-rule` previously coloured both the horizontal row hairline and the
vertical column divider, so no theme could drop the vertical gridlines without
also losing row separation. Two new tokens, `--pretable-rule-vertical` and
`--pretable-rule-width`, split the axes. Both shipped themes alias the vertical
token back to `--pretable-rule`, so Excel and Material render unchanged.

Columns now carry an optional `align` (`"start" | "center" | "end"`), and the
surface emits `data-pretable-column-type` and `data-pretable-column-align`.
Number columns default to trailing alignment with tabular, lining figures — in
the grid's own font, not a monospace substitute. Alignment uses
`justify-content: safe flex-end`; the `safe` keyword matters, because a plain
trailing alignment clips an over-wide value at its leading edge, which would
render `1,234,567` as a legible and completely wrong `34,567`.

Fixes a bug where header cells, which render as `<button>`, never reset the
user-agent button background — so the grid only looked correct in apps that
happen to ship a CSS reset.

Removes three declarations that never painted: the `[data-pretable-numeric]`
rule, which nothing has ever emitted despite `@pretable/ui`'s README advertising
it as part of the public attribute contract; the `[data-pretable-toolbar]` and
`[data-pretable-status-bar]` rules, which no component can emit; and the
selection rule's `background`, which could never win against the `aria-selected`
rule that follows it at equal specificity. The selection rule keeps its `color`,
which is load-bearing.
