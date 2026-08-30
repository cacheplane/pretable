---
"@pretable/react": patch
---

Preserve row-layout scroll anchoring across controller rebuilds. Controller
status publications no longer re-feed an unchanged grid viewport and overwrite
the controller's anchor-adjusted scroll position; only a real grid/DOM viewport
change supplies new scroll authority.
