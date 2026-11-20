# Task 9 b: integrated publication processing budget

Status: intermediate synchronous optimization; **the complete 8 ms gate remains failing**.

The original diagnostic and `layout-publication-performance.json` are preserved.
`publication-before.json` reproduces 5000 resident group payloads, 5001 topology
nodes and 1808 accepted expansions under the default shared limits. Metadata is
8,388,024 bytes; payload is 3,721,128 bytes. Near-cap expansion p 95 was 26.50 ms,
collapse/expand p 95 27.09 ms. Host load was 5.80 on the 10-core host; this is not
quiet-host certification.

## Reproduction

```
node --import tsx scripts/probe-remote-publication-performance.mjs
REMOTE_BLOCK_SIZE=100 node --import tsx scripts/probe-remote-publication-performance.mjs
```

The original fixture uses supported maximum block size 1000. The second command
uses the actual default size 100, still demanding 5000 resident groups (50 blocks,
within the 64-block demand cap). Neither command changes memory limits. Provider
delay is zero; fixture materialization, total fill latency, synchronous demand
entry and callback durations are reported separately. Async-hook callback durations
locate long processing slices; their percentile includes trivial callbacks and is
**not** a row-model commit gate. Instrumentation adds overhead. Expansion/toggle
samples remain whole public synchronous command timings, with no provider I/O.

## Synchronous checkpoint

Preflight now constructs immutable sparse geometry once and installs that same
geometry on successful commit. Cancellation reachability and snapshot publication
reuse it. Previously each expansion rebuilt identical geometry three times.
Metadata-only changes submit only changed cache records and reuse compatible
accepted group descriptors. Payload changes submit only changed topology records;
pressure still prunes payload and validation evidence in one transaction.
Orphan-ancestor collapse uses the full pruning path. Old snapshots remain readable
after collapse, replacement and disposal because shared maps are replaced, never
cleared in place. Failed cache preparation invalidates its predecessor's authority.

Boundary instrumentation before optimization found 1853 retention preparations
consuming 28.13 s (including 12.21 s in cache preparation), and 5531 sparse-index
constructions consuming 8.89 s. Deterministic tests verify one sparse build per
expansion/collapse, no payload/topology resubmission for metadata-only commands,
and only newly admitted topology submission for a new range.

`publication-sync-1000.json` and `publication-sync-100.json` retain the complete
counter and timing evidence. Earlier post-optimization runs measured expansion
p 95 5.33 ms / toggle p 95 5.39 ms at unchanged 1808 expansions. The default 100
fixture admits 1750 expansions because 50 retained range/request descriptors cost
more than five large blocks, with 5000 payloads and 5001 topology nodes unchanged.
The group-membership set replaces the copied snapshot group-map ownership within
the existing conservative topology descriptor/index charge; immutable geometry is
shared rather than retaining redundant published copies. There is no async staging
reservation yet: current preparations remain synchronous and candidate maps share
accepted immutable values. Cooperative admission must explicitly reserve its new
cross-turn staging lifetime before this task can claim boundedness.

## Outstanding failure

Supported 1000 synchronous demand entry is 38.20 ms, fill callback maximum 52.11 ms.
Default 100 synchronous demand entry is 36.46 ms, fill callback maximum 41.47 ms.
Both exceed 8 ms. These results motivate incremental evidence and cooperative
acceptance/demand preparation. They cannot be waived by expansion improvements.
Quiet-host final timing, real browser cadence, and staged-preparation cancellation
and budget tests remain pending. React integration is not implemented here.

## Checkpoint verification

Node 24.20.0 / pnpm 10.12.1 checkpoint checks:

- Core:309 tests across 14 files; typecheck, lint, build and api:check passed.
- Layout:163 tests across 9 files; renderer:201 tests across 12 files passed.
- Both public consumer TypeScript projects passed; forgotten-export checks 5/5.
- Renderer emitted the existing Vite native-config warning about `__dirname`.
- `git diff --check` passed. No public API changes.

## Cooperative validation checkpoint (incomplete)

The second checkpoint removes per-response reconstruction of node/address/ID maps.
Each retained range now owns a sorted `Uint 32 Array` of sibling offsets; comparisons
read typed identities from the same immutable nodes. Signed zero, numeric/string
IDs and group/leaf namespaces remain distinct. Overlaps use direct sibling offsets;
paired eviction removes the compact index. Accepted-session topology lookup shares
the immutable group map rather than closing over mutable current state.

