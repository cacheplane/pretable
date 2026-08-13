# Server-controlled data on the root component

Status: proposed · 2026-08-13

Makes `<Pretable>` — the component the docs teach as the entry point — able to
express server-controlled data. Today that capability is reachable only from
`<PretableSurface>`, and the barrier is not which props get forwarded.

This is the first slice of the bounded-window project ([§ Why now](#why-now));
it deliberately ships no windowing. It gives windowing somewhere to land.

## The problem

`PretableProps` is `rows`, `columns`, `getRowId`, `ariaLabel` and a set of
pass-throughs. It carries none of `processing`, `resultMeta`, `dataState` or
`onQueryChange`. A consumer following the documented happy path gets a working
grid, then needs server-applied filtering, and discovers they must switch to a
different component with a materially larger contract.

The barrier is at the type level, not the forwarding level:

```ts
/** Exact controlled-query pair accepted in rows mode. @public */
export type PretableControlledQueryOptions<TColumns> =
  | { readonly query: PretableQueryFor<…>;
      readonly onQueryChange: (query: PretableQueryFor<…>) => void }
  | { readonly query?: never; readonly onQueryChange?: never };
```

There is no arm for **uncontrolled query with change notification** — the
ordinary `<input defaultValue onChange>` shape. `<Pretable>` never exposes
`query` (its doc comment: it "only ever forwards to the rows-owned mode … and
never exposes `model` or `query`"), so it is forbidden from reporting that the
query changed. Without that report, external authority on `<Pretable>` would be
incoherent: the grid would hold a sort intent that no one could act on.

### Verified before designing

1. The union enforces **controlled-component correctness** — `value` requires
   `onChange`. Its name and doc comment say so. It does not document a
   prohibition on notify-only; that case was not a use case when it was
   written (introduced in #321).
2. The capability already exists one layer down. `pretable-model.ts:252`
   declares `readonly onQueryChange?: (query) => void` — plain, optional,
   unpaired. The model layer already treats notify-only as safe.

So the third arm is consistent with the existing design rather than a reversal
of it.

## The three things a grid owns

The ladder has conflated three separable concerns:

| | `<Pretable>` today | `PretableSurface` |
| --- | --- | --- |
| **Intent** — which column is sorted, what filters are set | internal | yours |
| **Data** — the rows | **yours** | yours |
| **Authority** — who *applies* the intent | engine only | yours |

Data is already external in both. What is missing is the rung where intent is
uncontrolled but observable, and authority is yours: **you do not want to manage
sort state by hand, but you do fetch your own rows.** That is most
applications, and today it is unreachable.

## Design

### 1. Make notification optional in the uncontrolled arm

No new arm is needed. The uncontrolled arm simply carried the wrong modifier:
`onQueryChange?: never` *forbids* notification, where `onQueryChange?: (…) => void`
merely makes it optional.

```ts
export type PretableQueryOptions<TColumns> =
  /** Controlled: `query` requires its setter, as `value` requires `onChange`. */
  | { readonly query: PretableQueryFor<NoInfer<TColumns>>;
      readonly onQueryChange: (query: PretableQueryFor<NoInfer<TColumns>>) => void }
  /** Uncontrolled: the engine owns the query, and MAY report changes. */
  | { readonly query?: never;
      readonly onQueryChange?: (query: PretableQueryFor<NoInfer<TColumns>>) => void };
```

Still two arms. All four call shapes resolve correctly:

| Call | Resolves to |
| --- | --- |
| `{ query, onQueryChange }` | controlled — arm 1 |
| `{ onQueryChange }` | uncontrolled, observed — arm 2 |
| `{}` | uncontrolled, silent — arm 2 |
| `{ query }` alone | **rejected** — arm 1 needs the setter; arm 2 needs `query` absent |

Ownership stays unambiguous: no path exists by which the consumer sets `query`
while the engine also owns it. And because the union does not grow, the failure
text for a malformed pair stays as legible as it is today — which the earlier
three-arm sketch in this spec's first draft would have degraded. That sketch is
superseded; the risk it carried is withdrawn.

The type's name no longer covers what it holds. Rename
`PretableControlledQueryOptions` → `PretableQueryOptions`; per the repo's
pre-1.0 policy, no alias is kept.

<details>
<summary>Superseded first draft — a third arm</summary>

```ts
export type PretableControlledQueryOptions<TColumns> =
  | { readonly query: PretableQueryFor<NoInfer<TColumns>>;
      readonly onQueryChange: (query: PretableQueryFor<NoInfer<TColumns>>) => void }
  /** Uncontrolled, observed: the engine owns the query and reports changes. */
  | { readonly query?: never;
      readonly onQueryChange: (query: PretableQueryFor<NoInfer<TColumns>>) => void }
  | { readonly query?: never; readonly onQueryChange?: never };
```

Ownership stays unambiguous. The engine owns the intent; the consumer observes
and never writes back. No half-controlled state is reachable, because there is
no path by which the consumer sets `query` while the engine also owns it.

Rejected because three arms degrades TypeScript's error text for a malformed
pair, and because the two-arm form above expresses the same constraint set.

</details>

### 2. Four props on `PretableProps`

`processing`, `resultMeta`, `dataState`, `onQueryChange` — forwarded verbatim
to `PretableSurface`. No new behavior, no new defaults, no reimplementation.

`<Pretable>` keeps its single non-overloaded signature: it still always supplies
`rows` + `getRowId` and never exposes `model` or `query`, so `PretableProps`
stays a plain interface. Only `onQueryChange` is added as an optional member.

### 3. Honesty is inherited, not reimplemented

Every downgrade rule lives in `data-scope.ts` behind `PretableSurface`:
non-external authority, grouping active, non-exact totals, and totals below the
loaded count each downgrade `aria-rowcount` to the loaded model and warn once.
`<Pretable>` forwards and inherits all of it. This slice adds no honesty logic
and must not.

## Testing

**Type-level** (the arm is the feature, so this is the primary suite):

- `{ onQueryChange }` alone compiles.
- `{ query }` alone still fails.
- `{ query, onQueryChange }` still compiles.
- Neither still compiles.

**Behavioral:**

- `<Pretable>` with `onQueryChange` and no `query`: clicking a sort header fires
  the callback with the new query, and the grid re-sorts locally (engine
  authority is still the default).
- `<Pretable>` with `processing: { filter: "external", sort: "external" }`:
  clicking a sort header fires the callback and the grid does **not** reorder
  locally.
- `<Pretable>` with a `resultMeta.total` above the loaded count publishes the
  population through `aria-rowcount`; with a total below it, downgrades and
  warns — proving the inherited honesty path is live through the root
  component.

Every guard must be shown able to fail by mutation before it is trusted; a
type-level test that passes because the type resolved to `any` is the failure
mode to check for specifically.

## Out of scope

Windowing (`window.start`, `windowGap`), eviction, the selection retainer, and
any change to `PretableSurface`'s own contract beyond the union arm. `<Pretable>`
gains no access to `model` or `query` — the model-owned mode stays
`PretableSurface`-only.

## Why now

The bounded-window project — holding a window over a dataset larger than memory,
with variable row heights — is the identified competitive wedge: AG Grid's docs
state `maxBlocksInCache` must not be set when using dynamic row height, so
eviction and variable heights cannot coexist there. Pretable already retains
measured heights through a row's absence, already has viewport anchoring, and a
spike showed windowed scroll geometry is a ~16-line change.

That capability should not ship onto a surface most consumers never reach. This
slice makes the rung exist first.

## Risks

1. **Renaming a public type.** `PretableControlledQueryOptions` →
   `PretableQueryOptions` moves the API report and breaks any consumer naming
   it. Pre-1.0 policy permits this with no alias; the report churn is expected
   and must be reviewed, not rubber-stamped.
2. **Prop-count creep on the drop-in.** Four additions is small, but the
   component's value is that its contract is short. Anything beyond the
   server-controlled set should be argued separately.
3. **Inherited-honesty assumption.** The behavioral tests exist specifically to
   prove the downgrade paths are reachable through `<Pretable>`; if any rule
   turns out to be wired to a `PretableSurface`-only prop, this slice grows.

## Landing notes

Two repo-specific traps this slice will hit, recorded so the plan does not
rediscover them:

- **`API Extractor — report freshness` is a required gate.** Four new public
  props and a renamed public type all move `react.api.md`. Run `pnpm build`
  before `pnpm api` — a stale `dist/` silently strips exports from the report,
  and `api:check` does not catch that.
- **Docs prose is guarded.** Since #356, `docs-api-surface.test.ts` checks type
  names appearing in prose, not only in tables. Any docs page written for this
  slice must name only types that exist in the reports — including the renamed
  `PretableQueryOptions`.
