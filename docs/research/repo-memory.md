# Repo Memory

## 2026-04-12

### Prototype direction

- The immediate goal is two-track:
  - prove the technical wedge in benchmarks
  - start building the initial demo in the playground
- The intended path after the first prototype is to iterate toward engine feature completeness for an MVP.

### Product priorities

- Performance and stability are the primary constraints.
- Visible product behavior such as pinned columns, selection, and keyboarding should be built on top of those principles rather than pursued ahead of them.

### Recommendation adopted for the first prototype cut

- Defer off-screen autosize as a primary proving target for the first prototype cut.
- Focus first on:
  - wrapped text
  - variable-height scrolling stability
- Reason:
  - this is the clearest wedge
  - it is the best foundation for later product behavior
  - it reduces the risk of proving too many hypotheses at once before the core engine exists

### First demo shape

- Start with a read-heavy log / inspection table first.
- Long term, expand that into a more generic grid sandbox after the wedge is proven.

### First serious interaction cut

- Include these behaviors in the first serious cut:
  - scrolling
  - pinned columns
  - row selection
  - keyboard navigation
  - local sorting
  - local filtering

### Core architecture direction

- Design the core from day one so remote / server-driven sorting, filtering, and streaming can slot in cleanly.
- The first serious cut may still implement local in-memory behavior first, but the core boundaries should not assume local-only data flow.

### Interaction-state boundary

- Selection and keyboard focus should live inside the core state machine from the start.
- The React adapter should not own the canonical interaction model.

### Renderer strategy

- Start DOM-first.
- Keep an explicit hybrid-renderer escape hatch in the architecture, but do not make hybrid rendering the first implementation target.

### Text-engine strategy

- Start with an estimate-first text engine plus a strict DOM-truth harness.
- Do not require exact DOM-parity measurement in the hot path up front.

### Filtering scope

- Start with limited filtering in the first serious cut.
- Prefer column-level text / value filters before introducing a more expressive query model in the core.

### Streaming updates

- Defer streaming updates as an implemented feature in the first serious cut.
- Still design the architecture so streaming can slot in cleanly later.
- Product positioning should preserve the long-term direction toward AI-capable streaming data rendering, but early prototype claims should stay qualified and honest.

### Data model

- Keep the first prototype schema-agnostic.
- Use a log / inspection-table shape as the first demo dataset and benchmark-facing use case, but do not bake a canonical log schema into the core model.

## 2026-04-13

### Shared inspection prototype path

- The playground now runs on shared deterministic inspection datasets with `tiny`, `dev`, and `stress` scales.
- The playground defaults to `dev` so local manual inspection happens on a materially sized dataset instead of a smoke-only sample.
- Inspection-grid-specific renderer composition now lives under `@pretable/react/internal` instead of inside the playground surface.

### Internal telemetry direction

- Shared React telemetry is now computed once in `usePretableModel` and relayed through the internal surface chain.
- Current telemetry fields are:
  - `selectedRowId`
  - `renderedRowCount`
  - `visibleRowCount`
  - `totalHeight`
  - `visibleRowRange`
- The playground diagnostics block should consume this telemetry directly instead of scraping the grid DOM.

### Benchmark alignment

- The Pretable benchmark path now records the same internal telemetry as summary notes without changing the existing benchmark DOM contract.
- The benchmark guardrail remains:
  - keep telemetry off-DOM
  - preserve `data-pretable-scroll-viewport`
  - preserve `data-pretable-scroll-content`
  - preserve row/cell markers and viewport policy

### Current honest status

- A focused Chromium Pretable `S2/dev/scroll` run on 2026-04-14 wrote telemetry-bearing notes into [status/chromium-pretable-default-s2-dev-scroll-2026-04-14t04-13-15-339z.summary.json](/Users/blove/repos/pretable/status/chromium-pretable-default-s2-dev-scroll-2026-04-14t04-13-15-339z.summary.json).
- That artifact is useful because it proves the tighter benchmark/playground telemetry link is real.
- A repeated Chromium matrix run on 2026-04-14 wrote [status/runsets/2026-04-14t04-14-56-534z.hypotheses.json](/Users/blove/repos/pretable/status/runsets/2026-04-14t04-14-56-534z.hypotheses.json).
- That runset is the more important checkpoint and it is also not flattering:
  - `H1`: failing
  - `H3`: failing
  - Pretable median `scroll_frame_p95_ms: 41.7`
  - Pretable median `blank_gap_frames: 1`
  - Grid Alpha median `scroll_frame_p95_ms: 33.1`
  - GridBeta median `scroll_frame_p95_ms: 24.6`
- Conclusion: the prototype path is more honest and more inspectable, but the current Pretable scroll result is measurably behind the current comparators on the repeated `S2/dev/scroll` slice.
