# Columnar verdict cache measured results (Amendment J) — 2026-08-24

Browser-bench A/B of the columnar verdict cache: compiled per-plan filter
predicates, the mutable columnar filter-value store with commit-side clears,
and the filter rebuild consuming per-record columnar verdict scans.

- **Variant**: `683ecd93` (HEAD of `blove/filter-fast-path` — plan Tasks 1–4:
  `d64fba85`, `ec871e6f`, `30c43223`, `683ecd93`).
- **Baseline**: `eab3b893` (the commit before Task 1; verified via
  `git log eab3b893..HEAD -- packages/` that exactly those four columnar
  commits are the only `packages/` changes — one variable).
- **Design**: throwaway worktree at the baseline commit, fresh install +
  `pnpm --filter @pretable/app-bench build` per side, one preview server on
  4173 at a time (port verified free first), interleaved paired rounds, 3
  repeats per cell, medians reported. Because round A's metadata cells
  disagreed with its text cells, a second full 50k paired round was run
  (rounds A and B below; 6 repeats per 50k cell pooled). No CDP tracing for
  headline numbers; runner output redirected to files, exit codes checked.
- **Machine load**: heavy — 1-min load 35–110 across rounds (10-core Mac,
  8.7GB of 10GB swap used, parallel sessions active). Same regime as the
  M1+M2 (33–54) and seam (24–46) runs, with a worse spike (110) during the
  variant 3k round; interleaving plus TanStack same-run controls are the
  fitness arbiter as before.
- **Scale note**: 3k tier is `--scale=hypothesis` (3,000 rows; `rowCount`
  confirmed in the summaries).

## Gates

- `pnpm build`: PASS. `pnpm api`: PASS with **zero `.api.md` drift** —
  everything this milestone touched is row-model-internal.
- Full root `pnpm test`: all 11 packages + both apps green. One react test
  (`external-filter-authority.test.tsx` — an aria header-state assertion)
  failed once inside the full run at 1-min load 35, then passed 3/3 in
  isolation and a full `@pretable/react` re-run (1247/1247) — load flake,
  not a regression. The `apps/*` phase (skipped by pnpm after that first
  failure) was run separately: green.
- `pnpm lint`: PASS. `prettier --check .`: fails on 4 docs files
  (`dense-handle-core-design`, `dense-handle-m0-results`,
  `dense-handle-m1-m2-results`, `dense-layout-seam-results`) that fail
  identically at the baseline commit — pre-existing on the branch, not
  introduced here, left untouched per the commit-only-this-file rule.

## Results (settle quantizes to ~8.3ms frame steps)

### 50k rows (S2, `--scale=target`) — two paired rounds, medians of 3

| Metric                            | Script          | Base A      | Var A      | Base B      | Var B       | Pooled base (6) | Pooled var (6) |
| --------------------------------- | --------------- | ----------- | ---------- | ----------- | ----------- | --------------- | -------------- |
| settle_duration_ms                | filter-metadata | 107.4       | 108.9      | 98.9        | 107.1       | 107.3           | 108.6          |
| settle_duration_ms                | filter-text     | 108.3       | 100.0      | 108.4       | 108.3       | 108.4           | 104.3          |
| post_interaction_long_tasks_ms    | metadata / text | 88 / 91     | 88 / 87    | 87 / 93     | 87 / 89     | —               | —              |
| interaction_latency_ms            | metadata / text | 17.1 / 16.7 | 8.4 / 16.7 | 16.9 / 17.7 | 17.1 / 16.4 | —               | —              |
| post_interaction_blank_gap_frames | both            | 0           | 0          | 0           | 0           | 0               | 0              |
| TanStack control settle           | filter-metadata | 49.7        | 57.4       | 58.0        | 57.6        | —               | —              |
| TanStack control settle           | filter-text     | 57.4        | 50.1       | 51.7        | 57.1        | —               | —              |

Repeat spreads tell the story: every 50k pretable cell on BOTH sides bounces
between the 12-frame (~99–100ms) and 13-frame (~107–109ms) quantization
bins — baseline metadata [98.3, 98.9, 107.1, 107.4, 107.4, 107.5], variant
metadata [99.5, 107.1, 108.3, 108.9, 109.1, 116.7], variant text [99.0,
100.0, 100.2, 108.3, 109.6, 109.7]. Round A's apparent text win (−8.3) did
not reproduce in round B (0.0); round B's apparent metadata loss (+8.2) is
the same bin-bounce in the other direction (round A: +1.5). The variant
metadata 8.4ms latency in round A likewise read 17.1 in round B.

