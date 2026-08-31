// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { createColumnHelper, type PretableQueryFor } from "@pretable/core";

import { PretableSurface, type PretableSurfaceGrid } from "../pretable-surface";

type Holding = {
  id: string;
  sector: string;
  qty: number;
};

const helper = createColumnHelper<Holding>();

/**
 * `qty` declares `sum`. Over the Tech rows sum is 30 and count is 2 — two
 * distinct numbers, so "the rejected update did NOT land" and "the recovery
 * update DID land" are distinguishable at the pixel. A fixture whose
 * aggregates agreed would pass either way.
 */
const COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "sum" }),
] as const;

const COUNT_COLUMNS = [
  helper.accessor("sector", { type: "text" }),
  helper.accessor("qty", { type: "number", aggregate: "count" }),
] as const;

/*
 * `aggregate` is a closed union, so an invalid value cannot be spelled through
 * the helper. The cast is the point of the test: this is exactly the shape a
 * JavaScript consumer, a persisted layout, or a tool panel can hand in.
 */
const INVALID_COLUMNS = [
  COLUMNS[0],
  { ...COLUMNS[1], aggregate: "nonsense" },
] as unknown as typeof COLUMNS;

/*
 * NOTHING A CONSUMER CAN PASS distinguishes the narrow catch from a blanket
 * one. Every plain error a hostile column shape raises is raised during
 * RENDER, ahead of the guarded call — and the compiler itself re-wraps a
 * throwing getter as a `CompiledQueryValidationError` (`captureProperty` in
 * `compiled-query.ts`). So the non-validation error is injected AT THE SEAM:
 * the row model is proxied and told, once, to throw a plain `Error` out of
 * `setDerivations`. Without this, "swallowed" and "rethrown" look identical
 * from outside the module, and a narrow catch nobody can verify is a blanket
 * one. The same proxy counts calls, which is how the "attempted once" pin
 * observes a recompile.
 *
 * Disarmed by default, so every other test in this file runs the real model.
 *
 * TWO TRAPS IF THIS FILE GROWS.
 * 1. The mock is module-wide, unlike the narrower per-test seam one directory
 *    over (`vi.spyOn(core, "createLocalRowModel")` in
 *    `row-model-mode.test.tsx`). Every test here gets the proxy.
 * 2. The proxy is NOT identity-transparent. `ɵsetLocalRowModelFilterAuthority`
 *    and `ɵsetLocalRowModelSortAuthority` look the model up in WeakMaps keyed
 *    by the RAW object and swallow a miss with `?.`, so those writes are
 *    silent no-ops for every test in this file. Nothing here depends on
 *    filter/sort authority; a test that does would pass vacuously.
 */
