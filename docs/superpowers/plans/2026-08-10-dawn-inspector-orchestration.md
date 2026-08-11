# Dawn Inspector Browse Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Dawn Inspector's memory browse an honest data lifecycle — desired/fulfilled query revisions with whole-response stale suppression, single-flight arbitration, head-anchored refresh reconciliation, per-kind failure slots with retry, and pause/resume — and surface it through Pretable 0.3.0's `dataState`/`resultMeta`.

**Architecture:** Three pure modules (`canonical-query`, `browse-reconcile`, `browse-machine`) hold every rule that can be tested without React; a thin `useMemoryBrowse` hook binds that machine to `AbortController`, `fetch`, timers and tab visibility. `ListPage` stops polling the list through `usePolling` (which documents its own last-write-wins hole) and reads the hook instead, while `usePolling` keeps driving stats. `MemoryGrid` gains `dataState`/`resultMeta` and switches to external filter/sort authority so the grid's `matchingTotal` is the server's, not a local recount.

**Tech Stack:** TypeScript 7, React 19, Next 16 (app router, client components), vitest 4 + jsdom + @testing-library/react, `@pretable/{core,react,ui}@0.3.0`, `@dawn-ai/memory/browse` (pure subpath), Tailwind 4, biome, changesets.

---

> **Pretable 0.3.0 carries a breaking change that this work depends on.**
> `#293 fix!: require getRowId everywhere` makes `getRowId` **required** and
> drops its `index` parameter — the signature is now `(row: TRow) => string`.
> Dawn's Inspector already passes a compatible `rowIdOf(row)`, so no source
> change is needed. It matters here for a different reason: #293 fixes
> *"selection silently moves from row b to row c when the row array is replaced
> in a different order (external sort / streaming)"* — which is precisely what
> external sort authority does on every sort change. Pinning 0.3.0 is a
> correctness requirement for this work, not version hygiene.


## Read this before you touch anything

**These traps cost real time in slices 1 and 2. They are not hypothetical.**

1. **`origin/main` moves under you.** It moved 5+ times mid-execution during slice 2. **Never cite a line number as an anchor — locate every edit by SYMBOL** (`grep -n "export function ListPage"`), and re-read a file immediately before editing it.

