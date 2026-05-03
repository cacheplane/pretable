# @pretable/react

## 0.0.1

### Patch Changes

- Internal `react-surface` workspace package collapsed into `@pretable/react`. ([#66](https://github.com/cacheplane/pretable/pull/66))
  All grid components are now exported directly from the public package:
  - `<PretableSurface>` — the kitchen-sink grid component
  - `<InspectionGrid>` — preset for inspection-style data
  - `<LabeledGridSurface>` — preset with labeled cells

  The opinionated `<Pretable>` preset stays. The `interactionState` prop on
  `<PretableSurface>` is marked `@experimental` — bench-internal feature
  exposed for advanced consumers, shape may change.

- Initial release. Pretable's wrapped-text scroll wedge (4× faster than AG Grid on S2/hypothesis), streaming row-stability win (H15 satisfied — pretable max visible-row drift = 1 vs AG Grid's 28 across 100–25,000 patches/sec), and end-to-end React adapter with reusable JSON streaming primitives. ([#58](https://github.com/cacheplane/pretable/pull/58))

  See [the publishing pipeline design](https://github.com/cacheplane/pretable/blob/main/docs/superpowers/specs/2026-05-01-npm-publishing-pipeline-design.md) for context on the build, verification, and release flow.

- Updated dependencies [[`c1fb1d3`](https://github.com/cacheplane/pretable/commit/c1fb1d3266dad24153de60b92931147f14667d5a)]:
  - @pretable/core@0.0.1
