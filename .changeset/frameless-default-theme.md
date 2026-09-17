---
"@pretable/ui": minor
"@pretable/react": minor
---

The default `pretable` theme is now frameless: no container border, radius or shadow. The header rail is lighter, its resting underline is a hairline, and row rules and the selection tint are one step lighter. While the viewport is scrolled, the sticky header separates from the rows under it with a shadow; `@pretable/react` publishes `data-pretable-scrolled` on the scroll viewport at `scrollTop > 0` to key it.

The token contract grows from 50 to 54: `--pretable-frame`, `--pretable-radius-frame`, `--pretable-rule-header`, `--pretable-shadow-header`. If you author your own theme, declare all four. An undeclared token resolves to nothing, so a custom theme that draws a frame today loses it until it sets `--pretable-frame`, and `--pretable-radius-frame` now owns the container corner while `--pretable-radius` rounds only popovers and chips. Excel and Material are visually unchanged.
