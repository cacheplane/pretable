# Bench Harness CDP Tracing Design

**Date:** 2026-05-13
**Status:** Draft (awaiting user review before plan)
**Predecessors:** [PR #142 wrapped-text filter perf-diag](../../research/repo-memory.md) — surfaced the bench-harness tracing gap that this PR closes.

---

## Goal

Add an opt-in CDP-level tracing path to `apps/bench/tests/bench.spec.ts` so future perf diagnostics can capture function-level flame-graph data instead of Playwright's default action-trace format. Unblocks the deferred wrapped-text filter perf-fix investigation (memo at `docs/research/2026-05-13-pretable-wrapped-text-filter-perf-diagnostic.md`) and any future hotspot-attribution work.

Output: Chrome DevTools-compatible trace JSON loadable in the Performance panel via "Load profile…".

## Why

PR #142's perf-diag hit a hard tooling wall: Playwright's `tracing.start({ screenshots: true, snapshots: true })` (the only tracing the bench has wired today) produces API call frames + DOM snapshots + screencast — NOT a JS function timeline. To find why pretable's interaction scripts land 1–2 ms over the 16 ms single-frame budget, we need per-function timing.

Playwright exposes the Chrome DevTools Protocol (CDP) directly via `page.context().newCDPSession(page)`. Sending `Tracing.start({ categories: '...' })` produces standard DevTools-format JSON — the same data Chrome's "Performance" panel records — that can be loaded for flame-graph analysis. This PR wires that path as an opt-in.

This is infrastructure, not measurement. No bench numbers change.

## Non-goals

- **Re-doing the wrapped-text filter perf-fix investigation.** That's a separate follow-up PR that uses this new tracing path.
- **Replacing the existing Playwright action trace.** The action trace is useful for visual debugging (screenshots + DOM snapshots); CDP tracing is additive, not a replacement.
- **Always-on CDP tracing.** Opt-in via env var only. CDP tracing adds ~5–10× run overhead and produces large JSON files (tens of MB per run). Default-off keeps the matrix runs fast.
- **Cross-browser CDP tracing.** Chromium only — CDP is a Chrome protocol. (The bench is Chromium-only anyway.)
- **Visualization tooling.** Output is loaded into Chrome DevTools manually. No bundled trace viewer.
- **Matrix runner integration.** The matrix runner runs many small invocations; CDP tracing per invocation would multiply wall-clock by 5–10×. Users opt in on individual Playwright runs, not full matrix sweeps.

## Architecture

### Env opt-in

`PLAYWRIGHT_PERF_TRACE=1` env var triggers the CDP-tracing branch. When unset (the default), the spec runs as today — no behavioral or perf change.

### Code changes

`apps/bench/tests/bench.spec.ts`:

1. Read `process.env.PLAYWRIGHT_PERF_TRACE === "1"` at spec setup.
2. If set, after `page.goto(...)` but BEFORE the bench result becomes available, open a CDP session:
   ```ts
   const cdp = await page.context().newCDPSession(page);
   await cdp.send("Tracing.start", {
     categories: [
       "disabled-by-default-devtools.timeline",
       "disabled-by-default-devtools.timeline.frame",
       "v8",
       "disabled-by-default-v8.cpu_profiler",
     ].join(","),
     options: "sampling-frequency=10000",
     transferMode: "ReturnAsStream",
   });
   ```
3. Collect events into a buffer via the `Tracing.dataCollected` event listener.
4. After the bench result is published, call `Tracing.end` and wait for `Tracing.tracingComplete`.
5. If `transferMode: "ReturnAsStream"` is used, read the stream via `IO.read`. Otherwise, collect events from the `Tracing.dataCollected` buffer.
6. Write the aggregated JSON to a sibling file alongside the Playwright trace zip:
   ```
   status/traces/<existing-stem>.cdp.json
   ```
   (Same stem as `createRunArtifactFileStem(result)` produces for the Playwright trace, just with `.cdp.json` suffix.)

The CDP write happens INSIDE the test fixture, so it lands in the same per-run output cycle as the Playwright trace. Both are gitignored (`.cdp.json` follows the existing `status/traces/*` ignore rule).

### Output shape

The CDP `Tracing` API produces an array of event objects matching the Chrome DevTools "Trace Event Format" — the same format that DevTools' "Save profile…" / "Load profile…" round-trips. Wrap in `{"traceEvents": [...]}` so Chrome DevTools accepts the file directly.

Example consumption (manual):

1. Open Chrome → DevTools → Performance tab.
2. Click "Load profile…" (folder icon).
3. Select `status/traces/<stem>.cdp.json`.
4. Flame graph renders. The window around the bench's interaction script is the focus.

### Failure handling

- **CDP session fails to attach** (rare; would indicate Playwright/Chromium version mismatch): log to test stderr, skip CDP tracing, let the Playwright run proceed normally. Don't fail the test.
- **`Tracing.end` doesn't fire** (timeout): log a warning with the timeout duration; save whatever events were collected; don't fail the test.
- **JSON write fails**: log; don't fail the test.

The CDP-tracing path is best-effort additive — never blocks the underlying bench run.

### Documentation

A short section in `docs/research/repo-memory.md` covering:

- How to opt in (`PLAYWRIGHT_PERF_TRACE=1`).
- Where the output lands (`status/traces/<stem>.cdp.json`).
- How to load in Chrome DevTools.
- The categories chosen and why.
- Pointer to the wrapped-text filter memo as the next intended consumer.

No README changes; this is an internal-tooling extension, not a developer-facing feature.

### Test coverage

Adding a unit test for the CDP tracing path is awkward — it requires a running Chromium + CDP. Instead:

- **Manual verification:** one CDP run captured, opened in DevTools, screenshot in the PR body.
- **Regression guard:** confirm the env-unset path is byte-identical to current behavior. The existing spec test (`writes benchmark artifacts for the selected Pretable run`) must still pass with `PLAYWRIGHT_PERF_TRACE` unset.

## File touches

```
apps/bench/tests/bench.spec.ts                            (MODIFY: add CDP-tracing branch)
docs/research/repo-memory.md                              (MODIFY: 2026-05-13 entry — bench-harness CDP tracing)
```

No `packages/` changes. No public-API surface. No app source. Just one test file + a doc entry.

## Risks

- **CDP API drift.** Chromium's CDP version moves with the bundled Chromium. The trace event categories we pick should stay stable (they're standard DevTools categories) but if a future Chromium bump renames or drops a category, the env-set path silently produces an empty trace. Mitigation: the failure-handling section's logging would surface that. A follow-up could add a `traceEvents.length > 0` assertion.
- **Trace file size.** A 3-second interaction window at 10 kHz sampling typically produces 5–30 MB of JSON. The gitignore already covers `status/traces/*`, so no commit pollution risk. Local disk fills up if a user runs many CDP traces — document that.
- **Wall-clock overhead.** CDP tracing slows the bench's interaction window by 5–10×. The matrix runner's wall-clock budget doesn't allow always-on tracing; the env opt-in keeps it user-controlled.
- **Race condition on `Tracing.tracingComplete`.** Playwright's CDP session is event-driven; we have to await the complete event after `Tracing.end`. If the await races with Playwright's test teardown, the JSON could be truncated. Mitigation: explicit `await` on a Promise that resolves on `tracingComplete`.
- **No automated test for the new path.** As noted, requires a running browser. Manual verification in the PR body is the substitute. A future "bench-harness self-test" could exercise the CDP path; out of scope here.