const NON_VALIDATION_ERROR = new Error("boom");
let throwNonValidationOnNextSetDerivations = false;
let setDerivationsCallCount = 0;
let setQueryCallCount = 0;

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
          if (property === "setQuery") {
            return (...callArgs: readonly unknown[]) => {
              setQueryCallCount += 1;
              return (value as (...a: readonly unknown[]) => unknown)(
                ...callArgs,
              );
            };
          }
          if (property !== "setDerivations") return value;
          return (...callArgs: readonly unknown[]) => {
            setDerivationsCallCount += 1;
            if (throwNonValidationOnNextSetDerivations) {
              throwNonValidationOnNextSetDerivations = false;
              throw NON_VALIDATION_ERROR;
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

const ROWS: readonly Holding[] = [
  { id: "h1", sector: "Tech", qty: 10 },
  { id: "h2", sector: "Tech", qty: 20 },
  { id: "h3", sector: "Energy", qty: 5 },
];

const GROUPED_QUERY: PretableQueryFor<typeof COLUMNS> = {
  filters: [],
  sort: [],
  rowGroups: [{ columnId: "sector" }],
};

const getRowId = (row: Holding) => row.id;

afterEach(() => {
  throwNonValidationOnNextSetDerivations = false;
  cleanup();
});

type Grid = PretableSurfaceGrid<Holding, string, typeof COLUMNS>;

function groupedElement(props: {
  readonly columns: typeof COLUMNS;
  readonly onGridReady?: (grid: Grid) => void;
}) {
  return (
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="holdings"
      columns={props.columns}
      getRowId={getRowId}
      onGridReady={props.onGridReady ?? (() => {})}
      onQueryChange={() => {}}
      overscan={0}
      query={GROUPED_QUERY}
      rows={ROWS}
      viewportHeight={400}
    />
  );
}

function techAggregateText(container: HTMLElement): string {
  const techGroup = [
    ...container.querySelectorAll("[data-pretable-group-row]"),
  ].find((row) => row.textContent?.includes("Tech"));
  return (
    techGroup?.querySelector('[data-pretable-column-id="qty"]')?.textContent ??
    ""
  );
}

describe("an invalid derivations update is rejected, not fatal", () => {
  test("an invalid aggregate on the columns prop is rejected, not fatal", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));

    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    view.rerender(groupedElement({ columns: INVALID_COLUMNS }));

    /*
     * DISPROVING assertion: the grid must still be rendering the PREVIOUS
     * aggregate. A destroyed subtree renders nothing, so a bare "did not
     * throw" check would sail through the very bug this pins.
     */
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
  });

  test("an invalid aggregate written to the engine is rejected, not fatal", async () => {
    let grid: Grid | null = null;
    const view = render(
      groupedElement({
        columns: COLUMNS,
        onGridReady: (ready) => {
          grid = ready;
        },
      }),
    );
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    act(() => {
      (grid as unknown as Grid).setColumnAggregate(
        "qty",
        "nonsense" as unknown as "sum",
      );
    });

    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
  });

  test("a non-validation error from the same call still propagates", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    // Widen the catch to every error and this is the assertion that fails:
    // the plain error is swallowed and the rerender completes quietly.
    throwNonValidationOnNextSetDerivations = true;
    expect(() => {
      view.rerender(
        groupedElement({
          columns: COUNT_COLUMNS as unknown as typeof COLUMNS,
        }),
      );
    }).toThrow(NON_VALIDATION_ERROR);
  });

  test("a rejected update is attempted once, not recompiled every render", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    const beforeRejection = setDerivationsCallCount;
    view.rerender(groupedElement({ columns: INVALID_COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
    expect(setDerivationsCallCount).toBe(beforeRejection + 1);

    /*
     * The half of decision 4 that recovery alone cannot pin: the rejected
     * array STAYS in `lastDerivations.current`, so the same invalid input is
     * requested ONCE. Roll the ref back — or clear it — and every subsequent
     * render re-requests it, paying a `compileQuery` and a throw each time.
     * These renders request nothing new; the count must not move.
     */
    for (let index = 0; index < 3; index += 1) {
      view.rerender(groupedElement({ columns: INVALID_COLUMNS }));
    }
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
    expect(setDerivationsCallCount).toBe(beforeRejection + 1);
  });

  test("a rejected update does not force a query re-apply", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    /*
     * The interaction the guard itself creates. Before the guard, the throw
     * from `setDerivations` PRE-EMPTED the query reconciliation below it;
     * afterwards that code runs. A rejected update changed nothing in the row
     * model, so there is nothing to reconcile — and re-applying is not free:
     * `setQuery` is unguarded, so a query naming a column the REJECTED array
     * would have introduced throws `references unknown column` out of this
     * same layout effect, which is the destruction the guard exists to remove.
     * Treating the rejection as a derivations change is what would schedule
     * that call.
     *
     * Measured scope note: a consumer who changes the `columns` prop and the
     * `query` prop in the SAME commit still reaches `setQuery` — through
     * `controlledQueryChanged`, which is independent of this gate.
     * `INVALID_COLUMNS_ADDING_REGION` + `GROUPED_BY_REGION_QUERY` is fatal
     * before and after this fix (the error merely moves from
     * `derivations[1].aggregate` to `query.rowGroups[0].columnId`); unguarded
     * `setQuery` is a pre-existing hazard filed separately, because query
     * reject semantics involve the `onQueryChange` round trip.
     */
    const beforeRejection = setQueryCallCount;
    view.rerender(groupedElement({ columns: INVALID_COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
    expect(setQueryCallCount).toBe(beforeRejection);
  });

  test("a valid update after a rejected one still lands", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    view.rerender(groupedElement({ columns: INVALID_COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    // RECOVERY only — this says nothing about decision 4, which holds either
    // way here; "attempted once" above is what that decision rides on.
    view.rerender(
      groupedElement({ columns: COUNT_COLUMNS as unknown as typeof COLUMNS }),
    );
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("2");
    });
  });
});
