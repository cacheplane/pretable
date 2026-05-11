# Pretable `scroll-with-render` Perf Diagnostic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Diagnose whether pretable's `scroll-with-render` 6 ms gap (vs format / heavy-render) from PR #130 is real or a low-sample artifact. Mirror PR #124's three-phase pattern. Output is a research memo + raw evidence — no code changes.

**Architecture:** Per the spec at `docs/superpowers/specs/2026-05-11-pretable-scroll-with-render-perf-diagnostic-design.md`. Single PR on `pretable-scroll-with-render-perf-diag`; auto-merge if memo verdict is "noise"; hold for review if "real, hypothesis: X".

**Tech Stack:** Existing matrix runner. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-05-11-pretable-scroll-with-render-perf-diagnostic-design.md`](../specs/2026-05-11-pretable-scroll-with-render-perf-diagnostic-design.md)

**Working directory:** `/Users/blove/repos/pretable/.worktrees/pretable-scroll-with-render-perf-diag`.

---

## File Structure

```
status/milestones/
└── 2026-05-11-pretable-cell-renderer-high-repeat.json   (NEW Phase A)

status/traces/                                          (NEW only if Phase B fires)
├── 2026-05-11-pretable-scroll-with-format.trace.zip
├── 2026-05-11-pretable-scroll-with-render.trace.zip
└── 2026-05-11-pretable-scroll-with-heavy-render.trace.zip

docs/research/
└── 2026-05-11-pretable-scroll-with-render-perf-diagnostic.md   (NEW Phase C — the memo)
```

No source code, package, or test files modified.

---

## Pre-flight

- [ ] **0.1** Confirm PR #130 and #131 are merged to main (they should be; the worktree is off `origin/main`).
- [ ] **0.2** Confirm machine is idle for bench fairness. Quit anything heavy. Document any unavoidable background load in the memo.
- [ ] **0.3** Build the harness:
  ```
  pnpm --filter @pretable/app-bench build
  ```

---

## Phase A — High-repeat re-run

### Task 1 — Run the matrix

- [ ] **1.1** Run the matrix at n=20:

  ```
  pnpm bench:matrix \
    --project=chromium \
    --adapters=pretable \
    --scenarios=S2 \
    --scripts=scroll-with-format,scroll-with-render,scroll-with-heavy-render \
    --scale=hypothesis \
    --repeats=20
  ```

  Expected wall-clock: 8–12 min. Output per-run summaries land under `status/`; the matrix runner writes a runset under `status/runsets/<id>/`.

- [ ] **1.2** Note the runset id from the output.

- [ ] **1.3** Locate the per-run summary files:

  ```
  ls status/chromium-pretable-default-s2-hypothesis-scroll-with-*-2026-05-11*.summary.json | wc -l
  ```

  Expected: 60 files (3 scripts × 20 repeats).

### Task 2 — Aggregate stats

- [ ] **2.1** Build the aggregator + write the milestone file using a one-shot Node script. Use `--input-type=module`:

  ```bash
  node --input-type=module <<'EOF'
  import { readdir, readFile, writeFile } from "node:fs/promises";
  import { join } from "node:path";

  const SCRIPTS = ["scroll-with-format", "scroll-with-render", "scroll-with-heavy-render"];
  const STATUS_DIR = "status";
  const OUT_PATH = "status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json";
  const files = await readdir(STATUS_DIR);

  function stats(xs) {
    const n = xs.length;
    if (n === 0) return { n: 0 };
    const mean = xs.reduce((a, b) => a + b, 0) / n;
    const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    const sd = Math.sqrt(variance);
    const sorted = [...xs].sort((a, b) => a - b);
    const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return {
      n,
      mean: +mean.toFixed(3),
      sd: +sd.toFixed(3),
      min: Math.min(...xs),
      median,
      max: Math.max(...xs),
      samples: xs,
    };
  }

  const perScript = [];
  for (const script of SCRIPTS) {
    const matching = files.filter(
      (f) =>
        f.startsWith(`chromium-pretable-default-s2-hypothesis-${script}-2026-05-11`) &&
        f.endsWith(".summary.json"),
    );
    const samples = [];
    for (const f of matching) {
      const data = JSON.parse(await readFile(join(STATUS_DIR, f), "utf8"));
      const p95 = data.metrics?.scroll_frame_p95_ms;
      if (typeof p95 === "number" && Number.isFinite(p95)) samples.push(p95);
    }
    perScript.push({ scriptName: script, metric: "scroll_frame_p95_ms", ...stats(samples) });
  }

  // 2σ verdict — gap is real only when BOTH pairs pass (cheap vs format AND cheap vs heavy).
  function passes(left, right) {
    if (left.n === 0 || right.n === 0) return false;
    const gap = Math.abs(left.mean - right.mean);
    const noise = 2 * Math.max(left.sd, right.sd);
    return gap > noise;
  }

  const cheap = perScript.find((s) => s.scriptName === "scroll-with-render");
  const format = perScript.find((s) => s.scriptName === "scroll-with-format");
  const heavy = perScript.find((s) => s.scriptName === "scroll-with-heavy-render");

  const cheapVsFormat = {
    meanDiff: +(cheap.mean - format.mean).toFixed(3),
    noiseFloor: +(2 * Math.max(cheap.sd, format.sd)).toFixed(3),
    real: passes(cheap, format),
  };
  const cheapVsHeavy = {
    meanDiff: +(cheap.mean - heavy.mean).toFixed(3),
    noiseFloor: +(2 * Math.max(cheap.sd, heavy.sd)).toFixed(3),
    real: passes(cheap, heavy),
  };

  const verdict =
    cheapVsFormat.real && cheapVsHeavy.real
      ? "real-cheap-render-slower"
      : !cheapVsFormat.real && !cheapVsHeavy.real
        ? "noise"
        : "mixed";

  const out = {
    generatedAt: new Date().toISOString(),
    adapterId: "pretable",
    scenarioId: "S2",
    scale: "hypothesis",
    browserName: "chromium",
    repeats: 20,
    perScript,
    twoSigmaTest: {
      rule: "real if |mean_cheap - mean_other| > 2 * max(sd_cheap, sd_other) for both pairs",
      cheapVsFormat,
      cheapVsHeavy,
    },
    verdict,
  };

  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${OUT_PATH}`);
  console.log(JSON.stringify(out, null, 2));
  EOF
  ```