### 3k rows (S2, `--scale=hypothesis`) — one paired round

| Metric                            | Script          | Baseline    | Variant     | Δ       |
| --------------------------------- | --------------- | ----------- | ----------- | ------- |
| settle_duration_ms                | filter-metadata | 33.3        | 33.3        | 0       |
| settle_duration_ms                | filter-text     | 34.3        | 33.9        | ~0      |
| post_interaction_long_tasks_ms    | both            | 0           | 0           | 0       |
| post_interaction_blank_gap_frames | both            | 0           | 0           | 0       |
| TanStack control settle           | metadata / text | 24.9 / 24.3 | 25.7 / 25.1 | in band |

## Deltas vs the seam and the cumulative arc

- Vs the seam record (108.3 metadata / 116.8 text): pooled variant medians
  are 108.6 / 104.3 — metadata unchanged, text ~one bin better than the
  RECORD but indistinguishable from today's PAIRED baseline (108.4), which
  itself sat a bin under the old text record. The paired comparison is the
  honest one: **no reproducible settle change in either script.**
- Cumulative arc: pre-M1 166.6/158.4 → M1+M2 116.8/125.6 → seam
  108.3/116.8 → columnar **~108/~104–108 (flat)**. The branch's total gain
  remains the ~1.4–1.5× of the first two milestones; this milestone added
  none that the settle metric can resolve.

## Bar verdicts

- **50k settle improves in BOTH scripts vs 108.3/116.8: MISSED.** Both
  scripts are flat within one frame across two interleaved paired rounds;
  the only sub-frame signal (pooled text −4.1ms) is half a quantization bin
  and did not survive the confirmation round as a per-round delta.
- **Traced verdict share ≲3%: MISSED — ~17% (vs 17.5% pre-columnar,
  essentially unchanged).** Breakdown in the table below.
- **3k no regression: MET** (0 / −0.4ms).
- **Zero blank frames: MET** (0 in all 18 pretable summaries, both sides,
  both scales).
- **TanStack controls in band: MET** — all 50k control cells straddle the
  same 48–58ms one-frame band on both sides and both rounds (49.7–58.0);
  3k controls 24.3–25.7. The regime held; the flat result is trustworthy.

## Traced share (variant, 50k filter-metadata, `--window=interaction`)

One traced run after the headlines (`PLAYWRIGHT_PERF_TRACE=1`, repeats=1),
`analyze-cdp.mjs --window=interaction` with the build's sourcemap. Window
68.0ms (seam trace: 74.2ms). Traced absolutes skew ~2× — shares only.
Groups sum to ~81%; the rest is the sub-0.3% frame tail.

| Subsystem (self time)                                                                                                                                                                                              | Share     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| **Verdict evaluation, columnar path** — `bulkFilterVerdictScan` 7.1% + exported wrapper 0.9% + `textCell` normalization 4.4% + compiled `contains` predicate 2.1% + `columnarGetCell` 2.2% + `assertRealSlot` 0.4% | **17.1%** |
| filter-rebuild walk body (`rebuildRootForFilterOnlyChange` 9.6% + walk callback 9.6%)                                                                                                                              | 19.2%     |
| persistent HAMT (`persistent-map.js`)                                                                                                                                                                              | 12.2%     |
| layout-core dense refilter (`refilter` + `#refilterDense`)                                                                                                                                                         | 6.8%      |
| order-statistic tree                                                                                                                                                                                               | 3.2%      |
| slot-vector + visible-index + plan-equality misc                                                                                                                                                                   | 2.5%      |
| react render/commit + DOM (react pkg, react-dom, `getBoundingClientRect`, `measureText`, `querySelectorAll`, adapter)                                                                                              | ~15.5%    |
| (program) + GC                                                                                                                                                                                                     | 4.2%      |

