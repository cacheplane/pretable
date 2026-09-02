// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { type PretableQueryFor } from "@pretable/core";

import { PretableSurface } from "../pretable-surface";
import type { PretableRejectedWrites } from "../rejected-write";
import { useLocalRowModel } from "../use-local-row-model";
import {
  usePretable,
  type UsePretableRowsWithIdOptions,
} from "../use-pretable";
import {
  COLUMNS,
  getRowId,
  type Holding,
  installWarnSpy,
  RECOVERY_ROWS,
  ROWS,
} from "./rejected-write-harness";

const warnSpy = installWarnSpy();

type Query = PretableQueryFor<typeof COLUMNS>;

const EMPTY_QUERY: Query = { filters: [], sort: [], rowGroups: [] };

/** Duplicate id — rejects with code "duplicate-row-id". */
const DUPLICATE_ROWS: readonly Holding[] = [...ROWS, { ...ROWS[0] }];

/**
 * A row whose accessor throws — rejects with code "accessor-failed", a
 * DIFFERENT fault kind from the duplicate above. Same getter fixture as
 * `invalid-rows-rejected.test.tsx`'s `THROWING_ACCESSOR`.
 */
const THROWING_ROWS: readonly Holding[] = [
  ...ROWS,
  {
    id: "boom",
    sector: "Tech",
    get qty(): number {
      throw new Error("getter boom");
    },
  } as Holding,
];

/*
 * `aggregate` is a closed union, so an invalid value cannot be spelled through
 * the helper — the cast is the same shape `invalid-derivations-rejected`
 * documents: exactly what a JavaScript consumer or a persisted layout hands
 * in. FRESH per call: the derivations gate compares the merged list by
 * identity, so a reused constant would be a no-op rather than a new attempt.
 */
function invalidColumns(): typeof COLUMNS {
  return [
    COLUMNS[0],
    { ...COLUMNS[1], aggregate: "nonsense" },
  ] as unknown as typeof COLUMNS;
}

/** A fresh VALID columns array — new identity, so the gate opens and clears. */
function freshColumns(): typeof COLUMNS {
  return [...COLUMNS] as unknown as typeof COLUMNS;
}

/** A `rowGroups` entry naming a column that does not exist. */
function unknownColumnQuery(columnId = "nope"): Query {
  return {
    filters: [],
    sort: [],
    rowGroups: [{ columnId }],
  } as unknown as Query;
}

/**
 * A text operator on the NUMBER column — rejected while `qty` is a number.
 * The cast is the persisted-layout shape the sibling suites document.
 */
const TEXT_OPERATOR_ON_QTY: Query = {
  filters: [{ columnId: "qty", operator: "contains", value: "1" }],
  sort: [],
  rowGroups: [],
} as unknown as Query;

/**
 * COLUMNS with `qty` re-typed as text (aggregate dropped with it — `sum`
 * belongs to the number type). Handing this in AFTER `TEXT_OPERATOR_ON_QTY`
 * was rejected is what makes that same query land on the derivations-re-apply
 * path — the landed-transition clear under test in the last query case.
 */
function textQtyColumns(): typeof COLUMNS {
  const qty = Object.fromEntries(
    Object.entries(COLUMNS[1] as unknown as Record<string, unknown>).filter(
      ([key]) => key !== "aggregate",
    ),
  );
  return [COLUMNS[0], { ...qty, type: "text" }] as unknown as typeof COLUMNS;
}

type ProbeProps = {
  readonly rows: readonly Holding[];
  readonly columns?: typeof COLUMNS;
  readonly query?: Query;
  readonly windowStart?: number;
};

/*
 * The `ɵwindowStart` spread is the one key outside the public options type —
 * it is how `pretable-surface.tsx` reports paging, and the identity-stability
 * test needs the window to move while a fault stands. Hence the cast.
 */
function probeOptions(props: ProbeProps) {
  return {
    rows: props.rows,
    columns: props.columns ?? COLUMNS,
    getRowId,
    viewportHeight: 400,
    ...(props.query === undefined
      ? {}
      : { query: props.query, onQueryChange: () => {} }),
    ...(props.windowStart === undefined
      ? {}
      : { ɵwindowStart: props.windowStart }),
  } as unknown as UsePretableRowsWithIdOptions<typeof COLUMNS, string>;
}

