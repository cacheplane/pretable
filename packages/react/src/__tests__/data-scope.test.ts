import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveAriaRowCount,
  resolveDataScope,
  warnOnEngineSortOverPartialWindow,
  warnOnMissingDatasetKeyForWindow,
  type DataHonestyInput,
} from "../data-scope";
import { resetDevWarnings } from "../dev-warn";

const EXTERNAL = { filter: "external", sort: "external" } as const;

// Hoisted to the file: the honesty rules warn from inside `resolveAriaRowCount`
// too, so the downgrade cases in the first describe would otherwise print to a
// real console and carry their once-per-process latch into later tests.
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetDevWarnings();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

function input(overrides: Partial<DataHonestyInput> = {}): DataHonestyInput {
  return {
    visibleRowCount: 2,
    isGrouped: false,
    loadedRowCount: 2,
    matchingTotal: { kind: "exact", count: 5432 },
    ...overrides,
  };
}

describe("resolveAriaRowCount", () => {
  it("publishes the population plus the header under full external authority", () => {
    expect(resolveAriaRowCount(input(), EXTERNAL)).toBe(5433);
  });

  it("downgrades in local mode", () => {
    expect(resolveAriaRowCount(input(), undefined)).toBe(3);
  });

  it("downgrades when filter authority is engine", () => {
    expect(
      resolveAriaRowCount(input(), { filter: "engine", sort: "external" }),
    ).toBe(3);
  });

  it("downgrades when sort authority is engine", () => {
    expect(
      resolveAriaRowCount(input(), { filter: "external", sort: "engine" }),
    ).toBe(3);
  });

  it("downgrades while grouping is active", () => {
    expect(
      resolveAriaRowCount(
        input({ visibleRowCount: 4, isGrouped: true }),
        EXTERNAL,
      ),
    ).toBe(5);
  });

  it("reports -1 for an estimate total", () => {
    expect(
      resolveAriaRowCount(
        input({ matchingTotal: { kind: "estimate", count: 5000 } }),
        EXTERNAL,
      ),
    ).toBe(-1);
  });

  it("reports -1 for an unknown total", () => {
    expect(
      resolveAriaRowCount(
        input({ matchingTotal: { kind: "unknown" } }),
        EXTERNAL,
      ),
    ).toBe(-1);
  });

  it("downgrades when the total claims fewer records than are loaded", () => {
    expect(
      resolveAriaRowCount(
        input({ matchingTotal: { kind: "exact", count: 1 } }),
        EXTERNAL,
      ),
    ).toBe(3);
  });

  it("downgrades for a negative count", () => {
    expect(
      resolveAriaRowCount(
        input({ matchingTotal: { kind: "exact", count: -5 } }),
        EXTERNAL,
      ),
    ).toBe(3);
  });

  it("downgrades for a fractional count rather than emit a non-integer", () => {
    expect(
      resolveAriaRowCount(
        input({ matchingTotal: { kind: "exact", count: 100.5 } }),
        EXTERNAL,
      ),
    ).toBe(3);
  });

  it("downgrades for a non-finite count", () => {
    expect(
      resolveAriaRowCount(
        input({ matchingTotal: { kind: "exact", count: Number.NaN } }),
        EXTERNAL,
      ),
    ).toBe(3);
  });
});

describe("resolveDataScope", () => {
  it('is "all" in local mode, whatever the total claims', () => {
    expect(resolveDataScope(input(), undefined)).toBe("all");
  });

  it('is "all" when filter authority is engine', () => {
    expect(
      resolveDataScope(input(), { filter: "engine", sort: "external" }),
    ).toBe("all");
  });

  it('is "loaded" when the population exceeds the loaded records', () => {
    expect(resolveDataScope(input(), EXTERNAL)).toBe("loaded");
  });

  it('is "all" when the exact population is fully loaded', () => {
    expect(
      resolveDataScope(
        input({ matchingTotal: { kind: "exact", count: 2 } }),
        EXTERNAL,
      ),
    ).toBe("all");
  });

  it('is "all" when the total undercounts the loaded records', () => {
    expect(
      resolveDataScope(
        input({ matchingTotal: { kind: "exact", count: 1 } }),
        EXTERNAL,
      ),
    ).toBe("all");
  });

  it('is "loaded" for an estimate total', () => {
    expect(
      resolveDataScope(
        input({ matchingTotal: { kind: "estimate", count: 2 } }),
        EXTERNAL,
      ),
    ).toBe("loaded");
  });

  it('is "loaded" for an unknown total', () => {
    expect(
      resolveDataScope(input({ matchingTotal: { kind: "unknown" } }), EXTERNAL),
    ).toBe("loaded");
  });
});

