# Remote sparse layout feasibility — Task 4

Recorded 2026-11-19. Geometry gate: **feasible with an explicit remote-only physical
scroll mapping**, not an unbounded CSS spacer. This is a functional prototype and
an integration contract, not evidence that the 8 ms processing budget is met.
The host was loaded; no quiet-run performance conclusion is claimed. No React
integration or change to existing manual-window coordinates is included.

## Sparse projection

`packages/core/src/remote/sparse-index.ts` is internal and owns no payload. One
root branch represents all implicit root siblings. Resolved group descriptors
add branch nodes; sorted expanded-child positions and prefix subtree extents
compress all intervening siblings. Binary search within each traversed branch
maps rank to address and address to rank. A collapsed descendant contributes no
extra visible extent; its topology remains available across payload eviction.
There is no object for an unseen leaf. Collapse/reopen and identical descriptor
refetch preserve the projection. Contradictory descriptors require a new result
session and are refused atomically.

The 20 regions + 10,000 customers + 50,000 orders case has 60,020 display slots,
three allocated branch nodes (root and two descriptors), two expansion entries,
and zero business-row payload. A flat root of 1 million or 100 million leaves
uses one branch node in both cases. `allocatedNodes` counts branch nodes; the
same retained group descriptors and expanded-child records also occupy bounded
storage, so this count is not a byte estimate or a count of all JavaScript
objects. Each mutation builds a replacement bounded topology before publishing;
old and candidate structures coexist transiently. Global admission must account
for that temporary memory as well as identity-string sizes.

Defaults match the design's provisional limits: 8,192 topology nodes including
root, depth 32, and 2,048 expansion intents. Exceeding these caps, bad ordinals,
missing ancestor descriptors, cycles, or unsafe integer extents refuses without
changing the old state. Pending expansion intent is allowed before descriptors;
it contributes no extent until ancestors are resolved and expanded. There is no
expand-all or fetch behavior. The controller resolves ancestors before children.

Mutations rebuild in O(N × depth + sum of sibling sorting costs), where N is
retained topology, not logical leaves. Lookup follows depth and binary searches
expanded positions. The small independent eager-tree oracle enumerates its own
rows through 180 seeded expansion/collapse sequences across disjoint branches;
it checks every rank and reverse rank. Additional tests cover far seeks,
refetch/collapse, depth and admission refusal, pending intent and overflow.
The prototype does not yet provide cooperative topology construction. Task 7/8
must account for candidate allocation and schedule or replace this bounded rebuild
if measurements violate the processing budget; bounded memory is not a timing proof.

## Height estimates and identity anchors

`RemoteMetrics` structurally implements layout-core's `RowMetricsReader`, including
its empty, invalid-index, fractional-index and end-offset conventions. Existing
`planViewport` can consume it without a core runtime import or dependency cycle.
Existing `RowHeightIndex` enumerates materialized rows and therefore cannot hold
all implicit slots. The prototype uses one constant estimate plus bounded,
stable-ID measured corrections. Its own measurement cap is explicit; sync after
expansion/collapse rebuilds rank corrections from retained identity, never from
stale ranks. Hidden identities retain measurements until eviction; width/theme
changes explicitly invalidate measurements. Callers capture the anchor before a
mutation and restore by ID after it. An unavailable identity returns undefined,
requiring an explicit controller fallback rather than silently binding another row.

`measureBatch` publishes a viewport batch with one O(M log M) correction rebuild
and O(M) rank resolutions, M being retained measurements. The structural test at
100,000 retained measurements submits 50 changes and verifies 100,000 resolutions,
not 5 million. Individual `measure` is a convenience and must not be called in a
per-row publication loop. Offset lookup binary-searches corrections; inverse
lookup binary-searches logical rank, without allocating rows. Batch sorting,
copying, topology sync and retained-map size remain timing risks: before React
integration, Task 9 must use bounded/scheduled preparation or incremental prefix
structures if necessary, and measure against the 8 ms budget. No 100k-measurement
per-frame claim is made here.

## Actual browser evidence

