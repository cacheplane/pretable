# Task 9b: integrated publication processing budget

Status: intermediate synchronous optimization; **the complete 8 ms gate remains failing**.

The original diagnostic and `layout-publication-performance.json` are preserved.
`publication-before.json` reproduces 5000 resident group payloads, 5001 topology
nodes and 1808 accepted expansions under the default shared limits. Metadata is
8,388,024 bytes; payload is 3,721,128 bytes. Near-cap expansion p95 was 26.50 ms,
collapse/expand p95 27.09 ms. Host load was 5.80 on the 10-core host; this is not
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
p95 5.33 ms / toggle p95 5.39 ms at unchanged 1808 expansions. The default100
fixture admits 1750 expansions because 50 retained range/request descriptors cost
more than five large blocks, with 5000 payloads and 5001 topology nodes unchanged.
The group-membership set replaces the copied snapshot group-map ownership within
the existing conservative topology descriptor/index charge; immutable geometry is
shared rather than retaining redundant published copies. There is no async staging
reservation yet: current preparations remain synchronous and candidate maps share
accepted immutable values. Cooperative admission must explicitly reserve its new
cross-turn staging lifetime before this task can claim boundedness.

## Outstanding failure

Supported1000 synchronous demand entry is 38.20 ms, fill callback maximum52.11 ms.
Default100 synchronous demand entry is36.46 ms, fill callback maximum41.47 ms.
Both exceed8 ms. These results motivate incremental evidence and cooperative
acceptance/demand preparation. They cannot be waived by expansion improvements.
Quiet-host final timing, real browser cadence, and staged-preparation cancellation
and budget tests remain pending. React integration is not implemented here.

## Checkpoint verification

Node24.20.0 / pnpm10.12.1 checkpoint checks:

- Core:309 tests across14files; typecheck, lint, build and api:check passed.
- Layout:163 tests across9files; renderer:201 tests across12files passed.
- Both public consumer TypeScript projects passed; forgotten-export checks5/5.
- Renderer emitted the existing Vite native-config warning about `__dirname`.
- `git diff --check` passed. No public API changes.
