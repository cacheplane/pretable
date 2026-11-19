# Remote datasets compatibility baseline

Baseline runtime: `8ce27c8bd` (2026-11-19). Implementation worktree:
`blove/remote-datasets-implementation`. The subsequent `520acf9a` commit changes
only the execution plan. No production code, existing test assertions, public
API, snapshots, spacers, manual `windowGap`, or editing behavior changes here.

This is Task 1 of the remote datasets plan, before shared runtime changes.
Remote-only cases belong to later tasks. The new executable matrix records
existing behavior; it intentionally introduces no artificial failing feature.

## Environment and commands

Node `v24.20.0`, pnpm `10.12.1`; dependencies installed independently in this
worktree with `pnpm install --frozen-lockfile` (no cross-worktree node_modules
links). The first sandboxed install failed registry DNS resolution; the approved
retry succeeded with the same frozen lockfile. pnpm reported ignored esbuild
build scripts; the package build succeeded without changing that policy.

Host load exceeded 300 during the baseline. Tests run sequentially with one
worker to avoid adding broad test concurrency; these are functional evidence,
not performance measurements. Logs are retained locally under
`/private/tmp/pretable-remote-baseline-*.log`.

| Command                                                                                                                               | Result                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `pnpm -r --filter './packages/*' build`                                                                                               | PASS                                  |
| `pnpm --filter @pretable-internal/layout-core test --maxWorkers=1`                                                                    | PASS: 8 files, 161 tests              |
| `pnpm --filter @pretable-internal/renderer-dom test --maxWorkers=1`                                                                   | PASS: 10 files, 176 tests             |
| `pnpm --filter @pretable/react test --maxWorkers=1 --exclude src/__tests__/remote-window-compatibility.test.tsx`                      | PASS: 153 files, 2,083 tests          |
| `pnpm --filter @pretable/react exec vitest run --environment jsdom src/__tests__/remote-window-compatibility.test.tsx --maxWorkers=1` | PASS: 1 file, 11 tests                |
| Legacy browser windowing/eviction (command below)                                                                                     | PASS: 10 Chromium tests               |
| Website server-data browser baseline (local production)                                                                               | PASS: 16 tests, 8 Chromium + 8 WebKit |

Package fixture checks also pass: `pnpm --filter @pretable/react typecheck`
and targeted ESLint for the added test file.

After the internal packages were built, the benchmark used:

```sh
pnpm --filter @pretable/app-bench exec vite build
pnpm --filter @pretable/app-bench exec vite preview --host 127.0.0.1 --port 43179 --strictPort
PRETABLE_BENCH_BASE_URL=http://127.0.0.1:43179 PRETABLE_BENCH_EXTERNAL_SERVER=1 pnpm bench:e2e apps/bench/tests/windowed-data.spec.ts apps/bench/tests/eviction.spec.ts --workers=1
```

Port 43179 was verified unused before startup; `strictPort` prevents accidental
fallback. The external-server flag bypasses the config's fixed 4173 preview.
All browser targets were local.

The website uses an explicit `BASE_URL` because its config otherwise defaults
to a deployed site. Port 43180 was checked unused before startup. Dependencies
were already built, so the local production baseline preparation was:

```sh
pnpm --filter @pretable/app-website examples:gen
pnpm --filter @pretable/app-website exec next build
pnpm --filter @pretable/app-website exec next start --hostname 127.0.0.1 --port 43180
BASE_URL=http://127.0.0.1:43180 pnpm --filter @pretable/app-website exec playwright test e2e/server-data.spec.ts --workers=1
```

The initial development attempt used `next dev` instead of `next start` and
`--project=chromium`; see the separate failure analysis below. Neither run
contacts the configured production default.

## Executable compatibility matrix

Paths below are repository-relative. Coverage is intentionally shared with
existing suites instead of cloning their assertions into the new file.

| Boundary                                         | Existing executable coverage                                                                                                                                               | Added coverage                                                                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Nonzero offsets, global coordinates, exact total | React `windowed-scroll-coordinates.test.tsx`; layout `viewport-window.test.ts`; renderer `window-spacer-coordinates.test.ts`; bench `windowed-data.spec.ts`                | Paired local/manual DOM row position, spacer, ARIA count and index at start 102                                                     |
| Unknown totals                                   | React `server-authority-aria.test.tsx`, `data-scope.test.ts`; eviction gate blip covers estimates                                                                          | Paired local/manual unknown-total geometry: no spacer or offset, manual count -1                                                    |
| Grouped/non-external downgrade                   | React `server-authority-aria.test.tsx`, `data-scope.test.ts`; `eviction-gate-blip.test.tsx` covers engine sort                                                             | Paired local/manual grouping and engine-filter geometry: local positions, loaded count                                              |
| Metadata-only boundary/count changes             | React `indexed-rendering.test.tsx`, “windowGap telemetry refreshes from a resultMeta-only update without a rows/viewport change”; renderer `window-spacer-refresh.test.ts` | Reuse existing test: total 1,000 → 531, window start 500, 30 loaded rows, every callback preserves the after-gap with count 1       |
| Dataset identity                                 | React `eviction-selection-surface.test.tsx`, `eviction-population-change.test.tsx`; grid-core indexed-selection contains key mismatch checks                               | Paired local/manual metadata-only `datasetKey` reset refuses an evicted positional span; local cannot paint an absent-endpoint span |
| Multiple instances                               | Existing independently scoped UI suites                                                                                                                                    | Simultaneous manual/local surfaces share record IDs; geometry, count and selection remain independent                               |
| Eviction/anchoring                               | Layout `eviction-anchor.test.ts`, `window-bottom-edge.test.ts`; renderer `window-spacer-height.test.ts`; React eviction suites; bench `eviction.spec.ts`                   | Reuse existing tests                                                                                                                |

