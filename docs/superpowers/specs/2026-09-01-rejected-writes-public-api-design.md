# A public answer to "do the rendered rows match the ones I passed?"

Date: 2026-09-01
Status: approved, ready for planning

## Problem

Since PRs #550/#553/#557/#559, an invalid `derivations`, `query`, or `rows`
update is a _rejected write_: the row model keeps its last-good value and the
grid stays alive instead of unmounting. The cost is a permanent, invisible skew
between the consumer's props and the model. The 0.14.2 changelog states it
plainly: the grid can stay diverged from your data indefinitely, the console
warning latches per fault kind so a second rejection of the same kind is
silent, and there is no API to ask whether the rendered rows match the ones you
passed.

A latching console warning is a weak signal for a data-correctness problem.
Code cannot read a console warning: no banner, no retry, no fallback. For the
buy-side portfolio cockpit on the homepage, one bad server page silently shows
stale positions.

This design was explicitly scoped OUT of #557 ("a feature, not a bug fix";
see the out-of-scope section of
`2026-08-31-setrows-rejected-write-guard-design.md`). This is the
reconsideration.

## What exists to build on

PR #561 landed the internal mechanism. `usePretable` holds a notifying
`RowsWriteState` store read via `useSyncExternalStore` —
`{ rejectedRows: <the refused array | null>, coherentWindowStart }` —
published during commit, value-compared, render-readable. Its key insight is
measured and load-bearing: **recovery is detected by identity, not by a
boolean**. A bare "was rejected" bit is still set during the render that
recovers (the effect has not run yet), which produced a real spurious
`result-meta-total-below-loaded` warning that `warnOnce` then latched. Storing
the refused value and asking "is the value in hand the refused one?" answers
correctly one render earlier.

The guard factories in `rejected-write.ts` already extract a structured fault
(`code`, `columnId`, message) at the moment of rejection.

## Decisions (each confirmed with the user)

1. **Coverage: all three write kinds** — rows, derivations, query. They are one
   seam mechanically (same guard helper, same latching warning, same
   divergence property) and the consumer's remedy is the same. Designing
   rows-only forces a second API later; pre-1.0-no-backcompat says get the
   shape right once.
2. **Shape: a per-kind rejection record, `null` when in sync.** A banner needs
   the boolean; a useful banner needs the fault; retry logic needs to know
   which write to retry. All three fall out of one shape. No history, no
   counts, no refused array in the public payload (the consumer passed it and
   already has it; holding it publicly pins a possibly-huge array alive).
3. **Exposure: both a render-readable value and a Surface callback.**
   `PretableModel.rejectedWrites` for hook consumers;
   `onRejectedWriteChange` prop for direct-`PretableSurface` consumers (parity
   with `onTelemetryChange`). One mechanism underneath. The callback is
   Surface-only — hook consumers read the field; a second channel on the hook
   options is YAGNI.
