import { describe, expect, test } from "vitest";

import * as core from "../index";
import { isValidDateValue } from "../index";

type CorePublicApi = typeof import("../index");
type PrivateCalendarDateName =
  | "MIN_DATE_VALUE"
  | "MAX_DATE_VALUE"
  | "parseDateValue"
  | "dateValueToUtcMs"
  | "compareDateValues"
  | "addDateValueDays"
  | "addDateValueMonths";
type AssertNever<T extends never> = T;
type _PrivateCalendarDateExportsStayPrivate = AssertNever<
  Extract<keyof CorePublicApi, PrivateCalendarDateName>
>;

void (undefined as unknown as _PrivateCalendarDateExportsStayPrivate);

describe("calendar-date public API", () => {
  test("exports a validator that narrows unknown values to strings", () => {
    const value: unknown = "2024-02-29";

    if (!isValidDateValue(value)) {
      throw new Error("expected a valid date value");
    }

    const narrowed: string = value;
    expect(narrowed).toBe("2024-02-29");
    expect(isValidDateValue("2026-02-30")).toBe(false);
  });

  test.each([
    "MIN_DATE_VALUE",
    "MAX_DATE_VALUE",
    "parseDateValue",
    "dateValueToUtcMs",
    "compareDateValues",
    "addDateValueDays",
    "addDateValueMonths",
  ] as const)("does not expose private helper %s at runtime", (name) => {
    expect(core).not.toHaveProperty(name);
  });
});
