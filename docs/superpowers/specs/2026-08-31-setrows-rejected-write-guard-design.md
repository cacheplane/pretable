# A rejected `setRows` is not fatal

Date: 2026-08-31
Status: approved, ready for planning

## Problem

`packages/react/src/use-pretable.ts` has a rows-mode layout effect that writes
three things to the row model. Two of them are guarded, so an invalid update is
a _rejected write_ — the model keeps its last-good value and the grid stays
interactive:

- `rowModel.setDerivations(...)` — PR #550
- `applyQuery`'s `rowModel.setQuery(...)` — PR #553

`rowModel.setRows(...)` is the remaining unguarded call. A throw there escapes
the React commit and unmounts the live grid subtree.

## What was measured

A throwaway probe (deleted; findings reproduced here) established four things.
The measurement materially revised the premise this work started from.

### 1. The seam is fatal

Any throw out of `setRows` in that layout effect destroys the subtree:

| injected out of `setRows`       | escaped commit | data rows | container bytes | later valid `setRows` |
| ------------------------------- | -------------- | --------- | --------------- | --------------------- |
| `CompiledQueryValidationError`  | yes            | 3 → **0** | 8705 → **0**    | recovers              |
| `PretableSetRowsExecutionError` | yes            | 3 → **0** | 8705 → **0**    | recovers              |

### 2. The originally-targeted error is UNREACHABLE

`create-local-row-model.ts:1094` does compile the query on the
`sameReferenceMutation` branch, and that branch **does fire** — confirmed by the
`same-reference-row-mutation` diagnostic reaching the `onDiagnostic` sink.

It cannot throw. `create-local-row-model.ts:673-674` stores
`queryPlan.derivations` / `queryPlan.query` — already-**captured** clones, not
raw consumer objects. Capture is idempotent and getter-free: an aggregate getter
rigged to explode on its second read is read exactly **once**, and recompiling a
captured plan throws nothing. Authority cannot invalidate either — `compileQuery`
validates only that it is `"engine" | "external"` and thereafter _strips_
filters/sort.

This is "no path found", not a formal proof, but it closes every candidate
identified.

> **Trap for a future reader.** The first probe reported "branch fired = NO"
> **vacuously** — it passed `onRowIntegrityDiagnostic`, and the real option is
> `onDiagnostic`. The corrected probe needed a positive control (mutate twice,
> see two diagnostics) before the negative result meant anything.

### 3. The real fatality is a different error

Five ordinary bad-`rows` props, every one fatal:

| bad `rows` prop        | error name              | rows      | recovers |
| ---------------------- | ----------------------- | --------- | -------- |
| duplicate row ids      | `PretableRowModelError` | 3 → **0** | yes      |
| accessor throws        | `PretableRowModelError` | 3 → **0** | yes      |
| `getRowId` → undefined | `PretableRowModelError` | 3 → **0** | yes      |
| a null row             | `PretableRowModelError` | 3 → **0** | yes      |
| row id is an object    | `PretableRowModelError` | 3 → **0** | yes      |

The name is the **base** class, not `PretableSetRowsExecutionError`:
`remapSetRowsError` wraps only when `error.operation !== "set-rows"`, and these
_are_ set-rows faults. The accepted-name set anticipated on
`REJECTED_WRITE_ERROR_NAMES` would not have caught one real case.

### 4. Recovery always works

A later valid `rows` array recovers in every scenario measured.

## Decisions

### Acceptance is by `code`, not by `name`

`PretableSetRowsExecutionError`'s constructor calls
`super(error.code, error.message, { operation: "set-rows", … })` — **`code`
survives the remap wrapper; `name` does not.** A code check therefore catches the
unwrapped and wrapped forms uniformly, and does not silently miss a subclass
added later — and does not depend on enumerating the subclasses at all. Most
`PretableRowModelError` subclasses override `name`, but NOT all:
`TransactionExecutionError` (`transaction-draft.ts:113`) does not, and inherits
`"PretableRowModelError"` — which is exactly why a name check would be the
fragile axis here.

`PretableRowModelErrorCode` is a `@public` union of 12 codes, split by whether
the fault is _data_ or _lifecycle/programming_:

| rejectable (bad data in `rows`)                                                                                           | must propagate                         |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `duplicate-row-id`, `accessor-failed`, `invalid-group-key`, `comparator-failed`, `aggregator-failed`, `derivation-failed` | `disposed-model`, `reentrant-mutation` |

The remaining four (`existing-row-id`, `transaction-conflict`,
`row-identity-change`, `unsupported-row-update`) are `apply-transaction`-only and
unreachable through `setRows`; they are excluded rather than added "for safety",
so the set states what is actually reachable.

Allowlist, not denylist: a code added later propagates rather than being
swallowed.

### Rejection keeps the previous rows, and warns once

Sibling-consistent. The grid keeps the rows it already had.

This is a stronger claim than the siblings make. For derivations and query the
kept value is a display nuance; for rows the consumer's data and the screen have
_diverged_. Two alternatives were considered and rejected: warning on every
rejection (floods a streaming feed with a persistent bad row), and exposing
divergence on the public API so a consumer can render their own banner (a
feature, not a bug fix; nothing measured says it is needed yet).

### The warn key deliberately omits `rowId`

