# Browser cadence for the row-model performance gate

The approved separate fix replaces the impossible 16 ms animation-frame interval ceiling on a 60 Hz browser, retaining all 8 ms processing and correctness limits. The measured defect: an empty Chromium page has 16.7 ms p95, as do passing streaming runs. Main exhibits the same failure.

## Approach

Before measuring the four runs, launch the same installed default headless Chromium used by the gate. Measure 120 animation-frame intervals on a blank page after 30 warm-up frames. Record raw intervals, browser version, timestamp and viewport in a calibration artifact. Use the median interval plus 0.25 ms for timestamp quantization as the grouped frame-p95 budget. Never derive the budget from the application workload.

Reject missing, stale, mismatched, nonfinite or nonpositive calibration evidence. Require at least 120 samples, median between 4 ms and 1000/60 + 0.25 ms, and p95 minus p05 at most 0.5 ms. Thus a uniformly slow 30 Hz or noisy host cannot bless itself. Faster browser cadences receive proportionally tighter budgets; a doubled p95 interval fails (isolated dropped frames may fall outside p95). This is an explicit environment eligibility rule, not a measurement of display hardware refresh rate.

Run benchmarks serially as today. Retain raw application metrics unchanged. Validate calibration freshness and browser version, viewport, device scale and default profile against all four artifacts; retain the derived budget and calibration in the successful gate report, and save calibration before workloads so failed runs remain diagnosable. Keep commit/rebuild ceilings of 8 ms, patch checksums, responsive rebuild, group/row counts, zero long tasks and drift unchanged. Reject nonfinite measured metrics rather than accidentally accepting NaN.

A fixed 17 ms ceiling is simpler but ignores faster cadences. Using the workload's own median could normalize a regression away. Independent, bounded idle calibration is preferred.

## Validation

Tests cover 60/120 Hz, quantization, dropped frames, slow/noisy/invalid/short calibration, mismatched browser and stale evidence, preservation of processing/correctness checks and nonfinite metrics. Run the existing gate suite first, observe new tests fail, then implement. Run root infrastructure tests, formatting/lint for affected files, and the real four-scenario gate. Separate PR from totals; do not merge either PR automatically. If the host violates eligibility or processing limits, preserve evidence and report failure without relaxing limits.

Calibration has a bounded timeout and closes its owned browser in finally. The gate explicitly uses the shared calibration context (1440×900, device scale 1) for workload browsers as well as calibration, rather than relying on Playwright viewport defaults. Gate browser assertions run with one worker to avoid parallel fixture work contaminating timings. These settings apply only to the gate, not ordinary browser test runs.
