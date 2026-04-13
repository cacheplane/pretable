# Wedge-First Prototype Design

Date: 2026-04-12

## Summary

Pretable should build its first real prototype as a schema-agnostic, DOM-first grid engine with one opinionated demo surface: a read-heavy log / inspection table in the playground. The prototype must prove the wedge on wrapped text and variable-height scrolling stability while beginning to look like a usable product. Performance and stability remain the primary constraints; visible product behaviors are included only insofar as they are built on top of those constraints rather than ahead of them.

The first serious cut should support pinned columns, row selection, keyboard navigation, local sorting, and limited filtering, while being architected so remote / server-driven sorting, filtering, and streaming can slot in later. Off-screen autosize and live streaming updates are intentionally deferred as proving targets for this phase.

## Current Starting Point

This document describes the target prototype design, not the current implementation state. The current repo is strongest in benchmark infrastructure and reporting discipline. The product-side packages are still mostly placeholder packages and a simple React-based DOM prototype. Implementation planning should therefore assume that `text-core`, `layout-core`, `grid-core`, and `renderer-dom` still need substantive first versions.

## Goals

- Prove the wedge on wrapped text and variable-height scrolling stability.
- Use the same engine path in both the benchmark app and the playground demo.
- Build the beginning of a usable inspection-table product, not just a benchmark harness.
- Keep the core architecture compatible with future remote / streaming data flows.

## Non-Goals

- Proving off-screen autosize in the first prototype cut.
- Shipping live streaming updates in the first serious cut.
- Rich editing, advanced query language, or feature-parity with broad enterprise grids.
- Implementing a hybrid/canvas renderer before the DOM-first thesis is tested directly.

## Prototype Scope

The first prototype should remain schema-agnostic. A log / inspection-table shape is the first demo dataset and the first benchmark-facing use case, but the core model should not encode a canonical log schema.

The first serious cut includes:

- wrapped text
- variable row heights
- pinned left columns
- row selection
- keyboard navigation and focus
- local sorting
- limited per-column filtering

The first serious cut excludes:

- off-screen autosize as a productized feature
- streaming updates as a user-visible capability
- server execution of sort/filter
- rich editing
- advanced query model

## Architecture

### `text-core`

`text-core` owns prepared text and repeated layout estimation. It should be estimate-first, with a strict DOM-truth harness outside the hot path. The hot path must not depend on exact DOM measurement for every width change. The important contract is that the engine can prepare text once, estimate wrapped layout cheaply many times, and quantify its own error against browser truth.

### `layout-core`

`layout-core` owns row-height planning, prefix sums, viewport range extraction, pinned-zone coordinate math, and scroll offset to row index mapping. It should know nothing about React and should not depend on DOM ownership. This layer is where variable-height virtualization discipline lives.

### `grid-core`

`grid-core` is the canonical state machine. It owns:

- stable row identity
- column definitions
- viewport state
- sort state
- limited filter state
- selection state
- keyboard focus state
- remote-compatible data-window interfaces

Interaction state must live here rather than in React so that sorting, filtering, navigation, and future streaming updates share one consistent model.

### `renderer-dom`

`renderer-dom` is the first real renderer. It consumes planned viewport rows/cells from `grid-core` and renders pooled row and cell shells. It may use targeted correction hooks such as `ResizeObserver`, but the steady-state scroll path should stay estimate-first and arithmetic-heavy. DOM reads should be corrective, not foundational.

### `adapter-react`

The React adapter should stay thin. It subscribes to the core store, binds DOM events back into core actions, and renders the DOM renderer output. React should not own canonical interaction state or row-model semantics.

### Renderer Strategy

The architecture should keep an explicit hybrid-renderer escape hatch, but DOM-first remains the first implementation target. `text-core`, `layout-core`, and `grid-core` must therefore stay renderer-agnostic enough that a future hybrid renderer can consume the same planned output if DOM-first underperforms.

