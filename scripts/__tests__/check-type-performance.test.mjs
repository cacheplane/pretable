import assert from "node:assert/strict";
import test from "node:test";

import {
  checkTypePerformanceBudget,
  parseExtendedDiagnostics,
} from "../check-type-performance.mjs";

const diagnostics = ({
  checkTime = "1.25s",
  instantiations = "12,345",
  memory = "64 MB",
} = {}) => `
Files:                         42
Instantiations:                ${instantiations}
Memory used:                   ${memory}
Check time:                    ${checkTime}
Total time:                    2.00s
`;

test("parses deterministic metrics and normalizes memory to KiB", () => {
  assert.deepEqual(parseExtendedDiagnostics(diagnostics()), {
    checkTimeSeconds: 1.25,
    instantiations: 12_345,
    memoryKiB: 65_536,
  });
  assert.equal(
    parseExtendedDiagnostics(diagnostics({ memory: "1.5 MiB" })).memoryKiB,
    1_536,
  );
  assert.equal(
    parseExtendedDiagnostics(diagnostics({ memory: "2048 B" })).memoryKiB,
    2,
  );
});

test("rejects missing required diagnostics with the metric name", () => {
  assert.throws(
    () => parseExtendedDiagnostics("Memory used: 1000K\nCheck time: 1.00s\n"),
    /missing Instantiations metric/i,
  );
  assert.throws(
    () => parseExtendedDiagnostics("Instantiations: 1000\nCheck time: 1.00s\n"),
    /missing Memory used metric/i,
  );
  assert.throws(
    () =>
      parseExtendedDiagnostics("Instantiations: 1000\nMemory used: 1000K\n"),
    /missing Check time metric/i,
  );
});

test("rejects malformed diagnostic values deterministically", () => {
  assert.throws(
    () =>
      parseExtendedDiagnostics(
        diagnostics({ instantiations: "twelve thousand" }),
      ),
    /malformed Instantiations metric.*twelve thousand/i,
  );
  assert.throws(
    () => parseExtendedDiagnostics(diagnostics({ memory: "64 parsecs" })),
    /malformed Memory used metric.*64 parsecs/i,
  );
  assert.throws(
    () => parseExtendedDiagnostics(diagnostics({ checkTime: "fast" })),
    /malformed Check time metric.*fast/i,
  );
});

test("rejects duplicate diagnostics instead of choosing one", () => {
  assert.throws(
    () => parseExtendedDiagnostics(`${diagnostics()}Instantiations: 12,346\n`),
    /duplicate Instantiations metric/i,
  );
  assert.throws(
    () => parseExtendedDiagnostics(`${diagnostics()}Memory used: 65 MB\n`),
    /duplicate Memory used metric/i,
  );
  assert.throws(
    () => parseExtendedDiagnostics(`${diagnostics()}Check time: 1.30s\n`),
    /duplicate Check time metric/i,
  );
});

test("reports check time without using it as a budget gate", () => {
  assert.deepEqual(
    checkTypePerformanceBudget({
      budget: { maxInstantiations: 20_000, maxMemoryKiB: 70_000 },
      diagnostics: diagnostics({ checkTime: "999.99s" }),
      label: "columns-100",
    }),
    {
      checkTimeSeconds: 999.99,
      instantiations: 12_345,
      label: "columns-100",
      memoryKiB: 65_536,
      summary:
        "columns-100: 12,345 instantiations, 65,536 KiB memory, 999.99s check time (informational)",
    },
  );
});

test("rejects malformed budgets before comparing diagnostics", () => {
  for (const budget of [
    {},
    { maxInstantiations: 0, maxMemoryKiB: 1 },
    { maxInstantiations: 1, maxMemoryKiB: -1 },
    { maxInstantiations: 1.5, maxMemoryKiB: 2 },
  ]) {
    assert.throws(
      () =>
        checkTypePerformanceBudget({
          budget,
          diagnostics: diagnostics(),
          label: "columns-100",
        }),
      /columns-100.*budget.*positive integer/i,
    );
  }
});

test("reports every deterministic metric that exceeds its budget", () => {
  assert.throws(
    () =>
      checkTypePerformanceBudget({
        budget: { maxInstantiations: 12_344, maxMemoryKiB: 65_535 },
        diagnostics: diagnostics({ checkTime: "0.01s" }),
        label: "columns-500",
      }),
    (error) => {
      assert.match(
        error.message,
        /columns-500.*Instantiations 12,345 exceed budget 12,344/,
      );
      assert.match(
        error.message,
        /Memory used 65,536 KiB exceeds budget 65,535 KiB/,
      );
      assert.doesNotMatch(error.message, /check time.*exceed/i);
      return true;
    },
  );
});