function renderModel(initialProps: ProbeProps) {
  return renderHook((props: ProbeProps) => usePretable(probeOptions(props)), {
    initialProps,
  });
}

type ModelModeProps = {
  readonly rows: readonly Holding[];
  readonly derivations?: typeof COLUMNS;
};

/**
 * The MODEL-MODE entry point: the consumer owns the model via
 * `useLocalRowModel` and hands it to `usePretable`. The local hook's guards
 * are the only ones that run — `usePretable`'s own rows/derivations effect
 * returns early in model mode — so these tests exercise the Symbol channel
 * end to end, not the own-fault path the suites above cover.
 */
function renderLocalModelMode(initialProps: ModelModeProps) {
  return renderHook(
    (props: ModelModeProps) => {
      const model = useLocalRowModel<typeof COLUMNS, string>({
        rows: props.rows,
        columns: COLUMNS,
        getRowId,
        ...(props.derivations === undefined
          ? {}
          : { derivations: props.derivations }),
      });
      return usePretable({ model, viewportHeight: 400 });
    },
    { initialProps },
  );
}

describe("useLocalRowModel rejections reach the same record", () => {
  test("a rejected local rows update surfaces on rejectedWrites.rows and clears on recovery", () => {
    const view = renderLocalModelMode({ rows: ROWS });
    const initial = view.result.current.rejectedWrites;
    expect(initial).toEqual({ rows: null, derivations: null, query: null });

    act(() => view.rerender({ rows: DUPLICATE_ROWS }));
    const rejected = view.result.current.rejectedWrites;
    expect(rejected.rows).toMatchObject({
      kind: "rows",
      code: "duplicate-row-id",
    });
    expect(rejected.rows!.message).toMatch(
      /no longer\s+match the ones you passed/,
    );
    expect(rejected.derivations).toBeNull();
    // Query is absent by construction for this entry point: the local hook
    // performs no query write, and usePretable's own effect returns early.
    expect(rejected.query).toBeNull();

    act(() => view.rerender({ rows: RECOVERY_ROWS }));
    expect(view.result.current.rejectedWrites.rows).toBeNull();
    // Recovery returns to the SHARED empty identity captured before the
    // rejection, exactly as the rows-mode recovery test above pins.
    expect(view.result.current.rejectedWrites).toBe(initial);
  });

  test("a rejected local derivations update surfaces on rejectedWrites.derivations and clears on recovery", () => {
    const view = renderLocalModelMode({ rows: ROWS });
    const initial = view.result.current.rejectedWrites;
    expect(initial).toEqual({ rows: null, derivations: null, query: null });

    act(() => view.rerender({ rows: ROWS, derivations: invalidColumns() }));
    const rejected = view.result.current.rejectedWrites;
    expect(rejected.derivations).toMatchObject({
      kind: "derivations",
      code: "invalid-query",
    });
    expect(rejected.rows).toBeNull();
    expect(rejected.query).toBeNull();

    act(() => view.rerender({ rows: ROWS, derivations: freshColumns() }));
    expect(view.result.current.rejectedWrites.derivations).toBeNull();
    // Recovery returns to the SHARED empty identity.
    expect(view.result.current.rejectedWrites).toBe(initial);
  });

  test("recovering ONLY rows keeps the standing derivations fault", () => {
    /*
     * THE CARRY-FORWARD PIN. The local hook's effect runs on every render but
     * each gate opens only for a new identity, so a commit that attempts one
     * write kind must republish the OTHER kind's standing fault untouched.
     * That is the `previousSlots` seeding in `use-local-row-model.ts` — a
     * refactor seeding the slots to null instead would clear a standing fault
     * on any unrelated rerender, and without this test nothing would fail.
     */
    const invalid = invalidColumns();
    const view = renderLocalModelMode({ rows: ROWS });
    // Both write kinds rejected in the same commit.
    act(() => view.rerender({ rows: DUPLICATE_ROWS, derivations: invalid }));
    const rejected = view.result.current.rejectedWrites;
    expect(rejected.rows).toMatchObject({ code: "duplicate-row-id" });
    expect(rejected.derivations).toMatchObject({ code: "invalid-query" });

    // Valid rows, SAME invalid derivations identity: only the rows gate opens.
    act(() => view.rerender({ rows: RECOVERY_ROWS, derivations: invalid }));
    expect(view.result.current.rejectedWrites.rows).toBeNull();
    expect(view.result.current.rejectedWrites.derivations).toMatchObject({
      kind: "derivations",
      code: "invalid-query",
    });
  });

  test("the fault follows the model: swapping models swaps the record", () => {
    /*
     * The store rides the MODEL INSTANCE, not the consuming hook. A diverged
     * model handed to a different surface must bring its divergence along,
     * and a clean model must not inherit another model's fault — which is
     * the reason the channel is a Symbol on the instance rather than state
     * inside `usePretable`.
     */
    type SwapProps = {
      readonly rowsA: readonly Holding[];
      readonly use: "a" | "b";
    };
    const view = renderHook(
      (props: SwapProps) => {
        const modelA = useLocalRowModel<typeof COLUMNS, string>({
          rows: props.rowsA,
          columns: COLUMNS,
          getRowId,
        });
        const modelB = useLocalRowModel<typeof COLUMNS, string>({
          rows: ROWS,
          columns: COLUMNS,
          getRowId,
        });
        return usePretable({
          model: props.use === "a" ? modelA : modelB,
          viewportHeight: 400,
        });
      },
      { initialProps: { rowsA: ROWS, use: "a" } as SwapProps },
    );

    // Diverge model A.
    act(() => view.rerender({ rowsA: DUPLICATE_ROWS, use: "a" }));
    expect(view.result.current.rejectedWrites.rows).toMatchObject({
      code: "duplicate-row-id",
    });

    // A clean model B reads all-null; A's fault does not leak across.
    act(() => view.rerender({ rowsA: DUPLICATE_ROWS, use: "b" }));
    expect(view.result.current.rejectedWrites).toEqual({
      rows: null,
      derivations: null,
      query: null,
    });

    // Swapping back, A's standing fault resurfaces from its own store.
    act(() => view.rerender({ rowsA: DUPLICATE_ROWS, use: "a" }));
    expect(view.result.current.rejectedWrites.rows).toMatchObject({
      kind: "rows",
      code: "duplicate-row-id",
    });
  });
});

