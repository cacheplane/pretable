// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { PretableSurface } from "../pretable-surface";
import {
  COLUMNS,
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

/**
 * A FRESH array each call, carrying a duplicate-id fault on the given id.
 *
 * FRESH because array identity is what opens the `setRows` gate — a reused
 * constant never reaches the model a second time, so a silence assertion built
 * on one would pass vacuously.
 *
 * PARAMETERIZED because the warn key's deliberate coarseness is only
 * observable across two DISTINCT bad rows of the same kind: same `code`, same
 * (absent) `columnId`, different `detail`.
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
 * NOTHING A CONSUMER CAN PASS reaches `disposed-model` or `reentrant-mutation`
 * through a `rows` prop, and nothing can produce a non-row-model error from
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

    /*
     * IDENTITY, not just count — otherwise this test is a strict subset of the
     * parameterized "duplicate row ids is rejected, not fatal" case above and
     * pins nothing new. Naming the survivors is what would catch a grid that
     * kept three rows drawn from the REJECTED array.
     *
     * `data-pretable-row` is an empty MARKER attribute; the id lives on
     * `data-pretable-row-id` (`pretable-surface.tsx:7094-7096`). Reading the
     * marker would yield "" for every row and make this vacuous.
     */
    const ids = [
      ...view.container.querySelectorAll("[data-pretable-row-id]"),
    ].map((row) => row.getAttribute("data-pretable-row-id"));
    expect([...ids].sort()).toEqual(["h1", "h2", "h3"]);
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
    const afterRejection = setRows.callCount();

    // Same array IDENTITY: the gate must stay shut.
    view.rerender(element(DUPLICATE_IDS));
    view.rerender(element(DUPLICATE_IDS));

    expect(setRows.callCount()).toBe(afterRejection);
  });

  test("a disposed-model error still propagates", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() =>
      rowModelError("disposed-model", "The row model has been disposed."),
    );

    expect(() => {
      view.rerender(element(RECOVERY_ROWS));
    }).toThrow("The row model has been disposed.");
  });

  test("a reentrant-mutation error still propagates", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() =>
      rowModelError("reentrant-mutation", "Cannot run set-rows while …"),
    );

    expect(() => {
      view.rerender(element(RECOVERY_ROWS));
    }).toThrow("Cannot run set-rows");
  });

  test("an error with no code still propagates", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() => new Error("boom"));

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

    setRows.armThrow(() =>
      rowModelError("some-future-code", "a fault from a later version"),
    );

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
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    const message = String(warnSpy().mock.calls[0]?.[0]);
    expect(message).toContain("[pretable]");
    /*
     * FAULT-DERIVED, which is what makes this test live up to its name. Every
     * other string in the message is a constant from the template, so a guard
     * that dropped `${detail}` and named nothing would satisfy them all —
     * measured: deleting `${detail}` from the describe callback left all
     * sixteen tests of this file green. This assertion is the one that fails.
     * The wording comes from `row-store.ts:116`.
     */
    expect(message).toContain("Duplicate row ID dup");
    /*
     * Exactly ONE period between the detail and the next sentence. Row-model
     * details are written as full sentences (`Duplicate row ID dup.`), so an
     * unnormalised template renders `…dup.. The grid kept…`. `toContain`
     * above cannot see that; this can.
     */
    expect(message).toContain("Duplicate row ID dup. The grid kept");
    expect(message).not.toMatch(/\.\./);
    /*
     * The grid is showing data the consumer has replaced — the message must
     * say so, not merely report a fault.
     *
     * ONE prose assertion, not two. A dropped `toContain("previous rows")`
     * pinned the SAME sentence a second time, so an ordinary copy edit broke
     * two assertions at once while a semantic gutting broke neither.
     */
    expect(message).toMatch(/no longer match/i);
  });

  test("an UNPUNCTUATED detail still gets its period", async () => {
    /*
     * The twin of the `Duplicate row ID dup.` case above. The template strips
     * one trailing "." from the detail, so a detail that never had one must
     * still read as a sentence — a naive `detail.slice(0, -1)` would eat the
     * "d" of "closed" and pass every other assertion in this file.
     */
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    setRows.armThrow(() => rowModelError("accessor-failed", "the feed closed"));

    view.rerender(element(RECOVERY_ROWS));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    expect(String(warnSpy().mock.calls[0]?.[0])).toContain(
      "the feed closed. The grid kept",
    );
  });

  test("a fault carrying a columnId names the column", async () => {
    /*
     * The `columnId` branch of the describe callback is live but was otherwise
     * unasserted: `accessor-failed` sets it (`compiled-query.ts:1864`), so a
     * throwing accessor on `qty` must reach the console naming `qty`. Its twin
     * — the empty string when a fault has no column — is covered by the
     * duplicate-id test above, whose message has no `on column` clause at all.
     */
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(THROWING_ACCESSOR));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    const message = String(warnSpy().mock.calls[0]?.[0]);
    expect(message).toContain('on column "qty"');
    expect(message).toContain("Column qty accessor failed");
  });

  test("two DIFFERENT bad rows of the same kind warn once between them", async () => {
    /*
     * The warn key omits `rowId` and the message ON PURPOSE (documented at
     * length on `rowModelCodeGuard`): a streaming feed carrying many distinct
     * bad rows would otherwise key uniquely per row and flood the console.
     *
     * Nothing else in this file defends that decision — appending
     * `:${fault.detail}` to the key, which defeats it exactly, was measured to
     * leave every other test here green. This is the negative twin of "a
     * DIFFERENT fault code still warns" below: different CODES still warn,
     * different ROWS of one code do not.
     */
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(duplicateIds("dup")));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    /*
     * A different bad row, same fault kind, in a fresh array. The `setRows`
     * gate compares identity, so the freshness is load-bearing.
     */
    const beforeSecondAttempt = setRows.callCount();
    view.rerender(element(duplicateIds("another-dup")));

    /*
     * The half of this test that is otherwise unpinned: silence is evidence of
     * latching only if a second attempt was actually MADE. Give `duplicateIds`
     * an identity cache and the warn-count assertion below still passes —
     * because the gate would never call `setRows` again. This line is what
     * fails under that mutation.
     */
    expect(setRows.callCount()).toBeGreaterThan(beforeSecondAttempt);

    /*
     * The rejected `setRows` attempt settles across a TASK boundary, not a
     * microtask. Measured, under this test's own defeating mutation (named at
     * the end of this comment): swapping this `act` for a bare
     * `await Promise.resolve()` leaves the row-count probe below VACUOUS —
     * it reads pre-update DOM, and the mutant passes — while
     * `await new Promise((r) => setTimeout(r, 0))` reds it correctly. Do not
     * "simplify" this to a microtask flush.
     *
     * That probe is what proves the update was actually REJECTED: the grid
     * still shows the 3 baseline rows, not the 2-row shape a landed (even if
     * faulty) update would leave behind. Without this, `warnSpy` staying at
     * 1 is equally
     * consistent with "the second bad row was silenced by the coarse warn
     * key" (what this test claims) and "the second update was simply
     * accepted" (a stale-DOM read of a synchronous assertion here would
     * miss that distinction entirely) — the row count is what tells them
     * apart. Its defeating mutation, matching the two comments above: make
     * the second array valid (distinct ids). The two rows then land, and this
     * count is the only assertion here that reds.
     */
    await act(async () => {});
    expect(dataRowCount(view.container)).toBe(3);
    expect(warnSpy()).toHaveBeenCalledTimes(1);
  });

  test("a DIFFERENT fault code still warns — the key is not a constant", async () => {
    const view = render(element(ROWS));
    await waitFor(() => {
      expect(dataRowCount(view.container)).toBe(3);
    });

    view.rerender(element(DUPLICATE_IDS));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(1);
    });

    // `accessor-failed`, a different code from `duplicate-row-id`.
    view.rerender(element(THROWING_ACCESSOR));
    await waitFor(() => {
      expect(warnSpy()).toHaveBeenCalledTimes(2);
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
