# Bench App Trigger Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `waitForTrigger=1` query param to the bench app so the Playwright spec can attach CDP tracing before the interaction script runs.

**Spec:** [`docs/superpowers/specs/2026-05-15-bench-app-trigger-gating-design.md`](../specs/2026-05-15-bench-app-trigger-gating-design.md)

**Working directory:** `/Users/blove/repos/pretable/.worktrees/bench-app-trigger-gating`.

**Auto-merge on green.** Tooling-only, no public-API surface, no measurement changes.

---

## File structure

```
apps/bench/src/bench-types.ts     (MODIFY: add waitForTrigger to BenchQueryState)
apps/bench/src/query-state.ts     (MODIFY: parse waitForTrigger; default false)
apps/bench/src/bench-runtime.ts   (MODIFY: declare global window.__PRETABLE_BENCH_START__)
apps/bench/src/bench-app.tsx      (MODIFY: gate autorun useEffect on the window flag)
apps/bench/tests/bench.spec.ts    (MODIFY: append waitForTrigger=1 when CDP enabled, then set flag)
docs/research/repo-memory.md      (MODIFY: 2026-05-15 entry)
```

---

## Task 1 — Type + parse the new param

- [ ] **1.1** Open `apps/bench/src/bench-types.ts`, find the `BenchQueryState` interface. Add:
  ```ts
  waitForTrigger: boolean;
  ```
- [ ] **1.2** Open `apps/bench/src/query-state.ts`. In the `DEFAULT_QUERY_STATE` literal, add `waitForTrigger: false`. In the `parseBenchQuery` return object, add:
  ```ts
  waitForTrigger: searchParams.get("waitForTrigger") === "1",
  ```
- [ ] **1.3** Open `apps/bench/src/bench-runtime.ts`. Find the existing `declare global` block (it declares `window.__PRETABLE_BENCH_RESULT__`). Add:
  ```ts
  __PRETABLE_BENCH_START__?: boolean;
  ```
  If there's no existing block in `bench-runtime.ts`, look in `bench-app.tsx` or anywhere `BENCH_RESULT_KEY` is declared globally — extend that block.
- [ ] **1.4** Typecheck:
  ```
  pnpm --filter @pretable/app-bench typecheck
  ```
  Expected: passes.

## Task 2 — Wire the gate in bench-app.tsx

- [ ] **2.1** Open `apps/bench/src/bench-app.tsx`. Find the autorun useEffect (~line 428-435):
  ```ts
  useEffect(() => {
    if (!query.autorun || autorunRef.current) {
      return;
    }
    autorunRef.current = true;
    void autorunScript(query.scriptName);
  }, [query.autorun, query.scriptName]);
  ```
- [ ] **2.2** Replace with:

  ```ts
  useEffect(() => {
    if (!query.autorun || autorunRef.current) {
      return;
    }
    autorunRef.current = true;

    if (!query.waitForTrigger) {
      void autorunScript(query.scriptName);
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (window.__PRETABLE_BENCH_START__ === true) {
        void autorunScript(query.scriptName);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [query.autorun, query.waitForTrigger, query.scriptName]);
  ```

  The `cancelled` flag protects against React strict-mode double-mount in dev.

- [ ] **2.3** Typecheck again:
  ```
  pnpm --filter @pretable/app-bench typecheck
  ```

## Task 3 — Wire the trigger in bench.spec.ts

- [ ] **3.1** Open `apps/bench/tests/bench.spec.ts`. Find the existing `page.goto(...)` call (~line 38):
  ```ts
  await page.goto(
    `/?adapter=${adapterId}&scenario=${scenarioId}&scale=${scale}&script=${scriptName}${rateParam}&autorun=1`,
  );
  ```
- [ ] **3.2** When `perfTraceEnabled`, also append `&waitForTrigger=1`:
  ```ts
  const triggerParam = perfTraceEnabled ? "&waitForTrigger=1" : "";
  await page.goto(
    `/?adapter=${adapterId}&scenario=${scenarioId}&scale=${scale}&script=${scriptName}${rateParam}&autorun=1${triggerParam}`,
  );
  ```
- [ ] **3.3** After the CDP `try/catch` block that starts tracing (Task 1.2 in the previous PR — find the `await cdpSession.send("Tracing.start", ...)` block), set the trigger UNCONDITIONALLY (whether CDP started successfully or not):
  ```ts
  if (perfTraceEnabled) {
    await page.evaluate(() => {
      (
        window as Window & { __PRETABLE_BENCH_START__?: boolean }
      ).__PRETABLE_BENCH_START__ = true;
    });
  }
  ```
  Place this AFTER the entire CDP try/catch block, so:
  - If CDP started successfully, the trigger fires now (after CDP is recording).
  - If CDP failed to attach, the trigger still fires so the bench doesn't hang.
- [ ] **3.4** Typecheck:
  ```
  pnpm --filter @pretable/app-bench typecheck
  ```

