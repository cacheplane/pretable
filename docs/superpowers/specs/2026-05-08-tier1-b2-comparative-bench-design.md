# Tier 1 B2 — Comparative Bench Design

**Date:** 2026-05-08
**Status:** Draft (awaiting user review before plan)
**Predecessor:** [Tier 1 Bench Slab 1](./2026-05-07-tier1-bench-slab1-design.md)

---

## Goal

Replace the three identical `BaselineAdapter` stubs (`gridalpha`/`gridbeta`/`gridgamma`) with real third-party React grid implementations so comparative bench results reflect actual library behavior, then re-evaluate the existing H1–H15 hypotheses against that real evidence and refresh the public `/bench` page.

The current state is a correctness problem: all three "comparator" adapters wrap the same hand-rolled virtualized div grid, which means cross-adapter deltas in the runsets are noise, and the website's `/bench` page makes specific behavioral claims (e.g., "gridalpha clips," "gridbeta needs DIY assembly") that aren't being measured. B2 makes the comparison real.

## Non-goals

- Webkit / Firefox coverage (Chromium-only, matches Slab 1).
- Premium-tier comparator runs (AG Grid Enterprise, MUI X Pro). We measure what free-tier consumers experience.
- Adding shims to make comparators "support" features their library doesn't have natively. Where a script can't be exercised, the adapter returns `unsupported` with a documented reason.
- Website `/bench` page redesign. PR 4 refreshes data and prose; layout is unchanged. A visual redesign is a separate brainstorm.
- Comparative coverage of pretable-internal scripts (selection/keyboard-nav from B Phase 7, cell-renderer hypotheses H16–H21) where the comparator library doesn't expose the equivalent capability. Those stay pretable-only.

## Architecture

### Sub-project shape: four sequential PRs

| PR  | Scope                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Replace `gridalpha` with a real `ag-grid` adapter (AG Grid Community). Carries the cross-cutting `BenchAdapterId` rename for all three new IDs. |
| 2   | Replace `gridbeta` with a real `tanstack` adapter (TanStack Table v8 + `@tanstack/react-virtual`).                                              |
| 3   | Replace `gridgamma` with a real `mui` adapter (MUI X DataGrid Community).                                                                       |
| 4   | Run the comparative matrix, commit the runset, re-evaluate H1–H15, refresh `apps/website/app/bench/page.tsx` data + prose.                      |

Each adapter PR is independently mergeable: the adapter mounts, runs every script its library natively supports, and returns `unsupported` (with a reason) for the rest. Matrix evaluators are not modified in PRs 1–3; they only change in PR 4 if H1–H15 thresholds need recalibration based on real evidence — and only with documentation.

### Adapter ID rename (cross-cutting in PR 1)

The first PR carries the rename for all three new adapter IDs even though only `ag-grid` is implemented in PR 1. This avoids re-doing the type plumbing three times. Comparator adapters not yet implemented show "coming soon" in the harness UI selector and are excluded from matrix runs by default.

Files touched by the rename:

- `packages/bench-runner/src/index.ts` — `BenchAdapterId` union: `"pretable" | "ag-grid" | "tanstack" | "mui"`. Drop `gridalpha` / `gridbeta` / `gridgamma`.
- `apps/bench/src/bench-types.ts`, `bench-app.tsx`, `bench-runtime.ts` — `scrollRuntimeProfiles` keyed by new IDs; viewport / row / cell selectors per adapter (each library renders distinctive DOM, so profiles diverge — see runtime profiles below).
- `apps/bench/src/baseline-adapter.tsx` — **deleted**. No external consumers; pretable is pre-1.0 with no backcompat constraint.
- `apps/bench/src/gridalpha-adapter.tsx` → `ag-grid-adapter.tsx` (real implementation, not a wrapper).
- `apps/bench/src/gridbeta-adapter.tsx` → `tanstack-adapter.tsx` (PR 2).
- `apps/bench/src/gridgamma-adapter.tsx` → `mui-adapter.tsx` (PR 3).
- `apps/website/app/bench/page.tsx` — `ADAPTER_ORDER` updated to `["pretable", "ag-grid", "tanstack", "mui"]`. Prose untouched until PR 4.
- `scripts/bench-matrix.mjs` — adapter-id strings updated everywhere; existing evaluators (H1–H15) keep current thresholds.
- `status/runsets/**` — historical runsets are frozen artifacts under the codenames; they stay as-is. New runs land in new runset directories under the real names.

### Runtime profiles per adapter

`scrollRuntimeProfiles[adapterId]` provides `viewportSelector`, `rowSelector`, `cellSelector`. The new adapters use:

- **ag-grid**: viewport `.ag-body-viewport`, row `.ag-row`, cell `.ag-cell` (stable public class names).
- **tanstack**: viewport `[data-pretable-bench-tanstack-viewport]`, row `[data-tanstack-row]`, cell `[data-tanstack-cell]`. TanStack is headless; the adapter owns the wrapper div and adds the data attrs itself.
- **mui**: viewport `.MuiDataGrid-virtualScroller`, row `.MuiDataGrid-row`, cell `.MuiDataGrid-cell` (stable public class names).

