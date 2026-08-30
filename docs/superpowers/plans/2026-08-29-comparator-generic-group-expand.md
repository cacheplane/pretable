# Comparator-Generic group-expand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `group-expand` bench script comparative against TanStack (issue #478) by replacing bench-app's pretable-only setup/trigger machinery with a per-profile group-row selector and an adapter-exposed collapse handle.

**Architecture:** Three seams change. (1) `ScrollRuntimeProfile` grows an optional `groupRowSelector`, and `waitForGroupedRowModel` becomes a DOM-only `waitForPaintedGroupRows` that reads it — the painted-DOM gate #483 introduced, generalized. (2) Both group-capable adapters expose `onGroupToggleReady(collapse)` following the existing `onUpdateApiReady` ref pattern; bench-app's measured window calls the handle with a plan-derived group key instead of calling `grid.rowModel.setGroupExpanded` directly. (3) `validateSupportedP0aRequest` flips tanstack's `group-expand` rejection from "plumbing" to allowed. The plan builder carries the collapse target (`collapsedGroupKey`) so no adapter-specific model read happens in bench-app.

**Tech Stack:** TypeScript, React 19, TanStack Table v9 (`rowExpandingFeature`, `row.toggleExpanded`), vitest + jsdom, Playwright (real-browser verification).

