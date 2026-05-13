# Bench Harness CDP Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in CDP-level tracing path to `apps/bench/tests/bench.spec.ts` so future perf diagnostics can capture Chrome DevTools-compatible JSON for flame-graph analysis.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-05-13-bench-harness-cdp-tracing-design.md`. Single PR. Auto-merge on green — tooling-only, no measurement, no public-API impact.

**Working directory:** `/Users/blove/repos/pretable/.worktrees/bench-harness-cdp-tracing`.

**Spec:** [`docs/superpowers/specs/2026-05-13-bench-harness-cdp-tracing-design.md`](../specs/2026-05-13-bench-harness-cdp-tracing-design.md)

---

## File Structure

```
apps/bench/tests/bench.spec.ts          (MODIFY: add CDP-tracing branch behind PLAYWRIGHT_PERF_TRACE=1 env)
docs/research/repo-memory.md            (MODIFY: 2026-05-13 entry — bench-harness CDP tracing usage)
```

No `packages/` changes. No app source. No matrix-runner changes.

---

## Pre-flight

- [ ] **0.1** Read the existing `apps/bench/tests/bench.spec.ts` to understand the current tracing wiring:
  ```
  cat apps/bench/tests/bench.spec.ts
  ```
  Confirm the spec already does `await page.context().tracing.start({ screenshots: true, snapshots: true })` early and `await page.context().tracing.stop({ path: tracePath })` later. The CDP-tracing path is additive — both traces run when opt-in is set.

- [ ] **0.2** Free port 4173 if stale (`lsof -ti tcp:4173 | xargs -r kill -9`).

---

## Task 1 — Wire CDP-tracing branch in bench.spec.ts

- [ ] **1.1** Open `apps/bench/tests/bench.spec.ts`. At the top of the test fixture, read the env opt-in:

  ```ts
  const perfTraceEnabled = process.env.PLAYWRIGHT_PERF_TRACE === "1";
  ```

- [ ] **1.2** After `await page.goto(...)` but BEFORE the bench-result wait, open a CDP session and start tracing if `perfTraceEnabled`:

  ```ts
  let cdpSession: Awaited<
    ReturnType<typeof page.context.prototype.newCDPSession>
  > | null = null;
  const cdpEvents: unknown[] = [];

  if (perfTraceEnabled) {
    cdpSession = await page.context().newCDPSession(page);
    cdpSession.on("Tracing.dataCollected", (payload: { value: unknown[] }) => {
      for (const event of payload.value) cdpEvents.push(event);
    });
    await cdpSession.send("Tracing.start", {
      categories: [
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "v8",
        "disabled-by-default-v8.cpu_profiler",
      ].join(","),
      options: "sampling-frequency=10000",
    });
  }
  ```

  Note: omit `transferMode: "ReturnAsStream"` for simplicity — collect events via the `Tracing.dataCollected` listener instead. (The streaming path is more efficient for huge traces but the dataCollected path is simpler and works fine for 3-second windows.)

- [ ] **1.3** After the bench result is captured (around the line `const result = await page.evaluate(...)`), stop CDP tracing and write the JSON:

  ```ts
  if (perfTraceEnabled && cdpSession) {
    const tracingComplete = new Promise<void>((resolve) => {
      cdpSession!.once("Tracing.tracingComplete", () => resolve());
    });
    await cdpSession.send("Tracing.end");
    await tracingComplete;
    const cdpPath = tracePath.replace(/\.trace\.zip$/, ".cdp.json");
    await mkdir(path.dirname(cdpPath), { recursive: true });
    await writeFile(
      cdpPath,
      JSON.stringify({ traceEvents: cdpEvents }, null, 0) + "\n",
    );
  }
  ```

  Place this BEFORE `await page.context().tracing.stop(...)` (the Playwright action trace closer) so the CDP session is cleaned up while the page is still around.

- [ ] **1.4** Wrap the CDP block in a try/catch that logs but doesn't fail the test:

  ```ts
  try {
    // ... CDP start/stop/write code
  } catch (err) {
    console.warn(
      `[bench.spec] CDP tracing failed (best-effort, ignoring):`,
      err,
    );
  }
  ```

  Apply the try/catch to BOTH the start block (Task 1.2) and the stop+write block (Task 1.3) — independently, so a failure starting tracing doesn't blow up the stop path, and vice versa.

- [ ] **1.5** Verify Imports. The spec already imports `mkdir`, `readFile`, `stat`, `writeFile` from `"node:fs/promises"` and `path` from `"node:path"`. No new imports needed.

- [ ] **1.6** Typecheck:
  ```
  pnpm --filter @pretable/app-bench typecheck
  ```
  Expected: passes.

- [ ] **1.7** Run the existing test with `PLAYWRIGHT_PERF_TRACE` UNSET to confirm regression-free:
  ```
  pnpm bench:e2e --project=chromium
  ```
  Expected: spec passes; no `.cdp.json` produced; behavior identical to current `main`.