The added accounting is 8 bytes per retained entry plus 64 bytes per range:4 bytes
for retained offsets,4 bytes for a replacement/sort allowance, and a bounded block
index header. At 5000 rows/five blocks the added charge is 40,320 bytes. Before adding
cooperative scheduling, a diagnostic run kept 5000 payloads/5001 topology nodes at
7,196,936 metadata bytes before expansion. Final near-cap counters will be remeasured
for the composed implementation. Demand planning now advances by block and sibling
span boundaries, including child expansions, rather than enumerating every rank.

A reusable owned-copy reservation of `responseBytes` is acquired **before** any raw
transport reservation. With defaults,32 MiB ingress holds three 8 MiB raw reservations
and one 8 MiB owned-copy reservation. Four physical requests remain the scheduler's
ceiling; available shared ingress may reduce concurrency. A configuration that cannot
hold one raw response plus the stage fails explicitly. The old 1024/1024 fixture was
corrected to 1024/2048 and still verifies ignored-abort ownership through settlement;
new tests verify impossible capacity and default headroom ownership. The stage lease
is released once no physical/acceptance owner needs it; disposal first cancels the
builder, then releases its stage while raw ignored-abort leases remain until settlement.

A four-owner maximum success queue serializes owned copies across generations.
Authorization/error handling bypasses the success queue. Queued cancellation drops
its callback promptly. Range snapshot/validation now uses actual timer-task slices
of at most 1024 property/validation steps. This is a work bound, not final 8 ms timing
certification. Public tests verify that a 1000-row response remains unpublished during
preparation, disposal clears its continuation and all settled ingress, and source
objects changed during suspended property traversal are rejected. Providers must not
mutate delivered success values; caller-owned objects are not frozen or edited.
The synchronous user sizing hook is explicitly non-preemptible and must finish within
the processing budget. Retention candidates now keep their maps in a clearable state
cell: discard immediately revokes geometry authority and releases candidate references.

**Still incomplete:** retention/index/view preparation slices, cooperative summary
validation, acceptance-deadline checks, metadata-near-cap ingress refusal, safe candidate
rebase on bookkeeping changes, and phase-tagged final benchmarks. Cross-turn geometry
workspace accounting must be finalized before those phases are enabled. This checkpoint
does not claim the full Task 9b processing gate. Core 326 tests passed; core build and
API check passed. Core typecheck/lint and focused lifetime tests are rerun at commit.

## Cooperative retention checkpoint (still incomplete)

Success acceptance now carries one shared work budget through snapshot copying,
validation, retention preparation, and sparse geometry, and across consecutive
responses. A real timer task resets the budget; promise continuations do not.
Preparation yields at 1024 primitive steps or the next 64-step check after 2 ms,
leaving headroom for the synchronous atomic commit and publication. This bound
requires final measured slice verification; a single primitive or user estimator
is non-preemptible. Expansion and collapse remain synchronous.

The raw operation's monotonic deadline remains active through preparation, separate
from epoch session expiry. Metadata changes invalidate and close one candidate;
a still-owned response rebases without refetching. No-op identical queries retain
ownership. Tests cover late acceptance across the deadline, source/disposal,
metadata rebasing, consecutive response budgets, and terminal refusal when lease
metadata cannot fit. Throwing ownership guards close their suspended generators;
throwing deadline observers cannot leave empty scheduler jobs.

Built-in sizing now runs during the owned wire copy and charges all retained own
keys, including undefined-valued properties that JSON serialization used to omit.
It rejects over-responseBytes values before finishing the owned copy. The resulting
byte count is reused during admission; custom sizing hooks still execute, including
their reentrancy checks. Structural equality and summary validation also cooperate.
The underlying transport must still bound decoded raw responses before delivery.

Verification:342 core tests, lint, typecheck, build, and API check passed. This is
an implementation checkpoint, not completion: the disjoint current/candidate
metadata allowance audit, final ownership assertions, phase/whole-task timings,
consumer/layout/renderer regressions, and final near-cap evidence remain pending.
The earlier timing JSON is preserved and is not represented as final certification.
