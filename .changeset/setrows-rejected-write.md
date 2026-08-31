---
"@pretable/react": patch
---

An invalid `rows` update is now a rejected write rather than a fatal one. A bad
row — a duplicate id, a throwing accessor, a missing or non-scalar id, a null
row — previously threw out of a layout effect and unmounted the live grid. The
grid now keeps the rows it already had and warns once, and a later valid `rows`
array recovers.
