# Reference provider feasibility — Task 3

The orders adapter is a **small in-process backend fixture**, not deployed storage.
It has no HTTP routes, server actions, browser integration, export jobs, or durable
Next.js module-global state. Each explicit provider instance owns its bounded
resources. No database transaction remains open across requests.

## Captured result and authorization

`dataset.ts` owns copied, frozen orders and a monotonically advancing revision.
Every replacement (including equal-size delete/insert and group moves) advances
that revision. The fixture has a fixed trusted `orders` source and `demo` principal;
the query's `authScope` is an identity, not a credential. Only rows authorized for
that principal enter the snapshot. The deliberately private tenant row never
contributes to ranges, counts, exports or all-scope totals.

Opening validates against a private server registry even if the public advisory
capabilities have been modified. The backend accepts only schema `1`, registry
`orders@1`, locale `en`, and `binary@1`. Registered operations are exact text
equality/substring, numeric equality/greater-than/greater-than-or-equal, emptiness,
nested AND/OR, and case-sensitive search over ID, region and customer label.
Mixed typed customer keys support emptiness filters only. The sole aggregate is
`amount.sum@1` on amount (null amounts contribute zero). Unsupported semantics
fail explicitly. Projection controls returned leaf fields; tenant is never exposed.

Each immutable session captures both the filtered leaf population and its
authorized unfiltered base population from one source read. Thus `filtered` and
`all` summaries are explicitly `same-version`; neither uses resident pages or
latest data. Definition keys, server authority and complete state accompany
aggregate answers. Ranges carry query/session/token and route provenance.

Sessions and result tokens have separate identities. Two queries opened at the
same source revision may share a token but have distinct session IDs and query
keys. Random instance namespaces prevent handles from aliasing another provider's
resources. Returned payloads and captured queries are copied defensively.
Source or authorization revocation denies all accesses and clears retained
resources with a value-free `unauthorized` session error.

## Ordering and coherent fence

`evaluate.ts` separates bounded query/tree evaluation from provider resource
lifecycle. It computes exact immediate-child and descendant-leaf counts, typed
canonical group/leaf IDs, complete group aggregates, and half-open ordinal ranges.
Null placement is independent of direction. `binary@1` orders numbers before
strings before booleans; strings use code-unit order. Stable canonical identity
breaks sort and aggregate ties. Duplicate display labels do not merge keys.

The revision-fence mode checks the accepted revision and computes the complete
response within one synchronous source operation. Deterministic before/after-read
hooks permit writes only outside that operation. A changed fence returns `expired`,
including for exports and summaries; it never silently reads latest data. This
means coherent stale views can remain visible until explicit Refresh. It does not
claim that a newer revision makes an old immutable answer contradictory.

## Export feasibility

`captureExport` is a backend-only feasibility helper. It creates a counted copy
of every filtered leaf, in complete group/sibling/leaf order, from the accepted
query/token. It does not call range APIs or depend on browser expansion or loaded
branches. An immutable result can be copied after source mutation. A fenced
result must still match its revision during capture; capture and fence check are
atomic. Once copied, subsequent source mutation or session release cannot change
the export. The capture has its own TTL, identity, quota accounting and release.
Reads still enforce source/auth revocation. There is no browser whole-result
gathering path: `readExport` is a fixture assertion seam, not a download API.

This proves that the later export adapter can retain the viewed version without
an indefinite transaction. It does **not** implement CSV serialization, formula
protection, excluded/custom export columns, idempotent jobs, status/cancellation,
artifact delivery, or production retention. Those belong to Tasks 13/14 and the
application's durable authorized job/artifact store. The backend must authenticate
each real request and provide atomic database reads or durable snapshots across
processes; this single-process fixture cannot supply those guarantees.

## Explicit bounds and diagnostics

- Source default maximum: 1,000 rows, enforced on construction and replacement.
- Provider default retention: 16 combined sessions/export copies, 5,000 retained
  rows counted across snapshots/copies, and 60 seconds per resource.
- Range maximum: 100 siblings. Query grouping maximum: two levels.
- Resource/row exhaustion returns typed `transient`; callers must release resources
  or wait for expiry. Constructor/source-fixture misuse throws before publication.
- Expired, unknown, released or invalidated sessions return typed `expired`.
  Forged provenance and malformed ranges return `invalid-query`.
- TTLs never slide on reads. Expiry is checked and storage swept on every operation;
  an idle instance has no cleanup timer, but fixed quotas bound retained memory.
- Cancellation is checked before and inside the atomic operation and settles with
  `cancelled`. Operations have no asynchronous work/listeners left behind. Once a
  synchronous operation completes, later abort cannot retroactively undo it.

These are fixture row/resource limits, not production byte quotas or large-data
performance claims. Queries may materialize the bounded full dataset server-side.

## Observed checks

Website tests import changed website source directly and the built public
`@pretable/core` package (there is no test alias). Coverage includes independent
expected ordering, typed duplicate labels, exact ranges/counts, filtered/all
totals, projection, empty results, same-token different queries, immutable reads
and captures after writes, equal-size replacement/group moves, atomic hook
boundaries, invalidated latest traversal, export retention after session release,
TTL/quota reclamation, cancellation, namespaces, revocation and registry validation.

The core test-only fixture independently supplies deferred open/read/summary
responses, including abort-ignoring out-of-order completions, for later controller
conformance. It imports no website code and is not a public runtime export.

Verification on 2026-11-19 (Node 24.20.0):

- `pnpm --filter @pretable/core build` — passed; website tests used this fresh build.
- `pnpm --filter @pretable/app-website exec vitest run --environment jsdom lib/remote-demo/__tests__/provider.test.ts --maxWorkers=1`
  — 18 tests passed.
- `pnpm --filter @pretable/core exec vitest run src/remote/__tests__ --maxWorkers=1`
  — 71 tests passed, including 2 new controlled transport fixture tests.
- Core and website `typecheck` — passed.
- Targeted ESLint and Prettier checks on all Task 3 TypeScript files — passed.

Red runs preceded implementation for the provider and deferred fixture. A later
boundary regression reproduced a null-query throw; validation now returns a typed
diagnostic without invoking accessors. Fence-invalidation tests also failed with
the old `consistency` diagnostic before the correction to `expired`.
