# Size-gate results (issue #488) — 2026-08-27

Status: sweep complete, limits chosen; certification section appended after
implementation. Design: `2026-08-27-size-gate-sync-paths-design.md`.

## Threshold sweep (browser, S2, pretable, medians of 3 unless noted)

Method: `scenarioScaleRowCounts.S2.hypothesis` patched locally per size
(never committed; restore verified via `git status`), one variable per
side, `bench:matrix --repeats=3`, port 4173 verified free, load light
(2.7–4.8 on 10 cores). `post_interaction_long_tasks_ms` is the block (one
commit per run); the longtask API floor means `0` = "< 50 ms".

| Rows                  | sort block (3 runs)        | sort settle | filter block (runs) | filter settle |
| --------------------- | -------------------------- | ----------- | ------------------- | ------------- |
| 5 000                 | 0 / 0 / 0                  | ~50         | —                   | —             |
| 10 000                | 0 ×11, **51** ×1 (12 runs) | ~75         | 0 ×12               | ~41           |
| 15 000                | **64 / 64 / 64**           | ~84         | 0 / 0 / 0           | ~49           |
| 20 000                | **83 / 83 / 83**           | ~100        | 0 / 0 / 0           | ~50–60        |
| 30 000                | **122 / 128 / 129**        | ~142        | 0 / 0 / **50**      | ~66           |
| 50 000 (prior rounds) | ~250 pre-arc record        | —           | **87–93**           | ~100–108      |

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

## Certification (gate implemented at `c2fc681d`; medians of 3)

Two rounds, S2, pretable + tanstack, scripts sort / filter-metadata /
filter-text / filter-keystrokes. Machine load 6–9.5 during the rounds
(heavier than the sweep) — TanStack same-run FILTER controls stayed in the
historical 48–58 ms band, so the filter cells are comparable; the TanStack
sort control ran elevated (settle 90–99, its own 68–76 ms sync-sort
blocks), so pretable's absolute giveback numbers below are if anything
overestimates.

### 3k (`--scale=hypothesis`, below both limits — sync path retained)

All pretable cells unchanged within a frame vs the #489 round:
filter-metadata settle ~33, filter-text ~33, keystrokes cold ~33 / warm
~34, sort ~43 (one-bin above the prior ~40 round, consistent with the
heavier load); `post_interaction_long_tasks_ms` 0 and blank frames 0
everywhere. The sync `"refilter"`/`"reorder"` lanes still run below the
limits.

### 50k (`--scale=target`, above both limits — cooperative)

| Script (pretable) | block (long-task ms) | latency + settle (total ms) | pre-gate sync reference                |
| ----------------- | -------------------- | --------------------------- | -------------------------------------- |
| sort              | **0 / 0 / 0**        | 49.3 / 49.8 / 50.4          | ~15 ms settle with a ~170–250 ms BLOCK |
| filter-metadata   | **0 / 0 / 0**        | 207 / 216 / 217             | ~104–108 ms with an ~87–93 ms block    |
| filter-text       | **0 / 0 / 0**        | 199 / 207 / 207             | ~104–117 ms with the same block        |
| filter-keystrokes | **0**                | cold ~250, warm p50 ~230    | cold 108 / warm 74                     |

- **The bar is MET**: zero observed long tasks on every pretable script at
  50k (the longtask floor is 50 ms; pre-gate the same cells read 87–93 ms
  for filter and the sort path's block was the pre-arc 247–279 ms class).
- **Zero blank frames** in all 24 pretable summaries at both scales — the
  cooperative path holds the current rows while it works, as designed.
- **The giveback, honestly**: filter total roughly doubles (~104 → ~210 ms)
  and the keystroke warm number gives back its sync-era win (74 → ~230 ms);
  sort's total goes ~15 → ~50 ms in exchange for deleting a quarter-second
  block. This is the trade the design accepted up front — the 50 ms
  single-block bar wins over settle at sizes above the limits.
- Curious-but-verified: cooperative SORT at 50k totals only ~50 ms — the
  sliced candidate rebuild is cheap for sort (verdicts reused, one ordered
  build), so the sort gate costs far less settle than the filter gate.

### Verdict

Gate certified: 3k unchanged, 50k blocking eliminated on every script,
zero blank frames, controls in band for the cells that carry comparative
weight. Remaining lever for the 50k filter settle giveback is #490
territory (cooperative-path speed), out of scope here.
