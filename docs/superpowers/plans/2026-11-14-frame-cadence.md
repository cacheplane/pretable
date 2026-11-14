# Browser Frame Cadence Implementation Plan

> Execute with an implementation agent and independent specification/quality review; user authorized the separate benchmark correction.

**Goal:** Correct the frame interval gate while preserving processing and correctness budgets.
**Architecture:** Independent bounded idle calibration, persisted evidence, dynamic frame-only threshold.
**Tech Stack:** Node.js, Playwright, node:test.

- [x] Verify clean main baseline: existing six gate tests pass.
- [x] Add failing tests in `scripts/__tests__/bench-row-model-gate.test.mjs` for calibration, provenance, frame rejection and unchanged processing gates.
- [x] Add `scripts/frame-cadence.mjs` for pure calibration validation and browser collection. Integrate with `scripts/bench-row-model-gate.mjs`; persist evidence before workloads and in report. Share explicit gate context with `playwright.config.ts`, use a bounded calibration timeout with browser cleanup and run gate browser checks with one worker. Reject nonfinite metric values.
- [x] Run focused tests then all root infrastructure tests with local-server access; formatting and affected lint.
- [x] Run real gate, inspect evidence and review changes independently; prepare separate PR with validation and limitations.

Validation so far: original 6 gate tests passed. New regression tests failed on the old hard ceiling, missing/invalid calibration, and NaN acceptance before implementation. Final 12 focused tests and 487 root infrastructure tests pass; scoped ESLint, Prettier and diff checks pass. Independent plan, specification-compliance and final quality reviews passed. Real four-scenario gate completed: 112 browser assertions passed, 4 expected skips. Calibration measured 16.7 ms median and derived a 16.95 ms frame budget; both grouped frame p95 values (16.7/16.8 ms) meet it. Overall performance gate correctly failed the unchanged 8 ms limits: local-max grouped commit p95 9.8 ms and rebuild max 10.6 ms while host load exceeded 150. This verifies calibration end to end, not overall performance acceptance. Logs: `/private/tmp/pretable-frame-cadence-gate.log`; raw calibration and scenario artifacts retained in ignored `status/`.

Correction is isolated from totals PR #622. A temporary integration branch combines the correction with totals for validation; neither PR branch is rewritten or merged. Independent final quality review approved with no findings.
