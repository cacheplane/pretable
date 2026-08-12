# Plan — cell presentations docs page

Spec: `docs/superpowers/specs/2026-08-12-cell-presentations-docs-design.md`
Branch: `blove/cell-presentations-docs` (from `f0369613`)

Two tasks. Task 1 owns the page and its registration; Task 2 owns the four
cross-page corrections. They touch disjoint files, so they can run in parallel.

---

## Task 1 — the page and the guard roster

**Files:** `apps/website/content/docs/grid/cell-presentations.mdx` (new),
`apps/website/lib/docs/__tests__/docs-api-surface.test.ts`

### Write the page first, failing

Write the page **before** touching the roster, and run the website suite. It must
fail with the roster test's own message ("a table documenting the members of a
type is not registered in TABLES"). That failure is the proof the guard sees the
four new tables. If the suite is green at this point, **stop** — the tables are
invisible and the rest of the task is theatre.

### Page content

Frontmatter:

```
---
title: Cell presentations
description: "..."
nav: Grid
order: 9
---
```

Source of truth for every claim is `packages/react/src/cells.tsx`. Do not invent
behaviour; the module comment and each doc comment already state the reasoning,
and several of those statements are contrast arithmetic that must not be
paraphrased loosely.

Four sections, each with:

1. A `render` fence using `@pretable/react` imports. Import names are checked
   against the export map, so they must be real exports.
2. A props table `| Prop | Type | Required | Description |` whose rows match
   `packages/react/react.api.md` exactly — see the spec's table for members and
   optionality.
3. The non-obvious fact from the spec's second table.

Also state once, in prose rather than a table row, that remaining
`HTMLAttributes<HTMLSpanElement>` props spread onto the rendered span, and that
`data-pretable-*` attributes are the component's contract with `grid.css` and are
applied after the spread so a caller cannot override them.

### Roster registration

In `docs-api-surface.test.ts`:

- Four `TABLES` entries, `complete: true`, bound to
  `{ pkg: "react", name: "PretableDeltaProps" }` and the other three.
- Four `MEMBER_TABLE_OPTIONALITY` entries set `true`.
- Rewrite the `MEMBER_TABLE_OPTIONALITY` comment. It currently explains why the
  map is empty; it will no longer be. Keep the historical note about #321 (it
  explains why entries were deleted rather than re-pointed) but stop describing
  the map as empty.

### Prove the guard can see it

Three mutations, each reverted before the next. Each must fail on its own:

| Mutation | Expected failure |
| --- | --- |
| one `Required` cell `yes` → `no` | optionality mismatch against the type's `?` |
| a prop renamed to one the type lacks | member not found on the bound type |
| a row deleted from a `complete: true` table | missing member |

Record the actual assertion message for each in the report. "I assume it would
fail" is not a result.

---

## Task 2 — the three-of-four corrections

**Files:** `apps/website/content/docs/grid/api-reference.mdx`,
`apps/website/content/docs/grid/pretable-surface.mdx`,
`apps/website/content/docs/grid/custom-rendering.mdx`

Four locations enumerate the presentations and omit `PretableStatus`:

- `api-reference.mdx:47` — the sentence introducing them
- `api-reference.mdx:113` — the `- ... — shared cell presentations.` bullet
- `pretable-surface.mdx:77`
- `custom-rendering.mdx:31`

Each gets `PretableStatus` added and a link to `/docs/grid/cell-presentations`.
Keep each sentence's existing shape and register; these are one-line edits, not
rewrites. `api-reference.mdx:47` describes what the three do ("semantic badges,
signed changes, and primary/secondary entities") — extend that list rather than
replacing it.

Do **not** add a props table on any of these pages. They are narrative; the new
page owns the complete lists.

---

## Verification (after both tasks)

```
pnpm --filter @pretable/app-website test
pnpm typecheck && pnpm lint && pnpm format
```

Then e2e against a production build, from `apps/website`, invoking the repo-root
Playwright binary (a root-level `--config` run fails the same way a stale shim
does), with `--workers=1`:

```
pnpm --filter @pretable/app-website build
```

then `next start` and the docs spec.

No changeset: nothing under `packages/` changes.
