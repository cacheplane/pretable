// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { createColumnHelper, type PretableQueryFor } from "@pretable/core";

import { resetDevWarnings } from "../dev-warn";
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

/**
 * A FRESH array each call, carrying an arbitrary bad `aggregate` on `qty`.
 * Identity matters: the derivations gate compares the merged list by identity,
 * so re-passing one constant would be a no-op rather than a second attempt —
 * and a latching test that never makes a second attempt passes vacuously. The
 * `setDerivationsCallCount` guards below are what hold that invariant; give
 * this function an identity cache and they fail.
 */
function invalidColumns(aggregate: string): typeof COLUMNS {
  return [
    COLUMNS[0],
    { ...COLUMNS[1], aggregate },
  ] as unknown as typeof COLUMNS;
}

/**
 * The same invalid `aggregate` with `qty` moved to index 0. The compiler's
 * `path` is index-bearing (`derivations[1].aggregate` becomes
 * `derivations[0].aggregate`), so this is the input that tells an
 * index-stripped key apart from a raw-`path` one.
 */
function invalidColumnsReordered(aggregate: string): typeof COLUMNS {
  return [
    { ...COLUMNS[1], aggregate },
    COLUMNS[0],
  ] as unknown as typeof COLUMNS;
}

/**
 * A column whose OBJECT aggregate throws from one member's getter. Measured
 * shape: `columnId` `qty`, `detail` `property getter threw while compiling`,
 * `path` `derivations[1].aggregate.<member>`. Both fields a `columnId`+`detail`
 * key would use are therefore IDENTICAL across two different throwing members,
 * and only `path` distinguishes them — which is why the key carries it.
 *
 * A getter on the column itself (`type`, `value`, `compare`, `accessor`,
 * `aggregate`) does NOT reach here: measured, each throws a plain `Error`
 * during React render, ahead of the guarded call, exactly as this file's
 * seam comment above describes. The aggregate's members are read only by the
 * compiler, which is what makes this fault class reachable at all.
 */
function throwingAggregateMember(member: string): typeof COLUMNS {
  const aggregate: Record<string, unknown> = {
    init: () => 0,
    accumulate: (accumulator: number) => accumulator,
    merge: (accumulator: number) => accumulator,
    finalize: (accumulator: number) => accumulator,
  };
  Object.defineProperty(aggregate, member, {
    get() {
      throw new Error(`getter for ${member} threw`);
    },
    enumerable: true,
    configurable: true,
  });
  return [
    COLUMNS[0],
    { ...COLUMNS[1], aggregate },
  ] as unknown as typeof COLUMNS;
}

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

