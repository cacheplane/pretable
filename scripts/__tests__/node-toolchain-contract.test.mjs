import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  LineCounter,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
} from "yaml";

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

function parseWorkflow(lines) {
  const lineCounter = new LineCounter();
  const document = parseDocument(lines.join("\n"), { lineCounter });
  return { document, lineCounter };
}

function resolvedNode(node, document) {
  return isAlias(node) ? node.resolve(document) : node;
}

function scalarNodeValue(node, document) {
  const resolved = resolvedNode(node, document);
  return isScalar(resolved) ? resolved.value : undefined;
}

function displayedNodeValue(node, document) {
  const resolved = resolvedNode(node, document);
  if (isScalar(resolved)) {
    return resolved.value == null ? "" : String(resolved.value);
  }
  const value = resolved?.toJSON?.();
  return value == null ? "" : JSON.stringify(value);
}

function nodeLine(node, lineCounter) {
  return lineCounter.linePos(node?.range?.[0] ?? 0).line;
}

function directPair(map, key, document) {
  return map.items.find((pair) => scalarNodeValue(pair.key, document) === key);
}

function visitCollections(node, document, visitor, seen = new Set()) {
  const resolved = resolvedNode(node, document);
  if (!resolved || seen.has(resolved)) {
    return;
  }
  seen.add(resolved);

  if (isMap(resolved)) {
    visitor(resolved);
    for (const pair of resolved.items) {
      visitCollections(pair.key, document, visitor, seen);
      visitCollections(pair.value, document, visitor, seen);
    }
  } else if (isSeq(resolved)) {
    visitor(resolved);
    for (const item of resolved.items) {
      visitCollections(item, document, visitor, seen);
    }
  }
}

function parsedNodeVersionEntries(parsed) {
  const entries = [];
  visitCollections(parsed.document.contents, parsed.document, (collection) => {
    if (!isMap(collection)) {
      return;
    }
    for (const pair of collection.items) {
      if (scalarNodeValue(pair.key, parsed.document) === "node-version") {
        entries.push({
          line: nodeLine(pair.key, parsed.lineCounter),
          pair,
          value: displayedNodeValue(pair.value, parsed.document),
        });
      }
    }
  });
  return entries;
}

function unresolvedAliases(parsed) {
  const aliases = [];
  visit(parsed.document, {
    Alias(_key, alias) {
      if (!alias.resolve(parsed.document)) {
        aliases.push({
          line: nodeLine(alias, parsed.lineCounter),
          source: alias.source,
        });
      }
    },
  });
  return aliases;
}

function isSetupNodeAction(value) {
  return (
    typeof value === "string" && /^actions\/setup-node@[^\s]+$/.test(value)
  );
}

function parsedStepSequences(parsed) {
  const root = resolvedNode(parsed.document.contents, parsed.document);
  if (!isMap(root)) {
    return [];
  }

  const jobs = resolvedNode(
    directPair(root, "jobs", parsed.document)?.value,
    parsed.document,
  );
  if (isMap(jobs)) {
    return jobs.items.flatMap((jobPair) => {
      const job = resolvedNode(jobPair.value, parsed.document);
      if (!isMap(job)) {
        return [];
      }
      const steps = resolvedNode(
        directPair(job, "steps", parsed.document)?.value,
        parsed.document,
      );
      return isSeq(steps) ? [steps] : [];
    });
  }

  // Focused unit fixtures use a top-level steps collection. Real workflows
  // are scoped through jobs.<job>.steps above.
  const fixtureSteps = resolvedNode(
    directPair(root, "steps", parsed.document)?.value,
    parsed.document,
  );
  return isSeq(fixtureSteps) ? [fixtureSteps] : [];
}

function executableStepMaps(sequence, document, seen = new Set()) {
  const resolved = resolvedNode(sequence, document);
  if (!isSeq(resolved) || seen.has(resolved)) {
    return [];
  }
  seen.add(resolved);

  const steps = resolved.items.flatMap((item) => {
    const step = resolvedNode(item, document);
    if (!isMap(step)) {
      return [];
    }

    const parallel = resolvedNode(
      directPair(step, "parallel", document)?.value,
      document,
    );
    return [
      step,
      ...(isSeq(parallel) ? executableStepMaps(parallel, document, seen) : []),
    ];
  });
  seen.delete(resolved);
  return steps;
}

