# Benchmark Surface Austerity Plan

1. Add failing tests for the Pretable benchmark adapter contract.
   The tests should prove the adapter still renders through `PretableSurface`, preserves the benchmark DOM markers, and no longer emits the extra labeled cell chrome currently paid for on every body cell.

2. Simplify the Pretable benchmark adapter presentation.
   Update `apps/bench/src/pretable-adapter.tsx` so header and body callbacks render the minimum useful content for benchmark realism while keeping wrapped values, sticky pinned columns, and telemetry wiring intact.

3. Re-run targeted tests and adjust any benchmark-specific expectations.
   Run the bench app tests first, then any affected React tests if the adapter contract relies on shared renderer behavior.

4. Run full verification and benchmark evidence gathering.
   Execute `pnpm lint`, `pnpm test`, `pnpm typecheck`, `pnpm build`, the Pretable Chromium smoke, and the repeated three-adapter matrix.

5. Compare the new runset against the current baseline.
   Record whether the austerity cut materially improves Pretable's `H1` frame-time result without regressing `H3`.

6. If Pretable still misses `H1`, measure the next hotspot rather than guessing.
   Prefer renderer-local fixes that preserve the shared DOM contract, starting with row-estimate reuse and bounded benchmark-only overscan tuning before revisiting more invasive renderer changes.
