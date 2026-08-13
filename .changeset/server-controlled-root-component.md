---
"@pretable/react": minor
---

`<Pretable>` now accepts server-controlled data: `processing`, `resultMeta`, `dataState` and `onQueryChange`, forwarded to `PretableSurface`. Previously these were reachable only from `<PretableSurface>`, so a consumer following the documented entry point had to switch components the moment a server applied their filtering.

The blocker was at the type level rather than in prop forwarding: the query union had no arm for an uncontrolled query *with* change notification, so a component that never exposes `query` could not report that the query had changed. The uncontrolled arm now makes `onQueryChange` optional rather than forbidden. `PretableControlledQueryOptions` is renamed `PretableQueryOptions`, with no alias kept.
