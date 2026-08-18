import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const expectedNodeVersion = "24.19.0";

async function readText(path) {
  return readFile(path, "utf8");
}

async function workflowPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return workflowPaths(path);
      }
      return /\.ya?ml$/i.test(entry.name) ? [path] : [];
    }),
  );

  return paths.flat().sort();
}

function uncomment(line) {
  let quote;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if ((character === '"' || character === "'") && !quote) {
      quote = character;
    } else if (character === quote) {
      quote = undefined;
    } else if (character === "#" && !quote) {
      return line.slice(0, index);
    }
  }
  return line;
}

function indentation(line) {
  return line.length - line.trimStart().length;
}

function scalarValue(value) {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(?:"([^\"]*)"|'([^']*)')$/);
  return quoted ? (quoted[1] ?? quoted[2]) : trimmed;
}

function nodeVersionEntries(lines) {
  return lines.flatMap((line, index) => {
    const match = uncomment(line).match(
      /^\s*(?:-\s*)?node-version\s*:\s*(.*?)\s*$/,
    );
    return match ? [{ line: index + 1, value: scalarValue(match[1]) }] : [];
  });
}

function setupNodeSteps(lines) {
  return lines.flatMap((line, index) => {
    const source = uncomment(line);
    const directStep = source.match(/^\s*-\s*uses\s*:\s*(.*?)\s*$/);
    const nestedStep = source.match(/^\s*uses\s*:\s*(.*?)\s*$/);
    const action = directStep ?? nestedStep;
    if (
      !action ||
      !/^(?:"actions\/setup-node@[^\s"]+"|'actions\/setup-node@[^\s']+'|actions\/setup-node@[^\s'"]+)$/.test(
        action[1],
      )
    ) {
      return [];
    }
    const isDirectStep = directStep !== null;
    let stepIndentation = indentation(source);
    if (!isDirectStep) {
      for (let previous = index - 1; previous >= 0; previous -= 1) {
        const candidate = uncomment(lines[previous]);
        if (/^\s*-\s+/.test(candidate)) {
          stepIndentation = indentation(candidate);
          break;
        }
      }
    }
    let withIndentation;
    let nodeVersion;

    for (let offset = index + 1; offset < lines.length; offset += 1) {
      const candidate = uncomment(lines[offset]);
      if (!candidate.trim()) {
        continue;
      }

      const candidateIndentation = indentation(candidate);
      if (candidateIndentation <= stepIndentation) {
        break;
      }
      if (withIndentation === undefined && /^\s*with\s*:\s*$/.test(candidate)) {
        withIndentation = candidateIndentation;
        continue;
      }
      if (withIndentation !== undefined) {
        if (candidateIndentation <= withIndentation) {
          break;
        }
        const version = candidate.match(/^\s*node-version\s*:\s*(.*?)\s*$/);
        if (version) {
          nodeVersion = {
            line: offset + 1,
            value: scalarValue(version[1]),
          };
        }
      }
    }

    return [{ line: index + 1, nodeVersion, withIndentation }];
  });
}

test("discovers node-version keys in mapping and sequence entries", () => {
  assert.deepEqual(
    nodeVersionEntries([
      "node-version: 24.19.0",
      "- node-version: 22",
      "  - node-version: '24'",
      "# - node-version: 22",
    ]),
    [
      { line: 1, value: "24.19.0" },
      { line: 2, value: "22" },
      { line: 3, value: "24" },
    ],
  );
});

test("discovers quoted and unquoted setup-node steps while ignoring comments", () => {
  const steps = setupNodeSteps([
    "steps:",
    "  - uses: actions/setup-node@v10",
    "    with:",
    "      node-version: 24.19.0",
    '  - uses: "actions/setup-node@v7"',
    "    with:",
    "      node-version: 24.19.0",
    "  - uses: 'actions/setup-node@v12'",
    "    with:",
    "      node-version: 24.19.0",
    "  # - uses: actions/setup-node@v8",
    "  #   with:",
    "  #     node-version: 22",
  ]);

  assert.equal(steps.length, 3);
  assert.deepEqual(
    steps.map(({ line, nodeVersion }) => ({ line, nodeVersion })),
    [
      { line: 2, nodeVersion: { line: 4, value: "24.19.0" } },
      { line: 5, nodeVersion: { line: 7, value: "24.19.0" } },
      { line: 8, nodeVersion: { line: 10, value: "24.19.0" } },
    ],
  );
});

test("pins the package manager and supported Node range", async () => {
  const packageJson = JSON.parse(
    await readText(resolve(repoRoot, "package.json")),
  );

  assert.equal(packageJson.engines?.node, "^24.15.0");
  assert.equal(packageJson.packageManager, "pnpm@10.12.1");
});

test("pins the local Node version", async () => {
  const nodeVersionPath = resolve(repoRoot, ".node-version");
  let nodeVersion;
  try {
    nodeVersion = await readText(nodeVersionPath);
  } catch (error) {
    assert.fail(
      `Expected ${nodeVersionPath} to pin Node ${expectedNodeVersion}, but it could not be read: ${error.message}`,
    );
  }

  assert.equal(nodeVersion.trim(), expectedNodeVersion);
});

test("pins every active workflow Node version", async () => {
  const workflowsDirectory = resolve(repoRoot, ".github/workflows");
  const paths = await workflowPaths(workflowsDirectory);
  assert.ok(paths.length > 0, `Expected workflows under ${workflowsDirectory}`);

  const setupNodeStepsFound = [];
  const failures = [];
  for (const path of paths) {
    const workflow = relative(repoRoot, path);
    const lines = (await readText(path)).split(/\r?\n/);
    const versions = nodeVersionEntries(lines);
    for (const version of versions) {
      if (version.value !== expectedNodeVersion) {
        failures.push(
          `${workflow}:${version.line} node-version must be ${expectedNodeVersion}, found ${version.value || "empty"}`,
        );
      }
    }

    for (const step of setupNodeSteps(lines)) {
      setupNodeStepsFound.push({ ...step, workflow });
      if (step.withIndentation === undefined) {
        failures.push(
          `${workflow}:${step.line} actions/setup-node requires with:`,
        );
      } else if (!step.nodeVersion) {
        failures.push(
          `${workflow}:${step.line} actions/setup-node with: requires node-version: ${expectedNodeVersion}`,
        );
      } else if (step.nodeVersion.value !== expectedNodeVersion) {
        failures.push(
          `${workflow}:${step.nodeVersion.line} actions/setup-node node-version must be ${expectedNodeVersion}, found ${step.nodeVersion.value || "empty"}`,
        );
      }
    }
  }

  assert.ok(
    setupNodeStepsFound.length > 0,
    "Expected at least one actions/setup-node step",
  );
  assert.equal(failures.length, 0, failures.join("\n"));
});

test("documents the current Node and pnpm requirements", async () => {
  for (const name of ["README.md", "CONTRIBUTING.md"]) {
    const content = await readText(resolve(repoRoot, name));
    assert.ok(
      /Node\.js 24\+.*pnpm 10\+/i.test(content),
      `${name} must describe Node.js 24+ and pnpm 10+ guidance`,
    );
    assert.ok(
      !/Node\.js 22\+/i.test(content),
      `${name} must not retain active Node.js 22+ guidance`,
    );
  }
});
