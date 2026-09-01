// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, expect, test, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import { useLocalRowModel } from "../use-local-row-model";
import {
  COLUMNS,
  columnHelper,
  dataRowCount,
  getRowId,
  type Holding,
  installWarnSpy,
  RECOVERY_ROWS,
  ROWS,
  rowModelError,
  rowModelMethodProxy,
} from "./rejected-write-harness";

/*
 * The five faults a real `rows` option can carry, all measured fatal on this
 * hook before the guard existed (three rendered rows to zero, 5996 bytes of
 * markup to zero). Each reaches a DIFFERENT row-model code, or a different
 * path to the same one, so no one of them is a proxy for the rest.
 */
const DUPLICATE_IDS: readonly Holding[] = [
  { id: "dup", sector: "Tech", qty: 1 },
  { id: "dup", sector: "Energy", qty: 2 },
];

/**
 * A row whose `qty` accessor throws.
 *
 * Built with `Object.defineProperty` AFTER the object literal, never with a
 * `get qty()` member that is later spread: `{ ...row }` stores a getter's
 * VALUE as a plain data property, which for this fixture means the spread
 * throws at construction time (or, for a benign getter, silently produces a
 * fixture with no getter at all and a vacuous test). The descriptor assertion
 * below is what makes that failure loud rather than silent.
 */