describe("model.rejectedWrites — rows", () => {
  test("starts in sync, flips on rejection with the fault, clears on recovery", () => {
    const view = renderModel({ rows: ROWS });
    const initial = view.result.current.rejectedWrites;
    expect(initial).toEqual({ rows: null, derivations: null, query: null });

    act(() => view.rerender({ rows: DUPLICATE_ROWS }));
    const rejected = view.result.current.rejectedWrites;
    expect(rejected.rows).toMatchObject({
      kind: "rows",
      code: "duplicate-row-id",
    });
    expect(rejected.rows!.message).toMatch(
      /no longer\s+match the ones you passed/,
    );
    expect(rejected.derivations).toBeNull();
    expect(rejected.query).toBeNull();

    act(() => view.rerender({ rows: RECOVERY_ROWS }));
    expect(view.result.current.rejectedWrites.rows).toBeNull();
    // Recovery returns to the SHARED empty identity.
    expect(view.result.current.rejectedWrites).toBe(initial);
  });

  test("a second same-kind rejection replaces the record even though the warning latched", () => {
    const view = renderModel({ rows: ROWS });
    act(() => view.rerender({ rows: DUPLICATE_ROWS }));
    const first = view.result.current.rejectedWrites.rows!;
    expect(warnSpy()).toHaveBeenCalledTimes(1);

    // A different fault KIND on the rows write: the accessor-throwing row.
    act(() => view.rerender({ rows: THROWING_ROWS }));
    const second = view.result.current.rejectedWrites.rows!;
    expect(second).not.toBe(first);
    expect(second.code).not.toBe(first.code);
  });

  test("record identity is stable across renders that change nothing", () => {
    const view = renderModel({ rows: ROWS });
    act(() => view.rerender({ rows: DUPLICATE_ROWS }));
    const before = view.result.current.rejectedWrites;
    act(() => view.rerender({ rows: DUPLICATE_ROWS }));
    expect(view.result.current.rejectedWrites).toBe(before);
  });
});

