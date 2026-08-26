---
"@pretable/core": minor
---

Filters are an AND/OR tree.

`PretableQueryFor.filters` is still an array, and an array of plain leaves
still means exactly what it meant before — the top level is an implicit AND.
What is new is that an element may also be a **group**:

```ts
interface PretableFilterGroupFor<TColumns> {
  readonly op: "and" | "or";
  readonly children: readonly PretableFilterNodeFor<TColumns>[];
}
```

Groups nest, so a query can express any AND/OR shape. `PretableFilterNodeFor`
is the union of a typed leaf and a group — the type most call sites reading
`filters` want — and `isPretableFilterGroup(node)` narrows one to a group. The
guard checks the group's own fields positively, so an unrecognized shape fails
closed rather than being treated as a branch with no children.

Two rules a consumer has to know:

- **An EMPTY group holds — for BOTH operators.** `{ op: "or", children: [] }`
  keeps every row, exactly like `{ op: "and", children: [] }`. Naive algebra
  says an empty OR is false; that answer is wrong for a product, because a
  group the user is still assembling in a filter builder would blank the grid
  the moment it appeared. An empty group constrains nothing.
- **Trees deeper than 64 levels are rejected.** `compileQuery` fails such a
  query with `code: "invalid-query"` and a `query.filters[i].children[j]…`
  path. This is a new reason for an existing rejection, and the only way an
  otherwise well-formed query can now be refused.

Evaluation, query equality (so plan reuse and recompile decisions), capture and
freezing, and `distinctValues` all recurse. Equality stays order-insensitive
per level, which AND and OR both license.

Nothing in this release builds a group on its own — no UI renders or authors
one yet. `@pretable/react` ships the surface half alongside: funnels light on a
filter at any depth, and the per-column menu owns only its top-level leaf.
