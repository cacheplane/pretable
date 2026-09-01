---
"@pretable/react": patch
---

`useLocalRowModel` now treats an invalid `rows` or `derivations` update as a
rejected write rather than a fatal one, matching `usePretable`. A bad row (a
duplicate id, a throwing accessor, a missing or non-scalar id, a null row)
previously threw out of a layout effect and unmounted whatever subtree renders
the model. The model now keeps the rows it already had and warns once, and a
later valid `rows` array recovers.

The caveats are the ones `usePretable` carries: the model can stay diverged
from your data indefinitely, the warning latches per fault kind, and there is
no API to ask whether the rows it reports match the ones you passed. Treat the
warning as the signal. Its key is prefixed `local-` so a rejection here can
never be silenced by — or mistaken for — one from `usePretable`.

This supersedes the closing note in 0.14.2, which recorded that
`useLocalRowModel` was still fatal. That was accurate when it shipped; it is no
longer.

A lifecycle fault still propagates: writing to a disposed model, re-entering a
mutation, or any row-model code this guard has not been taught about reaches
you as a throw. So does an invalid `rows` option at MOUNT, which is built
during render and never reaches the guarded effect.