describe("model.rejectedWrites — derivations", () => {
  test("flips on an invalid aggregate, other slots stay null, clears on recovery", () => {
    const view = renderModel({ rows: ROWS });
    const initial = view.result.current.rejectedWrites;
    expect(initial).toEqual({ rows: null, derivations: null, query: null });

    act(() => view.rerender({ rows: ROWS, columns: invalidColumns() }));
    const rejected = view.result.current.rejectedWrites;
    expect(rejected.derivations).toMatchObject({
      kind: "derivations",
      code: "invalid-query",
    });
    expect(rejected.rows).toBeNull();
    expect(rejected.query).toBeNull();

    act(() => view.rerender({ rows: ROWS, columns: freshColumns() }));
    expect(view.result.current.rejectedWrites.derivations).toBeNull();
    // Recovery returns to the SHARED empty identity.
    expect(view.result.current.rejectedWrites).toBe(initial);
  });

  test("windowed paging while a fault stands does not churn the record identity", () => {
    /*
     * THE FAULT-ONLY-DEPS PIN. `coherentWindowStart` moves on every valid
     * page change, so a derived record keyed on the whole snapshot would get
     * a fresh identity from ordinary paging — exactly what would make a
     * consumer's `onRejectedWriteChange` fire with nothing changed. A
     * DERIVATIONS fault is the one that can stand while the window moves:
     * a standing ROWS fault holds the coherent window by design.
     */
    const invalid = invalidColumns();
    const view = renderModel({ rows: ROWS, columns: COLUMNS, windowStart: 0 });
    act(() => view.rerender({ rows: ROWS, columns: invalid, windowStart: 0 }));
    const before = view.result.current.rejectedWrites;
    expect(before.derivations).not.toBeNull();

    // Same fault, same columns identity — only the window start pages.
    act(() => view.rerender({ rows: ROWS, columns: invalid, windowStart: 40 }));
    expect(view.result.current.rejectedWrites).toBe(before);
    expect(view.result.current.rejectedWrites.derivations).toBe(
      before.derivations,
    );
  });
});

describe("model.rejectedWrites — fault coexistence", () => {
  test("rows and derivations rejected in the SAME commit both surface from one publish", () => {
    /*
     * THE REASON THE PUBLISH MOVED BELOW THE DERIVATIONS BLOCK: one commit
     * can reject two write kinds, and the single consolidated publish must
     * carry both faults together. A publish issued between the two guards
     * would ship the rows fault with a stale derivations slot (or notify
     * twice for one commit).
     */
    const view = renderModel({ rows: ROWS });
    act(() =>
      view.rerender({ rows: DUPLICATE_ROWS, columns: invalidColumns() }),
    );
    const rejected = view.result.current.rejectedWrites;
    expect(rejected.rows).toMatchObject({
      kind: "rows",
      code: "duplicate-row-id",
    });
    expect(rejected.derivations).toMatchObject({
      kind: "derivations",
      code: "invalid-query",
    });
    expect(rejected.query).toBeNull();
  });
});

