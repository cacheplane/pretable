---
"@pretable/react": patch
---

Internal `react-surface` workspace package collapsed into `@pretable/react`.
All grid components are now exported directly from the public package:

- `<PretableSurface>` — the kitchen-sink grid component
- `<InspectionGrid>` — preset for inspection-style data
- `<LabeledGridSurface>` — preset with labeled cells

The opinionated `<Pretable>` preset stays. The `interactionState` prop on
`<PretableSurface>` is marked `@experimental` — bench-internal feature
exposed for advanced consumers, shape may change.