`rows-rejected:${code}:${columnId ?? "(no column)"}`.

The siblings key on `columnId` + index-stripped `path` + `detail`. Rows omit both
`rowId` and the message on purpose: a streaming feed carrying many distinct bad
rows would key uniquely per row and flood the console — the failure mode the
"warn every time" option was rejected for. A consumer told once that they have a
duplicate row id has the information; the second bad id teaches nothing new.
Different fault _kinds_ still warn.

This is the one place the rows guard is deliberately **less** discriminating than
its siblings.

## Design

### The guard

At `use-pretable.ts:706`:

```js
if (lastRows.current !== rowsOptions.rows) {
  lastRows.current = rowsOptions.rows; // recorded BEFORE the throwing call
  try {
    rowModel.setRows(rowsOptions.rows);
  } catch (error) {
    reportRejectedWrite(error, rowModelCodeGuard("rows-rejected", describe));
  }
}
```

`lastRows.current` follows the sibling rule — recorded before the call and **not**
rolled back, so a rejected array is attempted once instead of recompiling on
every later render. Recovery is unaffected: a later valid array is a new
identity, so the gate opens for it.

Simpler than the siblings in one respect: `setRows` returns a synchronous
`PretableMutationResult`, not a transition, so there is no `.finished` to chain
and no unhandled rejection to swallow.

### The helper

`reportRejectedWrite` is currently parameterized on `acceptedNames:
ReadonlySet<string>`. That parameterization was designed for a third guard
accepting `CompiledQueryValidationError` + `PretableSetRowsExecutionError` —
neither of which is what actually comes out — so it is revised rather than
reused.

Two problems block reuse as-is. The siblings' `CompiledQueryValidationError`
extends `TypeError` and has **no `code`**, so names remain correct for them. And
the fault shape `{ columnId, detail, path }` degrades for row errors: `path` is
always `"(unknown location)"` and the key drops `code`, making it _less_
discriminating than the keying decided above.

Resolution — one mechanism, two guard factories:

- `compiledQueryGuard(warnKeyPrefix, describe)` — name-based. **Both** sibling
  sites share it, so they stay byte-identical in executable logic: the property
  the original extraction existed to protect.
- `rowModelCodeGuard(warnKeyPrefix, describe)` — code-based, accepting exactly the six
  data-fault codes.

`reportRejectedWrite` shrinks to what it genuinely owns: accept-or-rethrow,
`warnOnce` with the composed key, and calling `describe`.

### Wording

Stronger than the sibling messages, because the claim is stronger — the grid is
showing rows the consumer has replaced, not a stale aggregate. Substance: the
grid kept its previous rows, so it is showing data from before this update, and
the rows on screen no longer match the ones passed in.

## Testing

### `packages/react/src/__tests__/invalid-rows-rejected.test.tsx` (new)

Mirrors the two sibling files.

- each of the five real faults is rejected, not fatal (rows stay 3, bytes > 0)
- **disproving pin**: the baseline count differs from the post-reject count, so
  "kept the previous rows" can actually fail. A baseline whose surviving count
  equals the unfiltered count cannot tell a kept row set from a cleared one.
- `disposed-model` and `reentrant-mutation` **propagate** — seam-injected via a
  model proxy, since neither is reachable from a `rows` prop
- a plain `Error` propagates
- anti-latching: a different fault _code_ still warns
- attempted-once: a re-passed bad array does not call `setRows` again (the proxy
  counts calls)
- **the old behaviour survives**: a valid `setRows` still updates the rendered
  rows — the guard must not disable the feature it wraps

> The sibling files warn that the model proxy is **not identity-transparent**:
> `ɵsetLocalRowModelFilterAuthority` / `ɵsetLocalRowModelSortAuthority` look the
> model up in WeakMaps keyed by the raw object and swallow a miss with `?.`, so
> those writes are silent no-ops under the proxy. No test here may depend on
> filter/sort authority, or it passes vacuously.

`resetDevWarnings()` in `beforeEach`: `warnOnce` keeps emitted keys in module
state, so without it the second test to provoke a fault sees no warning.

### Row-model unreachability pin

Asserts finding 2, so a future reader does not "restore" a guard for a fault that
cannot occur:

- the `sameReferenceMutation` branch **fires** — asserted through the
  `same-reference-row-mutation` diagnostic, with the positive control that made
  the original negative result meaningful
- the recompile **does not throw** with an aggregate getter rigged to explode on
  a second read, and that getter is read exactly **once**

### Doc correction

`REJECTED_WRITE_ERROR_NAMES`'s comment currently tells a future reader that a
`setRows` guard "would accept two names" — `CompiledQueryValidationError` and
`PretableSetRowsExecutionError`. Both are wrong. Corrected to record what was
measured.

### Coherence check (during implementation)

Confirm the grid is _coherent_ after a rejection, not merely non-empty: selection
and row count agree with the rows still displayed.

## Out of scope

- Exposing row divergence on the public API (option C above) — a feature, and
  gated by api-extractor + docs if ever taken up.
- Any change to `remapSetRowsError` or the row-model error taxonomy.

## Environment

This repo needs node `^24.15.0`. A default of v22 makes nothing build and
produces bogus `Cannot find module '@pretable/core'` typecheck errors.