- [ ] **1.8** Commit:
  ```
  git add apps/bench/tests/bench.spec.ts
  git commit -m "feat(bench): opt-in CDP tracing in bench.spec.ts via PLAYWRIGHT_PERF_TRACE"
  ```

---

## Task 2 — Manual verification

- [ ] **2.1** Run with the env opt-in set:
  ```
  PLAYWRIGHT_PERF_TRACE=1 \
    PRETABLE_BENCH_ADAPTER=pretable \
    PRETABLE_BENCH_SCENARIO=S2 \
    PRETABLE_BENCH_SCALE=hypothesis \
    PRETABLE_BENCH_SCRIPT=filter-text \
    pnpm --filter @pretable/app-bench exec playwright test --workers=1
  ```

- [ ] **2.2** Locate the produced JSON:
  ```
  ls -lt status/traces/*.cdp.json | head -1
  ```
  Expected: non-zero size (1–30 MB).

- [ ] **2.3** Sanity-check the JSON:
  ```
  jq '.traceEvents | length' status/traces/*.cdp.json | head -1
  ```
  Expected: a number > 100 (a real trace has thousands of events; a low number would suggest the categories aren't producing what we expect).

  Also check shape:
  ```
  jq '.traceEvents[0:3]' status/traces/*.cdp.json
  ```
  Expected: each event has `ph` (phase), `ts` (timestamp), `cat` (category), etc. — Chrome DevTools trace-event format.

- [ ] **2.4** Open in Chrome DevTools:
  - Open `chrome://devtools/` or any Chrome page → F12 → Performance tab.
  - Click the "Load profile…" folder icon.
  - Select the `.cdp.json` file.
  - The flame graph should render with the interaction window visible.

  Screenshot the flame graph for the PR body.

- [ ] **2.5** Don't commit the captured trace (it's in the gitignored `status/traces/`).

---

## Task 3 — repo-memory entry

- [ ] **3.1** Append a 2026-05-13 section to `docs/research/repo-memory.md`:

  Cover:
  - The new opt-in env (`PLAYWRIGHT_PERF_TRACE=1`).
  - Where output lands (`status/traces/<stem>.cdp.json`).
  - How to open it (Chrome DevTools → Performance → Load profile).
  - Categories chosen + the standard "flame-graph" rationale.
  - Pointer to the wrapped-text filter memo as the next intended consumer.
  - Out-of-scope notes (no matrix integration, no Speedscope export).

  Suggested heading: `### Bench-harness CDP tracing opt-in`.

- [ ] **3.2** Commit:
  ```
  git add docs/research/repo-memory.md
  git commit -m "docs(research): repo-memory entry — bench-harness CDP tracing"
  ```

---

## Task 4 — Gates + PR

- [ ] **4.1** Repo-wide gates:
  ```
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```
  Expected: all pass.

- [ ] **4.2** Push + open PR:
  ```
  git push -u origin bench-harness-cdp-tracing
  gh pr create --title "feat(bench): opt-in CDP tracing in bench.spec.ts (unblocks flame-graph perf diagnostics)" --body "..."
  ```

  PR body should include:
  - Summary of the env opt-in.
  - The categories chosen.
  - Manual verification: screenshot of the DevTools flame graph for the captured CDP trace.
  - What's NOT in the PR (matrix integration, Speedscope export, automated test for the new path).
  - Pointer to the wrapped-text filter memo (PR #142) as the next intended consumer.

- [ ] **4.3** Auto-merge:
  ```
  gh pr merge --auto --squash
  ```
  This is tooling-only; no public-API impact; no measurement changes. Safe to auto-merge.

---

## Self-review

- Spec coverage: env opt-in (Task 1.1) → CDP start (1.2) → CDP stop + write (1.3) → failure handling (1.4) → manual verification (Task 2) → docs (Task 3) → gates + PR (Task 4). ✓
- No placeholders.
- Type/value consistency: `cdpSession` type uses `Awaited<ReturnType<...>>` so TypeScript can infer from Playwright's API; `cdpEvents: unknown[]` keeps the listener loose; output JSON shape `{ traceEvents: [...] }` matches Chrome DevTools' expected import format.
- Scope: single PR, four task groups, ~3 commits-of-record, auto-mergeable.

---

## Notes for the implementer

- Keep the diff to `bench.spec.ts` minimal. The Playwright action trace stays untouched; CDP tracing is fully additive.
- The CDP `Tracing.dataCollected` listener fires multiple times per run — collect all batches into the `cdpEvents` array before writing the JSON.
- Don't put the CDP code in a separate file. Inlining keeps the test fixture readable and avoids new module imports.
- The "sampling-frequency=10000" option sets V8's CPU profiler to 10 kHz sampling. Standard for DevTools-style profiling; the resulting `.cdp.json` will be ~5–20 MB for a 3-second window.
- If the env opt-in path fails locally (e.g., CDP session error), check that the local Playwright + Chromium versions match (`pnpm exec playwright --version`); the categories list is stable across recent Chromium versions but a major version change can affect it.