function throwingAccessorRows(): readonly Holding[] {
  const row = { id: "h9", sector: "Tech" } as unknown as Holding;
  Object.defineProperty(row, "qty", {
    configurable: true,
    enumerable: true,
    get(): number {
      throw new Error("getter boom");
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(row, "qty");
  if (descriptor?.get === undefined) {
    throw new Error("fixture lost its getter: `qty` is not an accessor");
  }
  return [row];
}

/**
 * A FRESH array each call, carrying a duplicate-id fault on the given id.
 *
 * FRESH because array identity is what opens the `setRows` gate — a reused
 * constant never reaches the model a second time, so an assertion built on a
 * second attempt would pass vacuously.
 */
function duplicateIds(id: string): readonly Holding[] {
  return [
    { id, sector: "Tech", qty: 1 },
    { id, sector: "Energy", qty: 2 },
  ];
}

const MISSING_ID = [
  { sector: "Tech", qty: 1 },
] as unknown as readonly Holding[];
const NULL_ROW = [null] as unknown as readonly Holding[];
const OBJECT_ID = [
  { id: {}, sector: "Tech", qty: 1 },
] as unknown as readonly Holding[];

/*
 * `aggregate` is a closed union, so an invalid value cannot be spelled through
 * the helper. The cast is the point: this is exactly the shape a JavaScript
 * consumer, a persisted layout, or a tool panel can hand in.
 */
function invalidDerivations(aggregate: string): typeof COLUMNS {
  return [
    COLUMNS[0],
    { ...COLUMNS[1], aggregate },
  ] as unknown as typeof COLUMNS;
}

/*
 * NOTHING A CONSUMER CAN PASS reaches `disposed-model` or `reentrant-mutation`
 * through a `rows` option, and nothing can produce a non-row-model error from
 * `setRows` either — so the must-propagate cases are injected AT THE SEAM. The
 * proxy also counts `setRows` calls, which is how the "attempted once" pin
 * observes a retry. It is disarmed by default, so every other test here runs
 * the real model.
 *
 * The proxy itself, and the two traps it carries, live in
 * `rejected-write-core-proxy.ts`. READ THEM BEFORE ADDING A TEST HERE.
 */
vi.mock("@pretable/core", async (importOriginal) => {
  const { proxiedCoreModule } = await import("./rejected-write-core-proxy");
  return proxiedCoreModule(importOriginal, "setRows");
});

const setRows = rowModelMethodProxy("setRows");
const warnSpy = installWarnSpy();

/**
 * `useLocalRowModel` is HEADLESS — it renders nothing of its own, so "the
 * subtree survived" is only observable through a host that draws the model.
 *
 * SELECTS THE SNAPSHOT, never `getState` whole. Handing `getState` itself to
 * `useSyncExternalStore` is a measured performance trap in this repo, not a
 * style preference: `getState()` returns a fresh object on every cooperative
 * slice, so a consumer subscribed to it repaints per slice — ~1.9s of
 * repainting for a model update the engine finishes in ~4ms, once misdiagnosed
 * as a flaky test. `snapshot` is stable until the swap. See
 * `apps/website/content/docs/headless/state-model.mdx` ("Select what you
 * subscribe to"), which this host deliberately matches so it stays safe to
 * copy from.
 *
 * The rows are drawn from the MODEL, never from the `rows` prop, which is what
 * makes the count and the ids below evidence about the model's state rather
 * than an echo of the input.
 */
function Host({
  rows,
  derivations,
}: {
  readonly rows: readonly Holding[];
  readonly derivations?: typeof COLUMNS;
}) {
  const model = useLocalRowModel<typeof COLUMNS, string>({
    rows,
    columns: COLUMNS,
    getRowId,
    ...(derivations === undefined ? {} : { derivations }),
  });
  const snapshot = useSyncExternalStore(
    model.subscribe,
    () => model.getState().snapshot,
  );
  const drawn: { readonly rowId: string; readonly sector: string }[] = [];
  for (let index = 0; index < snapshot.visibleRowCount; index += 1) {
    const row = snapshot.rowAt(index);
    if (row?.kind === "data") {
      drawn.push({ rowId: row.rowId, sector: row.row.sector });
    }
  }
  return (
    <div data-local-host data-revision={snapshot.revision}>
      {drawn.map((row) => (
        <div data-local-row-id={row.rowId} key={row.rowId}>
          {row.sector}
        </div>
      ))}
    </div>
  );
}

function drawnRowCount(container: HTMLElement): number {
  return container.querySelectorAll("[data-local-row-id]").length;
}

/**
 * The model's snapshot revision, read out of the DOM.
 *
 * The disproving observable for a DERIVATIONS write: derived values are not
 * drawn by this host (a snapshot row carries the SOURCE row), so "the update
 * landed" and "the update was rejected" are indistinguishable by row ids
 * alone. A landed `setDerivations` bumps the revision; a rejected one cannot.
 */
function revision(container: HTMLElement): number {
  return Number(
    container.querySelector("[data-revision]")?.getAttribute("data-revision"),
  );
}

function drawnRowIds(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll("[data-local-row-id]")]
    .map((row) => row.getAttribute("data-local-row-id") ?? "")
    .sort();
}

describe("an invalid useLocalRowModel rows update is rejected, not fatal", () => {
  /*
   * ANNOTATED, not inferred. A bare array of mixed-type tuples infers as
   * `(string | readonly Holding[])[]`, which makes `bad` a union and fails
   * `pnpm typecheck` at the `<Host rows={bad} />` below.
   */
  const FAULTS: readonly (readonly [string, () => readonly Holding[]])[] = [
    ["duplicate row ids", () => DUPLICATE_IDS],
    ["a row whose accessor throws", throwingAccessorRows],
    ["a row with no id", () => MISSING_ID],
    ["a null row", () => NULL_ROW],
    ["a row id that is an object", () => OBJECT_ID],
  ];

  test.each(FAULTS)("%s is rejected, not fatal", async (_label, makeBad) => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(<Host rows={makeBad()} />);

    /*
     * DISPROVING assertion: the host must still be drawing the model's rows. A
     * destroyed subtree draws nothing, so a bare "did not throw" check would
     * sail straight through the very bug this pins.
     *
     * IDENTITY as well as count — naming the survivors is what would catch a
     * model that kept three rows drawn from the REJECTED array.
     */
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });
    expect(drawnRowIds(view.container)).toEqual(["h1", "h2", "h3"]);
    expect(view.container.innerHTML.length).toBeGreaterThan(0);
  });

  test("a valid rows update after a rejected one still lands", async () => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(<Host rows={DUPLICATE_IDS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(<Host rows={RECOVERY_ROWS} />);
    await waitFor(() => {
      expect(drawnRowIds(view.container)).toEqual(["r1", "r2"]);
    });
  });

  test("an ordinary rows update still lands when nothing is wrong", async () => {
    /*
     * THE OLD BEHAVIOUR MUST SURVIVE. A guard that swallowed every `setRows`
     * would pass every survival assertion above while silently disabling the
     * feature it wraps, so this moves the drawn rows to a set only a LANDED
     * update produces. The plain positive twin: no rejection anywhere here.
     */
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(<Host rows={RECOVERY_ROWS} />);
    await waitFor(() => {
      expect(drawnRowIds(view.container)).toEqual(["r1", "r2"]);
    });
  });

  test("a rejected update is attempted once, not retried every render", async () => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(<Host rows={DUPLICATE_IDS} />);
    const afterRejection = setRows.callCount();

    // Same array IDENTITY: the gate must stay shut.
    view.rerender(<Host rows={DUPLICATE_IDS} />);
    view.rerender(<Host rows={DUPLICATE_IDS} />);

    expect(setRows.callCount()).toBe(afterRejection);
  });

  test("a disposed-model error still propagates", async () => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() =>
      rowModelError("disposed-model", "The row model has been disposed."),
    );

    expect(() => {
      view.rerender(<Host rows={RECOVERY_ROWS} />);
    }).toThrow("The row model has been disposed.");
  });

  test("a reentrant-mutation error still propagates", async () => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() =>
      rowModelError("reentrant-mutation", "Cannot run set-rows while …"),
    );

    expect(() => {
      view.rerender(<Host rows={RECOVERY_ROWS} />);
    }).toThrow("Cannot run set-rows");
  });

  test("an error with no code still propagates", async () => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() => new Error("boom"));

    expect(() => {
      view.rerender(<Host rows={RECOVERY_ROWS} />);
    }).toThrow("boom");
  });

  test("an unknown row-model code still propagates", async () => {
    /*
     * The allowlist's reason for existing: a code this guard has never heard
     * of must reach the consumer, not be swallowed as though it were a data
     * fault.
     */
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() =>
      rowModelError("some-future-code", "a fault from a later version"),
    );

    expect(() => {
      view.rerender(<Host rows={RECOVERY_ROWS} />);
    }).toThrow("a fault from a later version");
  });

  test("the rejection warns once, naming the fault", async () => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(<Host rows={DUPLICATE_IDS} />);
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    const message = String(warnSpy().mock.calls[0]?.[0]);
    expect(message).toContain("[pretable]");
    /*
     * FAULT-DERIVED, which is what makes this test live up to its name. Every
     * other string in the message is a constant from the template, so a guard
     * that dropped `${detail}` and named nothing would satisfy them all. The
     * wording comes from `row-store.ts:116`.
     */
    expect(message).toContain("Duplicate row ID dup");
    /*
     * Exactly ONE period between the detail and the next sentence. Row-model
     * details are written as full sentences (`Duplicate row ID dup.`), so an
     * unnormalised template renders `…dup.. The row model kept…`.
     */
    expect(message).toContain("Duplicate row ID dup. The row model kept");
    expect(message).not.toMatch(/\.\./);
    expect(message).toMatch(/no longer match/i);
  });

  test("an UNPUNCTUATED detail still gets its period", async () => {
    /*
     * The twin of the `Duplicate row ID dup.` case above. The template strips
     * one trailing "." from the detail, so a detail that never had one must
     * still read as a sentence — a naive `detail.slice(0, -1)` would eat the
     * "d" of "closed" and pass every other assertion in this file.
     */
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() => rowModelError("accessor-failed", "the feed closed"));

    view.rerender(<Host rows={RECOVERY_ROWS} />);
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    expect(String(warnSpy().mock.calls[0]?.[0])).toContain(
      "the feed closed. The row model kept",
    );
  });

  test("a DIFFERENT fault code still warns — the key is not a constant", async () => {
    const view = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(<Host rows={duplicateIds("dup")} />);
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    // `accessor-failed`, a different code from `duplicate-row-id`.
    view.rerender(<Host rows={throwingAccessorRows()} />);
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(2);
    });
  });

  test("this hook's warn keys do not silence usePretable's", async () => {
    /*
     * `warnOnce` latches per KEY for the life of the process, so the two hooks
     * MUST use distinct warn-key prefixes on BOTH guarded writes: sharing one
     * would let whichever rejected first silence the other's identical
     * rejection, and a consumer could never tell which hook produced the
     * warning.
     *
     * Every pair below provokes the SAME fault through both hooks — a
     * `duplicate-row-id` with no `columnId` for the rows guard, and
     * `aggregate: "nonsense"` on `qty` for the derivations guard, which yields
     * an identical `columnId`, an identical index-stripped `path` and an
     * identical `detail`. That is the only shape under which the prefix is the
     * whole difference between the two keys, so it is the only shape that can
     * detect a unified one.
     */
    const surfaceRows = duplicateIds("dup");
    const localRows = duplicateIds("dup");
    const surfaceProps = {
      ariaLabel: "holdings",
      getRowId,
      overscan: 0,
      viewportHeight: 400,
    } as const;

    const surface = render(
      <PretableSurface<Holding, string, typeof COLUMNS>
        {...surfaceProps}
        columns={COLUMNS}
        rows={ROWS}
      />,
    );
    await waitFor(() => {
      expect(dataRowCount(surface.container)).toBe(3);
    });
    surface.rerender(
      <PretableSurface<Holding, string, typeof COLUMNS>
        {...surfaceProps}
        columns={COLUMNS}
        rows={surfaceRows}
      />,
    );
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    const local = render(<Host rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(local.container)).toBe(3);
    });
    local.rerender(<Host rows={localRows} />);

    // 2, not 1: the local hook's ROWS rejection is NOT swallowed by the
    // surface's rows latch.
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(2);
    });

    /*
     * The DERIVATIONS half. Both `rows` identities below are re-passed
     * unchanged, so the rows gates stay shut and the only new write on either
     * side is `setDerivations`.
     */
    surface.rerender(
      <PretableSurface<Holding, string, typeof COLUMNS>
        {...surfaceProps}
        columns={invalidDerivations("nonsense")}
        rows={surfaceRows}
      />,
    );
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(3);
    });
    expect(String(warnSpy().mock.calls[2]?.[0])).toContain(
      "derivations update was rejected",
    );

    local.rerender(
      <Host derivations={invalidDerivations("nonsense")} rows={localRows} />,
    );

    // 4, not 3: the local hook's DERIVATIONS rejection is NOT swallowed by the
    // surface's derivations latch.
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(4);
    });
    expect(String(warnSpy().mock.calls[3]?.[0])).toContain(
      "derivations update was rejected",
    );
  });

  test("invalid rows at mount still throw", () => {
    /*
     * The guard covers the UPDATE path only. At mount the row model is built
     * inside a `useState` initializer during RENDER, so the fault never
     * reaches the layout effect and there is no committed subtree to keep
     * alive. Every sibling suite pins the same boundary.
     */
    expect(() => render(<Host rows={DUPLICATE_IDS} />)).toThrow();
  });
});

