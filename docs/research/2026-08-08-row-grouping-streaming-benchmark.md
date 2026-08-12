# Row-grouping target streaming performance gate

## Verdict

**FAIL.** The grouped target-scale run recorded
`scroll_frame_p95_ms = 26`, which exceeds the hard `<= 16 ms` assertion.
The grouped run satisfied the other three hard assertions: zero long tasks,
zero scroll-position drift, and zero visible-row-count drift. Per the gate
procedure, no implementation or documentation optimization was attempted.

The approved note filename uses `2026-08-08`; the actual benchmark artifacts
were recorded on `2026-08-09` as shown below.

## Environment and execution

- Repository commit before measurement:
  `8f564e8ac056cc6d3dbf164e588ba5b128e91cb6`
- Repository worktree: `pretable` (dedicated measurement worktree)
- Pre-run `git status --short`: clean (no output)
- Pre-run artifact inventory: no matching `status/*.summary.json`,
  `status/traces/*.trace.zip`, or `status/dashboard.json` files
- Host: macOS Darwin 25.5.0, arm64
- Node.js: `v22.14.0`
- pnpm: `10.12.1`
- Browser recorded by both summaries: Chromium `151.0.7922.34`
- Local inspection time: `2026-08-09 07:15:19 PDT (-0700)`

The commands were run once each, exactly as prescribed:

```sh
pnpm --filter @pretable/app-bench build

PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S5 PRETABLE_BENCH_SCALE=target PRETABLE_BENCH_SCRIPT=updates PRETABLE_BENCH_UPDATE_RATE_PER_SEC=1000 pnpm bench:e2e -- --project=chromium

PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S5 PRETABLE_BENCH_SCALE=target PRETABLE_BENCH_SCRIPT=updates-grouped PRETABLE_BENCH_UPDATE_RATE_PER_SEC=1000 pnpm bench:e2e -- --project=chromium
```

The build exited `0`. Each end-to-end command exited `0` with `3 passed`.

## Artifacts

The two newest summaries created by these runs were selected and validated
from their JSON contents rather than from their filenames.

### Flat control

- Summary:
  `status/chromium-pretable-default-s5-target-updates-2026-08-09t14-14-20-172z.summary.json`
- Trace:
  `status/traces/chromium-pretable-default-s5-target-updates-2026-08-09t14-14-20-172z.trace.zip`
- Artifact timestamp: `2026-08-09T14:14:20.172Z`
- Trace existence verified; size: `1,405,645` bytes

### Grouped

- Summary:
  `status/chromium-pretable-default-s5-target-updates-grouped-2026-08-09t14-14-44-992z.summary.json`
- Trace:
  `status/traces/chromium-pretable-default-s5-target-updates-grouped-2026-08-09t14-14-44-992z.trace.zip`
- Artifact timestamp: `2026-08-09T14:14:44.992Z`
- Trace existence verified; size: `1,397,481` bytes

The harness also generated `status/dashboard.json`, containing both completed
runs. Repository policy ignores `status/*.summary.json`,
`status/traces/*.zip`, and `status/dashboard.json`; these local raw artifacts
are therefore evidence for this note but are not committed.

## Comparability proof

The required comparison fields read from both summaries are identical except
for `scriptName`:

| Field            | Flat control                | Grouped                     |
| ---------------- | --------------------------- | --------------------------- |
| `adapterId`      | `pretable`                  | `pretable`                  |
| `scenarioId`     | `S5`                        | `S5`                        |
| `scale`          | `target`                    | `target`                    |
| `status`         | `completed`                 | `completed`                 |
| `rowCount`       | `20000`                     | `20000`                     |
| update-rate note | `update rate per sec: 1000` | `update rate per sec: 1000` |
| `scriptName`     | `updates`                   | `updates-grouped`           |

Additional recorded controls also match: profile `default`, Chromium
`151.0.7922.34`, seed `505`, viewport `1440 x 900`, device scale factor `1`,
`3000` updates, `50` updates per tick, `50 ms` batch interval, and `3000 ms`
duration. Each summary's `tracePath` resolves to the existing trace listed
above.

## Metrics

Values below are copied directly from the completed summary artifacts.

| Metric                        |       Flat `updates` | Grouped `updates-grouped` |
| ----------------------------- | -------------------: | ------------------------: |
| `scroll_frame_p95_ms`         | `10.099999999999909` |                      `26` |
| `long_tasks_count`            |                  `0` |                       `0` |
| `long_tasks_max_ms`           |                  `0` |                       `0` |
| `frame_max_ms`                |                 `24` |       `39.80000000000007` |
| `frame_budget_overruns_count` |                  `6` |                      `60` |
| `scroll_position_drift_px`    |                  `0` |                       `0` |
| `visible_row_count_drift`     |                  `0` |                       `0` |

### Grouped-minus-flat deltas and ratios

| Metric                |                                    Grouped - flat |                                  Grouped / flat |
| --------------------- | ------------------------------------------------: | ----------------------------------------------: |
| `scroll_frame_p95_ms` | `26 - 10.099999999999909 = 15.900000000000091 ms` | `26 / 10.099999999999909 = 2.5742574257425974x` |
| `long_tasks_count`    |                                       `0 - 0 = 0` |                `N/A` (flat denominator is zero) |
| `long_tasks_max_ms`   |                                    `0 - 0 = 0 ms` |                `N/A` (flat denominator is zero) |

No zero-denominator ratio was calculated, and no unlike runs were averaged.

## Grouped hard assertions

| Assertion                        | Observed | Result   |
| -------------------------------- | -------: | -------- |
| `scroll_frame_p95_ms <= 16`      |     `26` | **FAIL** |
| `long_tasks_count === 0`         |      `0` | PASS     |
| `scroll_position_drift_px === 0` |      `0` | PASS     |
| `visible_row_count_drift === 0`  |      `0` | PASS     |

Because one hard assertion failed, the overall gate verdict is **FAIL**.
