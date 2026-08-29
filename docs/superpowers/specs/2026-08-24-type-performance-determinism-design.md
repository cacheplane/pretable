# Deterministic Type-Performance Measurement

**Date:** 2026-08-24

## Status

Approved prerequisite for the Node 24 security-modernization work.

## Problem

`pnpm typecheck:performance` gates TypeScript instantiation counts and compiler
heap usage for the 100-column and 500-column public type fixtures. The
instantiation count is deterministic, but TypeScript 6.0.3 reports
`process.memoryUsage().heapUsed` after forcing garbage collection only when
`global.gc` is available. The current runner launches ordinary Node, where
`global.gc` is undefined.

That makes the memory gate depend on garbage-collection timing. During the
Node 24 verification, two clean full-gate attempts failed on different
fixtures:

- `columns-100` reported 66,958 KiB against a 63,509 KiB budget.
- A later run reported 48,292 KiB for `columns-100`, then `columns-500`
  reported 140,911 KiB against a 109,859 KiB budget.

The original isolated branch/main and Node 22/24 diagnosis matrix produced
identical declaration output and exactly 29,466 `columns-100` instantiations in
every cell. All clean samples passed. In those exploratory samples, ordinary
Node 24 used less memory than ordinary Node 22; GC-enabled acceptance samples
later showed Node 24 using a small, stable amount more. Neither direction
approached a budget. Running the same compiler with `--expose-gc` produced
stable, lower measurements under both runtimes. The failure is therefore a
harness defect, not a product or Node 24 regression.

After rebasing the prerequisite onto 2026-08-29 main, five new GC-enabled runs
per runtime covered the expanded public types. Every run produced exactly
29,526 and 132,246 instantiations for the 100- and 500-column fixtures. Node
22.14 memory ranged from 42,013–42,038K and 71,714–71,761K; Node 24.19 ranged
from 43,771–43,780K and 73,194–73,209K. All samples stayed well below the
unchanged ceilings.

## Goals

- Make the existing memory measurement deterministic enough to gate changes.
- Continue measuring the exact workspace-installed TypeScript compiler.
- Preserve the existing fixture mapping and all current budgets.
- Fail closed when the compiler, fixture, diagnostics, or budget is invalid.
- Enforce the performance gate in the existing required CI typecheck context.
- Support both the current Node 22 baseline and the incoming Node 24 baseline.

## Non-goals

- Raising or recalibrating a budget.
- Replacing memory measurement with timing or process RSS.
- Removing the deterministic instantiation gate.
- Changing product source, public declarations, package metadata, or releases.
- Adding a new required branch-protection context.
- Solving general cross-machine benchmark normalization.

## Design

### Compiler invocation

Keep `scripts/check-type-performance.mjs` as the single owner of fixture
execution and diagnostic parsing. `createTypeScriptInvocation(configPath)`
will continue to resolve `typescript/bin/tsc` with `createRequire` and launch
it directly through `process.execPath`, without a shell. Its argument list will
become:

```text
--expose-gc
<absolute workspace TypeScript CLI path>
-p
<absolute fixture config path>
--noEmit
--extendedDiagnostics
--pretty
false
```

Node exposes `global.gc` to the compiler process. TypeScript's own diagnostic
path invokes it immediately before reading heap usage, so the reported memory
value describes the compiler's retained heap instead of an arbitrary pending
garbage backlog. No wrapper, alternate compiler API, preload hook, environment
override, or shell is introduced.

The runner will still use the current Node executable. This means the gate
runs under Node 22 on current main and automatically runs under Node 24 after
the toolchain prerequisite is merged.

### Budgets and output

The two fixture mappings, instantiation ceilings, memory ceilings, calibration
records, parsing rules, and human-readable summaries remain unchanged. The
existing budgets are deliberately conservative after deterministic collection;
this prerequisite must not combine a measurement fix with threshold changes.
The calibration records remain historical pre-repair provenance for how those
ceilings were originally chosen; the new five-run samples are acceptance
evidence, not replacement calibration data. Any future recalibration requires
separate evidence and review.

The runner continues to reject:

- a missing, duplicate, or malformed diagnostic;
- an unexpected or remapped fixture;
- a missing, extra, or malformed budget;
- a compiler process failure;
- any deterministic metric above its existing ceiling.

Check time remains informational.

### CI enforcement

Add `pnpm typecheck:performance` after `pnpm typecheck` in the existing
`.github/workflows/ci.yml` `typecheck` job. The job already installs the frozen
workspace and is already a required branch-protection context. Reusing it
avoids a new unprotected status check and ensures both pull requests and main
pushes exercise the deterministic gate.

The command owns its prerequisite core build, so the workflow does not add a
separate build step.

## Testing

### Unit contract

Update the existing invocation test first so it fails against the current
runner. It must assert:

- `process.execPath` is the executable;
- `--expose-gc` is the first argument;
- the next argument is the absolute CLI inside the installed `typescript`
  package;
- the immutable config and diagnostic arguments retain their exact order;
- no shell or package-manager shim participates.

Existing parsing, fixture, budget, and failure tests remain green. A negative
control that removes `--expose-gc` must fail only the invocation contract.

### Real compiler proof

After implementation, build the core dependency closure and run the exact
performance command repeatedly under Node 22.14.0 and Node 24.19.0. For every
sample:

- both fixtures must pass without retries;
- instantiation counts must be identical within a runtime and across runtimes;
- memory must remain below the unchanged ceiling;
- the raw output must show the expected fixture order and summaries.

Run at least five consecutive samples per runtime. This is acceptance evidence,
not a permanent statistical workaround: production CI still performs one
deterministic sample per fixture.

### Repository gates

The prerequisite PR must pass the focused Node tests, the exact performance
command, the full root test suite, typecheck, lint, format, build, API checks,
packaging checks, publish preflight, and diff checks. It carries no Changeset.

## Failure handling

- If Node rejects `--expose-gc`, the child compiler fails and the gate fails.
- If TypeScript exits nonzero, the runner preserves its output in the existing
  fixture-failure error.
- If repeated GC-enabled samples still cross a ceiling, stop. Do not rerun until
  green or change a threshold in this PR; investigate the remaining retained
  heap or a real type regression.
- If CI differs systematically from clean local samples, capture the raw CI
  diagnostics before considering any budget work.

## Delivery sequence

1. Merge this harness-only prerequisite PR into the latest main.
2. Rebase the Node 24 security-modernization branch onto that merge.
3. Rerun its entire release gate from the beginning.
4. Continue the previously approved security-modernization PR sequence only
   after the deterministic performance gate is green.

No package version or public release is produced by this prerequisite.
