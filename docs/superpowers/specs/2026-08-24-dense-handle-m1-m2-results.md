# M1+M2 measured results — slots + membership bitsets (2026-08-24)

Browser-bench A/B of the M1+M2 arc: filter-only rebuild walks `recordsBySlot`
and diffs membership bitsets, deleting two 50k string-HAMT lookup passes.

- **Variant**: `e529d9d0` (HEAD of `blove/filter-fast-path`).
- **Baseline**: `8f2b63b2` (last commit before M1; verified via
  `git log 8f2b63b2..HEAD -- packages/` that every intervening `packages/`
  commit is M1+M2 row-model work — one variable).
- **Design**: throwaway worktree at the baseline commit, fresh
  `pnpm install --frozen-lockfile` + bench build per side, interleaved paired
  rounds (baseline 50k → variant 50k → baseline 3k → variant 3k), 3 repeats
  per cell, medians reported. No CDP perf tracing (`PLAYWRIGHT_PERF_TRACE`
  unset) — these are headline-grade absolutes.
- **Machine load**: heavy and falling — 1-min load 38.1 at start, 33–54
  during the four rounds (10-core Mac, parallel sessions active). Runs were
  interleaved specifically so both sides saw the same regime; the TanStack
  same-run controls below are the fitness arbiter.
- **Scale note**: the 3k tier is `--scale=hypothesis` (3,000 rows). The plan's
  `--scale=dev` is the 750-row tier — confirmed against existing summary
  `rowCount` fields before running.

## Results (medians of 3; settle quantizes to ~8.3ms frame steps)

### 50k rows (S2, `--scale=target`)

| Metric                         | Script          | Baseline | Variant (M1+M2) | Δ         |
| ------------------------------ | --------------- | -------- | --------------- | --------- |
| settle_duration_ms             | filter-metadata | 166.6    | 116.8           | **−49.8** |
| settle_duration_ms             | filter-text     | 158.4    | 125.6           | **−32.8** |
| post_interaction_long_tasks_ms | filter-metadata | 148      | 105             | −43       |
| post_interaction_long_tasks_ms | filter-text     | 141      | 109             | −32       |
| interaction_latency_ms         | filter-metadata | 16.7     | 16.6            | ~0        |
| interaction_latency_ms         | filter-text     | 16.6     | 16.6            | ~0        |
| TanStack control settle        | filter-metadata | 58.3     | 58.4            | +0.1      |
| TanStack control settle        | filter-text     | 50.1     | 50.5            | +0.4      |

Repeat spreads: baseline metadata [158.3, 166.6, 174.3]; variant metadata
[116.1, 116.8, 124.5]; variant filter-text had one 474.1ms outlier (load
spike — median unaffected), the other two repeats were 124.9/125.6.

### 3k rows (S2, `--scale=hypothesis`)

| Metric                         | Script          | Baseline    | Variant (M1+M2) | Δ                |
| ------------------------------ | --------------- | ----------- | --------------- | ---------------- |
| settle_duration_ms             | filter-metadata | 41.7        | 41.7            | 0                |
| settle_duration_ms             | filter-text     | 41.8        | 33.5            | −8.3 (one frame) |
| post_interaction_long_tasks_ms | both            | 0           | 0               | 0                |
| interaction_latency_ms         | both            | 16.6 / 15.8 | 16.6 / 16.5     | ~0               |
| TanStack control settle        | filter-metadata | 25.0        | 25.0            | 0                |
| TanStack control settle        | filter-text     | 32.6        | 25.0            | −7.6*            |

\* Baseline text repeats were [24.4, 32.6, 34.1] vs variant [24.8, 25.0,
32.9] — same one-frame band, median landed on different sides of a frame
boundary. Within normal spread, not a regime change.

## Deltas vs the branch's pre-M1 record

Pre-M1 (recorded earlier on this branch): 50k settle 158.3 (metadata) /
157.5 (text), long-tasks 141; 3k settle 34.5 / 33.6.

- The baseline side reproduced those numbers under today's load (158.4–166.6
  @50k; 41.7–41.8 @3k, one frame above the recorded 33.6–34.5 — consistent
  with load, and why the paired baseline, not the old record, is the
  comparison basis).
- 50k improvement vs paired baseline: **−49.8ms (metadata) / −32.8ms
  (text)** settle, −43/−32ms long-tasks. Against the trace-attribution
  estimate of ~−30ms: **met on filter-text, exceeded on filter-metadata**.
- 3k: at most one frame of improvement — expected; the deleted HAMT passes
  are small in absolute terms at 3k and settle is frame-quantized.

## Fitness statement

- TanStack same-run controls agree across sides within one frame on all four
  cells (50k: 58.3→58.4, 50.1→50.5; 3k: 25.0→25.0, 32.6→25.0 with
  overlapping repeat ranges). The regime did not move between sides.
- Load was high (1-min 33–54 on 10 cores) throughout; the interleaved paired
  design plus in-band controls make the deltas trustworthy, but individual
  absolutes carry load noise (see the 474ms variant outlier and the baseline
  3k 75.5ms outlier — both single repeats, both excluded by the median).

## Conclusion

M1+M2 delivered: 50k filter settle dropped from ~158–167ms to ~117–126ms
(−33 to −50ms), meeting the ~−30ms estimate, with interaction latency
unchanged and long-tasks down proportionally. Pretable still trails the
TanStack bar (~50–58ms settle in the same runs, vs the ~67ms historical
bar): roughly **60–75ms of remaining settle gap is M3's problem** — the
filter-commit path after M1+M2 is no longer dominated by row-record lookups,
so the next attribution pass starts from a fresh trace, not this doc.
