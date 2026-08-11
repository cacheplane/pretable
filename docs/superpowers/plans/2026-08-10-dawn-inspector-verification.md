# Dawn Inspector Verification Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Slice 5 of the server-controlled-exploration design by proving — with named Playwright specs, accessibility assertions, selection/bulk-safety tests, polling-identity tests and measured performance budgets — that the server-authoritative Memory Inspector behaves as §§6–11 of the design says it does.

**Architecture:** Two repos. In **dawn** (`/Users/blove/repos/dawn`) a new Playwright lane boots the already-built standalone Inspector server against a deterministic 1 250-record SQLite fixture (larger than one 200-row window and larger than the 1 000-row resident cap) and runs the fourteen dogfood acceptance scenarios plus four accessibility specs as named spec files; component-level vitest suites cover bulk partial-failure selection semantics, bulk-run polling suspension and polling identity by active query revision; a seeded bench script measures the server budgets of design §11 against a pure, unit-tested budget checker. In **pretable** (`/Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a`) two new bench scripts — `replace` and `append` — measure the client budgets separately (D1-PERF-04) through the existing `interaction_latency_ms` marks and `scripts/analyze-cdp.mjs --window=interaction` slicing, plus a heap ceiling at the resident cap.

**Tech Stack:** Playwright 1.62 (`@playwright/test`), vitest 4.1.10, Next 16 standalone server, `node:sqlite` via `@dawn-ai/memory`'s `sqliteMemoryStore`, `@pretable/react` 0.3.0 / `@pretable/core` 0.3.0, `@pretable-internal/bench-runner`, Chrome DevTools Protocol tracing, changesets.

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


## Preamble — read before the first command

These are traps that cost real time in slices 1 and 2. They are not optional reading.

1. **Line anchors rot. Locate by SYMBOL.** `origin/main` moved more than five times during slice 1–2 execution, in both repos. Every "open file X around line N" instinct is wrong here. Use `grep -n "symbolName" path` and edit around what you find. This plan deliberately names functions, exported constants and `data-*` attributes rather than line numbers.

2. **A types-only assertion is INVISIBLE to `vitest run`.** esbuild strips types before vitest ever sees the file, so a `.contract.ts` file full of `Identical<A, B>` assertions passes `vitest` even when it is red. Its failure only appears under `pnpm --filter <pkg> typecheck`. Any step in this plan that says "see it fail" for a type-level assertion states `typecheck` as the command, never `test`.

3. **Stale `dist/` and turbo cache produce fake passes.** `packages/memory-pgvector` consumes `@dawn-ai/testing` through `dist`, so a conformance-suite edit needs `pnpm --filter @dawn-ai/testing build` before a `DAWN_TEST_PGVECTOR=1` run means anything. Likewise the Playwright lane boots `.next/standalone/packages/inspector/server.js` — a source edit that is not followed by `pnpm turbo run build --filter=@dawn-ai/inspector...` is testing the previous build. When a result surprises you, rebuild before believing it.

4. **NEVER `git stash`.** The stash stack is shared across every worktree on this machine and a parallel session's `pop` can steal your entry. Commit, or write a patch file into the scratchpad.

5. **This machine runs concurrent sessions at load 55–160.** A vitest timeout at the 5 s default is usually load, not a bug. Re-run the single file with `--testTimeout=30000` before believing a failure. Playwright specs in this plan carry explicit `test.setTimeout` where they wait on poll cadence.

6. **Slices 3 and 4 are assumed landed.** This plan consumes their artifacts by name: the `useMemoryBrowse` hook, the load-more footer control, the per-kind banner slots, typed columns with pruned operators, and the exact-namespace facet. **Task 3 is a preflight that pins every DOM hook these specs depend on** — run it first and add any attribute it finds missing, in the component that owns it. Do not adapt the specs to whatever markup happens to exist; adapt the markup to the pinned contract, which is what the design's §9.2 keyboard topology and §4.5 ARIA rules require anyway.

7. **Verified deviations from the design's sketch** — the shipped pretable API differs from §4 of the design in four ways this plan depends on. Each was re-read in the shipped source before this plan was written:
   - `staleAnnouncement` is a real `PretableSurfaceMessages` entry (default `"Updating results…"`), and `scheduleAnnouncement` gives `"error"` priority over a pending `"user"` message, which in turn outranks a pending `"lifecycle"` message.
   - No body-state block carries a live-region role. `bodyStateBlock` renders with `data-pretable-body-state` and **no** `role="alert"`/`role="status"`. Failures reach assistive technology only through `dataErrorAnnouncement` on the single permanent polite region (`[data-pretable-live-region]`, portalled to `document.body`).
   - A `datasetKey` pivot latches controlled `selection` **and** `focus` in `usePretable`: a controlled slice whose *value* is unchanged across the pivot is not re-applied, and the latch suspends controlled authority over that slice until the consumer supplies a value minted for the new dataset. Slice 5 therefore prunes bulk selection through the imperative `grid.setSelection(...)`, which is not latched — see Task 15.
   - `dataState` has **no default**. Omitting the prop turns lifecycle presentation entirely off: no body blocks, no phase announcements, no `data-pretable-data-phase` attribute. Scenario 14 (local regression) asserts exactly this on the search-view grid.
   - Dawn's `limit` ceiling (1..1000) is enforced at the HTTP route only (`parseBrowseQuery` passes `{ maxLimit: BROWSE_MAX_LIMIT }`), never inside the stores.

8. **Budget honesty.** Section "Budget status" below marks every §11 number as *measured*, *estimated* or *proposed-unmeasured*. Do not let a task report "budget met" for a number this plan classifies as proposed until the measuring step in Task 18 or Task 21 has actually run and its output has been pasted into the budget-status doc.

---

## Budget status — verified vs proposed

Copied into `docs/superpowers/notes/2026-08-10-d1-budget-status.md` by Task 21. Classification comes from design §11's own grounding column.

| Budget | Value | Status entering slice 5 |
| --- | --- | --- |
| Server: windowed fetch, default order, keyset | p95 < 10 ms @100k SQLite | **Measured** (0.54 ms per-statement, §5.5). Ceiling carries decode margin — re-measure whole-`browse()` in Task 18. |
| Server: filtered `COUNT(*)` | p95 < 25 ms @100k SQLite | **Measured** (5.1 ms). |
| Server: head refresh (rows+count, resident 1 000) | p95 < 50 ms @100k | **Measured indirectly** (~3–8 ms + decode); never measured at `limit = 1000`. Task 18 measures it for the first time. |
| Server: non-default sort window | p95 < 50 ms @100k | **Measured** (12.6 ms). |
| Server: content contains | p95 < 150 ms @100k | **Measured** (46 ms rare-term worst case). |
| Server: any Postgres figure | < 30 / 100 ms | **Estimated only.** No pgvector bench has ever run. Task 18 adds the gated lane; until it runs on a real container these stay estimates. |
| Client: replace (refresh, 200 rows) | < 20 ms grid work, no grid reconstruction | **Proposed, unmeasured.** Task 21 produces the first number. |
| Client: append (200 onto 1 800) | < 30 ms grid work, zero scroll movement | **Proposed, unmeasured.** Task 21 produces the first number. Note the design's own row says "200 onto 1 800" while §11's resident cap is 1 000 — this plan measures **200 onto 800**, at the cap, and records the discrepancy. |
| Client memory at resident cap | ≤ 32 MB grid-attributable heap | **Proposed, unmeasured.** Task 21 produces the first number. |
| Poll tick, no changes | < 10 ms client CPU, zero announcements | **Proposed, unmeasured** for CPU; the zero-announcement half is asserted by Task 12. |
| End-to-end interaction | p95 < 300 ms local server | **Derived sum, unverified.** Task 4 asserts it in e2e for the filter and sort paths. |

---

## File Structure

### dawn (`/Users/blove/repos/dawn`)

| File | Single responsibility |
| --- | --- |
| `packages/inspector/test/seed.ts` | The deterministic 1 250-record browse fixture: pure `browseSeedRecords()`, pure ordering/filtering expectations, and `writeBrowseSeed()` that puts them in a SQLite store. |
| `packages/inspector/test/components/seed.test.ts` | Pins the seed's invariants (count, tie blocks, the beyond-window needle, the namespace prefix sibling, the confidence ties) so a later edit cannot silently break every spec at once. |
| `packages/inspector/e2e/serve.ts` | Seeds the fixture app and boots the built standalone server on a fixed port for Playwright's `webServer`. |
| `packages/inspector/playwright.config.ts` | The Playwright project: base URL, `webServer`, single worker, console-error gate reporter settings. |
| `packages/inspector/e2e/fixtures.ts` | The shared `test` export: a `page` wrapped with the console-error gate, plus `expect`. |
| `packages/inspector/e2e/helpers.ts` | Locators and waits every spec shares (`grid`, `expectPhase`, `rowIds`, `scrollTop`, `liveRegionText`, `loadMore`). |
| `packages/inspector/src/components/memory/test-ids.ts` | The single source of truth for every `data-testid` the verification lane depends on. |
| `packages/inspector/test/components/test-id-contract.test.tsx` | Renders the Inspector and asserts each pinned test id exists — the preflight that fails loudly if slice 3/4 markup drifted. |
| `packages/inspector/e2e/01-beyond-window-filter.spec.ts` … `14-local-regression.spec.ts` | One file per dogfood acceptance scenario, named for the scenario. |
| `packages/inspector/e2e/a11y-counts.spec.ts` | `aria-rowcount`/`aria-rowindex` under exact totals and every downgrade; no `aria-busy` anywhere. |
| `packages/inspector/e2e/a11y-announcements.spec.ts` | Announcement single-channel rules and the silent no-change poll tick. |
| `packages/inspector/e2e/a11y-focus.spec.ts` | Focus continuity across query reset, refresh, append and failure. |
| `packages/inspector/e2e/a11y-keyboard.spec.ts` | The keyboard-only walkthrough: filters, sort, load-more, retry, selection, bulk actions, reaching content after the grid. |
| `packages/inspector/src/components/memory/bulk-bar.tsx` | Gains a per-id outcome report so the caller can prune succeeded ids. |
| `packages/inspector/src/components/memory/memory-grid.tsx` | Gains `onGridReady` passthrough and the exported `buildRowSelection` helper. |
| `packages/inspector/src/components/memory/list-page.tsx` | Prunes succeeded ids from the selection, suspends polling for the duration of a bulk run. |
| `packages/inspector/test/components/bulk-safety.test.tsx` | Partial failure leaves only failures selected; a retry re-sends failures only; the confirmation snapshots the id list. |
| `packages/inspector/test/components/polling-identity.test.tsx` | Every poll tick carries the active query revision's parameters; a tick answering a dead revision is discarded; polling pauses for a bulk run. |
| `packages/memory/bench/browse-budgets.mts` | Measures the five §11 server budgets against a seeded store and prints a pass/fail table. |
| `packages/memory/src/browse-budget.ts` | The pure `checkBrowseBudgets()` comparison the bench and its unit test share. |
| `packages/memory/test/browse-budget.test.ts` | Unit-tests the pure checker (no clock, no database). |
| `packages/memory/package.json` | Adds the `bench:budgets` script. |
| `packages/inspector/package.json` | Adds `@playwright/test`, the `test:e2e` script, and lints the new dirs. |
| `.github/workflows/ci.yml` | Adds the Playwright step to the existing `inspector-e2e` job. |
| `docs/superpowers/notes/2026-08-10-voiceover-walkthrough.md` | The recorded VoiceOver pass: script, observations, verdict per state. |
| `docs/superpowers/notes/2026-08-10-d1-budget-status.md` | Measured-vs-proposed budget ledger, filled in by Tasks 17 and 20. |
| `.changeset/dawn-inspector-verification.md` | Single fixed-version-group changeset for the shipped behavior changes. |

### pretable (`/Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a`)

| File | Single responsibility |
| --- | --- |
| `packages/bench-runner/src/index.ts` | Adds `"replace"`/`"append"` to `BenchScriptName`, `grid_instance_reconstructed` to `BenchMetricId`, and their required-metric assertions. |
| `packages/bench-runner/src/__tests__/bench-runner.test.ts` | Extends the vocabulary tests to the two new scripts and the new metric. |
| `apps/bench/src/bench-types.ts` | Widens `BenchQueryState["scriptName"]` to the two new scripts. |
| `apps/bench/src/query-state.ts` | Parses `script=replace` / `script=append`. |
| `apps/bench/src/data-update-plan.ts` | Builds the replace and append row payloads from a scenario dataset. |
| `apps/bench/src/bench-runtime.ts` | `measureBenchDataUpdateRun` — the replace/append measurement, reusing the `pretable.interaction.*` marks. |
| `apps/bench/src/pretable-adapter.tsx` | Exposes `onDataApiReady` (a `grid.setRows` entry point) and publishes the grid-instance id for the reconstruction metric. |
| `apps/bench/src/bench-app.tsx` | Dispatches the two new scripts. |
| `scripts/check-bench-budgets.mjs` | Reads bench artifacts and asserts the §11 client budgets. |
| `scripts/__tests__/check-bench-budgets.test.mjs` | Unit-tests the pure budget comparison. |
| `.changeset/bench-replace-append.md` | Changeset for the internal bench vocabulary change. |

---

## Task 1: The deterministic browse fixture

**Files:**
- `packages/inspector/test/seed.ts`
- `packages/inspector/test/components/seed.test.ts`

Every spec in this plan reads its expectations out of this one module. Nothing downstream may hard-code a record id that is not derived here.

- [ ] **Step 1: Create the failing seed test.**
  Create `packages/inspector/test/components/seed.test.ts` with exactly:

  ```ts
  import { describe, expect, it } from "vitest"
  import {
    BROWSE_PAGE_SIZE,
    BROWSE_RESIDENT_CAP,
    BROWSE_SEED_COUNT,
    browseSeedRecords,
    NEEDLE_ID,
    NEEDLE_TERM,
    seedIdsInDefaultOrder,
    seedIdsSortedBy,
    seedRecordsMatching,
  } from "../seed"

  describe("browse seed fixture", () => {
    it("is larger than one window and larger than the resident cap", () => {
      expect(BROWSE_PAGE_SIZE).toBe(200)
      expect(BROWSE_RESIDENT_CAP).toBe(1000)
      expect(BROWSE_SEED_COUNT).toBe(1250)
      expect(browseSeedRecords()).toHaveLength(1250)
    })

    it("is pure — two calls produce equal records", () => {
      expect(browseSeedRecords()).toEqual(browseSeedRecords())
    })

    it("puts ten records on every updatedAt so the id tie-break is exercised in every window", () => {
      const byStamp = new Map<string, string[]>()
      for (const record of browseSeedRecords()) {
        byStamp.set(record.updatedAt, [...(byStamp.get(record.updatedAt) ?? []), record.id])
      }
      expect(byStamp.size).toBe(125)
      for (const ids of byStamp.values()) expect(ids).toHaveLength(10)
    })

    it("hides the content needle beyond the first default window", () => {
      const order = seedIdsInDefaultOrder()
      expect(order.indexOf(NEEDLE_ID)).toBeGreaterThan(BROWSE_PAGE_SIZE)
      expect(seedRecordsMatching({ contentContains: NEEDLE_TERM }).map((r) => r.id)).toEqual([
        NEEDLE_ID,
      ])
    })

    it("carries a namespace that is a strict prefix of another namespace", () => {
      const exact = seedRecordsMatching({ namespace: "route=/notes" })
      const prefixed = seedRecordsMatching({ namespacePrefix: "route=/notes" })
      expect(exact.length).toBeGreaterThan(0)
      expect(prefixed.length).toBeGreaterThan(exact.length)
      expect(exact.every((r) => r.namespace === "route=/notes")).toBe(true)
    })

    it("ties confidence 25 ways so a sort window is only deterministic with the id tie-break", () => {
      const top = seedIdsSortedBy([{ field: "confidence", dir: "desc" }]).slice(0, 25)
      const records = new Map(browseSeedRecords().map((r) => [r.id, r]))
      expect(new Set(top.map((id) => records.get(id)?.confidence)).size).toBe(1)
      expect(top).toEqual([...top].sort())
    })
  })
  ```

- [ ] **Step 2: Run it and see it fail on the missing module.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/seed.test.ts
  ```
  Expect: `Error: Failed to load url ../seed` / `Cannot find module`. The file does not exist yet.

- [ ] **Step 3: Write the seed module.**
  Create `packages/inspector/test/seed.ts`:

  ```ts
  import { join } from "node:path"
  import type { MemoryKind, MemoryRecord, MemoryStatus } from "@dawn-ai/memory"
  import { sqliteMemoryStore } from "@dawn-ai/memory"
  import type { BrowseSortEntry } from "@dawn-ai/memory/browse"

  /** The Inspector's request window (design §11 "default window / page size"). */
  export const BROWSE_PAGE_SIZE = 200
  /** The client-side resident cap (design §11), deliberately equal to BROWSE_MAX_LIMIT. */
  export const BROWSE_RESIDENT_CAP = 1000
  /** Six-and-a-quarter windows: proves paging, proves the cap, and leaves 250 records
   *  the client can never hold at once. */
  export const BROWSE_SEED_COUNT = 1250

  /** The one record whose content is unique, placed beyond the first default window so a
   *  content filter that finds it can only have been applied server-side. */
  export const NEEDLE_ID = "mem-0900"
  export const NEEDLE_TERM = "zephyr-needle"

  const KINDS: readonly MemoryKind[] = ["semantic", "episodic", "procedural", "reflection"]
  const STATUSES: readonly MemoryStatus[] = ["candidate", "active", "superseded"]
  const BASE_MS = Date.UTC(2026, 0, 1, 0, 0, 0)

  /** `route=/notes-archive` exists ONLY so an exact `route=/notes` can prove it excludes
   *  prefix siblings (dogfood scenario 4). */
  function namespaceFor(index: number): string {
    if (index % 5 === 0) return "route=/notes-archive"
    if (index % 3 === 0) return "route=/chat"
    return "route=/notes"
  }

  /**
   * The fixture, as data. Pure and stable: every expectation in the verification lane is
   * computed from this array rather than transcribed, so a seed change moves the
   * expectations with it instead of reddening forty assertions at once.
   */
  export function browseSeedRecords(): MemoryRecord[] {
    const records: MemoryRecord[] = []
    for (let index = 0; index < BROWSE_SEED_COUNT; index += 1) {
      // Ten records share each timestamp: the id tie-break then decides order INSIDE
      // every window, not only at a page seam that a single walk might never hit.
      const stamp = new Date(BASE_MS + Math.floor(index / 10) * 60_000).toISOString()
      records.push({
        id: `mem-${String(index).padStart(4, "0")}`,
        kind: KINDS[index % KINDS.length] as MemoryKind,
        namespace: namespaceFor(index),
        content:
          index === 900
            ? `${NEEDLE_TERM} beyond the first window`
            : `acme threshold ${index}`,
        data: {},
        source: { type: "eval", id: "seed" },
        // 25 records per distinct value: a confidence window is deterministic only
        // because the store terminates every sort with `id ASC`.
        confidence: (index % 50) / 50,
        tags: [],
        status: STATUSES[index % STATUSES.length] as MemoryStatus,
        createdAt: stamp,
        updatedAt: stamp,
      })
    }
    return records
  }

  function compareBy(entries: readonly BrowseSortEntry[]) {
    return (a: MemoryRecord, b: MemoryRecord): number => {
      for (const entry of entries) {
        const left = a[entry.field]
        const right = b[entry.field]
        let delta = 0
        if (typeof left === "number" && typeof right === "number") delta = left - right
        else delta = String(left).localeCompare(String(right))
        if (delta !== 0) return entry.dir === "desc" ? -delta : delta
      }
      // The store's terminator, mirrored: id ASC, always, whatever the sort.
      return a.id.localeCompare(b.id)
    }
  }

  /** The documented default order: `updatedAt DESC, id ASC`. */
  export function seedIdsInDefaultOrder(records = browseSeedRecords()): string[] {
    return seedIdsSortedBy([{ field: "updatedAt", dir: "desc" }], records)
  }

  export function seedIdsSortedBy(
    entries: readonly BrowseSortEntry[],
    records = browseSeedRecords(),
  ): string[] {
    return [...records].sort(compareBy(entries)).map((record) => record.id)
  }

  export interface SeedPredicate {
    readonly namespace?: string
    readonly namespacePrefix?: string
    readonly status?: readonly MemoryStatus[]
    readonly kind?: readonly MemoryKind[]
    readonly contentContains?: string
    readonly confidenceGte?: number
  }

  /** The predicate semantics of `BrowseQuery`, as a pure filter over the fixture. */
  export function seedRecordsMatching(
    predicate: SeedPredicate,
    records = browseSeedRecords(),
  ): MemoryRecord[] {
    return records.filter((record) => {
      if (predicate.namespace !== undefined && record.namespace !== predicate.namespace)
        return false
      if (
        predicate.namespacePrefix !== undefined &&
        !record.namespace.startsWith(predicate.namespacePrefix)
      )
        return false
      if (predicate.status !== undefined && !predicate.status.includes(record.status)) return false
      if (predicate.kind !== undefined && !predicate.kind.includes(record.kind)) return false
      if (
        predicate.contentContains !== undefined &&
        !record.content.toLowerCase().includes(predicate.contentContains.toLowerCase())
      )
        return false
      if (predicate.confidenceGte !== undefined && record.confidence < predicate.confidenceGte)
        return false
      return true
    })
  }

  /** Write the fixture into `<appRoot>/.dawn/memory.sqlite`. Node-only. */
  export async function writeBrowseSeed(appRoot: string): Promise<void> {
    const store = sqliteMemoryStore({ path: join(appRoot, ".dawn", "memory.sqlite") })
    for (const record of browseSeedRecords()) {
      await store.put(record)
    }
  }
  ```

- [ ] **Step 4: Run the seed test and see it pass.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/seed.test.ts
  ```
  Expect: `6 passed`.

