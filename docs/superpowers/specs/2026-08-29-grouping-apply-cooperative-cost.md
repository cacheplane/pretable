# Grouping-Apply Cooperative Cost (#500) — Design

**Status:** approved direction, specced in full.
**Issue:** #500. **First-bad commit:** `72e7d47d` (#321, incremental row-model
migration) — two independent bisects agree. **Diagnosis session:** 2026-08-29;
full numbers in the issue comment.

## The defect

Applying row grouping went from ~400ms (synchronous whole-tree build,
pre-#321) to seconds — ~3.3s at 50k rows with ten aggregated columns — because
the cooperative grouping candidate's accounting is too fine and its clock too
chatty:

1. **One seal unit per (row × aggregated column × {all, filtered} aggregate
   root)** — `packages/row-model/src/group-index.ts` `sealStep` /
   `sealActiveAggregate` (~1740–1860), totalled at
   `cooperative-transition.ts:662-664`. 50k rows × 10 `avg` columns × 2 roots
   = 1,050,008 units.
2. **A `now()` call per unit** inside `runCooperativeTransitionSlice`
   (~line 280), under `DEFAULT_BUDGET_MS = 0.25` with a 256-unit cap
   (`cooperative-transition.ts:78-81`). Measured: 9,540 slices, Σ 2.60s,
   p50 slice 0.30ms — real sliced work at ~6.5× the synchronous build's cost.

Nothing starves. Small grids complete slower (3k: 59→~220ms; 750: 42→133ms);
50k outlives the bench's 96-frame budget, so `group`/`group-expand` report
`partial` at target scale.

**Not the defect:** grouped streaming (p95 10.0ms at 20k on current main —
fixed by #487's structures; the 2026-08-10 baseline's 34.7ms is history), the
scheduler (slices are scheduled and run), and the jsdom setDerivations stall
(distinct; a bench-shaped jsdom repro groups fine).

## Decisions

1. **Coarsen the seal unit to per-row.** One unit seals a row across ALL its
   aggregated columns and both roots. 1,050,008 → 50,004 units at S2 target.
   The unit is what the budget meters; per-unit work grows ~20×, which is
   exactly why decision 2 exists.
2. **Amortize the clock: check `now()` every N units (N = 32), not every
   unit.** The budget comparison itself was a measurable fraction of slice
   time at 0.25ms/unit granularity. With per-row units at ~1-2µs each, a
   32-unit stride bounds budget overshoot to ~64µs — noise against a 16.7ms
   frame.
3. **Do NOT touch `DEFAULT_BUDGET_MS` or the slice cap.** The 0.25ms budget
   is load-bearing for streaming (group-updates p95 10.0ms rides small
   slices interleaved with 60Hz work). The fix makes each budgeted unit
   _worth more_, not the slices longer. Changing one thing is the whole
   bench discipline; the streaming p95 is the fix's CONTROL, not its target.
4. **No synchronous fast path for grouping in this fix.** The #488/#503
   size-gated sync path covers flat sort/filter; extending it to grouping is
   tempting but (a) the coarsened cooperative path should land near the raw
   build cost (~650ms at 50k) already, (b) a sync grouping build at the gate
   boundary would trade a responsive apply for a long task, and (c) it would
   change two things at once. Revisit only if measurement after this fix
   says the remaining gap matters.
5. **The renderer-dom follow-up is filed, not folded in.** After the engine
   commits, three cooperative height-index replacements over the full row
   set cost ~0.6s at 50k before READY. Separate seam, separate issue —
   filed as a follow-up, kept out of this change's blast radius.

## Verification

- **Structural unit test (deterministic, no timing):** the grouping
  candidate's charged unit total for R rows is O(R) — pinned: ≤ R + C for a
  small constant C, with a fixture of ≥8 aggregated columns so the old
  accounting (R × cols × 2) cannot pass. Mutation: restore per-column
  charging → the pin fails.
- **Aggregate correctness survives the coarsened seal** (assert-the-old-
  behavior with disprove-capable fixtures): grouped sums/avgs/min/max whose
  values differ per column, both aggregate roots (filtered vs all — a
  filter that removes rows so the two roots differ), compared against the
  synchronous reference. The existing row-model grouping/aggregate suites
  must pass untouched.
- **Slice accounting:** a node-level test drives the transition to
  completion counting slices for a 50k grouping — bounded (≤ ~700 at
  256 units/slice… derive the exact bound from the constants, don't
  hand-wave it) vs today's 9,540.
- **Bench (the real gate):** S2 `group` and `group-expand` at target scale
  return `completed` with settle in the old ballpark; `group-updates` S5 at
  20k target p95 **unchanged at ~10ms** (the control — regression here
  fails the fix); 3k/750 settle back near their #285 numbers. Same-window
  control discipline; full output to files; isolated port.
- Changeset: `@pretable-internal/row-model` patch.

## Out of scope

The renderer-dom height-index replacement cost (filed separately); the jsdom
setDerivations stall; any change to budget/slice-cap constants or scheduling
primitives; a synchronous grouping fast path (decision 4); bench-harness
changes beyond what verification needs.