function parsedSetupNodeSteps(parsed) {
  const steps = [];
  for (const collection of parsedStepSequences(parsed)) {
    for (const step of executableStepMaps(collection, parsed.document)) {
      const uses = directPair(step, "uses", parsed.document);
      if (
        !uses ||
        !isSetupNodeAction(scalarNodeValue(uses.value, parsed.document))
      ) {
        continue;
      }

      const withPair = directPair(step, "with", parsed.document);
      const withMap = resolvedNode(withPair?.value, parsed.document);
      const nodeVersionPair = isMap(withMap)
        ? directPair(withMap, "node-version", parsed.document)
        : undefined;

      steps.push({
        hasWith: Boolean(withPair),
        line: nodeLine(uses.key, parsed.lineCounter),
        nodeVersion: nodeVersionPair
          ? {
              line: nodeLine(nodeVersionPair.key, parsed.lineCounter),
              pair: nodeVersionPair,
              value: displayedNodeValue(nodeVersionPair.value, parsed.document),
            }
          : undefined,
      });
    }
  }
  return steps;
}

function assertValidWorkflow(parsed) {
  assert.equal(
    parsed.document.errors.length,
    0,
    parsed.document.errors.map((error) => error.message).join("\n"),
  );
  const aliases = unresolvedAliases(parsed);
  assert.equal(
    aliases.length,
    0,
    aliases
      .map(({ line, source }) => `${line}: unresolved YAML alias *${source}`)
      .join("\n"),
  );
}

function nodeVersionEntries(lines) {
  const parsed = parseWorkflow(lines);
  assertValidWorkflow(parsed);
  return parsedNodeVersionEntries(parsed).map(({ line, value }) => ({
    line,
    value,
  }));
}

function setupNodeSteps(lines) {
  const parsed = parseWorkflow(lines);
  assertValidWorkflow(parsed);
  return parsedSetupNodeSteps(parsed).map(({ line, nodeVersion }) => ({
    line,
    nodeVersion: nodeVersion
      ? { line: nodeVersion.line, value: nodeVersion.value }
      : undefined,
  }));
}

function analyzeWorkflow(lines, workflow) {
  const parsed = parseWorkflow(lines);
  if (parsed.document.errors.length > 0) {
    return {
      failures: parsed.document.errors.map((error) => {
        const line = error.linePos?.[0]?.line ?? 1;
        return workflow + ":" + line + " invalid YAML (" + error.code + ")";
      }),
      steps: [],
    };
  }

  const aliases = unresolvedAliases(parsed);
  if (aliases.length > 0) {
    return {
      failures: aliases.map(
        ({ line, source }) =>
          `${workflow}:${line} unresolved YAML alias *${source}`,
      ),
      steps: [],
    };
  }

  const steps = parsedSetupNodeSteps(parsed);
  const ownedNodeVersions = new Set(
    steps.flatMap(({ nodeVersion }) => (nodeVersion ? [nodeVersion.pair] : [])),
  );
  const failures = parsedNodeVersionEntries(parsed).flatMap(
    ({ line, pair, value }) => {
      if (ownedNodeVersions.has(pair) || value === expectedNodeVersion) {
        return [];
      }
      return [
        workflow +
          ":" +
          line +
          " node-version must be " +
          expectedNodeVersion +
          ", found " +
          (value || "empty"),
      ];
    },
  );

  for (const step of steps) {
    if (!step.hasWith) {
      failures.push(
        workflow + ":" + step.line + " actions/setup-node requires with:",
      );
    } else if (!step.nodeVersion) {
      failures.push(
        workflow +
          ":" +
          step.line +
          " actions/setup-node with: requires node-version: " +
          expectedNodeVersion,
      );
    } else if (step.nodeVersion.value !== expectedNodeVersion) {
      failures.push(
        workflow +
          ":" +
          step.nodeVersion.line +
          " actions/setup-node node-version must be " +
          expectedNodeVersion +
          ", found " +
          (step.nodeVersion.value || "empty"),
      );
    }
  }

  return { failures, steps };
}

function workflowFailures(lines, workflow) {
  return analyzeWorkflow(lines, workflow).failures;
}

