# Handoff — pretable, 2026-09-03

Successor to `docs/handoff/2026-08-30-session-handoff.md`. That document's
"Corrections" and "Decisions" sections are still accurate; this one records
what was built from them and what is still owed.

Verified against `origin/main` @ `0af4bc36` on 2026-09-03.

---

## What this session did

Executed the S8 PMS benchmark profile end to end: spec → plan → twelve tasks
via subagents, each with a spec-compliance review and a code-quality review
that demanded a mutation before believing an assertion → a whole-branch final
review → PR.

**PR [#570](https://github.com/cacheplane/pretable/pull/570)** — squash +
auto-merge. Read its body first; it is the accurate summary. Check it merged
with `gh pr view 570 --json state,mergedAt` — an opened PR is not a merged PR.

The roadmap's last `Now` line is now half done: the PMS profile exists; the
financial-planning profile (`S9`) is deferred on purpose until the
planning-track interactions it should stress exist (see the 2026-08-30 handoff,
"Open question").

---

## Still owed — most valuable first

### 1. The S8 baseline runset at target scale (spec §5)

**Not measured.** Load was 8–15 on ten cores with 8 GB of swap in use for the
entire session, and the handoff rule is that a baseline taken there describes
the machine. Every S8 script was run for *correctness* (all `completed`, right
row counts) — those timings are not evidence.

When the machine is quiet (`uptime` load well under ~5, `sysctl vm.swapusage`
near zero, nothing burning a core in `ps -eo pcpu,comm | sort -rn | head`):

```bash
lsof -iTCP:4173 -sTCP:LISTEN   # must be empty
pnpm build
node scripts/bench-matrix.mjs --adapters=pretable --scenarios=S8,S5 --scale=target --repeats=3 \
  --scripts=initial,scroll,sort,filter-metadata,filter-text,updates,group,group-expand,group-updates \
  > /tmp/s8-runset.txt 2>&1; echo "exit=$?"
```

S5 is the interleaved control, in the same invocation, per the measuring rules.
Commit the runset as `status/milestones/<date>-s8-pms-baseline.json` with the
machine state in its notes, then `node --test scripts/__tests__/` and
`node scripts/check-bench-budgets.mjs` (which must still judge only
`pretable/default/S1/dev`). The deliverable number is the flat `updates` vs
grouped `group-updates` pair at 20k — the deterministic pin on the
grouped-streaming 60 Hz miss.

`S5 × sort` etc. will report `unsupported` in that runset; expected.

### 2. Comparator re-baseline (still owed from before)

Unchanged from the 2026-08-27 handoff. Wants the same quiet machine. S8 is
admitted to `sort`/`filter-*`/`updates` on all four adapters, so it can join
that run — but `group`/`group-expand` on S8 are pretable-only except `group`
on tanstack, same as S2/S7.

### 3. Small follow-ups the reviews flagged and deliberately left

- `updates-grouped` emits no group-row notes (only `group-updates` does), so
  its artifact cannot show it grouped anything. Pre-existing; one
  `groupingNotes.push` in `bench-app.tsx` would fix it.
- The diagnostics summary's `expectedGroupCountAfter` counts leaves;
  `countVisibleGroups` counts every level. They disagree on any multi-level
  scenario. Documented in `createRunSummary`; unreachable today because
  `bench-row-model-gate.mjs` hard-requires S5. Resolve before pointing the
  gate at S8.
- `apps/bench/src/tanstack-adapter.tsx` ~L119 still says
  "interaction-plan.ts METADATA_FILTER" — now a function-local, not a module
  constant. Cosmetic.
- No lint rule enforces `import type` between `scenario-data/index.ts` and
  `pms-profile.ts`; a future value import would create a runtime cycle
  silently. `@typescript-eslint/consistent-type-imports` at the workspace
  level would close it.

---

## Traps that cost time this session

**A literal NUL byte in a doc or a subagent brief makes `grep` treat the file
as binary and match nothing.** Four U+0000 characters landed in the spec and
plan where a join separator was typed; two reviewers and I all "could not find"
text that was there. `LC_ALL=C grep -c -a -P '\x00' <file>` finds them; always
`grep -a` on generated docs. (Same trap as the filter-builder session.)

**`pnpm --filter @pretable/app-bench test -- <name>` does not filter** — it
runs the whole suite. Targeted: `cd apps/bench && npx vitest run
--environment jsdom src/__tests__/<file>`.

**apps/bench vitest reads `@pretable-internal/scenario-data` from `dist/`.** A
scenario-data mutation changes nothing in a bench test until you rebuild the
package. A negative control that does not fire may be measuring stale dist.

**`post_interaction_row_height_error_p95_px` is absent, not zero, when no
sampled cell can wrap.** The spec assertion that demanded it unconditionally
was wrong for eleven months and only S8's non-wrapping data columns exposed it.

**Two agents committing on one branch is a conflict.** Sequenced every
implementer; ran reviewers in parallel with docs edits only.

**API overloads (HTTP 529) hit opus and fable repeatedly; sonnet was reliable
all session.** Implementation on sonnet with a full-code brief was fine; the
two judgement-heavy tasks (ripple generator, interaction-plan arithmetic) went
to opus on retry.

**Vacuous tests were found three times by mutation, never by reading:** a
formula test that compared `derive()` against rows `derive()` had produced; an
adapter test that read the row model's columns rather than the columns handed
to the surface; a sigma constant nothing pinned. The reviewer instruction
"prove the assertion can fail" is what caught each one.

---

## Workflow

Unchanged. Brainstorm → spec in `docs/superpowers/specs/` → plan → subagents
in worktrees → PR with `--squash --auto`. Never commit features to main.
