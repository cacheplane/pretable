---
"@pretable/react": patch
---

`usePretable` — and `PretableSurface`, which routes its `rows` through it —
now treat an invalid `rows` update as a rejected write rather than a fatal one.
A bad row (a duplicate id, a throwing accessor, a missing or non-scalar id, a
null row) previously threw out of a layout effect and unmounted the live grid.
The grid now keeps the rows it already had and warns once, and a later valid
`rows` array recovers.

Note the shape of "keeps the rows it already had": the grid can stay diverged
from your data indefinitely. The warning latches per fault kind, so a second
rejection of the same kind is silent, and there is no API to ask whether the
rendered rows match the ones you passed. Treat the warning as the signal.

`useLocalRowModel` is unchanged: it drives a row model directly and its
`setRows` is still unguarded, so an invalid `rows` prop there is still fatal.
