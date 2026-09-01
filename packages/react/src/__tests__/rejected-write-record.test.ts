import { describe, expect, test } from "vitest";

import {
  EMPTY_REJECTED_WRITES,
  INVALID_QUERY_CODE,
  compiledQueryGuard,
  rejectedWriteEquals,
  reportRejectedWrite,
  rowModelCodeGuard,
  toRejectedWrite,
} from "../rejected-write";

function rowModelError(code: string, message: string): Error {
  const error = new Error(message);
  Object.defineProperty(error, "name", { value: "PretableRowModelError" });
  Object.defineProperty(error, "code", { value: code });
  return error;
}

describe("reportRejectedWrite return value", () => {
  test("returns the fault and the described message for an accepted error", () => {
    const guard = rowModelCodeGuard(
      "test-rows-rejected",
      ({ detail }) => `described: ${detail}`,
    );
    const report = reportRejectedWrite(
      rowModelError("duplicate-row-id", "Duplicate row ID dup."),
      guard,
    );
    expect(report.fault.code).toBe("duplicate-row-id");
    expect(report.message).toBe("described: Duplicate row ID dup.");
  });

  test("still rethrows an unaccepted error", () => {
    const guard = rowModelCodeGuard("test-rows-rejected", () => "unused");
    expect(() => reportRejectedWrite(new Error("plain"), guard)).toThrow(
      "plain",
    );
  });

  test("compiled-query guard reports with the invalid-query code vocabulary", () => {
    const error = new Error("bad filter");
    Object.defineProperty(error, "name", {
      value: "CompiledQueryValidationError",
    });
    const guard = compiledQueryGuard(
      "test-query-rejected",
      ({ detail }) => `q: ${detail}`,
    );
    const report = reportRejectedWrite(error, guard);
    expect(report.message).toBe("q: bad filter");
    // The public record for compiled-query rejections carries this constant.
    expect(INVALID_QUERY_CODE).toBe("invalid-query");
  });
});

describe("toRejectedWrite", () => {
  test("omits columnId rather than carrying undefined", () => {
    const record = toRejectedWrite("rows", "duplicate-row-id", "m", undefined);
    expect("columnId" in record).toBe(false);
    const withColumn = toRejectedWrite("rows", "accessor-failed", "m", "qty");
    expect(withColumn.columnId).toBe("qty");
  });
});

describe("rejectedWriteEquals", () => {
  const a = toRejectedWrite("rows", "duplicate-row-id", "m", "qty");
  test("null/null equal, null/value not", () => {
    expect(rejectedWriteEquals(null, null)).toBe(true);
    expect(rejectedWriteEquals(a, null)).toBe(false);
    expect(rejectedWriteEquals(null, a)).toBe(false);
  });
  test("field-equal records are equal; any field difference is not", () => {
    expect(
      rejectedWriteEquals(
        a,
        toRejectedWrite("rows", "duplicate-row-id", "m", "qty"),
      ),
    ).toBe(true);
    expect(
      rejectedWriteEquals(
        a,
        toRejectedWrite("rows", "accessor-failed", "m", "qty"),
      ),
    ).toBe(false);
    expect(
      rejectedWriteEquals(
        a,
        toRejectedWrite("rows", "duplicate-row-id", "m2", "qty"),
      ),
    ).toBe(false);
    expect(
      rejectedWriteEquals(
        a,
        toRejectedWrite("rows", "duplicate-row-id", "m", undefined),
      ),
    ).toBe(false);
    expect(
      rejectedWriteEquals(
        a,
        toRejectedWrite("query", "duplicate-row-id", "m", "qty"),
      ),
    ).toBe(false);
  });
});

describe("EMPTY_REJECTED_WRITES", () => {
  test("is all-null and frozen", () => {
    expect(EMPTY_REJECTED_WRITES).toEqual({
      rows: null,
      derivations: null,
      query: null,
    });
    expect(Object.isFrozen(EMPTY_REJECTED_WRITES)).toBe(true);
  });
});