function hasCurrentToolchainGuidance(content) {
  return (
    /Node\.js\s+24\.19\.0\b/i.test(content) && /pnpm\s+10\+/i.test(content)
  );
}

function toolchainGuidanceFailures(content, name) {
  const failures = [];
  if (!hasCurrentToolchainGuidance(content)) {
    failures.push(
      name + " must describe Node.js 24.19.0 and pnpm 10+ guidance",
    );
  }
  if (/Node\.js\s+22\+/i.test(content)) {
    failures.push(name + " must not retain legacy Node.js 22+ guidance");
  }
  if (/Node\.js\s+24\+/i.test(content)) {
    failures.push(name + " must not retain legacy Node.js 24+ guidance");
  }
  return failures;
}

test("discovers node-version keys in mapping and sequence entries", () => {
  assert.deepEqual(
    nodeVersionEntries([
      "root:",
      "  node-version: 24.19.0",
      "sequence:",
      "  - node-version: 22",
      "  - node-version: '24'",
      "quoted:",
      '  "node-version": 23',
      "quoted-sequence:",
      "  - 'node-version': 21",
      "matrix: { node-version: 20, os: ubuntu-latest }",
      "flow-sequence:",
      "  - { os: windows-latest, 'node-version': '19' }",
      'message: "ignore { node-version: 18 } inside a scalar"',
      "# - node-version: 22",
    ]),
    [
      { line: 2, value: "24.19.0" },
      { line: 4, value: "22" },
      { line: 5, value: "24" },
      { line: 7, value: "23" },
      { line: 9, value: "21" },
      { line: 10, value: "20" },
      { line: 12, value: "19" },
    ],
  );
});

test("accepts a setup-node pin in a flow-style with mapping", () => {
  assert.deepEqual(
    setupNodeSteps([
      "steps:",
      "  - uses: actions/setup-node@v10",
      '    "with": { "node-version": "24.19.0", cache: pnpm }',
    ]).map(({ line, nodeVersion }) => ({ line, nodeVersion })),
    [{ line: 2, nodeVersion: { line: 3, value: "24.19.0" } }],
  );
});

test("discovers and validates compact flow-style setup-node steps", () => {
  assert.deepEqual(
    workflowFailures(
      ["steps:", "  - { uses: actions/setup-node@v10 }"],
      "missing-with.yml",
    ),
    ["missing-with.yml:2 actions/setup-node requires with:"],
  );
  assert.deepEqual(
    workflowFailures(
      ["steps:", "  - { uses: actions/setup-node@v10, with: { cache: pnpm } }"],
      "missing-version.yml",
    ),
    [
      "missing-version.yml:2 actions/setup-node with: requires node-version: 24.19.0",
    ],
  );
  assert.deepEqual(
    workflowFailures(
      [
        "steps:",
        "  - { uses: actions/setup-node@v10, with: { node-version: 22 } }",
      ],
      "wrong-version.yml",
    ),
    [
      "wrong-version.yml:2 actions/setup-node node-version must be 24.19.0, found 22",
    ],
  );
  assert.deepEqual(
    workflowFailures(
      [
        "steps:",
        '  - { "uses": "actions/setup-node@v10", "with": { "node-version": "24.19.0" } }',
      ],
      "pinned.yml",
    ),
    [],
  );
});

test("reports a stray flow pin beside an exact setup-node pin", () => {
  assert.deepEqual(
    workflowFailures(
      [
        "steps:",
        "  - { uses: actions/setup-node@v10, with: { node-version: 24.19.0 }, env: { node-version: 22 } }",
      ],
      "same-line.yml",
    ),
    ["same-line.yml:2 node-version must be 24.19.0, found 22"],
  );
});

test("uses YAML comment and escape semantics for node-version keys", () => {
  assert.deepEqual(
    workflowFailures(["node-version: 24.19.0#wrong"], "plain-scalar.yml"),
    ["plain-scalar.yml:1 node-version must be 24.19.0, found 24.19.0#wrong"],
  );
  assert.deepEqual(
    workflowFailures(['"node-\\u0076ersion": 22'], "escaped-key.yml"),
    ["escaped-key.yml:1 node-version must be 24.19.0, found 22"],
  );
  assert.deepEqual(
    workflowFailures(['node-version: "24.19.\\u0030"'], "escaped-value.yml"),
    [],
  );
  assert.deepEqual(
    workflowFailures(
      [
        'metadata: "literal \\"# still scalar" # actual comment',
        "node-version: 24.19.0",
      ],
      "escaped-quote.yml",
    ),
    [],
  );
});