## Out of scope follow-ups

- **Wrapped-text filter perf-fix investigation v2** — uses this new tracing path. Memo at `docs/research/2026-05-13-pretable-wrapped-text-filter-perf-diagnostic.md` has the candidate fixes; flame-graph data confirms which one to ship.
- **Bench-harness self-test for the CDP path** — would require a browser-in-CI setup beyond what we have. Manual verification is the current bar.
- **Matrix runner CDP integration.** Per the spec's "always-on CDP tracing" non-goal, this would multiply matrix wall-clock 5–10×. Not done here.
- **Visualization tooling beyond Chrome DevTools.** Speedscope or other flame-graph viewers can also consume DevTools-format JSON; documenting that is a small follow-up if a non-Chrome user wants to investigate.

## Test plan

- [x] `PLAYWRIGHT_PERF_TRACE` unset: existing spec test passes unchanged.
- [x] `PLAYWRIGHT_PERF_TRACE=1`: spec produces both the Playwright `.trace.zip` and a sibling `.cdp.json`.
- [x] `.cdp.json` is well-formed: opens in Chrome DevTools' Performance panel; flame graph renders.
- [x] `pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format` clean.
- [x] No `packages/` source touched.

Manual verification: one CDP run captured by the implementer; screenshot of the loaded flame graph in the PR body.
