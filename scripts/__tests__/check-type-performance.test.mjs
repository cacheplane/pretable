import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  checkTypePerformanceBudget,
  createTypeScriptInvocation,
  parseExtendedDiagnostics,
  resolveTypePerformanceConfiguration,
  validateFixtureMapping,
  validateTypePerformanceBudgets,
} from "../check-type-performance.mjs";

const require = createRequire(import.meta.url);

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

test("invokes the installed TypeScript CLI through GC-enabled Node", async () => {
  const configPath = "/tmp/config with spaces; $(not-a-shell).json";
  const invocation = createTypeScriptInvocation(configPath);
  const typescriptDirectory = path.dirname(
    require.resolve("typescript/package.json"),
  );
  const cliPath = invocation.args[1];

  assert.equal(invocation.executable, process.execPath);
  assert.equal(path.isAbsolute(cliPath), true);
  await access(cliPath);
  const relativeCliPath = path.relative(typescriptDirectory, cliPath);
  assert.equal(path.isAbsolute(relativeCliPath), false);
  assert.doesNotMatch(relativeCliPath, /^\.\.(?:[/\\]|$)/);
  assert.deepEqual(invocation.args, [
    "--expose-gc",
    cliPath,
    "-p",
    configPath,
    "--noEmit",
    "--extendedDiagnostics",
    "--pretty",
    "false",
  ]);
  assert.equal(invocation.shell, undefined);
  assert.equal(
    invocation.args.some((argument) => /^(?:pnpm|pnpm\.cmd)$/i.test(argument)),
    false,
  );
});

test("parses deterministic metrics and normalizes memory to KiB", () => {
  assert.deepEqual(parseExtendedDiagnostics(diagnostics()), {
    checkTimeSeconds: 1.25,
    instantiations: 12_345,
    memoryKiB: 62_500,
  });
  for (const [memory, memoryKiB] of [
    ["1024 K", 1_000],
    ["1024 kB", 1_000],
    ["1 MB", 977],
    ["1024 KiB", 1_024],
    ["1 MiB", 1_024],
    ["2048 B", 2],
  ]) {
    assert.equal(
      parseExtendedDiagnostics(diagnostics({ memory })).memoryKiB,
      memoryKiB,
    );
  }
  assert.throws(
    () => parseExtendedDiagnostics(diagnostics({ memory: "64 parsecs" })),
    /malformed Memory used metric.*64 parsecs/i,
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
      memoryKiB: 62_500,
      summary:
        "columns-100: 12,345 instantiations, 62,500 KiB memory, 999.99s check time (informational)",
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
        budget: { maxInstantiations: 12_344, maxMemoryKiB: 62_499 },
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
        /Memory used 62,500 KiB exceeds budget 62,499 KiB/,
      );
      assert.doesNotMatch(error.message, /check time.*exceed/i);
      return true;
    },
  );
});

const expectedFixtureMapping = [
  {
    label: "columns-100",
    tsconfig: "type-tests/performance/tsconfig.100.json",
  },
  {
    label: "columns-500",
    tsconfig: "type-tests/performance/tsconfig.500.json",
  },
];

test("requires the exact normalized immutable fixture mapping", () => {
  assert.deepEqual(
    validateFixtureMapping([
      {
        label: "columns-100",
        tsconfig: "./type-tests/performance/tsconfig.100.json",
      },
      {
        label: "columns-500",
        tsconfig: "type-tests/performance/fixtures/../tsconfig.500.json",
      },
    ]),
    expectedFixtureMapping,
  );
});

test("rejects missing and extra fixture labels", () => {
  assert.throws(
    () => validateFixtureMapping(expectedFixtureMapping.slice(0, 1)),
    /fixture mapping.*missing columns-500/i,
  );
  assert.throws(
    () =>
      validateFixtureMapping([
        ...expectedFixtureMapping,
        {
          label: "columns-1000",
          tsconfig: "type-tests/performance/tsconfig.1000.json",
        },
      ]),
    /fixture mapping.*unexpected columns-1000/i,
  );
});

test("rejects swapped, mistargeted, and duplicate fixture configs", () => {
  assert.throws(
    () =>
      validateFixtureMapping([
        {
          ...expectedFixtureMapping[0],
          tsconfig: expectedFixtureMapping[1].tsconfig,
        },
        {
          ...expectedFixtureMapping[1],
          tsconfig: expectedFixtureMapping[0].tsconfig,
        },
      ]),
    /columns-100.*must map to.*tsconfig\.100\.json/i,
  );
  assert.throws(
    () =>
      validateFixtureMapping([
        expectedFixtureMapping[0],
        {
          ...expectedFixtureMapping[1],
          tsconfig: "type-tests/performance/not-500.json",
        },
      ]),
    /columns-500.*must map to.*tsconfig\.500\.json/i,
  );
  assert.throws(
    () =>
      validateFixtureMapping([
        expectedFixtureMapping[0],
        {
          ...expectedFixtureMapping[1],
          tsconfig: expectedFixtureMapping[0].tsconfig,
        },
      ]),
    /duplicate fixture config target.*tsconfig\.100\.json/i,
  );
});

test("requires exact budget labels independently of config paths", () => {
  const validBudgets = {
    "columns-100": { maxInstantiations: 1, maxMemoryKiB: 1 },
    "columns-500": { maxInstantiations: 1, maxMemoryKiB: 1 },
  };
  assert.deepEqual(validateTypePerformanceBudgets(validBudgets), validBudgets);
  assert.throws(
    () =>
      validateTypePerformanceBudgets({
        "columns-100": validBudgets["columns-100"],
      }),
    /budgets.*missing columns-500/i,
  );
  assert.throws(
    () =>
      validateTypePerformanceBudgets({
        ...validBudgets,
        extra: validBudgets["columns-100"],
      }),
    /budgets.*unexpected extra/i,
  );
  assert.throws(
    () =>
      validateTypePerformanceBudgets({
        ...validBudgets,
        "columns-100": {
          ...validBudgets["columns-100"],
          tsconfig: "type-tests/performance/tsconfig.500.json",
        },
      }),
    /columns-100 budget.*must not define.*tsconfig/i,
  );
});

test("resolves default budgets and configs independently of cwd", async (t) => {
  const originalCwd = process.cwd();
  const unrelatedCwd = await mkdtemp(
    path.join(tmpdir(), "pretable-type-perf-"),
  );
  t.after(async () => {
    process.chdir(originalCwd);
    await rm(unrelatedCwd, { force: true, recursive: true });
  });
  const expected = resolveTypePerformanceConfiguration();
  process.chdir(unrelatedCwd);
  assert.deepEqual(resolveTypePerformanceConfiguration(), expected);
  assert.ok(path.isAbsolute(expected.budgetsPath));
  assert.deepEqual(
    expected.fixtures.map(({ configPath, label }) => ({
      configPath: path
        .relative(expected.workspaceDirectory, configPath)
        .split(path.sep)
        .join("/"),
      label,
    })),
    expectedFixtureMapping.map(({ label, tsconfig }) => ({
      configPath: tsconfig,
      label,
    })),
  );
});