test("discovers block and multiline-flow setup-node steps", () => {
  assert.deepEqual(
    workflowFailures(
      ["steps:", "  -", "    uses: actions/setup-node@v10"],
      "block-sequence.yml",
    ),
    ["block-sequence.yml:3 actions/setup-node requires with:"],
  );
  assert.deepEqual(
    workflowFailures(
      [
        "steps:",
        "  - {",
        '      uses: "actions/setup-node@v10",',
        "      with: { node-version: 24.19.0 }",
        "    }",
      ],
      "multiline-flow.yml",
    ),
    [],
  );
});

test("fails closed when a workflow is not valid YAML", () => {
  const failures = workflowFailures(["steps: ["], "invalid.yml");
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^invalid\.yml:\d+ invalid YAML \([A-Z_]+\)$/);
});

test("does not classify matrix include data as executable steps", () => {
  assert.deepEqual(
    workflowFailures(
      [
        "jobs:",
        "  test:",
        "    strategy:",
        "      matrix:",
        "        include:",
        "          - uses: actions/setup-node@v10",
        "            label: setup-action-reference",
        "    steps:",
        '      - run: echo "${{ matrix.uses }}"',
      ],
      "matrix.yml",
    ),
    [],
  );
});

test("discovers setup-node steps nested in parallel step groups", () => {
  assert.deepEqual(
    workflowFailures(
      [
        "jobs:",
        "  test:",
        "    steps:",
        "      - parallel:",
        "          - uses: actions/setup-node@v10",
        "          - parallel:",
        "              - uses: actions/setup-node@v10",
        "                with:",
        "                  node-version: 24.19.0",
      ],
      "parallel.yml",
    ),
    ["parallel.yml:5 actions/setup-node requires with:"],
  );
});

test("counts each use of an aliased parallel step group", () => {
  const analysis = analyzeWorkflow(
    [
      "groups: &node-steps",
      "  - uses: actions/setup-node@v10",
      "    with:",
      "      node-version: 24.19.0",
      "jobs:",
      "  test:",
      "    steps:",
      "      - parallel: *node-steps",
      "      - parallel: *node-steps",
    ],
    "reused-parallel.yml",
  );

  assert.deepEqual(analysis.failures, []);
  assert.equal(analysis.steps.length, 2);
});

test("fails closed when a workflow contains an unresolved alias", () => {
  assert.deepEqual(analyzeWorkflow(["jobs: *missing"], "missing-jobs.yml"), {
    failures: ["missing-jobs.yml:1 unresolved YAML alias *missing"],
    steps: [],
  });
  assert.deepEqual(
    analyzeWorkflow(
      ["jobs:", "  test:", "    steps: *missing"],
      "missing-steps.yml",
    ),
    {
      failures: ["missing-steps.yml:3 unresolved YAML alias *missing"],
      steps: [],
    },
  );
});

test("repository analysis keeps contextual invalid-YAML diagnostics", () => {
  assert.deepEqual(analyzeWorkflow(["steps: ["], "invalid.yml"), {
    failures: ["invalid.yml:1 invalid YAML (BAD_INDENT)"],
    steps: [],
  });
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

test("accepts independently ordered pinned Node and pnpm guidance", () => {
  assert.ok(
    hasCurrentToolchainGuidance(
      "Use pnpm 10+ with a pinned\nNode.js 24.19.0 runtime.",
    ),
  );
});

test("rejects stale Node 22 guidance alongside the current toolchain", () => {
  assert.deepEqual(
    toolchainGuidanceFailures(
      "Use Node.js 24.19.0 with pnpm 10+. Older paths still support Node.js 22+.",
      "fixture.md",
    ),
    ["fixture.md must not retain legacy Node.js 22+ guidance"],
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
    const analysis = analyzeWorkflow(lines, workflow);
    setupNodeStepsFound.push(...analysis.steps);
    failures.push(...analysis.failures);
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
    const failures = toolchainGuidanceFailures(content, name);
    assert.equal(failures.length, 0, failures.join("\n"));
  }
});
