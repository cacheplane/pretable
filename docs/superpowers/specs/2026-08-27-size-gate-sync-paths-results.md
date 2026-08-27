# Size-gate results (issue #488) — 2026-08-27

Status: sweep complete, limits chosen; certification section appended after
implementation. Design: `2026-08-27-size-gate-sync-paths-design.md`.

## Threshold sweep (browser, S2, pretable, medians of 3 unless noted)

Method: `scenarioScaleRowCounts.S2.hypothesis` patched locally per size
(never committed; restore verified via `git status`), one variable per
side, `bench:matrix --repeats=3`, port 4173 verified free, load light
(2.7–4.8 on 10 cores). `post_interaction_long_tasks_ms` is the block (one
commit per run); the longtask API floor means `0` = "< 50 ms".

| Rows | sort block (3 runs) | sort settle | filter block (runs) | filter settle |
| --- | --- | --- | --- | --- |
| 5 000 | 0 / 0 / 0 | ~50 | — | — |
| 10 000 | 0 ×11, **51** ×1 (12 runs) | ~75 | 0 ×12 | ~41 |
| 15 000 | **64 / 64 / 64** | ~84 | 0 / 0 / 0 | ~49 |
| 20 000 | **83 / 83 / 83** | ~100 | 0 / 0 / 0 | ~50–60 |
| 30 000 | **122 / 128 / 129** | ~142 | 0 / 0 / **50** | ~66 |
| 50 000 (prior rounds) | ~250 pre-arc record | — | **87–93** | ~100–108 |

Node engine-only curve (tsx microbench, medians of 5; wall time of the
synchronous `setQuery` — an UNDERESTIMATE of the felt block, which also
carries layout + React commit in the same task):

- filter: 0.7 @3k · 2.2 @10k · 4.9 @20k · 10.8 @30k · 19.2 @50k (~linear)
- sort: 4.1 @3k · 22.0 @10k · 53.3 @20k · 85.4 @30k · 170.3 @50k (~n·log n)

Shape agreement: browser blocks ≈ engine + a ~30–40 ms same-task
downstream (layout/react) term wherever both are observable — the harness
is responding to the variable, not lying.

## Chosen defaults (selection rule from the design doc)

- **Sort**: local crossover of the 50 ms bar sits at ~10k (one 51 ms
  outlier at 10k; consistent 64 ms at 15k). Halved for 2× slower-machine
  headroom → **`SORT_FAST_PATH_ROW_LIMIT_DEFAULT = 5_000`** (swept:
  0/0/0 observed, engine 9 ms).
- **Filter**: local crossover ~30k (one 50 ms at 30k; 87–93 ms at 50k).
  Halved → **`FILTER_FAST_PATH_ROW_LIMIT_DEFAULT = 15_000`** (swept:
  0/0/0 observed, engine ~3.5 ms).

Both limits are measured sweep points with consistently unobserved blocks,
honoring the conservatism rule (any doubt → cooperative). The known cost:
sizes between the limit and the local crossover (sort 5–10k, filter
15–30k) give up sync settle on THIS machine without a local block win —
that is the price of the 2× headroom for slower machines, chosen
deliberately.

## Certification (appended after implementation)

_Pending._