Major versions are pinned in `apps/bench/package.json` to keep selectors stable. Per-adapter smoke tests catch drift before a 70+-minute matrix run does.

### Per-adapter test surface

Each adapter PR adds:

- A vitest smoke test at `apps/bench/src/__tests__/<adapter>-adapter.test.tsx` that mounts the adapter against a small scenario, asserts the runtime-profile selectors all resolve to non-empty node lists, and asserts at least one row + one cell renders.
- An update to `apps/bench/src/__tests__/bench-runtime.test.ts` if the adapter changes the shape of `KeyboardEvent` dispatch targets (TanStack will, since it doesn't render to focusable cells by default — we plumb `tabIndex` ourselves where viable).

### Bundle / dependency impact

- `ag-grid-react` + `ag-grid-community` ≈ 1.1 MB min
- `@tanstack/react-table` + `@tanstack/react-virtual` ≈ 35 KB min
- `@mui/x-data-grid` + `@mui/material` peer + `@emotion/react` + `@emotion/styled` ≈ 380 KB min

These land in `apps/bench` only. `@pretable/*` packages and the website do not import them. The bench harness is dev-only (not deployed to consumers); the website's `/bench` page reads JSON evidence from `status/runsets/`, not live grids. **No public-API bundle impact.** The api-extractor gate on the public surface is unaffected.

## Adapter configuration policy

Each comparator adapter uses **idiomatic out-of-the-box config** — what a developer following the library's "getting started" docs would land on with minimal tweaks. We do **not** UX-match across adapters (forcing identical row height, overscan, etc.), and we do **not** turn on perf-mode flags. The trade-off is: results reflect what most consumers experience, not the ceiling each library can hit.

Per-adapter config is locked into this spec for reproducibility.

### AG Grid Community (`ag-grid-react`, `ag-grid-community`, major pinned)

- `<AgGridReact rowData={rows} columnDefs={cols} theme={themeQuartz} />`.
- Default row virtualization (built-in). No `suppressColumnVirtualisation`, no `rowBuffer` tuning.
- Columns mapped 1:1 from `ScenarioColumn`: `field`, `headerName`, `width`.
- Sort/filter via column-def `sortable: true`, `filter: true` (default).
- Updates via `gridApi.applyTransaction({ update: [...] })` — the documented happy path.
- Cell renderers via column-def `cellRenderer` / `valueFormatter`.

### TanStack Table v8 (`@tanstack/react-table`, `@tanstack/react-virtual`, majors pinned)

- `useReactTable` + `useVirtualizer` per the official virtualized-rows example.
- Manual virtualization (the library is headless; virtualization comes from `react-virtual`).
- Sort/filter via TanStack's `getSortedRowModel` / `getFilteredRowModel`.
- Updates via state replacement (`setData`) — TanStack has no transaction API. This is a known fairness asterisk; H10 (updates hypothesis) interpretation accounts for it.
- Cell rendering via column-def `cell:` JSX.

### MUI X DataGrid Community (`@mui/x-data-grid` major pinned, peer deps satisfied)

- `<DataGrid rows={rows} columns={cols} hideFooter />`. Pagination disabled (the Community-tier `pageSizeOptions` cap is irrelevant when paging is off).
- Default density and virtualization (built-in).
- Sort/filter via column `sortable: true`, `filterable: true` (default in Community).
- Updates via state replacement (Community tier has no transaction API; that's the honest baseline).
- Cell rendering via `valueFormatter` / `renderCell`.

## Documented `unsupported` matrix

| Script                   | ag-grid                                       | tanstack                                                                  | mui                                    |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| initial                  | ✅                                            | ✅                                                                        | ✅                                     |
| scroll                   | ✅                                            | ✅                                                                        | ✅                                     |
| sort                     | ✅                                            | ✅                                                                        | ✅                                     |
| filter-text              | ✅                                            | ✅                                                                        | ✅                                     |
| filter-metadata          | ✅                                            | ✅                                                                        | ✅                                     |
| updates                  | ✅ (transaction)                              | ✅ (setState — fairness asterisk)                                         | ✅ (setState)                          |
| autosize                 | ✅ (`autoSizeAllColumns`)                     | unsupported (headless, no autosize API)                                   | ✅ (`autosizeOptions`)                 |
| select-range-extend      | unsupported (cell-range select is Enterprise) | unsupported                                                               | unsupported (range select is Pro tier) |
| keyboard-nav-row         | ✅ (built-in)                                 | ⚠ provisional — wire `tabIndex` ourselves if cheap, otherwise unsupported | ✅ (built-in)                          |
| select-all               | unsupported (Community)                       | unsupported                                                               | unsupported (Community)                |
| scroll-with-format       | ✅                                            | ✅                                                                        | ✅                                     |
| scroll-with-render       | ✅                                            | ✅                                                                        | ✅                                     |
| scroll-with-heavy-render | ✅                                            | ✅                                                                        | ✅                                     |

The selection / keyboard-nav row is the most opinionated. Range select and select-all are paid-tier features in both AG Grid and MUI; we don't fake them. The `keyboard-nav-row` cell for tanstack is provisional — final state is documented in PR 2's body when the implementation reveals whether it's cheap to plumb.

## PR-by-PR breakdown

### PR 1 — `feat(bench): replace gridalpha stub with real AG Grid Community adapter`

1. Rename `BenchAdapterId` union; update all profile keys; delete `baseline-adapter.tsx`.
2. Add `ag-grid-react` + `ag-grid-community` to `apps/bench/package.json`.
3. Implement `ag-grid-adapter.tsx` with config above.
4. Update `scrollRuntimeProfiles["ag-grid"]` selectors.
5. Wire script support: `initial`, `scroll`, `sort`, `filter-text`, `filter-metadata`, `updates` (via `applyTransaction`), `autosize`, `keyboard-nav-row`, `scroll-with-format`/`-render`/`-heavy-render`. Selection scripts return `unsupported`.
6. Smoke test for selector resolution and basic mount.
7. Update `apps/website/app/bench/page.tsx` `ADAPTER_ORDER`. Prose untouched (rendered values fall back gracefully when an adapter has no runset row yet).
8. Repo-wide gates: typecheck, test, lint, format. PR with auto-merge.

No matrix run in this PR — deferred to PR 4 to avoid running the heavy matrix three times during the transition.

### PR 2 — `feat(bench): real TanStack Table comparator adapter`

1. Add `@tanstack/react-table`, `@tanstack/react-virtual` to `apps/bench/package.json`.
2. Implement `tanstack-adapter.tsx` per config; expose data-attrs the runtime-profile selectors need.
3. Wire script support per the matrix above. Resolve the `keyboard-nav-row` provisional cell during implementation; document final state in PR body.
4. Smoke test.
5. Repo-wide gates.

### PR 3 — `feat(bench): real MUI X DataGrid Community comparator adapter`

1. Add `@mui/x-data-grid`, `@mui/material`, `@emotion/react`, `@emotion/styled` to `apps/bench/package.json`.
2. Implement `mui-adapter.tsx` per config.
3. Wire script support per the matrix above.
4. Smoke test.
5. Repo-wide gates.

### PR 4 — `feat(bench): comparative S2 runset + H1–H15 re-evaluation + /bench page refresh`

1. Run the matrix (single invocation):

   ```
   pnpm bench:matrix \
     --project=chromium \
     --adapters=pretable,ag-grid,tanstack,mui \
     --scenarios=S2 \
     --scripts=<full supported list> \
     --scale=hypothesis \
     --repeats=3
   ```

   Approximate wall-clock: 4 adapters × ~12 scripts (some unsupported, fast-fail) × 3 repeats ≈ 90–120 minutes.

2. Inspect `hypotheses.json`. Two outcomes:
   - **All H1–H15 satisfied:** ship as-is; the runset is the news.
   - **Hypothesis flips (sat → fail or vice versa):** that's real evidence. Update threshold-rationale comments in evaluators only if a threshold needs recalibration based on the new comparator floor — never to mask a regression. Document any change in the PR body with the evidence.

3. Commit runset under `status/runsets/<id>/`.

4. Refresh `apps/website/app/bench/page.tsx`: replace hardcoded numbers and editorial prose ("clips," "needs DIY assembly," etc.) with claims grounded in the runset. Surface a prose draft in the PR description for editorial review before merging.

5. Update `docs/research/repo-memory.md` with a B2 milestone entry.

6. Repo-wide gates + PR.

**Failure handling:** if a hypothesis flips from `satisfied` → `failing` against real comparators, that means the previous claim was false (against a stub baseline). The honest move is to ship the failing evaluation, write a postmortem entry in `repo-memory.md`, and decide what to do (improve pretable, narrow the claim, or remove the hypothesis) in a follow-up — not to bury it.

## Risks

- **Selector stability (medium):** AG Grid and MUI render with stable public CSS classes; selectors should hold across patch releases. Minor releases occasionally rename internal classes. Mitigation: pin majors, per-adapter smoke tests, dependabot bumps run the test before merging.
- **TanStack `unsupported` blast radius (medium):** the script support list is provisional. We may discover during PR 2 that wiring `keyboard-nav-row` is trivial, or that `autosize` is impossible without rewriting the viewport. Final unsupported matrix is documented in PR 2's body.
- **MUI peer-dep weight (low):** ~400 KB added to a dev-only harness. Fine. Not added to any `@pretable/*` package.
- **Threshold realism on real comparators (high probability — this is the point):** H1 currently asserts pretable scroll p95 is 4.6× faster than `gridalpha`. Against real AG Grid (well-optimized), the multiplier might compress. PR 4 reports the truth and the claim is adjusted to match.

## Open question deferred to PR 4

The `/bench` page has paragraph-length editorial claims about each comparator. PR 4 will rewrite these to reflect measured deltas, but a draft of the new prose surfaces in the PR description for the user's review before merging — editorial-tone calls are a user decision, not a spec one.
