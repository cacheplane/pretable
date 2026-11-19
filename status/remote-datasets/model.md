# Task 8: headless remote read model and summaries

`createRemoteModel(provider, options)` is the new `@pretable/core` entry point.
It composes the session acceptance controller, physical scheduler, authoritative
cache, sparse topology index and server summary projection. Local/manual model
contracts and implementations are unchanged. This task does not implement React,
renderer metrics, selection, clipboard or export.

## Headless contract

Construction is inert. `setQuery` opens a session and admits its root range before
publishing a root count and payload together; a proven empty root publishes zero
slots. `demandViewport({ start, end })` declares half-open display ranks outside
render. Reads use aligned, nonoverlapping blocks, defaulting to the smaller of
100 siblings and the provider limit, with a supported maximum of 1,000. A viewport
may demand at most 64 aligned blocks and 64 block-widths of display ranks. It
cancels obsolete range owners, deduplicates unchanged demand and protects its
resident working set. The scheduler keeps its reviewed four-physical/64-queued/
256-subscriber limits and focused-root priority.

`getSnapshot`, `getStatus`, `readSlot`/`getSlot`, `getDiagnostics`, loaded iteration
and summary reads never invoke clocks, providers or expiry logic. `checkExpiry`
is an explicit effect; expiry freezes the accepted version until `refresh`.
`retry` explicitly retries failed viewport/summary work, or refreshes an
unpublished/error/stale root. Identical query identity is reused. Correcting a
rejected query back to the prior valid identity starts a usable session again.
Widths are presentation state outside the strict remote query contract.

Snapshots expose root sibling count, exact expanded display extent, resident
node/group/leaf counts and loaded visible iteration separately. The iterator
walks resident entries and uses sparse ranks; it does not scan the logical extent
or emit fake business rows. Slot unions distinguish loaded nodes, unloaded,
loading and range errors. Snapshot methods capture their own immutable projection;
later expansion or admission cannot mutate an old snapshot.

`setExpanded` admits pending stable-ID intent before changing projection. Known
expanded groups retain only ID, route, parent, ordinal and exact child count,
including required ancestors. Parent payload eviction does not collapse intent
or destroy child-request count evidence. Unresolved intent waits for ordinary
ancestor discovery. Collapse immediately cancels unreachable branch demand; late
responses cannot reopen it. Inactive descriptors disappear when neither retained
payload nor expansion/ancestor intent needs them.

Subscribers have explicit ownership and a 256-distinct-listener cap. Each distinct
callback has accounted bookkeeping; overflow or failed metadata admission throws
`RangeError("Remote subscription capacity")`. Duplicate callbacks use the existing
Set-style semantics. Unsubscribe releases its charge. Disposal clears listeners
without a final subscriber notification and makes late data publication inert.
The session's internal reset events remain the composition seam for later
selection/focus invalidation.

## Transaction and retention boundary

`model-retention.ts` owns admission planning; `model-view.ts` owns immutable read
projection. The facade coordinates commands and publication. The cache is the
retention authority: cache/session/validator maps share the same frozen accepted
range objects, rather than retaining independent payload copies or histories.

Validator preflight validates without changing its retained evidence. All sizing,
immutable response validation and candidate sparse-index construction happen
before commit. Captured cache epoch and controller command/generation ownership
are checked after sizing. Cache commit, exact range/evidence eviction and accepted
ledger insertion run synchronously before notification. Failed preflight preserves
previous same-address evidence. Throwing or reentrant sizing produces no partial
admission; source changes and disposal win over the candidate. Speculative plans
are discarded when sparse topology cannot fit.

Two data-view scopes share global payload/metadata budgets. New-root admission
releases the retiring scope atomically, including its protected body when needed.
A separate internal `-1` accounting scope holds only controller-lifetime metadata:
subscription/request bookkeeping, configured-query ownership and safe expansion
intent. It is not a third data view and cannot hold payload, stores or topology.
Source/auth changes immediately clear visible protected bodies and expansion
intent even when replacement query admission fails. Range revocation removes
covered topology, descendant payload, expansion intent and summary evidence while
preserving unaffected branches. Invalid same-scope queries may retain a charged
stale view. Oversized rejected query configurations are not retained for retry;
the caller must resubmit a fitting query or recreate the model with appropriate
limits. A valid retained query remains charged after a protocol failure.

