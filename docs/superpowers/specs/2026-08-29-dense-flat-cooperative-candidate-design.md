# Dense flat cooperative candidate — design (issue #490)

Date: 2026-08-29. The dense-handle treatment for the cooperative transition
path, scoped to FLAT (ungrouped) candidates. Successor to the #487 arc
(which deliberately left `cooperative-transition.ts` untouched as the
size-gate fallback) and to #488 (which then routed all 50k filter traffic
into it). Instrument: the #489/#509 `filter-keystrokes` script.

## The problem, measured

After the #488 size gate, a 50k filter-only change runs the cooperative
candidate and totals ~195–215 ms (zero blocking, controls in band). A
sourcemap-resolved settle-window trace (194 ms window) attributes:

| Share | Cost                      | Source (cooperative-transition.ts)                                                                                                                                             |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ~22%  | persistent-map (HAMT)     | `state.rows = state.rows.set(...)` per row (`insertRecord`) — a full root-to-leaf path copy × 50 000, on the FLAT path only (the grouped path already uses the O(1) transient) |
| ~18%  | candidate machinery       | per-row `captured.rows.get`, `Object.freeze({ ...source, metadata })` record allocation, per-row persistent AVL `insertOrReplace`, `orderedRowEntry` store-get + entry alloc   |
| ~13%  | compiled-query `evaluate` | re-evaluated per row, though a flat set-query cannot change metadata                                                                                                           |
| ~8%   | GC + (program)            | the per-row allocations above                                                                                                                                                  |

Corroboration: the keystroke bench shows narrowing 109 → 12 rows still
costs ~180 ms — the rebuild tracks the RESIDENT population, not the result
— while cooperative SORT at 50k totals only ~50 ms despite inserting all
50k rows into the visible tree per slice. The 4× filter-vs-sort delta is
exactly the per-row `evaluate` + HAMT `set` + record allocation, all of
which identity-carry deletes. That arithmetic is what makes the bar below
credible without changing the slicing contract.

## Scope

- **Flat (ungrouped) candidates only.** The grouped-bulk and
  grouped-incremental lanes are untouched, byte for byte. Grouped
  streaming perf is a separate future arc that may reuse this one's
  machinery.
- Operations covered: flat `set-query` (filter, sort, or combined — the
  identity-carry lane) and flat `set-derivations` (the transient-map
  lane; metadata genuinely changes, so `evaluate` stays).
- No public API. No react/renderer changes. The transition handle,
  status shape, journal barrier (`"bulk-replace"`), and scheduler
  contract are unchanged.

## Bars (agreed with the controller)

- **Primary: 50k flat filter-only total (latency + settle) ≤ 120 ms**,
  measured by `filter-metadata`/`filter-text` at `--scale=target`,
  medians of 3, TanStack same-run controls in band. Fallback: ≤ 150 ms
  ships with the miss documented; > 150 ms triggers a rethink.