New paired cases live in
`packages/react/src/__tests__/remote-window-compatibility.test.tsx`.

The metadata-only contract uses the last published plan's leading height plus
loaded row metrics for the pixel boundary, and current result metadata for the
gap count. It does not require a row-layout replan solely because metadata
changed. Tests must not conflate a fresh count with a newly measured boundary.

## Copy, CSV and editing contracts retained

- `copy.test.ts` covers selected visible spans, missing endpoint IDs, formatting,
  escaping and grouped headers. `indexed-rendering.test.tsx` checks copy/paste
  reads only selected/output spans. Cell select-all remains the loaded window
  (`eviction-selection-surface.test.tsx`), not the entire external population.
- `csv-export-surface.test.tsx` covers loaded scope under an external total,
  selected rows, drawn column order, omissions/partial announcements, overrides
  and cancellation. It does not fabricate unloaded records for export.
- `pretable-surface-editing.test.tsx`, `pretable-surface-edit-lifecycle.test.tsx`,
  and `indexed-rendering.test.tsx` retain local/manual editable behavior:
  Enter/double-click/type-to-replace, validation, asynchronous permission and
  commit lifecycle, controlled rows reconciliation, cancellation and grouping.
  Managed-remote read-only rules must not leak into these existing modes.

## Geometric evidence

Layout tests check a variable-height anchor's screen position before/after
leading eviction and a stable full extent; their no-spacer control proves the
geometry assertions are meaningful. Bottom-edge tests keep real rows out of
the trailing spacer. Renderer tests exercise global row positions and spacer
refresh/height retention.

Browser evidence is required in addition to jsdom: `toBeVisible()` alone cannot
prove that a row intersects the scroll viewport. `windowed-data.spec.ts` uses
bounding-client-rect intersection at dataset row 5,020 (global scroll offset
240,960px for 48px rows), with a start-zero control and telemetry agreement.
It also checks the approximately 480,000px extent of 10,000 records with only
50 loaded, ARIA index 5,002, scrolling to row 5,030 and a pager move to 6,000.
`eviction.spec.ts` uses actual `locator.click()`/Shift-click hit testing and
checks cursor/focus recovery, retained selection counts and mutation controls
that remove the window or dataset key. No synthetic-click substitutions are
made for this baseline.

An additional Chromium snapshot on the same local build recorded:

```json
{
  "scrollTop": 240960,
  "scrollHeight": 480024,
  "ariaRowCount": "10001",
  "targetTop": "240960px",
  "targetAriaRowIndex": "5022",
  "intersectingValues": [
    "5019",
    "5020",
    "5021",
    "5022",
    "5023",
    "5024",
    "5025",
    "5026",
    "5027"
  ],
  "visibleRowCount": 8
}
```

The target is dataset row 5,020; its drawn top equals the global scroll offset.
The rectangle intersection includes edge rows, while telemetry reports its own
visible-row band. Both establish reachable loaded rows rather than a merely
mounted DOM node. Raw capture: `/private/tmp/pretable-remote-baseline-geometry.json`.

## Failures and outstanding gates

The initial website attempt used `next dev` on the explicit local port 43180.
It passed 6/8 Chromium tests and failed two exact mount-request counts:
`one query change is exactly one request` and `notify-only reports a query
change`. Both expected 1 and received 2 before any user query gesture.
`apps/website/next.config.ts` enables `reactStrictMode`; both
`ServerDataGrid.tsx` and `NotifyOnlyGrid.tsx` fetch inside mount effects, so
Next development effect replay sends the second mount request. This is a
pre-existing development-mode behavior, not a remote implementation regression.
No existing assertion was loosened. The dev server was stopped and the same
suite was rerun against a local production build; results above distinguish
that gate from the development attempt.

One initial new-fixture run failed its two grouped cases because
`[data-pretable-row]` selects a data row, not the group header (which uses
`[data-pretable-group-row]`). The fixture now explicitly checks the group
header at index 2 and the first data row at index 3. No production change was
needed. The final 11-case run passes.

Existing jsdom canvas/navigation notices and Vite native-config notices occur
in the React suite without failures. Browser logs also emit a color-environment
warning; benchmark build reports its existing large-chunk advisory. These do
not establish performance regressions.

All Task 1 functional gates above passed; no baseline gate remains outstanding.
A passing baseline is not a remote-feature release claim or a claim about
performance under this loaded host.
