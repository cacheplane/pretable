---
"@pretable/react": patch
---

Let header text follow `--pretable-text-header` instead of an inline
`color: inherit`, which beat the skin and silently rendered header labels in the
body-cell color. Completes the pair with the header divider fix: header text is
now dimmer than cell text again, in both light and dark themes, and consumer
token overrides reach it.
