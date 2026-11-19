# Task 7: remote cache admission and retention

`RemoteCache` in `packages/core/src/remote/cache.ts` is an internal, standalone
admission owner. It is not yet wired into the session controller, scheduler,
sparse index, or renderer. Task 8 must complete that composition before claiming
that the controller has bounded retention. Existing window/local APIs are unchanged.

## Guarantees and charging model

One owner shares limits across at most two generation scopes (current and
retiring, including a pending new root). Scope identities are accepted-generation
safe integers. Payload addresses use the existing typed `PretableRemoteRoute`,
including column identity and scalar key type, validated by
`canonicalRemoteRoute`; display labels or lossy string coercion are unsupported.

Default limits:

| Resource                         | Limit                            |
| -------------------------------- | -------------------------------- |
| Retained payload entries         | 5,000                            |
| Retained accounted payload bytes | 32 MiB                           |
| Ingress reservation bytes        | 32 MiB total, 8 MiB per response |
| Store objects                    | 256                              |
| Required topology nodes          | 8,192                            |
| Address route depth              | 32                               |
| Expansion overrides              | 2,048                            |
| Selected IDs                     | 10,000                           |
| Cell ranges                      | 32                               |
| Height measurements              | 100,000                          |
| Accounted metadata bytes         | 8 MiB                            |

Overrides must be nonnegative safe integers; response size and depth must be
positive. A zero cap disables admission for that resource. Effective capacity is
the intersection of count and byte limits: 100,000 measurements are not promised
to fit inside every metadata configuration. SparseIndex separately checks
ancestry/depth and includes its implicit root in its topology cap; composition
must charge that root here too.

Each retained object/block is one record. Payload `entries` and `bytes` are
explicit nonnegative safe estimates supplied by the adapter. Overlapping blocks
are charged independently for actual retained objects; there is no logical-row
allocation or overlap discount. Payload costs must include frozen row copies and
retained acceptance/overlap evidence. The adapter must include other nested
metadata, IDs, keys, and non-payload value costs in `metadataBytes`.

The owner additionally charges 64 accounted bytes per record, 64 per generation
scope, 64 per ingress lease, two bytes per record-key code unit, two bytes per
JSON-encoded internal identity code unit (including escape expansion), and typed
route storage (32 per address, 48 per segment, column/string-key code units at two
bytes each, eight for scalar keys). These are explicit accounting estimates,
not JS engine object-size or process-heap measurements. Costs must be finite safe
integers; overflow or an invalid transaction rejects without changing state.
No sizing callback runs during commit. Values must be immutable after admission.

Metadata records use separate `store`, `topology`, `expansion`, `selection`,
`cellRange`, `measurement`, and `external` categories. `external` charges permit
Task 8 to account scheduler queue/subscriber keys and other externally owned
metadata; this owner does not currently own those objects. Required topology,
expansion, selection, cell ranges, and external records never silently evict.
New intent is refused when its cap is exhausted, preserving existing intent.
Store objects can evict without discarding topology or collapse/selection intent.

Payload eviction drops unprotected prefetch first, then overscan, then cold LRU.
`protect` marks visible/focused/ancestor records; the adapter computes those
relationships and updates protection before admission. `touch` explicitly
updates recency; observation through `get` does not. Measurement records have an
independent count cap and LRU within the shared metadata cap. Eviction makes a
height unknown, permitting renderer reestimation and anchor correction; wiring
that invalidation is Task 8. No renderer change is made here.

## Transaction and lifecycle contract

Call `snapshot().epoch` before external sizing hooks. Pass that `expectedEpoch`
with a batch of records, explicit drops, and optional `releaseScopes` to
`prepare`. It returns either a value-free refusal reason or a one-shot plan.
The plan contains sensitive exact eviction addresses for the adapter only; never
log it. Successful preparation does not publish anything or release the old body.
Only the latest successful preparation can commit. `discard(plan)` releases an
unused preparation. Every mutation invalidates preparations, including scope
closure, so historical prepared bodies do not survive source/auth cleanup.

