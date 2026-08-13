# Phase B — Segment-Measured Text Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop modelling a font as one number. Wrap text by real measured segment widths, so the estimator's line counts stop depending on how average a string's characters happen to be.

**Architecture:** `@pretable-internal/text-core` gains an **optional** measurer. Given one, `prepareText` measures each token once and `layoutPreparedText` wraps by accumulated pixel width; without one, both behave exactly as today. `packages/react` supplies a canvas-backed measurer with a `(segment, font)` cache. SSR and jsdom keep the average-width path.

**Tech Stack:** TypeScript, Vitest, canvas `measureText`.

**Spec:** `docs/superpowers/specs/2026-08-13-estimator-real-inputs-design.md`, Phase B.

**Branch:** create `blove/phase-b-segment-text` off `main` after #365 and the bias instrument land.

---

## A note on this plan's form

Earlier plans in this series specified literal code. Three times the code I wrote was wrong in ways the implementer caught — a vacuous test string, a fallback that would have broken a safety property, a snippet that contradicted its own test. For a refactor this size, spelling out every line would multiply that risk rather than reduce it.

So this plan specifies **contracts, invariants, and tests precisely**, and leaves the implementation to the engineer, who can read the actual files. Where a specific value or shape matters, it is stated exactly. **Where you find this plan contradicts the code, the code wins — report the contradiction.**

---

## Context

`text-core` is a font-metrics-free text layout predictor. `prepareText({ text, fontKey, averageCharWidth })` normalizes and tokenizes into `word` / `space` / `newline` tokens; `layoutPreparedText(prepared, width, { lineHeightPx, wrapMode })` computes `charsPerLine = floor(width / averageCharWidth)` and wraps tokens by **character count**.

Its wrapping algorithm is good — token-aware, honours explicit newlines. **The weak part is that its whole model of a font is one number.** Phase A measured a real average (6.505px for the hero) and got line counts to 47/48, but a uniform average cannot be right for text whose character mix is unusual: all-caps, digit-heavy, CJK, emoji.

There is also a measured, unexplained residual: with padding correctly deducted, the *old* 7px guess scores a better mean height error (2.646px) than the correct 6.505px measurement (3.500px), because over-wide characters compensate a ~1px-per-line shortfall elsewhere. On line count — which cannot cancel — the measurement wins 47 to 41. **That residual is this phase's subject.** Expect it to move; if it does not, say so.

**Current instrument state:** 47/48 line counts, 3.5px mean error (`row-height-accuracy.test.ts`).

**Attribution.** The two-phase design — measure segments once, cache by `(segment, font)`, then wrap with pure arithmetic — is from `@chenglou/pretext` (MIT, © Pretext contributors), cloned at `~/repos/pretext` for reference. This is our own implementation against a different API, so attribution is courtesy rather than licence obligation. It goes in `LICENSE` regardless, in Task 6. **If you find yourself closely adapting a block rather than writing your own, mark that file and carry pretext's copyright line into it** — that flips the obligation from courtesy to licence, and the honest move is to comply rather than to paraphrase around it.

**Non-negotiable invariant, every task:** with no measurer supplied, every output is **byte-identical** to today. `text-core`'s existing tests and the two protected estimator tests in `indexed-renderer.test.ts` pin this and must pass unedited.

**Commands:**

```bash
pnpm --filter @pretable-internal/text-core test
```

```bash
pnpm --filter @pretable-internal/renderer-dom test && pnpm --filter @pretable/react test && pnpm --filter @pretable/app-bench test
```

`app-bench` must stay at 128/128 — an earlier change in this series broke CI with a per-estimate DOM read. Never run `git stash`.

---

## Task 1: Grapheme segmentation

**Files:** `packages/text-core/src/prepare-text.ts`, its tests.

`graphemeCount` and the breakpoint scan currently use `Array.from(text)` — code points, not graphemes. A family emoji or a combining sequence counts several times over.

- [ ] Write failing tests: a combining-mark string and a ZWJ emoji sequence each count as the expected number of user-perceived characters.
- [ ] Implement with `Intl.Segmenter` (`granularity: "grapheme"`), memoizing the segmenter at module scope — constructing one per call is expensive.
- [ ] Fall back to `Array.from` where `Intl.Segmenter` is unavailable, and test that path.
- [ ] Mutation-check each test.
- [ ] Confirm the existing `text-core` suite passes unedited, then commit.

Note this changes counts for non-ASCII text **on the average-width path too**. That is a correctness fix, not a violation of the invariant — but if any existing test moves, stop and report rather than editing it.

---

## Task 2: The injectable measurer

**Files:** `packages/text-core/src/types.ts`, `prepare-text.ts`, `layout-text.ts`, tests.

The core change.

**Contract:**

- `PrepareTextInput` gains `measureSegment?: (segment: string) => number` — returns the advance width of a segment in px, in the caller's font. The caller owns the font; `text-core` never sees one.
- When supplied, `prepareText` measures **each token once** and stores the widths on `PreparedText`. Tokens repeat heavily across grid rows, so the caller's cache is what makes this cheap — but `prepareText` must not measure the same token twice within one call either.
- `layoutPreparedText` wraps by **accumulated pixel width** against the available width when token widths are present, and by `charsPerLine` when they are not.
- `measuredWidth` becomes a real measurement rather than `maxLineChars × averageCharWidth` on the measured path.

