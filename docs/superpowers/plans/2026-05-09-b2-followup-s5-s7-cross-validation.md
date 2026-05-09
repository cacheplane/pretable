# B2 Follow-up #6 — S5 / S7 Cross-Validation Implementation Plan

**Goal:** Run the bench matrix at S5 (streaming updates) and S7 (filter-metadata scenario, scroll script only) for all four real adapters; populate H9 (S7 scroll), H13/H14/H15 (S5 updates) with real-comparator evidence.

**Architecture:** Single PR. No source-code changes — matrix run, milestone commit, repo-memory update, PR auto-merge on green.

**Tech Stack:** Existing matrix runner. No new deps.

---

## Scope

- S7/scroll × 4 adapters × 3 repeats → populates `H9` (mirror of H1 on the S7 scenario).
- S5/updates × 4 adapters × 3 repeats × 2 update rates (1000/sec, 25000/sec) → populates `H13`/`H14`/`H15`.

S7 sort/filter-text/filter-metadata stays pretable-only (gated by `validateSupportedP0aRequest`). Comparative interaction evidence is follow-up #5, not this PR.

---

## Tasks

### Task 1 — Build harness

- [ ] `pnpm --filter @pretable/app-bench build`

### Task 2 — Run matrix

- [ ] Run:

  pnpm bench:matrix --project=chromium --adapters=pretable,ag-grid,tanstack,mui --scenarios=S5,S7 --scripts=scroll,updates --scale=hypothesis --repeats=3 --update-rates=1000,25000

  Expected wall-clock: ~10–15 min (S5/scroll for all adapters, S5/updates × 2 rates × 4 adapters, S7/scroll for all adapters, S7/updates returns unsupported per existing gate).

### Task 3 — Inspect and interpret

- [ ] Read `status/runsets/<id>/hypotheses.json` and check H9, H13, H14, H15 status. Tabulate "before" (insufficient) → "after" status for the PR body.
- [ ] If anything ELSE flips status unexpectedly (e.g., H1 from satisfied → failing on S2 — but S2 isn't in this matrix so this shouldn't happen), STOP and report DONE_WITH_CONCERNS.

### Task 4 — Commit milestone

- [ ] Copy `status/runsets/<id>/hypotheses.json` to `status/milestones/2026-05-09-b2-s5-s7-cross-validation.hypotheses.json`. Original B2 milestones stay intact.

### Task 5 — Repo-memory entry

- [ ] Append a 2026-05-09 entry to `docs/research/repo-memory.md`:
  - One paragraph framing: "Cross-validation of H1's parity story on S5 + S7 scenarios."
  - Hypothesis status delta table (H9, H13, H14, H15 before → after).
  - Note that homepage streaming-row repopulation is a separate follow-up (editorial; out of scope).
  - Flag follow-up #5 (open comparator interaction scripts) as still pending.

### Task 6 — Gates + PR

- [ ] `pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format`. Expected: clean (no source changes).
- [ ] Commit, push, open PR with auto-merge (squash). Body covers: scope, hypothesis status delta, what's NOT in this PR (homepage update, follow-up #5).
