# Remote datasets: evidence and design implications

Date: 2026-11-19
Status: research supporting a draft, not a shipped API
Baseline: Pretable `0.21.0`, commit `14f0430d32279f283dcfcb6f09662225548fe4fd`
Related: [roadmap](../../ROADMAP.md), [draft design](../superpowers/specs/2026-11-19-remote-datasets-design.md)

## Scope and method

The user requires **server-side grouping in the first remote-data release**.
This supersedes a suggested flat-first scope. The comparison covers current
first-party documentation, selected first-party source, and Pretable's shipped
source/API reports. Sources were accessed on 2026-11-19. AG Grid documentation
identified version 36.3; MUI documentation identified 9.18; TanStack Query uses
its v5 documentation. Moving documentation is evidence at this date, not a
version-independent guarantee. No competitor performance benchmark, production
backend experiment, or complete competitor source audit was performed.

The source observations below are separate from proposed Pretable behavior.
The recommendation does not imply that competing products implement the same
consistency protocol or that every gap should become a roadmap commitment.

## Pretable baseline: reusable behavior and incompatible assumptions

| Evidence in this checkout                                                                                                                            | Shipped behavior                                                                                                                  | Consequence for remote grouping                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [Row-model types](../../packages/row-model/src/types.ts), `PretableVisibleRow` and `PretableRowModelSnapshot`                                        | Synchronous indexed snapshots contain materialized data or group rows; groups have numeric `childCount` and aggregate maps        | A missing slot, unloaded range, error, and end-of-data need explicit distinctions; do not reinterpret `undefined` or fabricate records |
| [Grid types](../../packages/grid-core/src/types.ts), `PretableProcessingOptions` and `PretableResultMeta`                                            | External authority covers filter/sort; one contiguous flat window has start/hasMore metadata                                      | There is no hierarchical datasource or managed cache contract yet                                                                      |
| [Data scope](../../packages/react/src/data-scope.ts), `resolveAriaRowCount`                                                                          | Dataset positions require external filter/sort and a valid exact total; grouping explicitly rejects flat population geometry      | Adding `processing.group` or a bigger total alone cannot enable grouped remote virtualization                                          |
| [React surface](../../packages/react/src/pretable-surface.tsx), window spacer construction                                                           | One leading and one trailing spacer surround the loaded window                                                                    | Multiple sparse sibling stores require a different projection into layout                                                              |
| [Eviction docs](../../apps/website/content/docs/server-data/eviction.mdx) and [indexed selection](../../packages/grid-core/src/indexed-selection.ts) | Flat eviction can retain focus, selections, measurements, and scroll anchors; memory policy is application-owned                  | Preserve those local/manual-mode guarantees, but do not reuse flat ranks across hierarchy changes                                      |
| [Selection tests](../../packages/grid-core/src/__tests__/indexed-selection.test.ts), equal-size replacement case                                     | Dataset key plus unchanged total cannot prove unchanged membership/order                                                          | Query identity and count are not sufficient result-version evidence                                                                    |
| [Grid UI core](../../packages/grid-core/src/create-grid-ui-core.ts), edit reconciliation                                                             | Editing clears when its row is absent                                                                                             | An editable remote model would need a draft/pinning/acknowledgement policy; it is not solved by caching alone                          |
| [Copy](../../packages/react/src/copy.ts) and [CSV](../../packages/react/src/csv.ts)                                                                  | Serialization consumes materialized snapshot rows                                                                                 | Sparse logical extent must not turn synchronous copy/export into an unbounded scan or implicit network traversal                       |
| [Summary contracts/resolver](../../packages/react/src/summary.ts)                                                                                    | Server answers use request and aggregate-definition keys, explicit completeness, and ready/stale/loading/error/unavailable states | Reuse this vocabulary for authoritative group aggregates and both grand-total scopes                                                   |

The public [core](../../packages/core/core.api.md) and
[React](../../packages/react/react.api.md) API reports must evolve together.
The supplied-model seam in `use-pretable.ts` is useful, but the existing
`PretableRowModel` also requires local mutation and derivation methods. A
transport adapter is not a drop-in implementation of that whole interface.

The [August server-controlled exploration document](../superpowers/specs/2026-08-09-server-controlled-exploration-design.md)
is historical and contains an older baseline plus another application's
requirements. Its deferred flat-window features must not be mistaken for
current gaps. The current consumer docs and source take precedence.

## Comparative evidence

