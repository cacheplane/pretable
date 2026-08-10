import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.dirname(scriptDirectory);
const defaultBudgetsPath = path.join(
  workspaceDirectory,
  "type-tests",
  "performance",
  "budgets.json",
);
const expectedFixtures = Object.freeze([
  Object.freeze({
    label: "columns-100",
    tsconfig: "type-tests/performance/tsconfig.100.json",
  }),
  Object.freeze({
    label: "columns-500",
    tsconfig: "type-tests/performance/tsconfig.500.json",
  }),
]);

function readSingleMetric(output, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^\\s*${escapedName}:\\s*(.*?)\\s*$`, "gim");
  const values = [...output.matchAll(pattern)].map((match) => match[1]);
  if (values.length === 0) {
    throw new Error(`Missing ${name} metric in TypeScript diagnostics.`);
  }
  if (values.length > 1) {
    throw new Error(`Duplicate ${name} metric in TypeScript diagnostics.`);
  }
  return values[0];
}

function malformedMetric(name, value) {
  throw new Error(`Malformed ${name} metric: ${JSON.stringify(value)}.`);
}

function parseInstantiations(value) {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) {
    malformedMetric("Instantiations", value);
  }
  const parsed = Number(value.replaceAll(",", ""));
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    malformedMetric("Instantiations", value);
  }
  return parsed;
}

function parseMemoryKiB(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(B|K|KB|KIB|M|MB|MIB|G|GB|GIB)$/i.exec(
    value,
  );
  if (!match) malformedMetric("Memory used", value);
  const amount = Number(match[1]);
  const unit = match[2].toUpperCase();
  const bytesPerUnit =
    unit === "B"
      ? 1
      : unit === "K" || unit === "KB" || unit === "KIB"
        ? unit === "KIB"
          ? 1024
          : 1000
        : unit === "M" || unit === "MB" || unit === "MIB"
          ? unit === "MIB"
            ? 1024 * 1024
            : 1000 * 1000
          : unit === "GIB"
            ? 1024 * 1024 * 1024
            : 1000 * 1000 * 1000;
  // TypeScript 6 reports bare K as Math.round(bytes / 1000). Preserve that
  // decimal meaning, then round upward into one canonical integer KiB value.
  const memoryKiB = Math.ceil((amount * bytesPerUnit) / 1024);
  if (!Number.isSafeInteger(memoryKiB) || memoryKiB < 0) {
    malformedMetric("Memory used", value);
  }
  return memoryKiB;
}

function parseCheckTimeSeconds(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s)$/i.exec(value);
  if (!match) malformedMetric("Check time", value);
  const amount = Number(match[1]);
  const seconds = match[2].toLowerCase() === "ms" ? amount / 1000 : amount;
  if (!Number.isFinite(seconds) || seconds < 0) {
    malformedMetric("Check time", value);
  }
  return seconds;
}

export function parseExtendedDiagnostics(output) {
  if (typeof output !== "string") {
    throw new TypeError("TypeScript diagnostics must be a string.");
  }
  return {
    checkTimeSeconds: parseCheckTimeSeconds(
      readSingleMetric(output, "Check time"),
    ),
    instantiations: parseInstantiations(
      readSingleMetric(output, "Instantiations"),
    ),
    memoryKiB: parseMemoryKiB(readSingleMetric(output, "Memory used")),
  };
}

function validateBudget(label, budget) {
  if (
    !budget ||
    !Number.isSafeInteger(budget.maxInstantiations) ||
    budget.maxInstantiations <= 0 ||
    !Number.isSafeInteger(budget.maxMemoryKiB) ||
    budget.maxMemoryKiB <= 0
  ) {
    throw new Error(
      `${label} budget metrics maxInstantiations and maxMemoryKiB must be positive integers.`,
    );
  }
}

function normalizeRepoRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} fixture config must be a repo-relative path.`);
  }
  const slashPath = value.replaceAll("\\", "/");
  if (path.posix.isAbsolute(slashPath) || /^[A-Za-z]:\//.test(slashPath)) {
    throw new Error(`${label} fixture config must be a repo-relative path.`);
  }
  const normalized = path.posix.normalize(slashPath);
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} fixture config must stay inside the repository.`);
  }
  return normalized;
}

export function validateFixtureMapping(fixtures) {
  if (!Array.isArray(fixtures)) {
    throw new Error("Type performance fixture mapping must be an array.");
  }
  const normalized = fixtures.map((fixture, index) => {
    if (!fixture || typeof fixture.label !== "string") {
      throw new Error(
        `Type performance fixture mapping entry ${index} is malformed.`,
      );
    }
    return {
      label: fixture.label,
      tsconfig: normalizeRepoRelativePath(fixture.tsconfig, fixture.label),
    };
  });
  const labelCounts = new Map();
  const targetCounts = new Map();
  for (const fixture of normalized) {
    labelCounts.set(fixture.label, (labelCounts.get(fixture.label) ?? 0) + 1);
    targetCounts.set(
      fixture.tsconfig,
      (targetCounts.get(fixture.tsconfig) ?? 0) + 1,
    );
  }
  const duplicateLabel = [...labelCounts].find(([, count]) => count > 1)?.[0];
  if (duplicateLabel) {
    throw new Error(
      `Type performance fixture mapping has duplicate label ${duplicateLabel}.`,
    );
  }
  const duplicateTarget = [...targetCounts].find(([, count]) => count > 1)?.[0];
  if (duplicateTarget) {
    throw new Error(
      `Type performance fixture mapping has duplicate fixture config target ${duplicateTarget}.`,
    );
  }
  const expectedLabels = new Set(expectedFixtures.map(({ label }) => label));
  const actualLabels = new Set(normalized.map(({ label }) => label));
  const missing = [...expectedLabels].filter(
    (label) => !actualLabels.has(label),
  );
  if (missing.length > 0) {
    throw new Error(
      `Type performance fixture mapping is missing ${missing.join(", ")}.`,
    );
  }
  const unexpected = [...actualLabels].filter(
    (label) => !expectedLabels.has(label),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Type performance fixture mapping has unexpected ${unexpected.join(", ")}.`,
    );
  }
  const byLabel = new Map(
    normalized.map((fixture) => [fixture.label, fixture.tsconfig]),
  );
  for (const expected of expectedFixtures) {
    const actualTarget = byLabel.get(expected.label);
    if (actualTarget !== expected.tsconfig) {
      throw new Error(
        `${expected.label} fixture must map to ${expected.tsconfig}; received ${actualTarget}.`,
      );
    }
  }
  return expectedFixtures.map((fixture) => ({ ...fixture }));
}

