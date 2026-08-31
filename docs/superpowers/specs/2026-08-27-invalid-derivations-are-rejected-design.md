# An invalid derivations update is rejected, not fatal — Design

**Status:** approved.

## What this is

Today an invalid `aggregate` reaching the row model **after mount destroys a live
grid**. The compiler's `CompiledQueryValidationError` is thrown synchronously
from `setDerivations` inside a React layout effect, so it escapes the commit and
React unmounts the subtree.

This makes that update a **rejected write** instead: the grid keeps the
derivations it already had and stays interactive.

## The hazard is wider than the ticket that produced it

The follow-up was filed against `setColumnAggregate`, whose values grid-core
stores uninterpreted. Measured on `77e56cb0`, that framing was too narrow —
both doors into the derivations seam are fatal, and the second one is reachable
by every consumer:

| Path                                                     | Result                                          |
| -------------------------------------------------------- | ----------------------------------------------- |
| Invalid `aggregate` on the `columns` prop, **at mount**  | throws; grid never renders                      |
| Invalid `aggregate` on the `columns` prop, **on update** | throws; **group rows 1 → 0, container 0 bytes** |
| Invalid value via `setColumnAggregate`                   | throws; same destruction                        |

The prop door needs no pane, no grouping state, and no knowledge of this
feature — a consumer who changes a column's `aggregate` at runtime hits it.

## Decisions

1. **Guard the derivations seam, not `setColumnAggregate`.** One `try`/`catch`
   around the synchronous `rowModel.setDerivations(...)` in `use-pretable.ts`'s
   derivations layout effect. Both doors pass through it. grid-core and
   row-model are unchanged: the compiler stays the sole authority on validity,
   and grid-core keeps storing aggregates uninterpreted (giving it the
   aggregate vocabulary would breach the layering `aggregate-overrides.ts`
   documents).
2. **Catch `CompiledQueryValidationError` only.** Every other error rethrows.
   A blanket `catch` here would hide unrelated faults inside a layout effect,
   which is precisely the class of bug this seam already produces.
3. **Reject the whole update; keep last-good.** The row model keeps the
   derivations it was using. An update lands entirely or not at all — partial
   application would leave "which parts landed?" unanswerable for a consumer
   diffing prop against rendered state.
4. **Leave the rejected identity in `lastDerivations.current`.** It is assigned
   _before_ the throw today, so the rejected array is already recorded as last
   requested. Keeping it is deliberate: the failed update is attempted **once**
   rather than recompiling on every later render. Restoring the previous value
   would retry the same invalid input indefinitely. Recovery is unaffected — a
   later valid array is a new identity.
5. **Report through `warnOnce`** (`packages/react/src/dev-warn.ts`), the
   established channel for "consumer misconfiguration the component cannot
   repair". Its own doc argues why it is not build-flag gated: a
   misconfiguration surviving to production is the one still worth reporting.
   No new prop, no error callback.
6. **Mount stays fail-fast.** Asymmetric on purpose: at mount there is no
   running grid to protect and a hard error surfaces a config bug at its
   cheapest moment; on update there is a live grid someone is working in.

## The trap this design must not spring

**`warnOnce` latches.** One fire disarms that key for the rest of the session.
`pretable-surface.tsx:3614` records what that cost last time: a render-order
skew tripped the contiguous-window check, `warnOnce` latched, and the check was
disarmed for the session.

So the key must include **the column id and the offending value** — not a bare
`"invalid-aggregate"`. Otherwise the first bad value silences every later,
different one. The message names the column, the value, and that the update was
rejected.

## Verification

Fixtures must **disprove**, so assert the grid _survives with its previous
aggregate still rendering_ — not merely that no error escaped. A grid that
rendered nothing would pass a no-throw assertion.

- Both doors: an invalid `aggregate` arriving on the `columns` prop, and one
  written via `setColumnAggregate`. Each asserts the previous aggregate's
  computed value is still on screen.
- A valid update **after** a rejected one still lands — recovery is the half
  that decision 4 puts at risk.
- The warning fires, and names the column and the value. `resetDevWarnings()`
  exists for exactly this.
- Mount still throws (pins decision 6 against a future "make it uniform").

Mutations that must fail a test:

- remove the `try` → the destruction tests fail;
- widen the catch to all errors → a non-validation error must still propagate;
- key the warning on a constant → the second distinct bad value must still warn;
- restore `lastDerivations.current` on catch → the recompile-once test fails.

## Amendment (2026-08-31): the sibling seam, an invalid QUERY

The original spec deferred invalid **filters/sort/rowGroups** reaching
`setQuery`, on the theory that reject semantics were a different question
because a query is consumer-controlled state with an `onQueryChange` round
trip. Measurement on `59835a48` shows the question is smaller than that, and
that one of the two doors is already correct.

| Path                                             | Result                                 | Verdict                                                                                                |
| ------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Invalid query at **mount**                       | throws; grid never renders             | fail-fast, as for derivations                                                                          |
| Invalid query on the **`query` prop**, on update | throws; **rows 3 → 0, bytes 8702 → 0** | **the hazard**                                                                                         |
| `grid.setQuery` while **controlled**             | no throw, no change                    | **correct** — documented at `pretable-model.ts:375-390` to report intent via `onQueryChange` and stop  |
| `grid.setQuery` while **uncontrolled**           | throws, **grid survives intact**       | **correct** — a synchronous, catchable throw out of the consumer's own call, not inside a React commit |
| A later valid `query` prop after a rejection     | recovers; rows back to 3               | already works; pin it                                                                                  |

Two faults were used, both realistic: a filter whose operator requires an
operand and has none (`compiled-query.ts:957`), and a `rowGroups` entry naming
a column that does not exist.

**The `onQueryChange` concern dissolves.** It applies to the imperative path,
which is already correct. On the prop path a rejection must **not** fire
`onQueryChange`: that callback reports engine-originated query changes, and a
refused consumer prop is not one.

### Decisions (same shape as the derivations fix)

7. **Guard only `applyQuery`'s `rowModel.setQuery(desiredQuery)` call**
   (`use-pretable.ts:608-612`), in the same layout effect. Catch by `name`,
   `CompiledQueryValidationError` only; everything else rethrows.
8. **Reject the whole update; keep the last-good query.** The grid stays
   interactive on the query it was already using.
9. **Leave the rejected identity in `lastControlledQuery.current`.** It is
   assigned before `applyQuery` runs, exactly as with derivations, so the
   failed update is attempted once rather than on every later render.
10. **A rejection does not fire `onQueryChange`.**
11. **`warnOnce`, keyed as the derivations rejection is** — `columnId` plus an
    index-stripped `path` plus `detail` — so a second, different fault is not
    swallowed by the first one's latch.
12. **Preserve the two behaviours that are already right:** mount still
    throws, and an uncontrolled `grid.setQuery` still throws synchronously to
    its caller. Both get pins, because a future "make it consistent" change
    would otherwise swallow a catchable API error and a config error.

### One asymmetry worth recording

`applyQuery` runs synchronously when no derivations transition is pending, but
is chained with `.then()` when one is. A throw on the chained path becomes an
unhandled rejection rather than an unmount, so the fatal signature only appears
on the synchronous path. The guard covers both; the tests must not assume the
synchronous one.

## Out of scope

Mount behaviour. Any new public prop or error callback. Changing what the
compiler considers valid. (Invalid filters/sort/rowGroups were originally out
of scope; the amendment above brings them in.)