Each row describes verified documentation, followed by our design inference.

| Primary source                                                                                              | Observed behavior                                                                                                                        | Implication for Pretable                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [AG SSRM configuration](https://www.ag-grid.com/javascript-data-grid/server-side-model-configuration/)      | Caches exist at root and grouping levels; stable IDs support refresh and selection                                                       | Address stores by route; a per-store block limit does not establish a global memory bound                          |
| [AG grouping](https://www.ag-grid.com/javascript-data-grid/server-side-model-grouping/)                     | Requests carry ordered grouping columns and group keys; grouping happens on the server                                                   | Request one sibling level at a time rather than downloading all leaves to regroup locally                          |
| [AG grouped pagination](https://www.ag-grid.com/javascript-data-grid/server-side-model-pagination/)         | Default pagination counts top-level rows; expanded children can remain on their parent's page                                            | Root pagination, branch page size, descendant records, and display rows are different quantities                   |
| [AG refresh](https://www.ag-grid.com/javascript-data-grid/server-side-model-updating-refresh/)              | Refresh can target a store route; stable IDs preserve state; purge has different semantics                                               | Specify refresh scope and state preservation rather than treating every refresh as replacement                     |
| [AG SSRM selection](https://www.ag-grid.com/javascript-data-grid/server-side-model-selection/)              | Selection rules can describe unloaded records; loaded selected-row objects are insufficient for header/group selection                   | Query-wide or subtree selection requires an explicit rule protocol; it is not a cache feature                      |
| [AG retry](https://www.ag-grid.com/javascript-data-grid/server-side-model-retry/)                           | Failed loads and explicit retry are supported                                                                                            | Preserve useful sibling results while retrying a failed range                                                      |
| [AG SSRM sorting](https://www.ag-grid.com/react-data-grid/server-side-model-sorting/)                       | Group and leaf sort behavior can differ; fully loaded groups can optionally sort locally                                                 | First Pretable remote release should keep one server authority and explicit sibling sort rules                     |
| [MUI Data Source](https://mui.com/x/react-data-grid/server-side-data/)                                      | Centralized requests, chunk caching, configurable TTL, refresh and errors                                                                | TTL controls freshness; it is not a hard row/byte capacity limit                                                   |
| [MUI nested lazy loading](https://mui.com/x/react-data-grid/server-side-data/lazy-loading/)                 | Current nested lazy loading supports grouping/tree data with upfront parent counts; unknown-count nested infinite loading is unsupported | Exact sibling counts offer a defensible first-release boundary; older pages claiming no nested support are stale   |
| [MUI server grouping](https://mui.com/x/react-data-grid/server-side-data/row-grouping/)                     | Group routes and children-count accessors describe nested queries                                                                        | Distinguish unknown children from zero; do not infer lazy-loading capabilities from the general grouping interface |
| [MUI server aggregation](https://mui.com/x/react-data-grid/server-side-data/aggregation/)                   | Root and parent responses can supply aggregate values independently of loaded children                                                   | Group aggregates must remain authoritative when only a subset of descendants is resident                           |
| [TanStack infinite queries](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries) | Page chains retain page parameters; `maxPages` bounds retained pages; refetch follows the retained chain                                 | Useful for sequential access, but not itself a sparse hierarchical random-access model                             |
| [TanStack cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)   | Query functions receive a signal; transport cancellation depends on consuming it                                                         | Abort saves resources; explicit response acceptance still enforces correctness                                     |
| [TanStack query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)             | Data-changing inputs belong in keys; ordered arrays retain order significance                                                            | Preserve sort/group order and include source/schema/authorization context in semantic query identity               |

AG SSRM and MUI's advanced grouped-data features are commercial capabilities.
This is an architectural comparison, not a recommendation to copy implementation
code or a licence-equivalence claim. Unpinned MUI source also showed request-ID
guards, but no design decision depends on those moving internal details.

## Pagination and result consistency

[PostgreSQL LIMIT/OFFSET](https://www.postgresql.org/docs/17/queries-limit.html)
requires predictable ordering for predictable subsets and notes the cost of
skipped offsets. [Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html)
distinguishes per-command snapshots from a transaction's consistent snapshot.
Neither turns independent HTTP calls into one read transaction.

[Exported database snapshots](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-SNAPSHOT-SYNCHRONIZATION)
have real lifetime constraints. A server token must correspond to enforceable
versioned reads or reject changed data; attaching a string to unrelated reads
is not snapshot support. A revision-fenced alternative must read its fence,
entries, counts and aggregates coherently, with every relevant write advancing
that fence; a separate pre-read check is insufficient. Pretable must not require
holding an unbounded database
transaction open for a browser session.

The [GraphQL Cursor Connections specification](https://relay.dev/graphql/connections.htm)
defines opaque cursors and directional traversal. It does not promise indexed
seeking, keyset implementation, retained snapshots, or a total count.

Our algorithmic examples:

- With rows A,B,C,D, page one A,B and an insertion X before A, a fresh
  offset-2 page returns B,C. Deleting A instead can skip C.
- A keyset boundary avoids offset movement before that boundary, but changing a
  record's sort/filter membership across the boundary can still skip or repeat
  it. Deduplicating IDs cannot recover a skipped record.
- Exact counts can stay unchanged while records exchange positions or one record
  replaces another. Count equality is not positional evidence.

Therefore both range and cursor traversal need a declared consistency contract.
For grouped reads, membership, sibling order, counts, and aggregate values must
share the same accepted result version. An HTTP [ETag](https://httpwg.org/specs/rfc9110.html#field.etag)
validates a representation; it is not automatically a multi-request snapshot.

## Addressing and geometry are separate problems

A server range addresses siblings within one route. It does not address the
client's flattened expanded tree. A cursor cannot seek an unseen ordinal merely
because the client knows the count. Variable heights introduce another separate
uncertainty: exact row positions do not imply exact unmeasured pixel positions.

The recommended first release uses range-addressable sibling stores and exact
immediate-child counts, collapsed-by-default expansion, a sparse projection,
and measured-height anchoring. Pure cursor-only navigation and unknown-count
branches need a separate capability/UI design. Do not silently walk an arbitrary
number of cursor pages to satisfy a distant scroll.

## Accessibility and interaction evidence

The [WAI-ARIA treegrid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treegrid/)
describes hierarchy, expansion, focus, and keyboard interaction.
[Grid/table properties](https://www.w3.org/WAI/ARIA/apg/practices/grid-and-table-properties/)
require coherent row counts and indices for virtualized content; unknown counts
can use `-1`. Counts include headers. A leaf total cannot substitute for the
number of rows in an expanded grouped display.

Proposal: placeholders remain presentation slots, not fabricated selectable
records. A navigation request into unloaded space gets a generation-scoped
pending target; loading never moves focus to the document body. Exact global
indices are exposed only when the expanded projection is provable. Screen-reader
speech must be tested, not inferred from valid DOM attributes alone.

## Live-update boundary

[WHATWG Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
provides event IDs and reconnection mechanics, not durable replay or exactly-once
application. [PostgreSQL logical decoding](https://www.postgresql.org/docs/18/logicaldecoding-explanation.html)
illustrates a related snapshot/log handoff and duplicate-delivery considerations;
it does not supply a browser grid's query-membership protocol.

Live grouping later needs authoritative membership moves, sibling reranking,
ancestor counts/aggregates, and an atomic bootstrap/resume boundary. Sequence gaps
are meaningful only under the provider's stated sequence model: filtered global
log offsets can legitimately skip. Start any future live work with invalidation
and coherent refresh, then add incremental patches only with a replay oracle.

## Recommended direction and evidence limits

Build a transport-neutral grouped remote read model, with a bounded scheduler
and cache, explicit sparse slots, and shared rendering/interaction contracts.
Keep the existing local and application-managed paths supported. Use the server
summary vocabulary already shipped in `0.21.0`.

Product decisions confirmed on 2026-11-19 narrow this recommendation to read-only
grouped browsing with range access and exact immediate-child counts, a consistent
result with explicit Refresh, and selection retained within an accepted result
session but cleared on Refresh or query changes. A backend revision token alone
is not a selection scope: different queries may share the same revision. Header
select-all covers loaded leaves in the expanded view, never unseen records.
Full-result server CSV export is also confirmed for this release: all matching
leaf records from the viewed result version in server group/sort order, including
collapsed and unloaded branches. This requires a separate server export path,
not repeated browser range reads; the export-job contract remains a design
recommendation requiring provider conformance evidence.

This research establishes design constraints, not measured performance or an
approved public API. Backend adapter feasibility, variable-height sparse layout,
assistive-technology behavior, cache admission limits, and public API compatibility
need focused prototypes and conformance tests before implementation approval.