4. **`useLocalRowModel` (#559) merges into the same record** via a
   react-internal symbol channel on the model instance. A consumer doing
   `useLocalRowModel({rows})` + `<PretableSurface model={...}>` never runs
   `usePretable`'s rows guard; without the merge, `rejectedWrites` would
   answer "in sync" while the grid is diverged — a false negative worse than
   no API.

## Public API

New public types in `@pretable/react`:

```ts
/** Why the grid refused a write, at the moment it refused it. */
export interface PretableRejectedWrite {
  readonly kind: "rows" | "derivations" | "query";
  /** Fault code — for rows, a member of PretableRowModelErrorCode. */
  readonly code: string;
  /** Same substance as the console warning, without the latching. */
  readonly message: string;
  /** Present when the fault names a column. */
  readonly columnId?: string;
}

/** Per-write-kind divergence state. A null slot means that write is in sync. */
export interface PretableRejectedWrites {
  readonly rows: PretableRejectedWrite | null;
  readonly derivations: PretableRejectedWrite | null;
  readonly query: PretableRejectedWrite | null;
}
```

Exposure:

- `PretableModel.rejectedWrites: PretableRejectedWrites` — render-readable,
  coherent with the snapshots beside it, referentially stable across unrelated
  renders.
- `PretableSurfaceProps.onRejectedWriteChange?: (rejectedWrites: PretableRejectedWrites) => void`
  — fires on any slot transition, including clears (recovery); never on
  unrelated renders.

Contract:

- A non-null slot means the grid's value for that kind is NOT the one most
  recently passed; the record describes the most recent rejection of that kind.
  **No latching** — each rejection replaces the record.
- A slot clears at the render where a landing value arrives (identity-based).
  No consumer action beyond passing a valid value.
- Fatal faults (`disposed-model`, `reentrant-mutation`, foreign errors) still
  throw; they never appear here.
- `rejectedWrites.rows` covers the rows write wherever it happened — Surface
  rows-mode or `useLocalRowModel`.
- Console warnings are unchanged (still latching); this is the programmatic
  signal.

Naming: `rejectedWrites` (state, plural noun) over `divergence`/`isStale` — it
names the mechanism truthfully and matches the existing internal vocabulary.
`onRejectedWriteChange` over `onRowsRejected` — this is state-change
notification, not an event stream, and a singular-event name fights the
clear-on-recovery semantics.

## Internal architecture

**One store, generalized from #561.** `RowsWriteState` grows into the
write-state store for all three kinds:

```ts
interface WriteState {
  readonly rows: { readonly refused: unknown; readonly fault: PretableRejectedWrite } | null;
  readonly derivations: { readonly refused: unknown; readonly fault: PretableRejectedWrite } | null;
  readonly query: { readonly refused: unknown; readonly fault: PretableRejectedWrite } | null;
  readonly coherentWindowStart: number | undefined;
}
```

- The refused **identity** stays internal (the clear-on-recovery mechanism and
  what the surface's honesty fixes read); the **fault** is what surfaces
  publicly. `PretableRejectedWrites` is derived once per publish and cached on
  the snapshot.
- #561's existing reads (`rejectedRows`, `coherentWindowStart`) re-point at
  `state.rows?.refused` — no behavior change to the aria/window honesty work.

**Feeding it.** Each guard's `catch` in `usePretable`'s layout effect also
builds the fault record. The guard factories already extract
`code`/`columnId`/message for the warning; the same extraction populates the
record, so warning text and record cannot drift. The **query** write settles
asynchronously (`.finished` chain), so its rejection can arrive from a `.then`
callback after commit — publishing into a notifying store from there is what
the store shape permits, and why this cannot be effect-local state.

**Clearing.** Same identity rule per kind, evaluated where each guard already
gates: when the incoming prop for that kind is not the refused identity, the
slot publishes back to `null`. Rows clearing already works this way (#561);
derivations/query add the same compare against their existing
`lastDerivations`/`lastQuery` refs.

**`useLocalRowModel` channel.** Its guard (#559) publishes
`{ refused, fault } | null` into a small notifying store attached to the model
instance under a react-internal `Symbol`. `usePretable` in model mode checks
for the symbol, subscribes via `useSyncExternalStore`, and merges it into the
`rows` slot. No conflict possible: in model mode `usePretable` performs no
rows write of its own. Core/row-model packages untouched.

**Surface callback.** `PretableSurface` subscribes with an effect and invokes
`onRejectedWriteChange` whenever the derived record's identity changes —
including a rejection in the mount commit (an invalid INITIAL `rows` is a real
case: the model keeps its empty previous state) and the clear on recovery.
All-null at mount fires nothing.

## Edge cases

- **Same-kind rejection replaces.** Bad page A (duplicate id) then bad page B
  (accessor throws): slot updates to B's fault, callback fires. The direct fix
  for "a second rejection of the same kind is silent".
- **Re-passed refused value.** Attempted-once stands; the slot stays non-null;
  no duplicate callback (record unchanged).
- **Recovery that immediately re-rejects.** Slot goes fault-A → fault-B in one
  effect pass; the intermediate null never publishes (the store is written
  once per effect with the final state). No false "recovered" flicker.
- **Query async rejection ordering.** A `.then` rejection arriving after the
  consumer already passed a newer query is not published against the newer
  query — the slot only ever describes the value currently recorded as
  last-requested (mirrors the sibling guards' stale-settle suppression).
- **Unmount.** Subscriptions tear down with the hook; a post-unmount `.then`
  rejection publishes to a store nobody reads — harmless.
- **`columnId` absence.** Duck-typed foreign errors can lack
  `columnId`/`path`; the public field is optional and simply omitted — never a
  `"(unknown location)"` placeholder.
- **Never here:** fatal codes, plain `Error`s, the four
  `apply-transaction`-only codes; `resultMeta` total/window disagreements
  (telemetry's job).

## Testing

In `packages/react`, building on the shared rejected-write harness (#563):

- Per kind: reject → `model.rejectedWrites.<kind>` carries the right `code`;
  recovery clears it AT the recovering render (probe component, pinning the
  #561 one-render-early identity behavior).
- Second same-kind rejection updates the record and re-fires the callback —
  the disproving twin of the latched warning.
- `useLocalRowModel` path: reject through model mode, read the same
  `rejectedWrites.rows`; false-negative pin — the test must fail if the symbol
  merge is deleted.
- Callback: fires on reject, on recovery-clear, on mount-commit rejection;
  does NOT fire on ordinary renders or valid page changes (render-count
  discipline as in #561).
- Old behavior survives: valid writes still land; console warnings unchanged
  (still latch).
- Mutation-test the key assertions: delete the merge, delete the clear, swap
  the fault — each must break a named test.

Known harness trap (from the sibling suites): the model proxy is not
identity-transparent for filter/sort authority WeakMaps; no test may depend on
filter/sort authority through a proxy.

## Rollout

- One PR against `main`, in a worktree.
- API gate: `pnpm build` then `pnpm api` (stale-dist trap), commit
  `react.api.md`. New public symbols will trip the test-pinned docs tables
  under `apps/website/content/` — add docs entries and register any new table.
- Changeset: minor (`@pretable/react`). The changelog retracts "there is no
  API to ask whether the rendered rows match the ones you passed".
- `pnpm format` at root before committing; node ^24.15.0; `pnpm test` in
  `packages/react` (never bare vitest); re-run flaky timeouts before
  believing a failure.
