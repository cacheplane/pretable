---
"@pretable/react": patch
---

A consumer `grid.setQuery` landing while a chrome query write (filter menu, sort, grouping strip) is still settling is no longer silently reverted by the next chrome write. The consumer's transition supersedes the in-flight chrome one, which left the surface's pending-query record permanently stale; the public handle now takes over that record so subsequent chrome writes build their unnamed axes from the consumer's query.
