# Dense layout seam measured results (Amendment I) — 2026-08-24

Browser-bench A/B of the dense layout seam: layout-core dense generations
(slot-indexed refilter/reorder, bitset membership), row-model internal dense
snapshot reads, and renderer-dom dense-keyed layout sources.

- **Variant**: `a9cfac08` (HEAD of `blove/filter-fast-path` — the complete
  seam, Tasks 1–6).
- **Baseline**: `93ff4054` (the commit before seam Task 1; verified via
  `git log 93ff4054..HEAD -- packages/` that all six intervening `packages/`
  commits are seam work — one variable). Note the baseline INCLUDES M1+M2,
  so it should and does reproduce the 116.8/125.6ms record.
- **Design**: throwaway worktree at the baseline commit, fresh
  `pnpm install --frozen-lockfile` + `pnpm --filter @pretable/app-bench build`
  per side, one preview server on 4173 at a time (port verified free first),
  interleaved paired rounds (baseline 50k → variant 50k → baseline 3k →
  variant 3k), 3 repeats per cell, medians reported. No CDP tracing for the
  headline numbers; runner output redirected to files, exit codes checked.
- **Machine load**: heavy — 1-min load 24–46 across the four rounds (10-core
  Mac, 9GB of 10GB swap used, parallel sessions active). Interleaving plus
  the TanStack same-run controls are the fitness arbiter, as in the M1+M2
  run which saw the same regime (33–54).
- **Scale note**: the 3k tier is `--scale=hypothesis` (3,000 rows;
  `rowCount` confirmed in the summaries). `--scale=dev` is 750 rows and was
  not used.

## Results (medians of 3; settle quantizes to ~8.3ms frame steps)

### 50k rows (S2, `--scale=target`)

| Metric                            | Script          | Baseline | Variant (seam) | Δ         |
| --------------------------------- | --------------- | -------- | -------------- | --------- |
| settle_duration_ms                | filter-metadata | 125.3    | 108.3          | **−17.0** |
| settle_duration_ms                | filter-text     | 125.0    | 116.8          | **−8.2**  |
| post_interaction_long_tasks_ms    | filter-metadata | 111      | 89             | −22       |
| post_interaction_long_tasks_ms    | filter-text     | 103      | 93             | −10       |
| interaction_latency_ms            | filter-metadata | 16.3     | 17.4           | ~0        |
| interaction_latency_ms            | filter-text     | 16.6     | 15.7           | ~0        |
| post_interaction_blank_gap_frames | both            | 0        | 0              | 0         |
| TanStack control settle           | filter-metadata | 50.0     | 49.6           | −0.4      |
| TanStack control settle           | filter-text     | 50.8     | 50.0           | −0.8      |

Repeat spreads: baseline metadata [125.0, 125.3, 140.8]; variant metadata
[108.0, 108.3, 108.4] — unusually tight for this machine; variant text
[109.0, 116.8, 123.4].

### 3k rows (S2, `--scale=hypothesis`)

| Metric                            | Script          | Baseline    | Variant (seam) | Δ                |
| --------------------------------- | --------------- | ----------- | -------------- | ---------------- |
| settle_duration_ms                | filter-metadata | 33.5        | 33.4           | 0                |
| settle_duration_ms                | filter-text     | 41.6        | 33.7           | −7.9 (one frame) |
| post_interaction_long_tasks_ms    | both            | 0           | 0              | 0                |
| interaction_latency_ms            | metadata / text | 16.8 / 17.0 | 16.6 / 24.0*   | ~0 / +1 frame*   |
| post_interaction_blank_gap_frames | both            | 0           | 0              | 0                |
| TanStack control settle           | filter-metadata | 33.0        | 25.0           | −8.0**           |
| TanStack control settle           | filter-text     | 25.7        | 23.9           | −1.8             |

\* Variant 3k text latency repeats straddled a frame boundary under load;
settle (the governing metric) improved a frame. Not a regression signal.

\*\* Baseline metadata repeats [24.3, 33.0, 34.0] vs variant [24.7, 25.0,
34.1] — same one-frame band, medians landed on different sides of a frame
boundary. Same pattern (in the other direction) appeared in the M1+M2 run;
within normal spread, not a regime change.

## Deltas vs M1+M2 and the cumulative arc

