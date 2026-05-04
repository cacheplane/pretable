---
title: Hero polish — sort, scoreboard, leader highlight
date: 2026-05-04
status: approved
---

# Hero polish: sort, scoreboard, leader highlight

## Goal

Make the homepage HeroGrid demo read as a coherent live race: a rank-sorted leaderboard with sortable columns, a leader-highlighted row, no row-height jitter, and a tight numeric scoreboard sidebar in place of the SVG ski course.

## Context

Bucket E shipped the canonical ski-racing hero demo. Polish revealed three issues:

1. Sort order is accidental (bib descending) — phase-1 add events arrive bib-ascending and the consumer prepends them, producing a reverse-bib display that mixes `running` and `finished` rows nonsensically.
2. Row heights drift between 45 / 50 / 53 / 59 / 64 / 77 px during commentary token streaming. The `wrap: true` notes column triggers `@pretable/react`'s row-height measurement cache, which doesn't reliably release when content shrinks back below default.
3. The right-side `CourseVisualization` SVG (skier dots on a curved course) is a weak signal — viewers don't read race state from a curve. A baseball-style state board (filled shapes, current numbers) reads faster.

Row-height drift in the engine is **deferred**; the fixes here sidestep the trigger by removing wrapping and the `··············` placeholder from the demo.

## Design

### Sort

The displayed order has two modes. Default (no user sort) is leaderboard rank; clicking a column header switches to user sort.

**Default rank order** (when `userSort === null`):

1. **Finished** racers, ascending finish time. `delta === "LEADER"` is the unique first place; subsequent rows sort by `+N.NN` numeric value.
2. **Running** racers, descending gate progress. Progress = number of non-empty gate columns (`gate1`, `gate2`, `gate3`, `finish`); ties broken by latest non-empty gate's time ascending; further ties by bib ascending.
3. **DNF / DSQ** in original order.
4. **DNS** by bib ascending (start order).

**User sort** (when `userSort !== null`): apply the column's comparator over the full row set; no status-tier grouping. Direction = asc | desc. Per-column comparators:

| Column                                 | Comparator                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `bib`                                  | Numeric. `"—"` sinks to bottom (telemetry rows).                                                 |
| `racer`                                | `localeCompare`.                                                                                 |
| `gate1` / `gate2` / `gate3` / `finish` | Empty string sinks; otherwise lex compare (fixed-width `MM:SS.ss` is lex-equivalent to numeric). |
| `delta`                                | `"LEADER"` → `-Infinity`; `"+N.NN"` → `parseFloat`; empty → `+Infinity`.                         |
| `status`                               | Explicit rank: `finished < running < DNF < DSQ < dns`.                                           |
| `notes`                                | `localeCompare`; empty sinks.                                                                    |

All columns sortable. Telemetry rows (HEAVY tier) are sorted alongside racing rows; their `bib === "—"` sinks them under any numeric-bib sort.

Implementation: pure functions in `sort.ts`, called from a `useMemo` in `HeroGrid.tsx`.

### Notes column

- `wrap: false` in `raceColumns.ts`. The engine truncates with ellipsis at the column's pixel width.
- Drop the `··············` placeholder entirely from `generate-race.ts` — empty string until real commentary arrives.
- Cap commentary lines to ~30 characters in the generator. Examples: `"Aggressive line"`, `"Out at G1"`, `"Carries speed to FIN"`, `"Tactical run"`, `"Patient through G2"`.
- Regenerate `recordings/race.jsonl` from the updated generator.

### Leader row highlight

- `<PretableSurface getRowClassName={({ row }) => row.delta === "LEADER" ? styles.leaderRow : undefined}>`.
- `.leaderRow` in `heroGrid.module.css`: subtle warm tint, e.g. `background: color-mix(in oklab, var(--color-warning) 12%, transparent);`.
- Updates automatically as the leader changes (recording emits exactly one `LEADER` delta when the first racer finishes).

### Scoreboard sidebar

New component `app/components/heroGrid/Scoreboard.tsx`. Replaces and deletes `CourseVisualization.tsx` and its test.

Layout (top to bottom, vertical stack):