Why the share did not move: the cache eliminated the accessor read and the
per-row values-Map get, but those were never the dominant term. What
remains is (a) **per-row dispatch** — the walk calls `bulkFilterVerdictScan`
once per record through the exported wrapper, paying wrapper + `instanceof`
guard + per-cell `assertRealSlot` for every one of 50k rows (~8% scan
machinery, plus its share of the 9.6% walk-callback self time), and (b)
**per-cell value normalization** — the compiled text predicate still runs
`String(value).toLocaleLowerCase()` on every raw cell (`textCell` 4.4% +
predicate 2.1%), because the columnar store caches RAW values, not
normalized ones. The compile step hoisted operand normalization; cell
normalization stayed in the loop.

## Fitness statement

- TanStack same-run controls agree across sides within one frame on every
  cell in every round; the pretable repeat spreads overlap across sides.
  The interleaved paired design plus in-band controls make the "flat"
  conclusion trustworthy despite 1-min load 35–110.
- The round-B baseline run's matrix process exited 1: a side spec
  (`row-height-error-applicability`, a 60s `waitForFunction`) timed out
  under load AFTER the last cell's bench completed — all 12 summaries in
  that round are `status: completed` and are used here.
- Settle cannot resolve sub-frame changes in this regime: both sides
  bin-bounce between 12 and 13 frames. The traced share is the sharper
  instrument, and it independently confirms the flat settle result.

## Conclusion

