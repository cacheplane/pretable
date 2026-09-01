// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { type PretableQueryFor } from "@pretable/core";

import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";
import {
  COLUMNS,
  dataRowCount,
  getRowId,
  type Holding,
  installWarnSpy,
  ROWS,
  rowModelMethodProxy,
} from "./rejected-write-harness";

type Query = PretableQueryFor<typeof COLUMNS>;

const EMPTY_QUERY: Query = { filters: [], sort: [], rowGroups: [] };

/**
 * A query that filters to the single `Energy` row. Valid, and NARROWING: the
 * rendered row count must actually change, which is what makes the recovery
 * assertion capable of failing. (`ROWS` has three rows and exactly one
 * `Energy`, so this moves the count from 3 to 1.)
 */
const NARROWING_QUERY: Query = {
  filters: [{ columnId: "sector", operator: "contains", value: "Energy" }],
  sort: [],
  rowGroups: [],
};

/*
 * The two faults, both realistic and both reachable only through a cast: the
 * query types are closed, so neither shape can be spelled through
 * `PretableQueryFor`. This is exactly what a JavaScript consumer, a persisted
 * layout, or a filter-builder round trip can hand in.
 *
 * They take DIFFERENT validation paths — `validateFilter` reaches
 * `query.filters[0].value` after resolving the column, `resolveColumn` fails at
 * `query.rowGroups[0].columnId` before there is a column at all — so one is not
 * a proxy for the other.
 */

/** `contains` requires an operand; this one has none. Fails at
 * `query.filters[0].value`, `columnId` `sector`. */
function missingOperandQuery(columnId = "sector"): Query {
  return {
    filters: [{ columnId, operator: "contains" }],
    sort: [],
    rowGroups: [],
  } as unknown as Query;
}

/** A `rowGroups` entry naming a column that does not exist. Fails at
 * `query.rowGroups[0].columnId`, `columnId` `nope`. */
function unknownColumnQuery(columnId = "nope"): Query {
  return {
    filters: [],
    sort: [],
    rowGroups: [{ columnId }],
  } as unknown as Query;
}

/*
 * NOTHING A CONSUMER CAN PASS distinguishes the narrow catch from a blanket
 * one on this seam: every fault the compiler recognises is re-wrapped as a
 * `CompiledQueryValidationError`, so "swallowed" and "rethrown" look identical
 * from outside the module. The non-validation error is therefore injected AT
 * THE SEAM — the row model is proxied and told, once, to throw a plain `Error`
 * out of `setQuery`. The same proxy counts `setQuery` calls, which is how the
 * "attempted once" pin observes a re-apply and how the chained-invocation test
 * proves which path it took. It is disarmed by default, so every other test in
 * this file runs the real model.
 *
 * The proxy itself, and the two traps it carries, live in
 * `rejected-write-core-proxy.ts`. READ THEM BEFORE ADDING A TEST HERE.
 */
vi.mock("@pretable/core", async (importOriginal) => {
  const { proxiedCoreModule } = await import("./rejected-write-core-proxy");
  return proxiedCoreModule(importOriginal, "setQuery");
});

const NON_VALIDATION_ERROR = new Error("boom");
const setQuery = rowModelMethodProxy("setQuery");
const warnSpy = installWarnSpy();

type Grid = PretableSurfaceGrid<Holding, string, typeof COLUMNS>;

function controlledElement(props: {
  readonly query: Query;
  readonly columns?: typeof COLUMNS;
  readonly onQueryChange?: (query: Query) => void;
  readonly onGridReady?: (grid: Grid) => void;
}) {
  return (
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="holdings"
      columns={props.columns ?? COLUMNS}
      getRowId={getRowId}
      onGridReady={props.onGridReady ?? (() => {})}
      onQueryChange={props.onQueryChange ?? (() => {})}
      overscan={0}
      query={props.query}
      rows={ROWS}
      viewportHeight={400}
    />
  );
}

/** No `query` prop at all — the uncontrolled arm of the props union. */
function uncontrolledElement(props: {
  readonly onGridReady: (grid: Grid) => void;
}) {
  return (
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="holdings"
      columns={COLUMNS}
      getRowId={getRowId}
      onGridReady={props.onGridReady}
      overscan={0}
      rows={ROWS}
      viewportHeight={400}
    />
  );
}

