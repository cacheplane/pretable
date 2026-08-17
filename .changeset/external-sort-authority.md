---
"@pretable/core": minor
"@pretable/react": minor
---

`processing: { sort: "external" }` now suppresses local sorting, the way
`filter: "external"` suppresses local filtering since #447.

It previously suppressed nothing: the declaration was read in two advisory
places and the engine went on applying `query.sort`. That left the consumer who
declared it worse off than one who did not — declaring external sort authority
silences the partial-window warning and unlocks the full population as
`aria-rowcount`, while the local re-sort it silences the warning about kept
running.

Suppression changes what is APPLIED, never what is REPORTED: `aria-sort`,
`onQueryChange` and the snapshot's `query` are untouched. A consumer holding a
complete window who legitimately sorts locally is unaffected — they declare
`"engine"`, which is the default.
