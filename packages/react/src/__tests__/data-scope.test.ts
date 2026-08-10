import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveAriaRowCount,
  resolveDataScope,
  warnOnEngineSortOverPartialWindow,
  type DataHonestyInput,
} from "../data-scope";
import { resetDevWarnings } from "../dev-warn";

const EXTERNAL = { filter: "external", sort: "external" } as const;

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

describe("warnOnEngineSortOverPartialWindow", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetDevWarnings();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

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
