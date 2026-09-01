// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { type PretableQueryFor } from "@pretable/core";

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