## Task 4 — Local verification (no commit)

- [ ] **4.1** Free port 4173 if stale:
  ```
  lsof -ti tcp:4173 | xargs -r kill -9
  ```
- [ ] **4.2** Run the existing spec test with NO env (regression check):
  ```
  pnpm bench:e2e --project=chromium
  ```
  Expected: existing test passes. Behavior identical to current `main`.
- [ ] **4.3** Run with `PLAYWRIGHT_PERF_TRACE=1`:
  ```
  PLAYWRIGHT_PERF_TRACE=1 \
    PRETABLE_BENCH_ADAPTER=pretable \
    PRETABLE_BENCH_SCENARIO=S2 \
    PRETABLE_BENCH_SCALE=hypothesis \
    PRETABLE_BENCH_SCRIPT=filter-text \
    pnpm --filter @pretable/app-bench exec playwright test --workers=1
  ```
- [ ] **4.4** Inspect the produced CDP JSON:

  ```
  ls -lt status/traces/*.cdp.json | head -1
  jq '.traceEvents | length' status/traces/*.cdp.json | head -1
  jq '[.traceEvents[].cat] | unique' status/traces/*.cdp.json | head
  ```

  - **Expected event count: > 1000** (vs PR #143's 145). This is the success bar. If count is still in the low hundreds, the gate is not effective — debug before proceeding.
  - **Expected size: 100 KB to multi-MB** (vs 30 KB before).
  - Categories should still include `disabled-by-default-devtools.timeline`, `v8`, `disabled-by-default-v8.cpu_profiler`.

## Task 5 — Commit

- [ ] **5.1** Commit all changes:
  ```
  git add apps/bench/src/bench-types.ts apps/bench/src/query-state.ts apps/bench/src/bench-runtime.ts apps/bench/src/bench-app.tsx apps/bench/tests/bench.spec.ts
  git commit -m "feat(bench): waitForTrigger gate so CDP tracing captures full interaction window"
  ```

## Task 6 — repo-memory entry

- [ ] **6.1** Append a 2026-05-15 section to `docs/research/repo-memory.md`:
      Cover:
  - The new `waitForTrigger=1` query param + window flag.
  - That the spec automatically sets it under `PLAYWRIGHT_PERF_TRACE=1`.
  - The observed before/after event counts (145 → <new count>).
  - That the wrapped-text filter perf-fix investigation is now fully unblocked.
  - That `/bench` page and matrix runner are unaffected.

  Suggested heading: `### Bench-app trigger gating (CDP tracing now captures the full interaction window)`.

- [ ] **6.2** Commit:
  ```
  git add docs/research/repo-memory.md
  git commit -m "docs(research): repo-memory entry — bench-app trigger gating"
  ```

## Task 7 — Gates + PR

- [ ] **7.1** Repo-wide gates:

  ```
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```

  Expected: all pass.

- [ ] **7.2** Push + open PR:

  ```
  git push -u origin bench-app-trigger-gating
  ```

  ```
  gh pr create --title "feat(bench): waitForTrigger gate so CDP tracing captures full interaction window" --body "..."
  ```

  PR body should include:
  - Summary (one bullet).
  - The before/after event counts from Task 4.4.
  - Manual verification: `jq` output for the new trace.
  - Pointer to the wrapped-text filter perf-fix as the next consumer.
  - "What's NOT in this PR": matrix integration, automated test for the new path, perf fix itself.

- [ ] **7.3** Auto-merge:
  ```
  gh pr merge --auto --squash
  ```

---

## Self-review

- Spec coverage: type + parse (Task 1) → gate (Task 2) → spec trigger (Task 3) → manual verification (Task 4) → commits (Tasks 5+6) → gates + PR (Task 7). ✓
- No placeholders.
- Scope: single PR, six file modifications, auto-mergeable, < 100 LOC delta.
- Backward-compat: default path (no `waitForTrigger`) is byte-identical to current behavior. Only the `PLAYWRIGHT_PERF_TRACE=1` path activates the new gate.

## Notes for the implementer

- The `cancelled` flag in the useEffect cleanup (Task 2.2) is important for React strict-mode dev double-mount, but should NOT affect the spec since Playwright runs the prod build via the preview server.
- If `bench-runtime.ts` doesn't already have a `declare global` block for `__PRETABLE_BENCH_RESULT__`, look at how the existing global is typed — there may be a `.d.ts` shim or inline cast. Match the existing pattern rather than introducing a new one.
- The Task 3.3 trigger-set is OUTSIDE both CDP try/catch blocks. Don't put it inside either — placing it inside the start block means a CDP-start failure would leave the bench hung; placing it inside the stop block fires after the bench has already finished, defeating the purpose.
- Task 4.3's expected event count (> 1000) is the hard success bar. If the captured trace is still tiny after this PR, STOP and investigate before pushing. The whole point of this PR is to make CDP traces actionable.
