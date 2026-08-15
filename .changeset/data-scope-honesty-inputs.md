---
"@pretable/react": patch
---

Data-honesty checks now read every input from one commit, and the engine-sort
rule finally runs.

**A narrowing query no longer accuses you of a broken total.** `rows` and
`resultMeta.total` arrive together, but the row model ingests rows in a layout
effect — after the render that already read the new total. The contiguous-window
check therefore compared a new total against the previous query's row count:
filter 480 rows down to 120 and it reported that 120 records "cannot be a
contiguous window", then settled at the right `aria-rowcount` a render later.
Because these warnings fire once per page load, that spurious first one
permanently disarmed the check for the rest of the session — the real defect. In
rows mode the loaded count now comes from the `rows` the consumer just handed
over, and the "no total supplied" fallback counts the same records; explicit-model
mode still reads the model, which has no such skew and whose `rows` prop is an
empty array rather than an absent one.

**`processing: { filter: "external", sort: "engine" }` over a partial window now
warns.** The rule was written, unit-tested, and never called from a render.
Sorting a server-selected window locally presents the wrong sample under a
truthful-looking `aria-sort`, and it fires only where that is provable: an exact
`resultMeta.total` counting more records than the grid holds. Wiring it depended
on the fix above — the same one-render skew made an ordinary widening query look
like a partial window.

Settled behaviour is unchanged: the same counts, the same scope answers, and the
same warning for a `resultMeta.total` that really is inconsistent with the rows.
