# Validating the upstream fix for `The destination stream closed early.`

**Status:** design approved, not yet implemented
**Tracks:** pretable #377 · [vercel/next.js#96704](https://github.com/vercel/next.js/issues/96704)

## Problem

Every website e2e run logs 37–46 copies of `⨯ Error: The destination stream
closed early.` It is a Next 16.3.0 regression, not ours (#377 has the full
diagnosis). Two community PRs propose fixes —
[#96715](https://github.com/vercel/next.js/pull/96715) (draft, +87/−0 across 7
files) and [#96717](https://github.com/vercel/next.js/pull/96717) (open, +95/−12
across 4 files) — filed the same day, both `Fixes #96704`. **Neither has any
maintainer comment.**

We chose to help the upstream fix land rather than patch Next locally. A local
patch would quiet our logs and leave every other user of Next 16.3 with the
noise; the upstream fix quiets it for everyone and leaves us owning nothing.

## What we uniquely have

Both PRs validate with the same synthetic test: suspend a server component,
read one chunk, cancel, assert `onRequestError` was not called. That proves the
mechanism on one contrived request. It does not show the fix holds under a real
workload, and it cannot show whether the fix preserves render cancellation.

We have three things the threads do not:

1. **A real workload that reliably reproduces it.** A 112-test Playwright suite
   across Chromium and WebKit, producing 37–46 occurrences per run against a
   production `next start` build.
2. **A causal control.** A logging reverse proxy that absorbs client
   disconnects — unpipe and drain rather than destroy. Passing through: 111
   mid-stream disconnects → 40 errors. Absorbing fully: 103 absorbed → **0
   errors**, suite still 112/112. Driving the early close to zero drives the
   error to zero.
3. **A source-level proof that the error is never actionable.** React's
   `abort()` is guarded by `if (!(11 < request.status))`, and a successful
   render sets `status = CLOSED (14)` _before_ calling `destination.end()`. A
   completed render is therefore structurally incapable of logging this. Every
   occurrence means a render really was in flight when its socket closed.

Point 3 settles the semantic question the PRs assert but do not demonstrate:
classifying this as an abort is not suppression, it is correct classification.

## Design

### Arms

Three, measured back to back in one window on one machine:

| Arm | Next                                |
| --- | ----------------------------------- |
| A   | 16.3.0 as installed (baseline)      |
| B   | PR #96715 branch, built from source |
| C   | PR #96717 branch, built from source |

Building each PR branch validates the **actual diff**, which is what a
maintainer needs. Equivalent `dist` patches would validate only the mechanism.

### Measurement protocol

Per arm: three full-suite runs against `next start`, load average recorded
before each, `closed early` occurrences counted from a timestamped server log,
and **112/112 confirmed passing before any number is reported**. An arm that
does not build, or does not pass, produces no number — it produces a defect
report.

The count is known to vary run to run (46, then 37, then 40 on the same
baseline), so single runs are not comparable and the report must give the range,
not a point estimate.

### The correctness check that the error count cannot provide

Two outcomes are indistinguishable by error count alone:

- the abort is correctly classified, and the render is **still cancelled** — correct;
- the fix stopped cancelling renders, so nothing is ever in flight at close — a
  silent regression that burns server time finishing responses nobody reads.

Both show zero. Reporting a zero without separating them would hand maintainers
a green result endorsing a performance regression.

So each arm also runs a **cancellation twin**: a minimal throwaway Next app with
one route holding a deliberately slow async server component that writes
`RENDER-COMPLETED <id>` as its final act. Request it, disconnect mid-render,
and check the log.

|                                | `closed early` | `RENDER-COMPLETED` |
| ------------------------------ | -------------- | ------------------ |
| Baseline (cancels, misreports) | present        | absent             |
| Correct fix                    | absent         | absent             |
| Fix that broke cancellation    | absent         | **present**        |

`RENDER-COMPLETED` appearing is the failure signal. Before trusting the twin we
confirm it can fire at all — a completed, undisconnected request must produce
it, or the check is vacuous and proves nothing.

That minimal app is also the smallest shareable reproduction, useful to the
thread in its own right.

## Deliverable

A comment on #96704 carrying: the methodology, the per-arm ranges, the causal
control, the source-level proof, the cancellation-twin result for each PR, and
any defect found in either. If one PR passes and the other does not, say so with
the evidence; if both pass, say that too and leave the choice to maintainers.

**Nothing is posted to vercel/next.js without Brian's explicit approval of the
drafted text.** Contributing to a public repo is outward-facing, and the draft
comes back here first.

## Risks

**The Next monorepo build may not link cleanly.** Next 16 uses Turbopack, whose
native binary is a large Rust build. If the JS build cannot be linked against a
prebuilt native binary in reasonable time, the documented fallback is equivalent
`dist` patches via `pnpm patch`, reported with an explicit caveat naming exactly
what was tested. Falling back is a reportable outcome, not a failure — but it
must be labelled, never presented as having tested their code.

**Patching Next's runtime has already bitten us once.** An earlier attempt to
instrument the compiled runtime broke it: `destination` is not bound at all
three occurrences of the message string, 30 tests failed, and the error path
changed so the run was worthless. Hence the rule above that every arm is
verified green before its numbers count.

**Machine load skews everything.** This Mac runs concurrent sessions and has sat
at 6.5–10 load average. Arms are measured in one window with load recorded, and
any arm measured under materially different load is re-run.

## Out of scope

- Opening a competing third PR.
- Patching Next locally in this repo.
- Pinning to 16.2.x.
- Any change to pretable's own source. #376 (docs render memoisation) came out
  of the same investigation but stands on its own and does not affect this.