- [ ] **2.2** Inspect the output. Verify the JSON has all three scripts with n=20 finite means + σ; verdict is one of `noise`, `mixed`, or `real-cheap-render-slower`.

- [ ] **2.3** Commit:

  ```
  git add status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json
  git commit -m "chore(bench): high-repeat pretable cell-renderer milestone for scroll-with-render perf diagnostic"
  ```

### Task 3 — Branch on verdict

- [ ] **3.1** Read the verdict:

  ```
  jq -r '.verdict' status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json
  ```

  - **If `noise`** → skip Phase B (Tasks 4+5). Go to Task 6 (write a short negative-result memo).
  - **If `mixed`** → skip Phase B. Memo concludes "differential isn't clean; one pair within noise" with recommendations.
  - **If `real-cheap-render-slower`** → proceed to Phase B.

  Document the verdict you got so Task 6 can write the right memo branch.

---

## Phase B — Trace capture (conditional)

**Skip this entire phase if Task 3.1 returned `noise` or `mixed`.**

### Task 4 — Capture traces

- [ ] **4.1** Capture one Playwright trace per script using the existing bench harness. Re-use the matrix runner with `--repeats=1` per script (one fresh run per script):

  ```
  pnpm bench:matrix \
    --project=chromium \
    --adapters=pretable \
    --scenarios=S2 \
    --scripts=scroll-with-format,scroll-with-render,scroll-with-heavy-render \
    --scale=hypothesis \
    --repeats=1
  ```

  Trace files are written under `status/traces/` per the bench harness's existing wiring.