describe("model.rejectedWrites — query", () => {
  test("flips on an unknown-column query, does not taint rows/derivations, clears on recovery", async () => {
    const view = renderModel({ rows: ROWS, query: EMPTY_QUERY });
    const initial = view.result.current.rejectedWrites;
    expect(initial).toEqual({ rows: null, derivations: null, query: null });

    await act(async () => {
      view.rerender({ rows: ROWS, query: unknownColumnQuery() });
    });
    await waitFor(() => {
      expect(view.result.current.rejectedWrites.query).not.toBeNull();
    });
    const rejected = view.result.current.rejectedWrites;
    expect(rejected.query).toMatchObject({
      kind: "query",
      code: "invalid-query",
    });
    expect(rejected.rows).toBeNull();
    expect(rejected.derivations).toBeNull();

    // A corrected query is a new identity, so the reconciliation gate opens.
    const recovery: Query = {
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "sector" }],
    };
    await act(async () => {
      view.rerender({ rows: ROWS, query: recovery });
    });
    await waitFor(() => {
      expect(view.result.current.rejectedWrites.query).toBeNull();
    });
    // Recovery returns to the SHARED empty identity.
    expect(view.result.current.rejectedWrites).toBe(initial);
  });

  test("a changed query clears the record on the MAIN publish, ahead of the deferred re-apply", async () => {
    /*
     * THE MAIN-PUBLISH CLEAR PIN. The corrected-query recovery test above
     * cannot see this branch: its new query lands synchronously in the same
     * effect, so the landed-transition `query: null` publish masks the main
     * publish's `controlledQueryChanged` clear. Pairing the corrected query
     * with a SIMULTANEOUS derivations change defers `applyQuery` behind the
     * derivations transition's `finished` promise — so in the interim, before
     * any microtask runs, the only thing that can have cleared the slot is
     * the main publish. A changed controlled query is a new "last requested";
     * the old refusal no longer describes it.
     */
    const view = renderModel({ rows: ROWS, query: EMPTY_QUERY });
    await act(async () => {
      view.rerender({ rows: ROWS, query: unknownColumnQuery() });
    });
    await waitFor(() => {
      expect(view.result.current.rejectedWrites.query).not.toBeNull();
    });

    const corrected: Query = {
      filters: [],
      sort: [],
      rowGroups: [{ columnId: "sector" }],
    };
    // Sync act on purpose: no microtask runs before the assertion below.
    act(() => {
      view.rerender({ rows: ROWS, columns: freshColumns(), query: corrected });
    });
    expect(view.result.current.rejectedWrites.query).toBeNull();

    // And the deferred applyQuery then LANDS, so the slot stays null.
    await act(async () => {});
    expect(view.result.current.rejectedWrites.query).toBeNull();
  });

  test("a query rejected on the CHAINED path publishes its fault from the .then callback", async () => {
    /*
     * The rejection twin of the main-publish clear pin above, on the other
     * invocation path. A simultaneous derivations change defers `applyQuery`
     * behind the derivations transition, so the new query's rejection fires
     * from the `.then()` callback — the read-modify-write publish, over a
     * snapshot the effect's own publish has long since replaced. In the
     * interim the slot reads null (the main-publish clear: a changed query is
     * a new "last requested"); once the deferred apply settles it carries the
     * NEW fault, not the old one.
     */
    const view = renderModel({ rows: ROWS, query: EMPTY_QUERY });
    await act(async () => {
      view.rerender({ rows: ROWS, query: unknownColumnQuery("nope") });
    });
    await waitFor(() => {
      expect(view.result.current.rejectedWrites.query).toMatchObject({
        columnId: "nope",
      });
    });

    // Sync act on purpose: no microtask runs before the interim assertion.
    act(() => {
      view.rerender({
        rows: ROWS,
        columns: freshColumns(),
        query: unknownColumnQuery("other"),
      });
    });
    expect(view.result.current.rejectedWrites.query).toBeNull();

    await act(async () => {});
    expect(view.result.current.rejectedWrites.query).toMatchObject({
      kind: "query",
      code: "invalid-query",
      columnId: "other",
    });
    expect(view.result.current.rejectedWrites.rows).toBeNull();
    expect(view.result.current.rejectedWrites.derivations).toBeNull();
  });

  test("a rejected query that lands on a derivations re-apply clears the record", async () => {
    /*
     * THE LANDED-TRANSITION CLEAR. The query uses a text operator on a column
     * typed number, so it is rejected. The consumer then re-types that column
     * — the SAME query identity, so `controlledQueryChanged` is false and the
     * main publish keeps the record — and the derivations change re-runs
     * `applyQuery`, which now LANDS. Only the clear on the landed path can
     * take the record down here.
     */
    const view = renderModel({ rows: ROWS, query: EMPTY_QUERY });

    await act(async () => {
      view.rerender({ rows: ROWS, query: TEXT_OPERATOR_ON_QTY });
    });
    await waitFor(() => {
      expect(view.result.current.rejectedWrites.query).toMatchObject({
        kind: "query",
        code: "invalid-query",
      });
    });

    await act(async () => {
      view.rerender({
        rows: ROWS,
        columns: textQtyColumns(),
        query: TEXT_OPERATOR_ON_QTY,
      });
    });
    await waitFor(() => {
      expect(view.result.current.rejectedWrites.query).toBeNull();
    });
  });
});

