# Measure what the renderer draws beside the text

**Date:** 2026-08-13
**Status:** design approved, not yet implemented
**Follows:** `2026-08-13-estimator-real-inputs-design.md` (Phase A #363, Phase B #367) and the
residual diagnosis in PR #370.

## Problem

Six merged PRs took the row-height estimator from 11.52px mean error to 3.083px and from
37/48 to 48/48 line counts. One systematic residual remains and is now the dominant term:
with the learned floor disabled, **43 of 48 rows under-estimate and none over-estimates**.

PR #370 decomposed it against 48 real Chromium-measured rows:

| Term                                                                       | px       | Share | Rows |
| -------------------------------------------------------------------------- | -------- | ----- | ---- |
| Inline `render` output pushes an extra line the estimator cannot see       | **−236** | 55%   | 12   |
| Row height decided by a different cell (what the learned floor exists for) | −165     | 38%   | 11   |
| Per-line arithmetic, with the line count already correct                   | −31      | 7%    | 31   |

Two separate defects, one instrument, and they interact — so they are designed together.

### Defect 1: the estimator cannot see inline render output

The hero's analyst column renders its text followed by an inline stance badge (`hold`,
`watch`, `trim`). The estimator reads `readCellValue(row, column)` — the raw string — so the
badge is invisible to it. The badge consumes horizontal space, which pushes text onto an extra
line, which is a whole 21px line box the estimate misses. Twelve rows, 236px.

This is **not** what the learned floor covers. The floor is a height term binding on rows
whose tallest cell is a renderer; this is a _width_ term reaching multi-line rows through the
line count. That distinction is why an earlier reading of this residual — that custom
renderers could not explain under-estimation on multi-line rows — was wrong.

### Defect 2: line height is read from the wrong element

`getThemeBoxMetrics()` reads `line-height` from the cell. The hero's text is laid out by an
inner span with `.analyst { line-height: 1.45 }` — **20.3px** at 14px, not the 21px the cell
reports — and the cell is `display: flex`, so that span governs its own line boxes.

The diagnosis derived the true advance without assuming it. `measureRenderedRowHeight` applies
`Math.ceil`, so from measured heights of 68 / 89 / 109 at 2 / 3 / 4 lines:

```
42 < a + B ≤ 43      63 < 2a + B ≤ 64      83 < 3a + B ≤ 84   ⟹   20 < a < 21
```

20.3 sits in that interval, and reproduces 67.8→68, 88.1→89, 108.4→109.

## Design

**Read what is readable, measure what is measurable, learn only what is unobservable** — the
principle Phase A adopted, applied to both defects.

### Render advance: measure the rendered cell

For a wrapped column, measure once what the cell's **non-text inline content** occupies, and
deduct it from the wrap width alongside the padding deduction Phase A added.

- No public API. A consumer with a custom renderer should not have to hand-compute a pixel
  value the browser already knows — that was the decisive argument against a declared
  `renderAdvancePx` on the column definition.
- Cached per column, invalidated through the theme signal built in #365. The infrastructure
  exists; this adds a consumer, not a mechanism.
- Deliberately **not learned**. It is derivable by inference — the diagnosis recovered the
  badge advance from horizontal slack alone, `(58.61, 64.82] px` — but every learned term in
  this series has absorbed unrelated error and masked another defect. That is the pattern the
  last four PRs have been unwinding.

**The open risk, stated:** identifying "non-text content" generically. The hero's shape is a
text node plus a trailing element, which is the common case and is measurable directly. Renders
that wrap everything in one element, or nest text among several, are harder. The
implementation must define precisely what it measures, and where the definition does not apply
it must yield _nothing_ and leave today's behaviour — never a guess.

### Line height: read it from the element that lays out the text

Resolve `line-height` from the deepest element actually laying out the wrapped text rather
than from the cell. An earlier design doc lists adding a `--pretable-line-height-cell` token as
an open question that was never actioned; a token is the alternative, but it describes what the
theme _intends_ rather than what a consumer's own CSS does, and consumers style these spans.

## Verification

The instruments exist. Current state to beat:

|                                     | value                       |
| ----------------------------------- | --------------------------- |
| line counts                         | 48/48                       |
| mean error                          | 3.083px                     |
| signed extent error, floor disabled | −11.65%                     |
| directional split, floor disabled   | 0 over / 43 under / 5 exact |

- **Gate:** mean error below 3.083px **and** line counts at 48/48 or better. Record a
  prediction before running — this series has been wrong three times about where the error
  lives, and right once, and the difference was writing it down first.
- **The real signal is the directional split.** If these fixes work, under-estimation should
  fall well below 43 of 48. A mean that improves while the split stays one-sided would mean
  something is still absorbing error rather than modelling it.
- **The floor must be re-decided afterwards.** It currently "wins" as a max only because it is
  biased high against these under-estimates. Fixing them unmasks that bias, so
  `row-height-bias.test.ts` must be re-run and max-vs-mean re-made — for the third time, and
  the first on honest numbers.
- **Safety property, unchanged:** with no canvas and no theme, estimates stay byte-identical.
  The two pre-existing estimator tests pin it and must pass unedited.
- **Bench no-regression** and `app-bench` at 128/128; the latter is where a per-estimate DOM
  read broke CI earlier in this series, and this design adds another measured term.

## Out of scope

The learned floor's own policy. It is re-decided _after_ these land, on the numbers they
produce, not as part of this change.