- [ ] **Step 5: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/test/seed.ts packages/inspector/test/components/seed.test.ts && git commit -m "test(inspector): a deterministic 1250-record browse fixture with computed expectations" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 2: The Playwright lane

**Files:**
- `packages/inspector/package.json`
- `packages/inspector/e2e/serve.ts`
- `packages/inspector/playwright.config.ts`
- `packages/inspector/e2e/fixtures.ts`
- `packages/inspector/e2e/helpers.ts`
- `packages/inspector/e2e/00-smoke.spec.ts`
- `packages/inspector/test/fixtures/browse-app/package.json`
- `packages/inspector/test/fixtures/browse-app/dawn.config.ts`
- `packages/inspector/test/fixtures/browse-app/src/app/notes/index.ts`
- `packages/inspector/test/fixtures/browse-app/src/app/notes/memory.ts`

- [ ] **Step 1: Create the fixture app the lane seeds.**
  Create `packages/inspector/test/fixtures/browse-app/package.json`:
  ```json
  { "name": "browse-fixture-app", "private": true, "type": "module" }
  ```
  Create `packages/inspector/test/fixtures/browse-app/dawn.config.ts`:
  ```ts
  // A dedicated app root so the verification lane's 1250-record store never collides
  // with the small `test/fixtures/app` store the JSON-API e2e tests seed and wipe.
  import { join } from "node:path"
  import { sqliteMemoryStore } from "@dawn-ai/memory"

  export default {
    appDir: "src/app",
    memory: {
      writes: "candidate",
      store: sqliteMemoryStore({ path: join(import.meta.dirname, ".dawn", "memory.sqlite") }),
    },
  }
  ```
  Create `packages/inspector/test/fixtures/browse-app/src/app/notes/index.ts`:
  ```ts
  export default {}
  ```
  Create `packages/inspector/test/fixtures/browse-app/src/app/notes/memory.ts`:
  ```ts
  import { z } from "zod"

  export default {
    kind: "semantic",
    scope: ["route"],
    schema: z.object({ subject: z.string(), predicate: z.string(), value: z.string() }),
  }
  ```

- [ ] **Step 2: Write the server launcher.**
  Create `packages/inspector/e2e/serve.ts`:
  ```ts
  // Playwright's `webServer` command. Wipes and re-seeds the browse fixture, then execs
  // the BUILT standalone server — the same artifact `dawn inspect` ships, which is the
  // only thing worth asserting against. Run under Node 24: this file is TypeScript and
  // relies on native type stripping.
  import { spawn } from "node:child_process"
  import { mkdirSync, rmSync } from "node:fs"
  import { join } from "node:path"
  import { fileURLToPath } from "node:url"
  import { writeBrowseSeed } from "../test/seed"

  const pkgRoot = fileURLToPath(new URL("..", import.meta.url))
  const appRoot = join(pkgRoot, "test/fixtures/browse-app")
  const serverJs = join(pkgRoot, ".next/standalone/packages/inspector/server.js")
  const port = process.env.INSPECTOR_E2E_PORT ?? "3919"

  rmSync(join(appRoot, ".dawn"), { recursive: true, force: true })
  mkdirSync(join(appRoot, ".dawn"), { recursive: true })
  await writeBrowseSeed(appRoot)

  const child = spawn(process.execPath, [serverJs], {
    env: { ...process.env, DAWN_APP_ROOT: appRoot, PORT: port, HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  })
  child.on("exit", (code) => process.exit(code ?? 1))
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => child.kill(signal))
  }
  ```

- [ ] **Step 3: Write the Playwright config.**
  Create `packages/inspector/playwright.config.ts`:
  ```ts
  import { defineConfig } from "@playwright/test"

  const port = process.env.INSPECTOR_E2E_PORT ?? "3919"

  export default defineConfig({
    testDir: "./e2e",
    // One worker, always: every spec drives the SAME seeded store and several of them
    // mutate it. Parallel workers would make scenario 9 (concurrent write) delete a row
    // scenario 5 is counting.
    workers: 1,
    fullyParallel: false,
    forbidOnly: !!process.env.CI,
    retries: 0,
    timeout: 60_000,
    expect: { timeout: 10_000 },
    reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
    use: {
      baseURL: `http://127.0.0.1:${port}`,
      trace: "retain-on-failure",
    },
    webServer: {
      command: `node e2e/serve.ts`,
      url: `http://127.0.0.1:${port}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  })
  ```

- [ ] **Step 4: Write the shared fixtures with the console-error gate.**
  Create `packages/inspector/e2e/fixtures.ts`:
  ```ts
  import { test as base, expect } from "@playwright/test"

  /**
   * Every spec fails on a console error or an uncaught page exception. The design's
   * verification requirement names a "console-error gate"; making it a fixture means no
   * spec can forget it, and the failure names the spec that produced it.
   */
  export const test = base.extend<{ consoleErrors: string[] }>({
    consoleErrors: async ({ page }, use, testInfo) => {
      const errors: string[] = []
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
      })
      page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`))
      await use(errors)
      if (testInfo.status === testInfo.expectedStatus) {
        expect(errors, `console errors during "${testInfo.title}"`).toEqual([])
      }
    },
  })

  export { expect }
  ```

- [ ] **Step 5: Write the shared helpers.**
  Create `packages/inspector/e2e/helpers.ts`:
  ```ts
  import type { Locator, Page } from "@playwright/test"
  import { expect } from "@playwright/test"
  import { TEST_IDS } from "../src/components/memory/test-ids"

  /** The browse grid. Pretable puts role + aria-label + the phase attribute on the
   *  scroll viewport itself, so this one locator is also the ARIA subject. */
  export function grid(page: Page): Locator {
    return page.locator('[data-pretable-scroll-viewport][aria-label="Memories"]')
  }

  /** Pretable's own hydration signal. Clicking before it flips is silently dropped —
   *  the single largest source of flaky "clicked it, nothing happened" e2e failures. */
  export async function openBrowse(page: Page): Promise<void> {
    await page.goto("/memory")
    await expect(grid(page)).toHaveAttribute("data-pretable-hydrated", "true")
    await expectPhase(page, "idle")
  }

  export async function expectPhase(
    page: Page,
    phase: "idle" | "loading" | "stale" | "refreshing" | "loading-more" | "error",
  ): Promise<void> {
    await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", phase)
  }

  export async function rowIds(page: Page): Promise<string[]> {
    return grid(page)
      .locator("[data-pretable-row-id]")
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.pretableRowId ?? ""),
      )
  }

  export async function scrollTop(page: Page): Promise<number> {
    return grid(page).evaluate((node) => node.scrollTop)
  }

  /** The single permanent polite region, portalled to document.body. */
  export async function liveRegionText(page: Page): Promise<string> {
    return page.locator("[data-pretable-live-region]").innerText()
  }

  export function loadMore(page: Page): Locator {
    return page.getByTestId(TEST_IDS.loadMore)
  }

  export function status(page: Page): Locator {
    return page.getByTestId(TEST_IDS.status)
  }

  /** Wait out one full poll period plus response latency. The cadence is 2 s. */
  export async function waitOnePollPeriod(page: Page): Promise<void> {
    await page.waitForTimeout(2_600)
  }
  ```

- [ ] **Step 6: Write the smoke spec.**
  Create `packages/inspector/e2e/00-smoke.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT, seedIdsInDefaultOrder } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { grid, openBrowse, rowIds } from "./helpers"

  test("the standalone server serves the seeded browse dataset", async ({
    page,
    consoleErrors,
  }) => {
    void consoleErrors
    await openBrowse(page)
    await expect(grid(page)).toBeVisible()
    const ids = await rowIds(page)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids.length).toBeLessThanOrEqual(BROWSE_PAGE_SIZE)
    // The first window is the head of the documented default order, not an arbitrary
    // slice: this one assertion is what makes every later "beyond the window" claim mean
    // something.
    expect(ids).toEqual(seedIdsInDefaultOrder().slice(0, ids.length))
    expect(BROWSE_SEED_COUNT).toBe(1250)
  })
  ```

- [ ] **Step 7: Add the dependency and the script.**
  In `packages/inspector/package.json`, add `"@playwright/test": "1.62.1"` to `devDependencies` (alphabetical, after `@dawn-ai/config-typescript`), add to `scripts`:
  ```json
  "test:e2e": "playwright test --config playwright.config.ts",
  ```
  and extend the `lint` script's path list by appending ` e2e playwright.config.ts` before the closing quote.

- [ ] **Step 8: Install and build.**
  ```
  cd /Users/blove/repos/dawn && pnpm install && pnpm exec playwright install --with-deps chromium && pnpm turbo run build --filter=@dawn-ai/inspector...
  ```
  Expect the build to end with `Successfully compiled` / turbo's `Tasks: N successful`.

- [ ] **Step 9: Run the smoke spec and see it pass.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 00-smoke
  ```
  Expect: `1 passed`. If it fails on the missing `TEST_IDS` import from `helpers.ts`, that is Task 3 — do Task 3 first and re-run.

- [ ] **Step 10: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/playwright.config.ts packages/inspector/e2e packages/inspector/test/fixtures/browse-app packages/inspector/package.json pnpm-lock.yaml && git commit -m "test(inspector): a Playwright lane over the built standalone server" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 3: Pin the verification DOM contract

**Files:**
- `packages/inspector/src/components/memory/test-ids.ts`
- `packages/inspector/test/components/test-id-contract.test.tsx`
- (whichever slice 3/4 components are missing an attribute)

This is the preflight. It converts "the specs assume slice 4 rendered a load-more button" from a silent assumption into a red test.

- [ ] **Step 1: Write the contract module.**
  Create `packages/inspector/src/components/memory/test-ids.ts`:
  ```ts
  /**
   * The DOM hooks the verification lane depends on. One module so a rename is one edit
   * and a missing hook is one red test rather than fourteen mysterious spec failures.
   *
   * Pretable's own hooks (`data-pretable-data-phase`, `data-pretable-row-id`,
   * `data-pretable-live-region`, `data-pretable-body-state`,
   * `data-pretable-scroll-viewport`, `data-pretable-hydrated`) are NOT listed here:
   * they are public API of @pretable/react and are pinned by that package's tests.
   */
  /** The banner line for one failing source — `BrowseErrorBanners` keys its lines by
   *  source, and the set of sources is open. */
  export function errorBannerId<S extends string>(source: S): `error-${S}` {
    return `error-${source}`
  }

  export const TEST_IDS = {
    /** The browse subtree — load-bearing as a SCOPE: it stays mounted-and-`hidden`
     *  across view switches, and a search renders more grids beside it. */
    browseRegion: "browse-region",
    /** Wraps the count/total/as-of chrome that sits above the grid. */
    status: "browse-status",
    /** The exact matching total, rendered as text. */
    total: "browse-total",
    /** "updated 14:32:07" — shown only while polling is paused or suspended. */
    asOf: "browse-as-of",
    /** The footer control, OUTSIDE the grid viewport (design §9.2). */
    loadMore: "load-more",
    /** Retry inside the error body block, supplied through `renderBodyState`. */
    retryInitial: "browse-retry-initial",
    /** Per-kind banner slots for the two browse REQUEST kinds — one kind's success can
     *  never clear another's failure. A MUTATION's failures are not banners: they stay
     *  in the bulk bar beside the ids that failed (`bulkError`). */
    bannerRefresh: errorBannerId("refresh"),
    bannerLoadMore: errorBannerId("load-more"),
    /** ONE retry for the banners, not one per kind: `retry()` is a single intent and
     *  the reducer chooses which kind to re-attempt (load-more before refresh). */
    bannerRetry: "browse-banner-retry",
    /** The live/paused polling toggle. */
    liveToggle: "live-toggle",
    /** The bulk bar, and the per-id failures it holds on screen. */
    bulkBar: "bulk-bar",
    bulkError: "bulk-error",
    /** Search-view controls that are disabled-with-reason (design §8.2). */
    searchScopeNote: "search-scope-note",
  } as const
  ```

- [ ] **Step 2: Write the failing contract test.**
  Create `packages/inspector/test/components/test-id-contract.test.tsx`:
  ```tsx
  import { cleanup, render, screen, waitFor } from "@testing-library/react"
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
  import { ListPage } from "../../src/components/memory/list-page"
  import { TEST_IDS } from "../../src/components/memory/test-ids"
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT, browseSeedRecords } from "../seed"

  /** One page of the fixture plus the honest total — enough for the chrome to render
   *  every state the lane targets. */
  function browsePage() {
    return {
      records: browseSeedRecords().slice(0, BROWSE_PAGE_SIZE),
      total: BROWSE_SEED_COUNT,
      continuation: "cursor-1",
    }
  }

  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/api/memory/stats"))
          return jsonResponse({
            total: BROWSE_SEED_COUNT,
            byStatus: {},
            byKind: {},
            byNamespace: {},
            bySourceType: {},
          })
        if (url.includes("/api/memory/list")) return jsonResponse(browsePage())
        // 404 rather than an empty 200: an endpoint this file has not stubbed must fail
        // where it is called. A `{}` body is a shape every reader here parses into "no
        // rows, no total", which reads as a missing HOOK several assertions later.
        return jsonResponse({ error: "unstubbed endpoint" }, 404)
      }),
    )
  })

  /** Explicit: this project does not set `globals`, so RTL never registers its own
   *  auto-cleanup. Without this the second `render` stacks on the first, and the
   *  containment check below reads a viewport from one tree and a control from the
   *  other — which passes, while proving nothing. */
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  /**
   * Every id in the module, decided.
   *
   * `"mounted"` means the hook is in the DOM of a `ListPage` whose first responses
   * succeeded, which is what the first test renders. Every other entry names the
   * condition that produces the hook — each needs a failure, a selection or a paused
   * poll this file does not stage, and they are reached by the component suites and by
   * the Playwright scenarios instead.
   *
   * Typed on `keyof typeof TEST_IDS`, so an id added to the module without a decision
   * fails `pnpm typecheck`; the parity test below catches the same thing under the
   * runner. An id nobody decided is the failure mode this module exists to prevent:
   * the lane trusts it and finds out fifteen scenarios later, as a locator timeout.
   */
  const COVERAGE: Record<keyof typeof TEST_IDS, "mounted" | string> = {
    browseRegion: "mounted",
    status: "mounted",
    total: "mounted",
    loadMore: "mounted",
    liveToggle: "mounted",
    // In the document from the first paint and `hidden` until a search runs. Presence
    // is what a rename breaks; `view-scope.test.tsx` reads what it says.
    searchScopeNote: "mounted",
    asOf: "only while polling is paused",
    retryInitial: "only in the error phase, and only while the grid is visible",
    bannerRefresh: "only once a poll tick has failed",
    bannerLoadMore: "only once an append has failed",
    bannerRetry: "only while a browse request's failure is banner-borne",
    bulkBar: "only while rows are ticked",
    bulkError: "only once a bulk mutation has partly failed",
  }

  const MOUNTED_IDS = Object.entries(COVERAGE).flatMap(([key, when]) =>
    when === "mounted" ? [TEST_IDS[key as keyof typeof TEST_IDS]] : [],
  )

  describe("verification DOM contract", () => {
    it("renders every hook the Playwright lane locates by", async () => {
      // A loop over an empty list passes: this test's subject is the LIST as much as
      // the assertions, and the list is derived.
      expect(MOUNTED_IDS.length).toBeGreaterThan(0)
      render(<ListPage />)
      for (const id of MOUNTED_IDS) {
        await waitFor(() => expect(screen.getByTestId(id)).toBeTruthy())
      }
    })

    it("leaves no id in the module undecided", () => {
      expect(Object.keys(COVERAGE).sort()).toEqual(Object.keys(TEST_IDS).sort())
    })

    it("puts the load-more control OUTSIDE the grid viewport", async () => {
      render(<ListPage />)
      const control = await screen.findByTestId(TEST_IDS.loadMore)
      // Scoped to the browse region and pinned to exactly one. A search renders a grid
      // — so a second viewport — beside this one, and a document-wide first match could
      // read the viewport this control was never in danger of being inside, passing for
      // a reason that has nothing to do with the placement §9.2 asks for.
      const viewports = screen
        .getByTestId(TEST_IDS.browseRegion)
        .querySelectorAll("[data-pretable-scroll-viewport]")
      expect(viewports).toHaveLength(1)
      expect(viewports[0]?.contains(control)).toBe(false)
    })
  })
  ```

- [ ] **Step 3: Run it and read the failure.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/test-id-contract.test.tsx --testTimeout=30000
  ```
  Expect one of two outcomes. Either it passes (slices 3–4 already used these ids — then skip step 4), or it fails with `Unable to find an element by: [data-testid="…"]` naming the first missing hook.

- [ ] **Step 4: Add each missing attribute at its owner.**
  For every id the test reports missing, add `data-testid={TEST_IDS.<name>}` to the element that already renders that concept. Locate by symbol, not by line:
  - `status`, `total`, `asOf` → `BrowseStatusBar` in `packages/inspector/src/components/memory/browse-chrome.tsx` (grep for the element that renders the matching total).
  - `loadMore` → the footer control slice 4 added; grep `grep -n "loadMore" packages/inspector/src/components/memory/*.tsx`.
  - `retryInitial` → the button inside the `renderBodyState` callback; grep `grep -n "renderBodyState" packages/inspector/src/components/memory/memory-grid.tsx`.
  - `bannerRefresh` / `bannerLoadMore` / `bannerRetry` → `BrowseErrorBanners` in `browse-chrome.tsx`: the lines are keyed by source (`errorBannerId`) and the retry is ONE control, because `retry()` is one intent whose kind the reducer picks.
  - `liveToggle` → the existing `live` checkbox `<input>` in `list-page.tsx`.
  - `searchScopeNote` → the `aria-describedby` target that says "Not applied to search".
  Re-run the command from step 3 until it reports `3 passed`.

- [ ] **Step 5: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/src/components/memory packages/inspector/test/components/test-id-contract.test.tsx packages/inspector/test/components/view-scope.test.tsx && git commit -m "test(inspector): pin the verification DOM contract in one module" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 4: Scenarios 1–3 — beyond-window filter, global sort, multi-filter parity

**Files:**
- `packages/inspector/e2e/helpers.ts` (append)
- `packages/inspector/e2e/01-beyond-window-filter.spec.ts`
- `packages/inspector/e2e/02-global-sort.spec.ts`
- `packages/inspector/e2e/03-multi-filter-parity.spec.ts`

- [ ] **Step 1: Append the filter/sort driving helpers.**
  Append to `packages/inspector/e2e/helpers.ts`:
  ```ts
  /** Open a column's funnel. Pretable labels both the funnel button and the popover
   *  `Filter <header>`, and renders the popover through OverlayPortal — outside the
   *  grid, so it is located from the page, not from `grid(page)`. */
  export async function openFilterMenu(page: Page, header: string): Promise<Locator> {
    await page.getByRole("button", { name: `Filter ${header}`, exact: true }).click()
    const menu = page.locator("[data-pretable-filter-menu]")
    await expect(menu).toBeVisible()
    return menu
  }

  export async function applyTextFilter(
    page: Page,
    header: string,
    operator: string,
    value: string,
  ): Promise<void> {
    const menu = await openFilterMenu(page, header)
    await menu.locator("[data-pretable-filter-operator]").selectOption(operator)
    await menu.locator("[data-pretable-filter-value]").fill(value)
    await page.keyboard.press("Escape")
  }

  export async function applySetFilter(
    page: Page,
    header: string,
    values: readonly string[],
  ): Promise<void> {
    const menu = await openFilterMenu(page, header)
    for (const value of values) {
      await menu.locator("[data-pretable-filter-set]").getByRole("checkbox", { name: value }).check()
    }
    await page.keyboard.press("Escape")
  }

  export async function clearFilter(page: Page, header: string): Promise<void> {
    const menu = await openFilterMenu(page, header)
    await menu.locator("[data-pretable-filter-clear]").click()
    await page.keyboard.press("Escape")
  }

  /** Click a header cell to cycle its sort. */
  export async function sortByHeader(page: Page, header: string): Promise<void> {
    await grid(page)
      .locator("[data-pretable-header-cell]")
      .filter({ hasText: header })
      .first()
      .click()
  }

  /** Time a user action from the click to the fulfilled `idle` render. This is design
   *  §11's "end-to-end interaction" budget, measured rather than asserted by construction. */
  export async function timeToFulfilled(page: Page, act: () => Promise<void>): Promise<number> {
    const started = Date.now()
    await act()
    await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "idle")
    return Date.now() - started
  }
  ```

- [ ] **Step 2: Write scenario 1 and see it fail.**
  Create `packages/inspector/e2e/01-beyond-window-filter.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, NEEDLE_ID, NEEDLE_TERM, seedIdsInDefaultOrder, seedRecordsMatching } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { applySetFilter, applyTextFilter, clearFilter, openBrowse, rowIds, status, timeToFulfilled } from "./helpers"

  // D1-GRID-01, D1-QUERY-01..08. A matching record outside the initial window appears
  // after a server-side filter. If filtering were local, none of these could ever match:
  // the record is not in the loaded window when the filter is applied.
  test.describe("scenario 1 — beyond-window filter", () => {
    test("a content filter finds a record the first window never loaded", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const before = await rowIds(page)
      expect(before).not.toContain(NEEDLE_ID)
      expect(seedIdsInDefaultOrder().indexOf(NEEDLE_ID)).toBeGreaterThan(BROWSE_PAGE_SIZE)

      const elapsed = await timeToFulfilled(page, () =>
        applyTextFilter(page, "content", "contains", NEEDLE_TERM),
      )
      await expect.poll(() => rowIds(page)).toEqual([NEEDLE_ID])
      await expect(status(page)).toContainText("1")
      // Design §11: p95 < 300 ms against a local server. One sample is not a p95 — the
      // ceiling here is deliberately loose so the assertion catches a regression of
      // kind (a client round-trip storm), not of degree.
      expect(elapsed).toBeLessThan(2_000)
    })

    test("an enum filter narrows to the server's whole matching set, not the window's", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await applySetFilter(page, "status", ["superseded"])
      const expected = seedRecordsMatching({ status: ["superseded"] })
      await expect.poll(() => rowIds(page)).toEqual(
        expected.map((r) => r.id).filter((id) => seedIdsInDefaultOrder({
          // Re-order the matching set by the default order and take one window.
        } as never) !== undefined).slice(0, 0),
      )
    })
  })
  ```
  **Do not keep the second test as written** — it is deliberately broken so the next step has a real failure to fix. Run:
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 01-beyond-window
  ```
  Expect the first test to pass and the second to fail with an empty-array mismatch.

