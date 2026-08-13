# Render Advance and Line-Height Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the estimator's last systematic residual — inline `render` output it cannot see (55%), and line height read from the wrong element (7%).

**Architecture:** Both terms are measurable, so neither is declared on the column definition nor learned from measurements. `packages/react` measures them from a rendered cell once per theme, through the caching and invalidation built in #365, and threads them to the estimator alongside the existing box metrics and segment measurer.

**Tech Stack:** TypeScript, Vitest, Playwright, canvas `measureText`.

**Spec:** `docs/superpowers/specs/2026-08-13-estimator-render-advance-design.md`

**Branch:** `blove/estimator-residual-diagnosis` carries the diagnostic (PR #370). Branch this work off `main` once that merges.

---

## A note on this plan's form

Like the Phase B plan, this specifies **contracts, invariants and tests** rather than literal code. Every task in Phase B found something the plan had wrong — a missed code site, a false premise about `wrap` collapsing spaces, a browser rule that had to be probed. **Where this plan contradicts the code, the code wins; report the contradiction.**

---

## Context

The estimator predicts a row's height before it renders. Six merged PRs took mean error from 11.52px to **3.083px** and line counts to **48/48**.

PR #370 decomposed what remains, against 48 real Chromium-measured hero rows with the learned floor disabled (**43 of 48 under-estimate, 0 over**):

| Term | px | Share |
| --- | --- | --- |
| Inline `render` output pushes an extra line | **−236** | 55% |
| Row decided by a different cell (the floor's job) | −165 | 38% |
| Per-line arithmetic, line count already correct | −31 | 7% |

**Defect 1.** The analyst column renders text plus a trailing stance badge. The estimator reads the raw string, so the badge is invisible — yet it consumes width, pushing text onto an extra 21px line.

**Defect 2.** `getThemeBoxMetrics()` reads `line-height` from the **cell**; the text is laid out by an inner span with `.analyst { line-height: 1.45 }` = **20.3px**, and the cell is `display: flex` so that span governs its own line boxes. The diagnosis derived `20 < a < 21` from `Math.ceil` constraints without assuming it.

**Existing infrastructure to reuse, not duplicate:**
- One shared measuring context in `packages/react/src/text-metrics.ts` (`OffscreenCanvas`, then detached `<canvas>`, host incapability cached).
- One shared `MutationObserver` in `density.ts` watching `data-theme` / `data-density`, which **marks caches stale rather than clearing them** — the DOM read defers to the next estimate, so there is no per-estimate read.
- `resolveGridTextStyle()` already does one `querySelector` + `getComputedStyle` per theme change and feeds font, letter-spacing and sample text to three consumers.

**The performance constraint.** An earlier change broke CI with a per-estimate DOM read: 679ms of a 1187ms bench test under jsdom. `pnpm --filter @pretable/app-bench test` must stay at **128/128**.

---

## Task 1: Line height from the element that lays out the text

**Files:** `packages/react/src/density.ts` and its tests.

- [ ] **Determine the rule, do not assume it.** `getThemeBoxMetrics` currently reads `line-height` from the cell. The wrapped text may be laid out by a descendant. Read the code and the hero's DOM, and decide precisely which element to resolve from — the deepest element containing the wrapped text, or the cell when there is no such descendant. **State the rule you chose and why.**
- [ ] Verify against the hero in a real browser that your rule yields **20.3px**, not 21px, for the analyst column. Delete the probe afterwards.
- [ ] Test: a cell whose inner span carries a different `line-height` resolves the span's value; a cell with no such descendant resolves the cell's; neither case does an extra DOM read per estimate.
- [ ] **The safety property:** with no theme, the fallback stays `ROW_LINE_HEIGHT` (24). Phase A derived the padding-Y fallback as `(ROW_CHROME_HEIGHT − border) / 2` so `2 × paddingY + border === 42` holds by construction — **do not disturb that arithmetic.**
- [ ] Mutation-check every guard. Commit.

Note the accuracy instrument passes `HERO_ROW_BOX_METRICS` from the fixture rather than resolving live, so its numbers will not move until Task 3 updates that fixture value. Say so rather than reporting "no change" as a surprise.

---

## Task 2: Measure the render advance

**Files:** `packages/react/src/text-metrics.ts`, `pretable-model.ts`, `packages/renderer-dom/src/*`, tests.

The risky task. Read the spec's "open risk" section before starting.

- [ ] **Define precisely what is measurable.** For a wrapped column's rendered cell, the advance is the horizontal space occupied by content that is *not* the wrapped text — in the hero, a trailing badge element beside a text node. Arbitrary `render` output does not always decompose that way.

  **Where your definition does not apply, yield nothing and leave today's behaviour.** Never guess. A conservative miss keeps the failure mode at "no worse than now"; a guess reintroduces exactly the confidently-wrong behaviour this series has spent six PRs unwinding.

  State your definition, what it covers, and what it declines to handle.

- [ ] Measure once per column, through `resolveGridTextStyle`'s existing per-theme read. **Do not add a second `querySelector` sweep, a second canvas, or a second observer.**
- [ ] Deduct the advance from the wrap width alongside Phase A's `2 × paddingX`, and **clamp**: `Math.max(1, columnWidth − 2 × paddingX − advance)`. A wide badge in a narrow column must not produce a zero or negative wrap width.
- [ ] The advance applies to the **last line only** in a browser's layout, since that is where the inline element sits. Decide whether to model that or to charge it to every line, **verify which matches the browser**, and say what you found. This is the detail most likely to be wrong, and it is cheaply checkable.
- [ ] Join the estimate memo key. A previous task in this series shipped a memo bug of this exact shape. **Write a test that fails when it is dropped from each cache branch, and show it failing.**
- [ ] Assert no per-estimate DOM read and no growth in `measureText` calls across repeated estimates. Run `app-bench` — 128/128.
- [ ] Mutation-check. Commit.

---

## Task 3: Gate, floor re-decision, PR

- [ ] **Record a prediction first**, in the commit message or PR draft: what you expect the line counts, mean error, and the directional split to do, and why. This series was wrong three times and right once; the difference was writing it down beforehand.

- [ ] Update `HERO_ROW_BOX_METRICS` in `row-height-accuracy.fixture.ts` to the corrected line height, captured from the browser with the same provenance discipline as the existing values. Then run both instruments.

| Observation | Verdict |
| --- | --- |
| Mean error below 3.083px **and** line counts ≥ 48/48 | **PASS** |
| Line counts drop | **STOP and report** |
| Mean improves but the split stays ~43/48 one-sided | **Report plainly** — something is still absorbing error rather than modelling it |

**The directional split is the real signal**, not the mean. Under-estimation should fall well below 43 of 48.

- [ ] **Re-decide the floor.** It currently wins as a `max` only because it is biased high against these under-estimates; fixing them unmasks that. Re-run `row-height-bias.test.ts` for max vs mean across both paths and report. **If the mean now wins, say so** — that would be the third time this decision has been revisited and the first on honest numbers. Do not change the floor in this PR; report the number and let it be decided.

- [ ] **State the evidence's limit in the PR.** The fixture is 48 rows from **one** column with **one** render shape (text + trailing chip). It can show the fix works for that shape; it cannot show the heuristic generalises. Say so rather than letting the fixture imply more than it knows.

- [ ] Bench no-regression (baseline runset `2026-08-13t04-27-03-476z`: S1 1, S2 4, S3 1, S7 4). **Isolate the port** — a bench run whose port is held by a parallel session silently measures another worktree's build:

```bash
PRETABLE_BENCH_EXTERNAL_SERVER=1 PRETABLE_BENCH_BASE_URL=http://127.0.0.1:4187 pnpm bench:matrix --adapters=pretable --scenarios=S1,S2,S3,S7 --scripts=initial,scroll --scale=dev
```

- [ ] Hero symptom check, `e2e/smoke.spec.ts`, all four suites, changeset (`@pretable/react`, `patch`), `pnpm typecheck && pnpm lint && pnpm format`, then `pnpm build && pnpm api:check` in that order.
- [ ] Check `main` for drift; parallel sessions land PRs here constantly. Rebase and re-run if it moved.
- [ ] Open the PR leading with the gate numbers, the directional split, the floor finding, and whether your prediction held. **Do not merge.**

---

## Out of scope

The floor's policy. Task 3 produces the number; changing it is a separate decision.
