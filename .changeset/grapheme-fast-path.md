---
"@pretable/react": patch
---

Stop segmenting graphemes for text that cannot need it. Grapheme-accurate
counting made `prepareText` — which runs per wrapped cell on the row-height
estimate path — 97% segmentation by cost, charged twice per string: once for
the whole text and again per token. ASCII cannot form a multi-code-unit
grapheme cluster, so such text now counts by code-unit length and segments by
character; CRLF, the sole exception, still takes the segmenter, as does any
text carrying a character outside ASCII. On the S2 `hypothesis` scroll
benchmark this returns `scroll_frame_p95_ms` from 31.8/32.4 to 17.2/18.0 —
four 120Hz ticks per scroll step back to two — with no predicted line count
and no estimate changed.