```
LEADER
1:14.89
#12 TUMLER 🇨🇭

ON COURSE
#15  ● ● ● ○
#14  ● ● ● ●
#13  ● ● ○ ○

FIN 12   DNF 1
```

Four dots per running row, mapped to `gate1`, `gate2`, `gate3`, `finish` (matching `RaceRow`'s shape — no `gate4` column exists).

Rules:

- **Leader section**: rendered only if a row has `delta === "LEADER"`. Shows finish time, bib, racer name (with flag emoji preserved). Hidden until first finisher.
- **On course section**: rendered only if any row has `status === "running"`. Each row: bib, then four dots `● ○` representing G1, G2, G3, FIN. Filled = corresponding column (`gate1`, `gate2`, `gate3`, `finish`) non-empty. Sorted same as default rank's running tier (gates filled desc). Capped at 5 rows; if >5 running, append `+N more` line.
- **Counters**: `FIN N` shown if any finished; `DNF N` shown if any DNF or DSQ (DSQ folds into the DNF tally on a tight scoreboard — a single "did not finish" counter). Hidden when both zero.
- Telemetry rows (`id` starts with `tel-`) are excluded from all calculations.
- Times rendered in monospace.
- Single `useMemo` derives the entire view-model from `rows`. No internal state, no rAF.

Visual: keep aesthetic consistent with the bezel. Use existing CSS tokens; no new design tokens.

### Sort UI plumbing

`PretableSurface` already renders the column-header sort buttons and emits `onSortChange`. `HeroGrid` holds the state and passes it back through the `sort` prop to keep the UI in sync. Three-state click cycle (asc → desc → null) is handled by the engine's `getNextSortDirection`.

## File changes

| File                                                                      | Action                                                                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/website/app/components/HeroGrid.tsx`                                | Modify: add `useMemo` rank+sort, `userSort` state, `onSortChange`, `sort` prop, `getRowClassName`. Swap `<CourseVisualization>` → `<Scoreboard>`. |
| `apps/website/app/components/heroGrid/raceColumns.ts`                     | Modify: `notes.wrap = false`.                                                                                                                     |
| `apps/website/app/components/heroGrid/sort.ts`                            | **Create** — `rankRows`, `sortByColumn`, per-column comparators.                                                                                  |
| `apps/website/app/components/heroGrid/__tests__/sort.test.ts`             | **Create**.                                                                                                                                       |
| `apps/website/app/components/heroGrid/Scoreboard.tsx`                     | **Create**.                                                                                                                                       |
| `apps/website/__tests__/components/heroGrid/Scoreboard.test.tsx`          | **Create**.                                                                                                                                       |
| `apps/website/app/components/heroGrid/CourseVisualization.tsx`            | **Delete**.                                                                                                                                       |
| `apps/website/__tests__/components/heroGrid/CourseVisualization.test.tsx` | **Delete**.                                                                                                                                       |
| `apps/website/app/components/heroGrid/scripts/generate-race.ts`           | Modify: drop `··············` placeholder; cap commentary to ~30 chars.                                                                           |
| `apps/website/app/components/heroGrid/recordings/race.jsonl`              | **Regenerate**.                                                                                                                                   |
| `apps/website/app/components/heroGrid/recordings/race.ts`                 | Auto-regens with the .jsonl.                                                                                                                      |
| `apps/website/app/components/heroGrid/heroGrid.module.css`                | Modify: add `.leaderRow`; adjust `.heroSidebar` for scoreboard tile if needed.                                                                    |

## Tests

- `sort.test.ts`: comprehensive — rank ordering across all status combos; user sort per column with empty/edge values; LEADER handling in delta; telemetry sinking; tie-breakers.
- `Scoreboard.test.tsx`: leader hidden until first LEADER row; running rows render correct dot count per gate-fill state; counters appear/hide on threshold; cap at 5 with overflow indicator; telemetry rows ignored.
- `replay-engine.test.ts` and `HomeStreamHeader.test.tsx`: continue to pass unchanged.

## Out of scope

- Row-height measurement cache fix in `@pretable/react` (deferred — this spec sidesteps the trigger).
- Multi-column sort.
- Persisted sort across reloads.
- New design tokens.
