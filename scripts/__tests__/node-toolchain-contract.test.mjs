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

function blockScalarKeyIndentation(source) {
  const compactSequenceProperty = source.match(
    /^(\s*-\s+)[\w-]+\s*:\s*[|>][0-9+-]*\s*$/,
  );
  return compactSequenceProperty
    ? compactSequenceProperty[1].length
    : indentation(source);
}

function activeYamlLines(lines) {
  const activeLines = [];
  let blockScalarBoundary;

  for (let index = 0; index < lines.length; index += 1) {
    const source = uncomment(lines[index]);
    const lineIndentation = indentation(source);
    if (blockScalarBoundary !== undefined) {
      if (!source.trim() || lineIndentation > blockScalarBoundary) {
        continue;
      }
      blockScalarBoundary = undefined;
    }
    if (!source.trim()) {
      continue;
    }

    activeLines.push({
      indentation: lineIndentation,
      line: index + 1,
      source,
    });
    if (/:\s*[|>][0-9+-]*\s*$/.test(source)) {
      blockScalarBoundary = blockScalarKeyIndentation(source);
    }
  }

  return activeLines;
}

function property(source) {
  const match = source.match(/^([\w-]+)\s*:\s*(.*?)\s*$/);
  return match ? { key: match[1], value: match[2] } : undefined;
}

function nodeVersionEntries(lines) {
  return activeYamlLines(lines).flatMap(({ line, source }) => {
    const sequenceEntry = source.match(/^\s*-\s*(.*?)\s*$/);
    const entry = property(sequenceEntry?.[1] ?? source.trimStart());
    return entry?.key === "node-version"
      ? [{ line, value: scalarValue(entry.value) }]
      : [];
  });
}

function isSetupNodeAction(value) {
  return /^(?:"actions\/setup-node@[^\s"]+"|'actions\/setup-node@[^\s']+'|actions\/setup-node@[^\s'"]+)$/.test(
    value,
  );
}

function setupNodeSteps(lines) {
  const activeLines = activeYamlLines(lines);
  const steps = [];

  for (let index = 0; index < activeLines.length; index += 1) {
    const sequenceItem = activeLines[index].source.match(/^\s*-\s+(.*?)\s*$/);
    if (!sequenceItem) {
      continue;
    }

    const stepIndentation = activeLines[index].indentation;
    const stepProperties = [];
    const firstProperty = property(sequenceItem[1]);
    if (firstProperty) {
      stepProperties.push({
        ...firstProperty,
        indentation: stepIndentation + 2,
        index,
        line: activeLines[index].line,
      });
    }

    for (let offset = index + 1; offset < activeLines.length; offset += 1) {
      const candidate = activeLines[offset];
      if (
        /^\s*-\s+/.test(candidate.source) &&
        candidate.indentation <= stepIndentation
      ) {
        break;
      }
      if (candidate.indentation <= stepIndentation) {
        break;
      }
      if (candidate.indentation === stepIndentation + 2) {
        const directProperty = property(candidate.source.trimStart());
        if (directProperty) {
          stepProperties.push({
            ...directProperty,
            indentation: candidate.indentation,
            index: offset,
            line: candidate.line,
          });
        }
      }
    }

    const uses = stepProperties.find(
      ({ key, value }) => key === "uses" && isSetupNodeAction(value),
    );
    if (!uses) {
      continue;
    }
    const withProperty = stepProperties.find(({ key }) => key === "with");
    let nodeVersion;
    if (withProperty) {
      for (
        let offset = withProperty.index + 1;
        offset < activeLines.length;
        offset += 1
      ) {
        const candidate = activeLines[offset];
        if (candidate.indentation <= withProperty.indentation) {
          break;
        }
        const directProperty = property(candidate.source.trimStart());
        if (
          candidate.indentation === withProperty.indentation + 2 &&
          directProperty?.key === "node-version"
        ) {
          nodeVersion = {
            line: candidate.line,
            value: scalarValue(directProperty.value),
          };
        }
      }
    }

    steps.push({
      line: uses.line,
      nodeVersion,
      withIndentation: withProperty?.indentation,
    });
  }

  return steps;
}