- [ ] **4.2** Identify the three newest traces:

  ```
  ls -lt status/traces/chromium-pretable-default-s2-hypothesis-scroll-with-*-2026-05-11*.trace.zip | head -3
  ```

  Copy + rename them to the spec's paths:

  ```
  cp <newest-format-trace> status/traces/2026-05-11-pretable-scroll-with-format.trace.zip
  cp <newest-render-trace> status/traces/2026-05-11-pretable-scroll-with-render.trace.zip
  cp <newest-heavy-render-trace> status/traces/2026-05-11-pretable-scroll-with-heavy-render.trace.zip
  ```

- [ ] **4.3** Verify trace zips are openable (size > 0, valid format):

  ```
  ls -lh status/traces/2026-05-11-pretable-scroll-with-*.trace.zip
  ```

  Sizes should be 2–25 MB each. If any is >25 MB, see step 4.5.

- [ ] **4.4** Verify each trace opens cleanly via:

  ```
  pnpm exec playwright show-trace status/traces/2026-05-11-pretable-scroll-with-render.trace.zip
  ```

  Quit the viewer (`q` in spawning terminal). Repeat for format + heavy-render. If any fails to open, STOP and report BLOCKED.

- [ ] **4.5** If a trace is >25 MB:
  - View it with `pnpm exec playwright show-trace`.
  - Screenshot the Performance panel showing the steady-state scroll phase.
  - Save the screenshot under `docs/research/2026-05-11-perf-diag-traces/<script>.png`.
  - Note the local trace path in the memo without committing the binary.

- [ ] **4.6** Commit:

  ```
  git add status/traces/2026-05-11-pretable-scroll-with-*.trace.zip
  git commit -m "chore(bench): Playwright traces for pretable scroll-with-render perf diagnostic"
  ```

### Task 5 — Trace analysis

- [ ] **5.1** Open the three traces side by side:

  ```
  pnpm exec playwright show-trace status/traces/2026-05-11-pretable-scroll-with-format.trace.zip
  pnpm exec playwright show-trace status/traces/2026-05-11-pretable-scroll-with-render.trace.zip
  pnpm exec playwright show-trace status/traces/2026-05-11-pretable-scroll-with-heavy-render.trace.zip
  ```

- [ ] **5.2** For each trace, identify the steady-state scroll window. The script runs for ~3 sec; skip the first ~500 ms (mount + warmup); analyze the remaining ~2.5 sec.

- [ ] **5.3** Note the 5–10 longest scripting tasks during steady-state for each script:
  - Duration (ms)
  - Function name (top of call stack)
  - File (if identifiable)

- [ ] **5.4** Compute the differential. What does cheap-render spend time on that format AND heavy-render don't? The hypothesis is in the React reconciliation or layout work for the single-text-child span. Look for:
  - Different React render branches
  - Style recalculation cost attributable to DOM shape
  - Layout/reflow work

- [ ] **5.5** Save findings to a scratch file at `/tmp/scroll-with-render-findings.md` for synthesis into the memo (Task 6). Don't commit the scratch file.

- [ ] **5.6** If you can't open traces or can't interpret them, STOP and report BLOCKED. The memo can still ship with verdict "real but cause undiagnosed; needs human-driven profiling" — don't invent findings.

---

## Phase C — Memo

### Task 6 — Write the research memo

