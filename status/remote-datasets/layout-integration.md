# Task 9 — shared layout reads and remote projection

Functional integration is ready for review. **The end-to-end 8 ms processing
performance gate FAILED.** Mandatory Task 9b must resolve admission/validation/
publication scheduling before React Task 10. The Tasks 5–9 checkpoint is not
complete, and this report is not a remote-grid release claim.

## Shared reads and compatibility

`layout-core/read-layout.ts` plans and reads one aligned viewport range, publishing
clamped scrollTop and row tops in the same logical/global coordinate space.
It imports no core runtime. The existing local controller still owns its indexed
height roots, dense operations, cooperative replacement, estimate convergence,
manual global offsets, leading/trailing spacers and windowGap semantics. Its only
materialization change is routing the same single `snapshot.range` call through
this structural seam. Original row/ref/window shapes are preserved.

The remote implementation is split into `remote-metrics.ts`,
`remote-read-layout.ts`, `remote-scroll.ts` and numeric guards. The existing
`remote-layout.ts` import remains a facade; the intended integration APIs and
all associated types are available through renderer-dom's package barrel.
No React UI, selection, export, manual-model union, provider protocol or public
core API was changed.

`RemoteLayoutAdapter.prepare(snapshot)` performs bounded advances over immutable
accepted model reads. It sizes the resident identity index before reservation,
builds that map in a second bounded pass, then prepares retained measurement
ranks cooperatively. The host schedules `advance(maxUnits)` outside render;
128 units were used in the diagnostic. `commit()` publishes the snapshot, rows,
geometry, clamped offset and explicit anchor result together. Until commit,
`getState()` returns the previous publication. Supersession, measurement changes,
refusal, cancellation and disposal cannot publish an obsolete candidate.
Already queued preparation callbacks are harmless after disposal. Reads and
construction never fetch or declare demand; the integrating host must call
headless `demandViewport` separately.

Accepted query/session/result identity governs measurement retention and
presentation keys. Command generation alone is insufficient: a new query may
advance generation while the old accepted session remains visible as stale,
and its replacement can subsequently publish within that same generation.
Tests preserve the stale view's identity/measurements, then reset on new accepted
session identity. Leaf number/string/signed-zero identities and groups are
namespaced. Status addresses use typed route segments and sibling ordinal;
loading/error/unloaded transitions do not invent business records or change
status presentation identity. Collapsing another branch can move a status rank
without changing its address.

Stable business-ID plus intra-row offset anchors survive measurement changes,
collapse/reorder, eviction/refetch and width/theme invalidation. Unavailable
identity is explicitly reported as `anchor: "unavailable"`; fallback preserves
the clamped absolute logical offset, rather than attaching to a new record at an
old rank. Status slots remain estimates and cannot be measured through the
adapter's business measurement API. `invalidateMeasurements()` is the explicit
width/theme hook; `evictMeasurements(ids)` is the owner's eviction hook.

## Measurement and metadata ownership contract

Remote measurement prefixes use a persistent AVL tree. A viewport batch updates
only changed/evicted paths and resolves changed IDs, without copying/sorting the
whole retained measurement map. The 50-of-100,000 regression now asserts exactly
50 rank resolutions. Topology resynchronization is prepared in bounded units,
then committed atomically. Invalidation releases the scoped retained set and
clears geometry without walking every measured prefix path. Local measurement
limits and behavior are untouched.

The optional `RemoteMeasurementBudget` is a transactional cache-owner seam, not
a second cache implementation:

- `prepare(changes, removed, transientBytes)` reserves candidate work before
  prefix allocation. `removed: "all"` replaces the entire scoped retained set.
  ID strings, retained map/height/prefix nodes and speculative path/candidate
  allocations have explicit conservative estimates.
- The returned `commit()` must atomically replace charges and release transient
  reservations, returning false without changing charges when refused.
  `cancel()` releases only speculative ownership and must not throw.
  Callbacks must not notify/reenter mutations; guards reject reentry. Throwing
  resolution/commit and refused commit cancel candidates and preserve geometry.
- The owner must admit pure releases. Disposal releases all measurements and
  current/candidate projections; externally retained old states remain consumer
  ownership. Accounting values are estimates, not exact JavaScript heap size.