- Keystroke warm p50 at 50k ≤ 130 ms.
- **Zero observed long tasks preserved** at 50k on every script (the
  #488 bar stays met — this arc must not trade blocking back in).
- No regression: 3k (all scripts, sync paths), cooperative sort 50k
  (~50 ms today), grouped scripts, `replace`/`append`.
- Dense-handle revert discipline: a lever that measures flat twice is
  reverted, not rationalized.

## Architecture

### File split

`createCooperativeTransitionCandidate` currently multiplexes three lanes
(flat / grouped-bulk / grouped-incremental) through one `step()` and one
`insertRecord`. The flat lane moves to a new module:

- **Create: `packages/row-model/src/flat-cooperative-candidate.ts`** —
  `createFlatCooperativeCandidate(options)`, same
  `CooperativeTransitionCandidate` interface (`step/append/finish/release`
  - `completedRows/totalRows`).
- `cooperative-transition.ts` keeps the grouped lanes and the scheduler /
  slice-runner primitives; its constructor dispatches to the flat module
  when `queryPlan.query.rowGroups.length === 0`, so
  `create-local-row-model.ts` does not change its call site.
- Both lanes register the SAME `CooperativeTransitionCandidateDiagnostics`
  shape in the candidate WeakMap (flat reports `hasGroups: false`,
  `overrideReconciliationRemaining: 0`) — `diagnostics.ts` reads it
  unconditionally.
- The `options = undefined as never` retention cut is preserved
  (`retention.test.ts` pins `transitionCandidateRootCount`).

### M1 — identity-carry (contract-preserving; the milestone expected to hit the bar)

Phases keep today's strict order — build → replay → done — and today's
**one-row-per-`step()`** unit, so every budget/slice/progress pin in
`transitions.test.ts` stays green unmodified.

**Build phase, `set-query` lane (identity-carry):**

- At construction: `adoptEvaluationCache(nextPlan, captured.queryPlan)` —
  the whole-store cache handoff the sync paths already use and the
  cooperative path never did (free share of the 13%).
- Per step: resolve the next row from the captured root's own dense
  structures — walk `captured.recordsBySlot` in slot order via a cursor
  instead of `sourceOrder.entries()` + `captured.rows.get` per row. (The
  visible tree is rebuilt in visible order regardless; slot order is fine
  for the sweep, and the sourceOrder tree carries by identity.)
- **No `evaluate`, no record allocation**: on an ungrouped `set-query`,
  `CompiledRowMetadata` cannot change — `groupPath` is `[]`, and
  `aggregateLeaves` derive from derivations, which `set-query` does not
  touch. (Leaves DO embed sortKeys in their dependency, but on a flat
  root nothing consumes `metadata.aggregateLeaves` — only the group index
  reads them. This claim is asserted in code with a comment and pinned by
  the equivalence oracle below.) The record carries **by identity**,
  exactly as `filter-rebuild.ts` carries survivors.
- Per step, for the carried record: `filterVerdict(nextPlan, record)`;
  passing rows insert into the fresh visible tree via
  `orderedRowEntry(nextPlan, record)` as today, and set their bit in a
  mutable membership bitset sized to the candidate's `slotCapacity`
  (nothing is published mid-flight, so incremental mutation is safe).
- `rows` (HAMT) and `recordsBySlot` **carry by identity** from the
  captured root — zero HAMT writes, zero slot-vector rebuild — UNLESS a
  delta arrives (below).

**Build phase, `set-derivations` lane (transient):** metadata genuinely
changes, so the per-row `evaluate` + fresh record stay — but the rows map
is built through `initialRows.asTransient()` (the grouped path's existing
O(1) form, currently denied to flat), frozen once at the end of the build
phase, and `recordsBySlot` is written per row as today. This alone retires
the HAMT share for derivations transitions.

**Delta replay (both lanes):** deltas keep today's queueing (`* 2 + 1`
unit accounting, capacity widening from `delta.target.slotCapacity`,
processed-delta-root drop). The replay phase needs keyed lookup and
mutation, which identity-carry doesn't have — so **the first `append`
upgrades the candidate**: it converts `rows` to a transient (one
`asTransient()` on the carried map — cheap, structural sharing), copies
`recordsBySlot` into a mutable array, and builds a plain
`Map<rowId, slot>` for the replay lookups. Replay then runs today's
remove-then-insert semantics against those. A transition that never sees
a delta (the overwhelmingly common case, and the only case the bench
measures) never pays any of it. Replayed inserts read the record out of
the delta TARGET root (post-commit body, possibly a new slot) and — in
the set-query lane — carry it by identity too (the target root's records
were evaluated under the model's live plan; the candidate's plan differs
only in filter/sort, which don't change metadata; `filterVerdict` is
re-run under the candidate's plan).

- `finish` after an upgrade freezes the transient and rebuilds the slot
  vector from the mutable array (today's sweep); `finish` without an
  upgrade carries both by identity and derives `visibleSlots` from the
  bitset the sweep already filled (deleting today's `membershipFromFlatTree`
  O(n) walk from the finish stack).

**Progress/status:** `totalRows` seeds from `captured.rows.size`, grows
per delta exactly as today; `completedRows` advances 1 per step. The
`rowsEvaluated` instrumentation counter stops incrementing on the
identity-carry lane (deliberate — nothing is evaluated; documented at the
counter); `transitionRows` still counts every swept row. `work.test.ts`
gains a flat pin: a 10k flat set-query transition performs ZERO
`hamtNodesCopied` and ZERO `rowsEvaluated` (the dense claim, mutation-
provable by reverting either carry).

### M2 — chunked sweep + terminal bulk build (ONLY if M1 misses the bar)

For order-unchanged deltas (filter-only): resumable slot-vector chunk
(1024 slots) as the unit, survivors accumulated per slice, one terminal
merge against the old visible walk + `createOrderStatisticTreeFromSortedEntries`
with `orderIsProven` + `derivedById` at `finish`. Costs: the
one-row-per-unit progress pins (`transitions.test.ts:284/599/621/686`)
must be deliberately re-pinned, and the terminal build is a measured
burst that must stay under the 50 ms block bar (today's finish already
runs three unbudgeted O(n) passes with zero observed long tasks; M2
removes two and adds the build). **M2 is not planned in detail here — if
M1's certification misses 120 ms, M2 gets its own amendment with the
re-pin list and burst budget before any code.**

## Correctness spine

- **Equivalence oracle**: extend `filter-fast-path.test.ts`'s
  cold-model oracle to the flat cooperative lane — for a matrix of
  (filter-only / sort-only / combined / derivations) × (with / without a
  mid-flight delta), the settled cooperative result must equal a cold
  model built directly at the final state (ids, order, visibleSlots,
  snapshot reads).
- **Identity pins**: after a delta-free flat set-query transition,
  `root.rows` and `root.recordsBySlot` are the captured root's own
  objects (`Object.is`), and survivor tree entries are the captured
  records by identity. Mutation-prove by re-introducing a spread.
- **Inherited invariant pins re-run unchanged**: slot capacity only from
  captured/delta targets (never the live allocator), processed-delta-root
  drop, retention counts (`transitionCandidateRootCount` /
  `transitionDeltaRootCount` zero after settle), COW pinning of held
  snapshots, cancellation/supersede semantics including mid-replay
  cancel, budget/slice bounds under a stalled clock, hostile-hook
  rollback, `records-by-slot.test.ts:132` (delta grew slot space).
- **Aggregate-leaves caveat verified in code**: the identity-carry lane
  asserts (dev-time or via the oracle) that the plan's rowGroups are
  empty on both sides; the design's "leaves are consumed by nothing on a
  flat root" claim is stated at the carry site with a pointer to the
  group-index consumer, so a future grouped-leaves reader trips over the
  comment, not silently over stale leaves.
- **Mutations reviewers must run** (minimum): drop the adopt-cache call
  (equivalence must still hold — it's a perf lever, tests must NOT
  depend on it); carry a STALE record after a delta replaced it (oracle
  catches); skip the bitset write for one row (visibleSlots equivalence
  oracle catches); break the upgrade-on-append path by leaving rows
  identity-carried (replay tests catch); flip `hasGroups` in flat
  diagnostics (diagnostics test catches).

## Certification

- Traced before/after at 50k filter-metadata (`--window=settle`, shares
  only): the HAMT and evaluate shares must collapse; publish the table.
- Bench rounds per the bars above: 3k + 50k, scripts sort /
  filter-metadata / filter-text / filter-keystrokes, pretable + tanstack,
  medians of 3, port 4173 checked, output to files (never `grep|head`).
- Full root `pnpm build && pnpm api` (internal package — no public
  report drift expected) + all suites.

## Out of scope

- Grouped candidates (future arc).
- The columnar verdict cache (re-judged only AFTER this arc's landscape
  change, with the #509 keystroke instrument).
- Scheduler/budget tuning, react/renderer changes, any public API.