2. **The local `main` checkout in `/Users/blove/repos/dawn` is STALE.** At the time this plan was written it sat at `36aba5b3` while `origin/main` was at `8398c908` (slice 2, PR #453). `git fetch origin` and branch from **`origin/main`**, never from local `main`. If `packages/memory/src/types.ts` does not contain `readonly filters?: readonly BrowseFilter[]`, you are on the wrong commit — stop and re-fetch.

3. **A types-only assertion is INVISIBLE to `vitest run`.** esbuild strips types before the test runs, so `expectTypeOf` / `satisfies` / a deliberately-wrong type argument is green in vitest and red only under `tsc`. Every task in this plan ends with a `typecheck` run for that reason. Do not skip it.

4. **A pass from a stale `dist/` or a turbo cache hit is not a pass.** This plan's new modules import `@dawn-ai/memory/browse`; the jsdom vitest project aliases that subpath to *source*, but `tsc --noEmit` resolves it through `node_modules` to `dist/browse.d.ts`. Slice 2 is brand new, so **build `@dawn-ai/memory` before your first typecheck** (Task 1) or you will typecheck against a `BrowseQuery` that has no `filters`.

5. **NEVER `git stash`.** The stash stack is shared across every worktree on this machine; a parallel session's `pop` will steal your entry. Commit, or write a patch file.

6. **This machine runs concurrent sessions at load 55–160.** A vitest timeout at the 5 s default is usually load, not a bug. Re-run the single file with `--testTimeout=30000` before believing a failure.

7. **Check for parallel sessions between tasks.** Re-run `git fetch origin && git log --oneline -3 origin/main` at the start of each task, not just once at the beginning.

### Three scope judgments baked into this plan (a reviewer should check these)

- **Pretable is pinned to `0.3.0` for all three packages, not `core@0.1.0`.** The published `@pretable/react@0.3.0` declares `dependencies: { "@pretable/core": "0.3.0", "@pretable/ui": "0.3.0" }`. Pinning core to `0.1.0` would install two copies of the engine and break every `instanceof`/module-identity assumption. Verified with `npm view @pretable/react@0.3.0 dependencies`.

- **`processing: { filter: "external", sort: "external" }` plus `sortable: false` on the browse columns.** `@pretable/core`'s `setResultMeta` **ignores `meta.total` and emits a dev warning** unless filter authority is `"external"` (see `SUPPLIED_TOTAL_WARN_MESSAGE` in `packages/grid-core/src/create-grid-core.ts`), so external filter authority is a hard requirement for the honest total this slice exists to display — and it is already truthful, because status/kind funnels are translated into `status=`/`kind=` request params today. Leaving *sort* on `"engine"` would then trip `warnOnEngineSortOverPartialWindow` ("presents the wrong SAMPLE, not just the wrong order"), and setting sort to `"external"` without sending `orderBy` would render a header arrow that does nothing. Disabling the sort affordance for one slice is the only honest third option; the slice that sends `orderBy` turns it back on. Search results keep the sortable columns (a search group is a complete set, so local sort is honest there).

- **The namespace facet sends the exact `namespace` param and the client-side post-filter is deleted.** `namespace` is neither `filters`, `orderBy`, nor `cursor` — the request shape restriction is untouched — and the shipped route already parses it (`packages/inspector/src/store/browse-params.ts`). Without this, `BrowsePage.total` describes a *prefix*-scoped set while the rows on screen are *exactly*-scoped, and "N loaded of M matching" would be a lie the moment a facet is clicked.

### What is deliberately NOT in this slice

`filters` / `orderBy` / `cursor` in the request (keyset paging stays out; refresh and load-more use `offset`). No load-more **control** in the UI — `loadMore()` exists on the hook and is tested there, because flow 5 belongs to the next slice. No view-switch mount retention (flow 10). No search-control disabling (§8.2). No bulk-selection-pruning semantics (flow 11).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/inspector/package.json` | **Modify** — bump `@pretable/core`, `@pretable/react`, `@pretable/ui` from `0.0.8` to `0.3.0`. |
| `packages/inspector/src/browse/canonical-query.ts` | **Create** — the canonical browse query: normalization, `datasetKeyOf`, the matches-nothing rule, and `URLSearchParams` construction. Pure. |
| `packages/inspector/src/browse/browse-reconcile.ts` | **Create** — the pinned default-order comparator, `dedupeById`, and head-anchored refresh reconciliation rules 1–3. Pure. |
| `packages/inspector/src/browse/browse-machine.ts` | **Create** — the orchestration state machine: revisions, single-flight arbitration, phase derivation, per-kind error slots. Pure, framework-free. |
| `packages/inspector/src/browse/use-memory-browse.ts` | **Create** — React binding: `AbortController`, `fetch`, the 2 s poll timer, tab visibility, unmount. |
| `packages/inspector/src/components/memory/browse-chrome.tsx` | **Create** — per-source error banners with a retry control, and the counts/freshness status bar. |
| `packages/inspector/src/components/memory/memory-grid.tsx` | **Modify** — accept `dataState`/`resultMeta`/`emptyMessage`/`onRetry`; external processing authority, non-sortable browse columns, lifecycle messages, body-state slot. |
| `packages/inspector/src/components/memory/list-page.tsx` | **Modify** — replace the list `usePolling` with `useMemoryBrowse`; keep `usePolling` for stats; exact-namespace request; per-kind banners; wire the grid. |
| `packages/inspector/test/components/browse-query.test.ts` | **Create** — canonical query + dataset key + params. |
| `packages/inspector/test/components/browse-reconcile.test.ts` | **Create** — comparator, dedupe, reconciliation rules 1–3. |
| `packages/inspector/test/components/browse-machine.test.ts` | **Create** — flows 1, 2, 4, 6, 7, 8, 9 at the reducer level, plus the phase table. |
| `packages/inspector/test/components/use-memory-browse.test.tsx` | **Create** — abort, revision gate under real promises, poll cadence, pause/resume, unmount. |
| `packages/inspector/test/components/browse-lifecycle.test.tsx` | **Create** — ListPage integration: loading/empty/error blocks, honest total, retry, banner independence. |
| `packages/inspector/test/components/list.test.tsx` | **Modify** — two facet tests move from `namespacePrefix` to `namespace`. |
| `packages/inspector/test/components/memory-grid.test.tsx` | **Modify (Task 1)** — the two row-activation tests arrange focus directly instead of walking in from the header, which `0.3.0` no longer allows. |
| `.changeset/inspector-browse-orchestration.md` | **Create** — patch changeset for the fixed version group. |

---

### Task 1: Worktree, dependency bump, and a trustworthy baseline

**Files:**
- Modify: `packages/inspector/package.json`
- Modify: `packages/inspector/test/components/memory-grid.test.tsx`

- [ ] **Step 1: Create a worktree off `origin/main`**

```bash
cd /Users/blove/repos/dawn
git fetch origin
git worktree add .worktrees/inspector-browse-orchestration -b blove/inspector-browse-orchestration origin/main
cd /Users/blove/repos/dawn/.worktrees/inspector-browse-orchestration
git log --oneline -1
```

Expected: the tip commit is `8398c908 feat(memory): a real query language for browse (#453)` **or newer**. Every command from here runs from `/Users/blove/repos/dawn/.worktrees/inspector-browse-orchestration`.

- [ ] **Step 2: Confirm slice 2 is actually present**

```bash
grep -c 'readonly filters?: readonly BrowseFilter\[\]' packages/memory/src/types.ts
grep -c 'export function parseBrowseQuery' packages/inspector/src/store/browse-params.ts
```

Expected: `1` and `1`. If either prints `0`, you are on a pre-slice-2 commit — go back to Step 1.

- [ ] **Step 3: Bump the three Pretable pins**

In `packages/inspector/package.json`, replace the three `0.0.8` pins inside `"dependencies"`:

```json
    "@pretable/core": "0.3.0",
    "@pretable/react": "0.3.0",
    "@pretable/ui": "0.3.0",
```

Leave every other dependency untouched.

- [ ] **Step 4: Install and build the workspace dependencies**

```bash
pnpm install
pnpm turbo run build --filter @dawn-ai/inspector...
```

Expected: install resolves `@pretable/core@0.3.0`, `@pretable/react@0.3.0`, `@pretable/ui@0.3.0` (one copy of each — `pnpm why @pretable/core` must list a single version), and the build succeeds. The build is what makes `@dawn-ai/memory/browse` resolvable to a `dist/browse.d.ts` that has slice 2 in it.

- [ ] **Step 5: Baseline the existing tests and types**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts
pnpm --filter @dawn-ai/inspector typecheck
```

Expected: typecheck is clean **on the bumped version** — the type surface only renamed unexported callback-input interfaces (`PretableSurfaceRowClassNameInput` → `PretableSurfaceRowInput`, etc.), and `MemoryGrid` names none of them.

The keyboard surface did change, and two tests in `memory-grid.test.tsx` fail because of it. **0.3.0 removed ArrowDown-from-header body entry**: the surface's keydown handler returns early for any target inside `[data-pretable-header-row]`, and the only way into the body is now Tab from a header button, which arms an origin that the rowgroup's `onFocus` matches against `event.relatedTarget`. Those two tests walked in from the header on their way to what they actually cover — `onRowActivate` reaching `onSelect` — so they were pinning pretable's traversal, not the Inspector's contract.

Fix them here, in this task, and do not weaken an assertion to do it: arrange focus on the target row directly (`fireEvent.pointerDown` on one of its cells moves grid focus without activating — a click would do both) and keep the `onSelect.mock.calls` assertions exactly as they are. Do not rebuild the header-Tab walk by hand; jsdom does not move focus on Tab, so that route only asserts the test's own emulation, and it needs the *last* of the header's eight tabbables, not the first. `@testing-library/user-event` is not needed and must not be added.

A red baseline poisons every later task — this must be green before Task 2 starts.

- [ ] **Step 6: Commit**

```bash
git add packages/inspector/package.json pnpm-lock.yaml
git commit -m "chore(inspector): pin @pretable/* to 0.3.0"
git add packages/inspector/test/components/memory-grid.test.tsx
git commit -m "test(inspector): activate rows from a focused row, not header traversal"
```

---

### Task 2: The canonical browse query

**Files:**
- Create: `packages/inspector/src/browse/canonical-query.ts`
- Test: `packages/inspector/test/components/browse-query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/browse-query.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  browseMatchesNothing,
  browseSearchParams,
  canonicalBrowseQuery,
  datasetKeyOf,
} from "../../src/browse/canonical-query"

describe("canonicalBrowseQuery", () => {
  it("uses null for unfiltered and keeps an empty set as itself", () => {
    const unfiltered = canonicalBrowseQuery({ view: "list" })
    expect(unfiltered).toEqual({
      view: "list",
      namespace: null,
      status: null,
      kind: null,
      since: null,
    })
    const nothing = canonicalBrowseQuery({ view: "list", status: [] })
    expect(nothing.status).toEqual([])
  })

  it("sorts and dedupes value sets so tick order cannot fork the dataset", () => {
    const a = canonicalBrowseQuery({ view: "list", status: ["superseded", "active", "active"] })
    const b = canonicalBrowseQuery({ view: "list", status: ["active", "superseded"] })
    expect(a.status).toEqual(["active", "superseded"])
    expect(datasetKeyOf(a)).toBe(datasetKeyOf(b))
  })

  it("defaults the timeline view to episodic, and lets the funnel override it", () => {
    expect(canonicalBrowseQuery({ view: "timeline" }).kind).toEqual(["episodic"])
    expect(canonicalBrowseQuery({ view: "timeline", kind: ["semantic"] }).kind).toEqual([
      "semantic",
    ])
    // An emptied funnel still means "matches nothing", not "fall back to episodic".
    expect(canonicalBrowseQuery({ view: "timeline", kind: [] }).kind).toEqual([])
  })

  it("gives a different key to every identity field", () => {
    const base = canonicalBrowseQuery({ view: "list" })
    const variants = [
      canonicalBrowseQuery({ view: "timeline" }),
      canonicalBrowseQuery({ view: "list", namespace: "route=/notes" }),
      canonicalBrowseQuery({ view: "list", status: ["active"] }),
      canonicalBrowseQuery({ view: "list", kind: ["semantic"] }),
      canonicalBrowseQuery({ view: "list", since: "2026-08-01T00:00:00.000Z" }),
    ]
    for (const variant of variants) {
      expect(datasetKeyOf(variant)).not.toBe(datasetKeyOf(base))
    }
  })
})

describe("browseMatchesNothing", () => {
  it("is true only for a set narrowed to nothing", () => {
    expect(browseMatchesNothing(canonicalBrowseQuery({ view: "list" }))).toBe(false)
    expect(browseMatchesNothing(canonicalBrowseQuery({ view: "list", status: ["active"] }))).toBe(
      false,
    )
    expect(browseMatchesNothing(canonicalBrowseQuery({ view: "list", status: [] }))).toBe(true)
    expect(browseMatchesNothing(canonicalBrowseQuery({ view: "list", kind: [] }))).toBe(true)
  })
})

describe("browseSearchParams", () => {
  it("sends the EXACT namespace, repeated enum params, and the window", () => {
    const params = browseSearchParams(
      canonicalBrowseQuery({
        view: "list",
        namespace: "route=/notes",
        status: ["active", "candidate"],
        kind: ["semantic"],
      }),
      { limit: 200, offset: 400 },
    )
    expect(params.get("namespace")).toBe("route=/notes")
    expect(params.get("namespacePrefix")).toBeNull()
    expect(params.getAll("status")).toEqual(["active", "candidate"])
    expect(params.getAll("kind")).toEqual(["semantic"])
    expect(params.get("limit")).toBe("200")
    expect(params.get("offset")).toBe("400")
  })

  it("omits absent narrowings entirely", () => {
    const params = browseSearchParams(canonicalBrowseQuery({ view: "list" }), {
      limit: 200,
      offset: 0,
    })
    expect(params.get("namespace")).toBeNull()
    expect(params.getAll("status")).toEqual([])
    expect(params.get("since")).toBeNull()
  })

  it("threads the pinned timeline window bound", () => {
    const params = browseSearchParams(
      canonicalBrowseQuery({ view: "timeline", since: "2026-08-01T00:00:00.000Z" }),
      { limit: 200, offset: 0 },
    )
    expect(params.get("since")).toBe("2026-08-01T00:00:00.000Z")
    expect(params.getAll("kind")).toEqual(["episodic"])
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-query.test.ts
```

Expected: FAIL — a module-resolution error naming `../../src/browse/canonical-query` (vitest phrases it "Failed to load url" / "Cannot find module"). It must be a resolution failure, **not** an assertion failure.

- [ ] **Step 3: Write the implementation**

Create `packages/inspector/src/browse/canonical-query.ts`:

```ts
import type { MemoryKind, MemoryStatus } from "@dawn-ai/memory/browse"

/** Which surface the records are being browsed for. Part of the dataset identity:
 *  timeline defaults the kind funnel to episodic, so the two views ask different
 *  questions and must never share a fulfilled result. */
export type BrowseView = "list" | "timeline"

/**
 * The canonical form of everything that decides WHICH records the server returns.
 *
 * `null` means unfiltered and `[]` means matches-nothing — the same distinction
 * `BrowseQuery` draws, kept rather than collapsed so an emptied funnel cannot read
 * as "show everything". Every field is present rather than optional, so the key
 * builder below can stringify a fixed field order with no optional-property hole.
 */
export interface CanonicalBrowseQuery {
  readonly view: BrowseView
  readonly namespace: string | null
  readonly status: readonly MemoryStatus[] | null
  readonly kind: readonly MemoryKind[] | null
  readonly since: string | null
}

/** Timeline is an episode view: the kind funnel still overrides, but with nothing
 *  ticked it asks for episodes rather than for everything. */
const TIMELINE_DEFAULT_KIND: readonly MemoryKind[] = ["episodic"]

/** Sorted and deduped, so two funnels that tick the same boxes in a different order
 *  produce ONE dataset key rather than two. */
function normalizeSet<T extends string>(values: readonly T[] | undefined): readonly T[] | null {
  if (values === undefined) return null
  return [...new Set(values)].sort()
}

export function canonicalBrowseQuery(input: {
  readonly view: BrowseView
  readonly namespace?: string | undefined
  readonly status?: readonly MemoryStatus[] | undefined
  readonly kind?: readonly MemoryKind[] | undefined
  readonly since?: string | undefined
}): CanonicalBrowseQuery {
  const kind = normalizeSet(input.kind)
  return {
    view: input.view,
    namespace: input.namespace ?? null,
    status: normalizeSet(input.status),
    // `[] ?? x` is `[]`, so an emptied funnel survives the timeline default intact.
    kind: kind ?? (input.view === "timeline" ? TIMELINE_DEFAULT_KIND : null),
    since: input.since ?? null,
  }
}

/**
 * The dataset identity. Two queries share a key exactly when they ask the same
 * question; any change bumps the desired revision, invalidates the loaded records
 * and the total together, and pivots the grid's `resultMeta.datasetKey`.
 *
 * The canonical JSON IS the key. A hash would only shorten a string that nothing
 * but `===` ever reads, and would buy a collision class in exchange — while an
 * unhashed key stays legible in a failing assertion.
 */
export function datasetKeyOf(query: CanonicalBrowseQuery): string {
  return JSON.stringify([query.view, query.namespace, query.status, query.kind, query.since])
}

/** A set narrowed to nothing matches nothing. Over HTTP a repeated param that
 *  appears zero times is ABSENT, so asking the server would come back unfiltered —
 *  the opposite answer. Callers must resolve this locally instead. */
export function browseMatchesNothing(query: CanonicalBrowseQuery): boolean {
  return query.status?.length === 0 || query.kind?.length === 0
}

/** One window of `query`, as the params `/api/memory/list` parses. */
export function browseSearchParams(
  query: CanonicalBrowseQuery,
  window: { readonly limit: number; readonly offset: number },
): URLSearchParams {
  const params = new URLSearchParams()
  // EXACT namespace, not `namespacePrefix`: a prefix answer and an exact total
  // describe different sets, and this UI displays the two side by side.
  if (query.namespace !== null) params.set("namespace", query.namespace)
  for (const value of query.status ?? []) params.append("status", value)
  for (const value of query.kind ?? []) params.append("kind", value)
  if (query.since !== null) params.set("since", query.since)
  params.set("limit", String(window.limit))
  params.set("offset", String(window.offset))
  return params
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-query.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: both clean. If typecheck reports that `@dawn-ai/memory/browse` has no exported `MemoryStatus`, `@dawn-ai/memory` is not built — run `pnpm turbo run build --filter @dawn-ai/memory` and retry.

- [ ] **Step 6: Commit**

```bash
git add packages/inspector/src/browse/canonical-query.ts packages/inspector/test/components/browse-query.test.ts
git commit -m "feat(inspector): canonical browse query and dataset key"
```

---

### Task 3: Refresh reconciliation and the pinned comparator

**Files:**
- Create: `packages/inspector/src/browse/browse-reconcile.ts`
- Test: `packages/inspector/test/components/browse-reconcile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/browse-reconcile.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  compareDefaultBrowseOrder,
  dedupeById,
  reconcileRefreshedWindow,
} from "../../src/browse/browse-reconcile"

/** A row carrying just the two fields the default order reads, plus a payload
 *  marker so "took the response's payload" is observable. */
function row(id: string, updatedAt: string, payload = "old") {
  return { id, updatedAt, payload }
}

describe("compareDefaultBrowseOrder", () => {
  it("orders updatedAt DESC then id ASC", () => {
    expect(compareDefaultBrowseOrder(row("a", "2026-08-02T00:00:00.000Z"), row("b", "2026-08-01T00:00:00.000Z"))).toBeLessThan(0)
    expect(compareDefaultBrowseOrder(row("a", "2026-08-01T00:00:00.000Z"), row("b", "2026-08-02T00:00:00.000Z"))).toBeGreaterThan(0)
    expect(compareDefaultBrowseOrder(row("a", "2026-08-01T00:00:00.000Z"), row("b", "2026-08-01T00:00:00.000Z"))).toBeLessThan(0)
    expect(compareDefaultBrowseOrder(row("a", "2026-08-01T00:00:00.000Z"), row("a", "2026-08-01T00:00:00.000Z"))).toBe(0)
  })

  it("breaks id ties on code units, so uppercase sorts before lowercase", () => {
    expect(compareDefaultBrowseOrder(row("Z", "t"), row("a", "t"))).toBeLessThan(0)
  })
})

describe("dedupeById", () => {
  it("appends only ids the resident set does not hold", () => {
    const prev = [row("a", "t"), row("b", "t")]
    expect(dedupeById(prev, [row("b", "t"), row("c", "t")]).map((r) => r.id)).toEqual(["a", "b", "c"])
  })

  it("returns the SAME array when nothing was added", () => {
    const prev = [row("a", "t")]
    expect(dedupeById(prev, [row("a", "t")])).toBe(prev)
  })
})

describe("reconcileRefreshedWindow", () => {
  it("rule 1: a resident row in the response takes the response payload AND position", () => {
    const resident = [row("a", "2026-08-03T00:00:00.000Z"), row("b", "2026-08-02T00:00:00.000Z")]
    // `b` was approved: hoisted above `a`, with a new payload.
    const refreshed = [row("b", "2026-08-04T00:00:00.000Z", "new"), row("a", "2026-08-03T00:00:00.000Z", "new")]
    const next = reconcileRefreshedWindow(resident, refreshed, 2)
    expect(next.map((r) => r.id)).toEqual(["b", "a"])
    expect(next.every((r) => r.payload === "new")).toBe(true)
  })

  it("rule 2: a resident row inside the refreshed span but absent from it is dropped", () => {
    const resident = [
      row("a", "2026-08-03T00:00:00.000Z"),
      row("b", "2026-08-02T00:00:00.000Z"),
      row("c", "2026-08-01T00:00:00.000Z"),
    ]
    // A full window that no longer contains `b` — deleted, or filtered out.
    const refreshed = [row("a", "2026-08-03T00:00:00.000Z"), row("c", "2026-08-01T00:00:00.000Z")]
    expect(reconcileRefreshedWindow(resident, refreshed, 2).map((r) => r.id)).toEqual(["a", "c"])
  })

  it("rule 3: a resident row BEYOND the refreshed span is retained as a stale tail", () => {
    const resident = [
      row("a", "2026-08-03T00:00:00.000Z"),
      row("b", "2026-08-02T00:00:00.000Z"),
      row("c", "2026-08-01T00:00:00.000Z"),
    ]
    // Two head inserts filled the whole limit, so coverage now ends at `x2`.
    const refreshed = [row("x1", "2026-08-09T00:00:00.000Z"), row("x2", "2026-08-08T00:00:00.000Z")]
    const next = reconcileRefreshedWindow(resident, refreshed, 2)
    expect(next.map((r) => r.id)).toEqual(["x1", "x2", "a", "b", "c"])
  })

  it("a window that did not FILL its limit has an unbounded span, so nothing is retained", () => {
    const resident = [row("a", "2026-08-03T00:00:00.000Z"), row("b", "2026-08-02T00:00:00.000Z")]
    // One row back out of a limit of 200: the matching set really is one row.
    expect(reconcileRefreshedWindow(resident, [row("a", "2026-08-03T00:00:00.000Z")], 200).map((r) => r.id)).toEqual(["a"])
  })

  it("an empty response empties the resident set", () => {
    expect(reconcileRefreshedWindow([row("a", "t")], [], 200)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-reconcile.test.ts
```

Expected: FAIL — module-resolution error naming `../../src/browse/browse-reconcile`.

- [ ] **Step 3: Write the implementation**

Create `packages/inspector/src/browse/browse-reconcile.ts`:

```ts
/** The two fields the default browse order (`updatedAt DESC, id ASC`) reads. */
export interface BrowseOrderKey {
  readonly id: string
  readonly updatedAt: string
}

/**
 * The default browse order, evaluated client-side.
 *
 * `<` on strings is UTF-16 code-unit order. That equals the server's byte order
 * here because both fields are ASCII-uniform by construction — `updatedAt` is
 * full-ISO-Z TEXT and ids are ASCII — which is exactly what lets a client-side
 * span comparison agree with the window the server actually returned.
 */
export function compareDefaultBrowseOrder(a: BrowseOrderKey, b: BrowseOrderKey): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/** Append `next` onto `prev`, dropping ids `prev` already holds — the
 *  belt-and-suspenders against a paging duplicate. Returns `prev` ITSELF when
 *  nothing was added, so an append that changed nothing does not churn the array
 *  identity the grid keys its work on. */
export function dedupeById<T extends { readonly id: string }>(
  prev: readonly T[],
  next: readonly T[],
): readonly T[] {
  const held = new Set(prev.map((row) => row.id))
  const added = next.filter((row) => !held.has(row.id))
  return added.length === 0 ? prev : [...prev, ...added]
}

/**
 * Head-anchored refresh reconciliation, rules 1–3:
 *
 * 1. A resident row whose id appears in the response takes the response's payload
 *    AND position — hoists into the head span and stale payloads, in one rule.
 *    Falls out of placing `refreshed` wholesale at the front.
 * 2. A resident row inside the refreshed span but absent from the response was
 *    deleted or moved out of the result: DROP it.
 * 3. A resident row beyond the refreshed span (head inserts pushed coverage up) is
 *    RETAINED as a possibly-stale tail. Rows are never evicted from under the user
 *    because inserts arrived; the next tick's larger limit re-covers them.
 *
 * A window that did not FILL its limit reached the end of the matching set, so its
 * span is unbounded and rule 3 has no members.
 */
export function reconcileRefreshedWindow<T extends BrowseOrderKey>(
  resident: readonly T[],
  refreshed: readonly T[],
  requestedLimit: number,
): readonly T[] {
  const spanEnd = refreshed.length >= requestedLimit ? refreshed.at(-1) : undefined
  if (spanEnd === undefined) return [...refreshed]
  const refreshedIds = new Set(refreshed.map((row) => row.id))
  const tail = resident.filter(
    (row) => !refreshedIds.has(row.id) && compareDefaultBrowseOrder(row, spanEnd) > 0,
  )
  return tail.length === 0 ? [...refreshed] : [...refreshed, ...tail]
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-reconcile.test.ts
```

Expected: PASS — 8 tests.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: both clean.

- [ ] **Step 6: Commit**

```bash
git add packages/inspector/src/browse/browse-reconcile.ts packages/inspector/test/components/browse-reconcile.test.ts
git commit -m "feat(inspector): head-anchored refresh reconciliation"
```

---

### Task 4: The orchestration state machine

This is the heart of the slice. Everything that can be decided without React lives here: revisions, the whole-response revision gate, single-flight arbitration, phase derivation, and the per-kind error slots.

**Files:**
- Create: `packages/inspector/src/browse/browse-machine.ts`
- Test: `packages/inspector/test/components/browse-machine.test.ts`

- [ ] **Step 1: Write the failing test — part 1 (revisions, phases, flows 1/2/4/6)**

Create `packages/inspector/test/components/browse-machine.test.ts`:

```ts
import type { MemoryRecord } from "@dawn-ai/memory/browse"
import { describe, expect, it } from "vitest"
import {
  BROWSE_PAGE_SIZE,
  BROWSE_RESIDENT_CAP,
  type BrowseEvent,
  type BrowseState,
  browseCanLoadMore,
  browseDataState,
  browsePhase,
  browseReduce,
  INITIAL_BROWSE_STATE,
} from "../../src/browse/browse-machine"

function record(id: string, updatedAt = "2026-08-01T00:00:00.000Z"): MemoryRecord {
  return {
    id,
    kind: "semantic",
    namespace: "route=/notes",
    content: `content ${id}`,
    data: {},
    source: { type: "tool", id: "remember" },
    confidence: 0.5,
    tags: [],
    status: "active",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt,
  }
}

/** Apply a list of events, returning the final state. Mirrors what the hook does:
 *  it feeds the reducer's `state` back in and ignores `start`/`abort`. */
function apply(state: BrowseState, ...events: BrowseEvent[]): BrowseState {
  let next = state
  for (const event of events) next = browseReduce(next, event).state
  return next
}

const KEY_A = '["list",null,null,null,null]'
const KEY_B = '["list","route=/notes",null,null,null]'

describe("browse machine — flow 1: initial load", () => {
  it("mount bumps the revision to 1 and asks for the first window", () => {
    const transition = browseReduce(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A })
    expect(transition.state.revision).toBe(1)
    expect(transition.state.datasetKey).toBe(KEY_A)
    expect(transition.abort).toBe(false)
    expect(transition.start).toEqual({
      revision: 1,
      kind: "initial",
      window: { limit: BROWSE_PAGE_SIZE, offset: 0 },
    })
    expect(browsePhase(transition.state)).toBe("loading")
  })

  it("the response stores records, total and key together, tagged with the revision", () => {
    const state = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
      type: "response",
      revision: 1,
      kind: "initial",
      page: { records: [record("a")], total: 5432 },
      at: 1000,
    })
    expect(state.fulfilled).toEqual({
      revision: 1,
      datasetKey: KEY_A,
      records: [record("a")],
      total: 5432,
      at: 1000,
    })
    expect(browsePhase(state)).toBe("idle")
    expect(browseDataState(state)).toEqual({ phase: "idle" })
  })
})

describe("browse machine — flows 2 and 4: a new desired query over a fulfilled one", () => {
  const loaded = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
    type: "response",
    revision: 1,
    kind: "initial",
    page: { records: [record("a")], total: 5432 },
    at: 1000,
  })

  it("keeps the old rows visible and marks them stale", () => {
    const transition = browseReduce(loaded, { type: "query-changed", datasetKey: KEY_B })
    expect(transition.state.revision).toBe(2)
    expect(transition.state.fulfilled?.revision).toBe(1)
    expect(browsePhase(transition.state)).toBe("stale")
    expect(transition.start?.kind).toBe("initial")
  })

  it("aborts what was in flight, and drops the queued load-more and every error slot", () => {
    const busy: BrowseState = {
      ...loaded,
      inFlight: { revision: 1, kind: "refresh", window: { limit: 200, offset: 0 } },
      queuedLoadMore: true,
      kindErrors: { refresh: "boom" },
    }
    const transition = browseReduce(busy, { type: "query-changed", datasetKey: KEY_B })
    expect(transition.abort).toBe(true)
    expect(transition.state.queuedLoadMore).toBe(false)
    expect(transition.state.kindErrors).toEqual({})
  })

  it("fulfilling the new revision replaces the records and re-tags the key", () => {
    const state = apply(loaded, { type: "query-changed", datasetKey: KEY_B }, {
      type: "response",
      revision: 2,
      kind: "initial",
      page: { records: [record("z")], total: 7 },
      at: 2000,
    })
    expect(state.fulfilled).toEqual({
      revision: 2,
      datasetKey: KEY_B,
      records: [record("z")],
      total: 7,
      at: 2000,
    })
    expect(browsePhase(state)).toBe("idle")
  })
})

describe("browse machine — flow 6: a stale response completing after a query change", () => {
  it("discards the response WHOLE — records, total and the flight slot", () => {
    const stale = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
      type: "query-changed",
      datasetKey: KEY_B,
    })
    const transition = browseReduce(stale, {
      type: "response",
      revision: 1,
      kind: "initial",
      page: { records: [record("a")], total: 999 },
      at: 3000,
    })
    expect(transition.state).toBe(stale)
    expect(transition.start).toBeNull()
    expect(browsePhase(transition.state)).toBe("loading")
  })

  it("discards a stale FAILURE too, so it cannot hold the new revision in error", () => {
    const stale = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
      type: "query-changed",
      datasetKey: KEY_B,
    })
    const transition = browseReduce(stale, {
      type: "failure",
      revision: 1,
      kind: "initial",
      message: "gone",
    })
    expect(transition.state).toBe(stale)
    expect(browsePhase(transition.state)).toBe("loading")
  })
})

describe("browse machine — the phase table", () => {
  const loaded = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
    type: "response",
    revision: 1,
    kind: "initial",
    page: { records: [record("a")], total: 5432 },
    at: 1000,
  })

  it("names the in-flight kind while the desired revision is fulfilled", () => {
    expect(browsePhase({ ...loaded, inFlight: { revision: 1, kind: "refresh", window: { limit: 200, offset: 0 } } })).toBe("refreshing")
    expect(browsePhase({ ...loaded, inFlight: { revision: 1, kind: "load-more", window: { limit: 200, offset: 1 } } })).toBe("loading-more")
  })

  it("error means nothing is fulfilled for the DESIRED revision, with or without rows", () => {
    const failedCold = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
      type: "failure",
      revision: 1,
      kind: "initial",
      message: "no memory store configured",
    })
    expect(browsePhase(failedCold)).toBe("error")
    expect(browseDataState(failedCold)).toEqual({ phase: "error", message: "no memory store configured" })

    const failedWarm = apply(loaded, { type: "query-changed", datasetKey: KEY_B }, {
      type: "failure",
      revision: 2,
      kind: "initial",
      message: "boom",
    })
    expect(browsePhase(failedWarm)).toBe("error")
    expect(failedWarm.fulfilled?.records).toHaveLength(1)
  })

  it("a retry in flight is a fresh attempt, not the held failure", () => {
    const failed = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
      type: "failure",
      revision: 1,
      kind: "initial",
      message: "boom",
    })
    const retried = browseReduce(failed, { type: "retry" })
    expect(retried.start).toEqual({ revision: 1, kind: "initial", window: { limit: BROWSE_PAGE_SIZE, offset: 0 } })
    expect(browsePhase(retried.state)).toBe("loading")
  })
})
```

- [ ] **Step 2: Append the failing test — part 2 (arbitration, flows 5/7/8/9)**

Append to `packages/inspector/test/components/browse-machine.test.ts`:

```ts
describe("browse machine — single-flight arbitration", () => {
  const loaded = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
    type: "response",
    revision: 1,
    kind: "initial",
    page: { records: [record("a"), record("b")], total: 5432 },
    at: 1000,
  })

  it("a poll tick asks for offset 0 with limit = resident count, floored at one page", () => {
    expect(browseReduce(loaded, { type: "poll-tick" }).start).toEqual({
      revision: 1,
      kind: "refresh",
      window: { limit: BROWSE_PAGE_SIZE, offset: 0 },
    })
    const big: BrowseState = {
      ...loaded,
      fulfilled: { ...loaded.fulfilled!, records: Array.from({ length: 600 }, (_, i) => record(`r${i}`)) },
    }
    expect(browseReduce(big, { type: "poll-tick" }).start?.window).toEqual({ limit: 600, offset: 0 })
  })

  it("a poll tick due while ANYTHING is in flight is skipped", () => {
    for (const kind of ["initial", "refresh", "load-more"] as const) {
      const busy: BrowseState = { ...loaded, inFlight: { revision: 1, kind, window: { limit: 200, offset: 0 } } }
      const transition = browseReduce(busy, { type: "poll-tick" })
      expect(transition.start).toBeNull()
      expect(transition.state).toBe(busy)
    }
  })

  it("a load-more asked for during a poll tick is QUEUED and runs when the tick settles", () => {
    const refreshing = browseReduce(loaded, { type: "poll-tick" }).state
    const queued = browseReduce(refreshing, { type: "load-more-requested" })
    expect(queued.start).toBeNull()
    expect(queued.state.queuedLoadMore).toBe(true)

    const settled = browseReduce(queued.state, {
      type: "response",
      revision: 1,
      kind: "refresh",
      page: { records: [record("a"), record("b")], total: 5432 },
      at: 2000,
    })
    expect(settled.state.queuedLoadMore).toBe(false)
    expect(settled.start).toEqual({
      revision: 1,
      kind: "load-more",
      window: { limit: BROWSE_PAGE_SIZE, offset: 2 },
    })
  })

  it("a queued load-more also runs when the tick it waited on FAILS", () => {
    const refreshing = browseReduce(loaded, { type: "poll-tick" }).state
    const queued = browseReduce(refreshing, { type: "load-more-requested" }).state
    const settled = browseReduce(queued, { type: "failure", revision: 1, kind: "refresh", message: "boom" })
    expect(settled.start?.kind).toBe("load-more")
  })

  it("load-more during load-more is a no-op, and stops at the resident cap", () => {
    const loading: BrowseState = { ...loaded, inFlight: { revision: 1, kind: "load-more", window: { limit: 200, offset: 2 } } }
    expect(browseReduce(loading, { type: "load-more-requested" }).start).toBeNull()
    expect(browseReduce(loading, { type: "load-more-requested" }).state.queuedLoadMore).toBe(false)

    const atCap: BrowseState = {
      ...loaded,
      fulfilled: {
        ...loaded.fulfilled!,
        records: Array.from({ length: BROWSE_RESIDENT_CAP }, (_, i) => record(`r${i}`)),
        total: 5432,
      },
    }
    expect(browseCanLoadMore(atCap)).toBe(false)
    expect(browseReduce(atCap, { type: "load-more-requested" }).start).toBeNull()
  })

  it("load-more is unavailable once everything matching is loaded", () => {
    const complete: BrowseState = { ...loaded, fulfilled: { ...loaded.fulfilled!, total: 2 } }
    expect(browseCanLoadMore(complete)).toBe(false)
  })
})

describe("browse machine — flow 9: refresh reconciles, load-more dedupes", () => {
  const loaded = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
    type: "response",
    revision: 1,
    kind: "initial",
    page: {
      records: [record("a", "2026-08-03T00:00:00.000Z"), record("b", "2026-08-02T00:00:00.000Z")],
      total: 5432,
    },
    at: 1000,
  })

  it("a refresh response is reconciled against the residents, not concatenated", () => {
    const refreshing = browseReduce(loaded, { type: "poll-tick" }).state
    // A partial window (2 of a 200 limit) ends the span: `b` is gone.
    const settled = browseReduce(refreshing, {
      type: "response",
      revision: 1,
      kind: "refresh",
      page: { records: [record("c", "2026-08-09T00:00:00.000Z"), record("a", "2026-08-03T00:00:00.000Z")], total: 5431 },
      at: 2000,
    })
    expect(settled.state.fulfilled?.records.map((r) => r.id)).toEqual(["c", "a"])
    expect(settled.state.fulfilled?.total).toBe(5431)
  })

  it("a load-more response is appended with ids deduped", () => {
    const loading = browseReduce(loaded, { type: "load-more-requested" }).state
    const settled = browseReduce(loading, {
      type: "response",
      revision: 1,
      kind: "load-more",
      page: { records: [record("b", "2026-08-02T00:00:00.000Z"), record("c", "2026-08-01T00:00:00.000Z")], total: 5432 },
      at: 2000,
    })
    expect(settled.state.fulfilled?.records.map((r) => r.id)).toEqual(["a", "b", "c"])
  })
})

describe("browse machine — flows 7 and 8: failure, slots and retry", () => {
  const loaded = apply(INITIAL_BROWSE_STATE, { type: "query-changed", datasetKey: KEY_A }, {
    type: "response",
    revision: 1,
    kind: "initial",
    page: { records: [record("a")], total: 5432 },
    at: 1000,
  })

  it("a refresh failure keeps the rows and the idle phase, and fills only its own slot", () => {
    const refreshing = browseReduce(loaded, { type: "poll-tick" }).state
    const failed = browseReduce(refreshing, { type: "failure", revision: 1, kind: "refresh", message: "network down" }).state
    expect(browsePhase(failed)).toBe("idle")
    expect(failed.fulfilled?.records).toHaveLength(1)
    expect(failed.kindErrors).toEqual({ refresh: "network down" })
  })

  it("one kind's success cannot clear another kind's failure", () => {
    const withBoth: BrowseState = { ...loaded, kindErrors: { refresh: "r", "load-more": "l" } }
    const refreshing = browseReduce(withBoth, { type: "poll-tick" }).state
    const ok = browseReduce(refreshing, {
      type: "response",
      revision: 1,
      kind: "refresh",
      page: { records: [record("a")], total: 5432 },
      at: 2000,
    }).state
    expect(ok.kindErrors).toEqual({ "load-more": "l" })
  })

  it("a repeated identical failure keeps the SAME slots object, so a 2 s cadence cannot re-render", () => {
    const refreshing = browseReduce(loaded, { type: "poll-tick" }).state
    const once = browseReduce(refreshing, { type: "failure", revision: 1, kind: "refresh", message: "network down" }).state
    const again = browseReduce(browseReduce(once, { type: "poll-tick" }).state, {
      type: "failure",
      revision: 1,
      kind: "refresh",
      message: "network down",
    }).state
    expect(again.kindErrors).toBe(once.kindErrors)
  })

  it("retry re-attempts the failed KIND, preferring load-more over refresh", () => {
    const loadMoreFailed: BrowseState = { ...loaded, kindErrors: { "load-more": "boom" } }
    expect(browseReduce(loadMoreFailed, { type: "retry" }).start).toEqual({
      revision: 1,
      kind: "load-more",
      window: { limit: BROWSE_PAGE_SIZE, offset: 1 },
    })
    const refreshFailed: BrowseState = { ...loaded, kindErrors: { refresh: "boom" } }
    expect(browseReduce(refreshFailed, { type: "retry" }).start?.kind).toBe("refresh")
  })

  it("retry after the query moved on is simply the new query's initial fetch", () => {
    const moved = apply(loaded, { type: "query-changed", datasetKey: KEY_B }, {
      type: "failure",
      revision: 2,
      kind: "initial",
      message: "boom",
    })
    expect(browseReduce(moved, { type: "retry" }).start).toEqual({
      revision: 2,
      kind: "initial",
      window: { limit: BROWSE_PAGE_SIZE, offset: 0 },
    })
  })

  it("retry while something is in flight is a no-op", () => {
    const busy: BrowseState = { ...loaded, inFlight: { revision: 1, kind: "refresh", window: { limit: 200, offset: 0 } } }
    expect(browseReduce(busy, { type: "retry" }).start).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test and see it fail**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-machine.test.ts
```

Expected: FAIL — module-resolution error naming `../../src/browse/browse-machine`.

- [ ] **Step 4: Write the implementation — types, constants and selectors**

Create `packages/inspector/src/browse/browse-machine.ts` with this content (the reducer follows in Step 5, appended to the same file):

```ts
import type { MemoryRecord } from "@dawn-ai/memory/browse"
import type { PretableDataState } from "@pretable/react"
import { dedupeById, reconcileRefreshedWindow } from "./browse-reconcile"

/** Records per window. */
export const BROWSE_PAGE_SIZE = 200

/** Ceiling on what the client keeps resident. DELIBERATELY equal to the route's
 *  `BROWSE_MAX_LIMIT`, so one head refresh can always re-derive the entire resident
 *  span in a single request — which is what makes the convergence guarantee
 *  arithmetic rather than aspirational. */
export const BROWSE_RESIDENT_CAP = 1000

export type BrowseRequestKind = "initial" | "refresh" | "load-more"

export interface BrowseWindow {
  readonly limit: number
  readonly offset: number
}

export interface BrowsePageResponse {
  readonly records: readonly MemoryRecord[]
  readonly total: number
}

/** Records, total and dataset key are stored TOGETHER and tagged with the revision
 *  that produced them. A total that belongs to a different question is the exact
 *  failure this design exists to prevent. */
export interface BrowseFulfillment {
  readonly revision: number
  readonly datasetKey: string
  readonly records: readonly MemoryRecord[]
  readonly total: number
  /** Epoch ms the response was applied — the as-of instant shown while paused. */
  readonly at: number
}

export interface BrowseRequest {
  readonly revision: number
  readonly kind: BrowseRequestKind
  readonly window: BrowseWindow
}

/** One independent slot per request kind, so a succeeding poll tick can never clear
 *  a load-more failure. The mutation slot lives with the consumer that owns the
 *  mutations. */
export interface BrowseKindErrors {
  readonly refresh?: string
  readonly "load-more"?: string
}

export interface BrowseState {
  readonly revision: number
  readonly datasetKey: string
  readonly fulfilled: BrowseFulfillment | null
  readonly inFlight: BrowseRequest | null
  readonly queuedLoadMore: boolean
  readonly initialFailure: { readonly revision: number; readonly message: string } | null
  readonly kindErrors: BrowseKindErrors
}

export type BrowseEvent =
  | { readonly type: "query-changed"; readonly datasetKey: string }
  | { readonly type: "poll-tick" }
  | { readonly type: "load-more-requested" }
  | { readonly type: "retry" }
  | {
      readonly type: "response"
      readonly revision: number
      readonly kind: BrowseRequestKind
      readonly page: BrowsePageResponse
      readonly at: number
    }
  | {
      readonly type: "failure"
      readonly revision: number
      readonly kind: BrowseRequestKind
      readonly message: string
    }

export interface BrowseTransition {
  readonly state: BrowseState
  /** The request the caller must now issue, or null. */
  readonly start: BrowseRequest | null
  /** Whether the caller must abort whatever it had in flight before this event. */
  readonly abort: boolean
}

const NO_KIND_ERRORS: BrowseKindErrors = {}

/** `revision: 0` is a revision nothing can fulfil and `datasetKey: ""` is a key no
 *  canonical query produces, so the first `query-changed` a mounted hook dispatches
 *  is the SAME transition as any later one. Mount is not a special case. */
export const INITIAL_BROWSE_STATE: BrowseState = {
  revision: 0,
  datasetKey: "",
  fulfilled: null,
  inFlight: null,
  queuedLoadMore: false,
  initialFailure: null,
  kindErrors: NO_KIND_ERRORS,
}

/** Records held FOR THE DESIRED REVISION. An older revision's records are on screen
 *  but are not a base anything new is built on. */
export function browseResidentCount(state: BrowseState): number {
  return state.fulfilled?.revision === state.revision ? state.fulfilled.records.length : 0
}

export function browseCanLoadMore(state: BrowseState): boolean {
  const fulfilled = state.fulfilled
  if (fulfilled === null || fulfilled.revision !== state.revision) return false
  return fulfilled.records.length < fulfilled.total && fulfilled.records.length < BROWSE_RESIDENT_CAP
}

/**
 * Phase derivation, mechanical.
 *
 * `error` means "the last attempt for the DESIRED revision failed and nothing is
 * fulfilled for that revision" — which covers an initial failure and a query-change
 * failure with an older revision's rows still on screen. A refresh or load-more
 * failure leaves the desired revision fulfilled, so the phase stays `idle` and the
 * failure reaches the user through a banner slot instead: one failure, one channel.
 */
export function browsePhase(state: BrowseState): PretableDataState["phase"] {
  if (state.fulfilled?.revision === state.revision) {
    if (state.inFlight?.kind === "refresh") return "refreshing"
    if (state.inFlight?.kind === "load-more") return "loading-more"
    return "idle"
  }
  // A retry in flight is a fresh attempt, not the held failure: the failure is only
  // "the LAST attempt" while there is no attempt running.
  if (state.inFlight === null && state.initialFailure?.revision === state.revision) {
    return "error"
  }
  // Rows on screen answer the previous question (`stale`); nothing on screen means
  // there is nothing to be stale about (`loading`).
  return (state.fulfilled?.records.length ?? 0) > 0 ? "stale" : "loading"
}

export function browseDataState(state: BrowseState): PretableDataState {
  const phase = browsePhase(state)
  if (phase !== "error") return { phase }
  const message = state.initialFailure?.message
  // Spread rather than `{ phase, message }`: `exactOptionalPropertyTypes` rejects an
  // explicit `undefined` against `message?: string`.
  return { phase, ...(message === undefined ? {} : { message }) }
}
```

- [ ] **Step 5: Write the implementation — the reducer**

Append to `packages/inspector/src/browse/browse-machine.ts`:

```ts
function noStart(state: BrowseState): BrowseTransition {
  return { state, start: null, abort: false }
}

function starting(state: BrowseState, request: BrowseRequest, abort: boolean): BrowseTransition {
  return { state: { ...state, inFlight: request }, start: request, abort }
}

function initialWindow(): BrowseWindow {
  return { limit: BROWSE_PAGE_SIZE, offset: 0 }
}

/** limit = resident count, clamped: never below one page (an empty result still asks
 *  a real question) and never above the cap the route enforces. */
function refreshWindow(state: BrowseState): BrowseWindow {
  const resident = browseResidentCount(state)
  return {
    limit: Math.min(Math.max(resident, BROWSE_PAGE_SIZE), BROWSE_RESIDENT_CAP),
    offset: 0,
  }
}

function loadMoreWindow(state: BrowseState): BrowseWindow {
  return { limit: BROWSE_PAGE_SIZE, offset: browseResidentCount(state) }
}

/** Success clears only ITS OWN slot. */
function clearedError(
  state: BrowseState,
  kind: BrowseRequestKind,
): Pick<BrowseState, "initialFailure" | "kindErrors"> {
  if (kind === "initial") {
    return { initialFailure: null, kindErrors: state.kindErrors }
  }
  if (state.kindErrors[kind] === undefined) {
    return { initialFailure: state.initialFailure, kindErrors: state.kindErrors }
  }
  const next: BrowseKindErrors = {
    ...(kind !== "refresh" && state.kindErrors.refresh !== undefined
      ? { refresh: state.kindErrors.refresh }
      : {}),
    ...(kind !== "load-more" && state.kindErrors["load-more"] !== undefined
      ? { "load-more": state.kindErrors["load-more"] }
      : {}),
  }
  return { initialFailure: state.initialFailure, kindErrors: next }
}

/** Failure records against the kind that failed. Message-equality suppression keeps
 *  the SAME object when a repeating tick fails the same way, so a 2 s cadence cannot
 *  re-render — or re-announce — a banner that has not changed. */
function recordedFailure(
  state: BrowseState,
  kind: BrowseRequestKind,
  message: string,
): Pick<BrowseState, "initialFailure" | "kindErrors"> {
  if (kind === "initial") {
    const previous = state.initialFailure
    if (previous !== null && previous.revision === state.revision && previous.message === message) {
      return { initialFailure: previous, kindErrors: state.kindErrors }
    }
    return { initialFailure: { revision: state.revision, message }, kindErrors: state.kindErrors }
  }
  if (state.kindErrors[kind] === message) {
    return { initialFailure: state.initialFailure, kindErrors: state.kindErrors }
  }
  const kindErrors: BrowseKindErrors =
    kind === "refresh"
      ? { ...state.kindErrors, refresh: message }
      : { ...state.kindErrors, "load-more": message }
  return { initialFailure: state.initialFailure, kindErrors }
}

/** A queued load-more runs when the tick it waited on settles — success OR failure.
 *  The queue clears either way: it was intent about a request that has had its turn. */
function drainQueuedLoadMore(settled: BrowseState): BrowseTransition {
  if (!settled.queuedLoadMore) return noStart(settled)
  const drained: BrowseState = { ...settled, queuedLoadMore: false }
  if (!browseCanLoadMore(drained)) return noStart(drained)
  return starting(
    drained,
    { revision: drained.revision, kind: "load-more", window: loadMoreWindow(drained) },
    false,
  )
}

export function browseReduce(state: BrowseState, event: BrowseEvent): BrowseTransition {
  switch (event.type) {
    case "query-changed": {
      const revision = state.revision + 1
      const request: BrowseRequest = { revision, kind: "initial", window: initialWindow() }
      return {
        // Records are KEPT: they answer the previous question and stay on screen
        // (phase `stale`) until the new one is answered. Their revision is behind
        // now, so nothing can mistake them for the answer. Every error slot is
        // dropped — each described a dataset that no longer exists.
        state: {
          ...state,
          revision,
          datasetKey: event.datasetKey,
          inFlight: request,
          queuedLoadMore: false,
          initialFailure: null,
          kindErrors: NO_KIND_ERRORS,
        },
        start: request,
        abort: state.inFlight !== null,
      }
    }

    case "poll-tick": {
      // Single flight: a tick that comes due while ANYTHING is in flight is skipped
      // and the next tick covers it. That is the whole of the "tick due during
      // loading-more" rule — the interleaving case is removed, not handled.
      if (state.inFlight !== null) return noStart(state)
      if (state.fulfilled?.revision !== state.revision) return noStart(state)
      return starting(
        state,
        { revision: state.revision, kind: "refresh", window: refreshWindow(state) },
        false,
      )
    }

    case "retry": {
      if (state.inFlight !== null) return noStart(state)
      // Re-attempt the failed kind under the CURRENT desired revision: if the query
      // moved on while the banner was up, that IS the new query's initial fetch.
      if (state.fulfilled?.revision !== state.revision) {
        return starting(
          state,
          { revision: state.revision, kind: "initial", window: initialWindow() },
          false,
        )
      }
      if (state.kindErrors["load-more"] !== undefined) {
        return starting(
          state,
          { revision: state.revision, kind: "load-more", window: loadMoreWindow(state) },
          false,
        )
      }
      return starting(
        state,
        { revision: state.revision, kind: "refresh", window: refreshWindow(state) },
        false,
      )
    }

    case "load-more-requested": {
      if (!browseCanLoadMore(state)) return noStart(state)
      // User intent is never silently dropped: a load-more asked for during a poll
      // tick is QUEUED and runs when the tick settles.
      if (state.inFlight?.kind === "refresh") return noStart({ ...state, queuedLoadMore: true })
      if (state.inFlight !== null) return noStart(state)
      return starting(
        state,
        { revision: state.revision, kind: "load-more", window: loadMoreWindow(state) },
        false,
      )
    }

    case "response": {
      // THE stale-suppression mechanism: a response whose revision is no longer
      // desired is discarded WHOLE — records, total and continuation together.
      // Aborting is an optimization layered on top; correctness never depends on it.
      if (event.revision !== state.revision) return noStart(state)
      const base = state.fulfilled?.revision === state.revision ? state.fulfilled.records : []
      const records =
        event.kind === "refresh"
          ? reconcileRefreshedWindow(
              base,
              event.page.records,
              state.inFlight?.window.limit ?? BROWSE_PAGE_SIZE,
            )
          : event.kind === "load-more"
            ? dedupeById(base, event.page.records)
            : event.page.records
      return drainQueuedLoadMore({
        ...state,
        inFlight: null,
        fulfilled: {
          revision: state.revision,
          datasetKey: state.datasetKey,
          records,
          total: event.page.total,
          at: event.at,
        },
        ...clearedError(state, event.kind),
      })
    }

    case "failure": {
      if (event.revision !== state.revision) return noStart(state)
      return drainQueuedLoadMore({
        ...state,
        inFlight: null,
        ...recordedFailure(state, event.kind, event.message),
      })
    }
  }
}
```

- [ ] **Step 6: Run the test and see it pass**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-machine.test.ts
```

Expected: PASS — 20 tests. If a test times out, re-run with `--testTimeout=30000` before investigating (see trap 6).

- [ ] **Step 7: Typecheck and lint**

```bash
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: both clean. The test file uses `loaded.fulfilled!` — if biome's `noNonNullAssertion` objects, replace each with a local `const fulfilled = loaded.fulfilled; if (fulfilled === null) throw new Error("unreachable")` above the usage.

- [ ] **Step 8: Commit**

```bash
git add packages/inspector/src/browse/browse-machine.ts packages/inspector/test/components/browse-machine.test.ts
git commit -m "feat(inspector): browse orchestration state machine"
```

---

### Task 5: `useMemoryBrowse` — the React binding

**Files:**
- Create: `packages/inspector/src/browse/use-memory-browse.ts`
- Test: `packages/inspector/test/components/use-memory-browse.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/use-memory-browse.test.tsx`:

```tsx
import type { MemoryRecord } from "@dawn-ai/memory/browse"
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { canonicalBrowseQuery } from "../../src/browse/canonical-query"
import { useMemoryBrowse } from "../../src/browse/use-memory-browse"

function record(id: string): MemoryRecord {
  return {
    id,
    kind: "semantic",
    namespace: "route=/notes",
    content: `content ${id}`,
    data: {},
    source: { type: "tool", id: "remember" },
    confidence: 0.5,
    tags: [],
    status: "active",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  }
}

/** A fetcher whose every call is resolved by hand, so a response can be made to
 *  land after the query it belongs to has already been superseded. */
function deferredFetcher() {
  const calls: {
    params: URLSearchParams
    signal: AbortSignal
    resolve: (page: { records: readonly MemoryRecord[]; total: number }) => void
    reject: (error: Error) => void
  }[] = []
  const fetchPage = vi.fn(
    (params: URLSearchParams, signal: AbortSignal) =>
      new Promise<{ records: readonly MemoryRecord[]; total: number }>((resolve, reject) => {
        calls.push({ params, signal, resolve, reject })
      }),
  )
  return { calls, fetchPage }
}

afterEach(cleanup)

describe("useMemoryBrowse", () => {
  it("fetches the first window on mount and reports loading until it lands", async () => {
    const { calls, fetchPage } = deferredFetcher()
    const query = canonicalBrowseQuery({ view: "list" })
    const { result } = renderHook(() => useMemoryBrowse({ query, live: true, fetchPage }))

    expect(result.current.dataState).toEqual({ phase: "loading" })
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]?.params.get("limit")).toBe("200")
    expect(calls[0]?.params.get("offset")).toBe("0")

    await act(async () => {
      calls[0]?.resolve({ records: [record("a")], total: 5432 })
    })
    expect(result.current.dataState).toEqual({ phase: "idle" })
    expect(result.current.records.map((r) => r.id)).toEqual(["a"])
    expect(result.current.total).toBe(5432)
    expect(result.current.resultMeta.total).toEqual({ kind: "exact", count: 5432 })
    expect(result.current.resultMeta.datasetKey).toBe(
      '["list",null,null,null,null]',
    )
  })

  it("publishes the FULFILLED dataset key, so the grid pivots when the answer lands", async () => {
    const { calls, fetchPage } = deferredFetcher()
    const { result, rerender } = renderHook(
      ({ namespace }: { namespace?: string }) =>
        useMemoryBrowse({
          query: canonicalBrowseQuery({ view: "list", ...(namespace ? { namespace } : {}) }),
          live: true,
          fetchPage,
        }),
      { initialProps: {} as { namespace?: string } },
    )
    await waitFor(() => expect(calls).toHaveLength(1))
    await act(async () => {
      calls[0]?.resolve({ records: [record("a")], total: 2 })
    })
    const firstKey = result.current.resultMeta.datasetKey

    rerender({ namespace: "route=/notes" })
    expect(result.current.dataState).toEqual({ phase: "stale" })
    // Still the OLD key while the old rows are on screen: selection over them is
    // valid FOR THEM, and is cleared exactly when the new answer lands.
    expect(result.current.resultMeta.datasetKey).toBe(firstKey)

    await waitFor(() => expect(calls).toHaveLength(2))
    await act(async () => {
      calls[1]?.resolve({ records: [record("z")], total: 1 })
    })
    expect(result.current.resultMeta.datasetKey).not.toBe(firstKey)
    expect(result.current.records.map((r) => r.id)).toEqual(["z"])
  })

  it("aborts the superseded request and discards it even if abort loses the race", async () => {
    const { calls, fetchPage } = deferredFetcher()
    const { result, rerender } = renderHook(
      ({ namespace }: { namespace?: string }) =>
        useMemoryBrowse({
          query: canonicalBrowseQuery({ view: "list", ...(namespace ? { namespace } : {}) }),
          live: true,
          fetchPage,
        }),
      { initialProps: {} as { namespace?: string } },
    )
    await waitFor(() => expect(calls).toHaveLength(1))
    rerender({ namespace: "route=/notes" })
    expect(calls[0]?.signal.aborted).toBe(true)

    // Abort lost the race: the superseded response resolves anyway.
    await act(async () => {
      calls[0]?.resolve({ records: [record("stale")], total: 999 })
    })
    expect(result.current.records).toHaveLength(0)
    expect(result.current.total).toBeNull()
    expect(result.current.dataState).toEqual({ phase: "loading" })
  })

  it("answers a set narrowed to nothing locally, without a request", async () => {
    const { calls, fetchPage } = deferredFetcher()
    const query = canonicalBrowseQuery({ view: "list", status: [] })
    const { result } = renderHook(() => useMemoryBrowse({ query, live: true, fetchPage }))
    await waitFor(() => expect(result.current.dataState).toEqual({ phase: "idle" }))
    expect(calls).toHaveLength(0)
    expect(result.current.total).toBe(0)
  })

  it("polls on the interval, and a failure suspends polling until retry", async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetchPage } = deferredFetcher()
      const query = canonicalBrowseQuery({ view: "list" })
      const { result } = renderHook(() =>
        useMemoryBrowse({ query, live: true, fetchPage, pollIntervalMs: 2000 }),
      )
      await act(async () => {
        calls[0]?.resolve({ records: [record("a")], total: 5432 })
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000)
      })
      expect(calls).toHaveLength(2)
      expect(result.current.dataState).toEqual({ phase: "refreshing" })

      await act(async () => {
        calls[1]?.reject(new Error("network down"))
      })
      // A refresh failure keeps the rows and the idle phase; it fills its own slot.
      expect(result.current.dataState).toEqual({ phase: "idle" })
      expect(result.current.errors).toEqual({ refresh: "network down" })
      expect(result.current.paused).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("pauses when live goes off and ticks IMMEDIATELY on resume", async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetchPage } = deferredFetcher()
      const query = canonicalBrowseQuery({ view: "list" })
      const { result, rerender } = renderHook(
        ({ live }: { live: boolean }) =>
          useMemoryBrowse({ query, live, fetchPage, pollIntervalMs: 2000 }),
        { initialProps: { live: true } },
      )
      await act(async () => {
        calls[0]?.resolve({ records: [record("a")], total: 5432 })
      })

      rerender({ live: false })
      expect(result.current.paused).toBe(true)
      expect(result.current.updatedAt).not.toBeNull()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(calls).toHaveLength(1)

      await act(async () => {
        rerender({ live: true })
      })
      expect(calls).toHaveLength(2)
      expect(result.current.paused).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("an initial failure holds the error phase and suspends polling", async () => {
    vi.useFakeTimers()
    try {
      const { calls, fetchPage } = deferredFetcher()
      const query = canonicalBrowseQuery({ view: "list" })
      const { result } = renderHook(() =>
        useMemoryBrowse({ query, live: true, fetchPage, pollIntervalMs: 2000 }),
      )
      await act(async () => {
        calls[0]?.reject(new Error("no memory store configured"))
      })
      expect(result.current.dataState).toEqual({
        phase: "error",
        message: "no memory store configured",
      })
      expect(result.current.paused).toBe(true)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000)
      })
      expect(calls).toHaveLength(1)

      await act(async () => {
        result.current.retry()
      })
      expect(calls).toHaveLength(2)
      await act(async () => {
        calls[1]?.resolve({ records: [record("a")], total: 1 })
      })
      expect(result.current.dataState).toEqual({ phase: "idle" })
      expect(result.current.paused).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("ignores a response that resolves after unmount", async () => {
    const { calls, fetchPage } = deferredFetcher()
    const query = canonicalBrowseQuery({ view: "list" })
    const { unmount } = renderHook(() => useMemoryBrowse({ query, live: true, fetchPage }))
    await waitFor(() => expect(calls).toHaveLength(1))
    unmount()
    expect(calls[0]?.signal.aborted).toBe(true)
    // Resolving now must not throw, warn, or touch anything.
    await act(async () => {
      calls[0]?.resolve({ records: [record("a")], total: 1 })
    })
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/use-memory-browse.test.tsx
```

Expected: FAIL — module-resolution error naming `../../src/browse/use-memory-browse`.

- [ ] **Step 3: Write the implementation**

Create `packages/inspector/src/browse/use-memory-browse.ts`:

```ts
"use client"
import type { MemoryRecord } from "@dawn-ai/memory/browse"
import type { PretableDataState, PretableResultMeta } from "@pretable/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  type BrowseEvent,
  type BrowseKindErrors,
  type BrowsePageResponse,
  type BrowseRequest,
  type BrowseState,
  browseCanLoadMore,
  browseDataState,
  browsePhase,
  browseReduce,
  INITIAL_BROWSE_STATE,
} from "./browse-machine"
import {
  browseMatchesNothing,
  browseSearchParams,
  type CanonicalBrowseQuery,
  datasetKeyOf,
} from "./canonical-query"

export const BROWSE_POLL_INTERVAL_MS = 2000

const NO_RECORDS: readonly MemoryRecord[] = []
const EMPTY_PAGE: BrowsePageResponse = { records: NO_RECORDS, total: 0 }
const UNKNOWN_TOTAL_META: PretableResultMeta = { total: { kind: "unknown" } }

export type BrowseFetcher = (
  params: URLSearchParams,
  signal: AbortSignal,
) => Promise<BrowsePageResponse>

/** GET one browse window, surfacing the API's `{error}` body as the thrown message. */
export async function fetchBrowsePage(
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<BrowsePageResponse> {
  const response = await fetch(`/api/memory/list?${params}`, { signal })
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : `request failed (${response.status})`
    throw new Error(message)
  }
  return body as BrowsePageResponse
}

export interface UseMemoryBrowseOptions {
  /** MEMOIZE the canonical query. A fresh object per render is harmless (the dataset
   *  key decides), but a `since` recomputed from `Date.now()` on every render would
   *  bump the desired revision on every render and refetch forever. */
  readonly query: CanonicalBrowseQuery
  readonly live: boolean
  readonly pollIntervalMs?: number
  readonly fetchPage?: BrowseFetcher
  readonly now?: () => number
}

export interface UseMemoryBrowseResult {
  readonly records: readonly MemoryRecord[]
  readonly dataState: PretableDataState
  readonly resultMeta: PretableResultMeta
  /** Matching population for the FULFILLED revision, or null when nothing is
   *  fulfilled. Never the desired revision's — that number does not exist yet. */
  readonly total: number | null
  readonly errors: BrowseKindErrors
  /** Epoch ms of the newest fulfilled response, or null. */
  readonly updatedAt: number | null
  /** Polling is suspended: live off, tab hidden, or a held error. */
  readonly paused: boolean
  readonly canLoadMore: boolean
  loadMore(): void
  refresh(): void
  retry(): void
}

export function useMemoryBrowse(options: UseMemoryBrowseOptions): UseMemoryBrowseResult {
  const { query, live } = options
  const pollIntervalMs = options.pollIntervalMs ?? BROWSE_POLL_INTERVAL_MS
  const datasetKey = useMemo(() => datasetKeyOf(query), [query])

  const [state, setState] = useState<BrowseState>(INITIAL_BROWSE_STATE)

  // Render-time mirrors of values the async paths read. Each is a pure copy of
  // something this render already holds, so a re-render can only re-copy the same
  // thing — the pattern is safe precisely because nothing else writes them.
  const queryRef = useRef(query)
  queryRef.current = query
  const fetchRef = useRef<BrowseFetcher>(fetchBrowsePage)
  fetchRef.current = options.fetchPage ?? fetchBrowsePage
  const nowRef = useRef<() => number>(Date.now)
  nowRef.current = options.now ?? Date.now

  // The machine's state lives in a ref as well as in `useState`: dispatches arrive
  // from timers and promise callbacks that must read the CURRENT state, not the one
  // their closure captured.
  const stateRef = useRef<BrowseState>(INITIAL_BROWSE_STATE)
  const controllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const dispatchRef = useRef<(event: BrowseEvent) => void>(() => {})

  const startRequest = useCallback((request: BrowseRequest) => {
    const current = queryRef.current
    if (browseMatchesNothing(current)) {
      // Answered locally, without a request — see `browseMatchesNothing`.
      dispatchRef.current({
        type: "response",
        revision: request.revision,
        kind: request.kind,
        page: EMPTY_PAGE,
        at: nowRef.current(),
      })
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    void fetchRef.current(browseSearchParams(current, request.window), controller.signal).then(
      (page) => {
        if (controller.signal.aborted || !mountedRef.current) return
        if (controllerRef.current === controller) controllerRef.current = null
        dispatchRef.current({
          type: "response",
          revision: request.revision,
          kind: request.kind,
          page,
          at: nowRef.current(),
        })
      },
      (error: unknown) => {
        if (controller.signal.aborted || !mountedRef.current) return
        if (controllerRef.current === controller) controllerRef.current = null
        dispatchRef.current({
          type: "failure",
          revision: request.revision,
          kind: request.kind,
          message: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }, [])

  const dispatch = useCallback(
    (event: BrowseEvent) => {
      const transition = browseReduce(stateRef.current, event)
      if (transition.abort && controllerRef.current !== null) {
        controllerRef.current.abort()
        controllerRef.current = null
      }
      stateRef.current = transition.state
      setState(transition.state)
      if (transition.start !== null) startRequest(transition.start)
    },
    [startRequest],
  )
  dispatchRef.current = dispatch

  // Mount and every canonical-query change are the SAME transition: bump the desired
  // revision, abort what was in flight, fetch the first window.
  useEffect(() => {
    mountedRef.current = true
    const live = stateRef.current
    if (live.datasetKey !== datasetKey) {
      dispatch({ type: "query-changed", datasetKey })
    } else if (live.inFlight === null && live.fulfilled === null && live.initialFailure === null) {
      // Re-arm after a StrictMode remount: the cleanup below aborted the mount
      // request without producing a response or a failure, so nothing else would
      // ever move this hook out of `loading`.
      dispatch({ type: "retry" })
    }
    return () => {
      mountedRef.current = false
      if (controllerRef.current !== null) {
        controllerRef.current.abort()
        controllerRef.current = null
        // Ref only — a setState after unmount is pointless, and the branch above
        // reads this ref to decide whether a remount must re-arm.
        stateRef.current = { ...stateRef.current, inFlight: null, queuedLoadMore: false }
      }
    }
  }, [datasetKey, dispatch])

  const [tabVisible, setTabVisible] = useState(true)
  useEffect(() => {
    const sync = () => setTabVisible(document.visibilityState !== "hidden")
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => document.removeEventListener("visibilitychange", sync)
  }, [])

  const phase = browsePhase(state)
  // A held error suspends polling until `retry()` succeeds: without that, the error
  // presentation would flicker on a 2 s cadence.
  const paused = !live || !tabVisible || phase === "error"

  const tickRef = useRef(() => {})
  tickRef.current = () => dispatch({ type: "poll-tick" })

  useEffect(() => {
    if (paused) return
    // Resuming — live back on, tab visible again, a retry that succeeded — ticks NOW
    // rather than up to one interval later. On mount the initial request is already
    // in flight, so the machine skips this tick.
    tickRef.current()
    const id = setInterval(() => tickRef.current(), pollIntervalMs)
    return () => clearInterval(id)
  }, [paused, pollIntervalMs])

  const loadMore = useCallback(() => dispatch({ type: "load-more-requested" }), [dispatch])
  const refresh = useCallback(() => dispatch({ type: "poll-tick" }), [dispatch])
  const retry = useCallback(() => dispatch({ type: "retry" }), [dispatch])

  const fulfilled = state.fulfilled
  const resultMeta = useMemo<PretableResultMeta>(
    () =>
      fulfilled === null
        ? UNKNOWN_TOTAL_META
        : {
            // The FULFILLED key, never the desired one: the grid must clear selection
            // and focus when the new answer LANDS, not when the question changes — a
            // selection over the old rows is still valid for the old rows.
            datasetKey: fulfilled.datasetKey,
            total: { kind: "exact", count: fulfilled.total },
          },
    [fulfilled],
  )
  const dataState = useMemo(() => browseDataState(state), [state])

  return {
    records: fulfilled?.records ?? NO_RECORDS,
    dataState,
    resultMeta,
    total: fulfilled?.total ?? null,
    errors: state.kindErrors,
    updatedAt: fulfilled?.at ?? null,
    paused,
    canLoadMore: browseCanLoadMore(state),
    loadMore,
    refresh,
    retry,
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/use-memory-browse.test.tsx
```

Expected: PASS — 8 tests. If a fake-timer test hangs, it is almost always a missing `await act(async () => { await vi.advanceTimersByTimeAsync(...) })` wrapper — not a bug in the hook.

- [ ] **Step 5: Typecheck and lint**

```bash
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: both clean. The local `const live = stateRef.current` inside the mount effect shadows the `live` option — rename it to `current` if biome's `noShadow` complains.

- [ ] **Step 6: Commit**

```bash
git add packages/inspector/src/browse/use-memory-browse.ts packages/inspector/test/components/use-memory-browse.test.tsx
git commit -m "feat(inspector): useMemoryBrowse orchestration hook"
```

---

### Task 6: Teach `MemoryGrid` the data lifecycle

**Files:**
- Modify: `packages/inspector/src/components/memory/memory-grid.tsx`

- [ ] **Step 1: Locate the file's landmarks**

```bash
grep -n 'const COLUMNS\|^const CELL_CLASS\|^export function MemoryGrid\|const rows = useMemo\|const viewportHeight' packages/inspector/src/components/memory/memory-grid.tsx
```

Use these symbol names — not the printed line numbers — to find each edit site.

- [ ] **Step 2: Widen the imports**

Replace the `@pretable/react` import block at the top of the file with:

```tsx
import {
  type ColumnFilter,
  type PretableBodyStateKind,
  type PretableColumn,
  type PretableDataState,
  type PretableProcessingOptions,
  type PretableResultMeta,
  PretableSurface,
  type PretableSurfaceMessages,
  type PretableTelemetry,
} from "@pretable/react"
```

and add the `Button` import beside the existing `Badge` one:

```tsx
import { Button } from "../ui/button"
```

- [ ] **Step 3: Add the browse-mode constants after `const CELL_CLASS`**

Insert immediately below the `CELL_CLASS` declaration:

```tsx
/**
 * Browse sends status/kind to the server, so the engine must DISPLAY the funnel
 * state without re-applying it — and `resultMeta.total` is silently ignored (with a
 * dev warning) under engine filter authority, so external authority is what makes
 * the honest total reachable at all.
 *
 * Sort is external AND the browse columns are non-sortable: leaving sort on
 * "engine" would sort a server-selected window locally, which presents the wrong
 * SAMPLE under a truthful-looking `aria-sort`, while external sort without an
 * `orderBy` in the request would paint a header arrow that does nothing. Sorting
 * comes back with server ordering.
 */
const SERVER_PROCESSING: PretableProcessingOptions = { filter: "external", sort: "external" }

const BROWSE_COLUMNS: PretableColumn<GridRow>[] = COLUMNS.map((column) => ({
  ...column,
  sortable: false,
}))

/** Enough room for a loading/empty/error block to be legible when the body holds
 *  no rows to give the viewport its height. */
const MIN_BODY_STATE_PX = 160

/** Lifecycle copy. `emptyStateMessage` is NOT here — filtered-empty and
 *  unfiltered-empty are different answers, and only the caller knows which. */
const BROWSE_MESSAGES: PretableSurfaceMessages = {
  loadingStateMessage: () => "Loading memories…",
  dataErrorAnnouncement: ({ message }) =>
    message === undefined ? "Could not load memories." : `Could not load memories: ${message}`,
  staleAnnouncement: () => "Updating results…",
  focusedRowRemovedAnnouncement: () => "The focused memory was removed.",
  resultsAnnouncement: ({ loaded, total, added, scope }) => {
    const head =
      scope === "all" || total.kind !== "exact"
        ? `${loaded.toLocaleString()} loaded`
        : `${loaded.toLocaleString()} loaded of ${total.count.toLocaleString()} matching`
    return added === undefined ? head : `Loaded ${added.toLocaleString()} more. ${head}.`
  },
  moreRowsBoundaryAnnouncement: ({ loadedCount, total }) =>
    total === undefined
      ? `End of the ${loadedCount.toLocaleString()} loaded memories.`
      : `End of the ${loadedCount.toLocaleString()} loaded memories, of ${total.toLocaleString()} matching.`,
}
```

- [ ] **Step 4: Extend the component signature**

In the `MemoryGrid` parameter destructuring and its type annotation, add the four new props. The destructuring becomes:

```tsx
export function MemoryGrid({
  records,
  onSelect,
  onTickedChange,
  groupByNamespace = false,
  filters,
  onFiltersChange,
  dataState,
  resultMeta,
  emptyMessage,
  onRetry,
}: {
```

and add these entries to the type literal, after `onFiltersChange`:

```tsx
  /** Supply to turn lifecycle presentation ON: body blocks, the phase attribute,
   *  phase announcements, and external processing authority. Omit it — as the
   *  search results do — and the grid behaves exactly as it did before. */
  dataState?: PretableDataState
  /** The matching population and the dataset identity, always for the FULFILLED
   *  revision. */
  resultMeta?: PretableResultMeta
  /** Body copy for the empty block. "Nothing stored" and "nothing matches what you
   *  asked for" are different answers; only the caller knows which applies. */
  emptyMessage?: string
  /** Retry affordance for the error block. The design routes it through the
   *  body-state slot rather than a second banner, so exactly one retry control is
   *  ever on screen. */
  onRetry?: () => void
```

- [ ] **Step 5: Give the viewport a floor when a body block is showing**

Replace the `const viewportHeight = ...` expression with:

```tsx
  const viewportHeight = Math.max(
    Math.min(
      (contentHeight ?? rows.length * density.rowHeight) + density.headerHeight,
      MAX_VIEWPORT_PX,
    ),
    dataState !== undefined && rows.length === 0 ? MIN_BODY_STATE_PX : 0,
  )

  const messages = useMemo<PretableSurfaceMessages>(
    () => ({
      ...BROWSE_MESSAGES,
      emptyStateMessage: () => emptyMessage ?? "No memories.",
    }),
    [emptyMessage],
  )
```

- [ ] **Step 6: Wire the surface**

Change the `columns` prop and add the lifecycle props. Replace `columns={COLUMNS}` with:

```tsx
      columns={dataState === undefined ? COLUMNS : BROWSE_COLUMNS}
```

and insert this block immediately after the `state={surfaceState}` prop:

```tsx
      {/* Spread-or-omit rather than `prop={undefined}`: `exactOptionalPropertyTypes`
          rejects an explicit undefined, and `dataState` has NO default — omitting it
          turns lifecycle presentation entirely off. */}
      {...(dataState === undefined ? {} : { dataState, processing: SERVER_PROCESSING, messages })}
      {...(resultMeta === undefined ? {} : { resultMeta })}
      {...(dataState === undefined
        ? {}
        : {
            renderBodyState: ({
              kind,
              errorMessage,
            }: {
              kind: PretableBodyStateKind
              errorMessage?: string
            }) =>
              kind === "loading" ? (
                <p data-testid="browse-loading" className="p-4 text-sm text-zinc-400">
                  Loading memories…
                </p>
              ) : kind === "empty" ? (
                <p data-testid="browse-empty" className="p-4 text-sm text-zinc-400">
                  {emptyMessage ?? "No memories."}
                </p>
              ) : (
                <div
                  data-testid="browse-error"
                  className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  <span>{errorMessage ?? "Could not load memories."}</span>
                  {onRetry ? (
                    <Button variant="outline" className="h-7 px-2" onClick={onRetry}>
                      Retry
                    </Button>
                  ) : null}
                </div>
              ),
          })}
```

- [ ] **Step 7: Verify nothing regressed**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/memory-grid.test.tsx test/components/grouping.test.tsx test/components/column-filter-wiring.test.tsx
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: all three test files pass with no edit in this task (they never pass `dataState`, so they exercise the inert path), and typecheck plus lint are clean. `memory-grid.test.tsx` is the version Task 1 left behind — its two row-activation tests arrange focus with a pointer-down rather than walking in from the header.

- [ ] **Step 8: Commit**

```bash
git add packages/inspector/src/components/memory/memory-grid.tsx
git commit -m "feat(inspector): lifecycle presentation and server authority on MemoryGrid"
```

---

### Task 7: The lifecycle chrome

**Files:**
- Create: `packages/inspector/src/components/memory/browse-chrome.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/browse-chrome.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BrowseErrorBanners, BrowseStatusBar } from "../../src/components/memory/browse-chrome"

afterEach(cleanup)

describe("BrowseErrorBanners", () => {
  it("renders nothing when no slot is filled", () => {
    const { container } = render(<BrowseErrorBanners errors={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it("keys by SOURCE, so two sources with the same message both show", () => {
    render(
      <BrowseErrorBanners
        errors={[
          { source: "stats", message: "boom" },
          { source: "refresh", message: "boom" },
        ]}
      />,
    )
    expect(screen.getByTestId("error-stats").textContent).toBe("boom")
    expect(screen.getByTestId("error-refresh").textContent).toBe("boom")
  })

  it("offers a retry control only when one is supplied", () => {
    const onRetry = vi.fn()
    const { rerender } = render(
      <BrowseErrorBanners errors={[{ source: "refresh", message: "boom" }]} />,
    )
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull()
    rerender(
      <BrowseErrorBanners errors={[{ source: "refresh", message: "boom" }]} onRetry={onRetry} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})

describe("BrowseStatusBar", () => {
  it("says loaded-of-matching once a total is known", () => {
    render(<BrowseStatusBar loaded={200} total={5432} phase="idle" asOf={null} />)
    expect(screen.getByTestId("browse-status").textContent).toContain("200 loaded of 5,432 matching")
  })

  it("claims only what it knows before the first total lands", () => {
    render(<BrowseStatusBar loaded={0} total={null} phase="loading" asOf={null} />)
    expect(screen.getByTestId("browse-status").textContent).toContain("0 loaded")
    expect(screen.getByTestId("browse-status").textContent).not.toContain("matching")
  })

  it("marks the stale phase and shows an as-of instant only while paused", () => {
    const { rerender } = render(
      <BrowseStatusBar loaded={200} total={5432} phase="stale" asOf={null} />,
    )
    const bar = screen.getByTestId("browse-status")
    expect(bar.getAttribute("data-phase")).toBe("stale")
    expect(bar.textContent).toContain("Updating results…")
    expect(bar.textContent).not.toContain("Updated ")

    rerender(<BrowseStatusBar loaded={200} total={5432} phase="idle" asOf={1_754_000_000_000} />)
    expect(screen.getByTestId("browse-status").textContent).toContain("Updated ")
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-chrome.test.tsx
```

Expected: FAIL — module-resolution error naming `../../src/components/memory/browse-chrome`.

- [ ] **Step 3: Write the implementation**

Create `packages/inspector/src/components/memory/browse-chrome.tsx`:

```tsx
"use client"
import type { PretableDataState } from "@pretable/react"
import { Button } from "../ui/button"

export interface BrowseErrorEntry {
  /** The slot this failure belongs to. Independent per source, so one source's
   *  success can never clear another's failure. */
  readonly source: string
  readonly message: string
}

/**
 * One line per failing source, in a single live region.
 *
 * Keyed by SOURCE and not by message: two sources failing with the same text must
 * not collide as React keys, and a source that succeeds must clear only its own
 * line. The retry control appears only for browse-request failures — the error
 * PHASE's retry lives in the grid's body-state block instead, so exactly one retry
 * control is ever on screen.
 */
export function BrowseErrorBanners({
  errors,
  onRetry,
}: {
  errors: readonly BrowseErrorEntry[]
  onRetry?: (() => void) | undefined
}) {
  if (errors.length === 0) return null
  return (
    <div
      role="alert"
      className="mb-3 space-y-1 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {errors.map((entry) => (
        <div key={entry.source} data-testid={`error-${entry.source}`}>
          {entry.message}
        </div>
      ))}
      {onRetry ? (
        <Button variant="outline" className="mt-1 h-7 px-2" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}

/**
 * Counts and freshness.
 *
 * `total` is the matching population for the FULFILLED revision, so before the
 * first response the bar says only what it knows. `asOf` is non-null only while
 * polling is paused: a live grid stamping "updated 14:32:07" two seconds before it
 * changes again is noise, while a paused one that says nothing is a lie by
 * omission. With nothing fulfilled there is no instant to quote, so the caller
 * passes null and the stamp stays off.
 */
export function BrowseStatusBar({
  loaded,
  total,
  phase,
  asOf,
}: {
  loaded: number
  total: number | null
  phase: PretableDataState["phase"]
  asOf: number | null
}) {
  return (
    <p
      data-testid="browse-status"
      data-phase={phase}
      className="mb-2 flex items-center gap-3 text-xs text-zinc-500"
    >
      <span>
        {total === null
          ? `${loaded.toLocaleString()} loaded`
          : `${loaded.toLocaleString()} loaded of ${total.toLocaleString()} matching`}
      </span>
      {phase === "stale" ? <span>Updating results…</span> : null}
      {asOf === null ? null : <span>{`Updated ${new Date(asOf).toLocaleTimeString()}`}</span>}
    </p>
  )
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-chrome.test.tsx
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: 6 tests pass; typecheck and lint clean.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/src/components/memory/browse-chrome.tsx packages/inspector/test/components/browse-chrome.test.tsx
git commit -m "feat(inspector): browse error banners and status bar"
```

---

### Task 8: Wire `ListPage` to the hook

**Files:**
- Modify: `packages/inspector/src/components/memory/list-page.tsx`
- Modify: `packages/inspector/test/components/list.test.tsx`

- [ ] **Step 1: Re-read the file and locate every edit site**

```bash
grep -n 'interface ListResponse\|type ErrorSource\|const pageFn\|const stats = usePolling\|const page = usePolling\|const handleMutated\|const handleBulkDone\|const byStatus\|const pageRecords\|const pageIsComplete\|errorEntries' packages/inspector/src/components/memory/list-page.tsx
```

- [ ] **Step 2: Swap the imports and the error-source union**

Replace the `interface ListResponse { ... }` block **entirely** with nothing (it is dead once the hook owns the list fetch), and change the `ErrorSource` declaration to:

```tsx
/** Each source owns its own error slot — a stats success must not clear a search
 *  failure's banner, and neither may clear a mutation's. The browse REQUEST kinds
 *  (refresh, load-more) keep their own slots inside `useMemoryBrowse`. */
type ErrorSource = "stats" | "search" | "mutation"
```

Add these imports beside the existing ones:

```tsx
import { canonicalBrowseQuery } from "../../browse/canonical-query"
import { useMemoryBrowse } from "../../browse/use-memory-browse"
import { BrowseErrorBanners, type BrowseErrorEntry, BrowseStatusBar } from "./browse-chrome"
```

- [ ] **Step 3: Replace `pageFn` + the list `usePolling` with the hook**

Delete the entire `const pageFn = useCallback(...)` block and the `const page = usePolling(pageFn, 2000, live && !query)` line. Delete the `const [refreshKey, setRefreshKey] = useState(0)` line. Leave `const stats = usePolling(statsFn, 2000, live)` exactly as it is.

In their place, immediately after the `filters` / `handleFiltersChange` memo pair, insert:

```tsx
  // PINNED at the moment the window changes, not recomputed per render: `since` is
  // part of the dataset identity, so a fresh `Date.now()` on every render would bump
  // the desired revision on every render and refetch forever.
  const since = useMemo(
    () =>
      view === "timeline" && timelineWindow !== "all"
        ? new Date(Date.now() - WINDOWS[timelineWindow]).toISOString()
        : undefined,
    [view, timelineWindow],
  )

  const browseQuery = useMemo(
    () =>
      canonicalBrowseQuery({
        view,
        ...(namespace === undefined ? {} : { namespace }),
        ...(status === undefined ? {} : { status }),
        ...(kind === undefined ? {} : { kind }),
        ...(since === undefined ? {} : { since }),
      }),
    [view, namespace, status, kind, since],
  )

  // Search replaces the browse view entirely, so browse stops polling behind it.
  const browse = useMemoryBrowse({ query: browseQuery, live: live && !query })
  const { refresh: refreshBrowse, retry: retryBrowse } = browse
```

- [ ] **Step 4: Point mutation recovery at the hook**

Replace `handleMutated` and `handleBulkDone` with:

```tsx
  const handleMutated = useCallback(() => {
    setSelectedId(undefined)
    refreshBrowse()
  }, [refreshBrowse])
```

and, after `clearTicked`:

```tsx
  const handleBulkDone = useCallback(
    ({ failed }: { failed: number }) => {
      if (failed === 0) {
        // Keep the selection when anything failed: clearing it unmounts the bar, and
        // the report of what went wrong goes with it.
        clearTicked()
        setError("mutation", undefined)
      } else {
        setError("mutation", `${failed} bulk action(s) failed — see the bar for details.`)
      }
      refreshBrowse()
    },
    [clearTicked, refreshBrowse, setError],
  )
```

- [ ] **Step 5: Replace the derived record/error values**

Replace the `const pageRecords = ...` and `const pageIsComplete = ...` declarations with:

```tsx
  // No client-side narrowing any more: the request carries the EXACT namespace, so
  // the rows on screen and `total` describe the same set. Filtering here would make
  // "N loaded of M matching" a lie the moment a facet was clicked.
  const pageRecords = browse.records
  // Group headers count the rows the grid HOLDS. On a truncated window that count is
  // an artifact of where the cap fell, so group only when the window is the whole
  // answer; the facet rail stays the honest navigator for anything larger.
  const pageIsComplete = browse.total !== null && pageRecords.length >= browse.total
  const filtersActive = status !== undefined || kind !== undefined || namespace !== undefined
  // "Nothing stored" and "nothing matches what you asked for" are different answers;
  // telling a filtered view to go run its agent sends you looking for a bug that
  // isn't there.
  const emptyMessage = filtersActive
    ? "No memories match these filters."
    : "No memories yet — run your agent and watch them appear."
```

and replace the `const errorEntries = ...` declaration with:

```tsx
  const browseRequestFailed =
    browse.errors.refresh !== undefined || browse.errors["load-more"] !== undefined
  const errorEntries: BrowseErrorEntry[] = [
    ...Object.entries(errors).flatMap(([source, message]) =>
      message ? [{ source, message }] : [],
    ),
    ...(browse.errors.refresh === undefined
      ? []
      : [{ source: "refresh", message: `Refresh failed: ${browse.errors.refresh}` }]),
    ...(browse.errors["load-more"] === undefined
      ? []
      : [{ source: "load-more", message: `Loading more failed: ${browse.errors["load-more"]}` }]),
  ]
```

- [ ] **Step 6: Replace the banner and the browse branch in the JSX**

Replace the whole `{errorEntries.length > 0 ? (<div role="alert" ...>...</div>) : null}` expression with:

```tsx
          <BrowseErrorBanners
            errors={errorEntries}
            {...(browseRequestFailed ? { onRetry: retryBrowse } : {})}
          />
```

Then replace the browse branch of the view ternary — everything from `) : pageRecords.length > 0 ? (` through the final `)}` of the "No memories yet" paragraph — with:

```tsx
          ) : (
            <>
              <BrowseStatusBar
                loaded={pageRecords.length}
                total={browse.total}
                phase={browse.dataState.phase}
                asOf={browse.paused ? browse.updatedAt : null}
              />
              <MemoryGrid
                key={gridEpoch}
                records={pageRecords}
                onSelect={setSelectedId}
                onTickedChange={setTicked}
                // Only while looking at everything: scoped to one namespace by the
                // rail, every row would sit under a single group header.
                groupByNamespace={namespace === undefined && pageIsComplete}
                // Filtering is server-side: the funnels only decide the query.
                filters={filters}
                onFiltersChange={handleFiltersChange}
                dataState={browse.dataState}
                resultMeta={browse.resultMeta}
                emptyMessage={emptyMessage}
                onRetry={retryBrowse}
              />
            </>
          )}
```

The grid now renders in every browse state — the empty and error copy live in its body-state block rather than replacing it.

- [ ] **Step 7: Update the two facet tests**

In `packages/inspector/test/components/list.test.tsx`:

- In `"clicking a namespace facet scopes the next list fetch"`, change `u.searchParams.get("namespacePrefix")` to `u.searchParams.get("namespace")`.
- Rename `"a selected facet filters the page to the exact namespace, not the prefix"` to `"a selected facet asks the server for the exact namespace"`, and replace its body's post-click assertions: the stub must now return only `[candidate]` when `namespace=route=/notes` is present and `[candidate, sibling]` otherwise, and the assertion becomes that the sibling disappears **and** that a request carrying `namespace=route=/notes` was made. Concretely, replace the `/api/memory/list` branch of that test's stub with:

```ts
        if (u.includes("/api/memory/list")) {
          // The request now carries the EXACT namespace, so the server answers with
          // exactly that namespace's rows — no client-side narrowing left to do.
          const exact = new URL(u, "http://localhost").searchParams.get("namespace")
          return jsonResponse(
            exact === "route=/notes"
              ? { records: [candidate], total: 1 }
              : { records: [candidate, sibling], total: 2 },
          )
        }
```

Then check whether anything still references the deleted paragraph:

```bash
grep -rn 'no-matches' packages/inspector/test packages/inspector/src
```

Every hit must be updated to `browse-empty` (the body-state block's testid).

- [ ] **Step 8: Run the existing suite**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: every component test passes. `"surfaces API errors as a banner"` still passes because the *stats* poll fails with the same message and fills its own slot — the list failure now lands in the grid's error block instead, which is the design's single-channel rule.

- [ ] **Step 9: Commit**

```bash
git add packages/inspector/src/components/memory/list-page.tsx packages/inspector/test/components/list.test.tsx
git commit -m "feat(inspector): drive browse from useMemoryBrowse with lifecycle chrome"
```

---

### Task 9: End-to-end lifecycle tests over a fake server

**Files:**
- Create: `packages/inspector/test/components/browse-lifecycle.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/browse-lifecycle.test.tsx`:

```tsx
import type { MemoryRecord, MemoryStats } from "@dawn-ai/memory"
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ListPage } from "../../src/components/memory/list-page"

const stats: MemoryStats = {
  total: 2,
  byStatus: { candidate: 1, active: 1 },
  byKind: { semantic: 2 },
  byNamespace: { "route=/notes": 2 },
  bySourceType: { tool: 2 },
}

function record(id: string, over: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id,
    kind: "semantic",
    namespace: "route=/notes",
    content: `content ${id}`,
    data: {},
    source: { type: "tool", id: "remember" },
    confidence: 0.5,
    tags: [],
    status: "active",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** A fake server whose /list answer is swappable mid-test. */
function stubServer(list: () => Response) {
  const mock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes("/api/memory/stats")) return jsonResponse(stats)
    if (u.includes("/api/memory/list")) return list()
    if (u.includes("/api/memory/search")) return jsonResponse({ groups: [] })
    return jsonResponse({ error: "not found" }, 404)
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("browse lifecycle", () => {
  it("flow 1: shows a loading block, then rows and the honest total", async () => {
    stubServer(() => jsonResponse({ records: [record("a")], total: 5432 }))
    render(<ListPage />)
    expect(screen.getByTestId("browse-loading")).toBeDefined()
    expect(await screen.findByText("content a")).toBeDefined()
    expect(screen.getByTestId("browse-status").textContent).toContain("1 loaded of 5,432 matching")
  })

  it("an empty result gets the empty block, with copy that knows about filters", async () => {
    stubServer(() => jsonResponse({ records: [], total: 0 }))
    render(<ListPage />)
    await waitFor(() =>
      expect(screen.getByTestId("browse-empty").textContent).toContain("No memories yet"),
    )
    const rail = screen.getByRole("navigation")
    fireEvent.click(within(rail).getByRole("button", { name: /route=\/notes/ }))
    await waitFor(() =>
      expect(screen.getByTestId("browse-empty").textContent).toContain(
        "No memories match these filters",
      ),
    )
  })

  it("flow 7: an initial failure renders the error block with a retry that recovers", async () => {
    let fail = true
    stubServer(() =>
      fail
        ? jsonResponse({ error: "no memory store configured" }, 500)
        : jsonResponse({ records: [record("a")], total: 1 }),
    )
    render(<ListPage />)
    const block = await screen.findByTestId("browse-error")
    expect(block.textContent).toContain("no memory store configured")

    fail = false
    fireEvent.click(within(block).getByRole("button", { name: "Retry" }))
    expect(await screen.findByText("content a")).toBeDefined()
    expect(screen.queryByTestId("browse-error")).toBeNull()
  })

  it("flow 2/4: a facet change marks the visible rows stale and asks for the exact namespace", async () => {
    let release: (() => void) | undefined
    const mock = stubServer(() => jsonResponse({ records: [record("a")], total: 1 }))
    render(<ListPage />)
    expect(await screen.findByText("content a")).toBeDefined()

    // Hold the next answer so the stale window is observable.
    mock.mockImplementation(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes("/api/memory/stats")) return jsonResponse(stats)
      if (u.includes("/api/memory/search")) return jsonResponse({ groups: [] })
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return jsonResponse({ records: [record("z")], total: 1 })
    })

    const rail = screen.getByRole("navigation")
    fireEvent.click(within(rail).getByRole("button", { name: /route=\/notes/ }))
    await waitFor(() =>
      expect(screen.getByTestId("browse-status").getAttribute("data-phase")).toBe("stale"),
    )
    // The OLD rows are still on screen, and marked as answering the old question.
    expect(screen.getByText("content a")).toBeDefined()

    release?.()
    expect(await screen.findByText("content z")).toBeDefined()
    const listCalls = mock.mock.calls
      .map((call) => String(call[0]))
      .filter((u) => u.includes("/api/memory/list"))
    expect(listCalls.some((u) => u.includes("namespace=route%3D%2Fnotes"))).toBe(true)
  })

  it("flow 8/9: a failing poll tick banners itself without disturbing the rows", async () => {
    vi.useFakeTimers()
    try {
      let fail = false
      stubServer(() =>
        fail
          ? jsonResponse({ error: "network down" }, 503)
          : jsonResponse({ records: [record("a")], total: 1 }),
      )
      render(<ListPage />)
      await vi.waitFor(() => expect(screen.getByText("content a")).toBeDefined())

      fail = true
      await vi.advanceTimersByTimeAsync(2100)
      await vi.waitFor(() =>
        expect(screen.getByTestId("error-refresh").textContent).toContain("network down"),
      )
      // Rows survive a failed refresh, and the failure did NOT become the error block.
      expect(screen.getByText("content a")).toBeDefined()
      expect(screen.queryByTestId("browse-error")).toBeNull()

      fail = false
      await vi.advanceTimersByTimeAsync(2100)
      await vi.waitFor(() => expect(screen.queryByTestId("error-refresh")).toBeNull())
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows an as-of instant once polling is paused", async () => {
    stubServer(() => jsonResponse({ records: [record("a")], total: 1 }))
    render(<ListPage />)
    expect(await screen.findByText("content a")).toBeDefined()
    expect(screen.getByTestId("browse-status").textContent).not.toContain("Updated ")

    fireEvent.click(screen.getByLabelText("live"))
    await waitFor(() =>
      expect(screen.getByTestId("browse-status").textContent).toContain("Updated "),
    )
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-lifecycle.test.tsx
```

Expected: this file exercises code that already exists, so failures here are real. Read each one. The two most likely and their fixes:

- **`screen.getByLabelText("live")` finds nothing** — the checkbox is wrapped in a `<label>` whose text is `live`, which Testing Library matches; if it does not, swap to `screen.getByRole("checkbox", { name: "live" })`.
- **The stale assertion never sees `data-phase="stale"`** — the held promise resolved too early; confirm the `mockImplementation` swap happened *before* the facet click.

- [ ] **Step 3: Make it pass**

Fix whatever the failures name, in the test or in the source. Do **not** weaken an assertion to make it green: every one of them restates a rule from the design that the previous tasks implemented.

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts test/components/browse-lifecycle.test.tsx
```

Expected: PASS — 6 tests.

- [ ] **Step 4: Run the whole component project and typecheck**

```bash
pnpm --filter @dawn-ai/inspector exec vitest run --config vitest.components.config.ts
pnpm --filter @dawn-ai/inspector typecheck
pnpm --filter @dawn-ai/inspector lint
```

Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add packages/inspector/test/components/browse-lifecycle.test.tsx
git commit -m "test(inspector): browse lifecycle flows over a fake server"
```

---

### Task 10: Changeset and the full gate

**Files:**
- Create: `.changeset/inspector-browse-orchestration.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/inspector-browse-orchestration.md`:

```markdown
---
"@dawn-ai/inspector": patch
---

Make the memory browse honest about what it is showing.

The list is no longer polled through `usePolling`, which documents its own
last-write-wins hole: a new `useMemoryBrowse` hook owns a desired query revision
that any canonical-query change bumps, and **every response is discarded whole
unless its revision is still the desired one**. Aborting the superseded request is
an optimization on top; correctness never depends on winning that race. Stats keep
polling as before.

- One browse request in flight at a time, with the contention cases removed rather
  than handled: a load-more asked for during a poll tick is queued and runs when the
  tick settles, and a tick that comes due while anything is in flight is skipped.
- A poll tick refreshes the head of the window and reconciles: updated rows take the
  server's payload and position, rows that vanished from the refreshed span are
  dropped, and rows beyond the span are retained rather than evicted because inserts
  arrived above them.
- Failures are recorded per request kind, so a succeeding poll tick cannot clear a
  load-more failure and neither can clear a mutation's. A load failure with nothing
  loaded holds the grid's error block and suspends polling until retry succeeds, so
  the failure does not flicker on a two-second cadence.
- Pausing (live off, hidden tab, held error) replaces the freshness claim with an
  as-of stamp; resuming ticks immediately instead of waiting out the interval.
- The grid now receives `dataState` and `resultMeta` from `@pretable/react@0.3.0`,
  so loading, empty and error blocks are real states and the footer says "N loaded
  of M matching" using the server's count.
- The namespace facet sends the exact `namespace` parameter instead of narrowing a
  prefix answer client-side — otherwise the total and the rows would describe
  different sets.
- Keyboard entry into the memory grid is now Tab-only, from `@pretable/react@0.3.0`:
  Down arrow from a column header no longer moves into the body. Once a row has
  focus, arrow keys and Enter/Space behave as before.

Column sorting is off in the browse view for now: sorting a server-selected window
locally presents the wrong sample, not merely the wrong order. It returns with
server-side ordering.
```

- [ ] **Step 2: Verify the changeset is well-formed**

```bash
pnpm exec changeset status --since origin/main
```

Expected: `@dawn-ai/inspector` listed with a `Patch` bump (the fixed version group carries the rest).

- [ ] **Step 3: Run the package's full gate, including e2e**

```bash
pnpm turbo run test --filter @dawn-ai/inspector
```

Expected: both vitest projects pass. The e2e project builds and boots the standalone server against the fixture app; it has 120 s timeouts and `fileParallelism: false`, so give it time. Under machine load a single e2e timeout is usually contention — re-run that one file before investigating.

- [ ] **Step 4: Run the repo-wide gates that touch this package**

```bash
pnpm turbo run lint --filter @dawn-ai/inspector
pnpm turbo run typecheck --filter @dawn-ai/inspector
```

Expected: clean.

- [ ] **Step 5: Check for parallel sessions, then commit and open the PR**

```bash
git fetch origin
git log --oneline -3 origin/main
git rebase origin/main
```

If the rebase pulls in changes to `packages/inspector` or `packages/memory`, re-run Step 3 before continuing.

```bash
git add .changeset/inspector-browse-orchestration.md
git commit -m "chore(inspector): changeset for browse orchestration"
git push -u origin blove/inspector-browse-orchestration
gh pr create --title "feat(inspector): browse orchestration and lifecycle UI" --body "$(cat <<'EOF'
## Summary

Replaces the memory browse's `usePolling` list fetch with a `useMemoryBrowse` hook that owns desired-vs-fulfilled query revisions, single-flight arbitration, head-anchored refresh reconciliation and per-kind failure slots, and surfaces all of it through `@pretable/react@0.3.0`'s `dataState` / `resultMeta`.

The request shape is unchanged apart from the namespace facet, which now sends the exact `namespace` parameter instead of narrowing a prefix answer client-side — without that, `total` and the rows on screen describe different sets and "N loaded of M matching" is a lie.

## Three judgment calls worth a reviewer's attention

1. **All three `@pretable/*` packages are pinned to `0.3.0`.** `@pretable/react@0.3.0` declares `@pretable/core@0.3.0` and `@pretable/ui@0.3.0` as dependencies; pinning core to `0.1.0` would install two engines.
2. **`processing: { filter: "external", sort: "external" }`.** `setResultMeta` ignores `meta.total` (with a dev warning) under engine filter authority, so external filter authority is required for the honest total. Leaving sort on `"engine"` then trips the partial-window warning, and external sort without `orderBy` paints a header arrow that does nothing — so the browse columns are `sortable: false` until server ordering lands. Search results keep sortable columns.
3. **The exact-namespace request** pulls one line of a later slice forward, for the honesty reason above. It uses only parameters the shipped route already parses; `filters`, `orderBy` and `cursor` are untouched.

## Testing

- `browse-query`, `browse-reconcile`, `browse-machine`, `browse-chrome`, `use-memory-browse`, `browse-lifecycle` — new
- `list`, `memory-grid`, `grouping`, `column-filter-wiring` — pass, two facet assertions updated
- `pnpm turbo run test --filter @dawn-ai/inspector` (both projects), plus `typecheck` and `lint`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes for the executing engineer

Before you call this done, confirm each of these by pointing at a test:

- **§6.1** revision gate discards a response whole — `browse-machine.test.ts` "flow 6", and `use-memory-browse.test.tsx` "abort loses the race".
- **§6.1** single flight + arbitration — "a poll tick due while ANYTHING is in flight is skipped", "a load-more asked for during a poll tick is QUEUED".
- **§6.1** phase derivation, including `error` = nothing fulfilled for the desired revision — "the phase table".
- **§6.3** reconciliation rules 1–3 — `browse-reconcile.test.ts`.
- **§6.4** per-kind slots, message-equality suppression, retry-the-failed-kind, error suspends polling — "flows 7 and 8" and the hook's "an initial failure holds the error phase".
- **§9.1** six presentations — the loading/empty/error blocks and the stale marking in `browse-lifecycle.test.tsx`.
- **§9.5** a poll response goes through the same revision gate as any other — it is literally the same `response` event.
- **Flows 1, 2, 4, 6, 7, 8, 9** — each named in a test title.

And confirm the two things a test cannot catch: `pnpm --filter @dawn-ai/inspector typecheck` passed *after* `@dawn-ai/memory` was built, and `pnpm why @pretable/core` lists exactly one version.