`RemoteProjectionBudget.reserve(bytes)` is a separate scope for the derived
resident ID-to-rank map. Current and candidate maps coexist under reservations;
commit releases the old map reservation and cancellation releases the candidate.
The owner-provided release is synchronous and must not throw. This is distinct
from retained heights: evicted/hidden nodes lose their live rank immediately,
while their height can remain within the measurement allowance.

The two scopes must be wired to the authoritative headless cache in Task 10,
including combined admission/eviction/disposal, viewport-buffer accounting and StrictMode tests. **This task
does not claim globally composed resource limits without those injected owners.**
The unbudgeted constructor remains useful for standalone geometry tests.

## Input and actual browser evidence

`RemoteScrollMapping` keeps telemetry, hit testing, reveals and row positions
logical. Only DOM projection uses
`observedDOMScrollTop + logicalRowTop - logicalScrollTop`. The existing 8,000,000
physical-pixel ceiling remains a conservative tested choice. `RemoteScrollInput`
normalizes wheel pixels/lines/pages, preserves fractional trackpad/momentum
wheel deltas, leaves ctrl/pinch wheel zoom native, translates row/page/home/end
keys, consumes touch position deltas and ignores recorded programmatic scroll
echoes. The host prevents default only for handled input and repaints after
every handled logical movement, even if physical scrollTop rounds unchanged.

`node scripts/probe-remote-layout.mjs` transpiles the actual adapter, metrics,
shared read seam and input modules into an isolated in-memory fixture. It paints
adapter-planned rows, uses actual DOM scroll rounding, and asserts rectangles,
viewport intersection, `elementFromPoint`, logical telemetry, far reveal and
anchor preservation. No production URL or network server is used.

Recorded evidence: [layout-integration-browser-evidence.json](layout-integration-browser-evidence.json).
Chromium 158.0.8127.18 and WebKit 27.2 both passed:

- native Playwright wheel +40 logical pixels and keyboard PageDown/ArrowUp;
- synthetic DOM line/page/fractional wheel normalization and ctrl-zoom preservation;
- 100-million-row distant mapping, stable anchor after topology/height change,
  invalidation, end reveal and physical roundtrip checks.

Chromium additionally passed protocol-dispatched touch movement +40 logical
pixels. These are browser/protocol observations, **not physical-device gesture
evidence**. WebKit physical touch, real trackpad momentum, OS overscroll, pinch
on touch hardware and touch-fling inertia remain release gates. The seam does
not synthesize platform inertial physics. React still must wire event ownership,
editable-target keyboard guards, touch/pinch arbitration and appropriate native
or host momentum deltas.

## Performance evidence and blocking gate

Reproduction (Node 24.20.0, pnpm 10.12.1):

```sh
node --import tsx scripts/probe-remote-layout-performance.mjs
node --import tsx scripts/probe-remote-publication-performance.mjs
```

[Isolated diagnostic](layout-integration-performance.json), ten logical CPUs,
load averages 7.03 / 6.80 / 8.70:

| Operation                                                      |      p95 | Maximum / other evidence          |
| -------------------------------------------------------------- | -------: | --------------------------------- |
| 50 measured updates among 100,000 retained                     | 0.117 ms | 0.857 ms; 50 ID resolutions       |
| Measurement resync, 128 entries per advance                    | 0.090 ms | 1.740 ms; commit 0.131 ms         |
| 8,191 topology descriptors in one batch                        | 5.898 ms | 6.500 ms; 8,191 descriptor visits |
| Standalone view, 5,000 loaded + synthetic 8,191 descriptors    | 5.742 ms | 6.003 ms                          |
| Adapter preparation, 5,000 resident entries, 128-unit advances | 0.069 ms | 0.140 ms; commit 0.364 ms         |

`ModelRetention.index` now submits descriptors/expansions as one atomic sparse
batch instead of rebuilding the whole index for every descriptor. This removes
the demonstrated repeated whole-tree work, but does not make a full model turn
meet the budget. The standalone maximum-descriptor fixture is not an admission
proof; the actual admitted workload below is the decisive measurement.

[Actual public-model diagnostic](layout-publication-performance.json), load
averages 8.57 / 7.16 / 8.46, uses the default limits and an immediate in-process
provider. It admits 5,000 group payloads, 5,001 topology nodes, one store and
1,808 expansions. Payload cost is 3,721,128 bytes and metadata is 8,388,024 bytes;
the next expansion correctly refuses at the 8 MiB metadata limit. It does not
raise limits to force 2,048 expansions. The measured methods synchronously
include retention preflight, validation/topology work and snapshot publication.