**Invariants to test:**

- No measurer → byte-identical output to today, on every existing test case.
- A measurer returning exactly `averageCharWidth × graphemeCount` → the same line count as the average path. This is the bridge test: it proves the two paths agree when the inputs agree, and it fails loudly if the px path has an off-by-one in its accumulation.
- A token wider than the available width still occupies its own line and does not loop forever.
- Zero and negative available widths are clamped, not divided by.

Mutation-check each invariant. Commit.

---

## Task 3: `letter-spacing`

**Files:** `packages/text-core/src/*`, tests.

- [ ] `PrepareTextInput` gains `letterSpacingPx?: number`, matching CSS `letter-spacing` in px (CSS applies it after every grapheme, including the last — verify against a real browser rather than assuming, and record what you found).
- [ ] Applies on **both** paths: the measured path adds `letterSpacingPx × graphemeCount` per token; the average path folds it into the effective character width.
- [ ] Test a non-zero value changes the line count in the direction CSS does; test zero and `undefined` are byte-identical to today.
- [ ] Mutation-check, commit.

---

## Task 4: `white-space: pre-wrap`

**Files:** `packages/text-core/src/*`, tests.

`layoutPreparedText` already takes `wrapMode: "wrap" | "nowrap"`.

- [ ] Add a `pre-wrap` mode: runs of spaces are preserved rather than collapsed, `\n` forces a break, and a trailing space at a wrap point still occupies width.
- [ ] Test against the specific cases that differ from `wrap`: leading spaces on a line, a run of several spaces mid-text, and a trailing space before a forced break.
- [ ] `wrap` and `nowrap` behaviour must be untouched — pin it.
- [ ] Mutation-check, commit.

---

## Task 5: The canvas-backed measurer in React

**Files:** `packages/react/src/text-metrics.ts`, `pretable-model.ts`, `packages/renderer-dom/src/*`, tests.

- [ ] Implement `measureSegment(segment, font)` over the shared measuring context already in `text-metrics.ts` (it prefers `OffscreenCanvas`, falls back to a detached `<canvas>`, and caches host incapability — reuse all of that, do not add a second context).
- [ ] Cache by `(segment, font)`. A `Map<font, Map<segment, number>>` mirrors what the existing width cache does. **Bound it** — grid text is unbounded in principle — and say what policy you chose and why.
- [ ] Invalidate on theme change through the **same signal** #365 added to `density.ts` (a shared `MutationObserver` on `documentElement` watching `data-theme` / `data-density`, which marks caches stale rather than clearing them). Do not add a second observer.
- [ ] Thread the measurer to `estimateDomRowHeight` and `predictRowLineCount` alongside the existing `averageCharWidthPx` and `boxMetrics`, and into the estimate memo key — a changed measurer must invalidate memoized estimates. **A previous task in this series shipped a memo bug of exactly this shape; write a test that fails when it is dropped from each cache branch.**
- [ ] **No per-estimate DOM read, and no per-estimate uncached measurement.** Assert it: repeated estimates over the same content must not grow the `measureText` call count. `app-bench` at 128/128 is the backstop.
- [ ] Commit.

---

## Task 6: Gate, attribution, PR

- [ ] **Record a prediction before running.** Write down, in the PR draft or the commit message, what you expect to happen to the 47/48 line counts and the 3.5px mean error, and why. Then run:

```bash
pnpm --filter @pretable-internal/renderer-dom exec vitest run src/__tests__/row-height-accuracy.test.ts
```

| Observation | Verdict |
| --- | --- |
| Line counts ≥ 47/48 **and** mean error below 3.5px | **PASS** |
| Line counts drop below 47/48 | **STOP and report** — segment measurement should not be worse than a good average |
| Mean error unchanged | **Report it plainly.** It would mean the ~1px-per-line residual is not character-mix error, which is a real finding and redirects the next round. |

Do not tune the fixture or the assertions. Two designs in this series were stopped by their own gates, and both times that was the right outcome.

- [ ] Also report the bias figures from `row-height-bias.test.ts` before and after, if that instrument has landed by then.

- [ ] **Attribution.** Add an acknowledgements section to `LICENSE`, after the MIT text, crediting `@chenglou/pretext` (MIT, © Pretext contributors, https://github.com/chenglou/pretext) for the segment-measurement design. If any file ended up closely adapted, mark it in-file and carry the copyright line.

- [ ] Bench no-regression: `pnpm bench:matrix --adapters=pretable --scenarios=S1,S2,S3,S7 --scripts=initial,scroll --scale=dev`. Baseline runset `2026-08-13t04-27-03-476z`: S1 1, S2 4, S3 1, S7 4. A rise is disqualifying.

- [ ] Hero symptom check, `e2e/smoke.spec.ts`, full suites, changeset (`@pretable/react`, `patch`), `pnpm typecheck && pnpm lint && pnpm format`, then `pnpm build && pnpm api:check` in that order.

- [ ] Check `main` for drift and rebase if needed. Open the PR leading with the gate numbers and the prediction you recorded beforehand — including whether it was right. **Do not merge.**

---

## Out of scope

Emoji presentation correction and per-engine fit policies. Pretext carries those alongside a per-browser accuracy corpus that validates them; reimplementing that tier without the corpus ships complexity without evidence. If the gate shows we need it, taking the dependency is the honest move — revisit that decision with the number in hand rather than on principle.