Accounting covers query/session/summary descriptors, store and root/group topology,
expansion IDs, subscription/request keys, physical-operation context dependencies,
current snapshot slot/index structures and bounded demand/error bookkeeping.
Current read maps share a route key per branch rather than copying it per slot.
Errors are pruned with viewport demand; the model retains no visited-page history.
Externally retained old snapshots and caller-owned callbacks/data remain consumer
ownership, outside the model's admitted totals.

Ingress is reserved before physical dispatch. Scheduler admission waits for a
capacity wake without invoking the provider, spinning or creating a parallel
waiter per attempt. Each physical reservation lasts until settlement and final
acceptance/discard, including final failures; intermediate retry failures release
before backoff. Ignored-abort operations keep their reservation and conservative
query/session/request context charges until settlement. Unique ownership IDs
prevent an obsolete same-address attempt from losing its charge to a retry.
Disposal releases all admitted bodies immediately, but physical ingress/request
charges may remain until ignored-abort transports settle. Abandoned opens retain
the existing best-effort provider resource finalizer.

Capacity is a model-only, value-free diagnostic, separate from provider protocol
errors and transient retry policy. Refusal does not retain candidate evidence or
refetch on identical viewport telemetry. Unrelated subscription changes do not
clear the diagnostic. New demand and explicit Retry/Refresh can retry; protected
visible work and expansion intent are never silently evicted to claim success.

These are accounted estimates, not strict JavaScript heap measurements. Adapters
must enforce negotiated decoded-response limits; rejecting an already decoded
object cannot undo transport allocation. Provider decode buffers and validation
copies can coexist transiently inside the ingress boundary.

## Summaries and provenance

`requestSummary("filtered" | "all")` requests accepted-version server totals.
`getSnapshot().getSummary(scope)` returns explicit ready, unavailable, loading or
error state. Ready summaries preserve scope, session/query/result identity,
registry version, aggregate keys, `aggregateDefinitionKey`, completeness and
server authority. A ready summary may contain an individually failed aggregate;
neither failed nor unavailable values become zero. Numeric zero remains a ready
value. No totals are computed from resident pages.

All-scope requests require the provider's same-version base-dataset capability;
unavailable support stays unavailable without provider calls or cached-total
fallback. Identical query reuse leaves answers intact; definition/registry
changes and late old-session answers cannot contaminate the new view. Collapse
and child payload loading do not recompute server totals.

## Verification and remaining performance work

Tests use core's deferred reference transport (ignored abort by default), never
importing website code. Coverage includes billion-row sparse extents with fixed
residency, distant branches, immutable snapshots, empty roots, eviction/refetch,
source/auth and invalid-query transitions, retired views, reentrant sizing,
ignored-abort ingress, late-open release, scoped revocation after parent eviction,
capacity/no-amplification, bounded errors/subscriptions, summary scopes/definitions,
public inference and pure synchronous observation.

Planning currently rebuilds bounded candidate maps and may repeat preparation
while removing cold blocks. SparseIndex resolution rebuilds bounded topology;
publication creates a fresh sparse index. These are correctness-first algorithms,
not an 8 ms claim. Incremental planning/index construction, viewport geometry,
renderer metrics and measured performance gates remain Task 9. This task does
not claim a completed remote grid feature or unlimited browser scroll height.

Verified with Node 24.20.0 and pnpm 10.12.1:

- `pnpm --filter @pretable/core test src/remote/__tests__ --maxWorkers=1`:
  272 tests passed across nine files, including all 235 pre-Task-8 remote tests.
- `pnpm --filter @pretable/core test --maxWorkers=1`: 289 tests passed across
  thirteen files, including the unchanged local core tests.
- Core `typecheck`, `lint`, `build` and `api:check`: passed.
- `tsc -p type-tests/tsconfig.json --noEmit` and
  `tsc -p type-tests/tsconfig.react.json --noEmit`: passed.
- Public API forgotten-export checks: all five tests passed.
- `git diff --check`: passed.

API declarations and core/React consumer type tests cover the new factory
without changing existing local model signatures. Renderer and website suites
were not rerun because this task does not alter those implementations.