describe("an invalid useLocalRowModel derivations update is rejected, not fatal", () => {
  test("an invalid derivations update keeps the subtree and the rows", async () => {
    const view = render(<Host derivations={COLUMNS} rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });
    const baseline = revision(view.container);

    view.rerender(
      <Host derivations={invalidDerivations("nonsense")} rows={ROWS} />,
    );

    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });
    // The subtree survived AND kept its rows: a destroyed one draws nothing.
    expect(drawnRowIds(view.container)).toEqual(["h1", "h2", "h3"]);
    expect(view.container.innerHTML.length).toBeGreaterThan(0);
    // And the write did not LAND: a rejected `setDerivations` never reaches
    // the model, so the revision it would have bumped is untouched.
    expect(revision(view.container)).toBe(baseline);

    const message = String(warnSpy().mock.calls[0]?.[0]);
    expect(message).toContain("[pretable]");
    expect(message).toContain("derivations update was rejected");
    // FAULT-DERIVED: a template that named nothing would pass the rest.
    expect(message).toContain("nonsense");
  });

  test("a valid derivations update still lands after a rejected one", async () => {
    /*
     * THE OLD BEHAVIOUR MUST SURVIVE, and the recovery pin: a landed
     * `setDerivations` bumps the model's revision, so a guard that swallowed
     * every derivations write would leave this frozen.
     */
    const view = render(<Host derivations={COLUMNS} rows={ROWS} />);
    await waitFor(() => {
      expect(drawnRowCount(view.container)).toBe(3);
    });

    view.rerender(
      <Host derivations={invalidDerivations("nonsense")} rows={ROWS} />,
    );
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    const doubled = [
      COLUMNS[0],
      columnHelper.accessor("qty", (row) => row.qty * 2, { type: "number" }),
    ] as unknown as typeof COLUMNS;
    const beforeRecovery = revision(view.container);
    view.rerender(<Host derivations={doubled} rows={ROWS} />);

    // The revision MOVES: this is the assertion a swallow-everything guard
    // fails. Row ids alone cannot see a landed derivations write.
    await waitFor(() => {
      expect(revision(view.container)).toBeGreaterThan(beforeRecovery);
    });
    expect(drawnRowIds(view.container)).toEqual(["h1", "h2", "h3"]);
  });
});
