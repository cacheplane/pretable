---
"@pretable/react": minor
"@pretable/ui": patch
---

The first two components of a kit the grid renders its own chrome from, and a
`components` prop to replace either with your own.

`PretableButton` (two looks: `ghost`, the 24px action with a hover tint, and
`link`, plain accent text) and `PretableIconButton` (an icon-only button whose
`aria-label` is a required prop — omitting the accessible name is now a
compile error, and an empty one warns in development). Both are always
`type="button"`, pass `className` and `style` straight through, forward their
`ref`, and carry `data-pretable-button` / `data-pretable-icon-button`,
`data-pretable-variant` (labelled buttons) and `data-pretable-site` for styling
through the grid's usual attributes-and-tokens channel.

`components={{ Button, IconButton }}` on `<PretableSurface>` and `<Pretable>`
replaces a component everywhere it appears — the tool panel, the header, the
group panel and the portalled filter dialog — and the replacement receives
exactly the props the built-in does, `site` included, so it can branch on where
in the grid it is. It must forward its `ref` (under React 18, `forwardRef`; under
React 19 a plain `ref` prop): the grid anchors menus on and returns focus to
that node.

The grid's twelve plain push-buttons now render from these. Each keeps its
original attribute (`data-pretable-filter-clear`, `data-pretable-tool-reset`,
…), so selectors and stylesheets keyed on them keep working; the shared look
moved from twelve site rules onto the component rules, and every site's
computed box, colours and focus ring were measured before and after — no pixel
moved. Three things did change on purpose: `Clear` and `Reset columns`, and the
funnel, column-menu and chip-remove icon buttons, now wear the product's focus
ring rather than the browser's; `Clear` and `Reset columns` carry the control
radius (visible only on that ring's corners); and the kit icon-button rule does
not set `position: relative` — the three grid buttons that enlarge their hit
area with a `::after` declare it themselves, so a consumer rendering an
absolutely-positioned child inside `PretableIconButton` should position the
button explicitly.

Two smaller notes. The set of built-in `site` names (`PretableBuiltInButtonSite`)
grows additively — a new grid button may add one without a major bump. And the
two portalled surfaces that host these controls, the filter dialog and the
column menu, now declare `line-height` alongside the family, size and colour
they already declared: `font: inherit` on a kit button had been pulling the
host page's line-height into `Clear` and every menu item for a consumer with no
CSS reset.
