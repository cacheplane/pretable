# Dawn Inspector Server Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dawn Memory Inspector's browse grid genuinely server-authoritative — every visible column's filter and the ordered sort are decided by the store, not by re-processing the 200 rows that happen to be loaded.

**Architecture:** The Inspector declares its six columns with real Pretable types and a `filterOperators` allowlist pruned to exactly the `BrowseFilter` grammar, constructs the grid with `processing={{ filter: "external", sort: "external" }}` so Pretable's funnels and header sort become pure *intent editors*, and maps that intent through one pure function (`toBrowseQuery`) into the shipped `BrowseQuery`. Paging becomes keyset load-more driven by a footer control that lives **outside** the `role="grid"` element, capped at a resident 1 000 records so a single head refresh always re-derives the whole resident span. The client-side namespace narrowing, the `gridEpoch` remount hack, and the whole `ValueSet` filter-translation layer are deleted.

**Tech Stack:** TypeScript 7, React 19, Next 16 (standalone Inspector app), Vitest 4 + jsdom + @testing-library/react, `@pretable/react@0.3.0` (external processing authority, `resultMeta`, `dataState`), `@dawn-ai/memory/browse` (pure `BrowseQuery`/validator/cursor subpath), pnpm + turbo + changesets.

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


## Preamble — read this before Task 1

### Traps learned the hard way in slices 1–3

1. **Line anchors rot.** `origin/main` moved five-plus times mid-execution during slices 1 and 2. Every "modify" step in this plan names a **symbol** (a function, a constant, a JSX element), never a line number. Locate with `git grep -n "<symbol>" -- packages/inspector` before editing. If a step's quoted "before" text does not match byte-for-byte, re-read the file and adapt — do not force the edit.
2. **A types-only assertion is invisible to `vitest run`.** esbuild strips types, so a test file that only asserts a *type* (`const _x: Foo = bar`, `satisfies`, `expectTypeOf`) passes vitest even when it is red. Any type-level assertion in this plan is verified with `pnpm --filter @dawn-ai/inspector typecheck`, and the plan says so explicitly at each site.
3. **Stale `dist/` and turbo cache produce fake passes.** `packages/inspector` resolves the bare `@dawn-ai/memory` specifier to that package's **built `dist/`**; only the `@dawn-ai/memory/browse` *subpath* is source-aliased in `vitest.components.config.ts`. Before believing any typecheck result, run `pnpm --filter @dawn-ai/memory build`. Before believing any full-repo `pnpm test`, prefer `turbo run test --force` or a direct `vitest` invocation on the file you changed.
4. **Never `git stash`.** The stash stack is shared across every worktree on this machine and a parallel session's `pop` can steal your entry. Commit a WIP instead, or write a patch file.
5. **This machine runs concurrent sessions at load 55–160.** A vitest timeout at the 5 s default is usually load, not a bug. Re-run the single file with `--testTimeout=20000` before believing a failure.
6. **Re-check `origin/main` between tasks.** `git fetch origin && git log --oneline -5 origin/main`. Another session may have landed work in `packages/inspector`.

### What is already shipped (verified, do not re-derive)

**Pretable — published `@pretable/core@0.3.0`, `@pretable/react@0.3.0`, `@pretable/ui@0.3.0`.** Slice 3 pinned Dawn to these. The symbols this slice uses:

| Symbol | Package | Semantics this plan relies on |
| --- | --- | --- |
| `PretableProcessingOptions { filter?, sort? }` | `@pretable/core`, re-exported by `@pretable/react` | Construction-time. `usePretable` reads it as its two **scalar** fields, so an inline object literal does **not** rebuild the grid. |
| `processing.filter === "external"` | engine | Filter state is displayed (funnel indicators, `snapshot.filters`) and never applied to loaded records. Also unlocks `resultMeta.total`: under engine authority a supplied total is ignored with a dev warning. |
| `processing.sort === "external"` | engine | Sort state is displayed (header arrows, priority badges) and the model order is the supplied record order. |
| `PretableBaseColumn.filterOperators?: FilterOperator[]` | core | `operatorsForType` **intersects** it with the per-type set and keeps the per-type ORDER. An empty intersection dev-warns and falls back to the full set — so operator names must be valid for the column's `type`. |
| `PretableBaseColumn.sortable?: boolean` | core | `sanitizeSortEntries` drops entries for `sortable: false` columns; the header click handler returns early for them. This is how a consumer declares a server-unsortable column. |
| `setRows(rows, meta?)` / `setResultMeta(meta)` | core | Rows and meta land in one emit. |
| `PretableResultMeta { total?, datasetKey? }` | core | A **changed** `datasetKey` clears selection, focus, group-expansion overrides, the in-flight edit and the supplied total. The **first** key is an assignment, not a pivot. |
| `resolveDataScope` | react (internal) | Scope is `"loaded"` whenever `processing.filter === "external"` **and** `total.kind === "exact"` **and** `total.count > loadedRowCount`. It drives `selectAllLabel`, `copyAnnouncement`, `resultsAnnouncement` and `groupChildCountLabel`. |
| `resolveAriaRowCount` | react (internal) | `aria-rowcount = total.count + 1` only under **both** authorities external, ungrouped, `kind: "exact"`. Grouping downgrades to `visibleRows.length + 1`. |
| default `groupChildCountLabel` | react | `scope === "loaded" ? "(N loaded)" : "(N)"`. |
| `onGridReady?: (grid) => void` | react | The supported way to get an imperative handle (`grid.clearSelection()`). |
| `PretableSurfaceState { filters?, sort?, selection?, focus?, rowGroups?, … }` | react | Controlled display state. Under external authority it is display-only. |

**Implementation deviations from the design document — verified in the shipped code. Your plan-reading assumptions must match these, not §4 of the design:**

- `staleAnnouncement` exists as a `messages` entry; announcements have a priority order in which an error outranks a pending user message.
- **No body-state block carries a live-region role.** The >0-loaded error strip ships as `data-pretable-body-state="error-strip"` with no `role="status"`; failures reach AT through `dataErrorAnnouncement` on the surface's single polite region.
- A `datasetKey` pivot **latches controlled `selection` AND controlled `focus`**: a controlled slice whose *value* is unchanged across the pivot is not re-applied. The consumer takes control back by supplying a value minted for the new dataset. (This slice therefore leaves selection **uncontrolled** and clears it imperatively — see Task 8.)
- `dataState` has **no default**. Omitting it turns lifecycle presentation entirely off. The search-results grids in this slice deliberately omit it.
- `resultsAnnouncement` takes `scope` in addition to `{ loaded, total, added }`; `renderBodyState` receives `kind: PretableBodyStateKind` (`"loading" | "empty" | "error" | "error-strip"`).

**Dawn — merged on `origin/main` at `8398c908` ("a real query language for browse").** The pure subpath `@dawn-ai/memory/browse` exports `BrowseFilter`, `BrowseQuery`, `BrowsePage`, `BrowseSortEntry`, `BrowseSortField`, `BrowseQueryError`, `validateBrowseQuery`, `BROWSE_MAX_LIMIT` (1000), `BROWSE_DEFAULT_LIMIT` (50), `browseQueryFingerprint`, `encodeBrowseCursor`/`decodeBrowseCursor`. Facts this slice depends on:

- `BrowseQuery` carries `namespace` (**exact**, byte-exact, case-sensitive — distinct from `namespacePrefix`), `filters`, `orderBy`, `cursor`. `BrowsePage` carries `records`, `total`, `continuation: string | null`.
- `validateBrowseQuery` rejects: an empty `values` list on a `status`/`kind` filter, more than one filter per field, more than 8 filters, **more than 3 `orderBy` entries**, a repeated `orderBy` field, non-finite confidence, a non-`YYYY-MM-DD` day, `fromDay > untilDay`, `min > max`.
- The `limit` ceiling `BROWSE_MAX_LIMIT = 1000` is enforced **at the HTTP route only** (`parseBrowseQuery` passes `{ maxLimit: BROWSE_MAX_LIMIT }`); the stores keep their own `>= 0` clamp so the CLI's 10 000-row distillation scan still works.
- `browseQueryFingerprint` canonicalizes: filter arrays are sorted by their canonical string, set values are sorted, and `limit`/`offset`/`cursor` are excluded. So filter **array order does not change the fingerprint** — but this plan still emits filters in a deterministic order so the *client-side* `datasetKey` hash is stable too.
- The route encodes `filters` and `orderBy` as **JSON query params** and `namespace`/`cursor` as plain params (`parseBrowseQuery` in `packages/inspector/src/store/browse-params.ts`).
- The `/api/memory/search` route hard-codes `status: "active"`, takes **no** kind, and honors `namespace` exactly. That is why browse-only controls must be honestly disabled while a search query is active.

### The slice-3 seam this plan assumes

Slice 3 shipped `packages/inspector/src/components/memory/use-memory-browse.ts`. This plan calls it with, and reads from it, exactly these names:

```ts
export interface UseMemoryBrowseInput {
  /** The canonical query MINUS paging. The hook owns `limit`, `cursor` and the
   *  pinned `now` generation; a caller that sets them breaks continuation. */
  readonly query: BrowseQuery
  /** Poll only while this is true (live toggle ∧ visible tab ∧ no active search). */
  readonly live: boolean
}
export interface UseMemoryBrowseResult {
  readonly rows: readonly MemoryRecord[]
  readonly resultMeta: PretableResultMeta   // { total: {kind:"exact",count}, datasetKey }
  readonly dataState: PretableDataState
  /** The newest fulfilled response's `continuation !== null`. */
  readonly hasMore: boolean
  loadMore(): void
  refresh(): void
  retry(): void
}
export function useMemoryBrowse(input: UseMemoryBrowseInput): UseMemoryBrowseResult
```

**Task 1 verifies this by reading the file.** If slice 3 named something differently, **rename it in slice 3's file to match this plan** and re-run slice 3's tests. Dawn is pre-1.0 with a single in-repo consumer; there are no deprecation aliases and no compatibility shims. Do not fork a second vocabulary.

### Design sections this slice implements

§5.1 (the six-column declaration table and `toBrowseQuery`), §5.2 (per-field semantics the mapping must respect), §6.2 (keyset continuation + resident cap), §8.2 (the view-scope matrix), §9.2 (keyboard topology — the footer outside the grid), §9.3 (selection and bulk scope), §9.4 (grouping honesty), and Flows **3** (sort change), **5** (next window), **10** (view switching), **11** (select → change window → bulk), **12** (grouping on a partial dataset) of §7.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/inspector/src/components/memory/memory-domain.ts` | **CREATE.** The closed `MemoryStatus`/`MemoryKind` value lists plus runtime guards. Pure; imported by the grid columns and by the query mapping so both agree on one universe. |
| `packages/inspector/src/components/memory/browse-window.ts` | **CREATE.** Paging constants (`BROWSE_PAGE_SIZE`, `BROWSE_RESIDENT_CAP`), `dedupeById`, and `loadMoreState`. Pure; the resident cap is pinned equal to `BROWSE_MAX_LIMIT` here. |
| `packages/inspector/src/components/memory/to-browse-query.ts` | **CREATE.** The only translation from Pretable filter/sort intent to `BrowseFilter[]`/`BrowseSortEntry[]`. Throws `BrowseQueryError` on anything unmappable. |
| `packages/inspector/src/components/memory/load-more-footer.tsx` | **CREATE.** The keyset load-more control, rendered outside the `role="grid"` element, always mounted, always focusable. |
| `packages/inspector/src/components/memory/memory-grid.tsx` | **MODIFY.** Column metadata (`type`, `options`, `filterOperators`, `sortable`), external processing authority, controlled sort, `onGridReady` pass-through. |
| `packages/inspector/src/components/memory/list-page.tsx` | **MODIFY.** Builds the canonical `BrowseQuery`, owns filter/sort intent state, exact-namespace facet, footer placement, view scoping, `gridEpoch` deletion, bulk wiring. |
| `packages/inspector/src/components/memory/facet-rail.tsx` | **MODIFY.** Labels its counts as global. |
| `packages/inspector/src/components/memory/use-memory-browse.ts` | **MODIFY (slice-3 file).** Appends through the shared `dedupeById`; reads the shared paging constants. |
| `packages/inspector/src/components/memory/column-filters.ts` | **DELETE.** The `ValueSet` translation layer exists only because the server could not express operators; it can now. |
| `packages/inspector/test/components/to-browse-query.test.ts` | **CREATE.** Every arm of the mapping, every throw. |
| `packages/inspector/test/components/browse-window.test.ts` | **CREATE.** Cap/limit equality, dedupe, load-more state machine. |
| `packages/inspector/test/components/load-more.test.tsx` | **CREATE.** Footer topology, labels, append behavior, cap. |
| `packages/inspector/test/components/view-scope.test.tsx` | **CREATE.** §8.2 disabled-with-reason, facet-rail labeling, Flow 10 retention. |
| `packages/inspector/test/components/memory-grid.test.tsx` | **MODIFY.** Local sorting/filtering assertions become intent-emission assertions. |
| `packages/inspector/test/components/column-filter-wiring.test.tsx` | **MODIFY.** Filters now travel as the `filters` JSON param. |
| `packages/inspector/test/components/list.test.tsx` | **MODIFY.** The facet sends `namespace`, not `namespacePrefix` + client narrowing. |
| `packages/inspector/test/components/grouping.test.tsx` | **MODIFY.** Loaded-scope child counts. |
| `packages/inspector/test/components/bulk-actions.test.tsx` | **MODIFY.** Bulk bar reads the resident rows; clearing no longer remounts. |
| `packages/inspector/test/components/column-filters.test.ts` | **DELETE.** |
| `.changeset/inspector-server-authority.md` | **CREATE.** One patch changeset for the fixed version group. |

---

## Task 1: Preflight — pin the shipped surface and the slice-3 seam

**Files:** none modified. This task produces facts, not code.

- [ ] **Step 1: Sync both repos and record the commits**

```bash
cd /Users/blove/repos/dawn && git fetch origin && git log --oneline -3 origin/main
```

Expected: `origin/main` at `8398c908` or later, and the slice-3 commit ("orchestration", `useMemoryBrowse`) present. Write both hashes into your working notes. If slice 3 is **not** on `origin/main`, stop and report — this plan depends on it.

- [ ] **Step 2: Confirm the Pretable pin**

```bash
cd /Users/blove/repos/dawn && node -p "JSON.stringify(require('./packages/inspector/package.json').dependencies,null,1)" | grep pretable
```

Expected: `"@pretable/core": "0.3.0"`, `"@pretable/react": "0.3.0"`, `"@pretable/ui": "0.3.0"`. If it still reads `0.0.8`, slice 3 did not land its version bump: set all three to `0.3.0`, run `pnpm install`, and commit that alone before continuing.

- [ ] **Step 3: Prove the external-authority symbols exist in the installed package**

```bash
cd /Users/blove/repos/dawn && grep -c "PretableProcessingOptions\|filterOperators\|datasetKey" node_modules/@pretable/react/dist/index.d.ts
```

Expected: a count of **3 or more**. A `0` means the install is stale — run `pnpm install --force` and retry.

- [ ] **Step 4: Read the slice-3 hook and reconcile its names**

```bash
cd /Users/blove/repos/dawn && grep -n "export interface UseMemoryBrowse\|export function useMemoryBrowse\|hasMore\|loadMore\|continuation\|resultMeta\|dataState" packages/inspector/src/components/memory/use-memory-browse.ts
```

Compare against the seam table in the Preamble. For every name that differs, rename **in slice 3's file** (and its tests) to the name this plan uses, then run `pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000` and confirm slice 3's own tests still pass. Commit any rename separately:

```bash
git add packages/inspector && git commit -m "refactor(inspector): align useMemoryBrowse names with the slice 4 seam"
```

- [ ] **Step 5: Build the memory package so typechecks are meaningful**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/memory build && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: both succeed with no output. A failure here is pre-existing and must be fixed or reported before any task below.

---

## Task 2: `memory-domain.ts` — one universe for statuses and kinds

**Files:**
- Create: `packages/inspector/src/components/memory/memory-domain.ts`
- Create: `packages/inspector/test/components/memory-domain.test.ts`
- Modify: `packages/inspector/src/components/memory/memory-grid.tsx`
- Modify: `packages/inspector/src/components/memory/list-page.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/memory-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { isMemoryKind, isMemoryStatus, KINDS, STATUSES } from "../../src/components/memory/memory-domain"