/*
 * `warnOnce` keeps its emitted keys in MODULE state, so without the reset the
 * second test to provoke the same fault would see no warning at all.
 */
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetDevWarnings();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  throwNonValidationOnNextSetDerivations = false;
  // `cleanup()` FIRST: unmount runs with the spy still installed, so a warning
  // emitted on the way down is captured rather than escaping to the real
  // console. No such warning exists on this path today.
  cleanup();
  warnSpy.mockRestore();
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

  test("the rejection warns once, naming the column and the value", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    view.rerender(groupedElement({ columns: invalidColumns("nonsense") }));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * Content, not just count: a warning naming neither the column nor the
     * offending value would satisfy a bare call-count assertion while telling
     * a developer nothing about what to fix.
     */
    const message = String(warnSpy.mock.calls[0]?.[0]);
    expect(message).toContain("qty");
    expect(message).toContain("nonsense");

    // A second attempt at the SAME fault must stay silent — that is what
    // `warnOnce` is for.
    const beforeSecondAttempt = setDerivationsCallCount;
    view.rerender(groupedElement({ columns: invalidColumns("nonsense") }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
    /*
     * The half of this test that is otherwise unpinned: silence is only
     * evidence of latching if a second attempt was actually MADE. Give
     * `invalidColumns` an identity cache and the assertion below still passes
     * — because the derivations gate compares identity and never calls
     * `setDerivations` again. This line is what fails under that mutation.
     */
    expect(setDerivationsCallCount).toBeGreaterThan(beforeSecondAttempt);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("two faults differing only in the property each warn", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    /*
     * `columnId` and `detail` are IDENTICAL for these two — both are `qty` /
     * `property getter threw while compiling`. Only `path` says which member
     * threw, so a key without it reports the first fault and latches the
     * second away for the process, naming neither property.
     */
    view.rerender(groupedElement({ columns: throwingAggregateMember("init") }));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
    view.rerender(
      groupedElement({ columns: throwingAggregateMember("merge") }),
    );
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
    expect(String(warnSpy.mock.calls[0]?.[0])).toContain(
      "derivations[1].aggregate.init",
    );
    expect(String(warnSpy.mock.calls[1]?.[0])).toContain(
      "derivations[1].aggregate.merge",
    );
  });

  test("the same fault at a new position warns only once", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    view.rerender(groupedElement({ columns: invalidColumns("nonsense") }));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * The other direction of the same key choice. Moving `qty` to index 0
     * turns `path` into `derivations[0].aggregate` — a NEW string for the same
     * fault. Key on the raw `path` and this re-fires; the index-stripping is
     * what keeps a reorder from re-reporting a fault already reported.
     */
    const beforeMove = setDerivationsCallCount;
    view.rerender(
      groupedElement({ columns: invalidColumnsReordered("nonsense") }),
    );
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });
    expect(setDerivationsCallCount).toBeGreaterThan(beforeMove);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("a DIFFERENT invalid value still warns — the key is not a constant", async () => {
    const view = render(groupedElement({ columns: COLUMNS }));
    await waitFor(() => {
      expect(techAggregateText(view.container)).toBe("30");
    });

    view.rerender(groupedElement({ columns: invalidColumns("nonsense") }));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    /*
     * THE ANTI-LATCHING PIN. `warnOnce` disarms a key for the rest of the
     * process, so a key that does not vary per fault silently suppresses every
     * later, DIFFERENT misconfiguration. A distinct bad value on the same
     * column is a distinct fault and must be reported.
     */
    view.rerender(groupedElement({ columns: invalidColumns("bogus") }));
    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });
    expect(String(warnSpy.mock.calls[1]?.[0])).toContain("bogus");
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

/*
 * DECISION 6 — THE ASYMMETRY IS DELIBERATE.
 *
 * Everything above pins the UPDATE half: an invalid aggregate reaching a
 * MOUNTED grid is a rejected write, because a throw out of a layout effect
 * unmounts a live, interactive subtree and destroys work the user can see.
 *
 * MOUNT is the opposite and stays fail-fast. There is no running grid to
 * protect, so rejecting buys nothing; a hard error surfaces the config bug at
 * the cheapest possible moment, immediately and at the offending render,
 * rather than as a grid that quietly shows the wrong aggregates forever.
 *
 * DO NOT "make this consistent" with the update path. Swallowing here would
 * turn a loud, first-render config error into a silent, permanent one — the
 * one moment where the crash is the cheap outcome.
 */
describe("at mount, an invalid derivations config is still fatal", () => {
  test("rendering with an invalid aggregate throws the compiler's error", () => {
    /*
     * React logs the caught render error; silence it so the expected failure
     * does not read as a suite fault. `console.warn` is already mocked by the
     * shared `beforeEach`.
     */
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let thrown: unknown;
    try {
      render(groupedElement({ columns: INVALID_COLUMNS }));
    } catch (error) {
      thrown = error;
    } finally {
      errorSpy.mockRestore();
    }

    /*
     * `undefined` here means the render COMPLETED — the swallow this pin
     * exists to forbid. The name check then says WHICH error escaped: an
     * unrelated crash on this path would satisfy a bare "it threw" while
     * proving nothing about decision 6.
     */
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).name).toBe("CompiledQueryValidationError");
  });
});