function workflowFailures(lines, workflow) {
  const steps = setupNodeSteps(lines);
  const ownedNodeVersionLines = new Set(
    steps.flatMap(({ nodeVersion }) => (nodeVersion ? [nodeVersion.line] : [])),
  );
  const failures = nodeVersionEntries(lines).flatMap(({ line, value }) => {
    if (ownedNodeVersionLines.has(line) || value === expectedNodeVersion) {
      return [];
    }
    return [
      `${workflow}:${line} node-version must be ${expectedNodeVersion}, found ${value || "empty"}`,
    ];
  });

  for (const step of steps) {
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

  return failures;
}

function hasCurrentToolchainGuidance(content) {
  return /Node\.js\s+24\+/i.test(content) && /pnpm\s+10\+/i.test(content);
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

test("scans the complete direct mapping for each setup-node step", () => {
  const steps = setupNodeSteps([
    "steps:",
    "  - name: Configure before selecting Node",
    "    with:",
    "      node-version: 24.19.0",
    '    uses: "actions/setup-node@v7"',
    "  - uses: actions/setup-node@v10",
    "    env:",
    "      with:",
    "        node-version: 24.19.0",
    "  - name: Configure after selecting Node",
    "    uses: 'actions/setup-node@v12'",
    "    with:",
    "      node-version: 24.19.0",
  ]);

  assert.deepEqual(
    steps.map(({ line, nodeVersion }) => ({ line, nodeVersion })),
    [
      { line: 5, nodeVersion: { line: 4, value: "24.19.0" } },
      { line: 6, nodeVersion: undefined },
      { line: 11, nodeVersion: { line: 13, value: "24.19.0" } },
    ],
  );
});

test("does not let comments end a setup-node step", () => {
  assert.deepEqual(
    setupNodeSteps([
      "steps:",
      "  - uses: actions/setup-node@v7",
      "  # This comment belongs to the step above.",
      "    with:",
      "      node-version: 24.19.0",
    ]).map(({ line, nodeVersion }) => ({ line, nodeVersion })),
    [{ line: 2, nodeVersion: { line: 5, value: "24.19.0" } }],
  );
});

test("preserves setup-node siblings after compact sequence block scalars", () => {
  assert.deepEqual(
    setupNodeSteps([
      "steps:",
      "  - name: |",
      "      scalar content",
      "    uses: actions/setup-node@v7",
      "    with:",
      "      node-version: 24.19.0",
      "  - name: >-",
      "      scalar content",
      '    uses: "actions/setup-node@v10"',
      "    with:",
      "      node-version: 24.19.0",
      "  - name: |2-",
      "      scalar content",
      "    uses: 'actions/setup-node@v12'",
      "    with:",
      "      node-version: 24.19.0",
    ]).map(({ line, nodeVersion }) => ({ line, nodeVersion })),
    [
      { line: 4, nodeVersion: { line: 6, value: "24.19.0" } },
      { line: 9, nodeVersion: { line: 11, value: "24.19.0" } },
      { line: 14, nodeVersion: { line: 16, value: "24.19.0" } },
    ],
  );
});

test("ignores node-version-like content inside YAML block scalars", () => {
  assert.deepEqual(
    nodeVersionEntries([
      "run: |",
      "  node-version: 22",
      "command: >-",
      "  - node-version: 22",
      "script: |2-",
      "  node-version: 22",
      "node-version: 24.19.0",
      "# node-version: 22",
    ]),
    [{ line: 7, value: "24.19.0" }],
  );
});

test("reports a wrong setup-node pin once at its node-version line", () => {
  assert.deepEqual(
    workflowFailures(
      [
        "steps:",
        "  - uses: actions/setup-node@v7",
        "    with:",
        "      node-version: 22",
      ],
      "fixture.yml",
    ),
    ["fixture.yml:4 actions/setup-node node-version must be 24.19.0, found 22"],
  );
});

test("accepts independently ordered current Node and pnpm guidance", () => {
  assert.ok(
    hasCurrentToolchainGuidance(
      "Use pnpm 10+ with a current\nNode.js 24+ runtime.",
    ),
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
    setupNodeStepsFound.push(...setupNodeSteps(lines));
    failures.push(...workflowFailures(lines, workflow));
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
      hasCurrentToolchainGuidance(content),
      `${name} must describe Node.js 24+ and pnpm 10+ guidance`,
    );
    assert.ok(
      !/Node\.js 22\+/i.test(content),
      `${name} must not retain active Node.js 22+ guidance`,
    );
  }
});
