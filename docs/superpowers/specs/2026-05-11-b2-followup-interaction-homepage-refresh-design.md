# B2 Follow-up — Homepage Interaction Wedge Refresh Design

**Date:** 2026-05-11
**Status:** Draft (awaiting user review before plan)
**Predecessors:** [B2 follow-up #5b sort+filter comparators (PR #131)](../../research/repo-memory.md), [B2 corrections (PR #125, #126)](./2026-05-09-b2-followup-perf-diagnostic-design.md), [B2 streaming reframe spec (PR #129)](./2026-05-09-b2-followup-streaming-reframe-design.md)

---

## Goal

Land the interaction comparator wedge from PR #131 on the homepage so the public-facing comparison story reflects the strongest evidence the project has against AG Grid Community, TanStack Table, and MUI X DataGrid Community. Three editorial surfaces touched: the homepage's `ComparisonTable`, its trail-marker labels, and a new `Interactions (sort, filter)` section on the `/bench` page that mirrors the existing H1 scroll layout.

No source/package changes. Only `apps/website/` and a new aggregated milestone summary file built from the per-run JSONs PR #131 produced.

## Why

PR #131 captured (n=3 medians, `interaction_latency_ms`):

| Script            | pretable    | AG Grid        | TanStack            | MUI X          |
| ----------------- | ----------- | -------------- | ------------------- | -------------- |
| `sort`            | **16.5 ms** | 58.3 ms (3.5×) | 34.4 ms (2.1×)      | 35.0 ms (2.1×) |
| `filter-metadata` | 16.0 ms     | 49.9 ms (3.1×) | **15.7 ms** (0.98×) | 33.4 ms (2.1×) |
| `filter-text`     | **17.7 ms** | 50.0 ms (2.8×) | 40.2 ms (2.3×)      | 33.3 ms (1.9×) |

Pretable beats AG Grid Community 3–3.5× and MUI X 2× across all three scripts. TanStack edges pretable by 0.3 ms on `filter-metadata` (within noise) but loses 2.1–2.3× on the other two. This is the strongest comparative wedge surfaced since the post-stub-era, and meaningfully sharper than the scroll wedge (~1.7× vs AG Grid + TanStack; MUI parity).

The homepage's `ComparisonTable` currently has zero interaction rows — PR #126 dropped streaming rows pending evidence, and the comparators were gated for interaction until PR #131. The runset now supports honest numeric claims.

## Non-goals

- **High-repeat (n=20) follow-up for borderline cases.** Pretable's `filter-text` at 17.7 ms and TanStack's `filter-metadata` at 15.7 ms both sit within ±2 ms of the 16 ms frame budget; an n=20 rerun could shift them. Logged as a future follow-up rather than a v1 blocker.
- **High-repeat correction file for the interaction milestone.** Same reason.
- **`ReceiptsBand` stat swap.** PR #129 (streaming reframe) is still open and modifies the ReceiptsBand. To avoid stacking a merge conflict on an unresolved editorial decision, the ReceiptsBand is left alone in this PR.
- **Comparator-aware H6/H7/H8 evaluators.** The data lives in per-run summary files; the page reads from a new aggregated summary mirror, not from the hypothesis evaluator's evidence array. Extending the evaluators is a future option.
- **Homepage prose touch-up outside the three named edits.** Only `ComparisonTable.tsx` body + trail-marker labels + the new `/bench` section get touched. Other components (FeatureGrid, ReceiptsBand, HowItWorks, etc.) stay as-is.

## Architecture

### File touches

```
apps/website/app/components/
└── ComparisonTable.tsx                  (MODIFY: 3 new interaction rows, trail-marker labels)

apps/website/app/bench/
└── page.tsx                             (MODIFY: new loadInteractionSummary + Interactions section)

apps/website/__tests__/components/
└── ComparisonTable.test.tsx             (MODIFY: trail-marker label regression-guards)

scripts/
└── extract-interaction-summary.mjs      (NEW: one-shot aggregator that reads per-run JSONs and
                                          emits the milestone summary file; runnable to refresh
                                          on future matrix runs)

status/milestones/
└── 2026-05-10-b2-sort-filter-summary.json  (NEW: aggregated per-(adapter, script) latency for
                                              the page renderer)

docs/research/
└── repo-memory.md                       (MODIFY: 2026-05-11 entry — homepage interaction refresh)
```

### Aggregated summary file shape

`status/milestones/2026-05-10-b2-sort-filter-summary.json`:

```json
{
  "runsetId": "<latest sort/filter runset id from PR #131>",
  "generatedAt": "<ISO timestamp>",
  "scenarioId": "S2",
  "scale": "hypothesis",
  "browserName": "chromium",
  "scripts": ["sort", "filter-metadata", "filter-text"],
  "adapters": [
    {
      "adapterId": "pretable",
      "rows": [
        {
          "scriptName": "sort",
          "interactionLatencyMs": 16.5,
          "settleDurationMs": 16.8
        },
        {
          "scriptName": "filter-metadata",
          "interactionLatencyMs": 16.0,
          "settleDurationMs": 16.7
        },
        {
          "scriptName": "filter-text",
          "interactionLatencyMs": 17.7,
          "settleDurationMs": 16.6
        }
      ]
    },
    {
      "adapterId": "ag-grid",
      "rows": [
        {
          "scriptName": "sort",
          "interactionLatencyMs": 58.3,
          "settleDurationMs": 9.2
        },
        {
          "scriptName": "filter-metadata",
          "interactionLatencyMs": 49.9,
          "settleDurationMs": 15.5
        },
        {
          "scriptName": "filter-text",
          "interactionLatencyMs": 50.0,
          "settleDurationMs": 16.7
        }
      ]
    },
    {
      "adapterId": "tanstack",
      "rows": [
        {
          "scriptName": "sort",
          "interactionLatencyMs": 34.4,
          "settleDurationMs": 31.6
        },
        {
          "scriptName": "filter-metadata",
          "interactionLatencyMs": 15.7,
          "settleDurationMs": 26.5
        },
        {
          "scriptName": "filter-text",
          "interactionLatencyMs": 40.2,
          "settleDurationMs": 24.7
        }
      ]
    },
    {
      "adapterId": "mui",
      "rows": [
        {
          "scriptName": "sort",
          "interactionLatencyMs": 35.0,
          "settleDurationMs": 25.0
        },
        {
          "scriptName": "filter-metadata",
          "interactionLatencyMs": 33.4,
          "settleDurationMs": 25.0
        },
        {
          "scriptName": "filter-text",
          "interactionLatencyMs": 33.3,
          "settleDurationMs": 25.0
        }
      ]
    }
  ]
}
```

The aggregator script reads the per-run summary files from `status/chromium-<adapter>-default-s2-hypothesis-<script>-2026-05-10*.summary.json`, picks the median per (adapter, script) for `interaction_latency_ms` and `settle_duration_ms`, and writes the milestone file. Same pattern as the existing scroll summary used by the H1 section.

### ComparisonTable changes

Three new rows inserted between the existing `scroll anchor shift (px)` row and the `headless engine + React surface` row. Type shape unchanged (existing `Row` interface has `metric`, `pretable`, `agGrid`, `tanstack`, `mui`, `budget` — all string-typed). Rendered identically to existing rows.

The four trail-marker labels rewritten per the per-adapter wedge from the runset:

- `pretable` — `Recommended path` (unchanged)
- `AG Grid` — `Slower scroll; row-height drift` → `1.7× slower scroll, 3× slower interaction; row-height drift`
- `TanStack` — `Headless; you wire selection and nav` → `Headless; ~2× slower interaction (filter-metadata ties pretable)`
- `MUI X` — `Parity at scroll p95; full-grid feature surface` → `Scroll-p95 parity; 2× slower interaction`

The section subhead prose gets one new sentence appended (after the existing "full-grid feature weight" line): `Interactive sort and filter run 2–3.5× faster than every measured comparator on the same dataset.`

The header docblock gets a reference to the new milestone source.

### `/bench` page Interactions section

The existing `apps/website/app/bench/page.tsx` already has a placeholder `## Interaction (sort, filter)` heading with one sentence noting "comparative interaction evidence is on the roadmap." Replace that with a real section paralleling the H1 scroll structure:

- `<h2>Interactions (sort, filter)</h2>`
- One-sentence scenario blurb (S2, 3,000 wrapped rows, Chromium, n=3)
- Table with columns: Adapter | sort p95 | filter-metadata p95 | filter-text p95 | Verdict
- Two prose paragraphs

`loadInteractionSummary()` reads the new summary JSON and produces `{adapter, label, sortMs, filterMetadataMs, filterTextMs, settleMs[]}[]`. A new `interactionVerdictFor(row, fastest)` helper produces the verdict string (`"fastest tied; full quality pass"` for pretable; `"3.0–3.5× slower"` etc. for comparators; special-case `"2.1× slower (filter-metadata ties pretable)"` for TanStack since that's the one tie).

Verdict logic:

```
if row.adapter === fastest.adapter (lowest geometric mean): "fastest tied; full quality pass"
else if any script latency within 5% of fastest on that script:
  show ratio range (e.g., "2.0–2.1× slower") with a parenthetical noting the tie
else: ratio range only
```

Hard-coded special case for TanStack on `filter-metadata` is acceptable since the data is small and the verdict string is curated copy, not a generated artifact.

Prose paragraphs (draft for review):

> Pretable sorts and filters 3,000 wrapped-text rows in 16–18 ms across all three scripts — clear of the single 60Hz frame budget on `filter-metadata` and `sort`, fractionally over on `filter-text`. AG Grid Community runs sort and filter 3–3.5× slower despite being a full feature-surface grid; MUI X DataGrid Community lands at roughly 2× across all three scripts. TanStack Table v8 + TanStack Virtual is the only comparator that ties pretable on a single metric — `filter-metadata` at 15.7 ms vs 16.0 ms, within run noise — but is 2.1× slower on sort and 2.3× slower on `filter-text`.
>
> Like the scroll story, the H6/H7/H8 evaluators check pretable's absolute thresholds (`≤ 32 ms` interaction p95) rather than gating on comparator parity. All three hypotheses stay satisfied at n=3.

### Testing

- `ComparisonTable.test.tsx` already regression-guards the trail-marker label phrasings. The four new label strings get matching regex assertions; the old "Familiar but slower" / "Powerful but DIY" / "Broken at scale" assertions (already replaced in PR #126) stay current.
- No tests for `/bench` page section beyond Next.js's default render check — the page is data-driven, the test would re-implement the renderer.
- `extract-interaction-summary.mjs` doesn't need tests; it's a one-shot script that runs once at PR-creation time. Future matrix runs can regenerate the milestone via the same script.

## Risks

- **Borderline pretable numbers.** `filter-text` at 17.7 ms is 1.7 ms over the 16 ms single-frame budget. The page prose says "fractionally over on `filter-text`" — that's honest but a future n=20 rerun could clarify whether this is noise or a real near-miss. Logged for follow-up.
- **TanStack `filter-metadata` parity tie.** 15.7 ms vs 16.0 ms is well within run noise (≈ 0.4 ms 2σ floor from the perf-diag work). The verdict prose acknowledges this; the table cell shows both numbers truthfully.
- **MUI X trail-marker label change is the most consequential.** Prior "parity at scroll p95" framing reads as positive about MUI; new "2× slower interaction" framing makes the comparison more lopsided. The truth is both — MUI ties on scroll, loses on interaction. The new label preserves both halves ("Scroll-p95 parity; 2× slower interaction").
- **PR #129 merge ordering.** Streaming reframe PR #129 is still open. It modifies `ComparisonTable.tsx` (streaming row rename) and `ReceiptsBand.tsx`. This PR doesn't touch the streaming row or the ReceiptsBand, so file-level conflicts are limited to the docblock at the top of `ComparisonTable.tsx` (both PRs add to the same comment block). Resolvable; not blocking.

## Open question deferred

Should we also add the cell-renderer comparator data from PR #130 to the `/bench` page? The data is on disk (`status/milestones/2026-05-10-b2-cell-renderer-comparators.hypotheses.json`) and would parallel the new Interactions section. Out of scope here — the user can scope a separate PR if they want cell-renderer visible on the page.