describe("memory domain sets", () => {
  it("spells out every status and kind the store defines", () => {
    expect([...STATUSES]).toEqual(["candidate", "active", "superseded"])
    expect([...KINDS]).toEqual(["semantic", "episodic", "procedural", "reflection"])
  })

  it("guards accept members and reject anything else", () => {
    expect(isMemoryStatus("candidate")).toBe(true)
    expect(isMemoryStatus("actve")).toBe(false)
    expect(isMemoryKind("reflection")).toBe(true)
    expect(isMemoryKind("")).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/memory-domain.test.ts --testTimeout=20000
```

Expected: FAIL — `Failed to resolve import "../../src/components/memory/memory-domain"`.

- [ ] **Step 3: Write the module**

Create `packages/inspector/src/components/memory/memory-domain.ts`:

```ts
import type { MemoryKind, MemoryStatus } from "@dawn-ai/memory/browse"

/**
 * The closed sets the funnels offer and the query mapping validates against.
 *
 * They live here rather than beside the columns because two unrelated modules
 * need the SAME universe: `memory-grid.tsx` turns them into `column.options`
 * (the funnel checklist), and `to-browse-query.ts` checks a ticked value
 * against them before it reaches `BrowseFilter.values`. A drifting second copy
 * would let the funnel offer a value the server rejects with a 400.
 */
export const STATUSES = ["candidate", "active", "superseded"] as const satisfies readonly MemoryStatus[]
export const KINDS = [
  "semantic",
  "episodic",
  "procedural",
  "reflection",
] as const satisfies readonly MemoryKind[]

export function isMemoryStatus(value: string): value is MemoryStatus {
  return (STATUSES as readonly string[]).includes(value)
}

export function isMemoryKind(value: string): value is MemoryKind {
  return (KINDS as readonly string[]).includes(value)
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/memory-domain.test.ts --testTimeout=20000
```

Expected: PASS, 2 tests.

- [ ] **Step 5: Move the old declarations out of `memory-grid.tsx`**

In `packages/inspector/src/components/memory/memory-grid.tsx`, delete these two exported constants:

```tsx
/** The closed sets the funnels offer, and what `isNoneOf` is complemented
 *  against. Kept here beside the columns that use them. */
export const STATUSES: readonly MemoryStatus[] = ["candidate", "active", "superseded"]
export const KINDS: readonly MemoryKind[] = ["semantic", "episodic", "procedural", "reflection"]
```

and add this import beside the existing imports:

```tsx
import { KINDS, STATUSES } from "./memory-domain"
```

- [ ] **Step 6: Repoint the list page's import**

In `packages/inspector/src/components/memory/list-page.tsx`, replace:

```tsx
import { KINDS, MemoryGrid, STATUSES } from "./memory-grid"
```

with:

```tsx
import { KINDS, STATUSES } from "./memory-domain"
import { MemoryGrid } from "./memory-grid"
```

- [ ] **Step 7: Run the whole component suite and typecheck**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000 && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: all component tests pass; typecheck silent.

- [ ] **Step 8: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector/src/components/memory/memory-domain.ts packages/inspector/test/components/memory-domain.test.ts packages/inspector/src/components/memory/memory-grid.tsx packages/inspector/src/components/memory/list-page.tsx && git commit -m "refactor(inspector): give the status and kind universes one home"
```

---

## Task 3: `browse-window.ts` — paging constants, dedupe, and the load-more state machine

**Files:**
- Create: `packages/inspector/src/components/memory/browse-window.ts`
- Create: `packages/inspector/test/components/browse-window.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/browse-window.test.ts`:

```ts
import { BROWSE_MAX_LIMIT } from "@dawn-ai/memory/browse"
import { describe, expect, it } from "vitest"
import {
  BROWSE_PAGE_SIZE,
  BROWSE_RESIDENT_CAP,
  dedupeById,
  loadMoreState,
} from "../../src/components/memory/browse-window"

describe("browse window constants", () => {
  it("caps residency at exactly the maximum request limit", () => {
    // The head refresh re-derives the WHOLE resident span in one request. If the
    // cap ever exceeded the max limit, that single request could not cover it and
    // the ≤ one-poll-period convergence guarantee would silently stop holding.
    expect(BROWSE_RESIDENT_CAP).toBe(BROWSE_MAX_LIMIT)
    expect(BROWSE_RESIDENT_CAP).toBe(1000)
  })

  it("pages in fifths of the cap", () => {
    expect(BROWSE_PAGE_SIZE).toBe(200)
    expect(BROWSE_RESIDENT_CAP % BROWSE_PAGE_SIZE).toBe(0)
  })
})

describe("dedupeById", () => {
  const a = { id: "a", n: 1 }
  const b = { id: "b", n: 2 }
  const bAgain = { id: "b", n: 99 }
  const c = { id: "c", n: 3 }

  it("appends records that are new", () => {
    expect(dedupeById([a], [b, c])).toEqual([a, b, c])
  })

  it("drops an appended record whose id is already resident, keeping the resident copy", () => {
    // A keyset walk can re-emit one row when a sort-key edit crosses the cursor
    // downward. The resident copy stays because it holds the position the grid
    // already rendered; the refresh tick is what repairs a stale payload.
    expect(dedupeById([a, b], [bAgain, c])).toEqual([a, b, c])
  })

  it("de-duplicates within the appended page as well", () => {
    expect(dedupeById([], [b, bAgain, c])).toEqual([b, c])
  })

  it("returns the resident array itself when the page adds nothing", () => {
    const resident = [a, b]
    expect(dedupeById(resident, [bAgain])).toBe(resident)
  })
})

describe("loadMoreState", () => {
  it("offers a load while a continuation exists and the cap is clear", () => {
    expect(loadMoreState({ phase: "idle", loaded: 200, hasMore: true })).toBe("available")
  })

  it("reports exhaustion when the server issued no continuation", () => {
    expect(loadMoreState({ phase: "idle", loaded: 137, hasMore: false })).toBe("exhausted")
  })

  it("reports the cap even when more rows exist server-side", () => {
    expect(loadMoreState({ phase: "idle", loaded: 1000, hasMore: true })).toBe("at-cap")
  })

  it("is busy while a tail extension is in flight", () => {
    expect(loadMoreState({ phase: "loading-more", loaded: 200, hasMore: true })).toBe("loading")
  })

  it("is unavailable while the visible rows answer a previous query", () => {
    // Extending a window that is about to be replaced spends a request on a
    // dataset the user has already left.
    expect(loadMoreState({ phase: "stale", loaded: 200, hasMore: true })).toBe("unavailable")
    expect(loadMoreState({ phase: "loading", loaded: 0, hasMore: false })).toBe("unavailable")
    expect(loadMoreState({ phase: "error", loaded: 200, hasMore: true })).toBe("unavailable")
  })

  it("allows a load during a background refresh — the hook queues it", () => {
    expect(loadMoreState({ phase: "refreshing", loaded: 200, hasMore: true })).toBe("available")
  })
})
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/browse-window.test.ts --testTimeout=20000
```

Expected: FAIL — `Failed to resolve import "../../src/components/memory/browse-window"`.

- [ ] **Step 3: Write the module**

Create `packages/inspector/src/components/memory/browse-window.ts`:

```ts
import { BROWSE_MAX_LIMIT } from "@dawn-ai/memory/browse"
import type { PretableDataState } from "@pretable/react"

/** Records requested per window — the Inspector's page size, not the API default (50). */
export const BROWSE_PAGE_SIZE = 200

/**
 * How many records the client keeps resident.
 *
 * Deliberately EQUAL to the maximum request limit. Every poll tick refetches the
 * offset-0 window with `limit = resident count` to re-derive the whole resident
 * span from one transaction snapshot; a cap above the max limit would make that
 * impossible in a single request, and the "converges within one poll period"
 * guarantee would quietly become aspiration. Raising one means raising both.
 */
export const BROWSE_RESIDENT_CAP = BROWSE_MAX_LIMIT

/** Anything with a stable string id — records, grid rows. */
interface Identified {
  readonly id: string
}

/**
 * Append `page` onto `resident`, keeping the FIRST occurrence of each id.
 *
 * Belt and suspenders for the one keyset duplicate case: a sort-key edit that
 * moves a row downward across the cursor between two windows. The resident copy
 * wins because it holds the position already rendered — a refresh tick, not an
 * append, is what repairs a stale payload. Returns `resident` unchanged (same
 * reference) when the page contributes nothing, so React skips the re-render.
 */
export function dedupeById<T extends Identified>(
  resident: readonly T[],
  page: readonly T[],
): readonly T[] {
  const seen = new Set(resident.map((row) => row.id))
  const additions: T[] = []
  for (const row of page) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    additions.push(row)
  }
  return additions.length === 0 ? resident : [...resident, ...additions]
}

/**
 * What the load-more control can offer right now.
 *
 * `"unavailable"` covers every phase where extending the window would extend the
 * wrong dataset: `stale` (a new query is in flight), `loading` (nothing is
 * fulfilled yet) and `error` (the desired revision has no fulfilled answer).
 * `refreshing` is NOT one of those — same query, and the hook queues a
 * load-more requested mid-tick rather than dropping it.
 */
export type LoadMoreState = "available" | "loading" | "exhausted" | "at-cap" | "unavailable"

export function loadMoreState(input: {
  readonly phase: PretableDataState["phase"]
  readonly loaded: number
  readonly hasMore: boolean
}): LoadMoreState {
  if (input.phase === "loading-more") return "loading"
  if (input.phase !== "idle" && input.phase !== "refreshing") return "unavailable"
  if (!input.hasMore) return "exhausted"
  if (input.loaded >= BROWSE_RESIDENT_CAP) return "at-cap"
  return "available"
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/browse-window.test.ts --testTimeout=20000
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Route the slice-3 hook through the shared constants and dedupe**

```bash
cd /Users/blove/repos/dawn && grep -n "200\|1000\|concat\|\.\.\.prev\|records\]" packages/inspector/src/components/memory/use-memory-browse.ts
```

In `use-memory-browse.ts`: delete any locally declared page-size or resident-cap constant, import `BROWSE_PAGE_SIZE`, `BROWSE_RESIDENT_CAP` and `dedupeById` from `./browse-window`, and replace the load-more append expression (whatever concatenates the response records onto the resident rows) with:

```ts
dedupeById(resident, page.records)
```

where `resident` is the hook's existing resident-rows variable. Keep the `total` and `continuation` assignments exactly as they are.

- [ ] **Step 6: Run the whole component suite**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000 && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: all pass. (If a slice-3 test asserted a locally-named constant, update it to import from `browse-window.ts`.)

- [ ] **Step 7: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector && git commit -m "feat(inspector): pin the resident cap to the max request limit, and share the append dedupe"
```

---

## Task 4: `to-browse-query.ts` — the intent mapping that throws instead of dropping

**Files:**
- Create: `packages/inspector/src/components/memory/to-browse-query.ts`
- Create: `packages/inspector/test/components/to-browse-query.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/to-browse-query.test.ts`:

```ts
import type { ColumnFilter, PretableSortEntry } from "@pretable/react"
import { describe, expect, it } from "vitest"
import {
  capSortEntries,
  MAX_BROWSE_SORT_ENTRIES,
  toBrowseQuery,
} from "../../src/components/memory/to-browse-query"

const noSort: PretableSortEntry[] = []

function filters(map: Record<string, ColumnFilter>) {
  return toBrowseQuery(map, noSort)
}

describe("toBrowseQuery — enum columns", () => {
  it("maps isAnyOf to in", () => {
    expect(filters({ status: { operator: "isAnyOf", value: ["candidate", "active"] } })).toEqual({
      filters: [{ field: "status", op: "in", values: ["candidate", "active"] }],
    })
  })

  it("maps isNoneOf to notIn without complementing the set", () => {
    // The server expresses negation directly now, so the old client-side
    // complement (which needed the full option list) is gone.
    expect(filters({ kind: { operator: "isNoneOf", value: ["episodic"] } })).toEqual({
      filters: [{ field: "kind", op: "notIn", values: ["episodic"] }],
    })
  })

  it("throws on a value outside the declared universe", () => {
    expect(() => filters({ status: { operator: "isAnyOf", value: ["actve"] } })).toThrow(
      /"actve" is not a memory status/,
    )
  })

  it("throws on an empty value list", () => {
    // Pretable deletes an inactive filter, so an empty list can only be a bug —
    // and the store rejects it with a 400 rather than reading it as unfiltered.
    expect(() => filters({ status: { operator: "isAnyOf", value: [] } })).toThrow(
      /non-empty value list/,
    )
  })
})

describe("toBrowseQuery — text columns", () => {
  it("maps every content operator one to one", () => {
    const ops = [
      ["contains", "contains"],
      ["notContains", "notContains"],
      ["equals", "equals"],
      ["notEquals", "notEquals"],
      ["startsWith", "startsWith"],
      ["endsWith", "endsWith"],
    ] as const
    for (const [pretable, browse] of ops) {
      expect(filters({ content: { operator: pretable, value: "acme" } })).toEqual({
        filters: [{ field: "content", op: browse, value: "acme" }],
      })
    }
  })

  it("keeps whitespace inside a content value — it is significant", () => {
    expect(filters({ content: { operator: "contains", value: " acme " } })).toEqual({
      filters: [{ field: "content", op: "contains", value: " acme " }],
    })
  })

  it("maps the namespace column's two operators", () => {
    expect(filters({ namespace: { operator: "startsWith", value: "route=/" } })).toEqual({
      filters: [{ field: "namespace", op: "startsWith", value: "route=/" }],
    })
    expect(filters({ namespace: { operator: "equals", value: "route=/notes" } })).toEqual({
      filters: [{ field: "namespace", op: "equals", value: "route=/notes" }],
    })
  })

  it("throws when the namespace column is handed a content-only operator", () => {
    expect(() => filters({ namespace: { operator: "contains", value: "notes" } })).toThrow(
      /operator "contains" on column "namespace"/,
    )
  })
})

describe("toBrowseQuery — confidence", () => {
  it("renames the comparison operators to the store's spelling", () => {
    const ops = [
      ["equals", "eq"],
      ["notEquals", "neq"],
      ["gt", "gt"],
      ["gte", "gte"],
      ["lt", "lt"],
      ["lte", "lte"],
    ] as const
    for (const [pretable, browse] of ops) {
      expect(filters({ confidence: { operator: pretable, value: 0.5 } })).toEqual({
        filters: [{ field: "confidence", op: browse, value: 0.5 }],
      })
    }
  })

  it("splits a between range into min and max", () => {
    expect(filters({ confidence: { operator: "between", value: [0.25, 0.75] } })).toEqual({
      filters: [{ field: "confidence", op: "between", min: 0.25, max: 0.75 }],
    })
  })

  it("throws on a non-numeric confidence operand", () => {
    expect(() => filters({ confidence: { operator: "gt", value: "high" } })).toThrow(
      /finite number/,
    )
  })
})

describe("toBrowseQuery — updated", () => {
  it("maps the day operators", () => {
    const ops = [
      ["on", "onDay"],
      ["before", "beforeDay"],
      ["after", "afterDay"],
    ] as const
    for (const [pretable, browse] of ops) {
      expect(filters({ updated: { operator: pretable, value: "2026-08-09" } })).toEqual({
        filters: [{ field: "updatedAt", op: browse, day: "2026-08-09" }],
      })
    }
  })

  it("maps dateBetween to an inclusive day range", () => {
    expect(filters({ updated: { operator: "dateBetween", value: ["2026-08-01", "2026-08-09"] } })).toEqual(
      { filters: [{ field: "updatedAt", op: "betweenDays", fromDay: "2026-08-01", untilDay: "2026-08-09" }] },
    )
  })

  it("throws on a value the date input could not have produced", () => {
    expect(() => filters({ updated: { operator: "on", value: "2026-08-09T12:00:00.000Z" } })).toThrow(
      /"YYYY-MM-DD" day/,
    )
  })
})

describe("toBrowseQuery — refusals", () => {
  it("throws on isEmpty and isNotEmpty rather than dropping them", () => {
    // No BrowseFilter arm expresses them, every browse field is NOT NULL, and a
    // silent drop is exactly the active-looking-but-ignored control this design
    // exists to kill. The column's filterOperators keep them off the menu; this
    // throw is the backstop that makes a menu regression loud.
    expect(() => filters({ content: { operator: "isEmpty" } })).toThrow(
      /operator "isEmpty" on column "content"/,
    )
    expect(() => filters({ confidence: { operator: "isNotEmpty" } })).toThrow(
      /operator "isNotEmpty" on column "confidence"/,
    )
  })

  it("throws on a column with no server predicate at all", () => {
    expect(() => filters({ tags: { operator: "contains", value: "x" } })).toThrow(
      /column "tags" has no browse filter field/,
    )
  })
})

describe("toBrowseQuery — composition", () => {
  it("omits both keys when there is no intent", () => {
    expect(toBrowseQuery({}, noSort)).toEqual({})
  })

  it("emits filters in a deterministic column order regardless of insertion order", () => {
    const a = toBrowseQuery(
      { status: { operator: "isAnyOf", value: ["active"] }, kind: { operator: "isAnyOf", value: ["semantic"] } },
      noSort,
    )
    const b = toBrowseQuery(
      { kind: { operator: "isAnyOf", value: ["semantic"] }, status: { operator: "isAnyOf", value: ["active"] } },
      noSort,
    )
    expect(a).toEqual(b)
    expect(a.filters?.map((f) => f.field)).toEqual(["kind", "status"])
  })
})

describe("toBrowseQuery — sort", () => {
  it("maps the column ids to sort fields, keeping priority order", () => {
    expect(
      toBrowseQuery({}, [
        { columnId: "confidence", direction: "desc" },
        { columnId: "updated", direction: "asc" },
      ]),
    ).toEqual({
      orderBy: [
        { field: "confidence", dir: "desc" },
        { field: "updatedAt", dir: "asc" },
      ],
    })
  })

  it("throws for the content column, which the whitelist has no field for", () => {
    expect(() => toBrowseQuery({}, [{ columnId: "content", direction: "asc" }])).toThrow(
      /column "content" is not a sortable browse field/,
    )
  })

  it("throws above the validator's orderBy ceiling", () => {
    const four: PretableSortEntry[] = [
      { columnId: "status", direction: "asc" },
      { columnId: "kind", direction: "asc" },
      { columnId: "namespace", direction: "asc" },
      { columnId: "confidence", direction: "asc" },
    ]
    expect(() => toBrowseQuery({}, four)).toThrow(/at most 3 sort columns/)
  })
})

describe("capSortEntries", () => {
  it("keeps the highest-priority entries and drops the excess", () => {
    const four: PretableSortEntry[] = [
      { columnId: "status", direction: "asc" },
      { columnId: "kind", direction: "asc" },
      { columnId: "namespace", direction: "asc" },
      { columnId: "confidence", direction: "asc" },
    ]
    expect(capSortEntries(four)).toEqual(four.slice(0, 3))
    expect(MAX_BROWSE_SORT_ENTRIES).toBe(3)
  })

  it("returns the same array when nothing needs dropping", () => {
    const two: PretableSortEntry[] = [{ columnId: "status", direction: "asc" }]
    expect(capSortEntries(two)).toEqual(two)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/to-browse-query.test.ts --testTimeout=20000
```

Expected: FAIL — `Failed to resolve import "../../src/components/memory/to-browse-query"`.

- [ ] **Step 3: Write the module**

Create `packages/inspector/src/components/memory/to-browse-query.ts`:

```ts
import {
  type BrowseFilter,
  BrowseQueryError,
  type BrowseSortEntry,
  type BrowseSortField,
} from "@dawn-ai/memory/browse"
import type { ColumnFilter, FilterOperator, PretableSortEntry } from "@pretable/react"
import { isMemoryKind, isMemoryStatus } from "./memory-domain"

/** The two query parts a grid can express. Keys are OMITTED when empty rather
 *  than emitted as `[]`, so an unfiltered query serializes identically however
 *  it was reached — which keeps the client-side datasetKey hash stable. */
export interface BrowseQueryIntent {
  readonly filters?: readonly BrowseFilter[]
  readonly orderBy?: readonly BrowseSortEntry[]
}

/** The validator's ceiling, restated where the UI can enforce it. */
export const MAX_BROWSE_SORT_ENTRIES = 3

/** Grid column id → the `BrowseFilter` field it edits. A column missing from
 *  this table has no server predicate, so its funnel must not exist. */
const FILTER_FIELD_BY_COLUMN = {
  status: "status",
  kind: "kind",
  content: "content",
  namespace: "namespace",
  confidence: "confidence",
  updated: "updatedAt",
} as const satisfies Record<string, BrowseFilter["field"]>

/** Grid column id → sort field. `content` is deliberately absent: the store's
 *  whitelist has no content field (design §14 Q2), and the column declares
 *  `sortable: false` so this table is never asked for it. */
const SORT_FIELD_BY_COLUMN = {
  status: "status",
  kind: "kind",
  namespace: "namespace",
  confidence: "confidence",
  updated: "updatedAt",
} as const satisfies Record<string, BrowseSortField>

// Spelled out rather than Extract-ed: `Extract<BrowseFilter, {op: …}>` over the
// confidence arms matches BOTH of them (the `between` arm's op is a string too),
// which would quietly let `between` into the comparison table it must never be in.
type ContentOp = Extract<BrowseFilter, { field: "content" }>["op"]
type ConfidenceCompareOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte"
type DayOp = "onDay" | "beforeDay" | "afterDay"

const CONTENT_OP: Partial<Record<FilterOperator, ContentOp>> = {
  contains: "contains",
  notContains: "notContains",
  equals: "equals",
  notEquals: "notEquals",
  startsWith: "startsWith",
  endsWith: "endsWith",
}
const CONFIDENCE_OP: Partial<Record<FilterOperator, ConfidenceCompareOp>> = {
  equals: "eq",
  notEquals: "neq",
  gt: "gt",
  gte: "gte",
  lt: "lt",
  lte: "lte",
}
const DAY_OP: Partial<Record<FilterOperator, DayOp>> = {
  on: "onDay",
  before: "beforeDay",
  after: "afterDay",
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Every refusal in this module.
 *
 * It THROWS rather than dropping the clause. Once each column declares
 * `filterOperators`, an unmappable operator can only arrive from a column
 * declaration that drifted out of step with the store's grammar — a
 * programming error. Dropping it silently would leave a funnel that looks
 * applied and is not: the exact dishonesty this whole design exists to remove.
 * `BrowseQueryError` is reused so the Inspector has ONE rejection family, and
 * `isBrowseQueryError` (src/store/browse-params.ts) already recognises it
 * across the two module copies Next's bundler produces.
 */
function unmappable(detail: string): never {
  throw new BrowseQueryError(`cannot map grid intent to a browse query: ${detail}`, "unmappable-intent")
}

function badOperator(columnId: string, operator: FilterOperator): never {
  return unmappable(`operator "${operator}" on column "${columnId}" has no BrowseFilter arm`)
}

function asText(value: ColumnFilter["value"], label: string): string {
  // Untrimmed on purpose: whitespace is significant in a content predicate, and
  // the store compares the bytes it is given.
  if (typeof value !== "string" || value.trim() === "")
    unmappable(`${label} needs a non-empty text value, got ${JSON.stringify(value)}`)
  return value
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    unmappable(`${label} needs a finite number, got ${JSON.stringify(value)}`)
  return value
}

function asDay(value: unknown, label: string): string {
  if (typeof value !== "string" || !DAY_PATTERN.test(value))
    unmappable(`${label} needs a "YYYY-MM-DD" day, got ${JSON.stringify(value)}`)
  return value
}

// Both helpers widen through a local before the Array.isArray guard: TypeScript
// does not narrow a READONLY tuple/array member of a union through that guard,
// so indexing the original value straight after it is a type error.
function asPair(value: ColumnFilter["value"], label: string): readonly [unknown, unknown] {
  const list = value as readonly unknown[] | null
  if (!Array.isArray(list) || list.length !== 2)
    unmappable(`${label} needs a two-element range, got ${JSON.stringify(value)}`)
  return [list[0], list[1]] as const
}

function asValues(value: ColumnFilter["value"], label: string): readonly string[] {
  const list = value as readonly unknown[] | null
  if (!Array.isArray(list) || list.length === 0)
    unmappable(`${label} needs a non-empty value list, got ${JSON.stringify(value)}`)
  const out: string[] = []
  for (const entry of list) {
    if (typeof entry !== "string") unmappable(`${label} values must be strings, got ${JSON.stringify(entry)}`)
    out.push(entry)
  }
  return out
}

function setOp(columnId: string, operator: FilterOperator): "in" | "notIn" {
  if (operator === "isAnyOf") return "in"
  if (operator === "isNoneOf") return "notIn"
  return badOperator(columnId, operator)
}

function toBrowseFilter(columnId: string, filter: ColumnFilter): BrowseFilter {
  const field = FILTER_FIELD_BY_COLUMN[columnId as keyof typeof FILTER_FIELD_BY_COLUMN]
  if (field === undefined) unmappable(`column "${columnId}" has no browse filter field`)
  const { operator, value } = filter

  switch (field) {
    case "status": {
      const op = setOp(columnId, operator)
      const values = asValues(value, "status")
      for (const entry of values)
        if (!isMemoryStatus(entry)) unmappable(`"${entry}" is not a memory status`)
      return { field: "status", op, values: values.filter(isMemoryStatus) }
    }
    case "kind": {
      const op = setOp(columnId, operator)
      const values = asValues(value, "kind")
      for (const entry of values)
        if (!isMemoryKind(entry)) unmappable(`"${entry}" is not a memory kind`)
      return { field: "kind", op, values: values.filter(isMemoryKind) }
    }
    case "content": {
      const op = CONTENT_OP[operator]
      if (op === undefined) return badOperator(columnId, operator)
      return { field: "content", op, value: asText(value, "content") }
    }
    case "namespace": {
      if (operator !== "equals" && operator !== "startsWith") return badOperator(columnId, operator)
      return { field: "namespace", op: operator, value: asText(value, "namespace") }
    }
    case "confidence": {
      if (operator === "between") {
        const [min, max] = asPair(value, "confidence between")
        return {
          field: "confidence",
          op: "between",
          min: asNumber(min, "confidence min"),
          max: asNumber(max, "confidence max"),
        }
      }
      const op = CONFIDENCE_OP[operator]
      if (op === undefined) return badOperator(columnId, operator)
      return { field: "confidence", op, value: asNumber(value, "confidence") }
    }
    default: {
      if (operator === "dateBetween") {
        const [from, until] = asPair(value, "updated between")
        return {
          field: "updatedAt",
          op: "betweenDays",
          fromDay: asDay(from, "updated fromDay"),
          untilDay: asDay(until, "updated untilDay"),
        }
      }
      const op = DAY_OP[operator]
      if (op === undefined) return badOperator(columnId, operator)
      return { field: "updatedAt", op, day: asDay(value, "updated day") }
    }
  }
}

/**
 * Pretable filter/sort intent → the browse query's `filters` and `orderBy`.
 *
 * Pure and total for every intent the declared columns can produce; it throws
 * for everything else. Nothing Pretable-shaped crosses the store boundary.
 */
export function toBrowseQuery(
  filters: Record<string, ColumnFilter>,
  sort: readonly PretableSortEntry[],
): BrowseQueryIntent {
  const mapped: BrowseFilter[] = []
  // Sorted so one intent always serializes one way: the fingerprint the SERVER
  // computes is order-insensitive, but the datasetKey the CLIENT hashes is not,
  // and a re-ordered map would otherwise read as a new dataset.
  for (const columnId of Object.keys(filters).sort()) {
    const filter = filters[columnId]
    if (filter) mapped.push(toBrowseFilter(columnId, filter))
  }

  if (sort.length > MAX_BROWSE_SORT_ENTRIES)
    unmappable(`at most ${MAX_BROWSE_SORT_ENTRIES} sort columns, got ${sort.length}`)
  const orderBy: BrowseSortEntry[] = []
  for (const entry of sort) {
    const field = SORT_FIELD_BY_COLUMN[entry.columnId as keyof typeof SORT_FIELD_BY_COLUMN]
    if (field === undefined) unmappable(`column "${entry.columnId}" is not a sortable browse field`)
    orderBy.push({ field, dir: entry.direction })
  }

  return {
    ...(mapped.length > 0 ? { filters: mapped } : {}),
    ...(orderBy.length > 0 ? { orderBy } : {}),
  }
}

/**
 * Trim a sort intent to what the store accepts, keeping the HIGHEST-priority
 * entries.
 *
 * Pretable's shift-click appends the new key at the lowest priority, so the
 * fourth key is the one dropped: the user's existing ordering survives intact,
 * and the caller shows a notice saying the extra key was declined. Dropping the
 * primary key instead would silently re-rank a sort the user built on purpose.
 */
export function capSortEntries(entries: readonly PretableSortEntry[]): PretableSortEntry[] {
  return entries.slice(0, MAX_BROWSE_SORT_ENTRIES)
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/to-browse-query.test.ts --testTimeout=20000
```

Expected: PASS, 23 tests.

- [ ] **Step 5: Typecheck — the `satisfies` guards are invisible to vitest**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: no output. The `satisfies Record<string, BrowseFilter["field"]>` and `satisfies Record<string, BrowseSortField>` assertions on the two tables are checked **only** here — esbuild strips them, so a typo in a field name passes vitest silently.

- [ ] **Step 6: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector/src/components/memory/to-browse-query.ts packages/inspector/test/components/to-browse-query.test.ts && git commit -m "feat(inspector): map grid filter and sort intent onto the browse query"
```

---

## Task 5: Declare the six columns

**Files:**
- Modify: `packages/inspector/src/components/memory/memory-grid.tsx`
- Modify: `packages/inspector/test/components/memory-grid.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/inspector/test/components/memory-grid.test.tsx`, inside the existing `describe("MemoryGrid", …)` block:

```tsx
  it("offers only the operators the store can honor, on every column", () => {
    // Pretable appends isEmpty/isNotEmpty to every type by default and no
    // BrowseFilter arm expresses them, so an unpruned menu would show two
    // controls the server ignores.
    const expected: Record<string, string[]> = {
      status: ["is any of", "is none of"],
      kind: ["is any of", "is none of"],
      namespace: ["equals", "starts with"],
      content: [
        "contains",
        "does not contain",
        "equals",
        "does not equal",
        "starts with",
        "ends with",
      ],
      confidence: [
        "equals",
        "does not equal",
        "greater than",
        "greater than or equal",
        "less than",
        "less than or equal",
        "is between",
      ],
      updated: ["on", "before", "after", "is between"],
    }
    for (const [columnId, options] of Object.entries(expected)) {
      cleanup()
      render(<MemoryGrid records={[record({ id: "a" })]} onSelect={vi.fn()} />)
      fireEvent.click(screen.getByRole("button", { name: `Filter ${columnId}` }))
      const dialog = screen.getByRole("dialog", { name: `Filter ${columnId}` })
      const select = within(dialog).getByRole("combobox")
      expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(options)
    }
  })

  it("gives content no sort affordance — the store has no content sort field", () => {
    const onSortChange = vi.fn()
    const { container } = render(
      <MemoryGrid records={[record({ id: "a" }), record({ id: "b" })]} onSelect={vi.fn()} onSortChange={onSortChange} />,
    )
    fireEvent.click(headerFor(container, "content"))
    expect(onSortChange).not.toHaveBeenCalled()
    expect(headerFor(container, "content").getAttribute("aria-sort")).toBeNull()
  })
```

Add `within` to the `@testing-library/react` import at the top of the file if it is not already there.

- [ ] **Step 2: Run and see them fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/memory-grid.test.tsx --testTimeout=20000
```

Expected: FAIL — `Unable to find an accessible element with the role "button" and name "Filter namespace"` (namespace, content, confidence and updated are still `filterable: false`), and the content test fails because `MemoryGrid` has no `onSortChange` prop yet.

- [ ] **Step 3: Replace the `COLUMNS` array**

In `packages/inspector/src/components/memory/memory-grid.tsx`, replace the whole `const COLUMNS: PretableColumn<GridRow>[] = [ … ]` declaration with:

```tsx
/** Everything but `content` is sized to what it holds — a status badge, a
 *  namespace, a timestamp — and `content` takes whatever is left over, so the
 *  row ends on the container's edge at any window width. It carries the slack
 *  because it's the only column with unbounded text.
 *
 *  Every column declares `type`, and every FILTERABLE column declares
 *  `filterOperators` matching the `BrowseFilter` grammar exactly. That list is
 *  load-bearing, not cosmetic: Pretable appends `isEmpty`/`isNotEmpty` to every
 *  type's menu by default and no `BrowseFilter` arm expresses them (correctly —
 *  every browse field is NOT NULL), so an unpruned menu would offer two
 *  operators the server ignores. `operatorsForType` INTERSECTS this list with
 *  the per-type set, so a name that is not valid for the declared `type` is
 *  dropped — and a list that intersects to nothing dev-warns and falls back to
 *  the full menu. Change `type` and you must re-check this list. */
const COLUMNS: PretableColumn<GridRow>[] = [
  {
    id: "status",
    header: "status",
    widthPx: 104,
    type: "enum",
    filterable: true,
    filterOperators: ["isAnyOf", "isNoneOf"],
    options: STATUSES.map((value) => ({ value })),
    value: (row) => row.status,
    render: ({ row }) => <Badge variant={row.status}>{row.status}</Badge>,
  },
  {
    id: "content",
    header: "content",
    type: "text",
    filterable: true,
    filterOperators: ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"],
    // Design §14 Q2: the sort whitelist has no `content` field, so a sortable
    // header here would emit an orderBy the store rejects — and byte-order text
    // sorting over memory bodies is rarely what anyone wanted anyway. Search is
    // the ranked path.
    sortable: false,
    flex: 1,
    minWidthPx: 240,
    value: (row) => row.content,
    // Cells are flex containers, and text-overflow does nothing on one — so the
    // ellipsis has to live on an inner box. min-w-0 lets it shrink below its
    // text width; without it the flex item refuses to and the text just clips.
    render: ({ formattedValue }) => <span className="min-w-0 truncate">{formattedValue}</span>,
  },
  {
    id: "namespace",
    header: "namespace",
    widthPx: 190,
    type: "text",
    filterable: true,
    // Machine identifiers: byte-exact and case-sensitive on both backends, and
    // `startsWith` is served sargably as a range. `contains` is deliberately
    // absent — the store has no substring index for namespaces.
    filterOperators: ["equals", "startsWith"],
    value: (row) => row.namespace,
  },
  {
    id: "kind",
    header: "kind",
    widthPx: 100,
    type: "enum",
    filterable: true,
    filterOperators: ["isAnyOf", "isNoneOf"],
    options: KINDS.map((value) => ({ value })),
    value: (row) => row.kind,
  },
  {
    id: "confidence",
    header: "confidence",
    widthPx: 100,
    type: "number",
    filterable: true,
    filterOperators: ["equals", "notEquals", "gt", "gte", "lt", "lte", "between"],
    value: (row) => row.confidence,
    format: ({ value }) => Number(value).toFixed(2),
  },
  {
    id: "updated",
    header: "updated",
    widthPx: 180,
    // `date` gives the funnel a real date input, whose value is the
    // "YYYY-MM-DD" day `toBrowseQuery` maps onto the store's UTC day buckets.
    type: "date",
    filterable: true,
    filterOperators: ["on", "before", "after", "dateBetween"],
    value: (row) => row.updatedAt,
    format: ({ value }) => new Date(String(value)).toLocaleString(),
  },
]
```

- [ ] **Step 4: Add the sort props to `MemoryGrid`**

In the same file, extend the component's destructured props and prop type. Replace:

```tsx
export function MemoryGrid({
  records,
  onSelect,
  onTickedChange,
  groupByNamespace = false,
  filters,
  onFiltersChange,
}: {
```

with:

```tsx
export function MemoryGrid({
  records,
  onSelect,
  onTickedChange,
  groupByNamespace = false,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
}: {
```

and add these two entries to the prop type, immediately after `onFiltersChange`:

```tsx
  /** Ordered sort intent to display, and where changes go. Under server
   *  authority this is display state only — the model order is the order the
   *  server returned. Omit both to render without sort control. */
  sort?: PretableSortEntry[]
  onSortChange?: (next: PretableSortEntry[]) => void
```

Add `PretableSortEntry` to the `@pretable/react` type import at the top of the file:

```tsx
import {
  type ColumnFilter,
  type PretableColumn,
  type PretableSortEntry,
  PretableSurface,
  type PretableTelemetry,
} from "@pretable/react"
```

Extend `surfaceState` so sort travels with the other controlled slices. Replace:

```tsx
  const surfaceState = useMemo(
    () => ({
      rowGroups: groupByNamespace ? GROUP_BY_NAMESPACE : FLAT_ROWS,
      ...(filters ? { filters } : {}),
    }),
    [groupByNamespace, filters],
  )
```

with:

```tsx
  const surfaceState = useMemo(
    () => ({
      rowGroups: groupByNamespace ? GROUP_BY_NAMESPACE : FLAT_ROWS,
      ...(filters ? { filters } : {}),
      ...(sort ? { sort } : {}),
    }),
    [groupByNamespace, filters, sort],
  )
```

and forward the callback by replacing:

```tsx
      {...(onFiltersChange ? { onFiltersChange } : {})}
```

with:

```tsx
      {...(onFiltersChange ? { onFiltersChange } : {})}
      {...(onSortChange ? { onSortChange } : {})}
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/memory-grid.test.tsx --testTimeout=20000
```

Expected: PASS. Two pre-existing tests — `"clicking a column header sorts the rows by that column"` and `"sorts the updated column chronologically, not by its displayed text"` — still pass here because this task has not yet turned on external sort authority. Task 6 rewrites them.

- [ ] **Step 6: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector/src/components/memory/memory-grid.tsx packages/inspector/test/components/memory-grid.test.tsx && git commit -m "feat(inspector): declare column types and prune every filter menu to what the store honors"
```

---

## Task 6: Turn on external processing authority (Flow 3)

**Files:**
- Modify: `packages/inspector/src/components/memory/memory-grid.tsx`
- Modify: `packages/inspector/test/components/memory-grid.test.tsx`

- [ ] **Step 1: Rewrite the two local-sort tests as intent tests**

In `packages/inspector/test/components/memory-grid.test.tsx`, replace the whole body of `it("clicking a column header sorts the rows by that column", …)` and of `it("sorts the updated column chronologically, not by its displayed text", …)` with these two tests (keep the surrounding `describe`):

```tsx
  it("a header click emits sort INTENT and leaves the loaded order alone", () => {
    // The rows are a server-selected window. Re-sorting them locally would show
    // "the top of a recency-biased sample, ordered by confidence" underneath a
    // truthful-looking aria-sort — the wrong SAMPLE, not just the wrong order.
    const onSortChange = vi.fn()
    const { container } = render(
      <MemoryGrid
        records={[record({ id: "b", content: "beta" }), record({ id: "a", content: "alpha" })]}
        onSelect={vi.fn()}
        serverAuthoritative
        sort={[]}
        onSortChange={onSortChange}
      />,
    )
    fireEvent.click(headerFor(container, "confidence"))
    expect(onSortChange.mock.calls).toEqual([[[{ columnId: "confidence", direction: "desc" }]]])
    // Supplied order, untouched.
    expect(columnText(container, "content")).toEqual(["beta", "alpha"])
  })

  it("shows the desired sort on the header while the rows still answer the old one", () => {
    const { container } = render(
      <MemoryGrid
        records={[record({ id: "b", content: "beta" }), record({ id: "a", content: "alpha" })]}
        onSelect={vi.fn()}
        serverAuthoritative
        sort={[{ columnId: "updated", direction: "asc" }]}
        onSortChange={vi.fn()}
      />,
    )
    expect(headerFor(container, "updated").getAttribute("aria-sort")).toBe("ascending")
    expect(columnText(container, "content")).toEqual(["beta", "alpha"])
  })

  it("a funnel selection is displayed but never applied to the loaded rows", () => {
    const { container } = render(
      <MemoryGrid
        records={[record({ id: "a" }), record({ id: "c", status: "candidate" })]}
        onSelect={vi.fn()}
        serverAuthoritative
        filters={{ status: { operator: "isAnyOf", value: ["candidate"] } }}
        onFiltersChange={vi.fn()}
      />,
    )
    // Both rows stay: the server decides membership, and re-applying the filter
    // locally would drop rows between a filter tick and its response.
    expect(columnText(container, "content")).toHaveLength(2)
  })

  it("publishes the matching total as aria-rowcount, not the loaded count", () => {
    const { container } = render(
      <MemoryGrid
        records={[record({ id: "a" }), record({ id: "b" })]}
        onSelect={vi.fn()}
        serverAuthoritative
        resultMeta={{ total: { kind: "exact", count: 4120 }, datasetKey: "k1" }}
        dataState={{ phase: "idle" }}
      />,
    )
    const grid = container.querySelector('[role="grid"]')
    expect(grid?.getAttribute("aria-rowcount")).toBe("4121")
  })
```

- [ ] **Step 2: Run and see them fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/memory-grid.test.tsx --testTimeout=20000
```

Expected: FAIL — TypeScript-free at runtime, but the assertions fail: the content column reads `["alpha","beta"]` (the engine still sorted), and `aria-rowcount` reads `"3"` (the loaded model count) because `serverAuthoritative`, `resultMeta` and `dataState` are not props yet.

- [ ] **Step 3: Add the authority and meta props**

In `packages/inspector/src/components/memory/memory-grid.tsx`, add this module-level constant just above `function rowIdOf`:

```tsx
/** Filter and sort are decided by the store, so the engine displays that state
 *  and never applies it to the loaded records. Module-level for a stable
 *  identity; `usePretable` reads it as its two scalar fields either way, and
 *  flipping it is honestly a new grid. */
const SERVER_AUTHORITY: PretableProcessingOptions = { filter: "external", sort: "external" }
```

Extend the `@pretable/react` import with the three new types:

```tsx
import {
  type ColumnFilter,
  type PretableDataState,
  type PretableProcessingOptions,
  type PretableResultMeta,
  type PretableColumn,
  type PretableSortEntry,
  PretableSurface,
  type PretableTelemetry,
} from "@pretable/react"
```

Add the three props to the destructuring:

```tsx
  sort,
  onSortChange,
  serverAuthoritative = false,
  resultMeta,
  dataState,
}: {
```

and to the prop type, after `onSortChange`:

```tsx
  /** Hand filter and sort authority to the store. The grouped SEARCH results
   *  leave this off: they are a complete little result set that the engine may
   *  honestly process locally. */
  serverAuthoritative?: boolean
  /** Matching total + dataset identity. A CHANGED `datasetKey` clears selection,
   *  focus and group expansion — the first-class replacement for remounting. */
  resultMeta?: PretableResultMeta
  /** Lifecycle phase. Omitting it turns lifecycle presentation entirely off,
   *  which is what the search grids want. */
  dataState?: PretableDataState
```

Then pass them to `PretableSurface`, immediately after the `state={surfaceState}` prop:

```tsx
      {...(serverAuthoritative ? { processing: SERVER_AUTHORITY } : {})}
      {...(resultMeta ? { resultMeta } : {})}
      {...(dataState ? { dataState } : {})}
```

- [ ] **Step 4: Run the tests and see them pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/memory-grid.test.tsx --testTimeout=20000
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector/src/components/memory/memory-grid.tsx packages/inspector/test/components/memory-grid.test.tsx && git commit -m "feat(inspector): hand filter and sort authority to the store"
```

---

## Task 7: Wire the list page to the mapped query, and delete the ValueSet layer

**Files:**
- Modify: `packages/inspector/src/components/memory/list-page.tsx`
- Delete: `packages/inspector/src/components/memory/column-filters.ts`
- Delete: `packages/inspector/test/components/column-filters.test.ts`
- Modify: `packages/inspector/test/components/column-filter-wiring.test.tsx`

- [ ] **Step 1: Rewrite the wiring test**

Replace the body of every `it(...)` in `packages/inspector/test/components/column-filter-wiring.test.tsx` with these, keeping the file's existing helpers (`record`, `stats`, `stubApi`, `listUrls`, `tickStatus`, `jsonResponse`) and the `afterEach`:

```tsx
describe("column funnels drive the server query", () => {
  it("sends a ticked status as a filters JSON predicate", async () => {
    const mock = stubApi()
    render(<ListPage />)
    await screen.findByText("content a1")
    await tickStatus("candidate")
    await vi.waitFor(() => {
      const sent = listUrls(mock)
        .map((u) => u.searchParams.get("filters"))
        .filter((v): v is string => v !== null)
        .map((v) => JSON.parse(v))
      expect(sent).toContainEqual([{ field: "status", op: "in", values: ["candidate"] }])
    })
  })

  it("never sends the legacy status shorthand param", async () => {
    // One encoding, one code path: every predicate goes through `filters`, so a
    // stray shorthand would be a second grammar to keep in step.
    const mock = stubApi()
    render(<ListPage />)
    await screen.findByText("content a1")
    await tickStatus("candidate")
    await vi.waitFor(() => {
      expect(listUrls(mock).some((u) => u.searchParams.get("filters") !== null)).toBe(true)
    })
    expect(listUrls(mock).every((u) => u.getAll("status").length === 0)).toBe(true)
  })

  it("sends no filters param at all when nothing is ticked", async () => {
    const mock = stubApi()
    render(<ListPage />)
    await screen.findByText("content a1")
    await vi.waitFor(() => expect(listUrls(mock).length).toBeGreaterThan(0))
    expect(listUrls(mock)[0].searchParams.get("filters")).toBeNull()
  })

  it("sends a header sort as an orderBy JSON entry", async () => {
    const mock = stubApi()
    const { container } = render(<ListPage />)
    await screen.findByText("content a1")
    const header = [...container.querySelectorAll('[role="columnheader"]')].find((el) =>
      el.textContent?.startsWith("confidence"),
    )
    if (!header) throw new Error("no confidence header")
    fireEvent.click(header)
    await vi.waitFor(() => {
      const sent = listUrls(mock)
        .map((u) => u.searchParams.get("orderBy"))
        .filter((v): v is string => v !== null)
        .map((v) => JSON.parse(v))
      expect(sent).toContainEqual([{ field: "confidence", dir: "desc" }])
    })
  })
})
```

- [ ] **Step 2: Run and see it fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/column-filter-wiring.test.tsx --testTimeout=20000
```

Expected: FAIL — the first test times out in `waitFor` because the page still encodes `status` as a repeated shorthand param and sends no `filters` param.

- [ ] **Step 3: Replace the list page's query state and composition**

In `packages/inspector/src/components/memory/list-page.tsx`:

(a) Delete these imports:

```tsx
import { resolveFilter, toFilter, type ValueSet } from "./column-filters"
```

and add:

```tsx
import type { ColumnFilter, PretableSortEntry } from "@pretable/react"
import type { BrowseFilter, BrowseQuery } from "@dawn-ai/memory/browse"
import { capSortEntries, MAX_BROWSE_SORT_ENTRIES, toBrowseQuery } from "./to-browse-query"
```

(keep the existing `ColumnFilter` import if one is already present — do not import it twice).

(b) Replace the two `ValueSet` state declarations:

```tsx
  // undefined = unfiltered, [] = matches nothing — the same distinction the
  // store's BrowseQuery draws, so an emptied funnel cannot read as "show all".
  const [status, setStatus] = useState<ValueSet<MemoryStatus>>(undefined)
  const [kind, setKind] = useState<ValueSet<MemoryKind>>(undefined)
```

with the raw grid intent:

```tsx
  // The grid's own vocabulary, held verbatim. The old ValueSet round-trip
  // existed only because the store could not express operators; it can now, so
  // there is exactly one translation (`toBrowseQuery`) and it happens once,
  // where the request is built.
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({})
  const [sort, setSort] = useState<PretableSortEntry[]>([])
  const [sortCapped, setSortCapped] = useState(false)
```

(c) Delete the `filters` `useMemo` and the `handleFiltersChange` callback that used `toFilter`/`resolveFilter`, and replace both with:

```tsx
  const handleFiltersChange = useCallback((next: Record<string, ColumnFilter>) => {
    setFilters(next)
  }, [])

  /** Pretable's shift-click appends the new key at the LOWEST priority, so a
   *  fourth key is the one declined — the ordering the user already built
   *  survives. The notice is what keeps that honest: the control did something,
   *  and the page says what. */
  const handleSortChange = useCallback((next: PretableSortEntry[]) => {
    setSortCapped(next.length > MAX_BROWSE_SORT_ENTRIES)
    setSort(capSortEntries(next))
  }, [])
```

(d) Pin the timeline window instant. Replace the `timelineWindow` state declaration with:

```tsx
  const [timelineWindow, setTimelineWindow] = useState<TimelineWindow>("all")
  // Pinned when the control moves, never recomputed per render: `since` is part
  // of the dataset identity, and a `Date.now()` evaluated during render would
  // mint a new identity every frame and refetch forever.
  const [timelineSince, setTimelineSince] = useState<string>()
  const chooseTimelineWindow = useCallback((next: TimelineWindow) => {
    setTimelineWindow(next)
    setTimelineSince(
      next === "all" ? undefined : new Date(Date.now() - WINDOWS[next]).toISOString(),
    )
  }, [])
```

and change the window `<select>`'s handler from `onChange={(e) => setTimelineWindow(e.target.value as TimelineWindow)}` to:

```tsx
              onChange={(e) => chooseTimelineWindow(e.target.value as TimelineWindow)}
```

(e) Delete the whole `pageFn` `useCallback` and the `const page = usePolling(pageFn, 2000, live && !query)` line (slice 3 already replaced the latter — if it is gone, skip it), and put the canonical query in their place:

```tsx
  const browseQuery = useMemo<BrowseQuery>(() => {
    const intent = toBrowseQuery(filters, sort)
    const predicates: BrowseFilter[] = [...(intent.filters ?? [])]
    // Timeline is an episode view: default the kind narrowing there, but only
    // when the funnel has not already claimed the field — the store allows at
    // most ONE filter per field and rejects a second with a 400.
    if (view === "timeline" && !predicates.some((f) => f.field === "kind")) {
      predicates.push({ field: "kind", op: "in", values: ["episodic"] })
    }
    return {
      // EXACT namespace, not a prefix: the rail selects one namespace, and the
      // server now answers that question itself. The client-side narrowing that
      // used to follow a prefix fetch (and made rows disagree with `total`) is
      // gone.
      ...(namespace ? { namespace } : {}),
      ...(predicates.length > 0 ? { filters: predicates } : {}),
      ...(intent.orderBy ? { orderBy: intent.orderBy } : {}),
      ...(view === "timeline" && timelineSince ? { since: timelineSince } : {}),
    }
  }, [filters, sort, namespace, view, timelineSince])

  // Read the two `query`s carefully: `browseQuery` is the STORE query built
  // above, while the bare `query` is the search-box string. Polling pauses while
  // a search is running, because the browse list is not what is on screen.
  const browse = useMemoryBrowse({ query: browseQuery, live: live && !query })
```

(If slice 3 already calls `useMemoryBrowse`, replace only its argument object with `{ query: browseQuery, live: live && !query }`.)

(f) Replace every remaining reference to `pageRecords` with `browse.rows`, and delete the `pageRecords` and `pageIsComplete` declarations:

```tsx
  const pageRecords = namespace
    ? (page?.records ?? []).filter((rec) => rec.namespace === namespace)
    : (page?.records ?? [])
  const pageIsComplete = page !== undefined && page.records.length >= page.total
```

both go. `groupByNamespace` becomes `groupByNamespace={namespace === undefined}`; the `pageIsComplete` half of that gate was the only place in the Inspector that read `total`, and it existed to *withhold* grouping because there was no honest way to show partial counts. Loaded-scope child-count labeling replaces it (Task 11).

(f2) **Collapse the empty-state ternary in the same edit, or the file will not compile.** The chain

```tsx
          ) : pageRecords.length > 0 ? (
            <MemoryGrid … />
          ) : status !== undefined || kind !== undefined || namespace !== undefined ? (
            <p className="py-8 text-center text-sm text-zinc-400" data-testid="no-matches">
              No memories match these filters.
            </p>
          ) : (
            <p className="py-8 text-center text-sm text-zinc-400">
              No memories yet — run your agent and watch them appear.
            </p>
          )}
```

still names the `status` and `kind` state that step (b) deleted. Reduce it to the grid alone:

```tsx
          ) : (
            <MemoryGrid … />
          )}
```

Empty results are Pretable's `idle`-with-zero-rows body block now, whose copy comes from the surface's `messages.emptyStateMessage` (wired by slice 3). If a test still asserts `data-testid="no-matches"`, repoint it at that block's text.

(f3) Delete the now-unused `ListResponse` interface at the top of the file if slice 3 left it behind — `BrowsePage` from `@dawn-ai/memory/browse` is the response shape.

(g) Pass the new props to the browse `MemoryGrid` (the one inside the non-search branch):

```tsx
            <MemoryGrid
              // Still remount-keyed at this point — Task 10 removes it once the
              // engine's own clearing replaces it. Leave it here so the file
              // stays green between the two commits.
              key={gridEpoch}
              records={browse.rows}
              onSelect={setSelectedId}
              onTickedChange={setTicked}
              groupByNamespace={namespace === undefined}
              serverAuthoritative
              resultMeta={browse.resultMeta}
              dataState={browse.dataState}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              sort={sort}
              onSortChange={handleSortChange}
            />
```

(h) Render the cap notice immediately before that `<MemoryGrid>`:

```tsx
            {sortCapped ? (
              <p role="status" className="mb-2 text-xs text-zinc-500" data-testid="sort-cap-notice">
                {`Sorting is limited to ${MAX_BROWSE_SORT_ENTRIES} columns. The extra column was not added.`}
              </p>
            ) : null}
```

(i) Delete the now-unused `MemoryKind`/`MemoryStatus` type imports if TypeScript flags them.

- [ ] **Step 4: Delete the ValueSet layer**

```bash
cd /Users/blove/repos/dawn && rm packages/inspector/src/components/memory/column-filters.ts packages/inspector/test/components/column-filters.test.ts
```

- [ ] **Step 5: Run the wiring test and see it pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/column-filter-wiring.test.tsx --testTimeout=20000
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Run the full component suite and typecheck**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000 && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: `list.test.tsx`'s `"clicking a namespace facet scopes the next list fetch"` and `"a selected facet filters the page to the exact namespace, not the prefix"` now FAIL — Task 8 rewrites them. Everything else passes. If any other file fails, fix it before continuing.

- [ ] **Step 7: Commit**

```bash
cd /Users/blove/repos/dawn && git add -A packages/inspector && git commit -m "feat(inspector): build the browse query from grid intent, and delete the ValueSet round-trip"
```

---

## Task 8: Exact-namespace facet, and label the rail's counts global

**Files:**
- Modify: `packages/inspector/src/components/memory/facet-rail.tsx`
- Modify: `packages/inspector/test/components/list.test.tsx`

- [ ] **Step 1: Rewrite the two facet tests**

In `packages/inspector/test/components/list.test.tsx`, replace both `it("clicking a namespace facet scopes the next list fetch", …)` and `it("a selected facet filters the page to the exact namespace, not the prefix", …)` with:

```tsx
  it("a namespace facet sends the EXACT namespace, never a prefix", async () => {
    const mock = stubApi()
    render(<ListPage />)
    const rail = await screen.findByRole("navigation")
    const facet = within(rail).getByRole("button", { name: /route=\/notes/ })
    fireEvent.click(facet)
    await vi.waitFor(() => {
      const scoped = callsTo(mock, "/api/memory/list").filter(
        (u) => u.searchParams.get("namespace") === "route=/notes",
      )
      expect(scoped.length).toBeGreaterThan(0)
    })
    expect(callsTo(mock, "/api/memory/list").every((u) => u.searchParams.get("namespacePrefix") === null)).toBe(true)
  })

  it("renders every row the server returned for a facet — no client narrowing", async () => {
    // The old code fetched by PREFIX and then narrowed to equality on the
    // client, so the rows on screen and the `total` beside them answered
    // different questions. The server answers the exact question now, and the
    // page must not second-guess it.
    const sibling: MemoryRecord = {
      ...candidate,
      id: "cand2",
      namespace: "route=/notes2",
      content: "sibling prefix record",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url)
        if (u.includes("/api/memory/stats")) {
          return jsonResponse({
            ...stats,
            total: 2,
            byNamespace: { "route=/notes": 1, "route=/notes2": 1 },
          })
        }
        if (u.includes("/api/memory/list"))
          return jsonResponse({ records: [candidate, sibling], total: 2, continuation: null })
        return jsonResponse({ groups: [] })
      }),
    )
    render(<ListPage />)
    expect(await screen.findByText("acme threshold is 750")).toBeDefined()
    const facetLabel = within(screen.getByRole("navigation")).getByText("route=/notes")
    const facetButton = facetLabel.closest("button")
    if (!facetButton) throw new Error("facet button not found")
    fireEvent.click(facetButton)
    // Whatever the (stubbed) server hands back is what shows. Nothing is hidden.
    expect(await screen.findByText("sibling prefix record")).toBeDefined()
  })

  it("labels the facet counts as global", async () => {
    render(<ListPage />)
    const rail = await screen.findByRole("navigation")
    expect(within(rail).getByText(/across all memories/i)).toBeDefined()
    expect(rail.getAttribute("aria-describedby")).toBe("facet-count-scope")
  })
```

Also update every `jsonResponse({ records: …, total: … })` in this file's `stubApi` to include `continuation: null`, matching the shipped `BrowsePage`.

- [ ] **Step 2: Run and see them fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/list.test.tsx --testTimeout=20000
```

Expected: the first two now PASS (Task 7 already switched the param), and `"labels the facet counts as global"` FAILS — `Unable to find an element with the text: /across all memories/i`.

- [ ] **Step 3: Label the rail**

In `packages/inspector/src/components/memory/facet-rail.tsx`, replace the opening `<nav>` and the heading block:

```tsx
    <nav className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 p-3 text-sm">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        Namespace
      </div>
```

with:

```tsx
    <nav
      aria-describedby="facet-count-scope"
      className="w-48 shrink-0 border-r border-zinc-200 bg-zinc-50 p-3 text-sm"
    >
      <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">Namespace</div>
      {/* The counts come from the always-global stats endpoint, not from the
          current query — so they are LABELLED global rather than quietly
          presented as if they described the filtered result. Query-aware facet
          counts are a separate, deferred piece of work. */}
      <p id="facet-count-scope" className="mb-1 text-[10px] leading-tight text-zinc-400">
        Counts are across all memories, not the current filters.
      </p>
```

- [ ] **Step 4: Run and see it pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/list.test.tsx --testTimeout=20000
```

Expected: PASS, every test in the file.

- [ ] **Step 5: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector && git commit -m "feat(inspector): select namespaces exactly, and say the facet counts are global"
```

---

## Task 9: The keyset load-more footer (Flow 5, §9.2)

**Files:**
- Create: `packages/inspector/src/components/memory/load-more-footer.tsx`
- Create: `packages/inspector/test/components/load-more.test.tsx`
- Modify: `packages/inspector/src/components/memory/list-page.tsx`

- [ ] **Step 1: Write the failing test**

Create `packages/inspector/test/components/load-more.test.tsx`:

```tsx
import type { MemoryRecord } from "@dawn-ai/memory"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LoadMoreFooter } from "../../src/components/memory/load-more-footer"
import { ListPage } from "../../src/components/memory/list-page"

function record(over: Partial<MemoryRecord> & Pick<MemoryRecord, "id">): MemoryRecord {
  return {
    kind: "semantic",
    namespace: "route=/notes",
    content: `content ${over.id}`,
    data: {},
    source: { type: "tool", id: "remember" },
    confidence: 0.5,
    tags: [],
    status: "active",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...over,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("LoadMoreFooter", () => {
  it("quotes the loaded count against the matching total", () => {
    render(
      <LoadMoreFooter
        state="available"
        loaded={200}
        total={5432}
        onLoadMore={vi.fn()}
        browseOnlyReason={undefined}
      />,
    )
    expect(screen.getByRole("button").textContent).toBe("Load more — 200 of 5,432 loaded")
  })

  it("stays mounted and focusable when everything is loaded", () => {
    // Unmounting it would drop keyboard focus to <body> at the exact moment the
    // user finished paging.
    render(
      <LoadMoreFooter state="exhausted" loaded={137} total={137} onLoadMore={vi.fn()} browseOnlyReason={undefined} />,
    )
    const button = screen.getByRole("button")
    expect(button.textContent).toBe("All 137 loaded")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    expect(button.hasAttribute("disabled")).toBe(false)
    expect(button.tabIndex).toBe(0)
  })

  it("explains the resident cap instead of silently refusing", () => {
    render(
      <LoadMoreFooter state="at-cap" loaded={1000} total={5432} onLoadMore={vi.fn()} browseOnlyReason={undefined} />,
    )
    const button = screen.getByRole("button")
    expect(button.textContent).toBe("First 1,000 of 5,432 loaded")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    const described = document.getElementById(button.getAttribute("aria-describedby") ?? "")
    expect(described?.textContent).toMatch(/narrow the filters/i)
  })

  it("does not call onLoadMore when it is not available", () => {
    const onLoadMore = vi.fn()
    render(
      <LoadMoreFooter state="exhausted" loaded={10} total={10} onLoadMore={onLoadMore} browseOnlyReason={undefined} />,
    )
    fireEvent.click(screen.getByRole("button"))
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it("carries a browse-only reason when one is supplied", () => {
    render(
      <LoadMoreFooter
        state="available"
        loaded={200}
        total={5432}
        onLoadMore={vi.fn()}
        browseOnlyReason="Not applied while searching"
      />,
    )
    const button = screen.getByRole("button")
    expect(button.getAttribute("aria-disabled")).toBe("true")
    const described = document.getElementById(button.getAttribute("aria-describedby") ?? "")
    expect(described?.textContent).toBe("Not applied while searching")
  })
})

describe("load-more in the page", () => {
  function stubPages(first: MemoryRecord[], second: MemoryRecord[]) {
    let listCalls = 0
    const mock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url)
      if (u.includes("/api/memory/stats"))
        return jsonResponse({
          total: 3,
          byStatus: { active: 3 },
          byKind: { semantic: 3 },
          byNamespace: { "route=/notes": 3 },
          bySourceType: { tool: 3 },
        })
      if (u.includes("/api/memory/list")) {
        const hasCursor = new URL(u, "http://localhost").searchParams.get("cursor") !== null
        listCalls += 1
        return jsonResponse(
          hasCursor
            ? { records: second, total: 3, continuation: null }
            : { records: first, total: 3, continuation: "cur-1" },
        )
      }
      return jsonResponse({ groups: [] })
    })
    vi.stubGlobal("fetch", mock)
    return { mock, listCalls: () => listCalls }
  }

  it("lives OUTSIDE the grid element and after it in the document", async () => {
    // The scroll viewport IS the role="grid" element: a loose button inside it
    // corrupts the grid's owned children, and virtualization can unmount a
    // focused in-viewport node out from under the user.
    stubPages([record({ id: "a" })], [])
    const { container } = render(<ListPage />)
    await screen.findByText("content a")
    const grid = container.querySelector('[role="grid"]')
    const footer = screen.getByTestId("load-more-footer").querySelector("button")
    if (!grid || !footer) throw new Error("grid or footer missing")
    expect(grid.contains(footer)).toBe(false)
    expect(grid.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("appends the next window and keeps the rows already loaded", async () => {
    stubPages([record({ id: "a" }), record({ id: "b" })], [record({ id: "b" }), record({ id: "c" })])
    render(<ListPage />)
    await screen.findByText("content a")
    fireEvent.click(within(screen.getByTestId("load-more-footer")).getByRole("button"))
    expect(await screen.findByText("content c")).toBeDefined()
    expect(screen.getByText("content a")).toBeDefined()
    // "b" arrived in both windows — a keyset walk can re-emit one row when a
    // sort key is edited across the seam. It must appear exactly once.
    expect(screen.getAllByText("content b")).toHaveLength(1)
  })

  it("sends the newest continuation as the cursor", async () => {
    const { mock } = stubPages([record({ id: "a" })], [record({ id: "c" })])
    render(<ListPage />)
    await screen.findByText("content a")
    fireEvent.click(within(screen.getByTestId("load-more-footer")).getByRole("button"))
    await screen.findByText("content c")
    const cursors = mock.mock.calls
      .map((call) => new URL(String(call[0]), "http://localhost"))
      .filter((u) => u.pathname.includes("/api/memory/list"))
      .map((u) => u.searchParams.get("cursor"))
    expect(cursors).toContain("cur-1")
  })
})
```

- [ ] **Step 2: Run and see it fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/load-more.test.tsx --testTimeout=20000
```

Expected: FAIL — `Failed to resolve import "../../src/components/memory/load-more-footer"`.

- [ ] **Step 3: Write the footer**

Create `packages/inspector/src/components/memory/load-more-footer.tsx`:

```tsx
"use client"
import { useId } from "react"
import { Button } from "../ui/button"
import { BROWSE_RESIDENT_CAP, type LoadMoreState } from "./browse-window"

const NUMBER = new Intl.NumberFormat()

/**
 * The keyset load-more control.
 *
 * It lives OUTSIDE the scroll viewport because the viewport is the
 * `role="grid"` element: a loose button among its children corrupts the grid's
 * owned-children structure for assistive technology, virtualization can unmount
 * a focused in-viewport node, and a windowed control would move on every
 * append. It is also never unmounted and never natively `disabled` — a
 * `disabled` attribute removes it from the tab order, which drops keyboard
 * focus to `<body>` at the exact moment the user finished paging, and hides the
 * reason it is inactive. `aria-disabled` keeps it reachable and readable.
 */
export function LoadMoreFooter({
  state,
  loaded,
  total,
  onLoadMore,
  browseOnlyReason,
}: {
  state: LoadMoreState
  loaded: number
  /** The exact matching total, when one is fulfilled. */
  total: number | undefined
  onLoadMore: () => void
  /** Set while this control does not apply to what is on screen (a search is
   *  running). Rendered as visible text AND associated through
   *  `aria-describedby`, so a keyboard or screen-reader user can discover why. */
  browseOnlyReason: string | undefined
}) {
  const reasonId = useId()
  const population = total === undefined ? undefined : NUMBER.format(total)
  const inactive = Boolean(browseOnlyReason) || state !== "available"

  const label =
    browseOnlyReason !== undefined
      ? "Load more"
      : state === "loading"
        ? "Loading more…"
        : state === "exhausted"
          ? `All ${NUMBER.format(loaded)} loaded`
          : state === "at-cap"
            ? `First ${NUMBER.format(loaded)}${population ? ` of ${population}` : ""} loaded`
            : state === "unavailable"
              ? "Load more"
              : `Load more — ${NUMBER.format(loaded)}${population ? ` of ${population}` : ""} loaded`

  const reason =
    browseOnlyReason ??
    (state === "at-cap"
      ? `The Inspector holds ${NUMBER.format(BROWSE_RESIDENT_CAP)} records at a time — narrow the filters to reach the rest.`
      : undefined)

  return (
    <div data-testid="load-more-footer" className="mt-2 flex items-center gap-3">
      <Button
        type="button"
        variant="outline"
        aria-disabled={inactive ? "true" : undefined}
        {...(reason ? { "aria-describedby": reasonId } : {})}
        onClick={() => {
          if (inactive) return
          onLoadMore()
        }}
      >
        {label}
      </Button>
      {reason ? (
        <span id={reasonId} className="text-xs text-zinc-500">
          {reason}
        </span>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 4: Mount it in the list page**

In `packages/inspector/src/components/memory/list-page.tsx`, add the imports:

```tsx
import { loadMoreState } from "./browse-window"
import { LoadMoreFooter } from "./load-more-footer"
```

Derive the state next to the other derived values (after the `browse` declaration):

```tsx
  const loadedTotal =
    browse.resultMeta.total?.kind === "exact" ? browse.resultMeta.total.count : undefined
  const footerState = loadMoreState({
    phase: browse.dataState.phase,
    loaded: browse.rows.length,
    hasMore: browse.hasMore,
  })
```

and render it immediately **after** the browse `<MemoryGrid …/>` element, as its sibling:

```tsx
            <LoadMoreFooter
              state={footerState}
              loaded={browse.rows.length}
              total={loadedTotal}
              onLoadMore={browse.loadMore}
              browseOnlyReason={undefined}
            />
```

- [ ] **Step 5: Run the test and see it pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/load-more.test.tsx --testTimeout=20000
```

Expected: PASS, 8 tests. If the "appends the next window" test fails with a duplicate `content b`, the slice-3 append is not going through `dedupeById` — return to Task 3 Step 5.

- [ ] **Step 6: Full suite and typecheck**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000 && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector && git commit -m "feat(inspector): add a keyset load-more control outside the grid element"
```

---

## Task 10: Delete the `gridEpoch` remount, and let `datasetKey` do the clearing (Flow 11)

**Files:**
- Modify: `packages/inspector/src/components/memory/memory-grid.tsx`
- Modify: `packages/inspector/src/components/memory/list-page.tsx`
- Modify: `packages/inspector/test/components/bulk-actions.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `packages/inspector/test/components/bulk-actions.test.tsx`, inside its top-level `describe`:

```tsx
  it("a query change clears the selection without remounting the grid", async () => {
    // The old code bumped a `key` to throw the grid away, taking measured row
    // heights, focus and scroll with it. A datasetKey pivot clears exactly the
    // state that belonged to the old answer, and nothing else.
    const mock = stubApi()
    render(<ListPage />)
    await screen.findByText("content a1")
    const grid = document.querySelector('[role="grid"]')
    fireEvent.click(screen.getAllByRole("checkbox", { name: /select row/i })[0])
    expect(await screen.findByTestId("bulk-bar")).toBeDefined()

    fireEvent.click(await screen.findByRole("button", { name: "Filter status" }))
    const dialog = await screen.findByRole("dialog", { name: "Filter status" })
    const box = within(dialog)
      .getAllByRole("checkbox")
      .find((cb) => cb.closest("label")?.textContent?.includes("candidate"))
    if (!box) throw new Error("no candidate option")
    fireEvent.click(box)

    await vi.waitFor(() => expect(screen.queryByTestId("bulk-bar")).toBeNull())
    expect(document.querySelector('[role="grid"]')).toBe(grid)
    expect(mock).toHaveBeenCalled()
  })

  it("clearing the selection from the bulk bar keeps the same grid instance", async () => {
    stubApi()
    render(<ListPage />)
    await screen.findByText("content a1")
    const grid = document.querySelector('[role="grid"]')
    fireEvent.click(screen.getAllByRole("checkbox", { name: /select row/i })[0])
    const bar = await screen.findByTestId("bulk-bar")
    fireEvent.click(within(bar).getByRole("button", { name: /clear/i }))
    await vi.waitFor(() => expect(screen.queryByTestId("bulk-bar")).toBeNull())
    expect(document.querySelector('[role="grid"]')).toBe(grid)
  })
```

If the file's fetch stub returns list pages, add `continuation: null` to each of them.

- [ ] **Step 2: Run and see them fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/bulk-actions.test.tsx --testTimeout=20000
```

Expected: FAIL — the second test finds a **different** grid node after clearing, because `clearTicked` still bumps `gridEpoch` and the `key` remounts the surface.

- [ ] **Step 3: Expose an imperative handle on `MemoryGrid`**

In `packages/inspector/src/components/memory/memory-grid.tsx`, add `PretableGrid` to the `@pretable/react` import, add the prop to the destructuring and its type:

```tsx
  /** Receives the engine instance once. The page uses it to clear the checkbox
   *  selection after a bulk run — the only selection change that is neither a
   *  user gesture nor a dataset pivot. */
  onGridReady?: (grid: PretableGrid<GridRow>) => void
```

and forward it on `PretableSurface`:

```tsx
      {...(onGridReady ? { onGridReady } : {})}
```

- [ ] **Step 4: Delete `gridEpoch` from the list page**

In `packages/inspector/src/components/memory/list-page.tsx`, delete:

```tsx
  // The grid keeps its own checkbox state, so clearing here would leave the
  // boxes ticked. Remounting it (see `key` below) is what actually resets both.
  const [gridEpoch, setGridEpoch] = useState(0)
  const clearTicked = useCallback(() => {
    setTicked([])
    setGridEpoch((n) => n + 1)
  }, [])
```

and replace it with:

```tsx
  // The engine owns selection; clearing it here is one call, and every other
  // clear happens on its own: a query change pivots `datasetKey`, and the engine
  // drops selection, focus and group expansion as part of that single emit.
  const gridRef = useRef<PretableGrid<GridRow> | null>(null)
  const handleGridReady = useCallback((grid: PretableGrid<GridRow>) => {
    gridRef.current = grid
  }, [])
  const clearTicked = useCallback(() => {
    gridRef.current?.clearSelection()
    setTicked([])
  }, [])
```

Add the imports this needs:

```tsx
import { useRef } from "react"           // merge into the existing react import
import type { PretableGrid } from "@pretable/react"
import type { GridRow } from "./memory-grid"
```

Export the row type from `memory-grid.tsx` so the ref can be typed — change `interface GridRow extends Record<string, unknown> {` to `export interface GridRow extends Record<string, unknown> {`.

Finally, delete `key={gridEpoch}` from the browse `<MemoryGrid …/>` element and add `onGridReady={handleGridReady}` in its place.

- [ ] **Step 5: Point the bulk bar at the resident rows**

Still in `list-page.tsx`, change the `<BulkBar>` element's `records` prop and add the stale guard:

```tsx
        <BulkBar
          ticked={ticked}
          records={browse.rows}
          onDone={handleBulkDone}
          onClear={clearTicked}
        />
```

and gate the whole element on the phase — replace `{ticked.length > 0 ? (` with:

```tsx
      {/* Acting on rows a newly-desired query is about to replace is exactly the
          ambiguity this design bans, so the bar is withheld while the visible
          rows answer the previous query. */}
      {ticked.length > 0 && browse.dataState.phase !== "stale" ? (
```

- [ ] **Step 6: Run the tests and see them pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/bulk-actions.test.tsx --testTimeout=20000
```

Expected: PASS, every test in the file.

- [ ] **Step 7: Full suite and typecheck**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000 && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector && git commit -m "refactor(inspector): replace the gridEpoch remount with datasetKey clearing"
```

---

## Task 11: View scope — keep browse mounted, disable browse-only controls with a reason (Flows 10, 12; §8.2)

**Files:**
- Modify: `packages/inspector/src/components/memory/list-page.tsx`
- Create: `packages/inspector/test/components/view-scope.test.tsx`
- Modify: `packages/inspector/test/components/grouping.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `packages/inspector/test/components/view-scope.test.tsx`:

```tsx
import type { MemoryRecord } from "@dawn-ai/memory"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ListPage } from "../../src/components/memory/list-page"

function record(over: Partial<MemoryRecord> & Pick<MemoryRecord, "id">): MemoryRecord {
  return {
    kind: "semantic",
    namespace: "route=/notes",
    content: `content ${over.id}`,
    data: {},
    source: { type: "tool", id: "remember" },
    confidence: 0.5,
    tags: [],
    status: "active",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...over,
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const records = [record({ id: "a" }), record({ id: "b" })]

function stubApi() {
  const mock = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url)
    if (u.includes("/api/memory/stats"))
      return jsonResponse({
        total: 2,
        byStatus: { active: 2 },
        byKind: { semantic: 2 },
        byNamespace: { "route=/notes": 2 },
        bySourceType: { tool: 2 },
      })
    if (u.includes("/api/memory/list"))
      return jsonResponse({ records, total: 2, continuation: null })
    return jsonResponse({ groups: [{ namespace: "route=/notes", records: [record({ id: "a" })] }] })
  })
  vi.stubGlobal("fetch", mock)
  return mock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function startSearch() {
  fireEvent.change(screen.getByRole("searchbox", { name: "Search memories" }), {
    target: { value: "acme" },
  })
  await vi.waitFor(() => expect(screen.getByRole("searchbox", { name: "Search memories" })).toHaveProperty("value", "acme"))
}

describe("view scope", () => {
  it("keeps the browse grid mounted while search results are showing", async () => {
    // Unmounting it would destroy engine-owned selection, focus and the measured
    // row heights, so returning from a search would land the user somewhere else.
    stubApi()
    const { container } = render(<ListPage />)
    await screen.findByText("content a")
    const grid = container.querySelector('[role="grid"]')
    await startSearch()
    await vi.waitFor(() => expect(screen.getByTestId("browse-region").hasAttribute("hidden")).toBe(true))
    expect(container.querySelector('[role="grid"]')).toBe(grid)
  })

  it("disables the view toggle while a search is running, and says why", async () => {
    // The toggle changes `view` but the screen keeps showing search results —
    // an active-looking control with no visible effect. A real `disabled` would
    // remove it from the tab order and hide the reason with it.
    stubApi()
    render(<ListPage />)
    await screen.findByText("content a")
    await startSearch()
    const toggle = await screen.findByRole("group", { name: "View" })
    const timeline = within(toggle).getByRole("button", { name: "timeline" })
    await vi.waitFor(() => expect(timeline.getAttribute("aria-disabled")).toBe("true"))
    expect(timeline.hasAttribute("disabled")).toBe(false)
    expect(timeline.tabIndex).toBe(0)
    const described = document.getElementById(timeline.getAttribute("aria-describedby") ?? "")
    expect(described?.textContent).toMatch(/not applied to search/i)
  })

  it("refuses the view change rather than switching invisibly", async () => {
    stubApi()
    render(<ListPage />)
    await screen.findByText("content a")
    await startSearch()
    const toggle = await screen.findByRole("group", { name: "View" })
    const timeline = within(toggle).getByRole("button", { name: "timeline" })
    fireEvent.click(timeline)
    expect(timeline.getAttribute("aria-pressed")).toBe("false")
  })

  it("marks the load-more control as not applying to search", async () => {
    stubApi()
    render(<ListPage />)
    await screen.findByText("content a")
    await startSearch()
    const button = within(screen.getByTestId("load-more-footer")).getByRole("button")
    await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"))
    const described = document.getElementById(button.getAttribute("aria-describedby") ?? "")
    expect(described?.textContent).toMatch(/not applied to search/i)
  })

  it("keeps the namespace facet active — search honours it", async () => {
    stubApi()
    render(<ListPage />)
    await screen.findByText("content a")
    await startSearch()
    const rail = screen.getByRole("navigation")
    const facet = within(rail).getByRole("button", { name: /route=\/notes/ })
    expect(facet.getAttribute("aria-disabled")).toBeNull()
  })
})
```

Add a Flow-12 test to `packages/inspector/test/components/grouping.test.tsx`:

```tsx
  it("marks group child counts as loaded-scope when the window is partial", () => {
    // Grouping over a window is permitted but MARKED: "(2 loaded)" makes no
    // claim about the population, which is what replaces the old gate that hid
    // grouping entirely whenever the page was not the whole answer.
    const { container } = render(
      <MemoryGrid
        records={records}
        onSelect={vi.fn()}
        groupByNamespace
        serverAuthoritative
        resultMeta={{ total: { kind: "exact", count: 900 }, datasetKey: "k1" }}
        dataState={{ phase: "idle" }}
      />,
    )
    const counts = [...container.querySelectorAll("[data-pretable-group-count]")].map(
      (el) => el.textContent,
    )
    expect(counts.join(",")).toContain("loaded")
  })
```

- [ ] **Step 2: Run and see them fail**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/view-scope.test.tsx test/components/grouping.test.tsx --testTimeout=20000
```

Expected: FAIL — `Unable to find an element by: [data-testid="browse-region"]`, and the grouping test fails because `MemoryGrid` is rendered without `serverAuthoritative` in the existing helpers (the new test supplies it, so the failure is the missing `loaded` text if authority is not honored).

- [ ] **Step 3: Restructure the `<main>` branch**

In `packages/inspector/src/components/memory/list-page.tsx`, replace the whole `{searching ? ( … ) : view === "timeline" ? ( … ) : pageRecords.length > 0 ? ( … ) : … }` expression inside `<main>` with:

```tsx
          <p
            id="browse-scope-note"
            hidden={!searching}
            className="mb-2 text-xs text-zinc-500"
            data-testid="browse-scope-note"
          >
            Search ranks active memories across every namespace. The view toggle, the
            timeline window and the load-more control are not applied to search.
          </p>
          {searching ? (
            search && search.groups.length > 0 ? (
              <div className="space-y-4">
                {search.groups.map((group) => (
                  <section key={group.namespace}>
                    <h2 className="mb-1.5 font-mono text-xs font-medium text-zinc-500">
                      {group.namespace}
                    </h2>
                    {/* No authority flags, no dataState: each group is a complete
                        little result set the engine may honestly process locally. */}
                    <MemoryGrid records={group.records} onSelect={setSelectedId} />
                  </section>
                ))}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-zinc-400">No matches.</p>
            )
          ) : null}
          {/* The browse surface stays MOUNTED across every view switch. Hiding
              rather than unmounting keeps the engine-owned selection, focus and
              the id-keyed measured row heights alive, and `hidden` also takes
              the whole subtree out of the tab order — so nothing inside it can
              be a control that looks active while a search is running. */}
          <div data-testid="browse-region" hidden={searching || view === "timeline"}>
            {sortCapped ? (
              <p role="status" className="mb-2 text-xs text-zinc-500" data-testid="sort-cap-notice">
                {`Sorting is limited to ${MAX_BROWSE_SORT_ENTRIES} columns. The extra column was not added.`}
              </p>
            ) : null}
            <MemoryGrid
              records={browse.rows}
              onSelect={setSelectedId}
              onTickedChange={setTicked}
              groupByNamespace={namespace === undefined}
              serverAuthoritative
              resultMeta={browse.resultMeta}
              dataState={browse.dataState}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              sort={sort}
              onSortChange={handleSortChange}
              onGridReady={handleGridReady}
            />
          </div>
          {/* The footer is browse-only chrome, so it stays VISIBLE during a
              search and says it does not apply — the grid's own controls are
              already unreachable inside the hidden region above. */}
          <LoadMoreFooter
            state={footerState}
            loaded={browse.rows.length}
            total={loadedTotal}
            onLoadMore={browse.loadMore}
            browseOnlyReason={searching ? BROWSE_ONLY_REASON : undefined}
          />
          <div hidden={searching || view === "list"}>
            <TimelineView records={browse.rows} onSelect={setSelectedId} />
          </div>
```

Add the shared reason string just below the `selectClass` constant at module scope:

```tsx
/** One sentence, one id: the description every browse-only control points at
 *  while a search is running. `aria-disabled` keeps those controls focusable so
 *  a keyboard or screen-reader user actually reaches this explanation — a
 *  native `disabled` would remove them from the tab order and hide it. */
const BROWSE_ONLY_REASON = "Not applied to search"
```

Note the empty-state copy that used to live in this branch (`"No memories match these filters."` / `"No memories yet — run your agent and watch them appear."`) is now Pretable's empty body-state block, wired by slice 3 through `messages.emptyStateMessage` / `renderBodyState`. Do not reintroduce it here; if slice 3 did not wire it, add it to the `MemoryGrid` `messages` prop rather than to this branch.

- [ ] **Step 4: Disable the view toggle and the window select while searching**

Replace the view-toggle buttons' JSX:

```tsx
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={…}
              >
                {v}
              </button>
```

with:

```tsx
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                aria-disabled={searching ? "true" : undefined}
                {...(searching ? { "aria-describedby": "browse-scope-note" } : {})}
                onClick={() => {
                  if (searching) return
                  setView(v)
                }}
                className={`h-9 px-3 text-sm ${
                  view === v ? "bg-zinc-900 text-white" : "bg-white text-zinc-600 hover:bg-zinc-50"
                } ${searching ? "opacity-50" : ""}`}
              >
                {v}
              </button>
```

and give the timeline window `<select>` the same treatment — add these attributes and guard:

```tsx
              aria-disabled={searching ? "true" : undefined}
              {...(searching ? { "aria-describedby": "browse-scope-note" } : {})}
              onChange={(e) => {
                if (searching) return
                chooseTimelineWindow(e.target.value as TimelineWindow)
              }}
```

- [ ] **Step 5: Run the tests and see them pass**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/view-scope.test.tsx test/components/grouping.test.tsx --testTimeout=20000
```

Expected: PASS. If `view-scope.test.tsx`'s first test reports a *different* grid node, the browse region is being unmounted rather than hidden — re-check that the `<div data-testid="browse-region">` is outside every ternary.

- [ ] **Step 6: Full suite and typecheck**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000 && pnpm --filter @dawn-ai/inspector typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/blove/repos/dawn && git add packages/inspector && git commit -m "feat(inspector): keep browse mounted across views, and disable browse-only controls with a reason"
```

---

## Task 12: Changeset, lint, and the full verification sweep

**Files:**
- Create: `.changeset/inspector-server-authority.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/inspector-server-authority.md`:

```markdown
---
"@dawn-ai/inspector": patch
---

The Memory Inspector's browse grid is server-authoritative.

Every visible column now declares a real type and an operator list pruned to exactly
what `BrowseQuery` honors — `status`/`kind` (`is any of` / `is none of`), `namespace`
(`equals` / `starts with`), `content` (the six substring and equality operators),
`confidence` (comparisons and an inclusive range) and `updated` (UTC day operators).
`is empty` / `is not empty` are gone from every menu: no `BrowseFilter` arm expresses
them and every browse field is NOT NULL, so they were controls the server ignored.
`content` is no longer sortable — the store's sort whitelist has no content field.

The grid runs with `processing: { filter: "external", sort: "external" }`, so the
funnels and header sort are intent editors: they emit a query and never re-process the
loaded window. That removes the double-application hazard between a filter tick and
its response, and it removes the sort lie — until now all six columns sorted the 200
loaded rows while presenting as a sort of the whole store.

Also in this release:

- Selecting a namespace facet sends the EXACT `namespace` parameter. The client-side
  equality narrowing that followed a prefix fetch is deleted, so the rows on screen and
  the total beside them no longer answer different questions. The rail's counts are
  labelled as global, because that is what they are.
- Paging is keyset load-more through `BrowsePage.continuation`, driven by a control
  that sits outside the `role="grid"` element and stays focusable in every state.
  Residency is capped at 1 000 records — deliberately equal to the maximum request
  limit, so one head refresh always re-derives the whole resident span.
- The grid is no longer remounted to clear a selection; a `datasetKey` pivot clears
  selection, focus and group expansion in the same emit that lands the new rows.
- While a search is running, browse-only controls are marked `aria-disabled` and stay
  focusable with an `aria-describedby` explanation, rather than staying active and
  being silently ignored.
```

- [ ] **Step 2: Lint**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector lint
```

Expected: no findings. Fix anything biome reports (`pnpm --filter @dawn-ai/inspector lint -- --write` handles the mechanical ones).

- [ ] **Step 3: Prove no dead references to the deleted modules remain**

```bash
cd /Users/blove/repos/dawn && git grep -n "column-filters\|ValueSet\|gridEpoch\|pageIsComplete\|pageRecords\|namespacePrefix" -- packages/inspector/src packages/inspector/test packages/inspector/app
```

Expected: **no output**. (`namespacePrefix` may legitimately survive in `src/store/browse-params.ts`, which parses the HTTP contract — that file is not part of this grep's paths. If it appears anywhere under `src/components`, delete it.)

- [ ] **Step 4: Full inspector verification, cache-free**

```bash
cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/memory build && pnpm --filter @dawn-ai/inspector typecheck && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=20000
```

Expected: typecheck silent; every component test passes. Note the `@dawn-ai/memory` build first — the bare specifier resolves to that package's `dist/`, and a stale one hides real type errors.

- [ ] **Step 5: Repo-wide test run**

```bash
cd /Users/blove/repos/dawn && turbo run test --force --filter=@dawn-ai/inspector... 2>&1 | tail -30
```

Expected: all tasks succeed. `--force` is not optional here — agents have repeatedly reported passes that came from a turbo cache entry predating their edits.

- [ ] **Step 6: Commit**

```bash
cd /Users/blove/repos/dawn && git add .changeset/inspector-server-authority.md packages/inspector && git commit -m "feat(inspector): make the browse grid server-authoritative"
```

- [ ] **Step 7: Open the pull request**

```bash
cd /Users/blove/repos/dawn && git push -u origin HEAD && gh pr create --title "feat(inspector): make the browse grid server-authoritative" --body "$(cat <<'EOF'
## Summary

The Memory Inspector's browse grid now asks the store the question the user is looking at.

- Six typed columns with `filterOperators` pruned to the `BrowseFilter` grammar; `content` is not sortable.
- `processing: { filter: "external", sort: "external" }` — the funnels and header sort emit intent and never re-process the loaded window.
- One pure mapping (`toBrowseQuery`) from grid intent to `BrowseQuery`, which throws rather than dropping an unmappable operator.
- Exact-namespace facet; the client-side equality narrowing is deleted.
- Keyset load-more through `BrowsePage.continuation`, outside the `role="grid"` element, capped at a resident 1 000 = the max request limit.
- `gridEpoch` remount replaced by `datasetKey` clearing.
- Browse-only controls are `aria-disabled` + focusable + described while a search is running.

## Test plan

- `pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts`
- `pnpm --filter @dawn-ai/memory build && pnpm --filter @dawn-ai/inspector typecheck`
- `pnpm --filter @dawn-ai/inspector lint`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## What this slice deliberately does NOT do

Recorded so a reviewer does not read them as omissions — all belong to slice 5 (verification hardening):

- **Bulk retry semantics.** Pruning succeeded IDs from the selection so a retry re-attempts failures only, and pausing polling for the duration of a bulk run, are slice 5. This slice only stops the bulk bar from acting on `stale` rows and points it at the resident set.
- **Bench scripts and the numeric budgets** of §11 (replace ≤ 20 ms, append ≤ 30 ms, end-to-end ≤ 300 ms).
- **The Playwright e2e scenario suite** and the recorded VoiceOver walkthrough.
- **Query-aware facet counts** (EXT-COUNT-01..03), the **server timeline order** (EXT-QUERY-02, the timeline keeps its documented client-side event-time re-sort), and **search filter composition** (EXT-QUERY-01) — all deferred by the design.