- [ ] **Step 3: Replace the second test with the correct assertion.**
  Replace the whole second `test(...)` block with:
  ```ts
    test("an enum filter narrows to the server's whole matching set, not the window's", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await applySetFilter(page, "status", ["superseded"])
      // The matching set, in the documented default order, truncated to one window —
      // exactly what a server-authoritative first page should be.
      const matching = seedRecordsMatching({ status: ["superseded"] })
      const expected = seedIdsInDefaultOrder(matching).slice(0, BROWSE_PAGE_SIZE)
      await expect.poll(() => rowIds(page)).toEqual(expected)
      await expect(status(page)).toContainText(String(matching.length))
      // Clearing restores the unfiltered head — clearing is a new query, not an undo.
      await clearFilter(page, "status")
      await expect.poll(() => rowIds(page)).toEqual(
        seedIdsInDefaultOrder().slice(0, BROWSE_PAGE_SIZE),
      )
    })
  ```
  Re-run the command from step 2. Expect: `2 passed`.

- [ ] **Step 4: Write scenario 2 and run it.**
  Create `packages/inspector/e2e/02-global-sort.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, browseSeedRecords, seedIdsSortedBy } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { openBrowse, rowIds, sortByHeader, timeToFulfilled } from "./helpers"

  // D1-QUERY-09, D1-QUERY-10. Sorting returns the GLOBALLY correct first window with a
  // deterministic tie-break — not a re-sort of the 200 rows already loaded, which would
  // present a recency-biased sample as a confidence-sorted result.
  test.describe("scenario 2 — global sort", () => {
    test("confidence DESC returns the global head with an id tie-break", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const loadedBefore = await rowIds(page)

      const elapsed = await timeToFulfilled(page, async () => {
        await sortByHeader(page, "confidence")
        await sortByHeader(page, "confidence")
      })

      const expected = seedIdsSortedBy([{ field: "confidence", dir: "desc" }]).slice(
        0,
        BROWSE_PAGE_SIZE,
      )
      await expect.poll(() => rowIds(page)).toEqual(expected)
      expect(elapsed).toBeLessThan(2_000)

      // The proof that the sort was global: the top of the confidence order is NOT a
      // permutation of what was loaded before.
      const records = new Map(browseSeedRecords().map((r) => [r.id, r]))
      const topConfidence = records.get(expected[0] as string)?.confidence
      expect(topConfidence).toBe(0.98)
      expect(expected.filter((id) => loadedBefore.includes(id)).length).toBeLessThan(
        expected.length,
      )
    })

    test("updated ASC is the exact reverse of the default order's tail", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await sortByHeader(page, "updated")
      const expected = seedIdsSortedBy([{ field: "updatedAt", dir: "asc" }]).slice(
        0,
        BROWSE_PAGE_SIZE,
      )
      await expect.poll(() => rowIds(page)).toEqual(expected)
    })
  })
  ```
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 02-global-sort
  ```
  Expect: `2 passed`. If the first test fails because one header click already produced `desc`, drop the second `sortByHeader` call — the cycle order is a slice-4 decision, and the assertion that matters is the resulting id list.

- [ ] **Step 5: Write scenario 3.**
  Create `packages/inspector/e2e/03-multi-filter-parity.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, seedIdsInDefaultOrder, seedRecordsMatching } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { applySetFilter, applyTextFilter, openBrowse, rowIds, status } from "./helpers"

  // D1-QUERY-02..07, D1-QUERY-13. Composed filters return one ordered id list.
  //
  // SCOPE, stated honestly: the Inspector runs SQLite only, so this spec proves the
  // composed query against the fixture's own pure expectation. Cross-backend parity
  // (identical ordered ids on SQLite and Postgres) is proven by the shared conformance
  // suite, not here — Task 9 adds the composed-filter case there.
  test.describe("scenario 3 — multi-filter parity", () => {
    test("status + kind + content compose into one ordered window", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await applySetFilter(page, "status", ["candidate", "active"])
      await applySetFilter(page, "kind", ["semantic"])
      await applyTextFilter(page, "content", "contains", "threshold 1")

      const matching = seedRecordsMatching({
        status: ["candidate", "active"],
        kind: ["semantic"],
        contentContains: "threshold 1",
      })
      const expected = seedIdsInDefaultOrder(matching).slice(0, BROWSE_PAGE_SIZE)
      await expect.poll(() => rowIds(page)).toEqual(expected)
      await expect(status(page)).toContainText(String(matching.length))
      expect(matching.length).toBeGreaterThan(0)
    })
  })
  ```
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 03-multi-filter
  ```
  Expect: `1 passed`.

- [ ] **Step 6: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e && git commit -m "test(inspector): dogfood scenarios 1-3 — beyond-window filter, global sort, composed filters" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 5: Scenarios 4–5 — exact namespace, honest partial result

**Files:**
- `packages/inspector/e2e/04-exact-namespace.spec.ts`
- `packages/inspector/e2e/05-honest-partial-result.spec.ts`

- [ ] **Step 1: Write scenario 4.**
  Create `packages/inspector/e2e/04-exact-namespace.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, browseSeedRecords, seedIdsInDefaultOrder, seedRecordsMatching } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { openBrowse, rowIds, status } from "./helpers"

  // D1-QUERY-08, D1-COUNT-01. The facet rail sends an EXACT namespace, so prefix
  // siblings are excluded server-side — and the total it displays counts the same set
  // the rows come from.
  test.describe("scenario 4 — exact namespace", () => {
    test("selecting route=/notes excludes route=/notes-archive and its total matches", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.getByRole("button", { name: "route=/notes", exact: true }).click()

      const matching = seedRecordsMatching({ namespace: "route=/notes" })
      const expected = seedIdsInDefaultOrder(matching).slice(0, BROWSE_PAGE_SIZE)
      await expect.poll(() => rowIds(page)).toEqual(expected)

      // The trap: a prefix query would have swept in the archive namespace.
      const archive = new Set(
        seedRecordsMatching({ namespace: "route=/notes-archive" }).map((r) => r.id),
      )
      expect(archive.size).toBeGreaterThan(0)
      const shown = await rowIds(page)
      expect(shown.filter((id) => archive.has(id))).toEqual([])

      // The total belongs to the same query as the rows (D1-COUNT-01).
      await expect(status(page)).toContainText(String(matching.length))
      expect(matching.length).toBeLessThan(browseSeedRecords().length)
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 04-exact-namespace
  ```
  Expect: `1 passed`. If the facet button's accessible name includes a count (e.g. `route=/notes 667`), change `exact: true` to a `hasText` filter on the rail's list item instead — the rail's label format is a slice-4 decision.

- [ ] **Step 3: Write scenario 5.**
  Create `packages/inspector/e2e/05-honest-partial-result.spec.ts`:
  ```ts
  import {
    BROWSE_PAGE_SIZE,
    BROWSE_RESIDENT_CAP,
    BROWSE_SEED_COUNT,
    seedIdsInDefaultOrder,
  } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { expectPhase, grid, liveRegionText, loadMore, openBrowse, rowIds, scrollTop, status } from "./helpers"

  // D1-GRID-06, D1-DATA-07, D1-COUNT-01. The UI distinguishes LOADED records from
  // MATCHING records and can retrieve another window without losing what it holds.
  test.describe("scenario 5 — honest partial result", () => {
    test.setTimeout(90_000)

    test("loaded count and matching total are separately stated, and load-more appends", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)

      const order = seedIdsInDefaultOrder()
      await expect.poll(() => rowIds(page)).toEqual(order.slice(0, BROWSE_PAGE_SIZE))
      // Both numbers, visibly different: 200 loaded of 1250 matching.
      await expect(status(page)).toContainText(String(BROWSE_PAGE_SIZE))
      await expect(status(page)).toContainText(String(BROWSE_SEED_COUNT))
      // aria-rowcount publishes the POPULATION plus the header — the position gap is
      // how a screen-reader user discovers there is more (design §9.2).
      await expect(grid(page)).toHaveAttribute("aria-rowcount", String(BROWSE_SEED_COUNT + 1))

      const offsetBefore = await scrollTop(page)
      await loadMore(page).click()
      await expect.poll(() => rowIds(page)).toEqual(order.slice(0, BROWSE_PAGE_SIZE * 2))
      await expectPhase(page, "idle")
      // Design §11: append moves nothing. The offset is untouched by an append because
      // the rows arrive BELOW the viewport.
      expect(await scrollTop(page)).toBe(offsetBefore)
      // The announcement carries the delta and the scope, not a bare number.
      await expect.poll(() => liveRegionText(page)).toContain("400")
    })

    test("load-more stops at the resident cap and says why", async ({ page, consoleErrors }) => {
      void consoleErrors
      await openBrowse(page)
      for (let page_ = 1; page_ * BROWSE_PAGE_SIZE < BROWSE_RESIDENT_CAP; page_ += 1) {
        await loadMore(page).click()
        await expect.poll(() => rowIds(page).then((ids) => ids.length)).toBe(
          (page_ + 1) * BROWSE_PAGE_SIZE,
        )
      }
      expect(await rowIds(page)).toHaveLength(BROWSE_RESIDENT_CAP)
      // The control STAYS MOUNTED at the cap (design §9.2 — focus must never drop to
      // <body>), disabled, with a label that explains the stop.
      await expect(loadMore(page)).toBeVisible()
      await expect(loadMore(page)).toBeDisabled()
      await expect(loadMore(page)).toContainText(String(BROWSE_RESIDENT_CAP))
    })
  })
  ```

- [ ] **Step 4: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 05-honest-partial
  ```
  Expect: `2 passed`.

- [ ] **Step 5: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e && git commit -m "test(inspector): dogfood scenarios 4-5 — exact namespace, honest partial result" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 6: Scenarios 6–7 — desired/fulfilled mismatch, late response

**Files:**
- `packages/inspector/e2e/06-desired-fulfilled-mismatch.spec.ts`
- `packages/inspector/e2e/07-late-response.spec.ts`

Both specs inject faults with `page.route()` on `**/api/memory/list*`. That is the only seam that can hold a response open without changing product code.

- [ ] **Step 1: Write scenario 6.**
  Create `packages/inspector/e2e/06-desired-fulfilled-mismatch.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT, seedIdsInDefaultOrder } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { applySetFilter, expectPhase, grid, liveRegionText, openBrowse, rowIds, status } from "./helpers"

  // D1-DATA-01, D1-UX-02. Controls show query B while query A's rows are still on
  // screen; A is visibly stale and its total still belongs to A.
  test.describe("scenario 6 — desired/fulfilled mismatch", () => {
    test("query A's rows stay visible, marked stale, and are never presented as B's", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const aIds = await rowIds(page)
      expect(aIds).toEqual(seedIdsInDefaultOrder().slice(0, BROWSE_PAGE_SIZE))

      // Hold query B open for 3 s. Only requests that carry a `filters` param — the
      // first request for B — are delayed; the initial load already landed.
      await page.route("**/api/memory/list*", async (route) => {
        if (new URL(route.request().url()).searchParams.has("filters")) {
          await new Promise((resolve) => setTimeout(resolve, 3_000))
        }
        await route.continue()
      })

      await applySetFilter(page, "status", ["active"])

      // Mid-flight: phase stale, A's rows intact, A's total intact, and the stale
      // announcement spoken once.
      await expectPhase(page, "stale")
      expect(await rowIds(page)).toEqual(aIds)
      await expect(status(page)).toContainText(String(BROWSE_SEED_COUNT))
      await expect.poll(() => liveRegionText(page)).toContain("Updating")
      // A stale grid still publishes an honest rowcount: it is A's population, which is
      // exactly what the visible rows are a prefix of.
      await expect(grid(page)).toHaveAttribute("aria-rowcount", String(BROWSE_SEED_COUNT + 1))

      // It settles into B, and only then does the total move.
      await expectPhase(page, "idle")
      expect(await rowIds(page)).not.toEqual(aIds)
      await expect(status(page)).not.toContainText(String(BROWSE_SEED_COUNT))
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 06-desired-fulfilled
  ```
  Expect: `1 passed`.

- [ ] **Step 3: Write scenario 7.**
  Create `packages/inspector/e2e/07-late-response.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, browseSeedRecords, seedIdsInDefaultOrder, seedRecordsMatching } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { applySetFilter, expectPhase, openBrowse, rowIds } from "./helpers"

  const SENTINEL_ID = "stale-sentinel"

  // D1-DATA-02, D1-DATA-03. A response for a dead revision is discarded WHOLE — records,
  // total and continuation together. The revision gate is the correctness mechanism;
  // abort is only an optimization, so this spec deliberately lets the abort lose.
  test.describe("scenario 7 — late response", () => {
    test.setTimeout(90_000)

    test("a response for a superseded query never reaches the grid", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)

      // Query A (status=superseded) is answered LATE, with an unmistakable sentinel row.
      await page.route("**/api/memory/list*", async (route) => {
        const params = new URL(route.request().url()).searchParams
        const filters = params.get("filters") ?? ""
        if (filters.includes("superseded")) {
          await new Promise((resolve) => setTimeout(resolve, 4_000))
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
              records: [
                {
                  ...(browseSeedRecords()[0] as Record<string, unknown>),
                  id: SENTINEL_ID,
                  content: "this belongs to a dead revision",
                },
              ],
              total: 1,
              continuation: null,
            }),
          })
          return
        }
        await route.continue()
      })

      await applySetFilter(page, "status", ["superseded"])
      await expectPhase(page, "stale")

      // Supersede it with query B before A can answer.
      await applySetFilter(page, "kind", ["episodic"])

      const matching = seedRecordsMatching({ status: ["superseded"], kind: ["episodic"] })
      const expected = seedIdsInDefaultOrder(matching).slice(0, BROWSE_PAGE_SIZE)
      await expect.poll(() => rowIds(page)).toEqual(expected)

      // Watch across the whole window in which A could still land. The sentinel must
      // never appear — not as a replacement, and not appended.
      for (let tick = 0; tick < 6; tick += 1) {
        await page.waitForTimeout(1_000)
        const ids = await rowIds(page)
        expect(ids).not.toContain(SENTINEL_ID)
        expect(ids).toEqual(expected)
      }
    })
  })
  ```

- [ ] **Step 4: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 07-late-response
  ```
  Expect: `1 passed`. Note the `status=superseded` filter narrows to a set that still contains episodic records — verified by `seedRecordsMatching` returning a non-empty array in Task 1's test.

- [ ] **Step 5: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e && git commit -m "test(inspector): dogfood scenarios 6-7 — stale presentation and the revision gate" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 7: Scenarios 8–9 — refresh/append failure and retry, concurrent write

**Files:**
- `packages/inspector/e2e/08-refresh-append-failure.spec.ts`
- `packages/inspector/e2e/09-concurrent-write.spec.ts`

- [ ] **Step 1: Write scenario 8.**
  Create `packages/inspector/e2e/08-refresh-append-failure.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, seedIdsInDefaultOrder } from "../test/seed"
  import { TEST_IDS } from "../src/components/memory/test-ids"
  import { expect, test } from "./fixtures"
  import { expectPhase, grid, loadMore, openBrowse, rowIds, waitOnePollPeriod } from "./helpers"

  // D1-DATA-06, D1-UX-01, D1-UX-03. A failed refresh or append never discards fulfilled
  // records, the failure is visible in its OWN banner slot, and retry is safe.
  test.describe("scenario 8 — refresh/append failure and retry", () => {
    test.setTimeout(90_000)

    test("a failed poll tick keeps the rows, banners itself, and clears on the next success", async ({
      page,
      consoleErrors,
    }) => {
      // A deliberate 500 produces a console error from the fetch layer; that is the
      // subject of the test, not a defect.
      void consoleErrors
      await openBrowse(page)
      const before = await rowIds(page)
      expect(before).toEqual(seedIdsInDefaultOrder().slice(0, BROWSE_PAGE_SIZE))

      let failuresLeft = 1
      await page.route("**/api/memory/list*", async (route) => {
        const params = new URL(route.request().url()).searchParams
        // The refresh tick is the cursorless request that follows a fulfilled load.
        if (!params.has("cursor") && failuresLeft > 0) {
          failuresLeft -= 1
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "seeded refresh failure" }),
          })
          return
        }
        await route.continue()
      })

      await expect(page.getByTestId(TEST_IDS.bannerRefresh)).toBeVisible({ timeout: 15_000 })
      // Rows survive, phase returns to the settled idle — a background failure is not an
      // error PHASE, because something IS fulfilled for the desired revision.
      expect(await rowIds(page)).toEqual(before)
      await expectPhase(page, "idle")
      await expect(page.locator("[data-pretable-body-state]")).toHaveCount(0)

      // A succeeding tick clears the refresh slot by itself.
      await expect(page.getByTestId(TEST_IDS.bannerRefresh)).toHaveCount(0, { timeout: 15_000 })
    })

    test("a failed append leaves the loaded rows intact and retry appends exactly once", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const order = seedIdsInDefaultOrder()
      const before = await rowIds(page)

      let failAppend = true
      await page.route("**/api/memory/list*", async (route) => {
        if (new URL(route.request().url()).searchParams.has("cursor") && failAppend) {
          failAppend = false
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "seeded append failure" }),
          })
          return
        }
        await route.continue()
      })

      await loadMore(page).click()
      await expect(page.getByTestId(TEST_IDS.bannerLoadMore)).toBeVisible({ timeout: 15_000 })
      expect(await rowIds(page)).toEqual(before)
      await expectPhase(page, "idle")
      // A refresh tick's success must NOT clear the load-more slot — per-kind slots.
      await waitOnePollPeriod(page)
      await expect(page.getByTestId(TEST_IDS.bannerLoadMore)).toBeVisible()

      await page.getByTestId(TEST_IDS.bannerRetry).click()
      await expect.poll(() => rowIds(page)).toEqual(order.slice(0, BROWSE_PAGE_SIZE * 2))
      await expect(page.getByTestId(TEST_IDS.bannerLoadMore)).toHaveCount(0)
      // The continuation is consumed only on success, so the retry cannot double-append.
      expect(new Set(await rowIds(page)).size).toBe(BROWSE_PAGE_SIZE * 2)
    })

    test("an initial failure renders the error block, suspends polling, and retry recovers", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      let requests = 0
      let failing = true
      await page.route("**/api/memory/list*", async (route) => {
        requests += 1
        if (failing) {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ error: "seeded initial failure" }),
          })
          return
        }
        await route.continue()
      })

      await page.goto("/memory")
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "error")
      await expect(page.locator('[data-pretable-body-state="error"]')).toBeVisible()
      // The error block carries NO live-region role — the failure reaches AT through the
      // surface's single polite region instead (verified in a11y-announcements.spec).
      await expect(page.locator('[data-pretable-body-state="error"][role]')).toHaveCount(0)

      // Polling is suspended while nothing is fulfilled, so the error presentation does
      // not flicker on a 2 s cadence.
      const atFailure = requests
      await page.waitForTimeout(5_000)
      expect(requests).toBe(atFailure)

      failing = false
      await page.getByTestId(TEST_IDS.retryInitial).click()
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "idle")
      await expect.poll(() => rowIds(page)).toEqual(
        seedIdsInDefaultOrder().slice(0, BROWSE_PAGE_SIZE),
      )
      // Polling resumes: a further request arrives without another click.
      const afterRetry = requests
      await expect.poll(() => requests, { timeout: 15_000 }).toBeGreaterThan(afterRetry)
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 08-refresh-append
  ```
  Expect: `3 passed`. If the third test's console-error gate trips, add the failing URL to an allowlist inside that test by asserting `consoleErrors.every((line) => line.includes("500"))` instead of voiding it.

