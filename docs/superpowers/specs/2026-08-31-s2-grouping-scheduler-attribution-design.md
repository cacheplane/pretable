# S2 grouping scheduler attribution — design

**Status:** approved direction; attribution-only pass.

## Context

The 2026-08-30 current-main remeasurement put S2 target `group` at a
475.3 ms median settle duration (n=7, sample SD 23.0 ms). That is inside the
2026-08-29 re-baselined band but remains 73.9 ms above the 2026-08-10
401.4 ms record. The separate trace named `CompiledQueryPlan.evaluate`
(39.472 ms self) and GC (38.481 ms self) in the settle window, but sampled CPU
alone cannot say how much of the full interval is active cooperative work,
scheduler wait, or the React/render tail after the row model commits.

This work follows two earlier #500 cycles:

- `2026-08-29-grouping-apply-cooperative-cost.md` coarsened seal units and
  amortized clock reads. That investigation found the scheduler was running,
  not starved.
- `2026-08-29-grouping-apply-insert-phase.md` removed redundant aggregate-tree
  work and returned grouping to the roughly 400–450 ms range.

Those results rule out treating a longer cooperative budget as a presumed
fix. The production `DEFAULT_BUDGET_MS = 0.25` remains load-bearing for grouped
streaming. This pass only instruments the current path and uses larger budgets
as controlled diagnostic perturbations.

`origin/main` has also advanced since the 2026-08-30 milestone, including the
canonical-calendar-date work in #480, which changed `compiled-query.ts`.
Therefore all new measurements are taken from the new branch base and do not
reuse the prior absolute band as a current-main result.

## Goal

Attribute the S2 target grouping apply interval across three mutually visible
components:

1. cooperative slice execution,
2. wait time from scheduling a continuation until it begins, and
3. time outside the measured row-model transition, split into the React handoff
   before `setQuery` begins and the render tail after the model completes.

Commit the diagnostic capability and an evidence milestone. Do not change a
production scheduling default, optimize the row model, or optimize React in
this pass.

## Chosen approach

Extend the existing private, opt-in row-model diagnostics used by the bench.
The real `PretableSurface` remains attached and the ordinary `group` trigger
still drives the ordinary `setQuery` path. The diagnostics controller arms the
next query transition immediately before the trigger, resets work counters,
and captures that transition through completion. The controller and bench use
the same `performance.now()` clock, so the runtime can partition the existing
trigger-to-settled interval into pre-model handoff, row-model transition, and
post-model surface time without creating a detached synthetic model.

Two alternatives are rejected:

- A one-off Node probe would use a different host scheduler and would not
  measure React contention or the post-model render tail.
- Trace-only analysis cannot reliably reconstruct continuation enqueue time,
  cancellation, rows charged, or exact slice boundaries from sampled stacks.

## Diagnostic model

### Scheduler wait accounting

`createCooperativeTransitionRuntime` will resolve one monotonic clock before it
wraps the scheduler. For every successfully scheduled callback in an
instrumented model, the wrapper records the elapsed time from successful
enqueue to callback entry. A callback canceled before entry records no wait.
A scheduler that throws records neither a callback nor a wait sample.

The new internal work field is `schedulerWaitDurations`. It sits beside the
existing `schedulerSliceDurations` and follows the same reset/snapshot rules.
Neither field is part of a public package API.

### Exact query-transition capture

The bench diagnostics controller gains an explicit arm/read lifecycle for one
query transition:

1. `armNextQueryTransition()` clears the previous capture and resets work.
2. The next proxied `model.setQuery(...)` records its start time and transition
   handle.
3. Fulfillment records completion time and status `completed`; rejection or
   cancellation records the corresponding non-completed status without
   inventing a duration-based success.
4. `readQueryTransition()` returns an immutable snapshot or `null` if no
   `setQuery` arrived.
5. The measurement disarms in `finally`, so an exception or partial bench run
   cannot accidentally capture a later query.

Mount-time and unrelated query transitions are excluded because capture is
explicitly armed only around the discrete interaction trigger.

### Reported fields

For an armed diagnostic `group` run, the artifact reports a nested query
transition summary containing:

- status and total row-model duration,
- pre-model handoff and post-model surface duration,
- rows evaluated and transition rows,
- slice count, total, p95, and maximum duration,
- scheduler-wait count, total, p95, and maximum duration, and
- non-slice/non-wait residual, clamped to zero to avoid negative clock-noise
  artifacts.

The controller exposes transition start and completion timestamps only to the
runtime. The artifact stores derived non-negative durations, not raw absolute
timestamps. The existing discrete-interaction metrics remain authoritative for
interaction latency, settle duration, blank gaps, long tasks, result rows,
focus, and selection; diagnostics do not redefine that timing contract.

No new fields appear unless `diagnostics=row-model` is explicitly enabled.
Existing update diagnostics retain their current shape, with the query summary
added as an optional sibling.

## Diagnostic transition budget

The bench query state accepts an optional positive finite
`transitionBudgetMs`, but passes it to the row model only when all of the
following hold:

- adapter is `pretable`,
- `diagnostics=row-model`, and
- the value is present and valid.