/** A fresh columns array of the same content. New identity, so the derivations
 * gate opens and a derivations transition is pending when the query is
 * reconciled — the `.then()`-chained `applyQuery` path. */
function freshColumns(): typeof COLUMNS {
  return [...COLUMNS] as unknown as typeof COLUMNS;
}

describe("an invalid query update is rejected, not fatal", () => {
  test("an invalid query on the prop is rejected, not fatal", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(controlledElement({ query: missingOperandQuery() }));

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

  test("an unknown-column rowGroup on the prop is rejected, not fatal", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(controlledElement({ query: unknownColumnQuery() }));

    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });
    expect(view.container.innerHTML.length).toBeGreaterThan(0);
  });

  test("a rejection keeps the query the model already had", async () => {
    /*
     * THE HEADLINE CLAIM, and the only test here that can check it. Every
     * other rejection test baselines on `EMPTY_QUERY`, where the surviving
     * count (3) is ALSO the unfiltered count — so `toBe(3)` cannot tell "the
     * previous query was kept" from "the query was cleared". Starting from a
     * query that selects ONE row separates them: a cleared query renders 3.
     *
     * This is what the warning promises the reader in so many words ("the grid
     * kept its previous query, so the rows it shows are the ones from before
     * this update"), so it is worth a pin of its own.
     */
    const view = render(controlledElement({ query: NARROWING_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(1);
    });

    view.rerender(controlledElement({ query: unknownColumnQuery() }));

    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });
    expect(dataRowCount(view.container)).toBe(1);
  });

  test("a valid query after a rejected one still lands", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(controlledElement({ query: missingOperandQuery() }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(controlledElement({ query: NARROWING_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(1);
    });
  });

  test("a rejected query does not fire onQueryChange", async () => {
    const onQueryChange = vi.fn();
    const view = render(
      controlledElement({ query: EMPTY_QUERY, onQueryChange }),
    );
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    /*
     * Counted from a baseline rather than asserted at zero: `onQueryChange`
     * reports ENGINE-ORIGINATED query changes, and mount is free to emit one.
     * A refused consumer prop is not an engine-originated change, so the count
     * must not move across the rejection.
     */
    const beforeRejection = onQueryChange.mock.calls.length;
    view.rerender(
      controlledElement({ query: missingOperandQuery(), onQueryChange }),
    );
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });
    expect(onQueryChange.mock.calls.length).toBe(beforeRejection);
  });

  test("a rejected query is attempted once, not re-applied every render", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    const invalid = missingOperandQuery();
    const beforeRejection = setQuery.callCount();
    view.rerender(controlledElement({ query: invalid }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });
    expect(setQuery.callCount()).toBe(beforeRejection + 1);

    /*
     * The rejected query STAYS in `lastControlledQuery.current`, so the SAME
     * identity is requested once. Roll the ref back in the catch — or clear it
     * — and every later render re-requests it, paying a `compileQuery` and a
     * throw each time. These renders pass the same identity and must request
     * nothing new.
     */
    for (let index = 0; index < 3; index += 1) {
      view.rerender(controlledElement({ query: invalid }));
    }
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });
    expect(setQuery.callCount()).toBe(beforeRejection + 1);
  });

  test("a non-validation error from the same call still propagates", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    // Widen the catch to every error and this is the assertion that fails: the
    // plain error is swallowed and the rerender completes quietly.
    setQuery.armThrow(() => NON_VALIDATION_ERROR);
    expect(() => {
      view.rerender(controlledElement({ query: NARROWING_QUERY }));
    }).toThrow(NON_VALIDATION_ERROR);
  });

  test("the rejection warns once, naming the column and the fault", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(controlledElement({ query: missingOperandQuery() }));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    /*
     * Content, not just count: a warning naming neither the column nor the
     * fault would satisfy a bare call-count assertion while telling a
     * developer nothing about what to fix.
     */
    const message = String(warnSpy().mock.calls[0]?.[0]);
    expect(message).toContain("sector");
    expect(message).toContain("query.filters[0].value");

    // A second attempt at the SAME fault must stay silent — that is what
    // `warnOnce` is for. A FRESH identity, so the attempt is really made:
    // silence is only evidence of latching if `setQuery` ran again.
    const beforeSecondAttempt = setQuery.callCount();
    view.rerender(controlledElement({ query: missingOperandQuery() }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });
    expect(setQuery.callCount()).toBeGreaterThan(beforeSecondAttempt);
    expect(warnSpy()).toHaveBeenCalledTimes(1);
  });

  test("a DIFFERENT fault still warns — the key is not a constant", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(controlledElement({ query: missingOperandQuery() }));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    /*
     * THE ANTI-LATCHING PIN. `warnOnce` disarms a key for the rest of the
     * process, so a key that does not vary per fault silently suppresses every
     * later, DIFFERENT misconfiguration. The second fault differs in every
     * component of the key — column, path and detail — so a constant key is
     * the only construction that fails here.
     */
    view.rerender(controlledElement({ query: unknownColumnQuery() }));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(2);
    });
    expect(String(warnSpy().mock.calls[1]?.[0])).toContain(
      "query.rowGroups[0].columnId",
    );
  });

  test("an invalid query behind a pending derivations transition is rejected", async () => {
    const view = render(controlledElement({ query: EMPTY_QUERY }));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    /*
     * THE OTHER INVOCATION PATH. `applyQuery` runs synchronously only when no
     * derivations transition is pending; a commit that changes the columns
     * identity too leaves one pending, and the query is reconciled from a
     * `.then()` callback instead. A throw there is an unhandled rejection, not
     * an unmount, so this path shows none of the fatal signature — which is
     * exactly why it needs its own pin.
     */
    const beforeRejection = setQuery.callCount();
    view.rerender(
      controlledElement({
        columns: freshColumns(),
        query: missingOperandQuery(),
      }),
    );
    /*
     * The discriminator that proves the CHAINED path was taken rather than the
     * synchronous one: `rerender` flushes layout effects but not microtasks,
     * so a synchronously-applied query would already have been counted here.
     */
    expect(setQuery.callCount()).toBe(beforeRejection);

    await waitFor(() => {
      expect(setQuery.callCount()).toBe(beforeRejection + 1);
    });
    expect(dataRowCount(view.container)).toBe(3);
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });
  });
});

