# Hero adoption of row grouping

Date: 2026-08-11
Status: approved

## Problem

`ROADMAP.md` **Now**: "Finish grouping adoption with committed benchmark
evidence." The evidence half is done (#285 baseline, #291 streaming
disambiguation, #297 the fix). The adoption half is untouched — `HeroGrid.tsx`
has no `groupPanel`, and the homepage says nothing about a headline feature that
has been published since `0.0.11`.

## The perf question is settled

It gated this work and it now has an answer. Grouping under streaming is **free
at 3,000 rows** (`group-updates` p95 10.1 ms vs `updates` 10.0 ms) and misses
60 Hz only at 20,000. The hero roster is **22 rows across 5 sectors**. There is
no perf question at hero scale.

## Design

### Ungrouped on arrival, panel visible and empty

Decided during SP4 planning and unchanged: first paint is the flat streaming
portfolio exactly as today, with the panel above it reading "Drag a column here
to group by it". Visitors discover grouping by performing it, which demonstrates
the interaction rather than its result — and the streaming first impression, the
hero's actual job, is untouched.

`groupPanel={{ enabled: true }}` on the existing `PretableSurface`. Sector is the
natural key; nothing needs to preselect it.

### Layout

The panel **consumes from `viewportHeight`** rather than adding to it, so the
component occupies the same box. The hero derives `viewportHeight` from a
`ResizeObserver` on `.heroSurface` (`HeroGrid.tsx:79-96`, floor
`FALLBACK_VIEWPORT_HEIGHT = 520`), so the grid body loses ~36 px and nothing
around it moves. That is the intended behaviour, not a regression.

### The integration hazard

`handleSelectionChange` (`HeroGrid.tsx:243-250`) builds its column order from
`columns.map((c) => c.id)` — the hero's **own** array. Once grouped, the drawn
columns include the derived `__pretable_group__` and exclude the grouped column,
so that array is no longer the drawn order.

This is the exact trap that has now caught eight consumers across
`copy`, `paste`, selection, announcements and `toEngineDropIndex`. **Anything
resolving a column span must use the drawn order.** Check `summarizeSelection`
and the sidebar summary against a grouped grid specifically — not just an
ungrouped one, which is how this keeps getting missed.

## The e2e assertions this can break

The hero's Playwright coverage contains assertions that a panel or a group
column would invalidate. Each must be checked, and **fixed rather than
loosened** — a weakened assertion is worse than a broken one.

| Test                                  | Risk                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.spec.ts:79` row-drift          | measures `hero-bezel` bounding box moving < 2px over 3s. Enabling the panel is a one-time relayout; if it lands after the `before` sample it trips the bar.                                                                                                                             |
| `smoke.spec.ts:106` row-select column | asserts the **first** `[data-pretable-header-cell]` and `[data-pretable-cell]` are the row-select ones, and counts headers/cells. Safe **only while ungrouped by default** — a grouped grid puts the derived column first. Do not add a test that groups and then reuses these helpers. |
| `smoke.spec.ts:192`, `:296` cockpit   | exact `[data-pretable-row]` counts, and `openFilterMenu` hovers `[data-pretable-header-row]` — which the panel shifts down ~36px.                                                                                                                                                       |
| `visual-validation.spec.ts`           | five viewports down to **320px wide**, with an absolute `pageerror` + `console.error` gate. The panel must not overflow or warn at 320px. Chips scroll horizontally as of #267.                                                                                                         |

Add one new assertion for the feature itself: drag a header onto the panel and
confirm the grid groups. That is the thing being adopted, and nothing currently
proves it works in the hero.

## Copy

The legend (`HeroGrid.tsx:294-297`) lists the grid's affordances: "double-click
to edit · drag to select · ⌘C copy · ⌘V paste into Qty · funnel to filter". Add
grouping in the same voice. Keep it to a few words; the panel's own empty
message already explains the gesture.

## Out of scope

Grouping the hero by default, preselecting sector, the PMS benchmark profiles
(the third `Now` line), and incremental grouping for the 20k streaming miss
(roadmap `Later`, priced by #291).

## Testing

`pnpm build`, then `next start`, then the website e2e at `--workers=1` in both
engines — the hero suite is the one most sensitive to layout, and this changes
the hero's layout.

Verify the claims in this spec against the code before acting; several specs in
this series have been wrong about line numbers, counts and mechanisms.
