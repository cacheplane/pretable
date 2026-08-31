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
  /*
   * ANNOTATED, not inferred. A bare array of mixed-type tuples infers as
   * `(string | readonly Holding[])[]`, which makes `bad` a union and fails
   * `pnpm typecheck` at the `element(bad)` call below.
   */
  const FAULTS: readonly (readonly [string, readonly Holding[]])[] = [
    ["duplicate row ids", DUPLICATE_IDS],
    ["a row whose accessor throws", THROWING_ACCESSOR],
    ["a row with no id", MISSING_ID],
    ["a null row", NULL_ROW],
    ["a row id that is an object", OBJECT_ID],
  ];

  test.each(FAULTS)("%s is rejected, not fatal", async (_label, bad) => {
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
