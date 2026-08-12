# Cell presentations — docs page

**Date:** 2026-08-12
**Status:** approved

## The gap

`PretableDelta`, `PretableStatus`, `PretableBadge` and `PretableEntity` shipped in
#318 and #319. Three of them are named in passing on three pages. `PretableStatus`
appears in **zero** docs pages, and none of the four has a documented prop.

Worse, the page that owes the complete list is silently three-of-four:

| Location                       | Claim                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------- |
| `grid/api-reference.mdx:47`    | names Badge, Delta, Entity as "theme-aware React presentations"               |
| `grid/api-reference.mdx:113`   | `- PretableBadge, PretableDelta, PretableEntity — shared cell presentations.` |
| `grid/pretable-surface.mdx:77` | "For common semantic presentations, Badge, Delta, Entity …"                   |
| `grid/custom-rendering.mdx:31` | "Shared presentations such as Badge, Delta, Entity …"                         |

A reader who needs a status dot cannot discover that one exists.

## What ships

### 1. `apps/website/content/docs/grid/cell-presentations.mdx`

Frontmatter `nav: Grid`, `order: 9` — directly after Cell Renderers (8), which
documents the `render` hook these are emitted from.

Intro carries the two claims `packages/react/src/cells.tsx` already argues in its
module comment, because both are load-bearing for a reader deciding whether to
use them:

- **Opt-in, never inferred.** The grid does not know that a number is a change
  rather than a quantity, or that a string is a state rather than a label. Only
  the consumer knows, so only the consumer asks.
- **Never colour alone.** The delta has a direction marker; the status and badge
  have their labels. Roughly 8% of men cannot reliably separate the red from the
  green these use, and a printed or greyscale grid has no hue at all.

Then one section per component: a realistic `render` fence, the props table, and
the one non-obvious fact each carries.

| Component        | Non-obvious fact worth documenting                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PretableDelta`  | `value` is **not rendered** — it is read for sign only. Pass display text as `children`; the component never calls `toLocaleString`/`toFixed`. Zero, `-0` and `NaN` all render `flat`, not a movement.                                                                                                                                                                                                                                                                                                                    |
| `PretableStatus` | The dot is `content: ""`, so a status with no children speaks by colour alone. The component warns on the console when that happens — once per key per process, and **not** build-gated. (An earlier draft of this spec called it a "dev warning". That is wrong: `packages/react/src/dev-warn.ts` states the package ships no `process.env` reference, precisely so a misconfiguration that survives to production is still reported. Calling it a dev warning would tell a reader it disappears in a production build.) |
| `PretableBadge`  | The chip never tints its own fill — a contrast decision, not a stylistic one. There is deliberately no `neutral` tone: omitting `tone` _is_ the neutral badge.                                                                                                                                                                                                                                                                                                                                                            |
| `PretableEntity` | `secondary` is subordinated by a token and type size, never opacity — a translucent secondary cannot reach 4.5:1 and still read as secondary. `0` and `""` are rendered, not dropped.                                                                                                                                                                                                                                                                                                                                     |

### 2. Props tables

Every table is `| Prop | Type | Required | Description |`, leading with `Prop` so
the guard's `MEMBER_TABLE_HEADERS` detector sees it, with rows matching
`packages/react/react.api.md` exactly:

| Table                 | Members (api.md order) | Required |
| --------------------- | ---------------------- | -------- |
| `PretableDeltaProps`  | `value`, `children`    | yes, no  |
| `PretableStatusProps` | `tone`, `children`     | yes, no  |
| `PretableBadgeProps`  | `tone`, `children`     | no, no   |
| `PretableEntityProps` | `primary`, `secondary` | yes, no  |

Each interface `extends Omit<HTMLAttributes<HTMLSpanElement>, "children">`, whose
angle brackets close on the declaration line, so the report parser collects
exactly the declared members and nothing inherited. Prose states that any other
`HTMLAttributes` prop spreads onto the rendered `<span>`; that is not a table row
because the report does not carry one.

### 3. Guard registration

Four `TABLES` entries bound `complete: true` to the four `*Props` interfaces, and
four `MEMBER_TABLE_OPTIONALITY` entries set `true`.

The second half matters beyond this page. `MEMBER_TABLE_OPTIONALITY` has been
**empty since #321** rewrote the pages that used to populate it; its own comment
says it stays "for the reverse direction." So the optionality machinery built in
the previous PR currently has no live consumer — which is exactly the standard
this project applies everywhere else, and the reason it has been burned four
times. These four tables give it one, and each `Required` cell is then held
against the type's own `?`.

Its comment is updated to say so, rather than left describing an empty map.

### 4. The three-of-four fix

All four locations above are corrected to name `PretableStatus` and to link the
new page.

## Non-goals

- **No `content/examples/` entry.** All three existing examples carry a test
  harness; four presentational spans do not earn one.
- **No segmented meter.** Still nothing consumes it. Unchanged from #319.
- **No new tokens.** The semantic ramp shipped in #318 and is already documented
  in the token reference.
- **No changes to `packages/`.** Docs and the website guard only.

## Verification

1. `pnpm --filter @pretable/app-website test` — the guard is the real gate.
2. **Mutation testing, before believing any of it.** Three separate mutations,
   each expected to turn the suite red on its own:
   - flip one `Required` cell `yes` → `no`
   - rename one prop in a table to a name the type does not have
   - delete one row from a `complete: true` table
     A guard that stays green under any of these is a guard that cannot see the
     table, which is the precise defect the previous PR spent four rounds closing.
3. Typecheck, lint, format.
4. `docs.spec.ts` e2e against a production build (`next build` + `next start`,
   `--workers=1`).

## Risks

- **Table detection is header-driven.** If a future edit retitles `Prop` to
  `Property`, the table stops being seen. That hole is already known and is not
  in scope here; the roster's stale-key check still fires, because the registered
  key would no longer resolve.
- **`order: 9` collides with `custom-rendering.mdx`.** Duplicate orders already
  exist in this directory (three pages at 8, two at 10), so this is consistent
  with the existing convention rather than a new problem.