The columnar verdict cache **did not deliver**: 50k filter settle is flat
(~108ms metadata / ~104–108ms text vs the seam's 108.3/116.8) and the
traced verdict share is ~17%, unchanged from 17.5% pre-columnar — because
the cost it removed (accessor reads, Map gets) was not where the time was.
The gap to TanStack (~50–58ms same-run controls) remains ~50ms, and the
window now names its levers precisely: make the scan actually bulk (hoist
the per-row wrapper/guard dispatch into one loop inside the plan — the
plan-of-record's original one-call-before-the-walk shape; ~8% scan
machinery + part of the 19.2% walk body), cache normalized values for text
filters instead of raw ones (~6.5%), and only then the structural terms —
the HAMT (12.2%), the rebuild walk body itself, and render/commit (~15.5%).
The mechanism (store, freshness clears, compiled predicates) is sound,
tested, and API-silent; its payoff is gated on removing the per-row and
per-cell overheads that this measurement surfaced.

## Fix cycle (one-call sweep + normalized cells) — 2026-08-25

Both levers the trace named were implemented and re-measured.

### What changed

- **One-call bulk sweep.** `bulkFilterVerdictScan` (one exported-wrapper +
  `instanceof` + per-cell `assertRealSlot` call per record) is GONE, folded
  into `CompiledQueryPlan.bulkFilterVerdictSweep`: ONE call per rebuild that
  owns the `forEachSlotEntry` walk. Plan resolution, the `instanceof` guard,
  filter columns, predicate arrays, normalizers, and each filter's column
  vector are hoisted out of the row loop; cells are read through the new
  assert-free `columnarGetCellTrusted` (walk slots are nonnegative integers
  by construction — trust-by-construction documented at the sweep, and a
  wrong-slot fill mutation is caught by the equivalence oracle).
  `filter-rebuild.ts` passes a `(record, passes)` callback that keeps its
  flip-set/bitset logic — still one closure call per row, but zero wrapper /
  guard / assert / Map-get work per row.
- **Normalized cells.** The columnar store now caches the SCAN
  representation, normalized once at fill (`normalizeCellForScan`): text
  lowercased (`textCell`), dates as `toDayMs` day-ms, enum `String`-coerced,
  boolean `booleanValue`-coerced, numbers raw. Predicates gained normalized
  twins (`compileFilterPredicateForNormalized`) whose closures skip the
  per-row normalization; the operator sweep gained twin tests pinned to the
  same literal expectations. The per-row `filterVerdict`/`evaluate` paths
  keep raw values and raw predicates, unchanged.
- **isEmpty/garbage-date resolution.** Emptiness is a RAW-value property the
  normalized forms cannot preserve (raw `NaN` in a text column is empty but
  normalizes to non-empty `"nan"`; garbage and empty dates both normalize to
  `NaN`, and `isEmpty` must stay FALSE on garbage while comparisons fail on
  both). Rather than a two-field cell, `isEmpty`/`isNotEmpty` filters stay
  on live accessor reads through the raw predicate inside the sweep —
  documented at `normalizeCellForScan`, pinned by an explicit
  garbage-vs-empty date test (garbage fails `on`/`after` AND `isEmpty`;
  empty fails comparisons AND passes `isEmpty`).

Verification: 654 row-model tests green (616 + 38 added), full root
`pnpm test` green (exit 0, no flakes this run). Mutations (performed,
caught, restored): wrong-slot fill → 30 failures including the randomized
equivalence oracle; fill stores RAW value → both new warm-cell membership
pins fail; normalizer drops the lowercase → 8 failures across the
normalized twins and warm pins.

### Paired 50k re-measure (round A; medians of 3; load 10.9–14.1)

Same protocol: baseline throwaway worktree at `891d6cb4` (fresh install),
bench rebuilt per side, port 4173 verified free, one matrix-managed server
at a time (build-identity asserted), TanStack same-run controls. Machine
load 10.9–14.1 — far lighter than the original run's 35–110.

| Metric                 | Script          | Base `891d6cb4` | Fixed       | Δ       |
| ---------------------- | --------------- | --------------- | ----------- | ------- |
| settle_duration_ms     | filter-metadata | 99.9            | 100.8       | +0.9    |
| settle_duration_ms     | filter-text     | 99.6            | 100.0       | +0.4    |
| interaction_latency_ms | metadata / text | 16.6 / 16.3     | 16.6 / 16.6 | ~0      |
| long tasks / blank     | both            | 84–87 / 0       | 82–88 / 0   | ~0      |
| TanStack control       | metadata / text | 58.0 / 50.7     | 57.5 / 50.8 | in band |

Both scripts' cells agree (both flat, sub-frame Δ), so the
disagreement-triggered second round was not needed. Note both SIDES sit in
the 12-frame bin (~99–101ms) that the heavier original session only
bounced into — the lighter machine, not the fix.

### Traced share (fixed variant, filter-metadata, `--window=interaction`, 65.3ms window)

Verdict machinery now: sweep row closure 1.9% + `forEachSlotEntry` 1.9% +
`columnarGetCellTrusted` 1.7% + fill-side `columnarSetCell` 2.0% +
`#readColumnValue` 1.1% + `normalizeCellForScan` 0.5% + `textCell` 3.3% +
normalized `contains` predicate 3.0% = **~15.4%** (was ~17.1%). The
rebuild walk body is 8.9% + 11.5% callback = 20.4% (was 19.2% — the
callback now absorbs frames the old per-row scan call held). HAMT,
tree, layout-core, react terms unchanged in kind.

### Why it is STILL flat — the structural finding

The bench scripts apply ONE filter commit against a COLD store: the
measured interaction IS the fill. So the fill-time normalization
(`textCell` 3.3%, `columnarSetCell` 2.0%, accessor reads 1.1%) runs inside
the same window it used to run in — it moved from "per predicate call" to
"per fill", but with exactly one commit those are the same count. The
dispatch overhead the sweep removed (wrapper + instanceof + per-cell
asserts, ~1.3–1.5% traced) was real but half a frame. The warm-path win —
repeat filter commits verdicting over already-normalized cells with ZERO
fills, which the new tests prove — is structurally invisible to a
single-commit script and to the settle metric.

### Verdict

**STILL FLAT.** Settle: +0.9ms metadata / +0.4ms text (sub-frame, controls
in band). Traced verdict share: ~15.4% vs ~17.1% — a real but small
reduction, and the remainder is cold-fill work the script's shape makes
unavoidable plus the walk/merge/HAMT structure the fix never targeted. Per
the arc's standard this does not clear the bar; the revert decision goes
back to the controller.

## Decision: reverted

The store, scan, and normalization — `30c43223` (columnar store +
commit-side clears), `683ecd93` (scan + filter-rebuild consumption +
setDerivations reset), `73f1ae24` (one-call sweep + normalized cells) —
are reverted in `revert(row-model): drop the columnar verdict store —
measured flat twice`. Kept: `ec871e6f` (compiled per-plan filter
predicates, operator sweep and malformed-operand pins included) and
`d64fba85` (`CompiledRowInput.slot` threading). Rationale: flat twice —
a warm-path saving of ~3ms inside a ~100ms settle does not buy the
machinery, and git history preserves it if the calculus changes. The
lesson worth carrying: the bench scripts apply one filter commit against
a COLD store, so the measured interaction IS the fill — any
cache-the-fill design is structurally invisible to a single-commit
script, and that must be checked before building the cache.