- [ ] **6.1** Draft the memo. Replace `<placeholders>` with actual content from Tasks 2 and 5. If Phase B was skipped (verdict was `noise` or `mixed`), omit Trace findings + Hypothesis sections.

  Memo path: `docs/research/2026-05-11-pretable-scroll-with-render-perf-diagnostic.md`

  ```markdown
  # Pretable scroll-with-render perf diagnostic — 2026-05-11

  ## Summary

  <One paragraph: gap real or noise; if real, leading hypothesis. If noise/mixed, this concludes the investigation.>

  ## Context

  PR #130 captured (n=3 medians, Chromium S2/hypothesis):

  | Script                     | scroll p95 |
  | -------------------------- | ---------- |
  | `scroll-with-format`       | 10.2 ms    |
  | `scroll-with-render`       | 16.4 ms    |
  | `scroll-with-heavy-render` | 10.3 ms    |

  Heavy-render renders more DOM (296 nodes vs 164) yet measures faster than cheap-render. This memo tightens the signal at n=20 and, if warranted, profiles the cause.

  ## Method

  - Matrix: `pnpm bench:matrix --project=chromium --adapters=pretable --scenarios=S2 --scripts=scroll-with-format,scroll-with-render,scroll-with-heavy-render --scale=hypothesis --repeats=20`.
  - Hardware: <local laptop, model + chip + RAM if known>.
  - Background load disclaimer: <any unavoidable background processes during the run>.
  - Statistical test: 2σ on mean `scroll_frame_p95_ms`. Gap is "real" only when BOTH `|mean_cheap − mean_format| > 2σ` AND `|mean_cheap − mean_heavy| > 2σ`.

  ## High-repeat data

  | Script                   | n   | mean p95 (ms) | σ (ms) | min   | median | max   |
  | ------------------------ | --- | ------------- | ------ | ----- | ------ | ----- |
  | scroll-with-format       | 20  | <X.X>         | <X.X>  | <X.X> | <X.X>  | <X.X> |
  | scroll-with-render       | 20  | <X.X>         | <X.X>  | <X.X> | <X.X>  | <X.X> |
  | scroll-with-heavy-render | 20  | <X.X>         | <X.X>  | <X.X> | <X.X>  | <X.X> |

  Source: `status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json`.

  ## Statistical verdict

  - cheap vs format: mean diff = <X.X> ms; 2σ noise floor = <X.X> ms; <"real" / "within noise">.
  - cheap vs heavy: mean diff = <X.X> ms; 2σ noise floor = <X.X> ms; <"real" / "within noise">.
  - Overall: <noise / mixed / real-cheap-render-slower>.

  ## Trace findings

  (Omit this section if verdict is noise/mixed.)

  Traces committed at:

  - `status/traces/2026-05-11-pretable-scroll-with-format.trace.zip`
  - `status/traces/2026-05-11-pretable-scroll-with-render.trace.zip`
  - `status/traces/2026-05-11-pretable-scroll-with-heavy-render.trace.zip`

  ### Format hotspots

  <bulleted list>

  ### Cheap-render hotspots

  <bulleted list>

  ### Heavy-render hotspots

  <bulleted list>

  ### Differential

  <paragraph>

  ## Hypothesis for the gap

  (Omit if verdict is noise/mixed.)

  <1-3 paragraphs identifying the most likely cause.>

  ## Proposed fixes (no code in this PR)

  (Omit if verdict is noise/mixed.)

  | Option | Description                                                    | Expected delta | Risk to quality wedge |
  | ------ | -------------------------------------------------------------- | -------------- | --------------------- |
  | 1      | <e.g., "Inline the cheap-render JSX structure to match heavy"> | <delta>        | <risk>                |

  ## Verdict

  <one of:

  - "Gap is noise; n=3 cheap-render outlier was a sample artifact. No follow-up needed; recommend the bench's default repeat protocol stay at n=3 for cell-renderer scripts unless similar anomalies recur."
  - "Gap is mixed: one pair real, the other within noise. The differential isn't clean enough to act on. Recommend n=50 follow-up to settle."
  - "Gap is real and likely caused by <X>. Recommend a perf-fix PR scoped to <Y>. Estimated impact: <Z>.">
  ```

- [ ] **6.2** Sanity-check the memo:
  - Numbers in the table match `status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json`.
  - Verdict matches the JSON's `verdict` field.
  - Memo length is 500–1500 words.
  - All `<placeholder>` strings replaced with real content (or sections omitted per verdict).

- [ ] **6.3** Commit:

  ```
  git add docs/research/2026-05-11-pretable-scroll-with-render-perf-diagnostic.md
  git commit -m "docs(research): pretable scroll-with-render perf diagnostic memo

  Verdict: <noise / mixed / real>. <One-line summary.>"
  ```

