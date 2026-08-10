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
  const multiplier =
    unit === "B"
      ? 1 / 1024
      : unit === "K" || unit === "KB" || unit === "KIB"
        ? 1
        : unit === "M" || unit === "MB" || unit === "MIB"
          ? 1024
          : 1024 * 1024;
  const memoryKiB = Math.ceil(amount * multiplier);
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

export async function runTypePerformanceChecks({
  budgetsPath = defaultBudgetsPath,
} = {}) {
  const parsed = JSON.parse(await readFile(budgetsPath, "utf8"));
  if (!parsed || typeof parsed.fixtures !== "object" || !parsed.fixtures) {
    throw new Error("Type performance budgets must define a fixtures object.");
  }
  const entries = Object.entries(parsed.fixtures);
  if (entries.length === 0) {
    throw new Error(
      "Type performance budgets must define at least one fixture.",
    );
  }
  const results = [];
  for (const [label, budget] of entries) {
    if (typeof budget.tsconfig !== "string" || budget.tsconfig.length === 0) {
      throw new Error(`${label} budget must define a tsconfig path.`);
    }
    const diagnostics = await runTypeScript(budget.tsconfig);
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