- [ ] **Step 3: Write scenario 9.**
  Create `packages/inspector/e2e/09-concurrent-write.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT, seedIdsInDefaultOrder } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { expectPhase, openBrowse, rowIds, scrollTop, status } from "./helpers"

  // D1-DATA-04, D1-COUNT-03. Rows and total come from one transaction snapshot, and the
  // head-anchored refresh converges within one poll period.
  //
  // This spec MUTATES the shared fixture store. It forgets records from the TAIL of the
  // default order (ids that no other spec asserts on) so the mutation cannot be seen by
  // a spec that only ever looks at the head.
  test.describe("scenario 9 — concurrent write", () => {
    test.setTimeout(90_000)

    test("a delete lands in the grid and the total within one poll period", async ({
      page,
      request,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const head = await rowIds(page)
      const doomed = head[3] as string
      expect(doomed).toBeTruthy()

      const before = BROWSE_SEED_COUNT
      await expect(status(page)).toContainText(String(before))

      const response = await request.post(`/api/memory/${encodeURIComponent(doomed)}/forget`)
      expect(response.ok()).toBe(true)

      // Convergence, not aspiration: the head refresh re-derives the entire resident span
      // every tick, so the row and the total move together within ~2 s + latency.
      await expect.poll(() => rowIds(page), { timeout: 15_000 }).not.toContain(doomed)
      await expect(status(page)).toContainText(String(before - 1))
      await expectPhase(page, "idle")
    })

    test("a no-change poll tick moves no scroll offset and replaces no rows", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const idsBefore = await rowIds(page)
      // Scroll into the middle of the loaded window so a shift would be measurable.
      await page.locator("[data-pretable-scroll-viewport]").evaluate((node) => {
        node.scrollTop = 400
      })
      await page.waitForTimeout(200)
      const offsetBefore = await scrollTop(page)
      expect(offsetBefore).toBeGreaterThan(0)

      // Three ticks with no server-side change.
      await page.waitForTimeout(7_000)

      expect(await scrollTop(page)).toBe(offsetBefore)
      expect(await rowIds(page)).toEqual(idsBefore)
      expect(idsBefore).toEqual(
        seedIdsInDefaultOrder(
          // The tail-delete from the previous test may have shifted the population by
          // one; assert against whatever the grid loaded rather than a stale constant.
        ).filter((id) => idsBefore.includes(id)).slice(0, BROWSE_PAGE_SIZE),
      )
    })

    test("a tick that inserts above the viewport shifts content — offset stability only", async ({
      page,
      request,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.locator("[data-pretable-scroll-viewport]").evaluate((node) => {
        node.scrollTop = 400
      })
      await page.waitForTimeout(200)
      const offsetBefore = await scrollTop(page)
      const firstBefore = (await rowIds(page))[0]

      // Approve a record: `updatedAt = now` hoists it to position 0 of the default order.
      const hoisted = (await rowIds(page)).find((id) => id !== firstBefore) as string
      const response = await request.post(`/api/memory/${encodeURIComponent(hoisted)}/approve`)
      // 409 is a legitimate answer (already active); either way a write happened or the
      // row was not a candidate, and the next assertion covers both.
      expect([200, 409]).toContain(response.status())

      await page.waitForTimeout(6_000)
      // The DESIGN'S ACCEPTED BEHAVIOR (§8.1 decision 8, Flow 9): no scroll anchoring
      // exists in D1. The offset is untouched; the CONTENT under it may legitimately
      // have moved. This spec asserts the offset only — asserting content stability
      // here would be asserting a guarantee the design explicitly declines to make.
      expect(await scrollTop(page)).toBe(offsetBefore)
    })
  })
  ```

- [ ] **Step 4: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 09-concurrent-write
  ```
  Expect: `3 passed`.

- [ ] **Step 5: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e && git commit -m "test(inspector): dogfood scenarios 8-9 — per-kind failure recovery and refresh convergence" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 8: Scenarios 10–11 — selection scope, partial grouping honesty

**Files:**
- `packages/inspector/e2e/10-selection-scope.spec.ts`
- `packages/inspector/e2e/11-partial-grouping-honesty.spec.ts`

- [ ] **Step 1: Write scenario 10.**
  Create `packages/inspector/e2e/10-selection-scope.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT } from "../test/seed"
  import { TEST_IDS } from "../src/components/memory/test-ids"
  import { expect, test } from "./fixtures"
  import { applySetFilter, expectPhase, loadMore, openBrowse, rowIds } from "./helpers"

  // D1-SELECT-01..04. The header checkbox says what it covers, an append does not
  // corrupt the selection, and a query change clears it.
  test.describe("scenario 10 — selection scope", () => {
    test.setTimeout(90_000)

    test("select-all names the LOADED scope, never the population", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const selectAll = page.locator("[data-pretable-row-select-all]")
      await selectAll.click()

      // The label and the bulk bar both count 200, and neither says "all 1,250".
      await expect(page.getByTestId(TEST_IDS.bulkBar)).toContainText(String(BROWSE_PAGE_SIZE))
      await expect(page.getByTestId(TEST_IDS.bulkBar)).not.toContainText(
        String(BROWSE_SEED_COUNT),
      )
      const label = await selectAll.getAttribute("aria-label")
      expect(label ?? "").toMatch(/loaded/i)
    })

    test("appending a window preserves the selection and forms no duplicates", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.locator("[data-pretable-row-select-all]").click()
      await expect(page.getByTestId(TEST_IDS.bulkBar)).toContainText(String(BROWSE_PAGE_SIZE))

      await loadMore(page).click()
      await expect.poll(() => rowIds(page).then((ids) => ids.length)).toBe(BROWSE_PAGE_SIZE * 2)
      await expectPhase(page, "idle")

      // Same 200 selected — the append added rows, it did not add selection, and
      // dedupe-by-id means no row can be selected twice.
      await expect(page.getByTestId(TEST_IDS.bulkBar)).toContainText(String(BROWSE_PAGE_SIZE))
      const selected = await page
        .locator("[data-pretable-row-id][data-pretable-selected]")
        .evaluateAll((nodes) => nodes.map((n) => (n as HTMLElement).dataset.pretableRowId))
      expect(new Set(selected).size).toBe(selected.length)
    })

    test("a query change clears the selection at fulfillment, never mid-flight", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.locator("[data-pretable-row-select-all]").click()
      await expect(page.getByTestId(TEST_IDS.bulkBar)).toBeVisible()

      await page.route("**/api/memory/list*", async (route) => {
        if (new URL(route.request().url()).searchParams.has("filters")) {
          await new Promise((resolve) => setTimeout(resolve, 2_000))
        }
        await route.continue()
      })
      await applySetFilter(page, "kind", ["procedural"])

      // Mid-flight the selection over query A's rows is still valid FOR A.
      await expectPhase(page, "stale")
      await expect(page.getByTestId(TEST_IDS.bulkBar)).toBeVisible()

      // At fulfillment the datasetKey pivots and the engine clears it.
      await expectPhase(page, "idle")
      await expect(page.getByTestId(TEST_IDS.bulkBar)).toHaveCount(0)
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 10-selection-scope
  ```
  Expect: `3 passed`.

- [ ] **Step 3: Write scenario 11.**
  Create `packages/inspector/e2e/11-partial-grouping-honesty.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { grid, openBrowse, rowIds } from "./helpers"

  // D1-COUNT-04. Grouping over a partial window is permitted but MARKED. Either the
  // prototype is off for a partial result, or it labels child counts loaded-only and the
  // grid downgrades its ARIA counts. Both are conformant; presenting a loaded-children
  // count as a population count is not.
  test.describe("scenario 11 — partial grouping honesty", () => {
    test("grouping is either disabled or explicitly loaded-scoped", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const loaded = (await rowIds(page)).length
      expect(loaded).toBe(BROWSE_PAGE_SIZE)
      expect(loaded).toBeLessThan(BROWSE_SEED_COUNT)

      const role = await grid(page).getAttribute("role")
      if (role === "grid") {
        // Disposition A: the prototype stays off while the window is partial.
        expect(await page.locator("[data-pretable-group-leaf]").count()).toBe(0)
        return
      }

      // Disposition B: grouped. Then the honesty rules apply, all of them.
      expect(role).toBe("treegrid")
      const groupRows = page.locator('[data-pretable-row][aria-expanded]')
      expect(await groupRows.count()).toBeGreaterThan(0)
      await expect(groupRows.first()).toContainText(/loaded/i)
      // ARIA downgrades to the loaded model: grouping breaks the contiguous mapping, so
      // the population count can no longer be published as aria-rowcount.
      const rowCount = Number(await grid(page).getAttribute("aria-rowcount"))
      expect(rowCount).toBeLessThan(BROWSE_SEED_COUNT + 1)
    })
  })
  ```

- [ ] **Step 4: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 11-partial-grouping
  ```
  Expect: `1 passed`.

- [ ] **Step 5: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e && git commit -m "test(inspector): dogfood scenarios 10-11 — selection scope and grouping honesty" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 9: Scenarios 12–14 — view isolation, accessibility, local regression

**Files:**
- `packages/inspector/e2e/12-view-isolation.spec.ts`
- `packages/inspector/e2e/13-accessibility.spec.ts`
- `packages/inspector/e2e/14-local-regression.spec.ts`
- `packages/testing/src/memory-store-conformance.ts` (extend)

- [ ] **Step 1: Write scenario 12.**
  Create `packages/inspector/e2e/12-view-isolation.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE } from "../test/seed"
  import { TEST_IDS } from "../src/components/memory/test-ids"
  import { expect, test } from "./fixtures"
  import { expectPhase, loadMore, openBrowse, rowIds } from "./helpers"

  // View-scope matrix (§8.2) and Flow 10. Browse controls never appear to constrain a
  // view that ignores them, and leaving browse does not destroy the browse dataset.
  test.describe("scenario 12 — view isolation", () => {
    test.setTimeout(90_000)

    test("browse-only controls are disabled WITH A REASON in the search view", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.getByLabel("Search memories").fill("acme")

      // NOTE (corrected after slice 4 shipped): slice 4 chose to keep the browse
      // grid MOUNTED but `hidden` across view switches, rather than disabling its
      // funnels in place. So during search the funnel is not merely aria-disabled
      // — it is inside a hidden region and not reachable at all. Assert the
      // structure that actually ships:
      //   1. the browse region is hidden while a search is active,
      //   2. no funnel is reachable from it (hidden content is out of the tab
      //      order and out of the accessibility tree),
      //   3. the scope note still tells the user why.
      // If a future slice reverts to in-place disabling, restore the
      // aria-disabled + focusable + aria-describedby assertions below, which are
      // the right shape for THAT structure:
      //   await expect(funnel).toHaveAttribute("aria-disabled", "true")
      //   await funnel.focus(); await expect(funnel).toBeFocused()
      await expect(page.getByTestId(TEST_IDS.browseRegion)).toBeHidden()
      await expect(
        page.getByRole("button", { name: "Filter status", exact: true }),
      ).toHaveCount(0)
      // And no popover survived the hide: pretable portals them to document.body,
      // so an open funnel would otherwise float over the search results.
      await expect(page.getByRole("dialog")).toHaveCount(0)
      await expect(page.getByTestId(TEST_IDS.searchScopeNote)).toBeVisible()
    })

    test("the browse dataset survives a view switch and resumes polling on return", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await loadMore(page).click()
      await expect.poll(() => rowIds(page).then((ids) => ids.length)).toBe(BROWSE_PAGE_SIZE * 2)
      const loaded = await rowIds(page)

      await page.getByRole("button", { name: "timeline" }).click()
      await page.getByRole("button", { name: "list" }).click()

      // Flow 10: the grid is hidden, not unmounted — the two loaded windows, the
      // continuation and the engine's own state are all still there.
      expect(await rowIds(page)).toEqual(loaded)
      await expectPhase(page, "idle")
    })
  })
  ```

- [ ] **Step 2: Write scenario 13.**
  Create `packages/inspector/e2e/13-accessibility.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT } from "../test/seed"
  import { TEST_IDS } from "../src/components/memory/test-ids"
  import { expect, test } from "./fixtures"
  import { applySetFilter, expectPhase, grid, liveRegionText, loadMore, openBrowse } from "./helpers"

  // D1-A11Y-01..04, as one walkthrough: busy, count, position, stale, error and retry
  // are all identifiable, and focus is never lost across any of them.
  test.describe("scenario 13 — accessibility walkthrough", () => {
    test.setTimeout(120_000)

    test("every lifecycle state is identifiable and focus never leaves the page", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)

      // COUNT + POSITION: the population in aria-rowcount, the position in aria-rowindex.
      await expect(grid(page)).toHaveAttribute("aria-rowcount", String(BROWSE_SEED_COUNT + 1))
      const firstRow = grid(page).locator("[data-pretable-row-id]").first()
      await expect(firstRow).toHaveAttribute("aria-rowindex", "2")

      // BUSY: never as aria-busy. The lifecycle is a data attribute plus prose.
      await expect(grid(page)).not.toHaveAttribute("aria-busy", /.*/)

      // Focus a cell, then drive a query change and confirm focus stays in the grid.
      await firstRow.locator("[data-pretable-cell]").first().click()
      await page.route("**/api/memory/list*", async (route) => {
        if (new URL(route.request().url()).searchParams.has("filters")) {
          await new Promise((resolve) => setTimeout(resolve, 1_500))
        }
        await route.continue()
      })
      await applySetFilter(page, "status", ["active"])

      // STALE: announced once, marked on the DOM, rows still readable.
      await expectPhase(page, "stale")
      await expect.poll(() => liveRegionText(page)).toContain("Updating")
      await expectPhase(page, "idle")
      // Focus landed on a data cell of the NEW dataset, never on <body>.
      const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? "")
      expect(focusedTag).not.toBe("BODY")
      expect(
        await page.evaluate(
          () =>
            document
              .querySelector("[data-pretable-scroll-viewport]")
              ?.contains(document.activeElement) ?? false,
        ),
      ).toBe(true)

      // ERROR + RETRY: reachable by keyboard, announced through the polite region.
      await page.unrouteAll()
      let failing = true
      await page.route("**/api/memory/list*", async (route) => {
        if (failing) {
          await route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
          return
        }
        await route.continue()
      })
      await page.reload()
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "error")
      await expect.poll(() => liveRegionText(page)).toMatch(/could not|error|fail/i)
      failing = false
      await page.getByTestId(TEST_IDS.retryInitial).focus()
      await page.keyboard.press("Enter")
      await expectPhase(page, "idle")
      await expect(loadMore(page)).toContainText(String(BROWSE_PAGE_SIZE))
    })
  })
  ```

- [ ] **Step 3: Write scenario 14.**
  Create `packages/inspector/e2e/14-local-regression.spec.ts`:
  ```ts
  import { expect, test } from "./fixtures"
  import { openBrowse } from "./helpers"

  // D1-GRID-04. The search view renders the SAME MemoryGrid component with no
  // `processing`, no `resultMeta` and no `dataState` — an ordinary complete in-memory
  // Pretable consumer. It must behave exactly as it did before slice 1 existed.
  test.describe("scenario 14 — local regression", () => {
    test("a grid that opted into nothing gets no lifecycle presentation at all", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.getByLabel("Search memories").fill("acme threshold 1")

      const searchGrid = page
        .locator('[data-pretable-scroll-viewport][aria-label="Memories"]')
        .first()
      await expect(searchGrid).toBeVisible()

      // No dataState → no phase attribute, no body-state wrapper, no body-state block.
      await expect(searchGrid).not.toHaveAttribute("data-pretable-data-phase", /.*/)
      await expect(page.locator("[data-pretable-data-state-wrapper]")).toHaveCount(0)
      await expect(page.locator("[data-pretable-body-state]")).toHaveCount(0)

      // Local ARIA semantics: aria-rowcount is the VISIBLE row count plus the header,
      // not any remote population.
      const visible = await searchGrid.locator("[data-pretable-row-id]").count()
      await expect(searchGrid).toHaveAttribute("aria-rowcount", String(visible + 1))
      await expect(searchGrid).not.toHaveAttribute("aria-busy", /.*/)
    })
  })
  ```

