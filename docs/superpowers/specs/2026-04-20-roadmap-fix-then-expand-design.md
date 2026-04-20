# Roadmap: Fix-Then-Expand

## Goal

Prioritized backlog of the next five projects for pretable, sequenced to prove interactions before expanding scope.

## Current State

Pretable's scroll performance wedge is proven: H1 (comparative scroll vs AG Grid, TanStack, MUI) and H3 (scroll stability — blank gaps, anchor shift) are satisfied on repeated Chromium S2/hypothesis runs.

Interaction proof is partially proven: H8 (wrapped-text filter) passes at hypothesis scale, but H6 (sort) and H7 (metadata filter) fail at hypothesis scale (~60-67ms against a 64ms threshold) while passing at dev scale. A sort variance spec already exists identifying the problem as worst-case repeat latency spikes in the shared Pretable sort path.

Off-screen autosize, streaming updates, broader browser coverage, and public API stabilization are intentionally deferred.

## Roadmap

### Project 1: Sort Variance Elimination

**Problem:** H6 fails at hypothesis scale because sort interaction latency spikes to ~65-75ms against a 64ms threshold. The outlier is a real shared-path problem, not a threshold problem to redefine away.

**Approach:** Profile the shared Pretable sort path end-to-end (grid state mutation, render snapshot recalculation, measurement churn, React rerender behavior). Fix the dominant source of repeat spread in shared code. Verify on repeated Chromium S2/dev/sort runs.

**Existing spec:** `docs/superpowers/specs/2026-04-15-sort-variance-and-interaction-promotion-design.md`

**Exit criteria:**

- Repeated Chromium S2/dev/sort no longer violates H6 on worst-case repeat latency.
- Fix lands in shared code (not benchmark-only).
- H7 and H8 do not regress on S2/dev.

**Dependency:** None — starting point.

### Project 2: Interaction Promotion to Hypothesis Scale

**Problem:** The interaction family (sort, filter-metadata, filter-text) is proven at dev scale but not at the larger 3,000-row hypothesis scale. Promotion should happen as a bundle — all three together — to represent one coherent proof surface.

**Approach:** Run the full interaction family at hypothesis scale. If any hypothesis fails, profile and fix before proceeding (same discipline as Project 1).

**Verification:** `pnpm bench:matrix -- --project=chromium --adapters=pretable --scenarios=S2 --scripts=sort,filter-metadata,filter-text --scale=hypothesis --repeats=3`

**Exit criteria:**

- H6, H7, H8 all satisfied on repeated Chromium S2/hypothesis.
- The interaction family is promoted alongside the already-proven scroll family.

**Dependency:** Project 1 complete.

### Project 3: Scroll Regression Guard

**Problem:** Sort variance fixes touch the same shared render/state path that scroll depends on. The original scroll wedge (H1/H3) must be re-validated to ensure no silent regression.

**Approach:** Re-run the full comparative scroll proof with all four comparator adapters at hypothesis scale.

**Verification:** `pnpm bench:matrix -- --project=chromium --adapters=pretable,ag-grid,tanstack,mui --scenarios=S2 --scripts=scroll --scale=hypothesis --repeats=3`

**Exit criteria:**

- H1 and H3 satisfied on repeated Chromium S2/hypothesis with the post-sort-fix codebase.
- README and repo memory updated to reflect the new honest checkpoint.

**Dependency:** Project 2 complete.

### Project 4: Pinned-Column Inspection Scenario

**Problem:** S2 exercises wrapped text with variable-height rows and one pinned column. Real inspection tables typically pin an ID or status column alongside denser data. The proof surface should cover this layout before claiming broad inspection-table fitness.

**Approach:** Add or select a scenario that exercises pinned-column overhead alongside wrapped text and variable-height rows. Run scroll + interaction proof at dev scale first, then hypothesis.

**Exit criteria:**

- Scroll and interaction hypotheses pass on the pinned-column scenario at hypothesis scale on Chromium.
- The proof surface covers both the pure wrapped-text case and the pinned-column inspection case.

**Dependency:** Project 3 complete.

### Project 5: Public API Stabilization

**Problem:** The internal composition surfaces (`InspectionGrid`, `LabeledGridSurface`, `PretableSurface`) are exported under `@pretable/react/internal` — used by the playground and bench but not stable for external consumers. The controlled `interactionState` + `onSortChange` pattern is proven but undocumented.

**Approach:**

- Audit internal surfaces: which props are stable, which are in flux.
- Promote the controlled interaction pattern as the canonical public API.
- Write API documentation for the public surface.
- Add API contract tests that lock in public type signatures.

This project does not add new engine capabilities. Off-screen autosize and streaming updates remain deferred.

**Exit criteria:**

- `@pretable/react` has a documented, tested public API surface covering the inspection-table use case with controlled interaction state.
- Internal surfaces that remain unstable stay under `/internal`.

**Dependency:** Project 3 complete at minimum. Can run in parallel with Project 4.

## What This Roadmap Does Not Cover

- Adding a second browser (Firefox) — comes after Chromium interaction proof is stable.
- Off-screen autosize — architectural intent exists but is not prioritized until the proof surface and public API are stable.
- Streaming updates — same as autosize.
- New interaction types beyond sort, filter-metadata, filter-text — the current three should be stable before expanding.
- Threshold relaxation — if hypotheses fail, the fix is in the code, not the thresholds.

## Sequencing Rationale

The order is deliberately conservative: prove before expanding. Each project either validates an existing claim or extends it incrementally. No project assumes the previous one succeeded — each has its own verification step. This matches pretable's ethos of honest-before-ambitious: the scroll wedge was proven before interaction was attempted, and interaction should be proven before the API is stabilized for external consumers.

Projects 4 and 5 have a weaker dependency on each other and can be parallelized if desired, but both depend on the core proof (Projects 1-3) being clean.
