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