- [ ] **Step 4: Run scenarios 12–14.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e 12- 13- 14-
  ```
  Expect: `4 passed`.

- [ ] **Step 5: Add the composed-filter parity case to the shared conformance suite.**
  Scenario 3's cross-backend half lives here, not in the browser. Open the suite by symbol:
  ```
  cd /Users/blove/repos/dawn && grep -n "runMemoryStoreConformance" packages/testing/src/*.ts
  ```
  Inside the existing browse section of `runMemoryStoreConformance`, add:
  ```ts
    it("returns identical ordered ids for a composed filter on every backend", async () => {
      const store = await makeStore()
      for (let index = 0; index < 40; index += 1) {
        await store.put({
          id: `cmp-${String(index).padStart(3, "0")}`,
          kind: index % 2 === 0 ? "semantic" : "episodic",
          namespace: index % 5 === 0 ? "route=/a-archive" : "route=/a",
          content: index % 3 === 0 ? "needle body" : "filler body",
          data: {},
          source: { type: "eval", id: "conformance" },
          confidence: (index % 4) / 4,
          tags: [],
          status: index % 3 === 0 ? "active" : "candidate",
          createdAt: "2026-01-01T00:00:00.000Z",
          // Ten records per stamp so the id tie-break decides order inside the window.
          updatedAt: new Date(Date.UTC(2026, 0, 1) + Math.floor(index / 10) * 60_000).toISOString(),
        })
      }
      const page = await store.browse({
        namespace: "route=/a",
        limit: 10,
        filters: [
          { field: "status", op: "in", values: ["active"] },
          { field: "kind", op: "in", values: ["semantic"] },
          { field: "content", op: "contains", value: "needle" },
        ],
        orderBy: [{ field: "updatedAt", dir: "desc" }],
      })
      // Byte-exact expectation, computed the way both stores must compute it: no
      // archive rows, active ∧ semantic ∧ needle, updatedAt DESC then id ASC.
      expect(page.records.map((record) => record.id)).toEqual([
        "cmp-036",
        "cmp-024",
        "cmp-012",
        "cmp-006",
      ])
      expect(page.total).toBe(4)
      expect(page.continuation).toBeNull()
    })
  ```

- [ ] **Step 6: Rebuild the testing package before running Postgres — this is the trap.**
  `packages/memory-pgvector` consumes `@dawn-ai/testing` through `dist`. A conformance edit that is not built is invisible to the pg run, and the run passes for the wrong reason.
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/testing build && pnpm --filter @dawn-ai/memory test --testTimeout=30000
  ```
  Expect the memory suite to include the new case and pass. Then:
  ```
  cd /Users/blove/repos/dawn && DAWN_TEST_PGVECTOR=1 pnpm --filter @dawn-ai/memory-pgvector test --testTimeout=120000
  ```
  Expect the same case to pass against the container. If the expected id list differs on Postgres, that IS the bug scenario 3 exists to find — fix the store, not the expectation.

- [ ] **Step 7: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e packages/testing/src && git commit -m "test: dogfood scenarios 12-14 plus cross-backend composed-filter parity" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 10: Accessibility — counts, positions, and the absence of aria-busy

**Files:**
- `packages/inspector/e2e/a11y-counts.spec.ts`

Design §4.5 publishes the population as `aria-rowcount` only when every condition making loaded index `i` equal dataset position `i` holds. Anything short of that downgrades to the loaded-model count, and a total that cannot be expressed as an integer downgrades to `-1`. This spec walks the reachable branches; the two branches the Inspector cannot produce (`estimate`/`unknown` totals, and a non-integer count) are covered by `@pretable/react`'s own `data-scope` unit tests and are named here so a reviewer can see the coverage is complete rather than partial.

- [ ] **Step 1: Write the spec.**
  Create `packages/inspector/e2e/a11y-counts.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE, BROWSE_SEED_COUNT, browseSeedRecords } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { grid, loadMore, openBrowse, rowIds } from "./helpers"

  test.describe("ARIA counts and positions", () => {
    test.setTimeout(90_000)

    test("an exact total publishes the POPULATION, and positions are global", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await expect(grid(page)).toHaveAttribute("aria-rowcount", String(BROWSE_SEED_COUNT + 1))

      const rows = grid(page).locator("[data-pretable-row-id]")
      await expect(rows.first()).toHaveAttribute("aria-rowindex", "2")
      await expect(rows.nth(BROWSE_PAGE_SIZE - 1)).toHaveAttribute(
        "aria-rowindex",
        String(BROWSE_PAGE_SIZE + 1),
      )

      // The gap between the last position and the rowcount is the discovery affordance:
      // "row 200 of 1,251" is how a screen-reader user learns more exists.
      await loadMore(page).click()
      await expect.poll(() => rowIds(page).then((ids) => ids.length)).toBe(BROWSE_PAGE_SIZE * 2)
      await expect(grid(page)).toHaveAttribute("aria-rowcount", String(BROWSE_SEED_COUNT + 1))
      await expect(rows.nth(BROWSE_PAGE_SIZE * 2 - 1)).toHaveAttribute(
        "aria-rowindex",
        String(BROWSE_PAGE_SIZE * 2 + 1),
      )
    })

    test("a total that undercounts the loaded rows DOWNGRADES to the loaded-model count", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      // A lying server: 200 records, total 5. The loaded set cannot be a contiguous
      // prefix of a 5-row population, so the population count must not be published.
      // Pretable emits a console.warn here (not an error), so the gate stays green.
      await page.route("**/api/memory/list*", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            records: browseSeedRecords().slice(0, BROWSE_PAGE_SIZE),
            total: 5,
            continuation: null,
          }),
        })
      })
      await page.goto("/memory")
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "idle")
      const visible = await grid(page).locator("[data-pretable-row-id]").count()
      await expect(grid(page)).toHaveAttribute("aria-rowcount", String(visible + 1))
    })

    test("no phase anywhere sets aria-busy on the grid", async ({ page, consoleErrors }) => {
      void consoleErrors
      // Hold the initial request open so `loading` is observable, then let it land and
      // drive a load-more so `loading-more` is observable too.
      let release: (() => void) | undefined
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let firstRequest = true
      await page.route("**/api/memory/list*", async (route) => {
        if (firstRequest) {
          firstRequest = false
          await held
        }
        await route.continue()
      })

      await page.goto("/memory")
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "loading")
      await expect(grid(page)).not.toHaveAttribute("aria-busy", /.*/)
      release?.()

      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "idle")
      await expect(grid(page)).not.toHaveAttribute("aria-busy", /.*/)

      await loadMore(page).click()
      await expect(grid(page)).not.toHaveAttribute("aria-busy", /.*/)
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "idle")

      // And nothing anywhere inside the grid carries it either.
      expect(await page.locator("[aria-busy]").count()).toBe(0)
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e a11y-counts
  ```
  Expect: `3 passed`.

- [ ] **Step 3: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e/a11y-counts.spec.ts && git commit -m "test(inspector): pin aria-rowcount downgrades and the absence of aria-busy" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 11: Accessibility — announcement single-channel rules

**Files:**
- `packages/inspector/e2e/a11y-announcements.spec.ts`

Shipped semantics this spec pins (verified in `pretable-surface.tsx`): one permanent polite region (`[data-pretable-live-region]`, portalled to `document.body`); the body-state block carries **no** live-region role; `scheduleAnnouncement` ranks `error` > pending `user` > pending `lifecycle`, last-wins between equals; a resolved `refreshing` speaks only when the sentence it would say has changed.

- [ ] **Step 1: Write the spec.**
  Create `packages/inspector/e2e/a11y-announcements.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE } from "../test/seed"
  import { expect, test } from "./fixtures"
  import { applySetFilter, expectPhase, liveRegionText, loadMore, openBrowse, rowIds } from "./helpers"

  test.describe("announcement channels", () => {
    test.setTimeout(120_000)

    test("there is exactly one live region and the body-state block is not one", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      let failing = true
      await page.route("**/api/memory/list*", async (route) => {
        if (failing) {
          await route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
          return
        }
        await route.continue()
      })
      await page.goto("/memory")
      await expect(page.locator('[data-pretable-body-state="error"]')).toBeVisible()

      // One region, and it is the surface's own.
      expect(await page.locator("[data-pretable-live-region]").count()).toBe(1)
      expect(await page.locator('[aria-live], [role="status"], [role="alert"]').count()).toBe(1)
      // The failure reaches AT only through that region.
      await expect.poll(() => liveRegionText(page)).toMatch(/.+/)

      failing = false
    })

    test("a no-change poll tick is silent", async ({ page, consoleErrors }) => {
      void consoleErrors
      await openBrowse(page)
      await expect.poll(() => liveRegionText(page)).toContain(String(BROWSE_PAGE_SIZE))
      const settled = await liveRegionText(page)

      // Three ticks over an unchanged dataset. Repeating the same sentence IS the
      // metronome the design forbids.
      const seen: string[] = []
      const stop = Date.now() + 7_000
      while (Date.now() < stop) {
        seen.push(await liveRegionText(page))
        await page.waitForTimeout(250)
      }
      expect(new Set(seen)).toEqual(new Set([settled]))
    })

    test("stale is announced once, and its own resolution supersedes it", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.route("**/api/memory/list*", async (route) => {
        if (new URL(route.request().url()).searchParams.has("filters")) {
          await new Promise((resolve) => setTimeout(resolve, 1_500))
        }
        await route.continue()
      })
      await applySetFilter(page, "status", ["active"])
      await expect.poll(() => liveRegionText(page)).toContain("Updating")
      await expectPhase(page, "idle")
      // The results announcement replaced it — the stale sentence does not linger as the
      // last thing a screen reader said about a settled grid.
      await expect.poll(() => liveRegionText(page)).not.toContain("Updating")
    })

    test("an append announces the delta, not just the new population", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await loadMore(page).click()
      await expect.poll(() => rowIds(page).then((ids) => ids.length)).toBe(BROWSE_PAGE_SIZE * 2)
      const message = await liveRegionText(page)
      expect(message).toContain(String(BROWSE_PAGE_SIZE))
      expect(message).toContain(String(BROWSE_PAGE_SIZE * 2))
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e a11y-announcements
  ```
  Expect: `4 passed`. If the "exactly one live region" assertion trips on a consumer banner that uses `role="alert"`, that is a real finding: the per-kind banners must not be live regions while `dataState` also reports the same failure. Move the banner to a plain `<div>` with a visible message and re-run.

- [ ] **Step 3: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e/a11y-announcements.spec.ts && git commit -m "test(inspector): one announcement channel per event, and a silent metronome-free poll" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 12: Accessibility — focus continuity

**Files:**
- `packages/inspector/e2e/a11y-focus.spec.ts`

- [ ] **Step 1: Write the spec.**
  Create `packages/inspector/e2e/a11y-focus.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE } from "../test/seed"
  import { TEST_IDS } from "../src/components/memory/test-ids"
  import { expect, test } from "./fixtures"
  import { applySetFilter, expectPhase, grid, loadMore, openBrowse, rowIds } from "./helpers"

  /** The row id of the cell DOM focus currently sits in, or null. */
  async function focusedRowId(page: import("@playwright/test").Page): Promise<string | null> {
    return page.evaluate(() => {
      const active = document.activeElement
      if (!active) return null
      const row = active.closest("[data-pretable-row-id]") as HTMLElement | null
      return row?.dataset.pretableRowId ?? null
    })
  }

  async function focusIsInsideGrid(page: import("@playwright/test").Page): Promise<boolean> {
    return page.evaluate(
      () =>
        document
          .querySelector("[data-pretable-scroll-viewport]")
          ?.contains(document.activeElement) ?? false,
    )
  }

  test.describe("focus continuity", () => {
    test.setTimeout(120_000)

    test("a query reset moves focus to the first data cell, never to <body>", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const ids = await rowIds(page)
      await grid(page)
        .locator(`[data-pretable-row-id="${ids[5]}"] [data-pretable-cell]`)
        .first()
        .click()
      expect(await focusedRowId(page)).toBe(ids[5])

      await applySetFilter(page, "kind", ["reflection"])
      await expectPhase(page, "idle")

      expect(await focusIsInsideGrid(page)).toBe(true)
      const after = await rowIds(page)
      expect(await focusedRowId(page)).toBe(after[0])
    })

    test("an append leaves focus exactly where it was", async ({ page, consoleErrors }) => {
      void consoleErrors
      await openBrowse(page)
      const ids = await rowIds(page)
      const anchored = ids[7] as string
      await grid(page)
        .locator(`[data-pretable-row-id="${anchored}"] [data-pretable-cell]`)
        .first()
        .click()

      await loadMore(page).click()
      await expect.poll(() => rowIds(page).then((next) => next.length)).toBe(BROWSE_PAGE_SIZE * 2)
      // Same datasetKey → selection, focus and measured heights are all preserved.
      expect(await focusedRowId(page)).toBe(anchored)
    })

    test("a refresh that removes the focused row repairs focus and says so", async ({
      page,
      request,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      const ids = await rowIds(page)
      // Take one from deep in the window so no other spec's head assertions notice.
      const doomed = ids[150] as string
      await grid(page)
        .locator(`[data-pretable-row-id="${doomed}"] [data-pretable-cell]`)
        .first()
        .click()
      expect(await focusedRowId(page)).toBe(doomed)

      const response = await request.post(`/api/memory/${encodeURIComponent(doomed)}/forget`)
      expect(response.ok()).toBe(true)

      await expect.poll(() => rowIds(page), { timeout: 15_000 }).not.toContain(doomed)
      expect(await focusIsInsideGrid(page)).toBe(true)
      const repaired = await focusedRowId(page)
      expect(repaired).not.toBe(doomed)
      expect(repaired).not.toBeNull()
      await expect(page.locator("[data-pretable-live-region]")).toContainText(/row/i)
    })

    test("an initial failure never steals focus, and the retry control is reachable", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      let failing = true
      await page.route("**/api/memory/list*", async (route) => {
        if (failing) {
          await route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
          return
        }
        await route.continue()
      })
      await page.goto("/memory")
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "error")

      // Focus stayed on <body> because the failure announced rather than grabbed. That
      // is the correct behavior for an error the user did not initiate.
      expect(await focusIsInsideGrid(page)).toBe(false)

      failing = false
      await page.getByTestId(TEST_IDS.retryInitial).focus()
      await expect(page.getByTestId(TEST_IDS.retryInitial)).toBeFocused()
      await page.keyboard.press("Enter")
      await expectPhase(page, "idle")
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e a11y-focus
  ```
  Expect: `4 passed`.

- [ ] **Step 3: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e/a11y-focus.spec.ts && git commit -m "test(inspector): focus continuity across reset, append, removal and failure" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 13: Accessibility — the keyboard-only walkthrough

**Files:**
- `packages/inspector/e2e/a11y-keyboard.spec.ts`

Design §9.2's tab order: error banner (retry, when present) → header controls (funnels, column menus, select-all) → grid body (single entry stop, roving tabindex) → load-more footer control → rest of page. This spec walks it with no pointer events at all.

- [ ] **Step 1: Write the spec.**
  Create `packages/inspector/e2e/a11y-keyboard.spec.ts`:
  ```ts
  import { BROWSE_PAGE_SIZE } from "../test/seed"
  import { TEST_IDS } from "../src/components/memory/test-ids"
  import { expect, test } from "./fixtures"
  import { expectPhase, grid, loadMore, openBrowse, rowIds } from "./helpers"

  async function activeDescription(page: import("@playwright/test").Page): Promise<string> {
    return page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el) return "<none>"
      const testId = el.dataset.testid ?? ""
      const label = el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? ""
      return `${el.tagName}|${testId}|${label}`
    })
  }

  /** Tab until the predicate holds or the budget runs out. Reports what it walked past
   *  on failure — a bare "never focused" is unactionable. */
  async function tabUntil(
    page: import("@playwright/test").Page,
    predicate: () => Promise<boolean>,
    budget = 40,
  ): Promise<string[]> {
    const walked: string[] = []
    for (let step = 0; step < budget; step += 1) {
      if (await predicate()) return walked
      await page.keyboard.press("Tab")
      walked.push(await activeDescription(page))
    }
    throw new Error(`never reached the target; walked: ${walked.join(" -> ")}`)
  }

  test.describe("keyboard-only walkthrough", () => {
    test.setTimeout(150_000)

    test("filters, sort, selection, bulk, load-more and the page beyond are all reachable", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      await openBrowse(page)
      await page.locator("body").press("Tab")

      // 1. A funnel — filters are keyboard-operable.
      const statusFunnel = page.getByRole("button", { name: "Filter status", exact: true })
      await tabUntil(page, async () => statusFunnel.evaluate((n) => n === document.activeElement))
      await page.keyboard.press("Enter")
      const menu = page.locator("[data-pretable-filter-menu]")
      await expect(menu).toBeVisible()
      await menu.locator("[data-pretable-filter-set]").getByRole("checkbox", { name: "active" }).check()
      await page.keyboard.press("Escape")
      await expectPhase(page, "idle")
      // Focus returns to the funnel that opened the menu, not to <body>.
      await expect(statusFunnel).toBeFocused()

      // 2. Sort from the header cell.
      const confidenceHeader = grid(page)
        .locator("[data-pretable-header-cell]")
        .filter({ hasText: "confidence" })
        .first()
      await confidenceHeader.focus()
      await page.keyboard.press("Enter")
      await expectPhase(page, "idle")
      await expect(confidenceHeader).toHaveAttribute("aria-sort", /ascending|descending/)

      // 3. Select-all from the header checkbox, then the bulk bar.
      const selectAll = page.locator("[data-pretable-row-select-all]")
      await selectAll.focus()
      await page.keyboard.press("Space")
      await expect(page.getByTestId(TEST_IDS.bulkBar)).toBeVisible()
      await tabUntil(page, async () =>
        page
          .getByTestId(TEST_IDS.bulkBar)
          .evaluate((node) => node.contains(document.activeElement)),
      )

      // 4. The grid body is ONE tab stop; a further Tab must leave it (tabBehavior="exit").
      await grid(page).locator("[data-pretable-row-id] [data-pretable-cell]").first().focus()
      await page.keyboard.press("ArrowDown")
      expect(
        await page.evaluate(
          () =>
            document
              .querySelector("[data-pretable-scroll-viewport]")
              ?.contains(document.activeElement) ?? false,
        ),
      ).toBe(true)
      await page.keyboard.press("Tab")
      expect(
        await page.evaluate(
          () =>
            document
              .querySelector("[data-pretable-scroll-viewport]")
              ?.contains(document.activeElement) ?? false,
        ),
      ).toBe(false)

      // 5. The load-more control sits AFTER the grid and is operable.
      await tabUntil(page, async () => loadMore(page).evaluate((n) => n === document.activeElement))
      const before = (await rowIds(page)).length
      await page.keyboard.press("Enter")
      await expect.poll(() => rowIds(page).then((ids) => ids.length)).toBe(
        Math.min(before + BROWSE_PAGE_SIZE, before + BROWSE_PAGE_SIZE),
      )
      // It stays mounted and focused across the append, so focus never drops to <body>.
      await expect(loadMore(page)).toBeFocused()

      // 6. Content after the grid is reachable — the grid is not a keyboard trap.
      await tabUntil(page, async () =>
        page.evaluate(() => {
          const viewport = document.querySelector("[data-pretable-scroll-viewport]")
          const loadMoreEl = document.querySelector('[data-testid="load-more"]')
          const active = document.activeElement
          return Boolean(
            active &&
              active !== document.body &&
              !viewport?.contains(active) &&
              active !== loadMoreEl,
          )
        }),
      )
    })

    test("retry is reachable by keyboard before anything else when the load failed", async ({
      page,
      consoleErrors,
    }) => {
      void consoleErrors
      let failing = true
      await page.route("**/api/memory/list*", async (route) => {
        if (failing) {
          await route.fulfill({ status: 500, contentType: "application/json", body: "{}" })
          return
        }
        await route.continue()
      })
      await page.goto("/memory")
      await expect(grid(page)).toHaveAttribute("data-pretable-data-phase", "error")

      await page.locator("body").press("Tab")
      await tabUntil(page, async () =>
        page.getByTestId(TEST_IDS.retryInitial).evaluate((n) => n === document.activeElement),
      )
      failing = false
      await page.keyboard.press("Enter")
      await expectPhase(page, "idle")
    })
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector test:e2e a11y-keyboard
  ```
  Expect: `2 passed`. A `never reached the target; walked: …` failure names every stop it passed — read that list before changing the spec; it is usually a missing `tabIndex` on a slice-4 control, which is the defect this spec exists to find.

- [ ] **Step 3: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/e2e/a11y-keyboard.spec.ts && git commit -m "test(inspector): a pointer-free walkthrough of every D1 operation" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 14: The recorded VoiceOver pass

**Files:**
- `docs/superpowers/notes/2026-08-10-voiceover-walkthrough.md`

This is a manual task and it cannot be automated away — the design requires "one real screen-reader pass". Playwright asserts the attributes; VoiceOver is the only thing that proves the attributes produce a usable sentence. Do it on the machine, with the seeded fixture, and write down what was actually heard.

- [ ] **Step 1: Boot the seeded Inspector for manual use.**
  ```
  cd /Users/blove/repos/dawn && pnpm turbo run build --filter=@dawn-ai/inspector... && node packages/inspector/e2e/serve.ts
  ```
  Leave it running and open `http://127.0.0.1:3919/memory` in Safari (VoiceOver's best-supported browser).

- [ ] **Step 2: Turn VoiceOver on and walk the script.**
  `Cmd+F5`. Walk these nine stops, in order, and write down the literal utterance for each:
  1. Enter the grid (`VO+Shift+Down`). Expected: the grid's label, "1251 rows", and the first cell's position.
  2. `VO+Right` across a row, then `VO+Down`. Expected: "row 3 of 1251" style positions, never "row 3 of 200".
  3. Tab to the status funnel, open it, check `active`. Expected: the funnel's own label, then a results announcement naming the new matching count.
  4. While the filter is in flight (throttle the network in Safari's dev tools to make this observable): expected "Updating results…", once, not repeatedly.
  5. Sit on the settled grid for ten seconds with `live` on. Expected: **silence**. Any repetition here is the metronome defect.
  6. Tab to the load-more control. Expected: a label naming both loaded and total. Activate it. Expected: an announcement naming the delta and the new loaded count.
  7. Tab past the load-more control. Expected: you land on page content, not a dead end.
  8. Stop the server, wait for the poll to fail, and listen. Expected: one failure sentence from the polite region; the error text must not be spoken twice.
  9. Restart the server, find and activate the retry control by keyboard. Expected: recovery, and focus still where you left it.

- [ ] **Step 3: Write the record.**
  Create `docs/superpowers/notes/2026-08-10-voiceover-walkthrough.md` with a table of the nine stops: `Stop | What VoiceOver said (verbatim) | Verdict (pass/fail) | Follow-up`. Include macOS version, Safari version, the commit sha under test, and the date. A stop that failed gets an issue reference, not a softened verdict.

- [ ] **Step 4: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add docs/superpowers/notes/2026-08-10-voiceover-walkthrough.md && git commit -m "docs(inspector): record the VoiceOver pass over the D1 lifecycle states" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 15: Partial failure leaves ONLY failures selected

**Files:**
- `packages/inspector/src/components/memory/memory-grid.tsx`
- `packages/inspector/src/components/memory/bulk-bar.tsx`
- `packages/inspector/src/components/memory/list-page.tsx`
- `packages/inspector/test/components/bulk-safety.test.tsx`

D1-SELECT-04: a retry after a partial failure must re-attempt failures only, so a completed destructive action can never repeat.

- [ ] **Step 1: Write the failing test.**
  Create `packages/inspector/test/components/bulk-safety.test.tsx`:
  ```tsx
  import { fireEvent, render, screen, waitFor } from "@testing-library/react"
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
  import { ListPage } from "../../src/components/memory/list-page"
  import { TEST_IDS } from "../../src/components/memory/test-ids"
  import { browseSeedRecords } from "../seed"

  const RECORDS = browseSeedRecords().slice(0, 4)
  const FAILING_ID = RECORDS[1]?.id as string

  let posted: string[] = []

  function stubFetch(): void {
    posted = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (init?.method === "POST") {
          posted.push(url)
          if (url.includes(FAILING_ID))
            return Response.json({ error: "not a candidate" }, { status: 409 })
          return Response.json({ ok: true })
        }
        if (url.includes("/api/memory/stats"))
          return Response.json({
            total: RECORDS.length,
            byStatus: {},
            byKind: {},
            byNamespace: {},
            bySourceType: {},
          })
        if (url.includes("/api/memory/list"))
          return Response.json({ records: RECORDS, total: RECORDS.length, continuation: null })
        return Response.json({})
      }),
    )
  }

  beforeEach(() => {
    stubFetch()
    vi.spyOn(window, "confirm").mockReturnValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe("bulk partial failure", () => {
    it("keeps ONLY the failures selected, so a retry cannot repeat a completed delete", async () => {
      render(<ListPage />)
      const selectAll = await screen.findByTestId("row-select-all-proxy").catch(() => null)
      const header = selectAll ?? document.querySelector("[data-pretable-row-select-all]")
      expect(header).not.toBeNull()
      fireEvent.click(header as Element)

      const bar = await screen.findByTestId(TEST_IDS.bulkBar)
      expect(bar.textContent).toContain(String(RECORDS.length))

      fireEvent.click(screen.getByRole("button", { name: /^Forget/ }))
      await waitFor(() => expect(posted).toHaveLength(RECORDS.length))

      // The three that succeeded are gone from the selection; the one 409 remains.
      await waitFor(() =>
        expect(screen.getByTestId(TEST_IDS.bulkBar).textContent).toContain("1 selected"),
      )
      expect(screen.getByTestId(TEST_IDS.bulkError).textContent).toContain(FAILING_ID)

      // Retry: exactly one further POST, and it is the failure.
      posted = []
      fireEvent.click(screen.getByRole("button", { name: /^Forget/ }))
      await waitFor(() => expect(posted).toHaveLength(1))
      expect(posted[0]).toContain(FAILING_ID)
    })

    it("names the count and the scope in the confirmation", async () => {
      render(<ListPage />)
      const header = document.querySelector("[data-pretable-row-select-all]")
      fireEvent.click(header as Element)
      await screen.findByTestId(TEST_IDS.bulkBar)
      fireEvent.click(screen.getByRole("button", { name: /^Forget/ }))
      const confirmMock = vi.mocked(window.confirm)
      expect(confirmMock).toHaveBeenCalledTimes(1)
      const message = String(confirmMock.mock.calls[0]?.[0] ?? "")
      expect(message).toContain(String(RECORDS.length))
      expect(message).toMatch(/selected|loaded/i)
    })
  })
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/bulk-safety.test.tsx --testTimeout=30000
  ```
  Expect the first test to fail at `expect(...).toContain("1 selected")` — today `handleBulkDone` keeps the whole selection whenever anything failed.

- [ ] **Step 3: Export the row-selection builder from the grid.**
  In `packages/inspector/src/components/memory/memory-grid.tsx`, change `interface GridRow` to `export interface GridRow`, extend the imports from `@pretable/react` with `type PretableGrid` and `type PretableSurfaceState`, and add above `MemoryGrid`:
  ```tsx
  /** The first and last DATA columns. A ticked row is a cell range spanning them; the
   *  checkbox column is not a data column and never appears in a range. */
  const FIRST_DATA_COLUMN_ID = "status"
  const LAST_DATA_COLUMN_ID = "updated"

  /**
   * Row ids → the engine's cell-range selection. Used to PRUNE a selection after a bulk
   * run. Applied imperatively through `grid.setSelection` rather than through controlled
   * `state.selection` on purpose: `usePretable` latches a controlled selection across a
   * `datasetKey` pivot, and the prune has to land whether or not the dataset moved.
   */
  export function buildRowSelection(
    rowIds: readonly string[],
  ): NonNullable<PretableSurfaceState["selection"]> {
    return {
      ranges: rowIds.map((rowId) => ({
        startRowId: rowId,
        endRowId: rowId,
        startColumnId: FIRST_DATA_COLUMN_ID,
        endColumnId: LAST_DATA_COLUMN_ID,
      })),
      anchor:
        rowIds.length > 0
          ? { rowId: rowIds[0] as string, columnId: FIRST_DATA_COLUMN_ID }
          : null,
    }
  }
  ```
  Add `onGridReady?: (grid: PretableGrid<GridRow>) => void` to the component's props and forward `{...(onGridReady ? { onGridReady } : {})}` onto `<PretableSurface>`.

- [ ] **Step 4: Report per-id outcomes from the bulk bar.**
  In `packages/inspector/src/components/memory/bulk-bar.tsx`, change the `onDone` prop type to:
  ```tsx
    /** The ids that SUCCEEDED and the ids that FAILED, separately. The caller prunes the
     *  succeeded ones from the selection so a re-run retries failures only — a retry can
     *  never repeat a completed destructive action (D1-SELECT-04). */
    onDone: (outcome: { succeeded: string[]; failed: string[] }) => void
    /** Fired before the first per-id POST. The caller suspends polling for the duration
     *  of the run so a refresh cannot land between two writes of the same batch. */
    onStart: () => void
  ```
  and replace the body of `run` with:
  ```tsx
    const run = async (ids: readonly string[], verb: MemoryVerb) => {
      // Snapshot AT CONFIRMATION. `ids` is a fresh array on every render, so freezing it
      // here is what makes the run proceed against exactly the confirmed set even as the
      // grid updates beneath it.
      const targets = [...ids]
      setBusy(true)
      setFailures(undefined)
      onStart()
      const results = await mutateMemories(targets, verb)
      setBusy(false)
      const failed = results.flatMap((r) => (r.error ? [r.id] : []))
      const succeeded = results.flatMap((r) => (r.error ? [] : [r.id]))
      const errors = results.flatMap((r) => (r.error ? [`${r.id}: ${r.error}`] : []))
      if (errors.length > 0) setFailures({ attempted: targets.length, errors })
      onDone({ succeeded, failed })
    }
  ```
  Change the Forget confirmation string to name the scope:
  ```tsx
    if (window.confirm(`Permanently forget ${ticked.length} selected memor(ies)?`)) {
  ```

- [ ] **Step 5: Prune the selection in the list page.**
  In `packages/inspector/src/components/memory/list-page.tsx`, import `buildRowSelection` and `type GridRow` from `./memory-grid` and `type PretableGrid` from `@pretable/react`, add `const gridRef = useRef<PretableGrid<GridRow> | null>(null)`, pass `onGridReady={(instance) => { gridRef.current = instance }}` to the browse `MemoryGrid`, and replace `handleBulkDone` with:
  ```tsx
    const handleBulkStart = useCallback(() => setBulkRunning(true), [])
    const handleBulkDone = useCallback(
      ({ failed }: { succeeded: string[]; failed: string[] }) => {
        // Succeeded ids leave the selection; failures stay, with their per-id errors, so
        // the obvious next action retries exactly what did not happen.
        gridRef.current?.setSelection(buildRowSelection(failed))
        setTicked(failed)
        setBulkRunning(false)
        // One refresh on completion reconciles the grid: deleted rows leave, approved
        // rows change status in place. The datasetKey is unchanged, so the surviving
        // selection is preserved deliberately.
        refresh()
      },
      [refresh],
    )
  ```
  Add `const [bulkRunning, setBulkRunning] = useState(false)` beside the other state, and pass `onStart={handleBulkStart}` to `<BulkBar>`.

- [ ] **Step 6: Re-run and see it pass.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/bulk-safety.test.tsx --testTimeout=30000
  ```
  Expect: `2 passed`. Then re-run the whole component project to catch fallout in `bulk-actions.test.tsx`, which asserts the old `onDone` shape:
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts --testTimeout=30000
  ```
  Update `test/components/bulk-actions.test.tsx`'s `onDone` expectations to the `{ succeeded, failed }` shape.

- [ ] **Step 7: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/src packages/inspector/test && git commit -m "fix(inspector): a bulk retry re-sends failures only" -m "Succeeded ids are pruned from the selection at completion, so a re-run cannot repeat a delete that already happened (D1-SELECT-04)." -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 16: Polling pauses for the bulk run; the confirmation snapshots the id list

**Files:**
- `packages/inspector/src/components/memory/list-page.tsx`
- `packages/inspector/test/components/bulk-safety.test.tsx` (extend)

- [ ] **Step 1: Add the failing tests.**
  Append to `packages/inspector/test/components/bulk-safety.test.tsx`:
  ```tsx
  describe("bulk run isolation", () => {
    it("issues no browse request between the first and last per-id write", async () => {
      const order: string[] = []
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input)
          if (init?.method === "POST") {
            order.push(`POST ${url}`)
            // Long enough that a 2 s poll tick would certainly land inside the run if
            // polling were still armed.
            await new Promise((resolve) => setTimeout(resolve, 900))
            return Response.json({ ok: true })
          }
          if (url.includes("/api/memory/list")) {
            order.push("LIST")
            return Response.json({ records: RECORDS, total: RECORDS.length, continuation: null })
          }
          if (url.includes("/api/memory/stats"))
            return Response.json({
              total: RECORDS.length,
              byStatus: {},
              byKind: {},
              byNamespace: {},
              bySourceType: {},
            })
          return Response.json({})
        }),
      )

      render(<ListPage />)
      await waitFor(() => expect(order).toContain("LIST"))
      fireEvent.click(document.querySelector("[data-pretable-row-select-all]") as Element)
      await screen.findByTestId(TEST_IDS.bulkBar)
      fireEvent.click(screen.getByRole("button", { name: /^Forget/ }))

      await waitFor(
        () => expect(order.filter((entry) => entry.startsWith("POST"))).toHaveLength(RECORDS.length),
        { timeout: 20_000 },
      )
      const firstPost = order.findIndex((entry) => entry.startsWith("POST"))
      const lastPost = order.length - 1 - [...order].reverse().findIndex((e) => e.startsWith("POST"))
      expect(order.slice(firstPost, lastPost)).not.toContain("LIST")
    }, 30_000)

    it("runs against the ids confirmed, not the ids currently ticked", async () => {
      const { BulkBar } = await import("../../src/components/memory/bulk-bar")
      const posted: string[] = []
      let release: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          posted.push(String(input))
          if (posted.length === 1) await gate
          return Response.json({ ok: true })
        }),
      )
      const ids = RECORDS.map((record) => record.id)
      const { rerender } = render(
        <BulkBar
          ticked={ids}
          records={RECORDS}
          onDone={() => {}}
          onStart={() => {}}
          onClear={() => {}}
        />,
      )
      fireEvent.click(screen.getByRole("button", { name: /^Forget/ }))
      // The grid changes underneath, mid-run: only one row is ticked now.
      rerender(
        <BulkBar
          ticked={[ids[0] as string]}
          records={RECORDS}
          onDone={() => {}}
          onStart={() => {}}
          onClear={() => {}}
        />,
      )
      release?.()
      // The run still targets the CONFIRMED four.
      await waitFor(() => expect(posted).toHaveLength(ids.length), { timeout: 20_000 })
      for (const id of ids) expect(posted.some((url) => url.includes(id))).toBe(true)
    }, 30_000)
  })
  ```

- [ ] **Step 2: Run and see the first test fail.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/bulk-safety.test.tsx --testTimeout=60000
  ```
  Expect `expected [ 'POST …', 'LIST', 'POST …' ] not to contain 'LIST'`. The second test should already pass — the snapshot exists as a consequence of Task 15's `const targets = [...ids]`, and this test is what pins it against a future "simplification" that reads `ticked` inside the loop.

- [ ] **Step 3: Suspend polling for the duration of the run.**
  In `list-page.tsx`, thread `bulkRunning` into the browse hook's live flag. Locate by symbol:
  ```
  cd /Users/blove/repos/dawn && grep -n "useMemoryBrowse" packages/inspector/src/components/memory/list-page.tsx
  ```
  Change the `live` argument to `live && !bulkRunning`, with the comment:
  ```tsx
      // Polling pauses for the whole bulk run. The per-id writes are sequential by
      // design, and a refresh landing between two of them would reconcile the grid
      // against a half-applied batch — rows leaving while the rest of the batch is still
      // in flight, and a completion refresh that no longer matches what was confirmed.
  ```
  Also pass `live && !bulkRunning` to the stats poll so the two cadences stay in step.

- [ ] **Step 4: Re-run and see both pass.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/bulk-safety.test.tsx --testTimeout=60000
  ```
  Expect: `4 passed`. A timeout at 5 s here is load, not a defect — the file already carries per-test 30 s budgets; re-run once before investigating.

- [ ] **Step 5: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/src packages/inspector/test && git commit -m "fix(inspector): pause polling for the duration of a bulk run" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 17: Polling identity — every tick carries the active query revision

**Files:**
- `packages/inspector/test/components/polling-identity.test.tsx`

Written at the component level over `ListPage` with a stubbed `fetch`, deliberately: the assertion that matters is what goes on the wire and what reaches the grid, and that phrasing survives any refactor of `useMemoryBrowse`'s internals.

- [ ] **Step 1: Write the failing test.**
  Create `packages/inspector/test/components/polling-identity.test.tsx`:
  ```tsx
  import { fireEvent, render, screen, waitFor } from "@testing-library/react"
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
  import { ListPage } from "../../src/components/memory/list-page"
  import { browseSeedRecords } from "../seed"

  const ALL = browseSeedRecords().slice(0, 6)
  const ACTIVE = ALL.filter((record) => record.status === "active")

  let listUrls: string[] = []
  let deferred: { url: string; resolve: (body: unknown) => void }[] = []

  function recordsFor(url: string) {
    return url.includes("active") ? ACTIVE : ALL
  }

  beforeEach(() => {
    listUrls = []
    deferred = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes("/api/memory/stats"))
          return Response.json({
            total: ALL.length,
            byStatus: {},
            byKind: {},
            byNamespace: {},
            bySourceType: {},
          })
        if (!url.includes("/api/memory/list")) return Response.json({})
        listUrls.push(url)
        // Every list response is held open so a test can decide the ORDER in which
        // revisions land — which is the whole subject here.
        return new Promise((resolve) => {
          deferred.push({
            url,
            resolve: (body) => resolve(Response.json(body)),
          })
        })
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  /** Settle the oldest held request that matches `match`. */
  function settle(match: (url: string) => boolean): void {
    const index = deferred.findIndex((entry) => match(entry.url))
    expect(index, `no held request matched`).toBeGreaterThanOrEqual(0)
    const [entry] = deferred.splice(index, 1)
    const records = recordsFor(entry?.url ?? "")
    entry?.resolve({ records, total: records.length, continuation: null })
  }

  describe("polling identity", () => {
    it("polls with the ACTIVE query's parameters, not the one the page mounted with", async () => {
      render(<ListPage />)
      await waitFor(() => expect(listUrls).toHaveLength(1))
      settle(() => true)
      await screen.findByText(ALL[0]?.content as string)

      // Move the query.
      const funnel = await screen.findByRole("button", { name: "Filter status" })
      fireEvent.click(funnel)
      fireEvent.click(await screen.findByRole("checkbox", { name: "active" }))
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

      await waitFor(() => expect(listUrls.length).toBeGreaterThan(1))
      settle((url) => url.includes("active"))

      // Every subsequent request — poll ticks included — carries the new identity.
      const before = listUrls.length
      await waitFor(() => expect(listUrls.length).toBeGreaterThan(before), { timeout: 15_000 })
      for (const url of listUrls.slice(before)) {
        expect(url).toContain("active")
      }
    }, 30_000)

    it("discards a poll response whose revision is no longer desired", async () => {
      render(<ListPage />)
      await waitFor(() => expect(listUrls).toHaveLength(1))
      settle(() => true)
      await screen.findByText(ALL[0]?.content as string)

      // Change the query while the previous revision still has a request in flight, then
      // land the OLD one last.
      const funnel = await screen.findByRole("button", { name: "Filter status" })
      fireEvent.click(funnel)
      fireEvent.click(await screen.findByRole("checkbox", { name: "active" }))
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })
      await waitFor(() => expect(deferred.some((d) => d.url.includes("active"))).toBe(true))

      settle((url) => url.includes("active"))
      await waitFor(() =>
        expect(screen.queryByText(ALL[0]?.content as string)).toBeNull(),
      )

      // Now answer a stale request. Nothing may change.
      const staleIndex = deferred.findIndex((entry) => !entry.url.includes("active"))
      if (staleIndex >= 0) {
        const [stale] = deferred.splice(staleIndex, 1)
        stale?.resolve({ records: ALL, total: ALL.length, continuation: null })
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(screen.queryByText(ALL[0]?.content as string)).toBeNull()
    }, 30_000)
  })
  ```

- [ ] **Step 2: Run it.**
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/inspector exec vitest --run --config vitest.components.config.ts test/components/polling-identity.test.tsx --testTimeout=60000
  ```
  Expect: `2 passed` if slice 3's revision gate is correct. A failure on the second test — the stale response replacing the rows — is the D1-DATA-02 defect and must be fixed in `useMemoryBrowse` (compare the resolved response's revision to the desired revision and discard the whole response, records/total/continuation together) before this task is done.

- [ ] **Step 3: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/inspector/test/components/polling-identity.test.tsx && git commit -m "test(inspector): polling uses the active query revision, and a dead one is discarded whole" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 18: Server performance budgets, measured

**Files:**
- `packages/memory/src/browse-budget.ts`
- `packages/memory/test/browse-budget.test.ts`
- `packages/memory/bench/browse-budgets.mts`
- `packages/memory/package.json`

The comparison is pure and unit-tested; the measurement is a script. Wall-clock assertions never enter `pnpm test` — this machine runs at load 55–160 and a timing assertion in the default lane would be a coin flip.

- [ ] **Step 1: Write the failing pure test.**
  Create `packages/memory/test/browse-budget.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest"
  import {
    checkBrowseBudgets,
    percentileMs,
    POSTGRES_BROWSE_BUDGETS_MS,
    SQLITE_BROWSE_BUDGETS_MS,
  } from "../src/browse-budget.js"

  describe("browse budget checker", () => {
    it("takes the p95 by nearest-rank, so a 20-sample run reports the 19th", () => {
      const samples = Array.from({ length: 20 }, (_, index) => index + 1)
      expect(percentileMs(samples, 0.95)).toBe(19)
      expect(percentileMs([], 0.95)).toBe(Number.NaN)
      expect(percentileMs([5], 0.95)).toBe(5)
    })

    it("passes when every measured p95 is under its ceiling", () => {
      const report = checkBrowseBudgets(
        {
          "windowed-fetch": [1, 1, 2],
          "filtered-count": [4, 5, 6],
          "head-refresh": [10, 11, 12],
          "non-default-sort": [12, 13, 14],
          "content-contains": [40, 44, 46],
        },
        SQLITE_BROWSE_BUDGETS_MS,
      )
      expect(report.ok).toBe(true)
      expect(report.rows.every((row) => row.status === "pass")).toBe(true)
    })

    it("fails the whole report when one shape is over", () => {
      const report = checkBrowseBudgets(
        { "windowed-fetch": [50, 60, 70] },
        SQLITE_BROWSE_BUDGETS_MS,
      )
      expect(report.ok).toBe(false)
      expect(report.rows[0]?.status).toBe("fail")
      expect(report.rows[0]?.budgetMs).toBe(10)
    })

    it("marks a shape with no approved ceiling UNBUDGETED rather than passing it", () => {
      // Design §11 approves only two Postgres numbers. Reporting the other three as
      // "pass" would manufacture approval nobody gave.
      const report = checkBrowseBudgets(
        { "content-contains": [900] },
        POSTGRES_BROWSE_BUDGETS_MS,
      )
      expect(report.rows[0]?.status).toBe("unbudgeted")
      expect(report.ok).toBe(true)
    })
  })
  ```

- [ ] **Step 2: Run it and see it fail.**
  ```
  cd /Users/blove/repos/dawn && pnpm exec vitest --run --config packages/memory/vitest.config.ts test/browse-budget.test.ts
  ```
  Expect: `Failed to load url ../src/browse-budget.js`.

- [ ] **Step 3: Write the pure module.**
  Create `packages/memory/src/browse-budget.ts`:
  ```ts
  /**
   * The §11 server budgets of the server-controlled-exploration design, as data, plus the
   * comparison the bench and its test share. Deliberately NOT exported from `index.ts` or
   * `browse.ts`: this is bench vocabulary, not part of the package's public surface.
   */
  export type BrowseBudgetId =
    | "windowed-fetch"
    | "filtered-count"
    | "head-refresh"
    | "non-default-sort"
    | "content-contains"

  /** Ceilings approved for SQLite at 100 000 rows. Every one is grounded in a §5.5
   *  measurement; the margin covers real payload decode. */
  export const SQLITE_BROWSE_BUDGETS_MS: Readonly<Partial<Record<BrowseBudgetId, number>>> = {
    "windowed-fetch": 10,
    "filtered-count": 25,
    "head-refresh": 50,
    "non-default-sort": 50,
    "content-contains": 150,
  }

  /** Postgres. §11 approves only two numbers, and BOTH are estimates — no container bench
   *  has ever run. The other three shapes stay deliberately absent so the checker reports
   *  them as unbudgeted rather than inventing a ceiling. */
  export const POSTGRES_BROWSE_BUDGETS_MS: Readonly<Partial<Record<BrowseBudgetId, number>>> = {
    "windowed-fetch": 30,
    "filtered-count": 100,
  }

  /** Nearest-rank p95. With 20 samples that is the 19th — no interpolation, so the number
   *  reported is a measurement that actually happened. */
  export function percentileMs(samples: readonly number[], fraction: number): number {
    if (samples.length === 0) return Number.NaN
    const sorted = [...samples].sort((a, b) => a - b)
    const rank = Math.max(1, Math.ceil(fraction * sorted.length))
    return sorted[rank - 1] as number
  }

  export interface BrowseBudgetRow {
    readonly id: BrowseBudgetId
    readonly p95Ms: number
    readonly budgetMs: number | null
    readonly status: "pass" | "fail" | "unbudgeted"
  }

  export interface BrowseBudgetReport {
    readonly rows: readonly BrowseBudgetRow[]
    readonly ok: boolean
  }

  export function checkBrowseBudgets(
    measurements: Readonly<Partial<Record<BrowseBudgetId, readonly number[]>>>,
    budgets: Readonly<Partial<Record<BrowseBudgetId, number>>>,
  ): BrowseBudgetReport {
    const rows: BrowseBudgetRow[] = []
    for (const [id, samples] of Object.entries(measurements) as [
      BrowseBudgetId,
      readonly number[],
    ][]) {
      const p95Ms = percentileMs(samples, 0.95)
      const budgetMs = budgets[id] ?? null
      rows.push({
        id,
        p95Ms,
        budgetMs,
        status: budgetMs === null ? "unbudgeted" : p95Ms <= budgetMs ? "pass" : "fail",
      })
    }
    return { rows, ok: rows.every((row) => row.status !== "fail") }
  }

  export function formatBrowseBudgetReport(report: BrowseBudgetReport): string {
    return report.rows
      .map(
        (row) =>
          `${row.id.padEnd(20)} p95 ${row.p95Ms.toFixed(2).padStart(8)} ms  ` +
          `budget ${(row.budgetMs === null ? "—" : `${row.budgetMs} ms`).padStart(8)}  ${row.status}`,
      )
      .join("\n")
  }
  ```

- [ ] **Step 4: Re-run and see it pass.**
  ```
  cd /Users/blove/repos/dawn && pnpm exec vitest --run --config packages/memory/vitest.config.ts test/browse-budget.test.ts
  ```
  Expect: `4 passed`.

- [ ] **Step 5: Write the measuring bench.**
  Create `packages/memory/bench/browse-budgets.mts`:
  ```ts
  // Measures the five §11 SERVER budgets against a seeded store and reports pass/fail.
  //
  //   pnpm --filter @dawn-ai/memory build
  //   node packages/memory/bench/browse-budgets.mts [rowCount] [--assert]
  //
  // Companion to browse-plans.mts, which prints QUERY PLANS. This one prints TIMINGS
  // against approved ceilings, and with --assert exits non-zero on a miss. Timings move
  // with machine load; a miss on a loaded machine is a re-run, not a finding.
  import { mkdtempSync, rmSync } from "node:fs"
  import { tmpdir } from "node:os"
  import { join } from "node:path"
  import { DatabaseSync } from "node:sqlite"
  import {
    type BrowseBudgetId,
    checkBrowseBudgets,
    formatBrowseBudgetReport,
    SQLITE_BROWSE_BUDGETS_MS,
  } from "../dist/browse-budget.js"
  import { sqliteMemoryStore } from "../dist/index.js"

  const args = process.argv.slice(2)
  const assertBudgets = args.includes("--assert")
  const rowCount = Number(args.find((arg) => !arg.startsWith("--")) ?? 100_000)
  if (!Number.isInteger(rowCount) || rowCount < 1) {
    throw new Error(`rowCount must be a positive integer, got ${JSON.stringify(args[0])}`)
  }
  /** 20 samples so nearest-rank p95 is the 19th — a real observation, not an interpolation. */
  const SAMPLES = 20
  /** The design's resident cap, which is also the maximum request limit: one head refresh
   *  covers the whole resident span, which is what makes convergence arithmetic. */
  const RESIDENT_CAP = 1_000

  const dir = mkdtempSync(join(tmpdir(), "dawn-budget-"))
  const path = join(dir, "bench.sqlite")

  function seed(): void {
    const db = new DatabaseSync(path)
    const insert = db.prepare(
      `INSERT INTO memories
         (id,kind,namespace,content,data,source,confidence,tags,status,supersedes,created_at,updated_at,effective_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?,NULL,NULL)`,
    )
    const kinds = ["semantic", "episodic", "procedural", "reflection"]
    const statuses = ["candidate", "active", "superseded"]
    db.exec("BEGIN")
    for (let i = 0; i < rowCount; i += 1) {
      const stamp = new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString()
      insert.run(
        `r${String(i).padStart(9, "0")}`,
        kinds[i % kinds.length] as string,
        `route=/ns${i % 500}`,
        i % 9973 === 0 ? `rare needle ${i}` : `common filler content ${i}`,
        "{}",
        '{"type":"eval","id":"bench"}',
        (i % 100) / 100,
        "[]",
        statuses[i % statuses.length] as string,
        stamp,
        stamp,
      )
    }
    db.exec("COMMIT")
    db.close()
  }

  async function sample(run: () => Promise<unknown>): Promise<number[]> {
    await run() // warm: the first call pays for statement preparation
    const timings: number[] = []
    for (let i = 0; i < SAMPLES; i += 1) {
      const started = performance.now()
      await run()
      timings.push(performance.now() - started)
    }
    return timings
  }

  try {
    const store = sqliteMemoryStore({ path })
    seed()
    console.log(`rows: ${rowCount}, samples: ${SAMPLES}\n`)

    const measurements: Partial<Record<BrowseBudgetId, number[]>> = {}
    measurements["windowed-fetch"] = await sample(() => store.browse({ limit: 200 }))
    // A filtered window is rows + COUNT in one transaction; the COUNT is the shape §11
    // budgets separately, and this is the only way to exercise it through the store.
    measurements["filtered-count"] = await sample(() =>
      store.browse({ limit: 200, filters: [{ field: "status", op: "in", values: ["active"] }] }),
    )
    measurements["head-refresh"] = await sample(() => store.browse({ limit: RESIDENT_CAP }))
    measurements["non-default-sort"] = await sample(() =>
      store.browse({ limit: 200, orderBy: [{ field: "confidence", dir: "desc" }] }),
    )
    measurements["content-contains"] = await sample(() =>
      store.browse({
        limit: 200,
        filters: [{ field: "content", op: "contains", value: "rare needle 9973" }],
      }),
    )

    const report = checkBrowseBudgets(measurements, SQLITE_BROWSE_BUDGETS_MS)
    console.log(formatBrowseBudgetReport(report))
    if (assertBudgets && !report.ok) {
      console.error("\nAt least one shape missed its approved ceiling.")
      process.exitCode = 1
    }
  } finally {
    // MemoryStore exposes no close(), so the connection is still open here. POSIX unlinks
    // open files; Windows refuses, and that must not throw over the results.
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      console.log(`\ncould not remove ${dir}: ${(err as Error).message}`)
    }
  }
  ```

- [ ] **Step 6: Add the script and run the measurement.**
  In `packages/memory/package.json`, add to `scripts`:
  ```json
  "bench:budgets": "node bench/browse-budgets.mts",
  ```
  Then:
  ```
  cd /Users/blove/repos/dawn && pnpm --filter @dawn-ai/memory build && node packages/memory/bench/browse-budgets.mts 100000 --assert
  ```
  Expect five rows, each `pass`. Paste the whole table into the scratchpad — Task 22 copies it into the budget ledger. **`head-refresh` is the first measurement this budget has ever had**; if it misses 50 ms, that is a real finding about the resident cap, not a flaky machine — re-run twice on a quiet machine before recording it.

- [ ] **Step 7: Commit.**
  ```
  cd /Users/blove/repos/dawn && git add packages/memory/src/browse-budget.ts packages/memory/test/browse-budget.test.ts packages/memory/bench/browse-budgets.mts packages/memory/package.json && git commit -m "bench(memory): measure the five server browse budgets against approved ceilings" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 19: Bench vocabulary for replace and append (pretable)

**Files:**
- `packages/bench-runner/src/index.ts`
- `packages/bench-runner/src/__tests__/bench-runner.test.ts`

All remaining pretable work happens in `/Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a`.

D1-PERF-04 requires replace and append to be measured **separately**. Two script names is what makes that structural rather than a promise.

- [ ] **Step 1: Extend the contract test and see it fail.**
  In `packages/bench-runner/src/__tests__/bench-runner.test.ts`, add `"replace",` and `"append",` to the end of the array in the `benchScriptNames` assertion, add `"grid_instance_reconstructed",` to the end of the `benchMetricIds` assertion, and add a new case inside `describe("bench-runner contract", …)`:
  ```ts
    it("requires the replace/append metrics D1-PERF-04 measures separately", () => {
      for (const scriptName of ["replace", "append"] as const) {
        expect(() =>
          createBenchRunSummary({
            adapterId: "pretable",
            profile: "default",
            scenarioId: "S1",
            scale: "dev",
            scriptName,
            browserName: "chromium",
            browserVersion: "1",
            status: "completed",
            timestamp: "2026-08-10T00:00:00.000Z",
            viewport: { width: 1280, height: 800 },
            metrics: { dom_nodes_peak: 1 },
            notes: [],
          }),
        ).toThrow(/Missing required metric: interaction_latency_ms/)
      }
    })
  ```
  ```
  pnpm --filter @pretable-internal/bench-runner test
  ```
  Expect failures on the two array equality assertions and on the new case.

- [ ] **Step 2: Add the two script names.**
  In `packages/bench-runner/src/index.ts`, append to the `BenchScriptName` union:
  ```ts
    | "scroll-with-heavy-render"
    /** One `setRows` of a fresh window over an equal-length resident set — the poll
     *  refresh path. Measured SEPARATELY from `append` (D1-PERF-04): they exercise
     *  different engine work and conflating them hides a regression in either. */
    | "replace"
    /** One `setRows` of resident ++ a new window — the load-more path. */
    | "append";
  ```
  and to `benchScriptNames`:
  ```ts
    "scroll-with-heavy-render",
    "replace",
    "append",
  ];
  ```

- [ ] **Step 3: Add the reconstruction metric.**
  Append to the `BenchMetricId` union, before the closing `;`:
  ```ts
    /** 1 when the adapter created a NEW grid instance during the run, 0 when the same
     *  instance absorbed the change. §11's replace budget says "no grid reconstruction",
     *  and an instance identity is the only thing that can prove it. */
    | "grid_instance_reconstructed";
  ```
  and to `benchMetricIds`:
  ```ts
    "visible_row_count_drift",
    "grid_instance_reconstructed",
  ];
  ```

- [ ] **Step 4: Require the metrics.**
  In `assertRequiredMetrics`, after the existing `sort`/`filter-metadata`/`filter-text` block, add:
  ```ts
    if (
      status === "completed" &&
      (scriptName === "replace" || scriptName === "append")
    ) {
      for (const metricId of [
        "interaction_latency_ms",
        "settle_duration_ms",
        "post_interaction_anchor_shift_px",
        "post_interaction_row_height_error_p95_px",
        "result_row_count",
        "selected_row_preserved",
        "focused_row_preserved",
        "grid_instance_reconstructed",
      ] satisfies readonly BenchMetricId[]) {
        if (metrics[metricId] === undefined) {
          throw new Error(`Missing required metric: ${metricId}`);
        }
      }
    }
  ```

- [ ] **Step 5: Re-run and see it pass.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && pnpm --filter @pretable-internal/bench-runner test && pnpm --filter @pretable-internal/bench-runner typecheck
  ```
  Expect both green. `@pretable-internal/bench-runner` is private, so `pnpm api:check` is not involved.

- [ ] **Step 6: Commit.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && git add packages/bench-runner && git commit -m "bench: name replace and append as separate scripts (D1-PERF-04)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 20: The replace and append bench scripts (pretable)

**Files:**
- `apps/bench/src/data-update-plan.ts`
- `apps/bench/src/bench-runtime.ts`
- `apps/bench/src/pretable-adapter.tsx`
- `apps/bench/src/bench-types.ts`
- `apps/bench/src/query-state.ts`
- `apps/bench/src/bench-app.tsx`
- `apps/bench/tests/bench.spec.ts`

- [ ] **Step 1: Widen the query state and see the type error.**
  In `apps/bench/src/bench-types.ts`, add `| "replace"` and `| "append"` to the `Extract<BenchScriptName, …>` union. In `apps/bench/src/query-state.ts`, add to the `scriptName` chain:
  ```ts
      script === "scroll-with-heavy-render" ||
      script === "replace" ||
      script === "append"
  ```
  ```
  pnpm --filter @pretable/app-bench typecheck
  ```
  Expect it to pass — this step only widens the accepted set.

- [ ] **Step 2: Write the plan builder.**
  Create `apps/bench/src/data-update-plan.ts`:
  ```ts
  import type {
    ScenarioDataset,
    ScenarioRow,
  } from "@pretable-internal/scenario-data";

  /** The Inspector's request window and resident cap (design §11). Mirrored here so the
   *  client bench measures the exact shapes the remote consumer produces. */
  const WINDOW_ROWS = 200;
  const RESIDENT_CAP_ROWS = 1_000;

  export interface BenchDataUpdatePlan {
    mode: "replace" | "append";
    /** Resident before the measured update. */
    initialRows: readonly ScenarioRow[];
    /** Handed to the surface when the trigger fires. */
    nextRows: readonly ScenarioRow[];
    focusedRowId: string | null;
    selectedRowId: string | null;
    resultRowCount: number;
    probeColumnId: string;
  }

  /**
   * `replace` = one window of the SAME ids with new payloads — the poll-refresh path.
   * `append`  = 800 resident rows extended to the 1 000-row cap — the load-more path.
   *
   * NOTE on the design's own numbers: §11 words the append budget as "200 onto 1 800",
   * which cannot happen under the same section's 1 000-row resident cap. This measures
   * 200 onto 800 — the largest append the cap permits — and the discrepancy is recorded
   * in the budget ledger rather than silently reinterpreted.
   */
  export function createBenchDataUpdatePlan(
    dataset: ScenarioDataset,
    mode: "replace" | "append",
  ): BenchDataUpdatePlan | null {
    const probeColumnId = dataset.columns[0]?.id;
    if (probeColumnId === undefined) {
      return null;
    }
    if (dataset.rows.length < RESIDENT_CAP_ROWS + WINDOW_ROWS) {
      // Too small to express either shape honestly. The caller reports `unsupported`
      // rather than measuring a different thing under the same name.
      return null;
    }

    if (mode === "replace") {
      const initialRows = dataset.rows.slice(0, WINDOW_ROWS);
      // Same ids, changed payloads. Identity is what lets the engine preserve selection,
      // focus and measured heights across the replacement — the property the budget's
      // "no grid reconstruction" clause is really about.
      const nextRows = initialRows.map((row) => ({
        ...row,
        [probeColumnId]: `${String(row[probeColumnId] ?? "")}·`,
      }));
      const probeRow = initialRows[Math.floor(initialRows.length / 3)];
      const probeRowId = probeRow ? String(probeRow.id ?? "") : null;
      return {
        mode,
        initialRows,
        nextRows,
        focusedRowId: probeRowId,
        selectedRowId: probeRowId,
        resultRowCount: nextRows.length,
        probeColumnId,
      };
    }

    const initialRows = dataset.rows.slice(0, RESIDENT_CAP_ROWS - WINDOW_ROWS);
    const nextRows = dataset.rows.slice(0, RESIDENT_CAP_ROWS);
    const probeRow = initialRows[Math.floor(initialRows.length / 3)];
    const probeRowId = probeRow ? String(probeRow.id ?? "") : null;
    return {
      mode,
      initialRows,
      nextRows,
      focusedRowId: probeRowId,
      selectedRowId: probeRowId,
      resultRowCount: nextRows.length,
      probeColumnId,
    };
  }
  ```

- [ ] **Step 3: Write the measurement.**
  Append to `apps/bench/src/bench-runtime.ts`, immediately after `measureBenchInteractionRun` (locate it with `grep -n "export async function measureBenchInteractionRun" apps/bench/src/bench-runtime.ts`):
  ```ts
  /**
   * Replace/append measurement. Reuses the `pretable.interaction.*` marks so
   * `scripts/analyze-cdp.mjs --window=interaction` slices these runs exactly as it slices
   * a sort or filter — the trigger-to-first-frame window, not the whole trace, which is
   * dominated by initial-mount work that does not count against the budget.
   */
  export async function measureBenchDataUpdateRun(
    root: HTMLElement,
    adapterId: BenchQueryState["adapterId"],
    mode: "replace" | "append",
    plan: {
      focusedRowId: string | null;
      resultRowCount: number;
      selectedRowId: string | null;
    },
    readInteractionStateOverride: (() => BenchInteractionState) | undefined,
    readGridInstanceId: () => string,
    trigger: () => void,
  ): Promise<InteractionBenchRunResult> {
    const profile = scrollRuntimeProfiles[adapterId];
    const viewport = await waitForScrollViewport(root, profile.viewportSelector);
    const viewportPolicyNotes = viewport
      ? detectViewportPolicyNotes(viewport)
      : [];

    if (!viewport) {
      return {
        status: "partial",
        notes: [
          ...viewportPolicyNotes,
          `data update mode: ${mode}`,
          `viewport unavailable for ${adapterId}`,
        ],
        metrics: { dom_nodes_peak: root.querySelectorAll("*").length },
      };
    }

    const gridInstanceBefore = readGridInstanceId();
    const baselineState = readBenchInteractionState(
      root,
      readInteractionStateOverride,
    );
    const baselineVisibleRows = sampleVisibleRows(viewport, profile);
    const baselineSignature = createVisibleRowSignature(
      baselineVisibleRows,
      baselineState.resultRowCount,
    );
    const scrollTopBefore = viewport.scrollTop;
    const startTimestamp = await waitForAnimationFrame();

    performance.mark("pretable.interaction.start");
    trigger();

    let domNodesPeak = root.querySelectorAll("*").length;
    let renderedRowsPeak = root.querySelectorAll(profile.rowSelector).length;
    let renderedCellsPeak = root.querySelectorAll(profile.cellSelector).length;
    let firstChangedAt: number | null = null;
    let settledAt: number | null = null;
    let blankGapFrames = 0;
    const rowHeightErrors: number[] = [];
    const anchorShifts: number[] = [];
    let previousVisibleRows = baselineVisibleRows;
    let previousScrollTop = viewport.scrollTop;
    let previousSignature = baselineSignature;
    let previousState = baselineState;
    let stableFrames = 0;
    // Six settle windows: generous enough that a slow machine reports a real number
    // rather than a `partial`, bounded enough that a hung run still ends.
    const maxFrames = Math.max(profile.maxSettleFrames * 6, 60);

    for (let frame = 0; frame < maxFrames; frame += 1) {
      const timestamp = await waitForAnimationFrame();
      const visibleRows = sampleVisibleRows(viewport, profile);
      const interactionState = readBenchInteractionState(
        root,
        readInteractionStateOverride,
      );
      const signature = createVisibleRowSignature(
        visibleRows,
        interactionState.resultRowCount,
      );

      domNodesPeak = Math.max(domNodesPeak, root.querySelectorAll("*").length);
      renderedRowsPeak = Math.max(
        renderedRowsPeak,
        root.querySelectorAll(profile.rowSelector).length,
      );
      renderedCellsPeak = Math.max(
        renderedCellsPeak,
        root.querySelectorAll(profile.cellSelector).length,
      );

      const isFirstChangedFrame =
        firstChangedAt === null &&
        (signature !== baselineSignature ||
          interactionState.resultRowCount !== baselineState.resultRowCount);

      if (isFirstChangedFrame) {
        firstChangedAt = timestamp;
        performance.mark("pretable.interaction.firstFrame");
      }

      if (firstChangedAt !== null && !isFirstChangedFrame) {
        if (detectBlankGapFrame(viewport, profile.rowSelector)) {
          blankGapFrames += 1;
        }
        rowHeightErrors.push(
          ...visibleRows
            .map((row) => row.heightError)
            .filter((value) => value > 0),
        );
        const anchorShift = measureAnchorShift({
          previousVisibleRows,
          previousScrollTop,
          nextVisibleRows: visibleRows,
          nextScrollTop: viewport.scrollTop,
        });
        if (anchorShift !== null) {
          anchorShifts.push(anchorShift);
        }
        if (
          signature === previousSignature &&
          interactionState.resultRowCount === previousState.resultRowCount &&
          interactionState.selectedRowId === previousState.selectedRowId &&
          interactionState.focusedRowId === previousState.focusedRowId
        ) {
          stableFrames += 1;
        } else {
          stableFrames = 0;
        }
      }

      previousVisibleRows = visibleRows;
      previousScrollTop = viewport.scrollTop;
      previousSignature = signature;
      previousState = interactionState;

      if (
        firstChangedAt !== null &&
        stableFrames >= Math.max(0, profile.maxSettleFrames - 1)
      ) {
        settledAt = timestamp;
        performance.mark("pretable.interaction.settled");
        break;
      }
    }

    if (firstChangedAt === null || settledAt === null) {
      return {
        status: "partial",
        notes: [...viewportPolicyNotes, `data update mode: ${mode}`],
        metrics: {
          dom_nodes_peak: domNodesPeak,
          rendered_rows_peak: renderedRowsPeak,
          rendered_cells_peak: renderedCellsPeak,
        },
      };
    }

    const finalState = readBenchInteractionState(
      root,
      readInteractionStateOverride,
    );

    return {
      status: "completed",
      notes: [...viewportPolicyNotes, `data update mode: ${mode}`],
      metrics: {
        interaction_latency_ms: firstChangedAt - startTimestamp,
        settle_duration_ms: settledAt - firstChangedAt,
        post_interaction_blank_gap_frames: blankGapFrames,
        post_interaction_anchor_shift_px: percentile(anchorShifts, 0.95),
        post_interaction_row_height_error_p95_px: percentile(
          rowHeightErrors,
          0.95,
        ),
        // The append budget's "zero scroll movement" clause, as a raw number: the
        // viewport's own offset before vs after. Anchor shift measures CONTENT movement
        // and is a different claim.
        scroll_position_drift_px: Math.abs(viewport.scrollTop - scrollTopBefore),
        result_row_count: finalState.resultRowCount,
        selected_row_preserved:
          finalState.selectedRowId === plan.selectedRowId ? 1 : 0,
        focused_row_preserved:
          finalState.focusedRowId === plan.focusedRowId ? 1 : 0,
        grid_instance_reconstructed:
          readGridInstanceId() === gridInstanceBefore ? 0 : 1,
        dom_nodes_peak: domNodesPeak,
        rendered_rows_peak: renderedRowsPeak,
        rendered_cells_peak: renderedCellsPeak,
      },
    };
  }
  ```

- [ ] **Step 4: Give the adapter a data entry point and an instance id.**
  In `apps/bench/src/pretable-adapter.tsx`:
  - Add to `PretableAdapterProps`:
    ```tsx
    /**
     * Called once the adapter can accept a new row array. The bench drives replace and
     * append through the SAME path a remote consumer uses — a new `rows` prop, which the
     * engine ingests id-keyed — not through an imperative back door that would measure a
     * code path no product uses.
     */
    onDataApiReady?: (apply: (rows: readonly ScenarioRow[]) => void) => void;
    /** Rows to render instead of `dataset.rows`, for the data-update scripts. */
    initialRows?: readonly ScenarioRow[];
    ```
  - Replace `const surfaceRows = useMemo(() => [...dataset.rows], [dataset.rows]);` with:
    ```tsx
    const [dataRows, setDataRows] = useState<readonly ScenarioRow[]>(
      initialRows ?? dataset.rows,
    );
    useEffect(() => {
      setDataRows(initialRows ?? dataset.rows);
    }, [initialRows, dataset.rows]);
    const surfaceRows = useMemo(() => [...dataRows], [dataRows]);
    const onDataApiReadyRef = useRef(onDataApiReady);
    // eslint-disable-next-line react-hooks/refs -- sync ref to latest prop for use in callbacks
    onDataApiReadyRef.current = onDataApiReady;
    useEffect(() => {
      onDataApiReadyRef.current?.((rows) => setDataRows(rows));
    }, [runKey]);
    ```
    and add `useState` to the `react` import.
  - In `handleGridReady`, publish the instance id:
    ```tsx
    const gridInstanceSeqRef = useRef(0);
    const handleGridReady = useCallback((grid: PretableGrid<ScenarioRow>) => {
      gridRef.current = grid;
      gridInstanceSeqRef.current += 1;
      // Read by measureBenchDataUpdateRun. A replacement that rebuilt the engine would
      // bump this, and §11's replace budget forbids exactly that.
      if (adapterRef.current) {
        adapterRef.current.dataset.benchGridInstanceId = String(
          gridInstanceSeqRef.current,
        );
      }
      onGridReadyRef.current?.(grid);
      onAutosizeReadyRef.current?.(() => {
        grid.autosizeColumns();
      });
    }, []);
    ```
  - Add `data-bench-grid-instance-id="0"` to the `<section>`'s attribute list.

- [ ] **Step 5: Dispatch the two scripts from the bench app.**
  In `apps/bench/src/bench-app.tsx`, import `createBenchDataUpdatePlan` and `measureBenchDataUpdateRun`, add a `dataApiRef` (`useRef<((rows: readonly ScenarioRow[]) => void) | null>(null)`) and a `dataUpdatePlanOverride` state mirroring `interactionPlanOverride`, pass `onDataApiReady={(apply) => { dataApiRef.current = apply; }}` and `initialRows={dataUpdatePlan?.initialRows}` to `<PretableAdapter>`, and add beside the `interactionRun` block:
  ```tsx
      const dataUpdateRun =
        scriptName === "replace" || scriptName === "append"
          ? await (() => {
              const plan = createBenchDataUpdatePlan(dataset, scriptName);
              if (!plan || query.adapterId !== "pretable") {
                // Comparator adapters have no equivalent single-call replace/append
                // vocabulary; reporting `unsupported` beats measuring something else.
                return Promise.resolve(null);
              }
              return measureBenchDataUpdateRun(
                viewportRef.current ?? document.body,
                query.adapterId,
                scriptName,
                plan,
                () =>
                  createBenchInteractionStateFromTelemetry(
                    pretableTelemetryRef.current,
                    plan.resultRowCount,
                  ),
                () =>
                  (viewportRef.current?.querySelector(
                    "[data-bench-grid-instance-id]",
                  ) as HTMLElement | null)?.dataset.benchGridInstanceId ?? "0",
                () => {
                  dataApiRef.current?.(plan.nextRows);
                },
              );
            })()
          : null;
  ```
  and fold `dataUpdateRun` into the same result-selection chain the other runs use, immediately after the interaction branch.

- [ ] **Step 6: Accept the new scripts in the Playwright bench spec.**
  In `apps/bench/tests/bench.spec.ts`, change the `interactionScript` definition to:
  ```ts
    const interactionScript =
      scriptName === "sort" ||
      scriptName === "filter-metadata" ||
      scriptName === "filter-text";
    const dataUpdateScript = scriptName === "replace" || scriptName === "append";
  ```
  and add after the `if (interactionScript) { … }` block:
  ```ts
    if (dataUpdateScript && result?.status === "completed") {
      expect(result.notes).toContain(`data update mode: ${scriptName}`);
      expect(result.metrics).toMatchObject({
        interaction_latency_ms: expect.any(Number),
        settle_duration_ms: expect.any(Number),
        scroll_position_drift_px: expect.any(Number),
        grid_instance_reconstructed: expect.any(Number),
        result_row_count: expect.any(Number),
      });
      // The engine absorbed the change; it did not rebuild.
      expect(result.metrics.grid_instance_reconstructed).toBe(0);
    }
  ```

- [ ] **Step 7: Typecheck, lint and unit-test the bench app.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && pnpm --filter @pretable/app-bench typecheck && pnpm --filter @pretable/app-bench lint && pnpm --filter @pretable/app-bench test
  ```
  Expect all three green.

- [ ] **Step 8: Commit.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && git add apps/bench && git commit -m "bench: measure replace and append as separate client scripts" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 21: Measure the client budgets and the memory ceiling

**Files:**
- `scripts/check-bench-budgets.mjs`
- `scripts/__tests__/check-bench-budgets.test.mjs`
- `apps/bench/tests/resident-cap-memory.spec.ts`
- `package.json`

- [ ] **Step 1: Write the failing checker test.**
  Create `scripts/__tests__/check-bench-budgets.test.mjs`:
  ```js
  import assert from "node:assert/strict";
  import test from "node:test";
  import { CLIENT_BUDGETS, checkClientBudgets } from "../check-bench-budgets.mjs";

  test("passes a run inside every ceiling", () => {
    const report = checkClientBudgets([
      {
        scriptName: "replace",
        status: "completed",
        metrics: {
          interaction_latency_ms: 12,
          grid_instance_reconstructed: 0,
          scroll_position_drift_px: 0,
        },
      },
      {
        scriptName: "append",
        status: "completed",
        metrics: {
          interaction_latency_ms: 21,
          grid_instance_reconstructed: 0,
          scroll_position_drift_px: 0,
        },
      },
    ]);
    assert.equal(report.ok, true);
    assert.equal(report.rows.length, 2);
  });

  test("fails an append that moved the scroll offset, even inside the time budget", () => {
    const report = checkClientBudgets([
      {
        scriptName: "append",
        status: "completed",
        metrics: {
          interaction_latency_ms: 5,
          grid_instance_reconstructed: 0,
          scroll_position_drift_px: 3,
        },
      },
    ]);
    assert.equal(report.ok, false);
    assert.match(report.rows[0].failures.join(" "), /scroll_position_drift_px/);
  });

  test("fails a replace that rebuilt the grid", () => {
    const report = checkClientBudgets([
      {
        scriptName: "replace",
        status: "completed",
        metrics: {
          interaction_latency_ms: 5,
          grid_instance_reconstructed: 1,
          scroll_position_drift_px: 0,
        },
      },
    ]);
    assert.equal(report.ok, false);
    assert.match(report.rows[0].failures.join(" "), /grid_instance_reconstructed/);
  });

  test("ignores runs of other scripts entirely", () => {
    const report = checkClientBudgets([{ scriptName: "scroll", status: "completed", metrics: {} }]);
    assert.equal(report.rows.length, 0);
    assert.equal(report.ok, true);
  });

  test("states the approved ceilings so a reviewer can see them without reading code", () => {
    assert.equal(CLIENT_BUDGETS.replace.interaction_latency_ms, 20);
    assert.equal(CLIENT_BUDGETS.append.interaction_latency_ms, 30);
  });
  ```
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && node --test scripts/__tests__/check-bench-budgets.test.mjs
  ```
  Expect: `Cannot find module …/check-bench-budgets.mjs`.

- [ ] **Step 2: Write the checker.**
  Create `scripts/check-bench-budgets.mjs`:
  ```js
  #!/usr/bin/env node
  // Asserts the §11 CLIENT budgets against bench artifacts.
  //
  //   node scripts/check-bench-budgets.mjs [apps/bench/status]
  //
  // Reads every *.summary.json in the directory, keeps the replace/append runs, and
  // reports each against its approved ceiling. Exits 1 on any miss.
  import { readdir, readFile } from "node:fs/promises";
  import path from "node:path";
  import { fileURLToPath } from "node:url";

  /** Design §11, "Client: replace" and "Client: append". Both are PROPOSED ceilings —
   *  the first measurement against them is the run that produced these artifacts. */
  export const CLIENT_BUDGETS = {
    replace: {
      interaction_latency_ms: 20,
      grid_instance_reconstructed: 0,
      scroll_position_drift_px: null,
    },
    append: {
      interaction_latency_ms: 30,
      grid_instance_reconstructed: 0,
      scroll_position_drift_px: 0,
    },
  };

  export function checkClientBudgets(summaries) {
    const rows = [];
    for (const summary of summaries) {
      const budget = CLIENT_BUDGETS[summary.scriptName];
      if (!budget || summary.status !== "completed") continue;
      const failures = [];
      for (const [metricId, ceiling] of Object.entries(budget)) {
        if (ceiling === null) continue;
        const value = summary.metrics?.[metricId];
        if (value === undefined) {
          failures.push(`${metricId} missing`);
          continue;
        }
        if (value > ceiling) {
          failures.push(`${metricId} ${value} > ${ceiling}`);
        }
      }
      rows.push({ scriptName: summary.scriptName, metrics: summary.metrics, failures });
    }
    return { rows, ok: rows.every((row) => row.failures.length === 0) };
  }

  async function run() {
    const dir = process.argv[2] ?? "apps/bench/status";
    const names = await readdir(dir).catch(() => []);
    const summaries = [];
    for (const name of names) {
      if (!name.endsWith(".summary.json")) continue;
      summaries.push(JSON.parse(await readFile(path.join(dir, name), "utf8")));
    }
    const report = checkClientBudgets(summaries);
    if (report.rows.length === 0) {
      console.error(`No replace/append summaries found in ${dir}. Run the bench first.`);
      process.exit(1);
    }
    for (const row of report.rows) {
      const verdict = row.failures.length === 0 ? "pass" : `FAIL (${row.failures.join("; ")})`;
      console.log(
        `${row.scriptName.padEnd(8)} latency ${String(row.metrics.interaction_latency_ms).padStart(8)} ms  ` +
          `drift ${String(row.metrics.scroll_position_drift_px).padStart(4)} px  ` +
          `rebuilt ${row.metrics.grid_instance_reconstructed}  ${verdict}`,
      );
    }
    if (!report.ok) process.exit(1);
  }

  if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await run();
  }
  ```

- [ ] **Step 3: Re-run the checker test.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && node --test scripts/__tests__/check-bench-budgets.test.mjs
  ```
  Expect: `pass 5`.

