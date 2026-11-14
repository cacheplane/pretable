# Browser Frame Cadence Implementation Plan

> Execute with an implementation agent and independent specification/quality review; user authorized the separate benchmark correction.

**Goal:** Correct the frame interval gate while preserving processing and correctness budgets.
**Architecture:** Independent bounded idle calibration, persisted evidence, dynamic frame-only threshold.
**Tech Stack:** Node.js, Playwright, node:test.

- [x] Verify clean main baseline: existing six gate tests pass.
- [ ] Add failing tests in `scripts/__tests__/bench-row-model-gate.test.mjs` for calibration, provenance, frame rejection and unchanged processing gates.
- [ ] Add `scripts/frame-cadence.mjs` for pure calibration validation and browser collection. Integrate with `scripts/bench-row-model-gate.mjs`; persist evidence before workloads and in report. Share explicit gate context with `playwright.config.ts`, use a bounded calibration timeout with browser cleanup and run gate browser checks with one worker. Reject nonfinite metric values.
- [ ] Run focused tests then all root infrastructure tests with local-server access; formatting and affected lint.
- [ ] Run real gate, inspect evidence and review changes independently; prepare separate PR with validation and limitations.
