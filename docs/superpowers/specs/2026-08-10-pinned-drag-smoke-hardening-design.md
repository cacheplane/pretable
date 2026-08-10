# Pinned-column drag smoke hardening design

**Date:** 2026-08-10  
**Status:** Approved for specification review  
**Scope:** Website end-to-end test only

## Problem

The production smoke test `showcase: dropping into the right-pinned group pins the column` occasionally times out because the scripted drag never engages or its narrow destination moves after coordinates are measured. The observable failure is stable: the final header remains `note` instead of becoming `sector`. A configured Playwright retry then passes.

This exact symptom predates the favicon and React documentation release. It occurred on earlier `main` runs, while the immediately preceding production run passed in both Chromium and WebKit. The release remains healthy; this follow-up addresses test reliability rather than product behavior.

The existing helper contract also identifies the gap. `waitForStablePosition` is best-effort and requires callers to verify that a press engaged. This test does not verify engagement. The adjacent sideways-reorder test already demonstrates the repository's stable pattern by retrying a remeasured grab until the reorder ghost appears.

## Goals

- Prove that the drag engaged before moving toward the pinned destination.
- Tolerate a missed initial press without relying on the test runner's whole-test retry.
- Measure the moving destination only after engagement, immediately before the drop.
- Keep the final drop and behavioral assertions single-shot.
- Preserve Chromium and WebKit coverage.

## Non-goals

- No product drag, pinning, layout, or rendering changes.
- No new helper API or general drag abstraction.
- No broader timeout or Playwright retry increase.
- No weakening of the final order, pin, or `aria-colindex` assertions.
- No attempt to remove every coordinate-based browser-test risk in this follow-up.

## Approaches considered

### 1. Verify and retry only the grab — selected

Remeasure the `sector` header for up to three bounded attempts, press near its center, move through intermediate positions, and require the existing reorder ghost. Release the pointer after any failed attempt. Once engaged, remeasure `note`, move to its trailing pinned-group target, release, and retain the current assertions.

This follows an adjacent proven pattern, targets the missing premise directly, and does not conceal a real product failure.

### 2. Increase timeout or suite retries — rejected

The current failure usually consumes the assertion timeout after a drag that never started. More time cannot make that completed gesture engage, while more whole-test retries hide the same missing premise and increase CI cost.

### 3. Change product drag targeting — rejected

No evidence indicates a pinning defect. The same built assets pass on retry and in the other browser, historical runs show the same timing symptom, and the maintenance/release diffs did not touch drag behavior.

## Detailed design

The test keeps its current navigation, drawer opening, grid-readiness wait, stable-position wait, header-order baseline, and final assertions.

The gesture changes as follows:

1. Locate the existing reorder ghost within the page.
2. Attempt the `sector` grab at most three times.
3. On each attempt, freshly read the source header box and derive its midpoint.
4. Press and move through intermediate positions so pointer capture can engage in WebKit.
5. Treat ghost presence as proof that the drag engaged.
6. If the ghost is absent, release the pointer before the next attempt.
7. Fail with a specific engagement message if all attempts miss.
8. After engagement, freshly measure the `note` header.
9. Move to six pixels inside its trailing edge, using the current stepped motion, then release.
10. Preserve the existing final-header, pin-state, and sequential `aria-colindex` assertions.

The destination remains deliberately narrow because that geometry is the behavior under test: landing in the trailing half of the right-pinned header must join the pinned group. Reliability comes from verifying the grab and measuring the target at the correct time, not from making the destination less precise.

## Test strategy

The change is itself an end-to-end test hardening, so two temporary negative controls must exercise both branches of the new engagement guard:

- First-miss recovery: temporarily ignore an observed ghost on attempt one, release the pointer through the normal miss path, and allow later attempts to observe it. The focused Chromium test must pass without a runner retry, proving that the loop releases, remeasures, and recovers rather than only succeeding when attempt one engages.
- Terminal guard: temporarily make every attempt incapable of observing the ghost and confirm the focused Chromium test fails at the new engagement assertion rather than timing out on the final header order.
- Restore the intended implementation and run the focused test ten times in Chromium and ten times in WebKit with Playwright retries explicitly disabled. All 20 executions must pass.
- Run the complete website smoke suite once in Chromium and once in WebKit against a tracked production server, again with Playwright retries explicitly disabled. Both suites must pass on their initial execution.
- Preserve exact execution, failure, and retry counts in the report. Any runner retry or focused repetition failure prevents clean verification for this follow-up.

Static verification includes website type checking, linting the changed test, formatting, and `git diff --check`.

## Safety and cleanup

- Only `apps/website/e2e/smoke.spec.ts`, this design, the implementation plan, and a test-only Changeset decision record if required by repository policy may change.
- No package release is expected because public runtime behavior and packaged documentation are unchanged.
- Use a checked-free local port and track the exact production-server process.
- Stop that process explicitly and remove only artifacts created by the verification run.
- Preserve any pre-existing browser or build artifacts.

## Acceptance criteria

- The drag cannot proceed unless the reorder ghost proves engagement.
- Failed grab attempts release the pointer and are bounded at three.
- The `note` destination is measured after engagement.
- Final ordering, right-pin state, and `aria-colindex` assertions remain unchanged.
- Focused verification passes 10/10 in Chromium and 10/10 in WebKit with Playwright retries disabled.
- Full Chromium and WebKit smoke suites pass once each with Playwright retries disabled.
- No product or public API files change.