Run `node scripts/probe-remote-layout.mjs` from the repository root. It uses installed
Playwright Chromium/WebKit against a standalone in-memory DOM fixture; no network
or production page is accessed. The fixture imports transpiled **actual prototype
source**, checks assertions, and prints JSON. The recorded output is
[layout-browser-evidence.json](layout-browser-evidence.json).

| Engine   | Version       |         Requested CSS height | Measured scrollHeight / element height | Maximum observed scrollTop |
| -------- | ------------- | ---------------------------: | -------------------------------------: | -------------------------: |
| Chromium | 158.0.8127.18 | 64,000,000 and 1,000,000,000 |                             33,554,428 |                 33,553,828 |
| WebKit   | 27.2          | 64,000,000 and 1,000,000,000 |                             33,554,428 |                 33,553,828 |

Both engines represented 8,000,000 px exactly. The conservative fixture ceiling
is 8 million physical pixels with a 600 px viewport. This value is a demonstrated
prototype choice, not a universal browser specification; runtime integration
must retain a supported-browser validation/fallback policy.

At 100 million estimated 20 px rows (2 billion logical pixels), proportional
80% distant scroll reveals logical rank 79,999,976 at viewport top. An actual
Playwright mouse wheel input of +40 px moves to rank 79,999,978, while quantized
physical scrollTop can remain unchanged. The viewport still visibly advances
because rows are projected relative to logical position. An ID anchor at rank
80 million with intra-row offset 7 px survives a change to rank 50 million,
measurement changes above it, and measurement invalidation. DOM rectangles and
`elementFromPoint` confirm identity and intersection. The final row intersects
at viewport y=580 after reveal; endpoint DOM/logical roundtrip is exact in both
engines. Full measured values are retained in the JSON.

## Mapping and integration obligations

The scroll range ratio is `(logicalTotal - viewport) / (physicalTotal - viewport)`.
Native thumb/distant-scroll intent maps proportionally; wheel/keyboard pixel intent
updates logical scroll directly. Published scrollTop, row tops, reveal targets,
and hit-test offsets all remain **logical**. Physical row top is
`observedDOMScrollTop + logicalRowTop - logicalScrollTop`; the observed value is
required because actual DOM scroll positions round differently between engines.
The physical viewport contains ordinary unscaled row heights. Observed DOM rounding
must never overwrite programmatic logical intent through a scroll echo: at 2 billion
logical pixels, one physical pixel corresponds to roughly 250 logical pixels.
Thumb travel is necessarily coarse; local pixel movement and explicit seek remain
precise at the tested range. This is not a claim of unlimited pixel precision up
to the safe-integer limit.

Task 9 must integrate and test:

- Ignore programmatic scroll echoes; distinguish native thumb movement from
  programmatic seek and local movement, including physical rounding.
- Normalize wheel `deltaMode` (pixels, lines, pages), preserve ctrl/pinch browser
  zoom, and translate keyboard row/page/home/end intent into logical navigation.
- Validate touch and trackpad/momentum behavior; the prototype's one actual wheel
  case does not establish these gestures. Directly allowing scaled native wheel
  deltas would jump many logical rows and is not acceptable.
- Keep actual DOM projection separate from logical telemetry, reveal and hit-test
  positions. Repaint when logical position changes even if physical scrollTop does
  not. Handle viewport/total-height changes by restoring stable-ID anchors.
- Integrate measurement invalidation, eviction and hidden/removed-anchor fallback;
  the geometry prototype demonstrates the underlying behavior, not focus policy.
- Preserve all existing manual-window global-coordinate behavior. No legacy
  controller or local snapshot union changed in this task.

## Verification

Focused sparse-index and remote-layout tests, package typechecks/builds, and the
unchanged layout-core and renderer-dom suites are the compatibility gates. Initial
compatibility run: layout-core 161 tests in 8 files; renderer-dom 182 tests in 11
files (including then-current 6 new remote tests). Additional focused coverage
adds independent depth refusal and the 100k batch work-count case. Browser probe
assertions pass on both recorded engines. Existing Vite native-loader configuration
warning remains unchanged. None of this constitutes a production performance or
full interaction release gate; the concrete geometry strategy is established for
subsequent controller/read-adapter work.
