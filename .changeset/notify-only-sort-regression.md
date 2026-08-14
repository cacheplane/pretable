---
"@pretable/react": patch
---

Fixed a regression from notify-only query mode (#374): supplying `onQueryChange`
without `query` — the engine still owns the query and merely reports changes,
the `<input defaultValue onChange>` shape — silently disabled sorting (and
filtering, grouping, and any other query-driven interaction).

`setQuery` decided whether to apply a transition by checking whether an
`onQueryChange` callback was present, rather than whether the query was
controlled. Both shapes supply a callback, so the notify-only case took the
same early return as the controlled case: it reported the new query and
stopped, never reaching the row model. The consumer's UI kept clicking a sort
header and nothing happened.

`usePretable` now tells the engine explicitly whether `query` is controlled.
Controlled (`query` + `onQueryChange` both supplied) still reports-and-stops —
the consumer owns the next state. Notify-only (`onQueryChange` alone) now
reports and applies, matching the uncontrolled case it always claimed to be.
