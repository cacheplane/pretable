# Benchmark Surface Austerity Design

## Goal

Reduce Pretable's benchmark-path render cost without changing the shared renderer contract, benchmark DOM markers, or variable-height correction behavior.

## Problem

Pretable's shared renderer path is now correct, but the current benchmark adapter still renders presentation-oriented cell chrome that the faster comparator adapters do not pay for. The benchmark surface currently includes repeated per-cell labels, nested wrappers, and richer header content that are useful in the playground but not necessary for measuring the structural renderer path.

This makes the current `H1` result harder to interpret. We know Pretable is still slower, but we do not yet know how much of that gap is shared renderer cost versus benchmark-only presentation cost.

## Recommended Approach

Keep `PretableSurface` as the renderer under test and make the benchmark adapter materially more austere than the playground.

The benchmark Pretable path should:

- continue using `PretableSurface`
- keep sticky pinned columns
- keep row measurement and height correction
- keep the existing `data-pretable-*` benchmark markers
- keep telemetry and viewport policy behavior
- render simpler header and body content with less nested DOM and style chrome

The playground should remain on the richer labeled/inspection surfaces.

## Scope

In scope:

- benchmark-specific header/body render simplification in `apps/bench/src/pretable-adapter.tsx`
- tests that prove the Pretable benchmark adapter still exposes the same benchmark contract while rendering a more austere body
- full repo verification and repeated benchmark rerun after the change

Out of scope:

- changing the core grid model
- changing the shared renderer structure
- changing benchmark metrics or hypothesis logic
- changing the playground presentation
- broad pinned-column or pooling refactors

## Success Criteria

- Pretable benchmark path still uses the shared renderer
- benchmark DOM contract remains unchanged
- full verification passes
- repeated `S2/dev/scroll` matrix produces a new runset we can compare against the current `50.2ms` Pretable median

## Risks

- accidentally optimizing away benchmark-relevant structure instead of just presentation
- making the benchmark path too custom and weakening overlap with the real product renderer
- improving `H1` only by reducing content realism rather than eliminating unnecessary renderer overhead

## Guardrails

- keep the benchmark path on `PretableSurface`
- do not remove sticky pinned columns or measurement
- keep cell values and wrapped text representative
- lock the adapter contract with tests before implementation changes