- Today's baseline side (= the M1+M2 state) read 125.3/125.0 @50k and
  33.5/41.6 @3k — the M1+M2 record (116.8/125.6 @50k; 41.7/33.5 @3k) within
  one frame under today's load, which is why the paired baseline, not the
  record, is the comparison basis.
- Seam vs M1+M2 record: 116.8 → 108.3 (metadata, −8.5) and 125.6 → 116.8
  (text, −8.8). Vs paired baseline: **−17.0 / −8.2ms**, long-tasks −22/−10.
- Cumulative arc (pre-M1: 166.6/158.4): 50k filter settle is now
  **108.3/116.8 — −58.3/−41.6ms total, a ~1.4–1.5× speedup** on the branch.

## Bar verdicts

- **Untraced 50k settle ≤ ~95ms: MISSED.** 108.3 (metadata) / 116.8 (text).
  The improvement is real and the controls prove the regime held, but the
  seam bought ~1–2 frames, not the ~3 the bar assumed. Long-tasks dropped
  proportionally (111→89, 103→93), consistent with the win being genuine
  main-thread work removed, not measurement drift.
- **Layout share ≲ 10% of the traced window: MET** (~7.4%, table below).
  The two verdicts together say the amendment's attribution was right —
  layout's walk is no longer the problem — but the pre-seam trace charged
  more of the window to layout than the layout walk alone actually cost;
  part of that share was the row-model rebuild it overlapped with.
- **3k no regression: MET** (0 / −7.9ms).
- **TanStack controls in band: MET** (all four cells within one frame across
  sides; 50k controls 49.6–50.8 both sides).
- **Zero blank frames: MET** (`post_interaction_blank_gap_frames` 0 in all
  12 pretable summaries, both sides, both scales).
- `refilterFallbackCount === 0` is pinned by the react e2e suite (seam
  Task 6, commit `a9cfac08`), mutation-hardened — not re-measured here.

## Traced share re-attribution (variant, 50k filter-metadata)

One traced run AFTER the headlines (`PLAYWRIGHT_PERF_TRACE=1`, repeats=1),
`analyze-cdp.mjs --window=interaction` with the build's sourcemap. Traced
absolutes skew ~2× — shares only. Window 74.2ms, 74.2ms sampled.

| Subsystem (self time)                                                   | Share    |
| ----------------------------------------------------------------------- | -------- |
| layout-core refilter walk (`refilter` + `#refilterDense` + window prep) | **7.4%** |
| row-model filter-rebuild walk (`filter-rebuild.js`)                     | 17.4%    |
| compiled-query verdict evaluation (`compiled-query.js`)                 | 17.5%    |
| persistent HAMT (`persistent-map.js`)                                   | 9.2%     |
| order-statistic tree                                                    | 3.6%     |
| slot-vector                                                             | 2.9%     |
| visible-index                                                           | 2.8%     |
| change-journal                                                          | 0.5%     |
| react render/commit + DOM (react-dom, measure, style/attr, grapheme)    | ~23%     |
| (program) + GC                                                          | 7.7%     |

The layout walk (dense lane) is 7.4% — under the 10% bar. The window is now
dominated by the row-model rebuild + verdict evaluation (~35% combined) and
the render/commit side (~23%). The HAMT share that remains (9.2%) belongs to
row-model's own persistent structures, not layout reads.

## Fitness statement

- TanStack same-run controls agree across sides within one frame on all four
  cells; the 3k metadata −8ms is a frame-boundary artifact with overlapping
  repeat ranges. The regime did not move between sides.
- Load was heavy (1-min 24–46 on 10 cores, swap nearly full) throughout; the
  interleaved paired design plus in-band controls make the deltas
  trustworthy. Individual absolutes carry load noise (baseline metadata's
  140.8 first repeat), excluded by the medians.

## Conclusion

The dense layout seam delivered a real but smaller-than-estimated win: 50k
filter settle dropped from ~125ms to **108.3 (metadata) / 116.8 (text)** —
−17.0/−8.2ms with long-tasks down proportionally and zero blank frames —
missing the ~95ms bar, while the traced layout share fell to ~7.4%, meeting
the ≤10% attribution bar. Layout is no longer where the time goes: the
remaining ~58–67ms gap to the TanStack bar (~50ms settle in these same
runs) now sits in the row-model rebuild and verdict evaluation (~35% of the
window) plus render/commit (~23%) — which is exactly the **columnar verdict
cache, the next milestone**.