/*
 * THE ASYMMETRY IS DELIBERATE.
 *
 * Everything above pins the UPDATE half: an invalid query reaching a MOUNTED
 * grid through the prop is a rejected write, because a throw out of a layout
 * effect unmounts a live, interactive subtree and destroys work the user can
 * see.
 *
 * The two cases below are the opposite, and both are already correct on
 * `main`. MOUNT stays fail-fast: there is no running grid to protect, so a
 * hard error surfaces the config bug at the cheapest possible moment. An
 * UNCONTROLLED `grid.setQuery` stays a synchronous throw to its caller: that
 * is the consumer's own call, not a React commit, so the error is catchable
 * and the grid survives it intact.
 *
 * DO NOT "make these consistent" with the prop path. Swallowing here would
 * turn a loud, first-render config error into a silent permanent one, and a
 * catchable API error into a no-op.
 */
describe("the paths that are correctly fatal stay fatal", () => {
  test("an invalid query at mount still throws", () => {
    /*
     * React logs the caught render error; silence it so the expected failure
     * does not read as a suite fault. `console.warn` is already mocked by the
     * shared `beforeEach`.
     */
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let thrown: unknown;
    try {
      render(controlledElement({ query: missingOperandQuery() }));
    } catch (error) {
      thrown = error;
    } finally {
      errorSpy.mockRestore();
    }

    /*
     * `undefined` here means the render COMPLETED — the swallow this pin
     * exists to forbid. The name check then says WHICH error escaped: an
     * unrelated crash would satisfy a bare "it threw" while proving nothing.
     */
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("CompiledQueryValidationError");
  });

  test("an uncontrolled grid.setQuery still throws to its caller", async () => {
    let grid: Grid | null = null;
    const view = render(
      uncontrolledElement({
        onGridReady: (ready) => {
          grid = ready;
        },
      }),
    );
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    let thrown: unknown;
    act(() => {
      try {
        (grid as unknown as Grid).setQuery(missingOperandQuery());
      } catch (error) {
        thrown = error;
      }
    });

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("CompiledQueryValidationError");
    // And the grid the consumer can still catch that error around is intact.
    expect(dataRowCount(view.container)).toBe(3);
  });
});
