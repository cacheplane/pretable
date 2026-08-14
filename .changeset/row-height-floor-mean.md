---
"@pretable/react": patch
---

Learn the row-height floor as a running **mean** rather than a running max.

The floor is the one term of a row's height no stylesheet describes: what a
custom `render` contributes to rows whose wrapped text does not decide them. It
accumulated as a max, on the argument that a floor must cover the tallest such
row.

That argument was re-examined twice and upheld twice, and both times the answer
rested on a cancellation: the estimator was systematically under-estimating (43
of 48 sampled rows short, none long) and a floor biased high by construction was
offsetting it. #373 fixed the under-estimates, so the question could be answered
on its own terms for the first time. Re-measured on top of it, over the hero's
48 rows:

- **Measured path** (a host with a canvas): both policies compute the same
  63.0px floor, so per-row error and scroll extent are identical to four
  decimals — 0.2876px and −0.3724%. The choice is moot there.
- **Average path** (no canvas — what SSR and every canvas-less host estimate
  through): the mean wins both objectives at once. 2.2737px per row against the
  max's 3.0245px, and +0.9947% scroll extent against +2.2481%. It previously
  lost both.

The cost is memo churn: a max stops moving once the tallest admitted row has
been seen, while a mean shifts on every admitted measurement, and estimates are
memoized on the calibration object's identity.
