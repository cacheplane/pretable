# Rejected-Writes Public API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A consumer can ask, in code, whether the grid's rendered rows/derivations/query match the ones they passed — via `model.rejectedWrites` and an `onRejectedWriteChange` Surface prop.

**Architecture:** Generalize #561's notifying `RowsWriteState` store in `use-pretable.ts` to carry a per-kind `{refused, fault}` slot for all three guarded writes; derive a referentially-stable public `PretableRejectedWrites` record; merge `useLocalRowModel`'s rejections (rows AND derivations) in via a react-internal Symbol channel on the model instance; fire a Surface callback on record identity change.

**Tech Stack:** React 18 `useSyncExternalStore`, vitest + @testing-library/react (jsdom), api-extractor gate, test-pinned docs.

**Spec:** `docs/superpowers/specs/2026-09-01-rejected-writes-public-api-design.md`. Two corrections found while reading code, both incorporated below:
- `useLocalRowModel` guards derivations too (`local-derivations-rejected`), so the symbol channel carries `{rows, derivations}` slots, and `rejectedWrites.derivations` covers both entry points, same as `rows`.
- There is no "mount-commit rejection": invalid INITIAL rows throw inside `createLocalRowModel`'s `useState` initializer (a creation fault, out of scope, unchanged). The first possible rejection is the first UPDATE. No mount-rejection test; the callback contract is simply "never fires while the record is the initial all-null".

**Environment (read first):**
- node ^24.15.0 (v22 gives phantom `Cannot find module '@pretable/core'`).
- Tests: `cd packages/react && pnpm test` — NEVER bare `npx vitest run` (~747 spurious "document is not defined"). 1–2 random tests can time out under load; re-run before believing a failure.
- `pnpm format` at repo root before every commit (required `format` CI check).
- Work in this worktree; do not `cd` to `~/repos/pretable`; never bare `git stash`.

**Files (whole plan):**
- Modify: `packages/react/src/rejected-write.ts` — public types, equality, `reportRejectedWrite` returns the fault+message
- Create: `packages/react/src/local-rejected-writes.ts` — Symbol channel store
- Modify: `packages/react/src/use-pretable.ts` — store generalization, guard wiring, derived record, return value
- Modify: `packages/react/src/pretable-model.ts` — `PretableModel.rejectedWrites`; `usePretableModelInternal` return `Omit<..., "rejectedWrites">`
- Modify: `packages/react/src/use-local-row-model.ts` — publish into the channel
- Modify: `packages/react/src/pretable-surface.tsx` — `onRejectedWriteChange` prop + effect
- Modify: `packages/react/src/labeled-grid-surface.tsx` — forward the prop (parity with `onTelemetryChange` at lines 129/197/272)
- Modify: `packages/react/src/public_api.ts` — export the two types
- Create: `packages/react/src/__tests__/rejected-writes-public-api.test.tsx`
- Modify: `packages/react/react.api.md` (generated), `apps/website/content/docs/grid/pretable-surface.mdx`, `.changeset/*`

---

### Task 1: Public types + guard fault return (`rejected-write.ts`)

**Files:**
- Modify: `packages/react/src/rejected-write.ts`
- Modify: `packages/react/src/public_api.ts`
- Test: `packages/react/src/__tests__/rejected-write-record.test.ts` (new, node env — pure module, no DOM)

- [ ] **Step 1.1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";

import {
  EMPTY_REJECTED_WRITES,
  INVALID_QUERY_CODE,
  compiledQueryGuard,
  rejectedWriteEquals,
  reportRejectedWrite,
  rowModelCodeGuard,
  toRejectedWrite,
} from "../rejected-write";

function rowModelError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "name", { value: "PretableRowModelError" });
  Object.defineProperty(error, "code", { value: code });
  return error;
}

describe("reportRejectedWrite return value", () => {
  test("returns the fault and the described message for an accepted error", () => {
    const guard = rowModelCodeGuard(
      "test-rows-rejected",
      ({ detail }) => `described: ${detail}`,
    );
    const report = reportRejectedWrite(
      rowModelError("duplicate-row-id", "Duplicate row ID dup."),
      guard,
    );
    expect(report.fault.code).toBe("duplicate-row-id");
    expect(report.message).toBe("described: Duplicate row ID dup.");
  });

  test("still rethrows an unaccepted error", () => {
    const guard = rowModelCodeGuard("test-rows-rejected", () => "unused");
    expect(() => reportRejectedWrite(new Error("plain"), guard)).toThrow(
      "plain",
    );
  });

  test("compiled-query guard reports with the invalid-query code vocabulary", () => {
    const error = new Error("bad filter");
    Object.defineProperty(error, "name", {
      value: "CompiledQueryValidationError",
    });
    const guard = compiledQueryGuard(
      "test-query-rejected",
      ({ detail }) => `q: ${detail}`,
    );
    const report = reportRejectedWrite(error, guard);
    expect(report.message).toBe("q: bad filter");
    // The public record for compiled-query rejections carries this constant.
    expect(INVALID_QUERY_CODE).toBe("invalid-query");
  });
});

describe("toRejectedWrite", () => {
  test("omits columnId rather than carrying undefined", () => {
    const record = toRejectedWrite("rows", "duplicate-row-id", "m", undefined);
    expect("columnId" in record).toBe(false);
    const withColumn = toRejectedWrite("rows", "accessor-failed", "m", "qty");
    expect(withColumn.columnId).toBe("qty");
  });
});

