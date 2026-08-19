import { describe, expect, test } from "vitest";

import type { PretableAggregator } from "../column-types";
import { lowerCalendarDateAggregate } from "../calendar-date-aggregates";

type RuntimeCalendarDateAggregator = PretableAggregator<
  object,
  unknown,
  string | null,
  string | null
>;

function dateAggregator(kind: "min" | "max"): RuntimeCalendarDateAggregator {
  return lowerCalendarDateAggregate(
    "date",
    kind,
  ) as RuntimeCalendarDateAggregator;
}

function fold(
  aggregator: RuntimeCalendarDateAggregator,
  values: readonly unknown[],
): string | null {
  return aggregator.finalize(
    values.reduce<string | null>(
      (accumulator, value) =>
        aggregator.accumulate(accumulator, value, Object.freeze({})),
      aggregator.init(),
    ),
  );
}

describe("calendar-date aggregate lowering", () => {
  test.each([
    ["min", "2024-01-01"],
    ["max", "2026-12-31"],
  ] as const)(
    "%s selects canonical extrema and ignores invalid or empty values",
    (kind, expected) => {
      const aggregator = dateAggregator(kind);

      expect(
        fold(aggregator, [
          null,
          undefined,
          "",
          "2025-02-29",
          "2025-2-01",
          "not-a-date",
          new Date("2020-01-01T00:00:00.000Z"),
          "2026-12-31",
          "2024-01-01",
          "2025-06-15",
        ]),
      ).toBe(expected);
      expect(fold(aggregator, [])).toBeNull();
      expect(fold(aggregator, [null, "2025-02-29", 0])).toBeNull();
    },
  );

  test.each(["min", "max"] as const)(
    "%s is associative across every partition and merge order",
    (kind) => {
      const aggregator = dateAggregator(kind);
      const partitions = [
        ["2025-07-04", "invalid"],
        [null, "2024-02-29"],
        ["2026-01-01", undefined],
      ] as const;
      const accumulated = partitions.map((partition) =>
        partition.reduce(
          (accumulator, value) =>
            aggregator.accumulate(accumulator, value, Object.freeze({})),
          aggregator.init(),
        ),
      );
      const expected = fold(aggregator, partitions.flat());
      const orders = [
        [0, 1, 2],
        [0, 2, 1],
        [1, 0, 2],
        [1, 2, 0],
        [2, 0, 1],
        [2, 1, 0],
      ] as const;

      for (const order of orders) {
        const leftAssociated = aggregator.merge(
          aggregator.merge(accumulated[order[0]]!, accumulated[order[1]]!),
          accumulated[order[2]]!,
        );
        const rightAssociated = aggregator.merge(
          accumulated[order[0]]!,
          aggregator.merge(accumulated[order[1]]!, accumulated[order[2]]!),
        );
        expect(aggregator.finalize(leftAssociated)).toBe(expected);
        expect(aggregator.finalize(rightAssociated)).toBe(expected);
      }
    },
  );

  test("keeps private built-ins frozen and accumulator operations immutable", () => {
    const min = dateAggregator("min");
    const max = dateAggregator("max");
    const initial = min.init();
    const first = min.accumulate(initial, "2026-08-18", Object.freeze({}));
    const second = min.accumulate(first, "2025-08-18", Object.freeze({}));

    expect(Object.isFrozen(min)).toBe(true);
    expect(Object.isFrozen(max)).toBe(true);
    expect(initial).toBeNull();
    expect(first).toBe("2026-08-18");
    expect(second).toBe("2025-08-18");
    expect(min.finalize(second)).toBe(second);
    expect(dateAggregator("min")).toBe(min);
    expect(dateAggregator("max")).toBe(max);
  });

  test("does not lower non-date or non-extremum aggregates", () => {
    const custom: PretableAggregator<object, unknown, unknown, unknown> =
      Object.freeze({
        init: () => ({}),
        accumulate: (accumulator: unknown) => accumulator,
        merge: (left: unknown) => left,
        finalize: () => null,
      });

    expect(lowerCalendarDateAggregate("number", "min")).toBe("min");
    expect(lowerCalendarDateAggregate("date", "count")).toBe("count");
    expect(lowerCalendarDateAggregate("date", custom)).toBe(custom);
  });
});
