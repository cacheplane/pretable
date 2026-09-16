---
"@pretable/ui": minor
"@pretable/react": minor
---

The default `pretable` theme is now frameless and neutral. The container draws no border, radius or shadow; the header rail is lighter and its resting underline is a hairline; row hairlines and the selection tint are one step lighter. The sticky header's seam against scrolling rows is a shadow drawn only while the viewport carries the new `data-pretable-scrolled` attribute, which `@pretable/react` publishes at `scrollTop > 0`. Four tokens are added to the contract: `--pretable-frame`, `--pretable-radius-frame`, `--pretable-rule-header`, `--pretable-shadow-header`. Excel and Material are visually unchanged.
