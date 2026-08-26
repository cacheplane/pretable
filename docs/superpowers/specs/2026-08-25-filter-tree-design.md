# Filter Tree (Tool Panel SP2a) — Design

**Status:** approved direction; SP2a specced in full, SP2b (the builder UI) outlined.
**Parent:** `docs/superpowers/specs/2026-08-24-tool-panel-design.md` (SP2 of the tool panel).

## What this is

Boolean filter composition for the engine: filters become an **arbitrary-depth
tree** of AND/OR groups over the existing typed leaves, so a query can express
`price > 10 AND (status isAnyOf [a,b] OR owner contains "x")`. This is the
engine prerequisite for SP2b, the tool panel's filter builder section — the
same engine-first split SP1 used for column visibility, because the UI must
compose against a model that exists.

## Decisions locked (and why)

1. **Full OR groups, not multi-filter AND.** Chosen over the cheaper options
   (one-per-column AND; flat multi-filter AND) — the builder's value is
   expressing what the per-column menu cannot.
2. **Engine first (SP2a), builder second (SP2b).** A combined PR would span
   row-model → core → react → ui → docs; SP1 was 30 commits _without_ an
   engine rewrite. Each half ships and is testable alone.
3. **Arbitrary nesting.** The engine cost over a fixed two-level shape is
   recursion versus a loop; the recursive type is cleaner than a special-cased
   one; and SP2b may still _render_ a bounded depth while the model keeps the
   full algebra. Deciding expressiveness once beats a pre-1.0 rework later.
4. **`filters` stays an array; groups are elements.**
   `filters: readonly (Leaf | Group)[]`, top level an implicit AND — every
   existing call site keeps compiling and the simple case stays one-liner
   simple. Rejected: a single root group (ceremony on every simple consumer
   forever) and a parallel `filterTree` field (two sources of truth — the
   declared-but-read-by-nothing failure mode this repo keeps paying for).

## The type

```ts
/** @public */
export interface PretableFilterGroupFor<TColumns> {
  readonly op: "and" | "or";
  readonly children: readonly (
    PretableFilterFor<TColumns> | PretableFilterGroupFor<TColumns>
  )[];
}

// PretableQueryFor<TColumns>.filters:
//   readonly (PretableFilterFor<TColumns> | PretableFilterGroupFor<TColumns>)[]
```

- Leaves and groups discriminate structurally (`columnId`+`operator` vs
  `op`+`children`). A public runtime guard `isPretableFilterGroup` ships so
  consumers never hand-roll the discrimination; internal code uses the same
  guard.
- **Type-level trap, named:** `PretableFilterFor` is a large distributive
  conditional type. Extending the union around it must be probed with the
  repo's `IsNever` discipline — a conditional that collapses to `never`
  compiles every downstream guard while checking nothing, and this exact
  failure shipped once before.

## Evaluation semantics

- Top-level array: AND over elements (unchanged behavior for all-leaf arrays).
- Group: `and` → `children.every`, `or` → `children.some`, short-circuiting,
  recursion for nested groups.
- Leaf evaluation is untouched — the existing compiled `RuntimeFilter` path is
  reused; the tree changes combination only, never leaf semantics.
- **Empty group ⇒ TRUE, regardless of `op`.** The naive algebra says empty-OR
  is false, but that would let a half-built group in SP2b's UI blank the whole
  grid mid-edit. Identity-true is the product-safe convention; it is stated in
  the TSDoc and pinned by a test. An all-empty tree therefore filters nothing,
  exactly like `filters: []` today.
- The query-equality comparison that gates recompiles (currently a flat
  `every` over leaves) learns deep structural tree comparison. Getting this
  wrong in the "always unequal" direction recompiles per publish; in the
  "always equal" direction it never recompiles — both directions get tests.

## Surface and controlled state

- `state.filters` changes shape from `Record<columnId, ColumnFilter>` (one per
  column) to the query's own array-of-leaf-or-group — one vocabulary
  everywhere, no projection layer. Pre-1.0, no compatibility aliases.
- **Header funnel semantics, scoped honestly:**
  - The per-column FilterMenu **creates / edits / removes its column's
    top-level leaf** — its exact job today, unchanged in capability.
  - The funnel **lights when its column appears anywhere in the tree**
    (recursive scan).
  - A column filtered only inside groups shows a lit funnel and a menu with no
    editable leaf; the explanatory "also filtered in advanced groups" line in
    the menu belongs to SP2b, when a builder exists to point at.
- If the menu's write path today replaces the whole per-column record, it now
  splices only the top-level leaf and must not disturb group elements — a
  survives-test (assert the old behavior AND the group's integrity).

## External authority and the wire

- `filter: "external"` suppresses local evaluation exactly as today —
  suppression happens at evaluation, and the tree does not change that seam.
- The tree flows through `onQueryChange` verbatim. **The server-side data docs'
  filter contract updates in SP2a** (not SP2b), because the wire shape a
  server can receive changes the moment this merges.

## The audit (SP1's discipline)

Every reader of `query.filters` / `state.filters` gets a recorded verdict —
recursive-aware, flat-assuming (fix), or display-only. Known candidates, to be
completed by grep during planning: the funnel projection, the filter-count /
post-filter row-count paths, CSV/export omission reporting, copy,
announcements, bench adapters, docs examples, the headless docs example.

## Verification

- row-model unit tests: evaluation (AND/OR/nested/empty-group), with fixtures
  that can disprove — an OR fixture whose expected rows differ from the same
  tree with AND, so a connective mix-up cannot pass.
- Deep-equality tests in both failure directions (never-equal / always-equal).
- Type-level `IsNever` probes on the extended union; api reports regenerate
  (core + react move; build before `pnpm api`).
- FilterMenu write-path survives-tests; funnel-anywhere tests.
- Docs guard: any new table registered; the server-side filter page's wire
  examples must keep passing the fence/import checks.
- Changesets: core minor (or row-model as versioning dictates), react minor.

## Out of scope for SP2a

The builder UI (SP2b), any rendering of groups anywhere, the FilterMenu's
"advanced groups" note, NOT/negation as a group op (leaves already carry
negated operators: `notContains`, `isNoneOf`, `notEquals` — a group-level NOT
is redundant today and can be added compatibly if SP2b finds a need), saved
views, and the section-strings i18n pass (SP2b, alongside its new strings).

## SP2b outline (for continuity, not specced here)

The tool panel's filter section renders the tree — likely with a rendered
depth cap over the full underlying algebra (its call); typed value editors
reused from the shipped cell-editor set; add/remove/re-op/regroup
interactions; the i18n pass over section strings; the shared menu-keyboard
extraction that the third `role="menu"` triggers.