/**
 * The design pairs the production downgrade with a dev assertion: silently
 * reporting loaded-model counts leaves a consumer whose window really is
 * noncontiguous with no way to notice.
 */
describe("contiguous-window violations", () => {
  it("warns when the total claims fewer records than are loaded", () => {
    resolveAriaRowCount(
      input({ matchingTotal: { kind: "exact", count: 1 } }),
      EXTERNAL,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "fewer matching records than the loaded window's end",
    );
  });

  it("warns when a windowed total ends past the population", () => {
    // start 40,000 + loaded 2 = window end 40,002, which the total of
    // 40,001 cannot cover, even though 40,001 alone is >= loadedRowCount.
    resolveAriaRowCount(
      input({
        matchingTotal: { kind: "exact", count: 40_001 },
        windowStart: 40_000,
      }),
      EXTERNAL,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "fewer matching records than the loaded window's end",
    );
  });

  it("publishes the population when a windowed total covers the window's end", () => {
    expect(
      resolveAriaRowCount(
        input({
          matchingTotal: { kind: "exact", count: 40_002 },
          windowStart: 40_000,
        }),
        EXTERNAL,
      ),
    ).toBe(40_003);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when the count cannot be published as an integer", () => {
    resolveAriaRowCount(
      input({ matchingTotal: { kind: "exact", count: 100.5 } }),
      EXTERNAL,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("not an integer");
  });

  it("warns once across repeated renders", () => {
    const undercount = input({ matchingTotal: { kind: "exact", count: 1 } });
    resolveAriaRowCount(undercount, EXTERNAL);
    resolveAriaRowCount(undercount, EXTERNAL);
    resolveAriaRowCount(undercount, EXTERNAL);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a total that is merely unknown", () => {
    resolveAriaRowCount(
      input({ matchingTotal: { kind: "unknown" } }),
      EXTERNAL,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the population is honest", () => {
    resolveAriaRowCount(input(), EXTERNAL);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent in local mode, where no total was ever supplied", () => {
    resolveAriaRowCount(
      input({ matchingTotal: { kind: "exact", count: 1 } }),
      undefined,
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("warnOnEngineSortOverPartialWindow", () => {
  it("warns when engine sort folds a partial window", () => {
    warnOnEngineSortOverPartialWindow(input(), {
      filter: "external",
      sort: "engine",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      'sort authority is "engine" while only part of the matching population is loaded',
    );
  });

  it("warns once across repeated renders", () => {
    const partial = { filter: "external", sort: "engine" } as const;
    warnOnEngineSortOverPartialWindow(input(), partial);
    warnOnEngineSortOverPartialWindow(input(), partial);
    warnOnEngineSortOverPartialWindow(input(), partial);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent when sort authority is external", () => {
    warnOnEngineSortOverPartialWindow(input(), EXTERNAL);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent in local mode", () => {
    warnOnEngineSortOverPartialWindow(input(), undefined);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the whole population is loaded", () => {
    warnOnEngineSortOverPartialWindow(
      input({ matchingTotal: { kind: "exact", count: 2 } }),
      { filter: "external", sort: "engine" },
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when no exact total proves the window is partial", () => {
    warnOnEngineSortOverPartialWindow(
      input({ matchingTotal: { kind: "unknown" } }),
      { filter: "external", sort: "engine" },
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("warnOnMissingDatasetKeyForWindow", () => {
  it("warns when a trusted window publishes no datasetKey", () => {
    warnOnMissingDatasetKeyForWindow(true, undefined);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "publishes resultMeta.window but no resultMeta.datasetKey",
    );
  });

  it("warns once across repeated renders", () => {
    warnOnMissingDatasetKeyForWindow(true, undefined);
    warnOnMissingDatasetKeyForWindow(true, undefined);
    warnOnMissingDatasetKeyForWindow(true, undefined);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent once a datasetKey is published", () => {
    warnOnMissingDatasetKeyForWindow(true, "sort=name");
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays silent when the window is not trusted at all", () => {
    // Local mode, grouping, an inexact total -- no window means no spans and
    // so nothing lost by having no key to pair them with.
    warnOnMissingDatasetKeyForWindow(false, undefined);
    expect(warn).not.toHaveBeenCalled();
  });
});