- [ ] **Step 4: Write the memory-ceiling spec.**
  Create `apps/bench/tests/resident-cap-memory.spec.ts`:
  ```ts
  import { expect, test } from "@playwright/test";

  /** Design §11: grid-attributable heap ≤ 32 MB at the resident cap during steady
   *  polling. PROPOSED ceiling — this spec produces the first measurement. */
  const HEAP_CEILING_MB = 32;

  async function heapUsedMb(
    session: Awaited<ReturnType<typeof import("@playwright/test").Page.prototype.context>>,
  ): Promise<number> {
    throw new Error("replaced below");
  }

  test("grid-attributable heap at the resident cap stays under the ceiling", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const session = await page.context().newCDPSession(page);
    await session.send("HeapProfiler.enable");

    const measure = async (): Promise<number> => {
      // Collect first: without it the number is dominated by garbage the run happened
      // to leave behind, and the "measurement" is a coin flip.
      await session.send("HeapProfiler.collectGarbage");
      const { usedSize } = (await session.send("Runtime.getHeapUsage")) as {
        usedSize: number;
      };
      return usedSize / (1024 * 1024);
    };

    // Baseline: the bench app with no grid mounted.
    await page.goto("/?adapter=pretable&scenario=S1&scale=dev&script=initial");
    const baseline = await measure();

    // The append script ends at the 1 000-row resident cap.
    await page.goto("/?adapter=pretable&scenario=S1&scale=dev&script=append&autorun=1");
    await expect(page.getByLabel("Pretable React adapter").first()).toBeVisible();
    await page.waitForFunction(
      () => (window as { __benchResult?: unknown }).__benchResult !== undefined,
      undefined,
      { timeout: 90_000 },
    );
    // Two seconds of steady state, the poll cadence the budget is written against.
    await page.waitForTimeout(2_000);
    const atCap = await measure();

    const attributable = atCap - baseline;
    console.log(
      `[resident-cap-memory] baseline ${baseline.toFixed(2)} MB, at cap ${atCap.toFixed(2)} MB, ` +
        `grid-attributable ${attributable.toFixed(2)} MB (ceiling ${HEAP_CEILING_MB} MB)`,
    );
    expect(attributable).toBeLessThan(HEAP_CEILING_MB);
  });
  ```
  Then delete the placeholder `heapUsedMb` function at the top — it exists only so this step's diff is obviously incomplete if someone stops halfway. Confirm the global the bench app publishes its result on:
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && grep -n "window\." apps/bench/src/window.d.ts apps/bench/src/bench-app.tsx | head
  ```
  and replace `__benchResult` with whatever that grep reports.

- [ ] **Step 5: Run the two bench scripts and the memory spec.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && pnpm build && \
    PRETABLE_BENCH_SCRIPT=replace PLAYWRIGHT_PERF_TRACE=1 pnpm bench:e2e && \
    PRETABLE_BENCH_SCRIPT=append PLAYWRIGHT_PERF_TRACE=1 pnpm bench:e2e && \
    pnpm exec playwright test apps/bench/tests/resident-cap-memory.spec.ts
  ```
  Expect three green runs. Then:
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && node scripts/check-bench-budgets.mjs apps/bench/status
  ```
  Expect two rows, both `pass`. **These are the first measurements these budgets have ever had.** Record the exact numbers.

- [ ] **Step 6: Slice the traces to the interaction window before naming any hotspot.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && ls apps/bench/status/traces/*.cdp.json
  ```
  For each of the two, run:
  ```
  node scripts/analyze-cdp.mjs apps/bench/status/traces/<stem>.cdp.json --window=interaction
  ```
  A full-trace view is dominated by initial-mount work that does not count against `interaction_latency_ms`; only the sliced view may be quoted in a finding.

