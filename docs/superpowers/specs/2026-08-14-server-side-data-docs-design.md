# Server-side data — docs section

Status: approved · 2026-08-14

Gives pretable's server-controlled data surface a documented home. The engine
has shipped it across five merged slices; the docs describe roughly a fifth of
it, in two paragraphs on a page about a different subject, hedged as
"experimental".

## The gap

`@pretable/react` exports the following as `@public`, locked behind
api-extractor:

| Surface                                            | Docs today                                                 |
| -------------------------------------------------- | ---------------------------------------------------------- |
| `PretableProcessingOptions` / `…Authority`         | two paragraphs on `grid/pretable-surface.mdx`              |
| `PretableDataState` (six phases)                   | one paragraph, one example                                 |
| `PretableResultMeta.total` / `PretableMatchingTotal` | one line inside a code fence, unexplained                  |
| `PretableResultMeta.datasetKey`                    | one paragraph                                              |
| `PretableQueryOptions` notify-only arm (#374)      | **none** — `grid/pretable-component.mdx` has zero mentions |
| `resolveDataScope` / `DataHonestyInput`            | **none** — used in `grid/export.mdx:36` with no prose      |
| `PretableBodyStateKind` / `renderBodyState`        | one clause                                                 |
| `PretableTelemetry`                                | a fence that is **wrong** (see § Drift)                    |

There is no nav section. A reader who needs server-applied filtering has no
path to any of it that does not begin with already knowing it exists.

## Scope

**In:** processing authority, query ownership including the notify-only arm,
the `dataState` lifecycle and `renderBodyState`, `datasetKey`, matching totals,
and export/count honesty. Prefix paging (`loading-more`, appending to `rows`)
is in — it is the `window.start === 0` case.

**Out:** `PretableResultMeta.window` at a nonzero start, and eviction. Both are
blocked on the defect in
`docs/superpowers/specs/2026-08-15-window-coordinates-design.md` (branch
`blove/window-scroll-coordinates`): a windowed grid at any nonzero offset
renders blank. The overview page says in one sentence that these are not
documented yet, so their absence reads as deliberate rather than as an
omission.

## Design

### 1. The section

`/docs/server-data`, nav title **Server-side data**, between **Grid** and
**Headless engine** in `apps/website/app/docs/_nav.ts`.

| Page                   | Slug                | Contract                                                                                                                                                                    |
| ---------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview               | `index.mdx`         | What the grid owns vs what the consumer owns. The grid never fetches. The endpoint contract used by every example on the section. The out-of-scope sentence.                 |
| Query ownership        | `query-ownership.mdx` | `processing` as create-time authority; the three arms of `PretableQueryOptions`; why partial ownership is a compile error; which props `<Pretable>` accepts.                |
| Loading, staleness, errors | `lifecycle.mdx` | All six `PretableDataState` phases; `PretableBodyStateKind`'s four kinds and `renderBodyState`; the error-strip rule; `datasetKey` as the identity fence.                     |
| Totals and honesty     | `totals.mdx`        | `PretableMatchingTotal`'s three kinds and their effect on counts and scroll extent; `resolveDataScope` and why an export over externally-filtered data says `loaded`.        |

Each page leads with a live example, per the standard set in #395.

### 2. `POST /api/docs/rows`

A docs-owned Next route, with its dataset in a sibling module. Independent of
PR #410's `POST /api/rows`, which is an e2e fixture: fixed dataset, no latency,
no failure path, `total` always exact. The two serve different jobs and neither
constrains the other.

```ts
// request
{ query: { filters, sort, rowGroups }, offset?, limit?, totalKind?, datasetKey? }
// response
{ rows, total: PretableMatchingTotal, datasetKey }
```

Four properties the examples require:

- **Real latency** (~500ms). Without it `loading` and `stale` are
  unobservable — the reason the existing `data-state-lifecycle` example
  scripts a 700ms delay.
- **Injectable failure**, keeping that example's convention: a filter value
  containing `fail` returns 500. This is what makes the error-strip rule
  demonstrable rather than asserted.
- **Variable total kind**, so one example drives exact, estimate, and
  `unknown` + `atLeast` through the same grid.
- **`cache-control: no-store`**, so one query change is one request.

Two consequences, both deliberate. Examples mount client-side, so every one
opens in `phase: "loading"` — the first paint *is* the loading block. And the
shown code contains a `fetch` to a route the reader does not have, so the
overview page prints the request/response contract above.

### 3. Existing pages

| File                                     | Change                                                                                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `apps/website/app/docs/_nav.ts`          | new section                                                                                                                         |
| `content/docs/grid/api-reference.mdx:72` | "The experimental `processing`…" becomes a pointer; hedge removed                                                                   |
| `content/docs/grid/pretable-surface.mdx` | § "Server-applied filtering and sorting" shrinks to a pointer; the `data-state-lifecycle` example moves to `lifecycle.mdx`          |
| `content/docs/grid/export.mdx:36`        | one paragraph explaining `resolveDataScope`, plus a link to `totals.mdx`                                                            |
| `content/docs/grid/pretable-component.mdx` | the four server props `<Pretable>` accepts (`processing`, `resultMeta`, `dataState`, `onQueryChange`), and that `renderBodyState` is not one |

### 4. Dropping "experimental"

`@experimental` sits in package source TSDoc, not only in docs prose:
`packages/grid-core/src/types.ts` (4 occurrences) and
`packages/react/src/data-state.ts` (2). **Six tags, not seven.**

A raw `grep` finds a seventh, on `PretableSurfaceSharedProps.state` in
`packages/react/src/pretable-surface.tsx`. It is not part of this surface —
it is the bench harness's plan-replay escape hatch, and its docblock still
reads "Shape may change across minor releases." It keeps its tag. Removing it
would leave a block that carries the warning without the marker.

It does not appear in the generated `.api.md` reports, so removing it produces
no API-report diff. It is a source-comment change plus a patch changeset.

Five merged slices, an api-extractor-locked `@public` surface, and e2e
coverage make the hedge inaccurate. Pre-1.0 already communicates that the whole
API can move.

### 5. Drift, and the guard that did not catch it

The `PretableTelemetry` fence on `grid/pretable-surface.mdx` is wrong today. It
omits `loadedRowCount` and `windowGap`, and types `focusedRowId` as
`string | null` where the report says
`TRowId | PretableGroupId | null`.

`apps/website/lib/docs/__tests__/docs-api-surface.test.ts` is 4159 lines and
contains no reference to `PretableTelemetry`, `PretableDataState`,
`PretableResultMeta`, `PretableProcessingOptions`, or
`PretableMatchingTotal`. The absence is the explanation: nothing was watching.

The fence gets corrected. `windowGap` is named with a one-line "used by
windowed datasets" and no further claim — documenting a field's existence is
not documenting the feature it belongs to.

Then every type the new section prints is registered with the guard:

- `PretableProcessingAuthority`, `PretableProcessingOptions`
- `PretableDataState` (discriminated union)
- `PretableMatchingTotal` (union)
- `PretableResultMeta`
- `PretableQueryOptions`
- `PretableBodyStateKind`
- `PretableTelemetry`
- `DataHonestyInput`, and `resolveDataScope`'s signature

**Each registration is mutation-tested**: edit the `.api.md` report, watch that
specific assertion fail, revert. A registration that cannot fail is worse than
none, because it reads as coverage.

## Verification

One e2e spec per example, in `apps/website/e2e`. Every assertion must be able
to fail:

1. Intercept the route and assert the **request count** changes when the query
   changes — not merely that rows appear.
2. Assert the `error` case leaves the **same row ids** on screen and the header
   still sortable — not merely that a strip exists.
3. Assert switching total kind changes the announced count **and** the resolved
   export scope, over a fixture where `all` and `loaded` are different numbers,
   so the assertion can distinguish them.
4. Gate every interaction on `data-pretable-hydrated` before the first click.

**There is a second docs guard**, missed when this spec was written.
`apps/website/lib/docs/__tests__/docs-links.test.ts` resolves every internal
link and fails on one pointing at no page. It goes red the moment a page links
to a section page that has not landed yet, and stays red until all four exist —
so a red `docs-links` naming only `/docs/server-data/*` targets is expected
mid-project and self-clearing. No link may be deleted to quiet it. It must be
green before the PR opens.

Plus: `pnpm build` before `pnpm api`, or a stale `dist/` silently strips
exports; the docs-api-surface guard must pass; the website e2e suite runs
against `next build` + `next start` with `--workers=1`.

## What must be true afterwards

1. A reader who needs server-applied filtering can reach every part of the
   contract from the docs nav.
2. Every fence on the four new pages, and the corrected `PretableTelemetry`
   fence, breaks the build when the `.api.md` report moves — demonstrated by
   mutation, not asserted.
3. Every page's example runs against the real endpoint and its e2e assertions
   fail when the behavior they name is removed.
4. No page claims anything about a window at a nonzero start, or about
   eviction.