describe("rejectedWriteEquals", () => {
  const a = toRejectedWrite("rows", "duplicate-row-id", "m", "qty");
  test("null/null equal, null/value not", () => {
    expect(rejectedWriteEquals(null, null)).toBe(true);
    expect(rejectedWriteEquals(a, null)).toBe(false);
    expect(rejectedWriteEquals(null, a)).toBe(false);
  });
  test("field-equal records are equal; any field difference is not", () => {
    expect(
      rejectedWriteEquals(a, toRejectedWrite("rows", "duplicate-row-id", "m", "qty")),
    ).toBe(true);
    expect(
      rejectedWriteEquals(a, toRejectedWrite("rows", "accessor-failed", "m", "qty")),
    ).toBe(false);
    expect(
      rejectedWriteEquals(a, toRejectedWrite("rows", "duplicate-row-id", "m2", "qty")),
    ).toBe(false);
    expect(
      rejectedWriteEquals(a, toRejectedWrite("rows", "duplicate-row-id", "m", undefined)),
    ).toBe(false);
    expect(
      rejectedWriteEquals(a, toRejectedWrite("query", "duplicate-row-id", "m", "qty")),
    ).toBe(false);
  });
});

describe("EMPTY_REJECTED_WRITES", () => {
  test("is all-null and frozen", () => {
    expect(EMPTY_REJECTED_WRITES).toEqual({
      rows: null,
      derivations: null,
      query: null,
    });
    expect(Object.isFrozen(EMPTY_REJECTED_WRITES)).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run it, verify it fails**

Run: `cd packages/react && pnpm test -- rejected-write-record`
Expected: FAIL — `EMPTY_REJECTED_WRITES`/`toRejectedWrite`/`rejectedWriteEquals`/`INVALID_QUERY_CODE` are not exported; `reportRejectedWrite` returns void.

- [ ] **Step 1.3: Implement in `rejected-write.ts`**

Add after the imports (before `CompiledQueryFault`):

```ts
/**
 * Why the grid refused a write, at the moment it refused it. One record per
 * write kind lives on {@link PretableRejectedWrites}; `null` there means that
 * write is in sync.
 *
 * @public
 */
export interface PretableRejectedWrite {
  readonly kind: "rows" | "derivations" | "query";
  /**
   * The fault code. For `rows`, a member of `PretableRowModelErrorCode`
   * (e.g. `"duplicate-row-id"`); for `derivations`/`query`,
   * {@link INVALID_QUERY_CODE}.
   */
  readonly code: string;
  /** Same substance as the console warning — without the latching. */
  readonly message: string;
  /** Present when the fault names a column. Never a placeholder string. */
  readonly columnId?: string;
}

/**
 * Per-write-kind divergence state. A `null` slot means the grid's value for
 * that kind is the one most recently passed. A non-null slot means the grid
 * kept its previous value and describes the most recent rejection of that
 * kind — each rejection REPLACES the record; nothing latches here.
 *
 * @public
 */
export interface PretableRejectedWrites {
  readonly rows: PretableRejectedWrite | null;
  readonly derivations: PretableRejectedWrite | null;
  readonly query: PretableRejectedWrite | null;
}

/**
 * The one all-null record. A shared constant, not a fresh literal, so "in
 * sync" has ONE identity: the derived-record memo returns it whenever every
 * slot is null, which is what lets the surface's identity compare skip firing
 * `onRejectedWriteChange` across unrelated renders.
 */
export const EMPTY_REJECTED_WRITES: PretableRejectedWrites = Object.freeze({
  rows: null,
  derivations: null,
  query: null,
});

/**
 * The public `code` for every compiled-query rejection.
 * `CompiledQueryValidationError` carries this literal itself; the guard
 * accepts by NAME (see {@link compiledQueryGuard}), so a duck-typed foreign
 * error may arrive without one — the constant keeps the public vocabulary
 * total either way.
 */
export const INVALID_QUERY_CODE = "invalid-query";

/** Build a record, omitting `columnId` rather than carrying `undefined`. */
export function toRejectedWrite(
  kind: PretableRejectedWrite["kind"],
  code: string,
  message: string,
  columnId: string | undefined,
): PretableRejectedWrite {
  return columnId === undefined
    ? { kind, code, message }
    : { kind, code, message, columnId };
}

/**
 * Field equality for slot normalization: a re-rejection that changes nothing
 * observable (same kind/code/message/column) must not notify subscribers or
 * change the record's identity.
 */
export function rejectedWriteEquals(
  a: PretableRejectedWrite | null,
  b: PretableRejectedWrite | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.kind === b.kind &&
    a.code === b.code &&
    a.message === b.message &&
    a.columnId === b.columnId
  );
}
```

Change `reportRejectedWrite`'s tail (keep the doc comment, extend it with one line: "Returns the accepted fault and its described message, so a caller can publish a `PretableRejectedWrite` without re-deriving either."):

```ts
export function reportRejectedWrite<TFault>(
  error: unknown,
  guard: RejectedWriteGuard<TFault>,
): { readonly fault: TFault; readonly message: string } {
  if (!(error instanceof Error) || !guard.isAccepted(error)) throw error;
  const fault = guard.readFault(error);
  const message = guard.describe(fault);
  warnOnce(guard.warnKey(fault), message);
  return { fault, message };
}
```

- [ ] **Step 1.4: Export the public types**

In `packages/react/src/public_api.ts`, near the other type exports add:

```ts
export type {
  PretableRejectedWrite,
  PretableRejectedWrites,
} from "./rejected-write";
```

(Only the two interfaces. `EMPTY_REJECTED_WRITES`, `toRejectedWrite`, `rejectedWriteEquals`, `INVALID_QUERY_CODE` stay internal.)

- [ ] **Step 1.5: Run the new test + the four existing rejected suites**

Run: `cd packages/react && pnpm test -- rejected-write-record invalid-rows-rejected invalid-local-rows-rejected invalid-derivations-rejected invalid-query-rejected`
Expected: all PASS (the return-value change is call-site compatible).

- [ ] **Step 1.6: Commit**

```bash
git add packages/react/src/rejected-write.ts packages/react/src/public_api.ts packages/react/src/__tests__/rejected-write-record.test.ts
pnpm format && git add -A && git commit -m "feat(react): rejected-write records and guard fault return"
```

---

### Task 2: Store generalization + `model.rejectedWrites` (`use-pretable.ts`, `pretable-model.ts`)

**Files:**
- Modify: `packages/react/src/use-pretable.ts` (store ~L87–190, guard effect ~L617–888, return L1072)
- Modify: `packages/react/src/pretable-model.ts` (interface L482–498, `usePretableModelInternal` return L582)
- Test: `packages/react/src/__tests__/rejected-writes-public-api.test.tsx` (new)

- [ ] **Step 2.1: Write the failing tests (probe-component pattern)**

Crib fault fixtures from the existing suites: bad-rows arrays from `invalid-rows-rejected.test.tsx`, an invalid aggregate column from `invalid-derivations-rejected.test.tsx`, an unknown-column query from `invalid-query-rejected.test.tsx`. Use the shared harness (`rejected-write-harness.ts`) for `installWarnSpy`/fixtures. Skeleton (executor: keep the shape; adapt option/fixture names to what the cribbed suites actually use — they are the source of truth for how to provoke each fault):

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { PretableRejectedWrites } from "../rejected-write";
import { usePretable } from "../use-pretable";
import {
  COLUMNS,
  ROWS,
  RECOVERY_ROWS,
  getRowId,
  installWarnSpy,
} from "./rejected-write-harness";

const warnSpy = installWarnSpy();

/** Duplicate id — rejects with code "duplicate-row-id". */
const DUPLICATE_ROWS = [...ROWS, { ...ROWS[0] }];

let latest: { rejectedWrites: PretableRejectedWrites } | null = null;

function Probe(props: { rows: readonly (typeof ROWS)[number][] }) {
  latest = usePretable({ rows: props.rows, columns: COLUMNS, getRowId });
  return null;
}

describe("model.rejectedWrites — rows", () => {
  test("starts in sync, flips on rejection with the fault, clears on recovery", () => {
    const view = render(<Probe rows={ROWS} />);
    const initial = latest!.rejectedWrites;
    expect(initial).toEqual({ rows: null, derivations: null, query: null });

    act(() => void view.rerender(<Probe rows={DUPLICATE_ROWS} />));
    const rejected = latest!.rejectedWrites;
    expect(rejected.rows).toMatchObject({
      kind: "rows",
      code: "duplicate-row-id",
    });
    expect(rejected.rows!.message).toMatch(/no longer\s+match the ones you passed/);
    expect(rejected.derivations).toBeNull();
    expect(rejected.query).toBeNull();

    act(() => void view.rerender(<Probe rows={RECOVERY_ROWS} />));
    expect(latest!.rejectedWrites.rows).toBeNull();
    // Recovery returns to the SHARED empty identity.
    expect(latest!.rejectedWrites).toBe(initial);
  });

  test("a second same-kind rejection replaces the record even though the warning latched", () => {
    const view = render(<Probe rows={ROWS} />);
    act(() => void view.rerender(<Probe rows={DUPLICATE_ROWS} />));
    const first = latest!.rejectedWrites.rows!;
    expect(warnSpy()).toHaveBeenCalledTimes(1);

    // Different fault kind on the rows write: a row whose accessor throws
    // (crib the exact fixture from invalid-rows-rejected.test.tsx).
    const THROWING_ROWS = [
      ...ROWS,
      new Proxy({ id: "boom", sector: "Tech", qty: 1 }, {
        get(target, prop) {
          if (prop === "qty") throw new Error("hostile qty");
          return Reflect.get(target, prop);
        },
      }) as (typeof ROWS)[number],
    ];
    act(() => void view.rerender(<Probe rows={THROWING_ROWS} />));
    const second = latest!.rejectedWrites.rows!;
    expect(second).not.toBe(first);
    expect(second.code).not.toBe(first.code);
  });

  test("record identity is stable across renders that change nothing", () => {
    const view = render(<Probe rows={ROWS} />);
    act(() => void view.rerender(<Probe rows={DUPLICATE_ROWS} />));
    const before = latest!.rejectedWrites;
    act(() => void view.rerender(<Probe rows={DUPLICATE_ROWS} />));
    expect(latest!.rejectedWrites).toBe(before);
  });
});

// + a derivations describe (invalid aggregate column → rejectedWrites.derivations
//   with kind "derivations" and code "invalid-query"; rows/query stay null;
//   recovery via a corrected columns array clears it)
// + a query describe (unknown-column query → rejectedWrites.query; a corrected
//   query clears it; a rejected query does NOT taint rows/derivations)
```

- [ ] **Step 2.2: Run, verify failure**

Run: `cd packages/react && pnpm test -- rejected-writes-public-api`
Expected: FAIL — `rejectedWrites` is not a property of the return value (TypeScript error or `undefined`).

- [ ] **Step 2.3: Generalize the store in `use-pretable.ts`**

Extend `RowsWriteState` (keep existing fields and doc comments; add):

```ts
interface RejectedWriteSlot {
  /** The refused value's identity — the clear-on-recovery mechanism. */
  readonly refused: unknown;
  readonly fault: PretableRejectedWrite;
}

interface RowsWriteState {
  readonly rejectedRows: unknown;                      // unchanged (#561)
  readonly coherentWindowStart: number | undefined;    // unchanged (#561)
  /** The rows fault paired with `rejectedRows`; null when the last rows write landed. */
  readonly rowsFault: PretableRejectedWrite | null;
  readonly derivations: RejectedWriteSlot | null;
  readonly query: RejectedWriteSlot | null;
}
```

`createRowsWriteStore`: initial snapshot gains `rowsFault: null, derivations: null, query: null`. `publish` normalizes slots (preserve identity when field-equal) before the change check:

```ts
publish(next: RowsWriteState) {
  const rowsFault = rejectedWriteEquals(snapshot.rowsFault, next.rowsFault)
    ? snapshot.rowsFault
    : next.rowsFault;
  const derivations = slotOrPrevious(snapshot.derivations, next.derivations);
  const query = slotOrPrevious(snapshot.query, next.query);
  if (
    snapshot.rejectedRows === next.rejectedRows &&
    snapshot.coherentWindowStart === next.coherentWindowStart &&
    snapshot.rowsFault === rowsFault &&
    snapshot.derivations === derivations &&
    snapshot.query === query
  ) {
    return;
  }
  snapshot = { ...next, rowsFault, derivations, query };
  for (const listener of Array.from(listeners)) listener();
}
```

with, above the factory:

```ts
function slotOrPrevious(
  previous: RejectedWriteSlot | null,
  next: RejectedWriteSlot | null,
): RejectedWriteSlot | null {
  if (previous === next) return previous;
  if (previous === null || next === null) return next;
  return previous.refused === next.refused &&
    rejectedWriteEquals(previous.fault, next.fault)
    ? previous
    : next;
}
```

- [ ] **Step 2.4: Wire the three guards**

In the rows-mode layout effect:

a) **Rows** (~L660): hoist the guard so `describe` is shared; capture the fault:

```ts
let rowsFault: PretableRejectedWrite | null = null;
// inside the existing catch, replacing the bare reportRejectedWrite call:
const report = reportRejectedWrite(error, rowsGuard);
rowsFault = toRejectedWrite(
  "rows",
  report.fault.code,
  report.message,
  report.fault.columnId,
);
rejected = true;
```

(`rowsGuard` is the existing inline `rowModelCodeGuard("rows-rejected", …)` moved to a `const` just above the `try`. Keep every existing comment.)

b) **Move the `rowsWriteStore.publish` below the derivations block** so one publish carries rows + derivations + the query CLEAR. It becomes:

```ts
rowsWriteStore.publish({
  rejectedRows,
  rowsFault: rowsWriteAttempted
    ? rowsFault
    : previousWrite.rowsFault,
  coherentWindowStart:
    rowsOptions.rows === rejectedRows
      ? previousWrite.coherentWindowStart
      : rowsOptions.ɵwindowStart,
  derivations: derivationsChanged
    ? derivationsFault === null
      ? null
      : { refused: derivations, fault: derivationsFault }
    : previousWrite.derivations,
  // A changed controlled query is a new "last requested": the old refusal no
  // longer describes it. A rejection of the NEW query re-publishes from
  // applyQuery below (sync or from the .then chain), generation-gated so a
  // stale rejection never lands against a newer query.
  query: controlledQueryChanged ? null : previousWrite.query,
});
```

where the derivations `catch` sets `let derivationsFault: PretableRejectedWrite | null = null;` via the same `reportRejectedWrite` return pattern, with `toRejectedWrite("derivations", INVALID_QUERY_CODE, report.message, report.fault.columnId)`.

The moved publish stays inside the same synchronous effect, so the "resultMeta-only update refreshes the coherent window" behavior is unchanged — keep that comment with it.

c) **Query** (inside `applyQuery`, ~L845): on rejection, read-modify-write; on a landed transition, clear:

```ts
} catch (error) {
  const report = reportRejectedWrite(error, queryGuard);
  rowsWriteStore.publish({
    ...rowsWriteStore.getSnapshot(),
    query: {
      refused: desiredQuery,
      fault: toRejectedWrite(
        "query",
        INVALID_QUERY_CODE,
        report.message,
        report.fault.columnId,
      ),
    },
  });
}
if (transition !== undefined) {
  rowsWriteStore.publish({
    ...rowsWriteStore.getSnapshot(),
    query: null,
  });
  void transition.finished.catch(() => undefined);
}
```

(`queryGuard` = the existing inline `compiledQueryGuard("query-rejected", …)` hoisted to a `const` above the `try`. The clear on the landed path matters for the derivations-re-apply case: a query rejected earlier can land later when a derivations change re-runs `applyQuery` with the model now holding the missing column. The `queryReconciliationGeneration` early-return already guarantees a STALE `applyQuery` — superseded by a newer query — publishes nothing at all; add a comment saying so.)

- [ ] **Step 2.5: Derive and return the record**

After the `rowsWrite` `useSyncExternalStore` (~L558):

```ts
const ownRowsFault = rowsWrite.rowsFault;
const ownDerivationsFault = rowsWrite.derivations?.fault ?? null;
const ownQueryFault = rowsWrite.query?.fault ?? null;
/*
 * Deps are the FAULTS, never the whole snapshot: `coherentWindowStart` moves
 * on every valid page change, and a record identity that moved with it would
 * fire `onRejectedWriteChange` on ordinary paging. `publish`'s slot
 * normalization is what makes these deps stable across no-op republishes.
 * (localSlots is added in Task 3; until then use EMPTY placeholders.)
 */
const rejectedWrites = useMemo<PretableRejectedWrites>(() => {
  if (
    ownRowsFault === null &&
    ownDerivationsFault === null &&
    ownQueryFault === null
  ) {
    return EMPTY_REJECTED_WRITES;
  }
  return {
    rows: ownRowsFault,
    derivations: ownDerivationsFault,
    query: ownQueryFault,
  };
}, [ownRowsFault, ownDerivationsFault, ownQueryFault]);
```

Return (L1072): `return { ...table, ɵrowsWrite: rowsWrite, rejectedWrites };`

- [ ] **Step 2.6: `PretableModel` gains the field**

`pretable-model.ts` L482–498: add to the interface (with a short doc comment pointing at `PretableRejectedWrites`):

```ts
readonly rejectedWrites: PretableRejectedWrites;
```

import the type from `./rejected-write`. Change `usePretableModelInternal`'s declared return (L582) to:

```ts
): Omit<PretableModel<TRow, TRowId, TColumns, TColumnId>, "rejectedWrites"> & {
  /** @internal See {@link WindowState}. */
  readonly setWindowState: (next: WindowState) => void;
} {
```

(`usePretable` is the only public producer of `PretableModel`; it adds the field. If typecheck reveals another producer, add the field there from its own store — do not default it to a fresh literal.)

- [ ] **Step 2.7: Run tests**

Run: `cd packages/react && pnpm test -- rejected-writes-public-api invalid-rows-rejected invalid-derivations-rejected invalid-query-rejected rejected-rows-data-honesty`
Expected: all PASS. `rejected-rows-data-honesty` is the canary that the #561 fields still behave — if it fails, the store restructure broke the honesty seam; fix before proceeding.

- [ ] **Step 2.8: Mutation checks (manual, then revert)**

1. In the memo, change deps to `[rowsWrite]`: the "identity stable across renders" test must FAIL (windowed paging would churn identity — if no test fails, the identity pin is vacuous; strengthen it before continuing).
2. Delete the `query: null` clear on the landed-transition path: the query-recovery assertion must FAIL.
Revert both.

- [ ] **Step 2.9: Commit**

```bash
pnpm format && git add -A && git commit -m "feat(react): publish per-kind rejected-write state on PretableModel"
```

---

### Task 3: `useLocalRowModel` channel + merge

**Files:**
- Create: `packages/react/src/local-rejected-writes.ts`
- Modify: `packages/react/src/use-local-row-model.ts`
- Modify: `packages/react/src/use-pretable.ts`
- Test: extend `packages/react/src/__tests__/rejected-writes-public-api.test.tsx`

- [ ] **Step 3.1: Write the failing tests**

```tsx
import { useLocalRowModel } from "../use-local-row-model";

let latestModelMode: { rejectedWrites: PretableRejectedWrites } | null = null;

function ModelModeProbe(props: { rows: readonly (typeof ROWS)[number][] }) {
  const model = useLocalRowModel({ rows: props.rows, columns: COLUMNS, getRowId });
  latestModelMode = usePretable({ model });
  return null;
}

describe("useLocalRowModel rejections reach the same record", () => {
  test("a rejected local rows update surfaces on rejectedWrites.rows and clears on recovery", () => {
    const view = render(<ModelModeProbe rows={ROWS} />);
    expect(latestModelMode!.rejectedWrites.rows).toBeNull();

    act(() => void view.rerender(<ModelModeProbe rows={DUPLICATE_ROWS} />));
    expect(latestModelMode!.rejectedWrites.rows).toMatchObject({
      kind: "rows",
      code: "duplicate-row-id",
    });

    act(() => void view.rerender(<ModelModeProbe rows={RECOVERY_ROWS} />));
    expect(latestModelMode!.rejectedWrites).toBe(EMPTY_REJECTED_WRITES_VIA_PROBE);
    // ^ executor: assert `.rows` is null AND the record equals the initial
    //   identity captured before the rejection, as in Task 2's recovery test.
  });

  // + the derivations twin: an invalid derivations option through
  //   useLocalRowModel surfaces on rejectedWrites.derivations (crib the fault
  //   from invalid-local-rows-rejected.test.tsx / the local derivations suite).
});
```

FALSE-NEGATIVE PIN (the load-bearing test): the rejection test above must fail if the symbol merge is deleted — verified by mutation in Step 3.5.

- [ ] **Step 3.2: Run, verify failure**

Run: `cd packages/react && pnpm test -- rejected-writes-public-api`
Expected: the new describe FAILS — `rejectedWrites.rows` stays null in model mode (the local guard's rejection is invisible to `usePretable`).

- [ ] **Step 3.3: Create `local-rejected-writes.ts`**

```ts
import {
  rejectedWriteEquals,
  type PretableRejectedWrite,
} from "./rejected-write";

/**
 * The bridge from `useLocalRowModel`'s rejected-write guards to
 * `usePretable`'s public `rejectedWrites` record.
 *
 * A consumer doing `useLocalRowModel({rows})` + `<PretableSurface model={m}>`
 * never runs `usePretable`'s rows guard — the rejection happens in
 * `useLocalRowModel`'s own layout effect. Without this channel the public
 * record would answer "in sync" for a grid that is diverged: a false negative
 * worse than no API.
 *
 * A Symbol-keyed property on the MODEL INSTANCE, not a WeakMap: the sibling
 * WeakMap channels (`ɵsetLocalRowModelFilterAuthority`) are documented in the
 * rejected suites as silently missing under a test proxy, which is exactly
 * the failure shape this API exists to remove. Both ends live in this
 * package; nothing crosses a package boundary and core/row-model stay
 * unaware.
 *
 * The channel carries FAULTS only, no refused identities: `useLocalRowModel`
 * owns its own `lastRows`/`lastDerivations` gates and publishes
 * attempt-by-attempt, so clearing is decided at the guard, not by the reader.
 * The clear therefore lands in the recovering commit's layout effect — one
 * notifying-store publish before paint — rather than during the recovering
 * render as `usePretable`'s own rows slot does; nothing reads these faults
 * during render for count math, so #561's one-render-early requirement does
 * not apply here.
 *
 * QUERY IS ABSENT by construction: `useLocalRowModel` performs no query
 * write, and in model mode `usePretable`'s own effect returns early, so the
 * merged record's `query` slot is always null for this entry point.
 */
export interface LocalRejectedWriteSlots {
  readonly rows: PretableRejectedWrite | null;
  readonly derivations: PretableRejectedWrite | null;
}

export const EMPTY_LOCAL_SLOTS: LocalRejectedWriteSlots = Object.freeze({
  rows: null,
  derivations: null,
});

export interface LocalRejectedWritesStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => LocalRejectedWriteSlots;
  readonly publish: (next: LocalRejectedWriteSlots) => void;
}

const LOCAL_REJECTED_WRITES = Symbol("pretable.localRejectedWrites");

export function createLocalRejectedWritesStore(): LocalRejectedWritesStore {
  let snapshot = EMPTY_LOCAL_SLOTS;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    publish(next) {
      const rows = rejectedWriteEquals(snapshot.rows, next.rows)
        ? snapshot.rows
        : next.rows;
      const derivations = rejectedWriteEquals(
        snapshot.derivations,
        next.derivations,
      )
        ? snapshot.derivations
        : next.derivations;
      if (snapshot.rows === rows && snapshot.derivations === derivations) {
        return;
      }
      snapshot = { rows, derivations };
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

/** Non-enumerable so serialization/spreads of the model never see it. */
export function attachLocalRejectedWrites(
  model: object,
  store: LocalRejectedWritesStore,
): void {
  Object.defineProperty(model, LOCAL_REJECTED_WRITES, { value: store });
}

export function readLocalRejectedWrites(
  model: object,
): LocalRejectedWritesStore | undefined {
  return (model as Record<PropertyKey, unknown>)[LOCAL_REJECTED_WRITES] as
    | LocalRejectedWritesStore
    | undefined;
}
```

- [ ] **Step 3.4: Publish from `useLocalRowModel`, merge in `usePretable`**

`use-local-row-model.ts`: create + attach in the `useState` initializer:

```ts
const [{ model, rejectedStore }] = useState(() => {
  const created = createLocalRowModel(rawOptions as never) as unknown as {
    /* existing method shape */
  };
  const store = createLocalRejectedWritesStore();
  attachLocalRejectedWrites(created, store);
  return { model: created, rejectedStore: store };
});
```

In the layout effect, hoist both guards to consts (so `describe` is shared with the record), apply the attempt/reject pattern, one publish at the end:

```ts
const previousSlots = rejectedStore.getSnapshot();
let rowsSlot = previousSlots.rows;
if (lastRows.current !== options.rows) {
  lastRows.current = options.rows;
  rowsSlot = null;
  try {
    model.setRows(options.rows as readonly object[]);
  } catch (error) {
    const report = reportRejectedWrite(error, localRowsGuard);
    rowsSlot = toRejectedWrite(
      "rows",
      report.fault.code,
      report.message,
      report.fault.columnId,
    );
  }
}
// derivations gate: identical pattern with localDerivationsGuard and
// toRejectedWrite("derivations", INVALID_QUERY_CODE, report.message, report.fault.columnId)
rejectedStore.publish({ rows: rowsSlot, derivations: derivationsSlot });
```

`use-pretable.ts`: subscribe and merge (after the `rowsWrite` store read; module-level `const noopSubscribe = () => () => {};` and `const emptyLocalSnapshot = () => EMPTY_LOCAL_SLOTS;`):

```ts
/*
 * The model-mode bridge — see `local-rejected-writes.ts`. In rows mode the
 * model is owned and carries no channel, so this subscribes to nothing and
 * every localSlots read is the frozen empty constant.
 */
const localStore = readLocalRejectedWrites(rowModel);
const localSlots = useSyncExternalStore(
  localStore?.subscribe ?? noopSubscribe,
  localStore?.getSnapshot ?? emptyLocalSnapshot,
  localStore?.getSnapshot ?? emptyLocalSnapshot,
);
```

Extend the memo: slots prefer the channel (`localSlots.rows ?? ownRowsFault`, `localSlots.derivations ?? ownDerivationsFault`) — in model mode the own slots are always null (the effect returns early), in rows mode the channel slots are always null, so `??` is a disjoint merge, not a precedence policy. Deps: `[localSlots.rows, localSlots.derivations, ownRowsFault, ownDerivationsFault, ownQueryFault]`.

- [ ] **Step 3.5: Run tests + the mutation pin**

Run: `cd packages/react && pnpm test -- rejected-writes-public-api invalid-local-rows-rejected`
Expected: all PASS.
Mutation: in `usePretable`, replace `readLocalRejectedWrites(rowModel)` with `undefined`. The model-mode rejection test must FAIL. Revert.

- [ ] **Step 3.6: Commit**

```bash
pnpm format && git add -A && git commit -m "feat(react): merge useLocalRowModel rejections into rejectedWrites"
```

---

### Task 4: `onRejectedWriteChange` on the Surface (+ LabeledGridSurface)

**Files:**
- Modify: `packages/react/src/pretable-surface.tsx` (prop type ~L1301, destructure ~L1869, effect next to the telemetry effect ~L5387)
- Modify: `packages/react/src/labeled-grid-surface.tsx` (L129 prop, L197 destructure, L272 forward — mirror `onTelemetryChange`)
- Test: extend `rejected-writes-public-api.test.tsx`

- [ ] **Step 4.1: Write the failing tests**

Render the real `PretableSurface` (crib the minimal props from `invalid-rows-rejected.test.tsx`):

```tsx
describe("onRejectedWriteChange", () => {
  test("silent at mount and on valid updates; fires on rejection and on recovery", () => {
    const calls: PretableRejectedWrites[] = [];
    const surface = (rows: readonly (typeof ROWS)[number][]) => (
      <PretableSurface
        ariaLabel="probe"
        columns={COLUMNS}
        getRowId={getRowId}
        rows={rows}
        onRejectedWriteChange={(next) => calls.push(next)}
      />
    );
    const view = render(surface(ROWS));
    expect(calls).toHaveLength(0);                       // all-null mount

    act(() => void view.rerender(surface(RECOVERY_ROWS)));
    expect(calls).toHaveLength(0);                       // valid update

    act(() => void view.rerender(surface(DUPLICATE_ROWS)));
    expect(calls).toHaveLength(1);                       // rejection
    expect(calls[0]!.rows).toMatchObject({ code: "duplicate-row-id" });

    act(() => void view.rerender(surface(DUPLICATE_ROWS)));
    expect(calls).toHaveLength(1);                       // attempted-once: no re-fire

    act(() => void view.rerender(surface(ROWS)));
    expect(calls).toHaveLength(2);                       // recovery fires
    expect(calls[1]!.rows).toBeNull();
  });

  test("fires again for a second same-kind rejection while the console warning stays latched", () => {
    // duplicate → recover → duplicate-with-a-DIFFERENT-fault-code;
    // assert calls grew each time and warnSpy() count stayed at the latch.
  });
});
```

- [ ] **Step 4.2: Run, verify failure**

Run: `cd packages/react && pnpm test -- rejected-writes-public-api`
Expected: FAIL — unknown prop `onRejectedWriteChange` (type error).

- [ ] **Step 4.3: Implement**

Prop type (next to `onTelemetryChange`, ~L1301):

```ts
/**
 * Notified when {@link PretableRejectedWrites} changes: a write was rejected
 * (any kind, every time — nothing latches), or a rejected kind recovered.
 * Never called while the record is the initial all-null state, and never for
 * renders that change no slot.
 */
onRejectedWriteChange?: (rejectedWrites: PretableRejectedWrites) => void;
```

Destructure at ~L1869. Effect next to the telemetry effect (~L5387) — `indexed` already carries `rejectedWrites` after Task 2 (executor: `indexed` is typed through an internal cast near L2606; extend that cast's type with `readonly rejectedWrites: PretableRejectedWrites;` if the public type doesn't already flow through):

```ts
const rejectedWrites = indexed.rejectedWrites;
/*
 * Identity compare against the last DELIVERED record, seeded with the mount
 * value: the record's identity only moves when a slot's fault changes (see
 * the memo in use-pretable.ts), so this fires exactly on reject/recover
 * transitions — not at mount, not on paging, not when only the callback prop
 * changes.
 */
const lastRejectedWrites = useRef(rejectedWrites);
useLayoutEffect(() => {
  if (lastRejectedWrites.current === rejectedWrites) return;
  lastRejectedWrites.current = rejectedWrites;
  onRejectedWriteChange?.(rejectedWrites);
});
```

`labeled-grid-surface.tsx`: add the same prop at L129, destructure at L197, forward at L272 — byte-parallel to `onTelemetryChange`.

- [ ] **Step 4.4: Run the full package suite**

Run: `cd packages/react && pnpm test`
Expected: PASS (re-run 1–2 random timeouts before believing a failure).

- [ ] **Step 4.5: Mutation check**

Remove the `useRef` seed (seed with `EMPTY_REJECTED_WRITES` instead of the mount value): no test should fail *(mount value IS the empty constant)* — but change the memo in `use-pretable.ts` to return a fresh `{rows:null,...}` literal instead of `EMPTY_REJECTED_WRITES`: the "silent at mount and on valid updates" test must FAIL. Revert.

- [ ] **Step 4.6: Commit**

```bash
pnpm format && git add -A && git commit -m "feat(react): onRejectedWriteChange surface callback"
```

---

### Task 5: API report, docs, changeset

**Files:**
- Modify: `packages/react/react.api.md` (generated)
- Modify: `apps/website/content/docs/grid/pretable-surface.mdx`
- Create: `.changeset/rejected-writes-public-api.md`

- [ ] **Step 5.1: Regenerate the API report**

```bash
pnpm build && pnpm api
```

(BUILD FIRST — a stale `dist/` silently strips exports and `api:check` won't catch it.) Verify the diff to `packages/react/react.api.md` contains exactly: `PretableRejectedWrite`, `PretableRejectedWrites`, `PretableModel.rejectedWrites`, `onRejectedWriteChange` (Surface + LabeledGridSurface). Anything else appearing/disappearing is a red flag — stop and diagnose.

- [ ] **Step 5.2: Docs**

In `apps/website/content/docs/grid/pretable-surface.mdx`:
1. Add `onRejectedWriteChange` to the `| Area | Props |` summary table (with the other `on*` callbacks; the summary is not completeness-pinned but must not omit what the section below teaches).
2. Add a `## Rejected writes` prose section: what a rejected write is (invalid `rows`/`derivations`/`query` keeps the last-good value, the grid stays alive), that the record — not the latching console warning — is the programmatic signal, and a fenced example:

```tsx
import { PretableSurface, type PretableRejectedWrites } from "@pretable/react";

function Positions({ rows }: { rows: readonly Position[] }) {
  const [rejected, setRejected] = useState<PretableRejectedWrites | null>(null);
  return (
    <>
      {rejected?.rows && (
        <StaleBanner reason={rejected.rows.message} />
      )}
      <PretableSurface
        rows={rows}
        columns={columns}
        getRowId={(row) => row.id}
        onRejectedWriteChange={setRejected}
      />
    </>
  );
}
```

Use prose + fence, NOT a new member table (a table must be registered in the docs guard's `TABLES` roster; prose avoids that). The fence's `@pretable/react` imports are checked against `react.api.md` — they pass because Step 5.1 exported them.

- [ ] **Step 5.3: Run the docs guard**

Run: `cd apps/website && pnpm test -- docs-api-surface`
Expected: PASS. If it flags the new fence or section, follow the failure message — every check in that file says what to do.

- [ ] **Step 5.4: Changeset**

`.changeset/rejected-writes-public-api.md`:

```md
---
"@pretable/react": minor
---

The grid can now tell you when its rendered data no longer matches what you
passed. Since invalid `rows`, `derivations`, and `query` updates became
rejected writes, the grid kept its last-good value and stayed alive — but the
only signal was a console warning that latches per fault kind, and there was
no API to ask whether the rendered rows match the ones you passed. Now there
is:

- `model.rejectedWrites` (on `usePretable`'s return) is a per-kind record:
  `{ rows, derivations, query }`, each `null` when in sync or
  `{ kind, code, message, columnId? }` describing the most recent rejection.
  Nothing latches — every rejection replaces the record — and a slot clears
  on its own when a valid value lands.
- `onRejectedWriteChange` on `PretableSurface` (and `LabeledGridSurface`)
  fires on every transition, including recovery, so a direct-Surface consumer
  can render a banner, retry, or fall back.
- Rejections in `useLocalRowModel` (rows and derivations) surface through the
  same record, so model-mode consumers get the same answer.

Console warnings are unchanged. Fatal faults (`disposed-model`,
`reentrant-mutation`, foreign errors) still throw.
```

- [ ] **Step 5.5: Commit**

```bash
pnpm format && git add -A && git commit -m "docs+api: rejected-writes public API report, docs, changeset"
```

---

### Task 6: Final verification + PR

- [ ] **Step 6.1: Full gates from the repo root**

```bash
pnpm build && pnpm api:check && pnpm -r typecheck ; cd packages/react && pnpm test ; cd ../../apps/website && pnpm test -- docs-api-surface
```

(Use the repo's actual script names — check root `package.json` if `typecheck`/`api:check` differ.) Expected: everything green; re-run any timed-out react test.

- [ ] **Step 6.2: Re-check `origin/main` for parallel-session drift**

```bash
git fetch origin main && git log HEAD..origin/main --oneline
```

If anything landed touching `use-pretable.ts`/`rejected-write.ts`/the suites, rebase and re-run Step 6.1.

- [ ] **Step 6.3: PR**

Push the branch, open a PR against `main` titled `feat(react): public rejected-writes API (rejectedWrites + onRejectedWriteChange)`, body summarizing the spec decisions and linking the spec file. Do NOT merge without green checks; verify merge state with `gh pr view` before recording it anywhere.