- [ ] **Step 7: Register the checker script.**
  In the root `package.json`, add to `scripts`:
  ```json
  "bench:budgets": "node ./scripts/check-bench-budgets.mjs",
  ```
  and add `scripts/__tests__/check-bench-budgets.test.mjs` to the `node --test` list at the front of the existing `test` script.

- [ ] **Step 8: Commit.**
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && git add scripts apps/bench/tests package.json && git commit -m "bench: assert the client replace/append budgets and the resident-cap heap ceiling" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```

---

## Task 22: CI wiring, the budget ledger, and changesets

**Files:**
- `.github/workflows/ci.yml` (dawn)
- `docs/superpowers/notes/2026-08-10-d1-budget-status.md` (dawn)
- `.changeset/dawn-inspector-verification.md` (dawn)
- `.changeset/bench-replace-append.md` (pretable)

- [ ] **Step 1: Add the Playwright step to the existing dawn CI job.**
  In `.github/workflows/ci.yml`, inside the `inspector-e2e` job, after the `Inspector standalone e2e` step, add:
  ```yaml
      - name: Install Playwright browsers
        run: pnpm exec playwright install --with-deps chromium

      - name: Inspector browser verification
        # Boots the same .next/standalone artifact the step above uses, against a seeded
        # 1250-record store. `workers: 1` in playwright.config.ts is load-bearing: the
        # specs share one store and several mutate it.
        run: pnpm --filter @dawn-ai/inspector test:e2e

      - name: Upload Playwright traces
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: inspector-playwright-traces
          path: packages/inspector/test-results
          retention-days: 7
  ```
  Bump the job's `timeout-minutes: 20` to `35`.

- [ ] **Step 2: Write the budget ledger.**
  Create `docs/superpowers/notes/2026-08-10-d1-budget-status.md`. Copy the "Budget status" table from this plan's preamble, then replace every "proposed/estimated" cell with the number Task 18 or Task 21 actually printed, and add three explicit records:
  - the `head-refresh` figure at `limit = 1000`, which had never been measured before;
  - the Postgres rows, which stay **estimates** unless the gated container bench was actually run — say so in the cell rather than leaving it ambiguous;
  - the append-budget discrepancy: §11 words it as "200 onto 1 800" while the same section caps residency at 1 000; the measurement is 200 onto 800, and the design text needs a one-line correction in a follow-up.

- [ ] **Step 3: Write the dawn changeset.**
  Create `.changeset/dawn-inspector-verification.md`:
  ```md
  ---
  "@dawn-ai/inspector": patch
  ---

  Bulk actions now prune succeeded ids from the selection, so a retry after a partial
  failure re-sends only the failures and can never repeat a completed delete. Polling
  pauses for the duration of a bulk run.
  ```
  Dawn uses a single fixed version group, so one entry is enough — do not enumerate the other packages.

- [ ] **Step 4: Write the pretable changeset.**
  Create `.changeset/bench-replace-append.md` in the pretable worktree:
  ```md
  ---
  "@pretable/react": patch
  ---

  No public API change. Internal benchmark vocabulary gained `replace` and `append`
  scripts so the remote-consumer refresh and load-more paths are measured separately.
  ```

- [ ] **Step 5: Run both repos' full gates.**
  dawn:
  ```
  cd /Users/blove/repos/dawn && pnpm lint && pnpm typecheck && pnpm build && pnpm test
  ```
  then, after the build:
  ```
  cd /Users/blove/repos/dawn && DAWN_TEST_INSPECTOR=1 pnpm --filter @dawn-ai/inspector test && pnpm --filter @dawn-ai/inspector test:e2e
  ```
  pretable:
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && pnpm lint && pnpm build && pnpm api:check && pnpm typecheck && pnpm test
  ```
  `pnpm build` must run **before** `pnpm api:check`: a stale `dist/` silently strips exports, and `api:check` will not catch it. A single vitest timeout at 5 s is load — re-run that one file with `--testTimeout=30000` before treating it as a failure.

