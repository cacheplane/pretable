# Bench App Trigger Gating Design

**Date:** 2026-05-15
**Status:** Approved
**Predecessor:** [PR #143 bench-harness CDP tracing](../../research/repo-memory.md) — surfaced the bench-app interaction-start timing limitation this PR closes.

---

## Goal

Add a `waitForTrigger=1` query param to the bench app so the Playwright spec can attach CDP tracing _before_ the interaction script runs. Closes the "known limitation" called out in PR #143's repo-memory entry (interaction starts on page-load, CDP attaches after, so the leading edge of the interaction window is not captured).

## Why

PR #143 wired opt-in CDP tracing into `apps/bench/tests/bench.spec.ts`. The captured trace for `pretable / S2 / hypothesis / filter-text` produced only ~145 events / 30 KB — the categories are correct (`v8`, `disabled-by-default-devtools.timeline`, `disabled-by-default-v8.cpu_profiler`) but the bench's interaction script already ran by the time the CDP session attached. Without gating, the CDP path can't capture meaningful flame-graph data for short interactions.

The follow-up that unblocks _on top of this PR_ is the wrapped-text filter perf-fix investigation (PR #142's deferred memo). That investigation needs a real flame graph of the trigger-to-first-frame window; this PR makes that capture possible.

## Non-goals

- **Touching the perf hypothesis or shipping a fix.** That's a separate follow-up PR. This is harness-only.
- **Replacing `autorun=1`.** The gate is _additive_ — `waitForTrigger=1` only matters when `autorun=1` is also set (the same path that's currently used by every Playwright run). Standalone `waitForTrigger=1` without `autorun=1` is a no-op.
- **Custom-event mechanism.** A `window.__PRETABLE_BENCH_START__` boolean flag is simpler, idempotent, easy to inspect.
- **Always-on gating.** Default behavior unchanged. The trigger-gate is opt-in via query param; the spec only sets it when `PLAYWRIGHT_PERF_TRACE=1`.
- **Cross-script tuning.** The same gate works for all 12 supported scripts. No per-script logic.

## Architecture

### Query param

`apps/bench/src/query-state.ts` — parse `waitForTrigger` exactly like `autorun`:

```ts
waitForTrigger: searchParams.get("waitForTrigger") === "1",
```

Default false. Add to `BenchQueryState` (`apps/bench/src/bench-types.ts`).

### Gate location

`apps/bench/src/bench-app.tsx` line 428-435 (the existing autorun useEffect):

```ts
useEffect(() => {
  if (!query.autorun || autorunRef.current) {
    return;
  }
  autorunRef.current = true;
  void autorunScript(query.scriptName);
}, [query.autorun, query.scriptName]);
```

When `query.waitForTrigger` is true, replace the immediate `void autorunScript(...)` call with a polling/listening loop that waits for `window.__PRETABLE_BENCH_START__ === true`, then calls `autorunScript`. The wait should be:

- Idempotent (don't fire twice).
- Honor the existing `autorunRef.current` guard.
- Use a `setInterval`/`requestAnimationFrame` poll (10 ms cadence is fine; not perf-critical, the trigger only fires once per run) OR an event listener if a `window.dispatchEvent` is preferred. Simplest: poll.

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

  // Wait for the spec (or any external trigger) to set the start flag.
  const tick = () => {
    if (window.__PRETABLE_BENCH_START__ === true) {
      void autorunScript(query.scriptName);
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}, [query.autorun, query.waitForTrigger, query.scriptName]);
```

Type augmentation for `window.__PRETABLE_BENCH_START__` goes wherever `BENCH_RESULT_KEY` is augmented (likely `bench-runtime.ts` has a `declare global` block — extend it).

### Spec wiring

`apps/bench/tests/bench.spec.ts`:

1. When `perfTraceEnabled`, append `&waitForTrigger=1` to the URL.
2. After CDP `Tracing.start` succeeds, fire the trigger:
   ```ts
   await page.evaluate(() => {
     window.__PRETABLE_BENCH_START__ = true;
   });
   ```
3. Then proceed to `page.waitForFunction(() => Boolean(window.__PRETABLE_BENCH_RESULT__))` as today.

If CDP start fails (the existing try/catch path), do NOT set the trigger — the bench will sit idle indefinitely. Better: ALWAYS set the trigger after the CDP attempt completes, regardless of success. The trigger is harmless if CDP isn't running; the bench just executes normally.

### Output verification

After this PR:

- Re-run the same `PLAYWRIGHT_PERF_TRACE=1 ... filter-text` command from PR #143's manual verification.
- Expected: `.cdp.json` size jumps from ~30 KB → meaningful KB or MB range (the interaction window is now fully inside the trace).
- Expected: `jq '.traceEvents | length'` jumps from 145 → thousands.

This is the success criterion for the PR. If trace size doesn't grow, the gate isn't working.

## File touches

```
apps/bench/src/query-state.ts                  (MODIFY: parse waitForTrigger param)
apps/bench/src/bench-types.ts                  (MODIFY: add waitForTrigger to BenchQueryState)
apps/bench/src/bench-app.tsx                   (MODIFY: gate autorun on window flag if waitForTrigger)
apps/bench/src/bench-runtime.ts                (MODIFY: declare window.__PRETABLE_BENCH_START__)
apps/bench/tests/bench.spec.ts                 (MODIFY: append waitForTrigger=1 + set start flag when CDP enabled)
docs/research/repo-memory.md                   (MODIFY: 2026-05-15 entry — gating + updated trace size)
```

No `packages/` changes. No public-API surface. Bench-only.

## Risks

- **Bench page lifecycle race.** The trigger could be set before the autorun useEffect's poll loop attaches, or after. The polling loop checks the flag on every animation frame, so a flag set _before_ the effect mounts is fine — first poll catches it. No race.
- **Test flakiness.** If the trigger is never set (e.g., spec bug), the bench hangs forever and Playwright's per-test timeout fires. That's acceptable — same as any other harness bug. The default path (no `waitForTrigger`) is unaffected.
- **Other consumers of `autorun=1`.** The `/bench` page on the website doesn't use `waitForTrigger`, so its behavior is unchanged. The matrix runner uses `autorun=1` via the same spec — also unchanged because `PLAYWRIGHT_PERF_TRACE` is opt-in.
- **CDP attach still failing.** If CDP fails to attach, the try/catch logs and `cdpSession` stays null. We still set `window.__PRETABLE_BENCH_START__ = true` so the bench runs without CDP. Result: same as current behavior (no CDP, normal bench run). No regression.

## Test plan

- **Pre-existing spec test** (default path, no env): passes unchanged — `waitForTrigger` param not appended, behavior identical.
- **CDP-enabled run** (`PLAYWRIGHT_PERF_TRACE=1`): produces `.cdp.json` with > 1000 events (vs ~145 before). Manual verification via `jq`.
- **Repo-wide:** `pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format` clean.

## Out-of-scope follow-ups

- **Wrapped-text filter perf-fix investigation v2** — now unblocked. The investigation is the next PR after this one.
- **CDP trace size handling.** A wider window may push traces to multi-MB. Still gitignored under `status/traces/*`. No new size limits enforced.
- **Speedscope export, matrix-runner CDP integration.** Same out-of-scope status as PR #143.