## First Prototype Behavior

The playground should present a believable inspection-table experience, but every included behavior must reinforce the wedge rather than distract from it.

Required behavior:

- stable scrolling on large wrapped-text datasets
- variable row heights with incremental correction
- pinned metadata columns
- row selection
- keyboard navigation
- local sorting
- limited per-column filtering

Required engine behavior:

- row identity survives sort/filter changes
- row-height estimation and correction do not visibly destabilize backward scrolling
- pinned columns are part of planned layout, not ad hoc overlay hacks
- benchmark and playground use the same core path for the target scenario

## Data and Update Model

The first prototype may implement local in-memory behavior first, but the core architecture should be remote-compatible from day one. It should tolerate future partial windows, delayed updates, server-owned sort/filter state, and streaming delivery without having to replace the state model.

Streaming updates are deferred as an implemented feature in the first serious cut, but the product direction remains toward AI-capable streaming data rendering. Early prototype positioning must distinguish clearly between:

- architected for streaming
- benchmark-proven streaming behavior

## Planning-Critical Interfaces

The implementation plan should treat the following interfaces as first-class contracts.

### Row and column model

- Rows are schema-agnostic records with stable row identity supplied by the caller.
- Columns are accessor-driven definitions rather than schema-bound field assumptions.
- Sort and filter logic should operate on column definitions plus row identity, not on a hard-coded log schema.

### Data provider split

- `grid-core` should separate:
  - source data access
  - derived row model state
  - viewport state
- Local in-memory behavior can be the first provider implementation.
- Remote-compatible contracts should already allow:
  - incomplete windows
  - delayed responses
  - server-owned sort/filter execution
  - future streamed row mutations

### Interaction and snapshot model

- Selection and focus live in core and are keyed by stable row identity.
- Renderers and adapters should consume derived snapshots rather than re-derive interaction state themselves.
- The React adapter should subscribe to a core-owned external store rather than own the canonical state transitions.

## Validation Model

Validation should run on two tracks.

### Prototype Track

- the playground demo must feel stable and legible on the inspection-table dataset
- interaction state must remain coherent through sort/filter/navigation
- non-obvious bugs should be reduced to tiny repro pages before broad fixes land

### Benchmark Track

- `S2` remains the primary proving scenario
- benchmark and prototype must share the same core and renderer path
- claims must remain tied to runsets, traces, `metricSummary`, policy notes, and confidence wording
- single-sample wins should say `current sample`
- repeated evidence should say `current repeated-run medians`
- outlier-driven failures should say `worst-case repeats`

Success for this phase is not feature completeness. Success is:

- a believable playground demo
- a shared engine path between product and benchmark
- reproducible evidence that the wedge is working, or clear evidence that it is not

## Recommended Build Order

1. Build `text-core` as an estimate-first engine plus DOM-truth harness.
2. Build `layout-core` for variable-height row modeling and viewport math.
3. Build `grid-core` as the canonical state machine for viewport, sort/filter, selection, and focus.
4. Build `renderer-dom` as the first pooled renderer.
5. Keep `@pretable/react` thin over the core store.
6. Wire the same engine into the playground inspection-table demo and the benchmark app.
7. Reassess whether the wedge is holding before expanding into autosize or streaming.

## Risks

- Estimate-first text layout may miss browser wrapping edge cases often enough to erode the value proposition.
- Variable-height correction may still destabilize backward scrolling even when median metrics look good.
- A nicer playground may outpace the benchmarked engine path and create false confidence.
- DOM-first may hit a hard limit once pinned zones and richer interactions accumulate, in which case the architecture must support a renderer pivot.

## Decision Rule

Continue toward MVP only if the prototype can show both:

- a convincing inspection-table demo built on the real engine path
- reproducible benchmark wins or defensible directional evidence on wrapped text and variable-height stability

If the wedge does not hold there, pivot the renderer strategy quickly or stop broadening product scope.