| Full synchronous operation                |    Median |       p95 |   Maximum |
| ----------------------------------------- | --------: | --------: | --------: |
| Last 48 accepted expansions near capacity | 25.298 ms | 34.773 ms | 39.919 ms |
| Repeated collapse/expand near capacity    | 25.124 ms | 28.460 ms | 38.874 ms |

**FAILED: commit p95 <= 8 ms.** The approved rebuild-slice maximum <= 8 ms and
browser refresh/cadence gates are also unchanged. These diagnostic timings are
not a certified quiet-host benchmark and cannot establish a release pass, but
the integrated failure cannot be hidden by individually small geometry phases.
Task 9b must introduce bounded cooperative transactional preparation/publication
and verify the full admitted workload before React integration proceeds.

The intentionally raised 100,000-resident diagnostic also shows 26.053 ms view
p95 and a 10.254 ms adapter map-growth/GC outlier. Default resident payload is
5,000; 100,000 is the separate retained-measurement cap. No 8 ms support claim is
made for raised residency. A one-shot 100,000-measurement population is about
98 ms and is not a viewport-frame API usage pattern; production integration must
batch viewport measurements and schedule topology/rank preparation.

## Verification

Red/green cycles covered the new shared reader, incremental measurement work,
cooperative stale cancellation, budget admission/refusal, normalized input,
remote adapter, generation/session replacement, signed-zero/typed identity,
eviction anchoring, error cleanup and post-disposal callbacks. An independent
eager oracle checks AVL offsets/inverse lookup through 300 measured/evicted/
reordered sequences. No original window or eviction assertion was loosened.

- Full layout-core: 163 tests in 9 files passed (baseline 161).
- Full renderer-dom: 201 tests in 12 files passed (baseline 184).
- Full core: 303 tests in 13 files passed, including 286 remote tests.
- Five unchanged/new-baseline React window/eviction compatibility files:
  23 tests passed, including Task 1's 11-case compatibility suite.
- Core/layout/renderer typechecks; core build/API check; React and benchmark
  builds; package lint and diagnostic-script lint passed.
- The original 10 Chromium `windowed-data.spec.ts` / `eviction.spec.ts` tests
  passed unchanged with real pointer/keyboard actions and intersection checks:

```sh
pnpm --filter @pretable/app-bench exec vite preview --host 127.0.0.1 --port 43219 --strictPort
PRETABLE_BENCH_BASE_URL=http://127.0.0.1:43219 PRETABLE_BENCH_EXTERNAL_SERVER=1 pnpm bench:e2e apps/bench/tests/windowed-data.spec.ts apps/bench/tests/eviction.spec.ts --workers=1
```

Port 43219 was verified unused before startup; targets were explicitly local.
A fresh website production build and the original server-data suite also passed:
**16 tests (8 Chromium + 8 WebKit), one worker, 44.7 seconds**. This verifies
request ownership/counts, stale rows on error, totals/export/ARIA reporting,
notify-only behavior and manual-window advancement under the shared read seam.
The exact local commands were:

```sh
pnpm --filter '@pretable/app-website^...' build
pnpm --filter @pretable/app-website examples:gen
pnpm --filter @pretable/app-website exec next build
pnpm --filter @pretable/app-website exec next start --hostname 127.0.0.1 --port 43220
BASE_URL=http://127.0.0.1:43220 pnpm --filter @pretable/app-website exec playwright test e2e/server-data.spec.ts --workers=1
```

Port 43220 was checked unused first. The production server was stopped after
testing; no production URL was accessed. The initial sandboxed Next compilation
remained at the compile stage without progress and was interrupted; the authorized
unsandboxed production build completed successfully. Existing dynamic-filesystem
tracing warnings were reported; no test assertions or website code were changed.
The full React suite was not rerun; its Task 1 baseline remains separate.
Existing Vite native-config, jsdom canvas and benchmark chunk-size notices remain.
Sandboxed Chromium launch initially failed macOS Mach-port permission checks;
the authorized local-only unsandboxed probe passed both engines.
