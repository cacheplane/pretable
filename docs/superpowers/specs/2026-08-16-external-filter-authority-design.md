# External filter authority actually suppresses local filtering

Status: approved · 2026-08-16

`processing: { filter: "external" }` declares that something outside the grid
decided which records exist. Today the engine goes on applying the published
filters to whatever rows it was handed anyway.

## Why this is a defect and not a quirk

It is idempotent in the happy path — the server answered the same query, so
re-applying it changes nothing — which is why it went unnoticed until the
server-side docs were written.

It stops being idempotent the moment `rows` and `query` disagree, and the
lifecycle documentation promises they will:

> the previous result stays on screen while the new one loads

During `dataState.phase === "stale"` the loaded rows answer the PREVIOUS query
while the grid holds the NEW one. The engine filters the old rows by the new
filter, and the reader watches rows vanish and return. The grid breaks a
promise the docs make on its behalf.

The same mechanism is already demonstrated in the `error` phase, and the
disproof is on `/docs/server-data`: same rows, same 500, `contains "fail"`
renders 0 rows while `notContains "fail"` renders 12.

Under external authority the consumer owns which records exist. Re-applying the
query is the grid overruling the authority it was just told it does not have.

## Scope

**In:** `processing.filter === "external"` suppresses the engine's application
of `query.filters`, in rows mode.

**Out, deliberately:**

- **Sort.** `sort: "external"` keeps reordering locally. Filtering is where the
  harm is; a consumer with a complete window who sorts locally is doing
  something reasonable, and over a partial window the engine already warns.
  Its own follow-up, with its own evidence.
- **Grouping.** `rowGroups` is not part of `PretableProcessingOptions` at all
  and is unaffected.
- **Explicit-model mode.** `processing` is a surface prop. A consumer who
  builds their own model already controls what goes into the query and can omit
  the filters. Half-plumbing it would be worse than stating the boundary.

## Design

### The seam already exists

`CompiledQueryPlan` (`packages/row-model/src/compiled-query.ts`) keeps two
fields that are today the same content in different normal forms:

| Field           | Read by                                                      | Meaning                   |
| --------------- | ------------------------------------------------------------ | ------------------------- |
| `#publicQuery`  | `get query()` → the snapshot, the funnel UI, `onQueryChange` | what the reader asked for |
| `#runtimeQuery` | `evaluate()` → per-row metadata                              | what the engine applies   |

`compileQuery` gains the processing authority. When filtering is external,
`#runtimeQuery` is built with `filters: []` while `#publicQuery` keeps them.

The consequence is the whole point: the funnel still shows the active filter,
`onQueryChange` still publishes it, `aria-sort` is untouched — the engine just
stops re-selecting records.

### Three consequences to pin with tests, not assume

1. **Group aggregates** fold the filtered set today. Under suppression they
   fold everything loaded. That is _correct_ when the server chose the records,
   but it is a behaviour change and needs a test that says so deliberately
   rather than discovering it later.
2. **`semanticallyMatches`** is the plan's recompile cache; it compares columns
   and query. Authority must join that comparison, or flipping `processing` at
   runtime silently reuses a stale plan. This is reachable, not theoretical:
   `processing` is a **render-time read**, never in a memo dependency and never
   handed to `createGrid` — the previously-documented claim that changing it
   reconstructs the local model was verified false on 2026-08-14.
3. **Explicit-model mode** must be unchanged. A test should hold that, so the
   boundary above is enforced rather than merely written down.

## Testing

The load-bearing test is the one that motivated the change, and it must be
written first and watched fail:

> Under `processing: { filter: "external" }`, with rows answering query A and
> the grid holding query B, every row A returned is still rendered.

Today that fails: the rows are filtered by B. Prove it fails before fixing it.

Then the three consequences above, each with a test that can fail by mutation —
break the fix, watch the specific test go red, revert.

Do not assert a row COUNT where a row-id set is the real claim; a count
survives a wholesale replacement.

## Docs

Full docs rework is deliberately a second PR. One exception ships with this
change: `/docs/server-data`'s overview contains a **reproducible experiment**
("filter Customer for `fail` and the body empties, while `notContains fail`
keeps every row") whose stated outcome this change reverses. A reader running
it would get the opposite result. That paragraph is corrected here; everything
else waits.

The four pages otherwise describe `processing` as a claim about authority that
does not stop the engine. That framing becomes wrong, and the second PR rewrites
it — keeping the `stale`/`error` explanation, which stops being a caveat and
becomes the reason the change matters.

## Verification

- `pnpm build` before `pnpm api:check`; a stale `dist/` silently strips
  exports. `apps/bench` reads `packages/react/dist`, so any bench measurement
  needs a rebuild between variants.
- A changeset. `@pretable-internal/grid-core` is `private: true` and must not
  appear.
- `prettier --check .` is repo-wide.
- The docs guards are fail-closed; the corrected paragraph must keep them green.

## What must be true afterwards

1. Under external filter authority, the engine renders the rows it was handed.
2. The funnel, `onQueryChange` and `aria-sort` are unchanged — suppression
   changes what is APPLIED, never what is REPORTED.
3. Flipping `processing` at runtime recompiles rather than reusing a plan.
4. Explicit-model mode behaves exactly as before.
5. No page invites a reader to run an experiment whose outcome has changed.