/**
 * A second duplicate-id fixture with a DIFFERENT duplicated id from
 * `DUPLICATE_ROWS` (h2 here, h1 there): same fault code, same warn key — the
 * pair that separates the callback (fires on every transition) from the
 * console warning (latched per key).
 */
const SECOND_DUPLICATE_ROWS: readonly Holding[] = [...ROWS, { ...ROWS[1] }];

describe("onRejectedWriteChange", () => {
  const surface = (
    rows: readonly Holding[],
    onRejectedWriteChange: (next: PretableRejectedWrites) => void,
  ) => (
    <PretableSurface<Holding, string, typeof COLUMNS>
      ariaLabel="probe"
      columns={COLUMNS}
      getRowId={getRowId}
      overscan={0}
      rows={rows}
      viewportHeight={400}
      onRejectedWriteChange={onRejectedWriteChange}
    />
  );

  test("silent at mount and on valid updates; fires on rejection and on recovery", () => {
    const calls: PretableRejectedWrites[] = [];
    const push = (next: PretableRejectedWrites) => calls.push(next);

    const view = render(surface(ROWS, push));
    expect(calls).toHaveLength(0); // all-null mount

    act(() => void view.rerender(surface(RECOVERY_ROWS, push)));
    expect(calls).toHaveLength(0); // valid update

    act(() => void view.rerender(surface(DUPLICATE_ROWS, push)));
    expect(calls).toHaveLength(1); // rejection
    expect(calls[0]!.rows).toMatchObject({
      kind: "rows",
      code: "duplicate-row-id",
    });

    act(() => void view.rerender(surface(DUPLICATE_ROWS, push)));
    expect(calls).toHaveLength(1); // attempted-once: no re-fire

    act(() => void view.rerender(surface(ROWS, push)));
    expect(calls).toHaveLength(2); // recovery fires
    expect(calls[1]!.rows).toBeNull();
  });

  test("fires again for a second same-kind rejection while the console warning stays latched", () => {
    const calls: PretableRejectedWrites[] = [];
    const push = (next: PretableRejectedWrites) => calls.push(next);

    const view = render(surface(ROWS, push));
    expect(calls).toHaveLength(0);
    expect(warnSpy()).toHaveBeenCalledTimes(0);

    // First duplicate: the callback fires and the warning latches its key.
    act(() => void view.rerender(surface(DUPLICATE_ROWS, push)));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.rows).toMatchObject({ code: "duplicate-row-id" });
    expect(warnSpy()).toHaveBeenCalledTimes(1);

    // Recovery: the callback fires; nothing to warn about.
    act(() => void view.rerender(surface(ROWS, push)));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.rows).toBeNull();
    expect(warnSpy()).toHaveBeenCalledTimes(1);

    /*
     * Second SAME-code rejection (a different duplicated id): the warn key
     * (`prefix:code:columnId`) is unchanged, so the console count stays at
     * the latch — while the callback, which latches NOTHING, fires again.
     */
    act(() => void view.rerender(surface(SECOND_DUPLICATE_ROWS, push)));
    expect(calls).toHaveLength(3);
    expect(calls[2]!.rows).toMatchObject({ code: "duplicate-row-id" });
    expect(warnSpy()).toHaveBeenCalledTimes(1);

    // A DIFFERENT fault code after another recovery: both fire — the latch
    // is per key, not per kind.
    act(() => void view.rerender(surface(ROWS, push)));
    expect(calls).toHaveLength(4);
    act(() => void view.rerender(surface(THROWING_ROWS, push)));
    expect(calls).toHaveLength(5);
    expect(calls[4]!.rows).toMatchObject({ code: "accessor-failed" });
    expect(warnSpy()).toHaveBeenCalledTimes(2);
  });
});
