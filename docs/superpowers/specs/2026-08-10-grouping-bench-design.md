# Grouping benchmark scripts

Date: 2026-08-10
Status: approved

## Problem

`ROADMAP.md`'s **Now** section requires "finish grouping adoption with committed
benchmark evidence." There is no such evidence: `grep -c group` across
`packages/bench-runner/src/index.ts` and `apps/bench/src/` returns zero. Row
grouping shipped across six PRs and has never been measured.

Two decisions are blocked on that. Whether grouping belongs in the streaming
homepage hero, and whether the engine's full-recompute-per-change design costs
anything a user would notice.

There is also a **specific, known redundancy** nobody has costed.
`setGroupExpanded` replaces `groupExpansionOverrides`, which is a derived-cache
key, so `derivedIsFresh` goes false and the engine re-runs the whole pipeline:
`sortRows` over every filtered row, `buildTree` (a `makeGroupId` string build per
row per level), `accumulate`, then `flatten`. But the overrides are consumed
**only** by `flatten` — `buildTree` and `accumulate` never receive them, so the
tree and the aggregates are provably invariant under expansion. Every twisty
click pays for both anyway. Whether that matters at scale is unmeasured.

## Scope

In: three bench scripts, their plan builders, and the harness plumbing each
needs. Committed baseline numbers.

Out: acting on the results. If a script exposes a regression, that is a separate
piece of work with its own spec — this one establishes measurement, and a fix
rushed onto a measurement branch is how a benchmark stops being trustworthy.

## The three scripts

| Script          | What it does                                             | Mirrors                                             |
| --------------- | -------------------------------------------------------- | --------------------------------------------------- |
| `group`         | applies a grouping to an ungrouped grid                  | `sort` / `filter-metadata` (the interaction family) |
| `group-expand`  | toggles one group's expansion on an already-grouped grid | `sort`, but with a much smaller expected delta      |
| `group-updates` | streams row updates with grouping and aggregates live    | `updates`                                           |

`group` is the baseline that makes the other two readable. `group-updates` is
what the hero decision rests on. `group-expand` is aimed at the redundancy above
and is the one most likely to find something.

## Design

### Where the plumbing goes

Adding a script touches six places. Enumerate them from the code rather than
this list, which is from an earlier audit and may have drifted:

1. `BenchScriptName` union — `packages/bench-runner/src/index.ts`
2. `benchScriptNames` runtime array — same file, duplicated from the union
3. `validateSupportedP0aRequest` — `supportedScripts` plus per-script
   scenario/adapter constraints
4. the parser allowlist in `apps/bench/src/query-state.ts`
5. the `executeRun` dispatch in `apps/bench/src/bench-app.tsx`
6. a plan builder in `apps/bench/src/interaction-plan.ts`

`assertRequiredMetrics` also needs to know what each new script must emit.

### Scenario and column choice

`packages/scenario-data` already generates low-cardinality columns: `owners` and
`statuses`, four distinct values each, at every `columnIndex % 4 === 1` and
`=== 2`. For the interaction scenarios (S2/S7, `wrapped_columns: 3`) the first
non-wrapped instances are `col_5` (owner) and `col_6` (status) — and `col_6` is
already the `filter-metadata` probe.

Cardinality is exactly 4 regardless of row count, which is the right property
for a grouping benchmark: group count stays fixed while rows scale, so the
measurement isolates per-row cost from per-group cost. **Verify this holds at
the scales being run** rather than assuming it.

Grouping must be applied the same way the plan applies sort and filters — see
how `bench-app.tsx` flips React state and lets the adapter re-render. Do not
reach into the engine directly; the point is to measure what a consumer's code
path costs.

### Adapter parity

The bench compares against ag-grid. **Row grouping is ag-grid Enterprise**,
which this repo cannot use. So these scripts are pretable-only, and
`validateSupportedP0aRequest` must reject them for other adapters with a clear
reason — following how the selection scripts are already gated to pretable.

Say this explicitly in the results: these are absolute numbers and a regression
tripwire, not a competitive claim. A benchmark that looks comparative but is not
is worse than no benchmark.

### What `group-expand` must isolate

For the redundancy to be visible, the grid must be grouped _before_ the measured
interaction, with only the expansion toggle inside the measurement window. If
applying the grouping lands inside the window the recompute cost swamps the
signal and the script measures nothing useful.

Expect `group-expand` to cost about the same as `group`. That is the finding —
it means the pipeline re-ran. If it comes out much cheaper, the redundancy
analysis above is wrong and I want to know that.

## Committed evidence

Run each script at the standard scales and commit the summaries the harness
already emits, following whatever convention `status/` uses today. The roadmap
asks for _committed_ evidence, so a number in a PR comment does not discharge it.

Record in the PR body: the scale, the adapter, the metric values, and — for
`group-expand` — the comparison against `group` that the redundancy claim rests
on.

## Testing

- Existing scripts must produce unchanged results. A harness change that shifts
  `sort` or `updates` numbers is a bug in the change, not a finding.
- `validateSupportedP0aRequest` gains cases: each new script accepted for
  pretable on a supported scenario, rejected for ag-grid with a reason.
- Local runs on this Mac are load-sensitive — several worktrees run
  concurrently. Re-run anything anomalous before reporting it, and say which
  numbers were re-run.