**Context an engineer needs:**
- The sorted-first group is the collapse target; the plan's probe row deliberately sits in the SECOND group (see the long comment in `apps/bench/src/interaction-plan.ts` around line 265). Do not change that.
- The plan's `resultRowCount` arithmetic (leaves − collapsed group's members + all group rows) already matches TanStack's expanded-flat-model semantics — #477 verified the two models agree on the expanded count exactly.
- The DOM paint gate decides `completed` vs `partial`. If the frame budget expires before a matching group row paints, the run refuses to measure (that is #483's contract; keep it).
- `pnpm --filter @pretable/app-bench test` runs the jsdom suite. Run it from the repo root. Some tests are load-sensitive; re-run a lone timeout before believing it (see MEMORY).
- Real-browser runs need a port not shared with parallel worktrees: build, `vite preview --port 4519 --strictPort`, then drive `pnpm bench:e2e` with `PRETABLE_BENCH_EXTERNAL_SERVER=1 PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4519`.

**Files (whole plan):**
- Modify: `apps/bench/src/bench-runtime.ts` (profile type + pretable/tanstack entries)
- Modify: `apps/bench/src/interaction-plan.ts` (plan carries `collapsedGroupKey` + `collapsedGroupRowCount`)
- Modify: `apps/bench/src/tanstack-adapter.tsx` (grouping for group-expand mode; collapse handle)
- Modify: `apps/bench/src/pretable-adapter.tsx` (collapse handle)
- Modify: `apps/bench/src/bench-app.tsx` (generic wait + handle-based trigger)
- Modify: `packages/bench-runner/src/index.ts` (gate flip)
- Tests: `apps/bench/src/__tests__/bench-runtime.test.ts`, `apps/bench/src/__tests__/tanstack-adapter.test.tsx`, `apps/bench/src/__tests__/pretable-adapter.test.tsx`, `apps/bench/src/__tests__/bench-app.test.tsx`, `packages/bench-runner/src/__tests__/bench-runner.test.ts`

---

### Task 1: Per-profile group-row selector

**Files:**
- Modify: `apps/bench/src/bench-runtime.ts` (ScrollRuntimeProfile interface ~line 250-300; `scrollRuntimeProfiles` ~line 310)
- Test: `apps/bench/src/__tests__/bench-runtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("groupRowSelector", () => {
  test("the group-capable adapters declare the selector their renderer paints", () => {
    // These literals are the coupling #483 made load-bearing: the selector
    // decides completed-vs-partial for the grouping scripts. A profile whose
    // selector doesn't match what its renderer paints produces NO numbers
    // (partial), silently-looking-like-flake — so pin the exact strings.
    expect(scrollRuntimeProfiles.pretable.groupRowSelector).toBe(
      "[data-pretable-group-row]",
    );
    expect(scrollRuntimeProfiles.tanstack.groupRowSelector).toBe(
      "[data-tanstack-group-row]",
    );
  });

  test("the tier-excluded adapters declare none", () => {
    expect(scrollRuntimeProfiles["ag-grid"].groupRowSelector).toBeUndefined();
    expect(scrollRuntimeProfiles.mui.groupRowSelector).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @pretable/app-bench test -- bench-runtime` → FAIL (property does not exist).

- [ ] **Step 3: Implement.** In the `ScrollRuntimeProfile` interface add:

```ts
  /**
   * Selector for this adapter's PAINTED group-header rows. Read by
   * bench-app's `waitForPaintedGroupRows`, where it decides completed-vs-
   * partial for the grouping scripts (#483's gate, generalized by #478):
   * a selector the renderer no longer paints does not fail loudly — it
   * reports `partial` forever. Only group-capable adapters declare one;
   * absence means the grouping scripts cannot run against this adapter
   * (and `validateSupportedP0aRequest` already rejects them).
   */
  groupRowSelector?: string;
```

Add `groupRowSelector: "[data-pretable-group-row]"` to the `pretable` entry and `groupRowSelector: "[data-tanstack-group-row]"` to the `tanstack` entry. Do not touch `ag-grid`/`mui`.

- [ ] **Step 4: Run to verify it passes** — same command → PASS.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(bench): per-profile group-row selector (#478)"`

---

### Task 2: The plan carries its collapse target

**Files:**
- Modify: `apps/bench/src/interaction-plan.ts` (interface ~line 9; group-expand builder ~line 265)
- Test: `apps/bench/src/__tests__/bench-app-interaction-plan.test.tsx`

- [ ] **Step 1: Write the failing test** (in the existing group-expand describe block of `bench-app-interaction-plan.test.tsx`; reuse its dataset fixture):

```ts
test("group-expand plan names the sorted-first group as its collapse target", () => {
  const plan = createBenchInteractionPlan(dataset, "group-expand");
  expect(plan).not.toBeNull();
  // Sorted-first key of the grouping column, computed independently of the
  // builder so the test can disagree with it.
  const keys = [
    ...new Set(dataset.rows.map((row) => String(row[plan!.rowGroups[0]!] ?? ""))),
  ].sort();
  expect(plan!.collapsedGroupKey).toBe(keys[0]);
  expect(plan!.collapsedGroupRowCount).toBe(
    dataset.rows.filter(
      (row) => String(row[plan!.rowGroups[0]!] ?? "") === keys[0],
    ).length,
  );
  // Non-group-expand plans carry no collapse target.
  expect(
    createBenchInteractionPlan(dataset, "group")!.collapsedGroupKey,
  ).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @pretable/app-bench test -- interaction-plan` → FAIL.

- [ ] **Step 3: Implement.** In `BenchInteractionPlan` add:

```ts
  /**
   * group-expand only: the group VALUE the measured window collapses — the
   * sorted-first group (the probe row sits in the SECOND group; see the
   * builder comment). `null` for every other mode. Carried on the plan so
   * bench-app can hand it to any adapter's collapse handle without reading
   * an adapter-specific row model.
   */
  collapsedGroupKey: string | null;
  /** group-expand only: how many data rows the collapsed group hides. */
  collapsedGroupRowCount: number;
```

The group-expand builder already computes `collapsedKey` and `collapsedRowCount` — return them (`collapsedGroupKey: collapsedKey, collapsedGroupRowCount: collapsedRowCount`). Every other `return` in `createBenchInteractionPlan` gets `collapsedGroupKey: null, collapsedGroupRowCount: 0`.

- [ ] **Step 4: Run the full bench jsdom suite** — `pnpm --filter @pretable/app-bench test` → PASS (typecheck forces every plan literal in tests to gain the fields; fix those fixtures by adding the two fields, not by widening the type).
- [ ] **Step 5: Commit** — `git commit -am "feat(bench): the group-expand plan names its collapse target (#478)"`

---

### Task 3: TanStack adapter — grouping in group-expand mode, and the collapse handle

**Files:**
- Modify: `apps/bench/src/tanstack-adapter.tsx` (props ~line 74; grouping memo ~line 219; new effect next to the `onUpdateApiReady` effect ~line 280)
- Test: `apps/bench/src/__tests__/tanstack-adapter.test.tsx`

- [ ] **Step 1: Write the failing tests** (mount pattern: copy the existing grouping test's render setup in `tanstack-adapter.test.tsx`):

```ts
test("group-expand mode groups the grid, before any toggle", () => {
  // Same assertion shape as the existing `mode === "group"` test, but with a
  // group-expand plan: the setup phase must paint group rows or the DOM wait
  // in bench-app can never open the measurement window.
  render(
    <TanstackAdapter
      dataset={dataset}
      interactionPlan={createBenchInteractionPlan(dataset, "group-expand")}
      runKey="t"
      scriptName="group-expand"
    />,
  );
  expect(
    document.querySelectorAll("[data-tanstack-group-row]").length,
  ).toBeGreaterThan(0);
});

test("the collapse handle collapses exactly the named group", () => {
  const plan = createBenchInteractionPlan(dataset, "group-expand")!;
  let collapse: ((groupKey: string) => void) | null = null;
  render(
    <TanstackAdapter
      dataset={dataset}
      interactionPlan={plan}
      onGroupToggleReady={(fn) => { collapse = fn; }}
      runKey="t"
      scriptName="group-expand"
    />,
  );
  const before = document.querySelectorAll(
    "[data-tanstack-row], [data-tanstack-group-row]",
  ).length;
  act(() => collapse!(plan.collapsedGroupKey!));
  const after = document.querySelectorAll(
    "[data-tanstack-row], [data-tanstack-group-row]",
  ).length;
  // Every group row survives; the collapsed group's data rows do not. jsdom
  // has no virtualization here (the test dataset is small), so the DOM count
  // is the row model count.
  expect(before - after).toBe(plan.collapsedGroupRowCount);
});
```

NOTE: check the existing tests in this file for the real row-node selector and required props (`onTelemetryChange` etc.) and mirror them; if data rows carry a different attribute than `data-tanstack-row`, count `table.getRowModel().rows.length` via a captured table ref instead — what matters is the delta equalling `collapsedGroupRowCount`. Choose data where the assertion can fail: the collapsed group must not be empty.

- [ ] **Step 2: Run to verify both fail** — `pnpm --filter @pretable/app-bench test -- tanstack-adapter` → FAIL (grouping memo ignores group-expand; prop does not exist).

- [ ] **Step 3: Implement.**
  - Props: `onGroupToggleReady?: (collapse: (groupKey: string) => void) => void;` — mirror the `onUpdateApiReady` ref-sync pattern already in the file.
  - Grouping memo (~line 219) becomes mode-set based:

```ts
  const grouping = useMemo(
    () =>
      interactionPlan?.mode === "group" ||
      interactionPlan?.mode === "group-expand"
        ? [...interactionPlan.rowGroups]
        : [],
    [interactionPlan],
  );
```

  - New effect, alongside the update-api effect:

```ts
  useEffect(() => {
    onGroupToggleReadyRef.current?.((groupKey) => {
      const t = tableRef.current;
      if (!t) return;
      // Sorted-first is the CALLER's contract (the plan names the key);
      // here we only resolve key -> row. Top-level grouped rows all carry
      // getIsGrouped() and their groupingValue is the grouping column's value.
      const target = t
        .getRowModel()
        .rows.find(
          (row) => row.getIsGrouped() && String(row.groupingValue) === groupKey,
        );
      target?.toggleExpanded(false);
    });
  }, [runKey]);
```

- [ ] **Step 4: Run to verify both pass** — same command → PASS. Also run the whole file to catch regressions in the existing `group` tests.
- [ ] **Step 5: Commit** — `git commit -am "feat(bench): tanstack grouping setup + collapse handle for group-expand (#478)"`

---

### Task 4: Pretable adapter — the same collapse handle

**Files:**
- Modify: `apps/bench/src/pretable-adapter.tsx` (new effect next to the `onUpdateApiReady` wiring ~line 320)
- Test: `apps/bench/src/__tests__/pretable-adapter.test.tsx`

- [ ] **Step 1: Write the failing test** (reuse the file's existing mount fixture for a grouping script; the grid ref is what the adapter already publishes via `onGridReady`):

```ts
test("the collapse handle collapses exactly the named group", async () => {
  const plan = createBenchInteractionPlan(dataset, "group-expand")!;
  let collapse: ((groupKey: string) => void) | null = null;
  let grid: PretableSurfaceGrid<ScenarioRow, string, never> | null = null;
  render(
    <PretableAdapter
      dataset={dataset}
      interactionPlan={plan}
      onGridReady={(g) => { grid = g; }}
      onGroupToggleReady={(fn) => { collapse = fn; }}
      runKey="t"
      scriptName="group-expand"
    />,
  );
  await waitForGroupedSnapshot(grid); // poll rowModel snapshot for kind==="group" rows (helper exists in this file's grouping tests; reuse it)
  const before = grid!.rowModel.getState().snapshot.visibleRowCount;
  act(() => collapse!(plan.collapsedGroupKey!));
  await waitForVisibleRowCount(grid, before - plan.collapsedGroupRowCount);
});
```

NOTE: mirror the async settle idiom the existing grouping tests in this file use (post-#321 the model settles cooperatively — poll the snapshot, never assert synchronously).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @pretable/app-bench test -- pretable-adapter` → FAIL (prop does not exist).

- [ ] **Step 3: Implement.** Same prop + ref-sync as Task 3. Effect:

```ts
  useEffect(() => {
    onGroupToggleReadyRef.current?.((groupKey) => {
      const grid = gridRef.current;
      if (!grid) return;
      const snapshot = grid.rowModel.getState().snapshot;
      for (let index = 0; index < snapshot.visibleRowCount; index += 1) {
        const row = snapshot.rowAt(index);
        if (row?.kind === "group" && String(row.value) === groupKey) {
          // The same call the twisty click funnels through — this is the
          // measured trigger, so nothing else happens here.
          grid.rowModel.setGroupExpanded(row.groupId, false);
          return;
        }
      }
    });
  }, [runKey]);
```

- [ ] **Step 4: Run to verify it passes**, then the whole file.
- [ ] **Step 5: Commit** — `git commit -am "feat(bench): pretable collapse handle for group-expand (#478)"`

---

### Task 5: bench-app — DOM-only wait, handle-based trigger

**Files:**
- Modify: `apps/bench/src/bench-app.tsx` (`waitForGroupedRowModel` ~line 199-270; `countPaintedGroupRows` ~line 273; group-expand arm ~line 505-577)
- Test: `apps/bench/src/__tests__/bench-app.test.tsx` (existing #483 test ~line 466 must keep passing; add the tanstack twin)

- [ ] **Step 1: Write the failing test** — the tanstack twin of the #483 test ("groups the grid BEFORE the group-expand measurement window opens", line ~466). Copy that test wholesale, changing: `search="?adapter=tanstack&scenario=S2&scale=smoke&script=group-expand&autorun=1"`, the painted selector to `[data-tanstack-group-row]`, and the trigger-spy seam to whatever the copied test uses for pretable (it intercepts the measurement entry — reuse its mechanism unchanged). Assert `groupRowsAtCallTime` is > 0 at the moment the measured window opens.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @pretable/app-bench test -- bench-app.test` → FAIL (bench-app's group-expand arm currently bails to partial for tanstack: `waitForGroupedRowModel` polls `pretableGridRef`, which never publishes).

- [ ] **Step 3: Implement.** In `bench-app.tsx`:
  - Replace `waitForGroupedRowModel` + `countPaintedGroupRows` with:

```ts
  /** Group rows actually committed to the DOM — the measurement window's
   *  precondition is about the SCREEN (#483), and the selector is the
   *  per-profile coupling #478 made explicit. */
  function countPaintedGroupRows(): number {
    const selector = scrollRuntimeProfiles[query.adapterId].groupRowSelector;
    if (!selector) return 0;
    const scope: ParentNode = viewportRef.current ?? document;
    return scope.querySelectorAll(selector).length;
  }

  /**
   * Wait for the grouped SETUP to reach the screen: at least one painted
   * group row, and the painted row population stable for 3 consecutive
   * frames. DOM-only — works for every adapter whose profile declares
   * `groupRowSelector`. Returns the painted group-row count, or 0 when the
   * frame budget expires unpainted (the caller reports `partial`; a wrong
   * number is worse than no number).
   */
  async function waitForPaintedGroupRows(maxFrames = 120): Promise<number> {
    const profile = scrollRuntimeProfiles[query.adapterId];
    let previousRowCount = -1;
    let stableFrames = 0;
    for (let frame = 0; frame < maxFrames; frame += 1) {
      await waitForNextAnimationFrame();
      const painted = countPaintedGroupRows();
      if (painted === 0) {
        previousRowCount = -1;
        stableFrames = 0;
        continue;
      }
      const scope: ParentNode = viewportRef.current ?? document;
      const totalRows = scope.querySelectorAll(profile.rowSelector).length;
      if (totalRows === previousRowCount) {
        stableFrames += 1;
        if (stableFrames >= 3) return painted;
      } else {
        previousRowCount = totalRows;
        stableFrames = 0;
      }
    }
    return countPaintedGroupRows();
  }
```

  - In the group-expand arm: register the handle. Bench-app already threads adapter props; add `onGroupToggleReady` plumbing the same way `onUpdateApiReady` reaches the adapters (a ref in bench-app captured per runKey, passed to both `PretableAdapter` and `TanstackAdapter` at their render sites). Then:

```ts
            setInteractionPlanOverride({ plan: nextInteractionPlan, search });
            const paintedGroupRows = await waitForPaintedGroupRows();
            const collapse = groupToggleRef.current;
            const collapsedGroupKey = nextInteractionPlan.collapsedGroupKey;

            if (!paintedGroupRows || !collapse || collapsedGroupKey === null) {
              return {
                status: "partial" as const,
                notes: [
                  `interaction mode: ${scriptName}`,
                  "grouped rendering unavailable before the measurement window",
                ],
                metrics: {
                  dom_nodes_peak:
                    viewportRef.current?.querySelectorAll("*").length ?? 0,
                },
              };
            }

            groupingNotes.push(
              `grouping levels: ${nextInteractionPlan.rowGroups.join(", ")}`,
              `group rows before toggle: ${paintedGroupRows}`,
              `collapsed group key: ${collapsedGroupKey}`,
              `collapsed group child count: ${nextInteractionPlan.collapsedGroupRowCount}`,
            );

            // MEASURED — one collapse through the adapter handle, the same
            // call that adapter's twisty click funnels through, nothing else.
            return measureBenchInteractionRun(
              viewportRef.current ?? document.body,
              query.adapterId,
              scriptName,
              nextInteractionPlan,
              query.adapterId === "pretable"
                ? () =>
                    createBenchInteractionStateFromTelemetry(
                      pretableTelemetryRef.current,
                      dataset.rows.length,
                    )
                : undefined,
              () => collapse(collapsedGroupKey),
            );
```

  (The telemetry-state ternary copies the `sort`/`filter` arm above it — comparators use the DOM-default state reader.)
  - Delete the now-unused `BenchGroupRow` import/type alias if nothing else references it.

- [ ] **Step 4: Run the whole bench jsdom suite** — `pnpm --filter @pretable/app-bench test` → PASS, and specifically the pre-existing #483 pretable test at bench-app.test.tsx:466 (the old behavior must survive the refactor — that test is the proof).
- [ ] **Step 5: Commit** — `git commit -am "feat(bench): comparator-generic group-expand setup and trigger (#478)"`

---

### Task 6: Gate flip

**Files:**
- Modify: `packages/bench-runner/src/index.ts` (~line 515-540, `groupCapableAdapters`)
- Test: `packages/bench-runner/src/__tests__/bench-runner.test.ts` (~line 653-667)

- [ ] **Step 1: Update the test** (this one runs test-first as an edit): replace the tanstack/group-expand rejection expectation with acceptance —

```ts
    // #478: group-expand's setup (DOM paint wait on the per-profile
    // group-row selector) and trigger (adapter collapse handle) are now
    // comparator-generic, so tanstack reads comparatively here too. The
    // grouped STREAMING scripts remain pretable-only below.
    expect(
      validateSupportedP0aRequest({
        ...baseRequest,
        adapterId: "tanstack",
        scenarioId: "S2",
        scriptName: "group-expand",
      }),
    ).toEqual({ ok: true });
```

  Keep the ag-grid/mui rejections and the streaming-script rejections exactly as they are.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @pretable/bench-runner test` → FAIL (gate still rejects on "plumbing").

- [ ] **Step 3: Implement.** In `validateSupportedP0aRequest`:

```ts
    const groupCapableAdapters: readonly BenchAdapterId[] =
      request.scriptName === "group" || request.scriptName === "group-expand"
        ? ["pretable", "tanstack"]
        : ["pretable"];
```

  Update the block comment above it: `group` AND `group-expand` are comparative against tanstack since #478 (setup = DOM paint wait on the profile's `groupRowSelector`, trigger = the adapter's `onGroupToggleReady` handle); only the grouped streaming scripts remain pretable-only for plumbing. Update the tanstack rejection reason string so it no longer names group-expand.

- [ ] **Step 4: Run to verify it passes** — `pnpm --filter @pretable/bench-runner test` → PASS. Then `pnpm --filter @pretable/bench-runner build` (bench-app imports the built package — stale dist is the classic trap) and re-run the bench jsdom suite.
- [ ] **Step 5: Commit** — `git commit -am "feat(bench): group-expand reads comparatively against tanstack (#478)"`

---

### Task 7: Real-browser proof, both adapters, then PR

**Files:** none (verification + PR)

- [ ] **Step 1: Build and serve.** `pnpm --filter @pretable/app-bench build`, then `cd apps/bench && ../../node_modules/.bin/vite preview --host 127.0.0.1 --port 4519 --strictPort` (background). Check `lsof -ti:4173` is irrelevant — we never touch 4173.

- [ ] **Step 2: Pretable regression check** (the old behavior must survive): run S2 `group-expand` at `dev` and `target`, n=3 each:

```bash
PRETABLE_BENCH_EXTERNAL_SERVER=1 PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4519 PRETABLE_BENCH_ADAPTER=pretable PRETABLE_BENCH_SCENARIO=S2 PRETABLE_BENCH_SCALE=target PRETABLE_BENCH_SCRIPT=group-expand pnpm bench:e2e
```

  Expected: `status: "completed"`, target latency in the same band as the 2026-08-29 re-baseline (~30-45 ms); notes carry `collapsed group key` + `group rows before toggle: 4`.

- [ ] **Step 3: TanStack runs**: same commands with `PRETABLE_BENCH_ADAPTER=tanstack`, `dev` and `target`, n=3. Expected: `status: "completed"` with a real latency and `resultRowCount` matching the plan (the spec asserts it). If `partial`: the paint gate is reporting the tanstack setup never painted — debug the adapter's grouping memo/selector before touching any frame budget.

- [ ] **Step 4: Full local gates**: `pnpm --filter @pretable/app-bench test && pnpm --filter @pretable/app-bench typecheck && pnpm --filter @pretable/app-bench lint && pnpm --filter @pretable/bench-runner test`. All green.

- [ ] **Step 5: PR.** Push the branch, open a PR titled `feat(bench): make group-expand comparative against TanStack (closes #478)`. Body: the three seams, the paint-gate contract preserved (cite the pretable jsdom test + real-browser numbers), the n=3 pretable-vs-tanstack numbers table, and the note that grouped streaming scripts stay pretable-only. Merge on green.

---

## Self-review notes

- Spec coverage: issue #478 items — (1) DOM wait with per-profile selector → Tasks 1+5; (2) adapter collapse handle via `onUpdateApiReady` pattern → Tasks 3+4+5; (3) plan arithmetic → already holds, pinned by Task 3's delta assertion; sorted-first collapse target → Task 2 (plan-carried, test-pinned); gate reason flip → Task 6. Bench matrix (`scripts/bench-matrix.mjs`) needs no change — adapters/scripts are CLI dimensions already.
- Types are consistent: `collapsedGroupKey: string | null` + `collapsedGroupRowCount: number` (Tasks 2/3/5), `onGroupToggleReady?: (collapse: (groupKey: string) => void) => void` (Tasks 3/4/5), `groupRowSelector?: string` (Tasks 1/5).
- Known risk, called out in Task 3: TanStack's grouped-row order need not be sorted; the handle resolves by KEY, not position, so order semantics never matter.
- Known risk, called out in Task 5: the tanstack DOM-default interaction state reader must see the post-collapse `resultRowCount`; #477 verified the count arithmetic agrees, and the spec's `toMatchObject` on `status: "completed"` fails loudly if not.
