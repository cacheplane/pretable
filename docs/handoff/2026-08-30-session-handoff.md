# Handoff — pretable, 2026-08-30

Successor to `docs/handoff/2026-08-27-session-handoff.md` (written in worktree
`resume-04ddad`). **Read that document first** — it is still accurate and this
one does not repeat it. What follows is only what changed and what this session
established.

Verified against `origin/main` @ `a29298a0` on 2026-08-30. No code was written
this session.

---

## What this session did

Ingested the 2026-08-27 handoff, re-verified repo state, and began the
brainstorm for its item 1 — **PMS / financial-planning benchmark profiles**, the
last line under `Now` in `ROADMAP.md`. The brainstorm reached three approved
design decisions and was stopped before the fourth. No spec was written; nothing
is committed; the working tree is clean.

Pick up at the **Open question** below.

---

## Corrections to the 2026-08-27 handoff

**The open-PR list was incomplete.** It named `#480` plus five dependabot bumps.
As of 2026-08-30 there are ten open PRs. Beyond the six already listed:

- `#499` — `chore(row-model): delete dead rebuildRowStoreForQuery`
  (`blove/delete-dead-rebuild-row-store-for-query`, opened 2026-08-27)
- `#472` — dependabot, fuzzysort 3.1.0 → 4.0.2
- `#431` — `chore: version packages` (the changesets release PR)
- `#410` — `Close the three smoke-coverage gaps…` (`blove/smoke-audit-3878ef`,
  open since 2026-08-14)

`#499` and `#410` are mine and predate this session. Neither was touched here.
Treat `#410` as genuinely stale — it has been open sixteen days.

Everything else in the 2026-08-27 document that I checked held up: `origin/main`
is still at `a29298a0`, and
`status/milestones/2026-08-10-grouping-streaming-disambiguation.json` exists as
described.

---

## The design decisions that are settled

Brian answered three questions. These are approved and should not be re-litigated.

### 1. Purpose: measurement baselines, NOT regression gates

The profiles produce committed evidence of where pretable stands on realistic
finance-shaped workloads. **They do not get budget ceilings in this pass.**
Ceilings come later, once numbers exist.

This is a deliberate narrowing of the roadmap line, which reads "without
weakening existing 60 Hz, zero-gap, and interaction-continuity gates" — that
clause is a constraint on the new work, not an instruction to add gates. Do not
add entries to `CLIENT_BUDGETS` in `scripts/check-bench-budgets.mjs` for these
scenarios.

Note the shape of that gate before touching it: `CLIENT_BUDGET_RUN` pins the run
identity to `pretable/default/S1/dev`, and the gate iterates the _budget table_,
so an absent run is a failure. Adding scenarios does not disturb it. Adding
budget rows would.

### 2. Encoding: new scenarios `S8` and `S9`

PMS is `S8`, financial planning is `S9`, both added as `ScenarioDefinition`
entries in `packages/scenario-data/src/index.ts`. Finance-shaped columns and
data replace the generic Message/Owner/Status/Score generator for these two.

**The `profile` query axis stays `"default"`.** It was considered as the place to
put "data domain" and rejected: every consumer of the run identity (the budget
gate, summary filenames, `scripts/bench-matrix.mjs`) would have to learn a new
axis, whereas scales, seeds, adapters, and scripts all already key off
`scenarioId`.

Concretely, adding a scenario means touching at least:

- `scenarioDefinitions`, `scenarioScaleRowCounts`, `scenarioSeeds` in
  `packages/scenario-data/src/index.ts`
- the `scenarioId` union in `apps/bench/src/bench-types.ts` — note it is
  currently `"S1" | "S2" | "S3" | "S4" | "S5" | "S7"`, which **already omits S6**;
  find out why before assuming S8/S9 belong there
- `packages/scenario-data/src/__tests__/scenario-data.test.ts`

Finance data will likely need column _types_ the current generator has no notion
of (currency, percentage, signed P&L). `buildColumns` emits only
`{id, header, wrap, widthPx, pinned}`. Decide whether `ScenarioColumn` grows a
type field or whether the adapters infer it — this was not discussed.

### 3. `S8` is measured both flat and grouped

The PMS dataset is group-shaped (sector/strategy columns), and the bench runs it
**both ways**: flat for the control, grouped for realism. The grouped run gives
the known 60 Hz miss a deterministic, finance-realistic pin.

The scripts already exist — `group`, `group-updates`,
`group-updates-stable-keys`, `updates-grouped` are all in the `scriptName` union
in `apps/bench/src/bench-types.ts`. `createRowModelGateMatrixEntries` in
`scripts/bench-matrix.mjs` currently hardcodes `scenarioId: "S5"` across its four
entries; extending row-model gate coverage to S8 means changing that function,
not adding a flag.

"Grouped by definition" (no flat control) was explicitly rejected — the flat run
is what isolates grouping cost.

---

## Open question — start here

**What should `S9` (financial planning) stress?** I proposed three options and
Brian declined all of them, which most likely means the framing was wrong rather
than that any one option was. Ask fresh; do not re-offer the same list.

For context, the three that were declined:

1. Wide time-series plus edits — ~5–10k line items, 60–120 mostly-numeric
   period columns plus scenario-comparison pairs, with scroll/sort/select-range
   and paste-shaped scripts rather than streaming.
2. Mirror the PMS geometry with planning-flavored data.
3. Deep account hierarchies (department → account → line) with aggregates.

The roadmap's planning track (`ROADMAP.md`, `Later` §3) describes range editing,
fill, row creation and reordering, formula and provenance surfaces, and
time/scenario comparison columns. Several of those capabilities **do not exist
yet**, which may be the real problem with all three options: a benchmark profile
for interactions the grid cannot perform is not measurable. Worth putting that
directly to Brian — it may be that `S9` should wait, and this pass should ship
`S8` alone.

`S8` itself is fully specified by the three decisions above and could proceed
independently.

---

## Before you run anything

Re-read "Measuring on this machine" in the 2026-08-27 handoff. It is the part of
that document most likely to cost you a wasted day. The two rules in short: load
average ~9.5 on ten cores is full occupancy, not idle — check `vm_stat` and
`sysctl vm.swapusage` too; and every comparative claim needs a same-session
control interleaved inside one invocation.

A comparative re-baseline is still owed and still wants a quiet machine. Eleven
May-2026 milestones are marked superseded.

---

## Workflow

Unchanged: brainstorm → spec in `docs/superpowers/specs/` → plan → subagents in
worktrees → PR with `--squash --auto`. Never commit features to main. Pre-1.0,
no backcompat aliases.

The next step for whoever picks this up is to finish the brainstorm — resolve
the `S9` question, then write the spec. Do not skip to implementation; the
`S8`/`S9` decisions above are design answers, not a plan.
