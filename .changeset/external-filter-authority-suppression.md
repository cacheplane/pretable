---
"@pretable/react": patch
"@pretable/core": patch
---

`processing: { filter: "external" }` now stops the engine applying
`query.filters`, without changing anything the grid reports.

Declaring external filter authority used to change nothing about which rows were
drawn: the engine went on re-applying the published filters to whatever rows it
was handed. That is idempotent while the rows and the query agree — the server
answered the same query, so re-selecting changed nothing — which is why it went
unnoticed. It stops being idempotent the moment they disagree, and the lifecycle
guarantees they will: during `dataState.phase === "stale"` the loaded rows answer
the PREVIOUS query while the grid already holds the NEW one, so the engine
filtered the old window by the new filter and the reader watched rows vanish and
return. The same mechanism was reproducible in the `error` phase — same rows,
same failed request, `contains "fail"` emptying the body while `notContains
"fail"` kept every row.

Under external authority the consumer owns which records exist, so re-applying
the query was the grid overruling the authority it had just been told it does not
have.

Nothing that is REPORTED moves. The funnel still shows the active filter,
`onQueryChange` still publishes it, the query in the snapshot is byte-for-byte
what it was, and `aria-sort` is untouched. A filter naming a column that does not
exist is still rejected. Only the record selection stops.

Two consequences worth naming:

- **Group aggregates fold everything loaded.** With `aggregateFilteredRows`, the
  filtered population under suppression is the whole loaded window, because the
  server already chose it. Groups whose rows all failed the local filter now
  appear with their totals instead of disappearing.
- **Sort is deliberately unchanged.** `sort: "external"` still lets the engine
  order the rows it was given; only filtering is suppressed.

Rows mode only. A consumer who supplies their own model through `model=` already
decides what goes into the query and can omit the filters themselves, so the
surface never moves that model's authority.