The direct Playwright spec maps
`PRETABLE_BENCH_TRANSITION_BUDGET_MS` to that query parameter. Ordinary bench
runs omit it and continue to use the production 0.25 ms default. Invalid,
zero, negative, or non-finite values fall back to omission rather than causing
a production-like benchmark page to crash.

The committed evidence uses 0.25 ms, 1 ms, and 2 ms. These are diagnostic
variables, not candidate defaults. No conclusion may recommend changing the
default without a separate design that re-runs the grouped-streaming control
required by the #500 decisions.

## Measurement protocol

1. Start from the branch base at current `origin/main`; record the exact SHA,
   browser, toolchain, machine, port, and load per block.
2. Use a fresh frozen install and rebuilt bench production bundle served on an
   isolated strict port.
3. Run seven rotated blocks. Each block contains one S2 target `sort` control
   and one S2 target `group` run at each diagnostic budget. Rotate the three
   budget orders across blocks so time/load drift is not assigned to one side.
4. Drive `apps/bench/tests/bench.spec.ts` directly. Do not use the benchmark
   matrix wrapper.
5. Require every grouping run to complete with 50,004 result rows, zero blank
   gaps, preserved focus/selection, and no newly introduced long task.
6. Keep one separate traced default-budget grouping run outside n=7 for CDP
   context. Do not mix traced and untraced samples.
7. Record raw samples, medians, sample standard deviations, component shares,
   and all control readings in a dated milestone JSON.

## Attribution rules

The milestone reports measurements first and names a dominant component only
when the evidence supports it:

- A component is dominant only if its median share is at least 50% and the
  same component leads in every completed default-budget run.
- Scheduler-wait attribution additionally requires a coherent perturbation:
  larger diagnostic budgets reduce wait count/total in the expected direction
  without moving the work into long tasks or changing result/continuity gates.
- Slice-work attribution requires slice total to dominate row-model duration;
  the CDP trace may then divide that active work among evaluate, aggregation,
  GC, or other frames.
- React-handoff or surface-tail attribution requires the corresponding
  pre-model or post-model portion to dominate the full interaction interval
  consistently.
- If no component satisfies those conditions, the verdict is `INCONCLUSIVE`
  with the measured split. The pass still succeeds because its deliverable is
  honest attribution evidence, not a forced optimization target.

No single traced sample can override the seven-run untraced distribution.

## Error and cancellation behavior

- A run that never observes the armed `setQuery` is invalid, not a zero-cost
  transition.
- A rejected or canceled transition retains its status and available counters
  but cannot satisfy the completed-run measurement gate.
- A callback canceled before execution does not add a wait sample.
- Diagnostics cleanup occurs even when the bench returns `partial` or throws.
- Timing values are finite and non-negative; invalid internal samples fail the
  diagnostic test rather than being serialized as trustworthy evidence.

## Testing

Implementation follows test-first development.

- Row-model unit tests use a deterministic clock and scheduler to prove wait
  timing, cancellation exclusion, reset behavior, and immutable snapshots.
- Bench diagnostics tests prove arm-next semantics, exact transition capture,
  completion/rejection states, and isolation from mount-time queries.
- Query-state tests prove valid budget parsing and diagnostic-only forwarding.
- Bench runtime/app tests prove discrete `group` results include the query
  summary only when diagnostics are enabled and always disarm after the run.
- The direct Playwright contract test checks the new fields in one real
  Chromium S2 grouping run.
- Full row-model, bench, React, format, typecheck, and repository tests run
  before integration.

## Files and ownership

- `packages/row-model/src/cooperative-transition.ts`: instrument scheduler wait
  boundaries using the runtime clock.
- `packages/row-model/src/diagnostics.ts`: store, reset, and expose wait samples.
- `packages/row-model/src/__tests__/`: deterministic scheduler instrumentation
  tests.
- `apps/bench/src/row-model-diagnostics.ts`: arm and summarize one real query
  transition.
- `apps/bench/src/bench-runtime.ts`: bind diagnostics to the discrete
  interaction lifecycle and serialize the summary.
- `apps/bench/src/bench-types.ts`: private artifact types.
- `apps/bench/src/query-state.ts` and `apps/bench/src/bench-app.tsx`: parse and
  forward the diagnostic budget.
- `apps/bench/src/pretable-adapter.tsx`: pass the optional budget into the
  instrumented row model only.
- `apps/bench/src/__tests__/` and `apps/bench/tests/bench.spec.ts`: unit and real
  browser contract coverage.
- `status/milestones/2026-08-31-s2-grouping-scheduler-attribution.json`: final
  raw samples, aggregates, controls, attribution verdict, and follow-up.

## Out of scope

- Changing `DEFAULT_BUDGET_MS`, the unit cap, scheduling primitive, grouping
  algorithm, compiled-query allocation strategy, or React scroll-reveal code.
- Claiming the 2026-08-30 absolute band still describes the newer branch base.
- Adding public diagnostics APIs or exposing the budget through Pretable's
  public model constructors.
- Implementing the optimization suggested by the evidence.

## Completion gate

This pass is complete only when the diagnostic fields are test-pinned, all 28
untraced measurements satisfy correctness/continuity gates, the control remains
fit, the milestone follows the attribution rules above, and the evidence lands
through the repository's normal review and green-CI path.
