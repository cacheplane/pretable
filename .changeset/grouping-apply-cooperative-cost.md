---
"@pretable-internal/row-model": patch
---

Grouping-apply cooperative cost: per-row seal units + amortized budget clock;
fixes the #321 apply-latency regression (#500).

The cooperative grouped candidate charged one seal unit per (row × aggregated
column × population root) and consulted the budget clock once per unit. A seal
unit is now a ROW — one unit drains that row's deferred aggregate measures
across every aggregated column and both population roots — and the clock is
consulted after the first unit and then once per 32-unit stride. The 0.25ms
budget and 256-unit slice cap are untouched (grouped streaming latency is the
control).
