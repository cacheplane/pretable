# setRows Rejected-Write Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an invalid `rows` prop a rejected write rather than a fatal one, so a bad row no longer unmounts the live grid subtree.

**Architecture:** `packages/react/src/use-pretable.ts` has one rows-mode layout effect writing three things to the row model. Two writes are already guarded; `setRows` (line 581) is not. This adds the third guard, accepting by row-model error **code** (which survives `remapSetRowsError`'s wrapper) rather than by error **name** (which does not). The shared `reportRejectedWrite` helper is re-parameterized from a name set to a guard-descriptor factory, so all three sites keep one rethrow/warn mechanism.

**Tech Stack:** TypeScript, React 19 layout effects, vitest + @testing-library/react (jsdom), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-31-setrows-rejected-write-guard-design.md`

---

## Environment — read before Task 1

This repo requires node `^24.15.0`. A default of v22 makes nothing build and
produces bogus `Cannot find module '@pretable/core'` typecheck errors.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 && node -v
```

Expected: `v24.19.0` (or any `24.x`). Run this in **every** shell before any
other command in this plan.

Work happens on branch `blove/setrows-rejected-write-guard`, already created off
`origin/main`. Do not `cd` to `~/repos/pretable` — that is a different
checkout. Never `git stash`; the stash stack is shared across worktrees.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/react/src/use-pretable.ts` | Modify. Replace `REJECTED_WRITE_ERROR_NAMES` + `reportRejectedWrite`'s `acceptedNames` option with two guard factories; add the `setRows` guard at line 581. |
| `packages/react/src/__tests__/invalid-rows-rejected.test.tsx` | Create. The rows twin of the two sibling rejection suites. |
| `packages/row-model/src/__tests__/set-rows-recompile-cannot-throw.test.ts` | Create. Pins that the `sameReferenceMutation` recompile fires and cannot throw. |

Everything lives in files that already own this concern. No new modules.

---

## Task 1: Pin that the setRows recompile fires and cannot throw

This is the *unreachability pin*. It records why the guard added in Task 3 does
NOT accept `CompiledQueryValidationError`, so a future reader does not "restore"
a guard for a fault that cannot occur.

**Files:**
- Create: `packages/row-model/src/__tests__/set-rows-recompile-cannot-throw.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/row-model/src/__tests__/set-rows-recompile-cannot-throw.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { compileQuery } from "../compiled-query";
import { createLocalRowModel } from "../create-local-row-model";

type Holding = { id: string; sector: string; qty: number };

const getRowId = (row: Holding) => row.id;

/**
 * `accessor` AND `value` are both required by `validateDerivations`; a
 * derivation carrying only `accessor` fails compilation with "column has no
 * accessor" before any of this file's claims are reached.
 */
function derivation(
  id: "sector" | "qty",
  type: "text" | "number",
  extra: object = {},
) {
  return {
    id,
    type,
    accessor: (row: Holding) => row[id],
    value: (row: Holding) => row[id],
    ...extra,
  };
}

/**
 * A row that RESISTS `Object.freeze`. `inspectRowIntegrity` freezes every
 * extensible row on ingest, and a frozen row can never be mutated in place —
 * so an ordinary object literal cannot reach the same-reference-mutation
 * branch at all. `preventExtensions` leaves existing properties writable, so
 * the inspection falls through to the fingerprint path and a later in-place
 * write is detected as a mutation.
 */
function mutableRow(row: Holding): Holding {
  return Object.preventExtensions({ ...row });
}

describe("the setRows recompile", () => {
  test("fires on a same-reference mutation", () => {
    const diagnostics: string[] = [];
    const first = mutableRow({ id: "h1", sector: "Tech", qty: 10 });
    const rows = [first, { id: "h2", sector: "Energy", qty: 5 }];

    const model = createLocalRowModel({
      rows,
      columns: [derivation("sector", "text"), derivation("qty", "number")],
      getRowId,
      onDiagnostic: (d: { code: string }) => diagnostics.push(d.code),
    } as never) as unknown as { setRows: (r: readonly Holding[]) => unknown };

    first.qty = 999;
    model.setRows([...rows]);

    expect(diagnostics).toContain("same-reference-row-mutation");

    /*
     * POSITIVE CONTROL. Without it this suite can pass vacuously: the original
     * probe behind this pin reported "the branch never fires" only because it
     * passed a diagnostic sink under the wrong option name
     * (`onRowIntegrityDiagnostic`; the real one is `onDiagnostic`). A second
     * mutation must produce a second diagnostic, or the sink is not wired and
     * the assertion above proves nothing.
     */
    first.qty = 1234;
    model.setRows([...rows]);
    expect(
      diagnostics.filter((code) => code === "same-reference-row-mutation"),
    ).toHaveLength(2);
  });

  test("cannot throw, because it recompiles an already-captured plan", () => {
    /*
     * THE CLAIM THIS FILE EXISTS FOR. `setRows` compiles the query on its
     * same-reference-mutation branch (`create-local-row-model.ts:1094`), but
     * it compiles `derivations`/`query` — which hold the stored PLAN's
     * captured clones (`:673-674`), not the raw consumer objects. Capture is
     * getter-free, so no consumer-supplied hostility survives to that
     * recompile.
     *
     * The probe: an aggregate getter that explodes on its SECOND read. If
     * capture re-read consumer objects, the recompile would throw. It is read
     * exactly once, at the first compile.
     */
    let reads = 0;
    const hostile = [
      derivation("sector", "text"),
      derivation("qty", "number", {
        get aggregate() {
          reads += 1;
          if (reads > 1) throw new Error("second read explodes");
          return "sum";
        },
      }),
    ];

    const first = mutableRow({ id: "h1", sector: "Tech", qty: 10 });
    const rows = [first];
    const model = createLocalRowModel({
      rows,
      columns: hostile,
      getRowId,
    } as never) as unknown as { setRows: (r: readonly Holding[]) => unknown };

    expect(reads).toBe(1);

    first.qty = 42;
    expect(() => model.setRows([...rows])).not.toThrow();
    expect(reads).toBe(1);
  });

  test("compiling a captured plan again is idempotent", () => {
    const plan = compileQuery({
      derivations: [
        derivation("sector", "text"),
        derivation("qty", "number", { aggregate: "sum" }),
      ],
      query: { filters: [], sort: [], rowGroups: [] },
    } as never) as { derivations: unknown; query: unknown };

    expect(() =>
      compileQuery({
        derivations: plan.derivations,
        query: plan.query,
      } as never),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/row-model && npx vitest run src/__tests__/set-rows-recompile-cannot-throw.test.ts
```

Expected: `Tests 3 passed (3)`.

These pass immediately — they pin existing behaviour rather than driving new
code. That is the point of the task: the guard in Task 3 deliberately omits a
case, and this is the evidence for the omission.

- [ ] **Step 3: Prove the pin can fail (mutation test)**

Temporarily change `if (reads > 1)` to `if (reads > 0)` in the second test.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/row-model && npx vitest run src/__tests__/set-rows-recompile-cannot-throw.test.ts
```

Expected: the second test FAILS at construction. Revert the change and re-run;
expected `3 passed`. A pin that cannot fail is not a pin.

- [ ] **Step 4: Commit**

```bash
git add packages/row-model/src/__tests__/set-rows-recompile-cannot-throw.test.ts
git commit -m "test(row-model): pin that the setRows recompile cannot throw"
```

---

## Task 2: Re-parameterize the shared guard helper

Replaces the name-set option with two guard factories. **No behaviour change** —
the two existing sites must keep passing their current tests unchanged, which is
the gate for this task.

**Files:**
- Modify: `packages/react/src/use-pretable.ts:82-176` (the `REJECTED_WRITE_ERROR_NAMES` + `RejectedWriteFault` + `reportRejectedWrite` block)
- Modify: `packages/react/src/use-pretable.ts` (the two existing `reportRejectedWrite(...)` call sites)

- [ ] **Step 1: Replace the helper block**

Delete `REJECTED_WRITE_ERROR_NAMES`, `RejectedWriteFault`, and
`reportRejectedWrite` (lines 82-176) and put this in their place:

```ts
/**
 * The reportable fields a rejected write carries. `path` is compiler
 * vocabulary and `code` is row-model vocabulary; each guard fills the half it
 * has and leaves the other undefined.
 */
type RejectedWriteFault = {
  readonly code: string | undefined;
  readonly columnId: string | undefined;
  readonly detail: string;
  readonly path: string | undefined;
};

/** What a guard factory produces: how to accept, how to key, how to word. */
type RejectedWriteGuard = {
  readonly isAccepted: (error: Error) => boolean;
  readonly readFault: (error: Error) => RejectedWriteFault;
  readonly warnKey: (fault: RejectedWriteFault) => string;
  readonly describe: (fault: RejectedWriteFault) => string;
};

/**
 * The two row-model error codes that must NEVER be swallowed. Both mean the
 * CONSUMER'S CODE is wrong in a way the next render will not fix — a write to
 * a disposed model, or a write re-entered from inside another write's
 * publication. Rejecting either would convert a lifecycle bug into a grid that
 * silently stops updating.
 */
const FATAL_ROW_MODEL_CODES: ReadonlySet<string> = new Set([
  "disposed-model",
  "reentrant-mutation",
]);

/**
 * The row-model error codes a `setRows` guard treats as a rejected write:
 * every DATA fault a bad `rows` prop can produce.
 *
 * An ALLOWLIST, not `FATAL_ROW_MODEL_CODES` inverted, so a code added to
 * `PretableRowModelErrorCode` later propagates instead of being silently
 * swallowed. The four codes in neither set (`existing-row-id`,
 * `transaction-conflict`, `row-identity-change`, `unsupported-row-update`) are
 * `apply-transaction`-only and unreachable through `setRows`; they are left
 * out rather than added "for safety", so this set states what is actually
 * reachable.
 *
 * Typed against the public `PretableRowModelErrorCode` union so a renamed code
 * breaks the build here rather than silently un-guarding a fault. The VALUES
 * are string literals, not imported constants: `@pretable-internal/row-model`
 * is a devDependency of this package, never a runtime one.
 */
const REJECTABLE_ROW_MODEL_CODES: ReadonlySet<PretableRowModelErrorCode> =
  new Set<PretableRowModelErrorCode>([
    "duplicate-row-id",
    "accessor-failed",
    "invalid-group-key",
    "comparator-failed",
    "aggregator-failed",
    "derivation-failed",
  ]);

/**
 * The guard for a write that compiles a query — `setDerivations` and
 * `setQuery`. Detection is by NAME, because `CompiledQueryValidationError`
 * extends `TypeError` and carries no `code`.
 *
 * SHARED BY BOTH SITES ON PURPOSE. The two were once byte-identical inline
 * blocks and a fix to one silently missed the other; keeping the acceptance,
 * field reads and key construction in one factory is what stops that
 * recurring. Only the prefix and the sentences differ.
 *
 * Detection is by name rather than `instanceof` because the class is declared
 * in `@pretable-internal/row-model` and is NOT re-exported from
 * `@pretable/core`, so nothing under `src/` can import it — and because
 * `instanceof` stops matching across duplicated module instances.
 *
 * The key is `columnId` + an INDEX-STRIPPED `path` + `detail`, never a
 * constant: `warnOnce` latches, so one fire disarms that key for the rest of
 * the process. The RAW `path` is wrong in both directions — it is value-blind
 * (two different bad values at one position share it, failing the anti-latch
 * pins in both sibling suites) and it embeds an array INDEX
 * (`query.filters[0].value`), so it re-fires when a fault merely moves
 * position. Stripping `[0]`/`[1]` keeps which PROPERTY failed and discards
 * where in the list it sat.
 *
 * `detail` and `path` are required constructor parameters of
 * `CompiledQueryValidationError`; only `columnId` is optional. The fallbacks
 * are still not dead code: acceptance is a duck-typed name check, so a foreign
 * error carrying the accepted name reaches them with neither field.
 */
function compiledQueryGuard(
  warnKeyPrefix: string,
  describe: (fault: RejectedWriteFault) => string,
): RejectedWriteGuard {
  return {
    isAccepted: (error) => error.name === "CompiledQueryValidationError",
    readFault: (error) => {
      const validation = error as Error & {
        readonly columnId?: string;
        readonly detail?: string;
        readonly path?: string;
      };
      return {
        code: undefined,
        columnId: validation.columnId,
        detail: validation.detail ?? validation.message,
        path: validation.path ?? "(unknown location)",
      };
    },
    warnKey: (fault) =>
      `${warnKeyPrefix}:${fault.columnId ?? "(no column)"}:${(
        fault.path ?? "(unknown location)"
      ).replace(/\[\d+\]/g, "[]")}:${fault.detail}`,
    describe,
  };
}

/**
 * The guard for `setRows`. Detection is by CODE, not name, for a measured
 * reason: `PretableSetRowsExecutionError`'s constructor calls
 * `super(error.code, …)`, so the code SURVIVES `remapSetRowsError`'s wrapper
 * while the name does not. A code check therefore catches the wrapped and
 * unwrapped forms with one entry, and does not silently miss one of the eleven
 * `PretableRowModelError` subclasses — each of which overrides `name`. In
 * practice the common faults arrive as the BASE `PretableRowModelError`,
 * because `remapSetRowsError` only wraps when `operation !== "set-rows"`.
 *
 * The key OMITS `rowId` and the message, unlike the compiled-query twin. That
 * is deliberate and is the one place this guard is less discriminating than
 * its siblings: a streaming feed carrying many distinct bad rows would key
 * uniquely per row and flood the console. A consumer told once that they have
 * a duplicate row id has the information; the second bad id teaches nothing
 * new. Different fault KINDS still warn.
 */
function rowModelGuard(
  warnKeyPrefix: string,
  describe: (fault: RejectedWriteFault) => string,
): RejectedWriteGuard {
  return {
    isAccepted: (error) => {
      const code = (error as Error & { readonly code?: unknown }).code;
      if (typeof code !== "string") return false;
      if (FATAL_ROW_MODEL_CODES.has(code)) return false;
      return REJECTABLE_ROW_MODEL_CODES.has(code as PretableRowModelErrorCode);
    },
    readFault: (error) => {
      const rowModelError = error as Error & {
        readonly code?: string;
        readonly columnId?: string;
      };
      return {
        code: rowModelError.code,
        columnId: rowModelError.columnId,
        detail: rowModelError.message,
        path: undefined,
      };
    },
    warnKey: (fault) =>
      `${warnKeyPrefix}:${fault.code ?? "(no code)"}:${fault.columnId ?? "(no column)"}`,
    describe,
  };
}

/**
 * The shared mechanism behind all three rejected-write guards in the layout
 * effect below: rethrow anything unrecognised, and otherwise report the fault
 * once.
 *
 * Everything not accepted RETHROWS. A blanket catch would hide unrelated
 * faults inside a layout effect, which is exactly the class of bug this seam
 * produces.
 *
 * What is genuinely site-specific — which call is wrapped, what the
 * surrounding code does with the transition, and the ref that is deliberately
 * not rolled back — all lives OUTSIDE the `catch`, so this leaves it where it
 * belongs.
 */
function reportRejectedWrite(error: unknown, guard: RejectedWriteGuard): void {
  if (!(error instanceof Error) || !guard.isAccepted(error)) throw error;
  const fault = guard.readFault(error);
  warnOnce(guard.warnKey(fault), guard.describe(fault));
}
```

- [ ] **Step 2: Add the type-only import**

In the `@pretable/core` import block at the top of the file, add
`type PretableRowModelErrorCode` in alphabetical position — between
`type PretableRowId` and `type PretableRowModel`:

```ts
  type PretableRowId,
  type PretableRowModelErrorCode,
  type PretableRowModel,
```

Note: alphabetically `PretableRowModel` precedes `PretableRowModelErrorCode`.
If the repo's lint sorts these, place it as:

```ts
  type PretableRowModel,
  type PretableRowModelErrorCode,
```

and let `pnpm lint` decide. Step 5 runs lint, which will report the required
order if this is wrong.

- [ ] **Step 3: Update the two existing call sites**

The derivations site (was `acceptedNames: REJECTED_WRITE_ERROR_NAMES, warnKeyPrefix: "derivations-rejected", describe: …`) becomes:

```ts
        reportRejectedWrite(
          error,
          compiledQueryGuard(
            "derivations-rejected",
            ({ columnId, detail, path }) =>
              "[pretable] A derivations update was rejected as invalid" +
              (columnId === undefined ? "" : ` on column "${columnId}"`) +
              ` at ${path}: ${detail}. The grid kept its previous derivations, ` +
              "so the values it shows are the ones from before this update. " +
              "Correct the column definition, or drop the change.",
          ),
        );
```

The query site becomes:

```ts
          reportRejectedWrite(
            error,
            compiledQueryGuard(
              "query-rejected",
              ({ columnId, detail, path }) =>
                "[pretable] A query update was rejected as invalid" +
                (columnId === undefined ? "" : ` on column "${columnId}"`) +
                ` at ${path}: ${detail}. The grid kept its previous query, so ` +
                "the rows it shows are the ones from before this update. " +
                "Correct the query, or drop the change.",
            ),
          );
```

Both message strings are byte-identical to what they replace. Leave every
surrounding comment in both `catch` blocks in place, except the two sentences
in the derivations block that point at `reportRejectedWrite above` for the
mechanism — those stay accurate.

- [ ] **Step 4: Run the two sibling suites — the gate for this task**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && npx vitest run src/__tests__/invalid-derivations-rejected.test.tsx src/__tests__/invalid-query-rejected.test.tsx
```

Expected: all tests pass, with **no edits to either test file**. This task is a
refactor; if a sibling test needed changing, the refactor changed behaviour and
is wrong. 23 tests total across the two files.

- [ ] **Step 5: Typecheck and lint**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && pnpm typecheck && pnpm lint
```

Expected: both exit 0. If `Cannot find module '@pretable/core'` appears, node is
not on 24 — re-run the `nvm use 24` line.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/use-pretable.ts
git commit -m "refactor(react): parameterize the rejected-write helper on a guard descriptor

Acceptance by name cannot express the setRows guard: the row-model error code
survives remapSetRowsError's wrapper and the name does not. Replaces the name
set with two factories so all sites keep one rethrow/warn mechanism."
```

---

## Task 3: Guard the setRows call

**Files:**
- Create: `packages/react/src/__tests__/invalid-rows-rejected.test.tsx`
- Modify: `packages/react/src/use-pretable.ts:578-582`

- [ ] **Step 1: Write the failing test**

Create `packages/react/src/__tests__/invalid-rows-rejected.test.tsx`:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createColumnHelper } from "@pretable/core";

import { resetDevWarnings } from "../dev-warn";
import { PretableSurface } from "../pretable-surface";

type Holding = { id: string; sector: string; qty: number };

const helper = createColumnHelper<Holding>();

const COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

const getRowId = (row: Holding) => row.id;

/**
 * Three rows at the baseline and TWO in the recovery set, so every "the grid
 * kept its previous rows" assertion is disproving: a baseline whose count
 * equalled the recovery count could not tell a kept row set from a replaced
 * one.
 */
const ROWS: readonly Holding[] = [
  { id: "h1", sector: "Tech", qty: 10 },
  { id: "h2", sector: "Tech", qty: 20 },
  { id: "h3", sector: "Energy", qty: 5 },
];

const RECOVERY_ROWS: readonly Holding[] = [
  { id: "r1", sector: "Tech", qty: 1 },
  { id: "r2", sector: "Energy", qty: 2 },
];

/*
 * The five faults a real `rows` prop can carry, all measured fatal before this
 * guard existed. Each reaches a DIFFERENT row-model code or a different path
 * to the same one, so no one of them is a proxy for the rest.
 */
const DUPLICATE_IDS: readonly Holding[] = [
  { id: "dup", sector: "Tech", qty: 1 },
  { id: "dup", sector: "Energy", qty: 2 },
];

const THROWING_ACCESSOR: readonly Holding[] = [
  {
    id: "h9",
    sector: "Tech",
    get qty(): number {
      throw new Error("getter boom");
    },
  } as Holding,
];

const MISSING_ID = [{ sector: "Tech", qty: 1 }] as unknown as readonly Holding[];
const NULL_ROW = [null] as unknown as readonly Holding[];
const OBJECT_ID = [
  { id: {}, sector: "Tech", qty: 1 },
] as unknown as readonly Holding[];

/*
 * NOTHING A CONSUMER CAN PASS reaches `disposed-model` or `reentrant-mutation`
 * through a `rows` prop, and nothing can produce a non-row-model error from
 * `setRows` either — so the must-propagate cases are injected AT THE SEAM. The
 * proxy also counts `setRows` calls, which is how the "attempted once" pin
 * observes a retry.
 *
 * Disarmed by default, so every other test here runs the real model.
 *
 * TRAP IF THIS FILE GROWS: the proxy is NOT identity-transparent.
 * `ɵsetLocalRowModelFilterAuthority` / `ɵsetLocalRowModelSortAuthority` look
 * the model up in WeakMaps keyed by the RAW object and swallow a miss with
 * `?.`, so those writes are silent no-ops for every test here. Nothing in this
 * file depends on filter/sort authority; a test that did would pass vacuously.
 */
let throwOnNextSetRows: (() => Error) | null = null;
let setRowsCallCount = 0;

vi.mock("@pretable/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pretable/core")>();
  return {
    ...actual,
    createLocalRowModel: (...args: readonly unknown[]) => {
      const model = (
        actual.createLocalRowModel as unknown as (
          ...a: readonly unknown[]
        ) => object
      )(...args);
      return new Proxy(model, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver) as unknown;
          if (property !== "setRows") return value;
          return (...callArgs: readonly unknown[]) => {
            setRowsCallCount += 1;
            if (throwOnNextSetRows !== null) {
              const make = throwOnNextSetRows;
              throwOnNextSetRows = null;
              throw make();
            }
            return (value as (...a: readonly unknown[]) => unknown)(
              ...callArgs,
            );
          };
        },
      });
    },
  };
});

/** A row-model error carrying `code`, the field the guard accepts on. */
function rowModelError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "name", { value: "PretableRowModelError" });
  Object.defineProperty(error, "code", { value: code });
  return error;
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // `warnOnce` keeps emitted keys in MODULE state, so without this the second
  // test to provoke the same fault would see no warning at all.
  resetDevWarnings();
  setRowsCallCount = 0;
  throwOnNextSetRows = null;
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  throwOnNextSetRows = null;
  // `cleanup()` FIRST: unmount runs with the spy still installed.
  cleanup();
  warnSpy.mockRestore();
});

function element(rows: readonly Holding[]) {
  return (
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="holdings"
      columns={COLUMNS}
      getRowId={getRowId}
      overscan={0}
      rows={rows}
      viewportHeight={400}
    />
  );
}

function dataRowCount(container: HTMLElement): number {
  return container.querySelectorAll("[data-pretable-row]").length;
}

describe("an invalid rows update is rejected, not fatal", () => {
  test.each([
    ["duplicate row ids", DUPLICATE_IDS],
    ["a row whose accessor throws", THROWING_ACCESSOR],
    ["a row with no id", MISSING_ID],
    ["a null row", NULL_ROW],
    ["a row id that is an object", OBJECT_ID],
  ])("%s is rejected, not fatal", async (_label, bad) => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(bad));

    /*
     * DISPROVING assertion: the grid must still be rendering its rows. A
     * destroyed subtree renders nothing, so a bare "did not throw" check would
     * sail straight through the very bug this pins.
     */
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });
    expect(view.container.innerHTML.length).toBeGreaterThan(0);
  });

  test("a rejection keeps the rows the model already had", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(DUPLICATE_IDS));

    // 3, not 2: the previous row set survived, and a CLEARED grid would be 0.
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });
  });

  test("a valid rows update after a rejected one still lands", async () => {
    /*
     * THE OLD BEHAVIOUR MUST SURVIVE. A guard that swallowed every `setRows`
     * would pass every assertion above while silently disabling the feature it
     * wraps, so this moves the count to a value only a LANDED update produces.
     */
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(DUPLICATE_IDS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(RECOVERY_ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(2);
    });
  });

  test("an ordinary rows update still lands when nothing is wrong", async () => {
    // The plain positive twin: no rejection anywhere in this test.
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(RECOVERY_ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(2);
    });
  });

  test("a rejected update is attempted once, not retried every render", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(DUPLICATE_IDS));
    const afterRejection = setRowsCallCount;

    // Same array IDENTITY: the gate must stay shut.
    view.rerender(element(DUPLICATE_IDS));
    view.rerender(element(DUPLICATE_IDS));

    expect(setRowsCallCount).toBe(afterRejection);
  });

  test("a disposed-model error still propagates", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    throwOnNextSetRows = () =>
      rowModelError("disposed-model", "The row model has been disposed.");

    expect(() => {
      view.rerender(element(RECOVERY_ROWS));
    }).toThrow("The row model has been disposed.");
  });

  test("a reentrant-mutation error still propagates", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    throwOnNextSetRows = () =>
      rowModelError("reentrant-mutation", "Cannot run set-rows while …");

    expect(() => {
      view.rerender(element(RECOVERY_ROWS));
    }).toThrow("Cannot run set-rows");
  });

  test("an error with no code still propagates", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    throwOnNextSetRows = () => new Error("boom");

    expect(() => {
      view.rerender(element(RECOVERY_ROWS));
    }).toThrow("boom");
  });

  test("an unknown row-model code still propagates", async () => {
    /*
     * The allowlist's reason for existing: a code this guard has never heard
     * of must reach the consumer, not be swallowed as though it were a data
     * fault.
     */
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    throwOnNextSetRows = () =>
      rowModelError("some-future-code", "a fault from a later version");

    expect(() => {
      view.rerender(element(RECOVERY_ROWS));
    }).toThrow("a fault from a later version");
  });

  test("the rejection warns once, naming the fault", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(DUPLICATE_IDS));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain("[pretable]");
    expect(message).toContain("previous rows");
    // The grid is showing data the consumer has replaced — the message must
    // say so, not merely report a fault.
    expect(message).toMatch(/no longer match/i);
  });

  test("a DIFFERENT fault code still warns — the key is not a constant", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(DUPLICATE_IDS));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    // `accessor-failed`, a different code from `duplicate-row-id`.
    view.rerender(element(THROWING_ACCESSOR));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
  });

  test("invalid rows at mount still throw", () => {
    /*
     * The guard covers the UPDATE path only. At mount the row model is built
     * inside a `useState` initializer during RENDER, so the fault never
     * reaches this layout effect and there is no committed grid to keep
     * alive. Both sibling suites pin the same boundary.
     */
    expect(() => render(element(DUPLICATE_IDS))).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && npx vitest run src/__tests__/invalid-rows-rejected.test.tsx
```

Expected: the five `is rejected, not fatal` cases FAIL, along with "keeps the
rows the model already had", "a valid rows update after a rejected one still
lands", "attempted once", and both warning tests. The propagate tests and
"invalid rows at mount still throw" already PASS — nothing is guarding yet, so
everything propagates.

Record the exact failure count before continuing.

- [ ] **Step 3: Add the guard**

In `packages/react/src/use-pretable.ts`, replace:

```ts
    if (lastRows.current !== rowsOptions.rows) {
      lastRows.current = rowsOptions.rows;
      rowModel.setRows(rowsOptions.rows);
    }
```

with:

```ts
    if (lastRows.current !== rowsOptions.rows) {
      /*
       * Recorded BEFORE the call that can throw, and deliberately NOT rolled
       * back if it does — the derivations and query rule below, for the same
       * reason: the rejected array stays here as "last requested", so an
       * invalid update is attempted ONCE instead of being retried on every
       * later render. Recovery is unaffected; a later valid array is a new
       * identity, so this gate opens for it.
       */
      lastRows.current = rowsOptions.rows;
      try {
        rowModel.setRows(rowsOptions.rows);
      } catch (error) {
        /*
         * The rows twin of the two rejection guards below. An invalid `rows`
         * prop is a REJECTED WRITE, not a fatal one: this runs in a layout
         * effect, so a throw escapes the commit and React unmounts the live
         * grid — measured at three rendered rows and 8.7KB of markup going to
         * zero for five ordinary faults (a duplicate id, a throwing accessor,
         * a missing id, a null row, a non-scalar id).
         *
         * The kept value is a STRONGER claim than its siblings make. A stale
         * aggregate or filter is a display nuance; stale ROWS mean the
         * consumer's data and the screen have diverged, which is why the
         * message says so in as many words.
         *
         * No transition to chain: `setRows` returns a synchronous
         * `PretableMutationResult`, not a transition with a `finished`
         * promise.
         *
         * Which codes are accepted, and why acceptance is by code rather than
         * name, is documented on `rowModelGuard` above.
         */
        reportRejectedWrite(
          error,
          rowModelGuard("rows-rejected", ({ columnId, detail }) =>
            "[pretable] A rows update was rejected as invalid" +
            (columnId === undefined ? "" : ` on column "${columnId}"`) +
            `: ${detail}. The grid kept its previous rows, so it is showing ` +
            "data from before this update and the rows on screen no longer " +
            "match the ones you passed. Correct the rows, or drop the change.",
          ),
        );
      }
    }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && npx vitest run src/__tests__/invalid-rows-rejected.test.tsx
```

Expected: all tests PASS (16 total: 5 parameterized + 11 named).

- [ ] **Step 5: Prove the suite can fail (mutation test)**

Temporarily add `"disposed-model"` to `REJECTABLE_ROW_MODEL_CODES`.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && npx vitest run src/__tests__/invalid-rows-rejected.test.tsx
```

Expected: "a disposed-model error still propagates" FAILS. Revert and re-run.

Then temporarily make the guard swallow everything — replace the `rowModelGuard`
call's `isAccepted` result by returning `true` unconditionally in
`rowModelGuard`. Expected: the four propagate tests FAIL. Revert and re-run;
expected all pass.

- [ ] **Step 6: Full react suite, typecheck, lint**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && pnpm test 2>&1 | tail -20 && pnpm typecheck && pnpm lint
```

Expected: all suites pass, both checks exit 0.

Note: the react vitest suite is known to time out on 1-2 random tests under
load. Re-run any failure once before treating it as real; if the same named test
fails twice, it is real.

- [ ] **Step 7: Commit**

```bash
git add packages/react/src/use-pretable.ts packages/react/src/__tests__/invalid-rows-rejected.test.tsx
git commit -m "fix(react): an invalid rows update is rejected, not fatal

A bad rows prop threw out of the rows-mode layout effect, escaping the React
commit and unmounting the live grid. Five ordinary faults were measured fatal:
a duplicate id, a throwing accessor, a missing id, a null row and a non-scalar
id. The grid now keeps its previous rows and warns."
```

---

## Task 4: Coherence check and API surface

- [ ] **Step 1: Verify the grid is coherent after a rejection, not merely non-empty**

Add this test to `invalid-rows-rejected.test.tsx`, inside the existing
`describe`:

```tsx
  test("the grid is coherent after a rejection, not merely non-empty", async () => {
    /*
     * "Still rendering something" is a weaker claim than "still correct". A
     * grid left with rows whose count disagrees with its own row elements
     * would pass every assertion above.
     */
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(DUPLICATE_IDS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    const rendered = [...view.container.querySelectorAll("[data-pretable-row]")];
    // Every rendered row still carries a distinct row id from the KEPT set.
    const ids = rendered.map((row) => row.getAttribute("data-pretable-row"));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3);
    // And none of them is from the rejected array.
    expect(ids.every((id) => id !== "dup")).toBe(true);
  });
```

- [ ] **Step 2: Run it**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && npx vitest run src/__tests__/invalid-rows-rejected.test.tsx
```

Expected: PASS, 17 tests.

If `data-pretable-row` does not carry the row id in this codebase, read what the
attribute actually holds (`view.container.querySelector("[data-pretable-row]")
?.outerHTML`) and assert on the real value rather than deleting the test. The
claim to preserve is that the surviving rows are the KEPT set, not the rejected
one.

- [ ] **Step 3: Confirm the public API surface is unchanged**

Every symbol added in Tasks 2-3 is module-private. Nothing is exported, so the
API report must not move.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && pnpm build && pnpm api:check
```

Expected: exit 0, and `git status` shows `react.api.md` unchanged. `build`
before `api:check` — a stale `dist/` silently strips exports and `api:check`
will not catch it.

- [ ] **Step 4: Run the row-model suite too**

Task 2 changed nothing in row-model, but Task 1 added a file there.

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/row-model && pnpm test 2>&1 | tail -15
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/__tests__/invalid-rows-rejected.test.tsx
git commit -m "test(react): pin that a rejected rows update leaves a coherent grid"
```

---

## Task 5: Correct the stale doc comment and open the PR

- [ ] **Step 1: Verify no stale text survives**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && grep -rn "still unguarded\|would accept two names\|REJECTED_WRITE_ERROR_NAMES" packages/react/src/
```

Expected: **no matches**. The old comment claimed a `setRows` guard "would
accept two names" (`CompiledQueryValidationError` and
`PretableSetRowsExecutionError`); the measurement disproved both. Task 2 deleted
the constant it sat on. If anything matches, delete or correct it now.

- [ ] **Step 2: Add a changeset**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && ls .changeset/*.md | head -3
```

Read one existing changeset for the format, then create
`.changeset/setrows-rejected-write.md`:

```markdown
---
"@pretable/react": patch
---

An invalid `rows` update is now a rejected write rather than a fatal one. A bad
row — a duplicate id, a throwing accessor, a missing or non-scalar id, a null
row — previously threw out of a layout effect and unmounted the live grid. The
grid now keeps the rows it already had and warns once, and a later valid `rows`
array recovers.
```

- [ ] **Step 3: Full verification before the PR**

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 24 >/dev/null && cd packages/react && pnpm test 2>&1 | tail -8 && pnpm typecheck && pnpm lint && cd ../row-model && pnpm test 2>&1 | tail -8 && pnpm typecheck && pnpm lint
```

Expected: every command exits 0. Do not proceed on a failure; re-run once for
the known react load-flake, then investigate if it repeats.

- [ ] **Step 4: Commit and push**

```bash
git add .changeset/setrows-rejected-write.md
git commit -m "chore: changeset for the setRows rejected-write guard"
git push -u origin blove/setrows-rejected-write-guard
```

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "fix(react): an invalid rows update is rejected, not fatal" --body "$(cat <<'BODY'
Completes the rejected-write seam. `setDerivations` (#550) and `setQuery` (#553)
already treated an invalid update as a rejected write; `setRows` was the
remaining unguarded call in the same layout effect.

## What was measured

Five ordinary bad-`rows` props, every one fatal before this change — the throw
escaped the React commit and unmounted the grid subtree (3 rendered rows and
8.7KB of markup to zero):

| bad `rows` prop | error | rows | recovers |
| --- | --- | --- | --- |
| duplicate row ids | `PretableRowModelError` | 3 → 0 | yes |
| accessor throws | `PretableRowModelError` | 3 → 0 | yes |
| `getRowId` → undefined | `PretableRowModelError` | 3 → 0 | yes |
| a null row | `PretableRowModelError` | 3 → 0 | yes |
| row id is an object | `PretableRowModelError` | 3 → 0 | yes |

## Two things this is NOT

**Not a copy of the sibling guards.** Acceptance is by row-model error **code**,
not name: `PretableSetRowsExecutionError`'s constructor calls
`super(error.code, …)`, so the code survives `remapSetRowsError`'s wrapper and
the name does not. A name allowlist would have missed every case above, which
arrive as the base `PretableRowModelError` because `remapSetRowsError` only
wraps when `operation !== "set-rows"`. `disposed-model` and
`reentrant-mutation` propagate, and the allowlist is closed so a future code
propagates too.

**Not a guard for the error the seam was expected to throw.** The
`sameReferenceMutation` branch does compile the query, and it does fire — but it
recompiles the stored plan's already-captured clones, and capture is idempotent
and getter-free. A `CompiledQueryValidationError` is unreachable there. That is
now pinned in `set-rows-recompile-cannot-throw.test.ts` so nobody adds a guard
for it, and the stale comment claiming otherwise is gone.

Spec: `docs/superpowers/specs/2026-08-31-setrows-rejected-write-guard-design.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 6: Verify the PR state — do not assume**

```bash
gh pr view --json number,url,mergeStateStatus,mergeable
```

An opened PR is not a merged PR. `BLOCKED` + `MERGEABLE` usually means a
required check is still pending. Report the real state.

---

## Notes for the implementer

**Do not "fix" these — they are deliberate:**

- The rows warn key omits `rowId` and the message. Adding them floods the
  console for a streaming feed carrying many distinct bad rows.
- `REJECTABLE_ROW_MODEL_CODES` omits four codes that exist in the union. They
  are `apply-transaction`-only and unreachable through `setRows`.
- Task 1's tests pass the moment they are written. They pin an existing
  property, and Step 3 mutation-tests them for exactly that reason.
- `lastRows.current` is assigned before the throwing call and never rolled back.

**Known flake:** the react vitest suite times out on 1-2 random tests per full
run under load. Re-run before believing a failure. Neither this nor the website
e2e flake affects CI.
