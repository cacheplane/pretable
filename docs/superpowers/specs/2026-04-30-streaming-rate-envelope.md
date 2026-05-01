# Streaming Rate Envelope — Research Memo

## Goal

Quantify how each grid adapter degrades as streaming load climbs from the H13 baseline (1k patches/sec) through high-throughput regimes (25k patches/sec). The H13 phase 2 finding (PR #23) was that at 1k/sec Pretable matches AG Grid and TanStack on frame p95, only decisively beating MUI X Community. This memo asks: **at what load does each adapter actually break, and does Pretable's wedge widen at higher rates?**

A second axis: beyond-p95 metrics from PR #25 (frame max, budget overruns, layout shift, scroll/row drift) — does jank that p95 alone misses tell a different comparative story?

The findings change the strategic positioning. The honest conclusion is that the wedge is not raw speed.

## Methodology

- **Bench:** S5 streaming-updates scenario, hypothesis scale (3,000 rows, 30 cols).
- **Rates swept:** 100, 500, 1,000, 5,000, 10,000, 25,000 patches/sec.
- **Adapters:** Pretable, AG Grid Community, TanStack Virtual, MUI X Community.
- **Repeats:** 3 per (adapter × rate); median reported.
- **Run shape:** 50 ms tick, batch size = `rate / 20`. Tick stays fixed so RAF/timer behavior is consistent across rates; only per-batch work varies.
- **Browser:** Chromium 147 (Playwright).
- **Streaming pattern per adapter** (idiomatic, see PRs #15, #23):
  - Pretable: `stream-adapter` batcher → `applyTransaction` (RAF-batched).
  - AG Grid: `gridApi.applyTransaction({ update })` (native batched).
  - MUI X Community: `apiRef.updateRows([row])` looped per patch (Community caps `updateRows` to one row per call; batched is Pro/Premium-only).
  - TanStack Virtual: `setRows` merge — full reconciliation per batch.

Metrics captured (PR #25):

- `scroll_frame_p95_ms` — frame p95 during the 3 s window
- `frame_max_ms` — worst single frame
- `frame_budget_overruns_count` — frames over 16 ms
- `long_tasks_count` / `long_tasks_max_ms` / `long_tasks_ms` — blocking task profile
- `streaming_cls` — CLS during streaming (PerformanceObserver layout-shift)
- `scroll_position_drift_px` — viewport scrollTop before vs after
- `visible_row_count_drift` — rendered row count before vs after

> Sweep artifacts: 6 runsets at `status/runsets/2026-05-01t05-2*-z*.{,hypotheses.}json`, plus 66 individual summary files for the per-adapter, per-rate, per-repeat results.

## Results

### Frame p95 (ms) — median across 3 repeats

| Rate   | Pretable | AG Grid | TanStack |     MUI X |
| ------ | -------: | ------: | -------: | --------: |
| 100    |      9.8 |     9.9 |     10.0 |      10.1 |
| 500    |     10.0 |     9.8 |      9.8 |  **51.6** |
| 1,000  |      9.9 |     9.7 |      9.8 |   **100** |
| 5,000  |      9.9 |     9.8 |      9.7 |   **475** |
| 10,000 |      9.9 |     9.8 |     10.1 | timed out |
| 25,000 |     10.0 |    10.1 |      9.9 | timed out |

### Frame max (ms) — median across 3 repeats

| Rate   | Pretable | AG Grid | TanStack |     MUI X |
| ------ | -------: | ------: | -------: | --------: |
| 100    |     17.1 |    10.3 |     16.8 |      33.3 |
| 500    |     10.4 |    10.4 |     16.1 |      58.5 |
| 1,000  |     16.3 |    10.4 |     16.6 |       101 |
| 5,000  |     10.4 |    10.4 |     16.5 |       485 |
| 10,000 |     10.4 |    10.4 |     16.6 | timed out |
| 25,000 |     10.4 |    10.4 |     16.7 | timed out |

### Long task wall-clock (ms total) — median across 3 repeats

| Rate  | Pretable | AG Grid | TanStack |      MUI X |
| ----- | -------: | ------: | -------: | ---------: |
| 100   |        0 |       0 |        0 |          0 |
| 500   |        0 |       0 |        0 |        369 |
| 1,000 |        0 |       0 |        0 |  **5,341** |
| 5,000 |        0 |       0 |        0 | **26,233** |

> **MUI X at 1k/sec accumulates 5.3 seconds of blocking work in a 3-second test. At 5k/sec, 26 seconds.** The page is essentially unresponsive. At 10k+ the test times out before completing.

### Visible-row count drift — median across 3 repeats

| Rate   | Pretable | AG Grid | TanStack |     MUI X |
| ------ | -------: | ------: | -------: | --------: |
| 100    |        0 |  **28** |        0 |         2 |
| 500    |        0 |  **26** |        0 |         2 |
| 1,000  |        0 |  **22** |        0 |         2 |
| 5,000  |        0 |       4 |        1 |         2 |
| 10,000 |        0 |       0 |        1 | timed out |
| 25,000 |        0 |       0 |        1 | timed out |

### Streaming CLS — median across 3 repeats

| Rate   | Pretable | AG Grid | TanStack |     MUI X |
| ------ | -------: | ------: | -------: | --------: |
| 100    |   0.0007 |  0.0000 |   0.0007 |    0.0007 |
| 500    |   0.0007 |  0.0000 |   0.0007 |    0.0007 |
| 1,000  |   0.0007 |  0.0000 |   0.0007 |    0.0007 |
| 5,000  |   0.0007 |  0.0000 |   0.0007 |    0.0007 |
| 10,000 |   0.0007 |  0.0000 |   0.0007 | timed out |
| 25,000 |   0.0007 |  0.0000 |   0.0007 | timed out |

> AG Grid has zero CLS — its layout doesn't shift at all. The other three have a small steady CLS (~0.0007), well under Chrome's "good" threshold of 0.1.

### Scroll-position drift — median across 3 repeats

All adapters: **0 px** at every rate. Streaming doesn't cause unwanted scroll on any of them.

### Operating envelope (where adapters break)

**Highest rate at which median frame p95 ≤ 16 ms AND median long_tasks_count == 0:**

| Adapter         | Highest passing rate | First failing rate | What broke                   |
| --------------- | -------------------- | ------------------ | ---------------------------- |
| Pretable        | 25,000               | none observed      | —                            |
| AG Grid         | 25,000               | none observed      | —                            |
| TanStack        | 25,000               | none observed      | —                            |
| MUI X Community | 100                  | 500                | fp95 = 51.6 ms; 7 long tasks |

## Analysis

### The streaming wedge is not raw speed

Pretable, AG Grid, and TanStack are essentially tied on frame p95 across the entire 100–25,000 patches/sec range — all in a 9.7–10.1 ms band, well under the 16 ms 60 Hz budget. **Pretable does not have a numeric speed advantage** at any tested rate. The streaming-demo's 9 ms p95 claim (PR #16) is true but is matched by both AG Grid and TanStack on the same scenario.

### The decisive comparative wins are vs MUI X Community

MUI X Community starts breaking at **500 patches/sec** and is unusable at any meaningful rate. Its `updateRows` is capped to one row per call in Community (Pro/Premium-only batched), and the 50× overhead per batch accumulates blocking work faster than the frame loop can clear. By 5,000 patches/sec, the page is unresponsive 9× longer than the test runs.

This is a real win, but it's a **win against a hobbled tier**, not against the field.

### Beyond p95: small differences that add up

- **Frame max:** Pretable + AG Grid stay at ~10.4 ms (one frame budget). TanStack consistently has one frame at 16.1–16.7 ms — right at the edge. So Pretable + AG Grid are more **predictable** than TanStack at the worst-frame level.
- **Visible-row count drift:** AG Grid drifts by 22–28 rows at low rates, settling to 0 at high rates. Pretable + TanStack stay at ≤ 1 across all rates. AG Grid is doing something with row recycling at low rates that the others don't — visible behavior, not a frame budget issue, but a stability signal.
- **CLS:** AG Grid has zero. The other three have a small steady ~0.0007. Below human-perceptible thresholds for all four.

### What this changes about the comparative claim

The current website (`apps/website/app/components/ComparisonTable.tsx`) claims:

- Pretable: 9 ms p95
- AG Grid: 28 ms
- TanStack: 21 ms
- MUI X: 34 ms
- "vs ag-grid: 4.1×"

Bench data contradicts every adapter row except Pretable's. The numbers were placeholders flagged in code comments as "tuned to match what the existing bench measures, drop the row if it exaggerates." **They exaggerate.** The page must not lie.

The honest comparative statement is:

- Pretable, AG Grid, and TanStack are streaming-capable on Chromium at hypothesis scale; all stay under 16 ms p95 from 100 to 25,000 patches/sec.
- MUI X Community is not streaming-capable above ~100 patches/sec.
- AG Grid recycles rows visibly at low rates (22–28 row drift); Pretable does not.

## Strategic implications

### Should H13 change?

H13 currently asks Pretable to match the best comparator within 10% parity at 1,000 patches/sec, with at least one comparator failing absolutes. That's still **satisfied** — Pretable and AG Grid/TanStack tie within 10%, and MUI fails absolutes.

But the rate sweep shows the comparative parity holds across **every** tested rate, not just 1k. Pretable doesn't lose ground at higher rates. That broadens the claim's confidence without changing its shape.

**Proposed update:** keep H13 as-is, but add a runtime note that the parity holds across the full 100–25k operating envelope (the data already supports this — no code change needed).

### H14 proposal: streaming operating envelope

> **H14 — Streaming Operating Envelope.** Pretable handles streaming updates from 100 to 25,000 patches/sec on S5 hypothesis scale without exceeding the 60 Hz frame budget (frame p95 ≤ 16 ms, zero long tasks). At least one tested comparator (MUI X Community) fails this envelope at ≥ 500 patches/sec.

This is an honest claim. It's also true for AG Grid and TanStack — but the wedge sentence is "Pretable handles X without breaking" not "Pretable beats Y." It's a **defensive** claim, not an offensive one. That's fine. The streaming-demo + integrated stream-adapter is a viable streaming target.

### H15 proposal: row-stability under streaming

> **H15 — Row-stability under streaming.** Pretable's visible-row count remains constant during streaming updates (drift ≤ 1 across the operating envelope). AG Grid drifts by 22–28 rows at sub-5k rates.

This is a real differentiator vs AG Grid specifically. It's not a wedge against TanStack (which also stays at 0), but it's specific, measurable, and visible to users (less row-shuffling means less visual disturbance during streaming).

### Pitch surface implications

`apps/website/app/components/ComparisonTable.tsx` needs reframing or replacement. Two options:

1. **Update with real numbers.** The current placeholder format implies a 4× streaming wedge that doesn't exist. Replacing with the actual median p95s (9.9 / 9.7 / 9.8 / 100+) tells a clearer comparative story: streaming-capable vs not.
2. **Drop the comparison table for streaming, keep it for scroll.** The scroll wedge is real (H1 satisfied with comparative ratio); the streaming wedge is "we exist in the capable tier." Different framings deserve different surfaces.

`apps/website/app/components/FeatureGrid.tsx` line 18 currently says: _"Token-by-token rendering for OpenAI, Anthropic, or your own SSE — at 1k updates/sec sustained."_ The claim is true, but understates the envelope (we sustain 25k) and could be sharpened.

Recommended copy update: _"Token-by-token rendering for OpenAI, Anthropic, or your own SSE — sustained from 100 to 25,000 updates/sec without exceeding 60 fps."_

### What's actually unique about Pretable's streaming?

Drawing all the threads together, the Pretable-specific value props are:

1. **Purpose-built streaming integration.** `@cacheplane/json-stream` + `@pretable-internal/stream-adapter` is the only adapter with a documented streaming pipeline. AG Grid + TanStack require you to wire your own.
2. **Predictable frame budget.** `frame_max ≈ 10.4 ms` consistently, vs TanStack's 16-17 ms at the edge.
3. **Zero visible-row drift.** AG Grid's drift is real even if invisible to a casual viewer.
4. **No fall-apart mode.** MUI X Community shows what happens when an adapter isn't built for streaming. Pretable, AG Grid, and TanStack all avoid this; not a unique win, but a shared baseline.

The wedge sentence is something like: _"Pretable is the only purpose-built streaming grid that gives you JSON parsing, batched mutations, and stable rendering as one integrated package — no glue code, no edge-case jank, no DataGrid-Pro upsell."_

That's a **DX claim**, not a perf claim. The data backs it up indirectly.

## Followups

- Update `apps/website/app/components/ComparisonTable.tsx` with real numbers or drop the streaming-related rows (separate PR).
- Update `apps/website/app/components/FeatureGrid.tsx` line 18 sustained-rate claim from 1k to "100–25,000" if we want to broaden the envelope claim.
- Consider Pro/Premium tier comparators (MUI X Pro batched updateRows, AG Grid Enterprise) — they may put up a fight that Community cannot.
- Bursty load profile (real LLM chunk timing) — uniform 50 ms tick is artificial. The streaming-demo replay has the natural shape; we could load it into the bench.
- 5+ minute runs to surface memory leaks the 3 s tests cannot catch.
- Add H14 + H15 evaluators to `scripts/bench-matrix.mjs` (separate PR; data here is enough to support both).
- DX measurement (time-to-first-stream against each adapter) — qualitative claim that needs a method.

## Provenance

Sweep run on Chromium 147 (Playwright local, headless), Apple Silicon, 2026-04-30. All summary artifacts at `status/chromium-{adapter}-default-s5-hypothesis-updates-2026-05-01t05-*z.summary.json`. Aggregator script at `scripts/qa-shoot.mjs` family. To reproduce:

```sh
for rate in 100 500 1000 5000 10000 25000; do
  pnpm bench:matrix -- --project=chromium \
    --scenarios=S5 --scripts=updates \
    --adapters=pretable,ag-grid,tanstack,mui \
    --scale=hypothesis --repeats=3 \
    --update-rates=$rate
done
```

## 2026-05-01 revalidation

Re-ran the full sweep (`pretable + ag-grid + tanstack` — MUI excluded after it timed out the harness, exactly the documented degradation pattern). Three repeats per adapter × rate. Milestone runset at `status/milestones/2026-05-01-streaming-revalidated.hypotheses.json`.

### What holds

- "Streaming wedge is not raw speed" — confirmed. All three adapters in 8.9–9.1 ms p95 across 100–25 k pps.
- AG Grid's row-recycling drift (22–28 visible-row drift at sub-5 k rates, settles to 0 at high rates) — unchanged.
- MUI X Community is unusable at meaningful streaming rates — confirmed in the partial run before the harness timed out.

### What shifted

- **Frame max:** the memo claimed _"Pretable + AG Grid stay at ~10.4 ms (one frame budget) — more predictable than TanStack."_ On revalidation, **AG Grid is solo in the predictability tier (~9.3 ms max across all rates)** while Pretable now matches TanStack with occasional 16.6–16.7 ms spikes at most rates above 100 pps. Honest correction: Pretable does not currently share AG Grid's frame_max predictability advantage. The frame_p95 distribution is unchanged — these are single-frame outliers — so user-perceived smoothness is not affected, but the comparative claim must drop the "shared with AG Grid" framing.
- **Pretable visible-row drift** went from 0 (memo) → 1 max (revalidation) at the 5 k–10 k rate range. Still satisfies H15's `≤ 1` threshold and remains decisively better than AG Grid's 28-row max drift, but tightens the margin slightly.

### Hypothesis verdicts (2026-05-01)

- **H13 = directional** — Streaming updates meet all frame-budget thresholds, but every measured comparator also clears them.
- **H14 = directional** — Streaming operating envelope reaches 25 000 pps for pretable. The smallest comparator envelope is ag-grid at 25 000 pps; uniqueness claim is not supported by an order-of-magnitude gap.
- **H15 = satisfied** ✓ — Streaming row stability holds for pretable (max drift 1 row across the operating envelope). AG Grid drifts up to 28 rows during streaming — a real user-visible differentiator.

### Net wedge framing post-revalidation

The honest streaming pitch is now H15 + integration:

> **Pretable's row count stays stable across streaming rates.** AG Grid Community recycles rows during low-rate streams (drifting up to 28 visible rows). At equivalent frame budgets, Pretable's user-visible stability is the differentiator — not raw speed. Plus: `@cacheplane/json-stream` + `@pretable/stream-adapter` ship a purpose-built streaming pipeline; AG Grid and TanStack require you to wire your own.
