# Size-gating the synchronous filter and sort paths — design (issue #488)

Date: 2026-08-27. Follow-up to the dense-handle arc (#487) and the #457
sort-latency arc; certification instrument: the `filter-keystrokes` script
(#489, merged).

## The governing bar (pre-existing, not invented here)

`2026-08-24-dense-handle-core-design.md`:

> **Any single main-thread block ≤ 50 ms** on every measured script. A path
> that cannot meet this at some scale must size-gate to the retained
> cooperative path at that scale rather than ship a longer block.

Measured today at 50k (S2, browser long-task): the synchronous filter fast
path blocks ~87–93 ms; the synchronous sort fast path was measured at
247–279 ms pre-arc and its shape is unchanged (full visible-set sort +
n-insert tree build on the caller's stack). At 3k, observed blocking is 0
(below the 50 ms long-task floor). Both paths violate the bar at 50k; the
cooperative path (retained in full) blocks 0.

## The change

One dispatch-condition edit in `create-local-row-model.ts` `setQuery`
(~line 1286): the existing `fastPath` selection —

```
ungrouped && (sort-only ∨ filter-only)
```

— gains a per-path row-count eligibility:

```
ungrouped && sort-only   && rows ≤ sortLimit   → sync sort rebuild
ungrouped && filter-only && rows ≤ filterLimit → sync filter rebuild
otherwise                                       → cooperative transition
```

- **Count**: `root.rows.size` — the committed resident-row population, O(1),
  the same quantity cooperative progress reports against (`totalRows`).
  NOT `slotCapacity` (allocator capacity, inflated by churn), NOT
  `visible.rows.size` (a widening filter would dispatch as "small").
  Read from the committed `root` at the dispatch point, after the grouped
  check, before `cancelActiveTransition` — the root is never a half-built
  count there (nothing publishes before a transition's `finish`).
- **Per-path limits**, because the cost curves differ by ~9× (sort does a
  full visible-set `Array.sort` + n tree inserts + n HAMT gets; filter does
  one bulk verdict pass + a merge that sorts only flipped-in rows).
- **Grouped queries are untouched**: the grouped arm stays first and never
  consults the count.
- **Conservatism rule carried forward** (filter-subset-rebuild design):
  any doubt → cooperative path. The gate only ever moves work FROM sync TO
  cooperative; no new sync eligibility is created.

### Injectable limits

Two `@internal` model options, siblings of `transitionBudgetMs`:
`ɵsortFastPathRowLimit` and `ɵfilterFastPathRowLimit` (number; default =
the measured constants below; tests inject tiny limits to pin BOTH sides
of the dispatch with small fixtures — without this, every above-gate test
costs a 10k-row fixture). Not plumbed through `packages/react`; the
internal package's api report will drift by these two options and is
regenerated (`pnpm build && pnpm api`).

`ɵ`-prefixed members cannot be `{@link}`ed in tsdoc (api-extractor rejects
the reference) — use backticks in comments.

## How the default limits are decided — measured, not guessed

The block the user feels is the BROWSER's long task, not the engine's
rebuild: a node microbench of the engine alone (this machine, medians of 5) reads filter 19 ms / sort 170 ms at 50k, while the browser observes ~90
ms for the same filter commit — the sync publish carries layout-core
refilter and the React commit inside the same task. So thresholds come
from a **browser sweep at intermediate row counts**:

1. Temporarily patch `scenarioScaleRowCounts` S2 `hypothesis` (throwaway,
   NEVER committed) to each of {10k, 15k, 20k, 30k}; rebuild the bench per
   size (one variable per side).
2. At each size run `filter-metadata` and `sort` (pretable), 3 repeats,
   recording `post_interaction_long_tasks_ms` (single commit ⇒ the sum is
   the block) and `settle_duration_ms`. Long-task absence floor: the
   longtask API only reports tasks > 50 ms, so "0" means "< 50 ms" — sizes
   whose blocks sit under the floor are bounded by interpolating the
   engine-scaled curve, and the chosen limit must sit at a size where the
   measured block is OBSERVED (non-zero) or the next size up is.
3. **Selection rule**: the default limit for each path is the largest
   swept size whose measured block ≤ 25 ms (half the 50 ms bar — 2×
   headroom for machines slower than this one), rounded DOWN to a round
   number. If no swept size shows a measurable block below 50 ms and the
   next size up exceeds it, take the size below the crossover.
4. The node engine curve (recorded in the results doc) sanity-checks the
   shape: engine block scales ~linearly for filter and ~n·log n for sort;
   a browser sweep that disagrees in shape means the harness is lying
   (bench-ab rule: a flat response across the variable means the harness
   is lying).

Expected bracket from existing data: filter limit likely 20k–30k, sort
limit likely 5k–10k. The measurement decides.

## What the gate trades, stated up front

Above the limit, a filter-only change gives up (a) the ~120 ms settle win
of the sync path and (b) the renderer's in-place `refilter()`/`reorder()`
fast lanes — the cooperative publish carries the `"bulk-replace"` barrier,
whose controller replacement costs ~25–40 ms more settle at 50k
(amendment-G numbers). In exchange the ≥ 87 ms (filter) / ~250 ms (sort)
blocks go to ~0. The bar says the block wins; the certification round
records the settle giveback honestly, including the `filter-keystrokes`
warm number at 50k (which will regress from ~74 ms to cooperative-settle
territory — that is the accepted price, not a surprise).

## Interplay rules (all already enforced by the state machine, re-pinned)

- Sync commit while a cooperative transition is in flight: the sync branch
  `cancelActiveTransition("superseded")` first — already pinned by
  `filter-fast-path.test.ts` / `sort-fast-path.test.ts`. The gate adds the
  reverse flavor at scale: successive above-limit keystrokes are
  cooperative transitions superseding each other — already the pre-#487
  regime, no new machinery.
- Alternating sync/cooperative between commits is safe: candidates capture
  the committed root; nothing is instance-sticky but the runtime and
  allocator.
- Status shape: below the limit `READY` synchronously (unchanged); above
  it per-slice `rebuilding` status (the shape `useSyncExternalStore`
  consumers were designed for — setQuery-async-by-design).

## Tests (all with injected tiny limits; mutation-pinned)

1. Filter-only change at `rows.size` == limit → sync: resolves with no
   scheduler task, journals `"refilter"`. At limit+1 → cooperative:
   scheduler tasks exist, journals `"bulk-replace"`, same final visible
   set (assert the OLD behavior survives — the filter still filters).
2. Same pair for sort-only (`"reorder"` vs `"bulk-replace"`).
3. Grouped query never consults the count (a grouped change below the
   limit still goes cooperative — pin by injecting limit = huge and
   asserting scheduler tasks for a grouped change).
4. Combined sort+filter stays cooperative at ANY size (existing pin,
   re-run).
5. Defaults: a model without injected limits uses the measured constants
   (assert the exported/default values, so a silent default change fails a
   test).
6. Mutations reviewers must run: gate reading `visible.rows.size` instead
   of `rows.size` (a widening-filter fixture must catch it); gate placed
   before the grouped check (grouped fixture catches it); `<` vs `≤`
   boundary (the == limit test catches it).

## Bench certification (the instrument #489 built)

- 3k (`--scale=hypothesis`): sort, filter-metadata, filter-text,
  filter-keystrokes — all UNCHANGED within a frame (below both limits;
  sync path still taken; `"refilter"` lane still hit).
- 50k (`--scale=target`): all four scripts — `post_interaction_long_tasks_ms`
  drops to ~0/below-floor (bar MET); settle and keystroke warm numbers
  recorded as the honest giveback; zero blank frames (the cooperative
  path holds current rows while it works); TanStack same-run controls in
  band.
- Medians of 3, port 4173 checked, output to files (never `grep|head`).

## Out of scope

- No public API. No react plumbing. No change to grouped dispatch,
  `setDerivations`, or combined changes (already cooperative).
- No attempt to shrink the cooperative path's settle (that is #490
  territory).
- No adaptive/time-based gating (measure-and-learn dispatch) — a static
  measured limit is the whole scope; anything smarter is a new brainstorm.
