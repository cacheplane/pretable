---
"@pretable/react": patch
---

Row height estimates no longer over-charge runs of consecutive whitespace.

The estimator predicts a wrapped cell's line count without a DOM, and it charged
a run of spaces its full width. Browsers under `white-space: normal` collapse
such a run to a single space — inline `"a  a"` measures 3 character advances,
not 4, in Chromium, WebKit and Firefox alike — so text with double spaces was
predicted wider, and therefore taller, than it renders.

A run of whitespace is now charged one grapheme however long it is, on both of
the estimator's wrapping paths: the average-character-width path and the
measured-segment one. A run of tabs collapses with the spaces around it, since
the tokenizer takes any non-newline whitespace run as a single token. Leading
runs are still dropped entirely, and `\n` still breaks the line.

`nowrap` and `pre-wrap` are unaffected. `pre-wrap` preserves runs deliberately —
that is its measured browser behaviour — and its intrinsic width still counts
every grapheme.