---

## Repo-wide gates and PR

### Task 7 — Open the PR

- [ ] **7.1** Run gates:

  ```
  pnpm -w typecheck && pnpm -w test && pnpm -w lint && pnpm format
  ```

  Expected: all pass. No source code changes; gates are formality.

- [ ] **7.2** Push the branch:

  ```
  git push -u origin pretable-scroll-with-render-perf-diag
  ```

- [ ] **7.3** Open the PR. PR title: `docs(research): pretable scroll-with-render perf diagnostic`. Body sections: Summary, Verdict, what's NOT in this PR.

- [ ] **7.4** Auto-merge decision:
  - **Verdict was `noise`** → set auto-merge with `gh pr merge --auto --squash`. Negative-result memo; uncontroversial.
  - **Verdict was `mixed`** → set auto-merge as well; the inconclusive verdict is honest reporting.
  - **Verdict was `real-cheap-render-slower`** → HOLD for user review. The memo names a leading hypothesis about pretable's React reconciliation path; that's a project-narrative decision the user should read before it's committed as the official position.

  Surface the verdict + the auto-merge decision in your end-of-task report.

---

## Self-Review

**Spec coverage:**

| Spec section                                                              | Covered by                                           |
| ------------------------------------------------------------------------- | ---------------------------------------------------- |
| Goal: diagnose 6 ms cheap-render gap, no code changes                     | Tasks 1–6, no source files in File Structure         |
| Non-goals (no fix, no other browsers, etc.)                               | Out-of-scope notes in PR body (Task 7.3)             |
| Architecture: 3 sequential phases inside one PR                           | Phases A / B / C, conditional branch in Task 3.1     |
| Phase A: n=20 matrix command                                              | Task 1.1                                             |
| Decision threshold: 2σ on mean-of-p95, BOTH pairs must pass               | Task 2.1 (verdict computation), Task 3.1 (branching) |
| Phase B: Playwright trace capture                                         | Tasks 4–5                                            |
| Phase C: memo with template structure                                     | Task 6                                               |
| Failure modes (BLOCKED on trace failure, BLOCKED on insufficient samples) | Tasks 1.1, 3.1, 4.4, 5.6                             |
| Auto-merge policy per verdict                                             | Task 7.4                                             |

All sections covered.

**Placeholders:** memo template placeholders (`<X.X>`, `<paragraph>`, etc.) in Task 6.1 are intentional — the implementer fills them from Tasks 2 + 5. No `TBD` / `TODO` leaks.

**Type / value consistency:**

- Milestone JSON path `status/milestones/2026-05-11-pretable-cell-renderer-high-repeat.json` consistent across Tasks 2.1, 2.3, 3.1, 6.1.
- Trace paths consistent across Tasks 4.2, 4.4, 4.6, 6.1.
- Memo path consistent across Tasks 6.1, 6.3, 7.3.
- Verdict values (`noise`, `mixed`, `real-cheap-render-slower`) consistent between Task 2.1's compute and Task 3.1's branching.

**Scope check:** Single PR, three phases, conditional skip on noise/mixed verdict. Each phase produces a self-contained committable artifact. The implementer can produce a useful PR even if Phase B is BLOCKED.

---

## Notes for the implementer

- The gap is 6 ms at n=3. p95 of 20 samples is much tighter but still per-frame-noisy. Don't oversell the verdict either way.
- If Phase A says "noise," the memo is short and shippable in <1 hour total. Don't overwrite it.
- Don't touch source code under any pretext. Any optimization is a follow-up.
- Don't pin process priority or apply micro-benchmark tricks. The bench harness's existing protocol is the protocol.
- If you're tempted to run `--repeats=50` to "get tighter signal," DON'T. The plan says 20. If 20 is genuinely insufficient (σ huge), document it in the memo and recommend 50 as a follow-up — don't unilaterally escalate.