export function validateTypePerformanceBudgets(budgets) {
  if (!budgets || typeof budgets !== "object" || Array.isArray(budgets)) {
    throw new Error("Type performance budgets must be an object.");
  }
  const expectedLabels = expectedFixtures.map(({ label }) => label);
  const actualLabels = Object.keys(budgets);
  const missing = expectedLabels.filter((label) => !(label in budgets));
  if (missing.length > 0) {
    throw new Error(
      `Type performance budgets are missing ${missing.join(", ")}.`,
    );
  }
  const unexpected = actualLabels.filter(
    (label) => !expectedLabels.includes(label),
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Type performance budgets have unexpected ${unexpected.join(", ")}.`,
    );
  }
  for (const label of expectedLabels) {
    const budget = budgets[label];
    validateBudget(label, budget);
    if (Object.hasOwn(budget, "tsconfig")) {
      throw new Error(
        `${label} budget must not define tsconfig; fixture paths are immutable.`,
      );
    }
    const unexpectedFields = Object.keys(budget).filter(
      (field) =>
        field !== "maxInstantiations" &&
        field !== "maxMemoryKiB" &&
        field !== "calibration",
    );
    if (unexpectedFields.length > 0) {
      throw new Error(
        `${label} budget has unexpected fields ${unexpectedFields.join(", ")}.`,
      );
    }
  }
  return budgets;
}

export function resolveTypePerformanceConfiguration() {
  const fixtures = validateFixtureMapping(expectedFixtures).map(
    ({ label, tsconfig }) => ({
      configPath: path.join(workspaceDirectory, ...tsconfig.split("/")),
      label,
    }),
  );
  return {
    budgetsPath: defaultBudgetsPath,
    fixtures,
    workspaceDirectory,
  };
}

function formatInteger(value) {
  return value.toLocaleString("en-US");
}

export function checkTypePerformanceBudget({ budget, diagnostics, label }) {
  if (typeof label !== "string" || label.length === 0) {
    throw new Error(
      "Type performance fixture label must be a non-empty string.",
    );
  }
  validateBudget(label, budget);
  const metrics = parseExtendedDiagnostics(diagnostics);
  const failures = [];
  if (metrics.instantiations > budget.maxInstantiations) {
    failures.push(
      `Instantiations ${formatInteger(metrics.instantiations)} exceed budget ${formatInteger(budget.maxInstantiations)}`,
    );
  }
  if (metrics.memoryKiB > budget.maxMemoryKiB) {
    failures.push(
      `Memory used ${formatInteger(metrics.memoryKiB)} KiB exceeds budget ${formatInteger(budget.maxMemoryKiB)} KiB`,
    );
  }
  if (failures.length > 0) {
    throw new Error(
      `${label}: ${failures.join("; ")}. Check time ${metrics.checkTimeSeconds.toFixed(2)}s is informational only.`,
    );
  }
  return {
    ...metrics,
    label,
    summary: `${label}: ${formatInteger(metrics.instantiations)} instantiations, ${formatInteger(metrics.memoryKiB)} KiB memory, ${metrics.checkTimeSeconds.toFixed(2)}s check time (informational)`,
  };
}

async function runTypeScript(configPath) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "pnpm",
      [
        "exec",
        "tsc",
        "-p",
        configPath,
        "--noEmit",
        "--extendedDiagnostics",
        "--pretty",
        "false",
      ],
      {
        cwd: workspaceDirectory,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return `${stdout}${stderr}`;
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
    throw new Error(
      `TypeScript performance fixture failed for ${configPath}.\n${output}`,
      { cause: error },
    );
  }
}

export async function runTypePerformanceChecks({ budgetsPath } = {}) {
  const configuration = resolveTypePerformanceConfiguration();
  const selectedBudgetsPath = budgetsPath ?? configuration.budgetsPath;
  const parsed = JSON.parse(await readFile(selectedBudgetsPath, "utf8"));
  if (!parsed || typeof parsed.fixtures !== "object" || !parsed.fixtures) {
    throw new Error("Type performance budgets must define a fixtures object.");
  }
  const budgets = validateTypePerformanceBudgets(parsed.fixtures);
  const results = [];
  for (const { configPath, label } of configuration.fixtures) {
    const budget = budgets[label];
    const diagnostics = await runTypeScript(configPath);
    const result = checkTypePerformanceBudget({ budget, diagnostics, label });
    console.log(result.summary);
    results.push(result);
  }
  return results;
}

async function main() {
  await runTypePerformanceChecks();
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
