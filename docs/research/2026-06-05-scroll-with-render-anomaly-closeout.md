# `scroll-with-render` anomaly — closed as measurement noise (n=12 non-reproduction)

**Date:** 2026-06-05
**Thread:** Residual follow-up #1 from B2 follow-up #5 (cell-renderer comparators, PR #130).
**Verdict:** No bug. The anomaly does not reproduce at higher sample counts. **No production code change.**

## What was logged

The 2026-05-10 cell-renderer milestone (PR #130, `--repeats=3`) recorded pretable's
`scroll-with-render` `scroll_frame_p95_ms` as **16.4 ms**, anomalously slow vs its
siblings `scroll-with-format` (10.2 ms) and `scroll-with-heavy-render` (10.3 ms).

The paradox that made it look real: `scroll-with-heavy-render` renders
`scroll-with-render`'s output **plus** extra DOM (a badge-dot span + a
`data-bench-status` attribute), yet measured _faster_. More work, less time.
repo-memory.md speculated a "perf cliff in the cheap-React-cellRenderer path that
the heavier path avoids — possibly a different `@pretable/react` code path that
disables on more complex render output."

## Investigation (systematic-debugging, Phase 1)

**Reproduce before theorizing.** The original number was a median of **3** repeats.
A p95 of 3 samples is effectively max-of-3 — the bench-matrix source comment says so
directly (`scripts/bench-matrix.mjs:19-20`). The lesson from B2 follow-up #1 (the
"1 ms MUI gap" that vanished at n=20, PR #124) applies exactly: borderline gaps at
low n are noise until proven otherwise.

Re-ran pretable-only, S2, hypothesis scale, **`--repeats=12`**:

```
pnpm bench:matrix --adapters=pretable --scenarios=S2 \
  --scripts=scroll,scroll-with-format,scroll-with-render,scroll-with-heavy-render \
  --scale=hypothesis --repeats=12
```

`scroll_frame_p95_ms` distribution (n=12 each, ms):

| script                     | min  | median    | mean  | max   | stdev | blank gaps |
| -------------------------- | ---- | --------- | ----- | ----- | ----- | ---------- |
| `scroll` (baseline)        | 9.70 | **10.15** | 10.10 | 10.30 | 0.20  | 0          |
| `scroll-with-format`       | 9.60 | **10.15** | 10.08 | 10.40 | 0.24  | 0          |
| `scroll-with-render`       | 9.90 | **10.20** | 10.18 | 10.40 | 0.16  | 0          |
| `scroll-with-heavy-render` | 9.90 | **10.10** | 10.13 | 10.30 | 0.12  | 0          |

**The 16.4 ms is gone.** No single one of the 12 `scroll-with-render` runs exceeded
10.4 ms. `scroll-with-render` (10.20) and `scroll-with-heavy-render` (10.10) are
statistically indistinguishable — 0.10 ms apart, inside the ~0.12–0.16 ms noise
floor. All four scripts cluster at ~10.1–10.2 ms p95, zero blank gaps, well under
the 16 ms single-frame budget.

The original 16.4 ms was one (or more) of three runs catching a slow frame
(GC pause / cache miss / OS scheduling) and dragging the max-of-3.

## Why the code agrees there was nothing to find

Independent of the measurement, the speculated mechanism doesn't exist. The
`@pretable/react` cell-content path (`packages/react/src/pretable-surface.tsx:297-303`)
is identical for both render flavors:

```tsx
function CellContentImpl({
  formattedValue,
  renderRef,
  fallbackRenderRef,
  cellRenderInput,
}) {
  if (renderRef) return <>{renderRef(cellRenderInput)}</>; // cheap AND heavy take this branch
  if (fallbackRenderRef) return <>{fallbackRenderRef(cellRenderInput)}</>;
  return <>{formattedValue}</>;
}
```

Both `scroll-with-render` and `scroll-with-heavy-render` set `column.render`, so both
hit `renderRef(cellRenderInput)`. There is no branch that "disables on complex
output." The only real difference is the DOM the render function returns — and heavy
returns _more_. A genuine cheap-only 6 ms cliff would have been architecturally
impossible here.

(`formattedValue` is also well-defined for the no-`format` render flavors:
`pretable-surface.tsx:1514-1516` falls back to `formatCellValue(value)`, so cheap
cells render real text, not empty nodes.)

## Outcome

- **Closed as noise. No production change**, mirroring B2 follow-up #1.
- The other two residuals from #5 (comparator-aware H6/H7/H8 + H19/H20/H21 evaluators;
  post-filter `result_row_count` reporting) are unaffected and remain open.
- **Process reminder reinforced:** when comparing pretable scripts against each other
  (not just the comparator-parity tight-zone the harness already guards with
  `COMPARATOR_PARITY_MIN_REPEATS = 10`), use ≥10 repeats before naming a hotspot.
  Median-of-3 milestone numbers are fine for headline tables but must not seed a perf
  investigation on their own.