- [ ] **Step 6: Commit and open both PRs.**
  ```
  cd /Users/blove/repos/dawn && git add .github/workflows/ci.yml docs/superpowers/notes .changeset && git commit -m "ci(inspector): run the browser verification lane and record the D1 budget ledger" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```
  ```
  cd /Users/blove/repos/pretable/.claude/worktrees/hopeful-cray-45f99a && git add .changeset && git commit -m "chore: changeset for the replace/append bench vocabulary" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
  ```
  Push each branch and open a PR per repo. Before requesting review, re-check `origin/main` in both repos — concurrent sessions move it, and a rebase discovered at merge time is more expensive than one discovered now.

---

## Done means

- All fourteen dogfood scenarios exist as named spec files and pass against the built standalone server with 1 250 seeded records.
- Four accessibility specs pass, and `docs/superpowers/notes/2026-08-10-voiceover-walkthrough.md` records a real VoiceOver pass with a verdict per stop.
- A bulk partial failure leaves only failures selected, polling pauses for the run, and the confirmation's id list is snapshot-pinned by a test that re-renders mid-run.
- Polling identity is pinned at the component level, including the discard of a superseded revision's response.
- `node packages/memory/bench/browse-budgets.mts 100000 --assert` passes, and `node scripts/check-bench-budgets.mjs` passes with replace and append measured separately.
- `docs/superpowers/notes/2026-08-10-d1-budget-status.md` states, per budget, whether the number is measured or still an estimate — with no cell left ambiguous.