`commit` verifies owner and epoch and swaps accounting/records synchronously,
without callbacks or notifications. Refused batches and replacements preserve
all prior state. Prepared candidates and copied maps are temporary admission
work; the caller must commit/discard promptly while retaining its ingress lease.
Caller-retained plans, immutable payload references, or older published session
snapshots are consumer-owned retention outside admitted totals.

Task 8 must prevalidate all participants, then commit and synchronously apply the
plan's exact evictions to `session.evictRange`/acceptance-evidence release before
notifying observers. Replacement also lists its old record as an eviction.
Do not evict an overlapping block's evidence while another retained block still
needs it: use aligned non-overlapping ownership or explicit reference accounting
in the adapter. There must be one retention authority, not independent cache and
validator payload caches. Forgotten consistency evidence is enforced by the
server's accepted-session/version guarantees. Provider validation needs staged
acceptance so a failed cache admission cannot publish validator history.

`releaseScopes` is an explicit atomic new-root fallback: it can release an old
protected body if both views cannot fit, with the new root admitted in the same
plan. Keep presentation intent outside the released body scope and apply the
query/selection policy explicitly. Scope close/drop remove exact owned records;
they retain no eviction history. Source replacement, authorization changes, and
disposal must clear session snapshots, evidence, topology, and scheduler owners
at the same boundary, in addition to closing cache scopes.

## Ingress, diagnostics, and retry obligations

Reserve an ingress lease **before physical provider invocation**, using a bound
that the transport actually enforces on decoded responses. The provider contract
still defaults to 100 siblings per request and permits at most 1,000; those row
limits do not bound row bytes. The cache's per-response limit caps reservations,
not arbitrary already-decoded provider objects. Streaming/body decoding must
stop at the negotiated limit. Raw decode buffers and validated frozen copies may
coexist transiently; account for those peaks in the adapter/transport. Owned
payload and incoming response reservations are deliberately separate budgets.

Abort/caller cancellation/scope closure does not release ingress. Release only
after the physical operation settles and the response has been accepted or
fully discarded, including late authorization handling. `releaseIngress` is
idempotent and reports whether capacity changed; Task 8 should then wake blocked
admission/dispatch once. It must add the scheduler admission/wake hook rather
than turn refusal into repeated provider invocations or a busy loop.

A protected candidate that cannot fit returns `minimum-visible-too-large`.
Other refusals distinguish payload, metadata, intent, invalid cost, stale plan,
and unknown scope. Diagnostics/snapshots contain only counts, epochs, and reasons,
never protected IDs/keys. No refusal stores a candidate/request history, enqueues
I/O, retries, or refetches. Task 8 must surface minimum-visible capacity failure
and retry only after a meaningful viewport/configuration change. Repeated
identical failures alone are not a retry trigger.

## Verification and performance boundary

Tests cover independent payload byte/entry pressure, two-scope sharing, LRU and
priority, protected minimum-visible failure, atomic replacement, exact disposal,
retiring-body release, finite/safe limits, oversized IDs/routes/escaped keys,
zero-cost metadata attacks, ingress lifetime and bookkeeping, intent refusal,
measurement eviction, stale/foreign/reused/discarded plans, reentrant/throwing
preparation, external snapshots, and sparse topology surviving store eviction.

Preparation copies/scans bounded retained maps and sorts eviction candidates:
O(N log N) worst case, with linear subtraction for eviction accounting. There is
no per-candidate full-map recount. Snapshot/reservation metadata checks scan the
retained map; touch/get/drop are map operations. This is a correctness prototype,
not an 8 ms performance claim. Incremental accounting, cheaper planning, and
scheduled cost gates remain Task 9.

Verified on Node 24.20.0 / pnpm 10.12.1:

- `pnpm --filter @pretable/core test src/remote/__tests__ --maxWorkers=1`:
  233 tests passed across seven files (25 cache/sparse tests).
- `pnpm --filter @pretable/core typecheck`: passed.
- `pnpm --filter @pretable/core build`: passed.
- `pnpm --filter @pretable/core lint`: passed.
- `git diff --check`: passed.

No renderer tests were rerun because this task does not change renderer code.
