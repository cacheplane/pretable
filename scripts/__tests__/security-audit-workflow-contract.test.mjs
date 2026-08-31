import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
} from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const ciWorkflow = ".github/workflows/ci.yml";
const releaseWorkflow = ".github/workflows/release.yml";
const expectedNodeVersion = "24.19.0";
const checkoutAction =
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const pnpmSetupAction =
  "pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86";
const setupNodeAction =
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const changesetsAction =
  "changesets/action@8488615a623b1b9c987934bb89eae8af6a946ac1";
const checkoutActionSource = `${checkoutAction} # v7`;
const pnpmSetupActionSource = `${pnpmSetupAction} # v6`;
const setupNodeActionSource = `${setupNodeAction} # v7`;
const expectedNpmrc =
  "auto-install-peers=true\nstrict-peer-dependencies=false\n";
const expectedWorkspace = "packages:\n  - apps/*\n  - packages/*\n";
const expectedFrozenInstall =
  "pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile";
const expectedSecurityAuditCommand = "pnpm security:audit";
const expectedSecurityAuditImplementation = "pnpm audit --audit-level low";
const expectedPublicPackageBuild =
  "pnpm -r --filter '@pretable/core...' --filter '@pretable/react...' --filter '@pretable/stream-adapter...' --filter '@pretable/ui...' build";
const expectedPackedCompatibilityCommands = [
  "pnpm consumer:check",
  "pnpm react:compat",
];
const expectedDeployConditions = {
  "deploy-prod":
    "github.ref == 'refs/heads/main' && github.event_name == 'push'",
  "deploy-preview":
    "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.login != 'dependabot[bot]'",
};
const expectedCiJobIds = [
  "test",
  "typecheck",
  "typecheck-public",
  "lint",
  "format",
  "examples-registry",
  "build",
  "dev-smoke",
  "bench-e2e",
  "packaging",
  "publish-preflight",
  "security-audit",
  "api-report",
  "deploy-prod",
  "deploy-prod-alarm",
  "deploy-preview",
  "smoke-preview",
];
const expectedDeployNeeds = [
  "test",
  "typecheck",
  "typecheck-public",
  "lint",
  "format",
  "build",
  "packaging",
  "publish-preflight",
  "api-report",
  "examples-registry",
  "security-audit",
];

function nodeLine(node, lineCounter) {
  return lineCounter.linePos(node?.range?.[0] ?? 0).line;
}

function scalarString(node) {
  return isScalar(node) && typeof node.value === "string"
    ? node.value
    : undefined;
}

function directPair(map, key) {
  return map.items.find((pair) => scalarString(pair.key) === key);
}

function setupNodeInputErrorPattern(input) {
  switch (input) {
    case "node-version":
      return /jobs\.release\.steps\[2\]\.with\.node-version/;
    case "cache":
      return /jobs\.release\.steps\[2\]\.with\.cache/;
    case "registry-url":
      return /jobs\.release\.steps\[2\]\.with\.registry-url/;
    default:
      throw new Error(`Unexpected setup-node input: ${input}`);
  }
}

function parseWorkflow(source, workflow) {
  const lineCounter = new LineCounter();
  const document = parseDocument(source, { lineCounter });
  const failures = document.errors.map((error) => {
    const line = error.linePos?.[0]?.line ?? 1;
    return `${workflow}:${line} invalid YAML (${error.code})`;
  });

  visit(document, {
    Alias(_key, alias) {
      failures.push(
        `${workflow}:${nodeLine(alias, lineCounter)} YAML aliases are not supported in security gate structure (*${alias.source})`,
      );
    },
  });

  return { document, failures, lineCounter, workflow };
}

function context(parsed, node, path) {
  return `${parsed.workflow}:${nodeLine(node, parsed.lineCounter)} ${path}`;
}

function requireMap(parsed, node, path) {
  if (isMap(node)) {
    return node;
  }
  parsed.failures.push(`${context(parsed, node, path)} must be a mapping`);
  return undefined;
}

function requireSequence(parsed, node, path) {
  if (isSeq(node)) {
    return node;
  }
  parsed.failures.push(`${context(parsed, node, path)} must be a sequence`);
  return undefined;
}

function requireString(parsed, node, path) {
  const value = scalarString(node);
  if (value !== undefined) {
    return value;
  }
  parsed.failures.push(`${context(parsed, node, path)} must be a string`);
  return undefined;
}

function requiredPair(parsed, map, key, path) {
  const pair = directPair(map, key);
  if (!pair) {
    parsed.failures.push(`${context(parsed, map, path)}.${key} is missing`);
  }
  return pair;
}

function requiredMap(parsed, map, key, path) {
  const pair = requiredPair(parsed, map, key, path);
  return pair ? requireMap(parsed, pair.value, `${path}.${key}`) : undefined;
}

function requiredSequence(parsed, map, key, path) {
  const pair = requiredPair(parsed, map, key, path);
  return pair
    ? requireSequence(parsed, pair.value, `${path}.${key}`)
    : undefined;
}

function mapKeys(parsed, map, path) {
  return map.items.flatMap((pair) => {
    const key = requireString(parsed, pair.key, `${path} key`);
    return key === undefined ? [] : [{ key, pair }];
  });
}

function assertExactKeys(parsed, map, expected, path) {
  const entries = mapKeys(parsed, map, path);
  const actual = new Set(entries.map(({ key }) => key));
  for (const key of expected) {
    if (!actual.has(key)) {
      parsed.failures.push(
        `${context(parsed, map, `${path}.${key}`)} is missing`,
      );
    }
  }
  const allowed = new Set(expected);
  for (const { key, pair } of entries) {
    if (!allowed.has(key)) {
      parsed.failures.push(
        `${context(parsed, pair.key, `${path}.${key}`)} is not allowed; allowed keys are ${expected.join(", ")}`,
      );
    }
  }
}

function assertAbsent(parsed, map, key, path) {
  const pair = directPair(map, key);
  if (pair) {
    parsed.failures.push(
      `${context(parsed, pair.key, `${path}.${key}`)} must be absent`,
    );
  }
}

function assertExactString(parsed, map, key, expected, path) {
  const pair = requiredPair(parsed, map, key, path);
  if (!pair) {
    return;
  }
  const actual = requireString(parsed, pair.value, `${path}.${key}`);
  if (actual !== undefined && actual !== expected) {
    parsed.failures.push(
      `${context(parsed, pair.value, `${path}.${key}`)} must be ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
    );
  }
}

function assertExactInteger(parsed, map, key, expected, path) {
  const pair = requiredPair(parsed, map, key, path);
  if (!pair) {
    return;
  }
  const value = isScalar(pair.value) ? pair.value.value : undefined;
  if (!Number.isInteger(value) || value !== expected) {
    parsed.failures.push(
      `${context(parsed, pair.value, `${path}.${key}`)} must be the integer ${expected}, found ${JSON.stringify(value)}`,
    );
  }
}

function assertExactScalar(parsed, map, key, expected, path) {
  const pair = requiredPair(parsed, map, key, path);
  if (!pair) {
    return;
  }
  const value = isScalar(pair.value) ? pair.value.value : undefined;
  if (value !== expected) {
    parsed.failures.push(
      `${context(parsed, pair.value, `${path}.${key}`)} must be ${JSON.stringify(expected)}, found ${JSON.stringify(value)}`,
    );
  }
}

function analyzeCiTriggers(parsed, root) {
  const triggers = requiredMap(parsed, root, "on", "workflow");
  if (!triggers) {
    return;
  }
  assertExactKeys(parsed, triggers, ["pull_request", "push"], "workflow.on");
  for (const event of ["pull_request", "push"]) {
    const trigger = requiredMap(parsed, triggers, event, "workflow.on");
    if (!trigger) {
      continue;
    }
    assertExactKeys(parsed, trigger, ["branches"], `workflow.on.${event}`);
    const branches = requiredSequence(
      parsed,
      trigger,
      "branches",
      `workflow.on.${event}`,
    );
    if (!branches) {
      continue;
    }
    const values = branches.items.flatMap((item, index) => {
      const value = requireString(
        parsed,
        item,
        `workflow.on.${event}.branches[${index}]`,
      );
      return value === undefined ? [] : [value];
    });
    if (values.length !== 1 || values[0] !== "main") {
      parsed.failures.push(
        `${context(parsed, branches, `workflow.on.${event}.branches`)} must be exactly [main]`,
      );
    }
  }
}

function analyzeCiRootSemantics(parsed, root) {
  assertExactString(parsed, root, "name", "CI", "workflow");
  analyzeCiTriggers(parsed, root);

  const concurrency = requiredMap(parsed, root, "concurrency", "workflow");
  if (concurrency) {
    assertExactKeys(
      parsed,
      concurrency,
      ["group", "cancel-in-progress"],
      "workflow.concurrency",
    );
    assertExactString(
      parsed,
      concurrency,
      "group",
      "ci-${{ github.ref }}",
      "workflow.concurrency",
    );
    assertExactString(
      parsed,
      concurrency,
      "cancel-in-progress",
      "${{ github.event_name == 'pull_request' }}",
      "workflow.concurrency",
    );
  }

  const permissions = requiredMap(parsed, root, "permissions", "workflow");
  if (permissions) {
    assertExactKeys(parsed, permissions, ["contents"], "workflow.permissions");
    assertExactString(
      parsed,
      permissions,
      "contents",
      "read",
      "workflow.permissions",
    );
  }
}

function analyzeReleaseRootSemantics(parsed, root) {
  assertExactString(parsed, root, "name", "Release", "workflow");
  const triggers = requiredMap(parsed, root, "on", "workflow");
  if (triggers) {
    assertExactKeys(
      parsed,
      triggers,
      ["push", "workflow_dispatch"],
      "workflow.on",
    );
    const push = requiredMap(parsed, triggers, "push", "workflow.on");
    if (push) {
      assertExactKeys(parsed, push, ["branches"], "workflow.on.push");
      const branches = requiredSequence(
        parsed,
        push,
        "branches",
        "workflow.on.push",
      );
      if (branches) {
        const values = branches.items.flatMap((item, index) => {
          const value = requireString(
            parsed,
            item,
            `workflow.on.push.branches[${index}]`,
          );
          return value === undefined ? [] : [value];
        });
        if (values.length !== 1 || values[0] !== "main") {
          parsed.failures.push(
            `${context(parsed, branches, "workflow.on.push.branches")} must be exactly [main]`,
          );
        }
      }
    }
    const dispatchPair = requiredPair(
      parsed,
      triggers,
      "workflow_dispatch",
      "workflow.on",
    );
    if (
      dispatchPair &&
      (!isScalar(dispatchPair.value) || dispatchPair.value.value !== null)
    ) {
      parsed.failures.push(
        `${context(parsed, dispatchPair.value, "workflow.on.workflow_dispatch")} must be the empty trigger`,
      );
    }
  }
  assertExactString(
    parsed,
    root,
    "concurrency",
    "${{ github.workflow }}-${{ github.ref }}",
    "workflow",
  );
}

function stepMaps(parsed, job, path) {
  const steps = requiredSequence(parsed, job, "steps", path);
  if (!steps) {
    return [];
  }
  return steps.items.flatMap((item, index) => {
    const step = requireMap(parsed, item, `${path}.steps[${index}]`);
    return step ? [step] : [];
  });
}

function analyzeReleaseBootstrapSteps(parsed, steps) {
  if (steps.length < 5) {
    parsed.failures.push(
      `${context(parsed, steps[0] ?? parsed.document.contents, "jobs.release.steps")} must contain the five checkout/setup/install/audit bootstrap steps`,
    );
    return;
  }

  const checkout = steps[0];
  assertExactKeys(parsed, checkout, ["uses", "with"], "jobs.release.steps[0]");
  assertExactString(
    parsed,
    checkout,
    "uses",
    checkoutAction,
    "jobs.release.steps[0]",
  );
  const checkoutInputs = requiredMap(
    parsed,
    checkout,
    "with",
    "jobs.release.steps[0]",
  );
  if (checkoutInputs) {
    assertExactKeys(
      parsed,
      checkoutInputs,
      ["fetch-depth"],
      "jobs.release.steps[0].with",
    );
    assertExactInteger(
      parsed,
      checkoutInputs,
      "fetch-depth",
      0,
      "jobs.release.steps[0].with",
    );
  }

  const pnpmSetup = steps[1];
  assertExactKeys(parsed, pnpmSetup, ["uses"], "jobs.release.steps[1]");
  assertExactString(
    parsed,
    pnpmSetup,
    "uses",
    pnpmSetupAction,
    "jobs.release.steps[1]",
  );

  const nodeSetup = steps[2];
  assertExactKeys(parsed, nodeSetup, ["uses", "with"], "jobs.release.steps[2]");
  assertExactString(
    parsed,
    nodeSetup,
    "uses",
    setupNodeAction,
    "jobs.release.steps[2]",
  );
  const nodeInputs = requiredMap(
    parsed,
    nodeSetup,
    "with",
    "jobs.release.steps[2]",
  );
  if (nodeInputs) {
    assertExactKeys(
      parsed,
      nodeInputs,
      ["node-version", "cache", "registry-url"],
      "jobs.release.steps[2].with",
    );
    for (const [input, expected] of [
      ["node-version", expectedNodeVersion],
      ["cache", "pnpm"],
      ["registry-url", "https://registry.npmjs.org"],
    ]) {
      assertExactString(
        parsed,
        nodeInputs,
        input,
        expected,
        "jobs.release.steps[2].with",
      );
    }
  }

  for (const [index, expected] of [
    [3, expectedFrozenInstall],
    [4, expectedSecurityAuditCommand],
  ]) {
    const step = steps[index];
    assertExactKeys(parsed, step, ["run"], `jobs.release.steps[${index}]`);
    assertExactString(
      parsed,
      step,
      "run",
      expected,
      `jobs.release.steps[${index}]`,
    );
  }
}

function assertUnsuppressed(parsed, map, path) {
  assertAbsent(parsed, map, "if", path);
  assertAbsent(parsed, map, "continue-on-error", path);
}

function analyzeDeployNeeds(parsed, jobs, jobId) {
  const jobPair = requiredPair(parsed, jobs, jobId, "jobs");
  const job = jobPair
    ? requireMap(parsed, jobPair.value, `jobs.${jobId}`)
    : undefined;
  if (!job) {
    return;
  }
  assertExactString(
    parsed,
    job,
    "if",
    expectedDeployConditions[jobId],
    `jobs.${jobId}`,
  );
  const needs = requiredSequence(parsed, job, "needs", `jobs.${jobId}`);
  if (!needs) {
    return;
  }
  const values = needs.items.flatMap((item, index) => {
    const value = requireString(parsed, item, `jobs.${jobId}.needs[${index}]`);
    return value === undefined ? [] : [value];
  });
  const missing = expectedDeployNeeds.filter((need) => !values.includes(need));
  const unexpected = values.filter(
    (need) => !expectedDeployNeeds.includes(need),
  );
  const duplicates = values.filter(
    (need, index) => values.indexOf(need) !== index,
  );
  if (missing.length > 0) {
    parsed.failures.push(
      `${context(parsed, needs, `jobs.${jobId}.needs`)} is missing ${missing.join(", ")}`,
    );
  }
  if (unexpected.length > 0) {
    parsed.failures.push(
      `${context(parsed, needs, `jobs.${jobId}.needs`)} has unexpected dependencies ${unexpected.join(", ")}`,
    );
  }
  if (duplicates.length > 0) {
    parsed.failures.push(
      `${context(parsed, needs, `jobs.${jobId}.needs`)} has duplicate dependencies ${[...new Set(duplicates)].join(", ")}`,
    );
  }
  for (const deliberatelyExcluded of ["dev-smoke", "bench-e2e"]) {
    if (values.includes(deliberatelyExcluded)) {
      parsed.failures.push(
        `${context(parsed, needs, `jobs.${jobId}.needs`)} must keep ${deliberatelyExcluded} excluded`,
      );
    }
  }
}

function analyzeDependencyGraph(parsed, jobs) {
  const graph = new Map();
  for (const { key: jobId, pair } of mapKeys(parsed, jobs, "jobs")) {
    const job = requireMap(parsed, pair.value, `jobs.${jobId}`);
    if (!job) {
      continue;
    }
    const needsPair = directPair(job, "needs");
    if (!needsPair) {
      graph.set(jobId, []);
      continue;
    }
    const scalar = scalarString(needsPair.value);
    if (scalar !== undefined) {
      graph.set(jobId, [scalar]);
      continue;
    }
    const sequence = requireSequence(
      parsed,
      needsPair.value,
      `jobs.${jobId}.needs`,
    );
    const dependencies = sequence
      ? sequence.items.flatMap((item, index) => {
          const dependency = requireString(
            parsed,
            item,
            `jobs.${jobId}.needs[${index}]`,
          );
          return dependency === undefined ? [] : [dependency];
        })
      : [];
    graph.set(jobId, dependencies);
  }

  for (const [jobId, dependencies] of graph) {
    for (const dependency of dependencies) {
      if (!graph.has(dependency)) {
        parsed.failures.push(
          `${context(parsed, jobs, `jobs.${jobId}.needs`)} references missing job ${dependency}`,
        );
      }
    }
  }

  const state = new Map();
  const stack = [];
  let cycleReported = false;
  function visitJob(jobId) {
    if (cycleReported || state.get(jobId) === "done") {
      return;
    }
    if (state.get(jobId) === "visiting") {
      const start = stack.indexOf(jobId);
      const cycle = [...stack.slice(start), jobId];
      parsed.failures.push(
        `${context(parsed, jobs, "jobs")} dependency cycle: ${cycle.join(" -> ")}`,
      );
      cycleReported = true;
      return;
    }
    state.set(jobId, "visiting");
    stack.push(jobId);
    for (const dependency of graph.get(jobId) ?? []) {
      if (graph.has(dependency)) {
        visitJob(dependency);
      }
    }
    stack.pop();
    state.set(jobId, "done");
  }
  for (const jobId of graph.keys()) {
    visitJob(jobId);
  }
}

function analyzeCi(source, workflow = ciWorkflow) {
  const parsed = parseWorkflow(source, workflow);
  if (parsed.failures.length > 0) {
    return parsed.failures;
  }
  const root = requireMap(parsed, parsed.document.contents, "workflow");
  if (root) {
    assertExactKeys(
      parsed,
      root,
      ["name", "on", "concurrency", "permissions", "jobs"],
      "workflow",
    );
    analyzeCiRootSemantics(parsed, root);
  }
  const jobs = root ? requiredMap(parsed, root, "jobs", "workflow") : undefined;
  if (!jobs) {
    return parsed.failures;
  }
  assertExactKeys(parsed, jobs, expectedCiJobIds, "workflow.jobs");

  const securityPairs = jobs.items.filter(
    (pair) => scalarString(pair.key) === "security-audit",
  );
  if (securityPairs.length !== 1) {
    parsed.failures.push(
      `${context(parsed, jobs, "jobs.security-audit")} must have exactly one job, found ${securityPairs.length}`,
    );
  }

  const securityJob = securityPairs[0]
    ? requireMap(parsed, securityPairs[0].value, "jobs.security-audit")
    : undefined;
  if (securityJob) {
    assertExactKeys(
      parsed,
      securityJob,
      ["name", "runs-on", "timeout-minutes", "steps"],
      "jobs.security-audit",
    );
    assertExactString(
      parsed,
      securityJob,
      "name",
      "security-audit",
      "jobs.security-audit",
    );
    assertExactString(
      parsed,
      securityJob,
      "runs-on",
      "ubuntu-latest",
      "jobs.security-audit",
    );
    assertExactInteger(
      parsed,
      securityJob,
      "timeout-minutes",
      10,
      "jobs.security-audit",
    );

    const steps = stepMaps(parsed, securityJob, "jobs.security-audit");
    if (steps.length !== 5) {
      parsed.failures.push(
        `${context(parsed, securityJob, "jobs.security-audit.steps")} must contain exactly five setup/install/audit steps, found ${steps.length}`,
      );
    }
    const expectedUses = [checkoutAction, pnpmSetupAction];
    for (const [index, uses] of expectedUses.entries()) {
      if (steps[index]) {
        assertExactKeys(
          parsed,
          steps[index],
          ["uses"],
          `jobs.security-audit.steps[${index}]`,
        );
        assertExactString(
          parsed,
          steps[index],
          "uses",
          uses,
          `jobs.security-audit.steps[${index}]`,
        );
        assertAbsent(
          parsed,
          steps[index],
          "run",
          `jobs.security-audit.steps[${index}]`,
        );
      }
    }
    if (steps[2]) {
      assertExactKeys(
        parsed,
        steps[2],
        ["uses", "with"],
        "jobs.security-audit.steps[2]",
      );
      assertExactString(
        parsed,
        steps[2],
        "uses",
        setupNodeAction,
        "jobs.security-audit.steps[2]",
      );
      assertAbsent(parsed, steps[2], "run", "jobs.security-audit.steps[2]");
      const withMap = requiredMap(
        parsed,
        steps[2],
        "with",
        "jobs.security-audit.steps[2]",
      );
      if (withMap) {
        assertExactKeys(
          parsed,
          withMap,
          ["node-version", "cache"],
          "jobs.security-audit.steps[2].with",
        );
        assertExactString(
          parsed,
          withMap,
          "node-version",
          expectedNodeVersion,
          "jobs.security-audit.steps[2].with",
        );
        assertExactString(
          parsed,
          withMap,
          "cache",
          "pnpm",
          "jobs.security-audit.steps[2].with",
        );
      }
    }
    if (steps[3]) {
      assertExactKeys(
        parsed,
        steps[3],
        ["run"],
        "jobs.security-audit.steps[3]",
      );
      assertExactString(
        parsed,
        steps[3],
        "run",
        expectedFrozenInstall,
        "jobs.security-audit.steps[3]",
      );
      assertAbsent(parsed, steps[3], "uses", "jobs.security-audit.steps[3]");
    }
    if (steps[4]) {
      assertExactKeys(
        parsed,
        steps[4],
        ["run"],
        "jobs.security-audit.steps[4]",
      );
      assertExactString(
        parsed,
        steps[4],
        "run",
        expectedSecurityAuditCommand,
        "jobs.security-audit.steps[4]",
      );
      assertAbsent(parsed, steps[4], "uses", "jobs.security-audit.steps[4]");
    }
    for (const [index, step] of steps.entries()) {
      assertUnsuppressed(parsed, step, `jobs.security-audit.steps[${index}]`);
    }
    const auditRuns = steps.filter(
      (step) =>
        scalarString(directPair(step, "run")?.value) ===
        expectedSecurityAuditCommand,
    );
    if (auditRuns.length !== 1) {
      parsed.failures.push(
        `${context(parsed, securityJob, "jobs.security-audit.steps")} must run exactly one permanent security audit command, found ${auditRuns.length}`,
      );
    }
  }

  const packagingPair = requiredPair(parsed, jobs, "packaging", "jobs");
  const packagingJob = packagingPair
    ? requireMap(parsed, packagingPair.value, "jobs.packaging")
    : undefined;
  if (packagingJob) {
    assertExactString(
      parsed,
      packagingJob,
      "name",
      "Packaging — publint + attw",
      "jobs.packaging",
    );
    const packagingSteps = stepMaps(parsed, packagingJob, "jobs.packaging");
    const runIndexes = (command) =>
      packagingSteps.flatMap((step, index) =>
        scalarString(directPair(step, "run")?.value) === command ? [index] : [],
      );
    const buildIndexes = runIndexes(expectedPublicPackageBuild);
    if (buildIndexes.length !== 1) {
      parsed.failures.push(
        `${context(parsed, packagingJob, "jobs.packaging.steps")} must freshly build public packages exactly once, found ${buildIndexes.length}`,
      );
    }
    for (const command of expectedPackedCompatibilityCommands) {
      const indexes = runIndexes(command);
      if (indexes.length !== 1) {
        parsed.failures.push(
          `${context(parsed, packagingJob, "jobs.packaging.steps")} must run ${command} exactly once, found ${indexes.length}`,
        );
        continue;
      }
      if (buildIndexes.length === 1 && indexes[0] <= buildIndexes[0]) {
        parsed.failures.push(
          `${context(parsed, packagingSteps[indexes[0]], "jobs.packaging.steps")} must run ${command} after the fresh public-package build`,
        );
      }
      assertExactKeys(
        parsed,
        packagingSteps[indexes[0]],
        ["run"],
        `jobs.packaging.steps[${indexes[0]}]`,
      );
      assertUnsuppressed(
        parsed,
        packagingSteps[indexes[0]],
        `jobs.packaging.steps[${indexes[0]}]`,
      );
    }
  }

  analyzeDeployNeeds(parsed, jobs, "deploy-prod");
  analyzeDeployNeeds(parsed, jobs, "deploy-preview");
  analyzeDependencyGraph(parsed, jobs);
  return parsed.failures;
}

function analyzeRelease(source, workflow = releaseWorkflow) {
  const parsed = parseWorkflow(source, workflow);
  if (parsed.failures.length > 0) {
    return parsed.failures;
  }
  const root = requireMap(parsed, parsed.document.contents, "workflow");
  if (root) {
    assertExactKeys(
      parsed,
      root,
      ["name", "on", "concurrency", "permissions", "jobs"],
      "workflow",
    );
    analyzeReleaseRootSemantics(parsed, root);
    const permissions = requiredMap(parsed, root, "permissions", "workflow");
    if (permissions) {
      assertExactKeys(
        parsed,
        permissions,
        ["contents"],
        "workflow.permissions",
      );
      assertExactString(
        parsed,
        permissions,
        "contents",
        "read",
        "workflow.permissions",
      );
    }
  }
  const jobs = root ? requiredMap(parsed, root, "jobs", "workflow") : undefined;
  if (jobs) {
    assertExactKeys(parsed, jobs, ["release"], "workflow.jobs");
  }
  const releasePair = jobs
    ? requiredPair(parsed, jobs, "release", "jobs")
    : undefined;
  const releaseJob = releasePair
    ? requireMap(parsed, releasePair.value, "jobs.release")
    : undefined;
  if (!releaseJob) {
    return parsed.failures;
  }
  assertExactKeys(
    parsed,
    releaseJob,
    ["name", "runs-on", "timeout-minutes", "permissions", "env", "steps"],
    "jobs.release",
  );
  assertExactString(
    parsed,
    releaseJob,
    "name",
    "Release — version PR or publish",
    "jobs.release",
  );
  assertExactString(
    parsed,
    releaseJob,
    "runs-on",
    "ubuntu-latest",
    "jobs.release",
  );
  assertExactInteger(parsed, releaseJob, "timeout-minutes", 20, "jobs.release");
  const permissions = requiredMap(
    parsed,
    releaseJob,
    "permissions",
    "jobs.release",
  );
  if (permissions) {
    assertExactKeys(
      parsed,
      permissions,
      ["contents", "id-token"],
      "jobs.release.permissions",
    );
    assertExactString(
      parsed,
      permissions,
      "contents",
      "read",
      "jobs.release.permissions",
    );
    assertExactString(
      parsed,
      permissions,
      "id-token",
      "write",
      "jobs.release.permissions",
    );
  }
  const env = requiredMap(parsed, releaseJob, "env", "jobs.release");
  if (env) {
    assertExactKeys(parsed, env, ["NPM_CONFIG_PROVENANCE"], "jobs.release.env");
    assertExactScalar(
      parsed,
      env,
      "NPM_CONFIG_PROVENANCE",
      true,
      "jobs.release.env",
    );
    assertAbsent(parsed, env, "RELEASE_GITHUB_TOKEN", "jobs.release.env");
  }
  const steps = stepMaps(parsed, releaseJob, "jobs.release");
  analyzeReleaseBootstrapSteps(parsed, steps);
  for (const [index, step] of steps.entries()) {
    const runPair = directPair(step, "run");
    if (runPair) {
      requireString(parsed, runPair.value, `jobs.release.steps[${index}].run`);
    }
  }
  const installIndexes = steps.flatMap((step, index) =>
    scalarString(directPair(step, "run")?.value) === expectedFrozenInstall
      ? [index]
      : [],
  );
  if (installIndexes.length !== 1) {
    parsed.failures.push(
      `${context(parsed, releaseJob, "jobs.release.steps")} must run exactly one frozen install, found ${installIndexes.length}`,
    );
  }
  const auditIndexes = steps.flatMap((step, index) =>
    scalarString(directPair(step, "run")?.value) ===
    expectedSecurityAuditCommand
      ? [index]
      : [],
  );
  if (auditIndexes.length !== 1) {
    parsed.failures.push(
      `${context(parsed, releaseJob, "jobs.release.steps")} must run exactly one permanent security audit command, found ${auditIndexes.length}`,
    );
  }
  if (
    installIndexes.length === 1 &&
    auditIndexes.length === 1 &&
    auditIndexes[0] !== installIndexes[0] + 1
  ) {
    parsed.failures.push(
      `${context(parsed, steps[auditIndexes[0]], "jobs.release security audit")} must be the first step after the exact frozen install`,
    );
  }
  if (auditIndexes.length === 1) {
    const allowedSetupActions = new Set([
      checkoutAction,
      pnpmSetupAction,
      setupNodeAction,
    ]);
    for (const [index, step] of steps.slice(0, auditIndexes[0]).entries()) {
      const runPair = directPair(step, "run");
      const run = runPair
        ? requireString(
            parsed,
            runPair.value,
            `jobs.release.steps[${index}].run`,
          )
        : undefined;
      if (run !== undefined && run !== expectedFrozenInstall) {
        parsed.failures.push(
          `${context(parsed, runPair.value, `jobs.release.steps[${index}].run`)} executes before the security audit`,
        );
      }
      const usesPair = directPair(step, "uses");
      const uses = usesPair
        ? requireString(
            parsed,
            usesPair.value,
            `jobs.release.steps[${index}].uses`,
          )
        : undefined;
      if (uses !== undefined && !allowedSetupActions.has(uses)) {
        parsed.failures.push(
          `${context(parsed, usesPair.value, `jobs.release.steps[${index}].uses`)} is not a setup action and must run after the security audit`,
        );
      }
    }
  }
  for (const auditIndex of auditIndexes) {
    assertExactKeys(
      parsed,
      steps[auditIndex],
      ["run"],
      `jobs.release.steps[${auditIndex}]`,
    );
    assertUnsuppressed(
      parsed,
      steps[auditIndex],
      `jobs.release.steps[${auditIndex}]`,
    );
  }
  const releaseRunIndexes = (command) =>
    steps.flatMap((step, index) =>
      scalarString(directPair(step, "run")?.value) === command ? [index] : [],
    );
  const buildIndexes = releaseRunIndexes("pnpm build");
  const publishIndexes = steps.flatMap((step, index) =>
    scalarString(directPair(step, "uses")?.value) === changesetsAction
      ? [index]
      : [],
  );
  if (publishIndexes.length !== 1) {
    parsed.failures.push(
      `${context(parsed, releaseJob, "jobs.release.steps")} must use the pinned changesets action exactly once, found ${publishIndexes.length}`,
    );
  } else {
    const publishIndex = publishIndexes[0];
    const publishStep = steps[publishIndex];
    const path = `jobs.release.steps[${publishIndex}]`;
    assertExactKeys(parsed, publishStep, ["name", "id", "uses", "with"], path);
    assertExactString(
      parsed,
      publishStep,
      "name",
      "Version PR or publish",
      path,
    );
    assertExactString(parsed, publishStep, "id", "changesets", path);
    assertExactString(parsed, publishStep, "uses", changesetsAction, path);
    const inputs = requiredMap(parsed, publishStep, "with", path);
    if (inputs) {
      assertExactKeys(
        parsed,
        inputs,
        [
          "version-script",
          "publish-script",
          "pr-title",
          "commit-message",
          "github-token",
        ],
        `${path}.with`,
      );
      const expectedInputs = {
        "version-script": "pnpm exec changeset version",
        "publish-script": "node ./scripts/publish-configured-packages.mjs",
        "pr-title": "chore: version packages",
        "commit-message": "chore: version packages",
        "github-token": "${{ secrets.RELEASE_GITHUB_TOKEN }}",
      };
      for (const [key, value] of Object.entries(expectedInputs)) {
        assertExactString(parsed, inputs, key, value, `${path}.with`);
      }
    }
  }
  const autoMergeIndexes = steps.flatMap((step, index) =>
    scalarString(directPair(step, "name")?.value) ===
    "Enable auto-merge on Version PR"
      ? [index]
      : [],
  );
  if (autoMergeIndexes.length !== 1) {
    parsed.failures.push(
      `${context(parsed, releaseJob, "jobs.release.steps")} must enable version-PR auto-merge exactly once, found ${autoMergeIndexes.length}`,
    );
  } else {
    const autoMergeIndex = autoMergeIndexes[0];
    assertExactString(
      parsed,
      steps[autoMergeIndex],
      "if",
      "steps.changesets.outputs.pr-number != ''",
      `jobs.release.steps[${autoMergeIndex}]`,
    );
    const autoMergeEnv = requiredMap(
      parsed,
      steps[autoMergeIndex],
      "env",
      `jobs.release.steps[${autoMergeIndex}]`,
    );
    if (autoMergeEnv) {
      assertExactKeys(
        parsed,
        autoMergeEnv,
        ["GH_TOKEN"],
        `jobs.release.steps[${autoMergeIndex}].env`,
      );
      assertExactString(
        parsed,
        autoMergeEnv,
        "GH_TOKEN",
        "${{ secrets.RELEASE_GITHUB_TOKEN }}",
        `jobs.release.steps[${autoMergeIndex}].env`,
      );
    }
  }
  for (const command of expectedPackedCompatibilityCommands) {
    const indexes = releaseRunIndexes(command);
    if (indexes.length !== 1) {
      parsed.failures.push(
        `${context(parsed, releaseJob, "jobs.release.steps")} must run ${command} exactly once, found ${indexes.length}`,
      );
      continue;
    }
    if (buildIndexes.length !== 1 || indexes[0] <= buildIndexes[0]) {
      parsed.failures.push(
        `${context(parsed, steps[indexes[0]], "jobs.release.steps")} must run ${command} after the release build`,
      );
    }
    if (publishIndexes.length !== 1 || indexes[0] >= publishIndexes[0]) {
      parsed.failures.push(
        `${context(parsed, steps[indexes[0]], "jobs.release.steps")} must run ${command} before version or publish`,
      );
    }
    assertExactKeys(
      parsed,
      steps[indexes[0]],
      ["run"],
      `jobs.release.steps[${indexes[0]}]`,
    );
    assertUnsuppressed(
      parsed,
      steps[indexes[0]],
      `jobs.release.steps[${indexes[0]}]`,
    );
  }
  return parsed.failures;
}

function analyzePackageScript(source) {
  let packageJson;
  try {
    packageJson = JSON.parse(source);
  } catch {
    return ["package.json is not valid JSON"];
  }
  if (
    packageJson === null ||
    Array.isArray(packageJson) ||
    typeof packageJson !== "object"
  ) {
    return ["package.json root must be an object"];
  }
  if (
    packageJson.scripts === null ||
    Array.isArray(packageJson.scripts) ||
    typeof packageJson.scripts !== "object"
  ) {
    return ["package.json scripts must be an object"];
  }
  const actual = packageJson.scripts["security:audit"];
  const failures =
    actual === expectedSecurityAuditImplementation
      ? []
      : [
          `package.json scripts.security:audit must be exactly ${JSON.stringify(expectedSecurityAuditImplementation)}, found ${JSON.stringify(actual)}`,
        ];
  for (const scriptName of Object.keys(packageJson.scripts)) {
    if (scriptName.startsWith("security:audit:")) {
      failures.push(
        `package.json legacy audit script ${scriptName} must be absent`,
      );
    }
  }
  if (Object.hasOwn(packageJson, "pnpm")) {
    failures.push("package.json own pnpm property must be absent");
  }
  for (const lifecycle of [
    "pnpm:devPreinstall",
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "preprepare",
    "prepare",
    "postprepare",
    "prepublishOnly",
    "prepack",
    "postpack",
    "publish",
    "postpublish",
  ]) {
    if (Object.hasOwn(packageJson.scripts, lifecycle)) {
      failures.push(`package.json scripts.${lifecycle} must be absent`);
    }
  }
  return failures;
}

function analyzeAuditTrustFiles(npmrc, pnpmfile, workspace) {
  const failures = [];
  if (npmrc !== expectedNpmrc) {
    failures.push(
      `.npmrc must exactly match the approved dependency audit trust configuration (${Buffer.byteLength(expectedNpmrc)} bytes)`,
    );
  }
  if (pnpmfile !== null) {
    failures.push(".pnpmfile.cjs must be absent");
  }

  if (workspace !== expectedWorkspace) {
    failures.push(
      `pnpm-workspace.yaml must match exact approved bytes (${Buffer.byteLength(expectedWorkspace)} bytes)`,
    );
  }
  return failures;
}

function analyzeWorkflowContexts(workflows) {
  if (!(workflows instanceof Map)) {
    return ["repository workflows must be a Map of active workflow sources"];
  }
  const failures = [];
  const contexts = [];
  for (const [workflow, source] of [...workflows].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const parsed = parseWorkflow(source, workflow);
    if (parsed.failures.length > 0) {
      failures.push(...parsed.failures);
      continue;
    }
    const root = requireMap(parsed, parsed.document.contents, "workflow");
    const jobs = root
      ? requiredMap(parsed, root, "jobs", "workflow")
      : undefined;
    if (!jobs) {
      failures.push(...parsed.failures);
      continue;
    }
    for (const { key: jobId, pair } of mapKeys(parsed, jobs, "jobs")) {
      const job = requireMap(parsed, pair.value, `jobs.${jobId}`);
      if (!job) {
        continue;
      }
      const namePair = directPair(job, "name");
      const effectiveName = namePair
        ? requireString(parsed, namePair.value, `jobs.${jobId}.name`)
        : jobId;
      if (effectiveName?.includes("${{")) {
        parsed.failures.push(
          `${context(parsed, namePair.value, `jobs.${jobId}.name`)} is expression-valued; active job display names must be literal so context uniqueness can be proven`,
        );
        continue;
      }
      if (effectiveName === "security-audit") {
        contexts.push(
          `${workflow}:${nodeLine(pair.key, parsed.lineCounter)} jobs.${jobId}`,
        );
      }
    }
    failures.push(...parsed.failures);
  }
  if (contexts.length !== 1) {
    failures.push(
      `security-audit display context must be unique across active workflows; found ${contexts.length}${contexts.length > 0 ? ` at ${contexts.join(", ")}` : ""}`,
    );
  }
  return failures;
}

function analyzeRepositoryInputs({
  ci,
  npmrc,
  packageJson,
  pnpmfile,
  release,
  workspace,
  workflows,
}) {
  const activeWorkflows =
    workflows instanceof Map ? new Map(workflows) : workflows;
  if (activeWorkflows instanceof Map) {
    activeWorkflows.set(ciWorkflow, ci);
    activeWorkflows.set(releaseWorkflow, release);
  }
  return [
    ...analyzeCi(ci),
    ...analyzeRelease(release),
    ...analyzePackageScript(packageJson),
    ...analyzeAuditTrustFiles(npmrc, pnpmfile, workspace),
    ...analyzeWorkflowContexts(activeWorkflows),
  ];
}

function replaceOnce(source, before, after) {
  const first = source.indexOf(before);
  assert.notEqual(first, -1, `fixture mutation could not find ${before}`);
  assert.equal(
    source.indexOf(before, first + before.length),
    -1,
    `fixture mutation found ${before} more than once`,
  );
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function replaceWithinJob(source, jobId, nextJobId, before, after) {
  const start = source.indexOf(`  ${jobId}:\n`);
  assert.notEqual(start, -1, `fixture mutation could not find job ${jobId}`);
  const end = source.indexOf(`\n  ${nextJobId}:`, start);
  assert.notEqual(
    end,
    -1,
    `fixture mutation could not find job after ${jobId}`,
  );
  const section = source.slice(start, end);
  const mutated = replaceOnce(section, before, after);
  return source.slice(0, start) + mutated + source.slice(end);
}

function setWorkflowValue(source, path, value) {
  const document = parseDocument(source);
  assert.deepEqual(document.errors, []);
  document.setIn(path, value);
  return document.toString();
}

function workflowValue(source, path) {
  const document = parseDocument(source);
  assert.deepEqual(document.errors, []);
  return document.getIn(path);
}

function sameRepositoryStat(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

async function readStableRepositoryFile(root, relativePath) {
  let handle;
  try {
    const candidate = resolve(root, relativePath);
    const pathBefore = await lstat(candidate, { bigint: true });
    if (
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      pathBefore.size < 0n ||
      pathBefore.size > 4n * 1024n * 1024n
    ) {
      throw new Error("invalid input");
    }
    const noFollow = constants.O_NOFOLLOW;
    handle = await open(
      candidate,
      constants.O_RDONLY | (typeof noFollow === "number" ? noFollow : 0),
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || !sameRepositoryStat(pathBefore, before)) {
      throw new Error("invalid input");
    }
    const buffer = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const pathAfter = await lstat(candidate, { bigint: true });
    if (
      buffer.length !== Number(before.size) ||
      pathAfter.isSymbolicLink() ||
      !sameRepositoryStat(before, after) ||
      !sameRepositoryStat(after, pathAfter)
    ) {
      throw new Error("invalid input");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error("expected a stable regular non-symlink repository input");
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function assertAbsentRepositoryPath(
  root,
  relativePath,
  { label = "pnpmfile", lstat: lstatPath = lstat } = {},
) {
  try {
    const parentBefore = await lstatPath(root, { bigint: true });
    if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink()) {
      throw new Error("invalid repository root");
    }
    try {
      await lstatPath(resolve(root, relativePath), { bigint: true });
      throw new Error("entry exists");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parentAfter = await lstatPath(root, { bigint: true });
    if (
      !parentAfter.isDirectory() ||
      parentAfter.isSymbolicLink() ||
      !sameRepositoryStat(parentBefore, parentAfter)
    ) {
      throw new Error("repository root changed");
    }
  } catch {
    throw new Error(`${label} must be absent as a stable directory entry`);
  }
}

async function readRepositoryInputs() {
  const workflowsDirectory = resolve(repoRoot, ".github/workflows");
  const workflowNames = (await readdir(workflowsDirectory))
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort();
  const workflows = new Map(
    await Promise.all(
      workflowNames.map(async (name) => {
        const path = `.github/workflows/${name}`;
        return [path, await readFile(resolve(repoRoot, path), "utf8")];
      }),
    ),
  );
  await assertAbsentRepositoryPath(repoRoot, ".pnpmfile.cjs");
  await assertAbsentRepositoryPath(
    repoRoot,
    "scripts/check-security-audit-transition.mjs",
    { label: "transition audit script" },
  );
  await assertAbsentRepositoryPath(
    repoRoot,
    "scripts/__tests__/check-security-audit-transition.test.mjs",
    { label: "transition audit test" },
  );
  return {
    ci: workflows.get(ciWorkflow),
    npmrc: await readStableRepositoryFile(repoRoot, ".npmrc"),
    packageJson: await readStableRepositoryFile(repoRoot, "package.json"),
    pnpmfile: null,
    release: workflows.get(releaseWorkflow),
    lockfile: await readStableRepositoryFile(repoRoot, "pnpm-lock.yaml"),
    workspace: await readStableRepositoryFile(repoRoot, "pnpm-workspace.yaml"),
    workflows,
  };
}

function assertRejected(failures, pattern, mutation) {
  assert.ok(
    failures.some((failure) => pattern.test(failure)),
    `${mutation}: expected ${pattern}, received ${JSON.stringify(failures)}`,
  );
}

test("workflow analyzers fail closed with contextual YAML diagnostics", () => {
  assert.match(
    analyzeCi("jobs: [", "broken-ci.yml")[0],
    /^broken-ci\.yml:1 invalid YAML/,
  );
  assert.deepEqual(analyzeRelease("jobs: *shared", "aliased-release.yml"), [
    "aliased-release.yml:1 YAML aliases are not supported in security gate structure (*shared)",
  ]);
  assert.ok(
    analyzeCi("jobs: wrong", "typed-ci.yml").some((failure) =>
      /^typed-ci\.yml:1 workflow\.jobs must be a mapping$/.test(failure),
    ),
  );
});

test("contracts every release bootstrap step and input exactly", async (t) => {
  const base = await readRepositoryInputs();
  const cases = [
    {
      name: "checkout repository override",
      before: "          fetch-depth: 0",
      after:
        "          fetch-depth: 0\n          repository: octocat/Hello-World",
      expected: /jobs\.release\.steps\[0\]\.with\.repository|allowed keys/,
    },
    {
      name: "checkout action drift",
      before: `      - uses: ${checkoutActionSource}`,
      after: "      - uses: actions/checkout@v6",
      expected: /jobs\.release\.steps\[0\]\.uses/,
    },
    {
      name: "checkout ref override",
      before: "          fetch-depth: 0",
      after: "          fetch-depth: 0\n          ref: refs/heads/shadow",
      expected: /jobs\.release\.steps\[0\]\.with\.ref|allowed keys/,
    },
    {
      name: "checkout skipped",
      before: `      - uses: ${checkoutActionSource}\n        with:`,
      after: `      - uses: ${checkoutActionSource}\n        if: \${{ github.ref == 'refs/heads/shadow' }}\n        with:`,
      expected: /jobs\.release\.steps\[0\]\.if|allowed keys/,
    },
    {
      name: "checkout fetch depth string",
      before: "          fetch-depth: 0",
      after: '          fetch-depth: "0"',
      expected: /jobs\.release\.steps\[0\]\.with\.fetch-depth/,
    },
    {
      name: "checkout fetch depth missing",
      before: "        with:\n          fetch-depth: 0",
      after: "        with: {}",
      expected: /jobs\.release\.steps\[0\]\.with\.fetch-depth/,
    },
    {
      name: "pnpm version override",
      before: `      - uses: ${pnpmSetupActionSource}`,
      after: `      - uses: ${pnpmSetupActionSource}\n        with:\n          version: 9`,
      expected: /jobs\.release\.steps\[1\]\.with|allowed keys/,
    },
    {
      name: "pnpm run-install override",
      before: `      - uses: ${pnpmSetupActionSource}`,
      after: `      - uses: ${pnpmSetupActionSource}\n        with:\n          run_install: true`,
      expected: /jobs\.release\.steps\[1\]\.with|allowed keys/,
    },
    {
      name: "pnpm setup action drift",
      before: `      - uses: ${pnpmSetupActionSource}`,
      after: "      - uses: pnpm/action-setup@v5",
      expected: /jobs\.release\.steps\[1\]\.uses/,
    },
    {
      name: "setup-node action drift",
      before: `      - uses: ${setupNodeActionSource}`,
      after: "      - uses: actions/setup-node@v6",
      expected: /jobs\.release\.steps\[2\]\.uses/,
    },
    {
      name: "setup-node registry redirect",
      before: "          registry-url: https://registry.npmjs.org",
      after: "          registry-url: https://registry.example.invalid",
      expected: /jobs\.release\.steps\[2\]\.with\.registry-url/,
    },
    {
      name: "setup-node mirror override",
      before: "          registry-url: https://registry.npmjs.org",
      after:
        "          registry-url: https://registry.npmjs.org\n          mirror: https://node.example.invalid",
      expected: /jobs\.release\.steps\[2\]\.with\.mirror|allowed keys/,
    },
    {
      name: "setup-node environment override",
      before: `      - uses: ${setupNodeActionSource}\n        with:`,
      after: `      - uses: ${setupNodeActionSource}\n        env:\n          NODE_OPTIONS: --require=/tmp/bypass.cjs\n        with:`,
      expected: /jobs\.release\.steps\[2\]\.env|allowed keys/,
    },
    {
      name: "setup-node conditional",
      before: `      - uses: ${setupNodeActionSource}\n        with:`,
      after: `      - uses: ${setupNodeActionSource}\n        if: \${{ always() }}\n        with:`,
      expected: /jobs\.release\.steps\[2\]\.if|allowed keys/,
    },
    ...[
      ["node-version", "24.19.0", "true"],
      ["cache", "pnpm", "true"],
      ["registry-url", "https://registry.npmjs.org", "false"],
    ].map(([input, current, replacement]) => ({
      name: `setup-node ${input} scalar type`,
      before: `          ${input}: ${current}`,
      after: `          ${input}: ${replacement}`,
      expected: setupNodeInputErrorPattern(input),
    })),
    ...[
      ["node-version", "24.19.0"],
      ["cache", "pnpm"],
      ["registry-url", "https://registry.npmjs.org"],
    ].map(([input, current]) => ({
      name: `setup-node ${input} missing`,
      before: `          ${input}: ${current}\n`,
      after: "",
      expected: setupNodeInputErrorPattern(input),
    })),
    ...[
      ["node-version", "24.19.0", "22.0.0"],
      ["cache", "pnpm", "npm"],
    ].map(([input, current, replacement]) => ({
      name: `setup-node ${input} value drift`,
      before: `          ${input}: ${current}`,
      after: `          ${input}: ${replacement}`,
      expected: setupNodeInputErrorPattern(input),
    })),
    {
      name: "install command suppression",
      before: `      - run: ${expectedFrozenInstall}`,
      after: `      - run: ${expectedFrozenInstall} || true`,
      expected: /jobs\.release\.steps\[3\]\.run|frozen install/,
    },
    {
      name: "install continue-on-error",
      before: `      - run: ${expectedFrozenInstall}`,
      after: `      - run: ${expectedFrozenInstall}\n        continue-on-error: true`,
      expected: /jobs\.release\.steps\[3\]\.continue-on-error|allowed keys/,
    },
    ...[
      ["if", "${{ always() }}"],
      ["env", "{ NODE_OPTIONS: --require=/tmp/bypass.cjs }"],
      ["shell", "bash -c 'exit 0' {0}"],
      ["working-directory", "/tmp"],
    ].map(([key, value]) => ({
      name: `install ${key} override`,
      before: `      - run: ${expectedFrozenInstall}`,
      after: `      - run: ${expectedFrozenInstall}\n        ${key}: ${value}`,
      expected: new RegExp(
        `jobs\\.release\\.steps\\[3\\]\\.${key}|allowed keys`,
      ),
    })),
    {
      name: "audit shell suppression",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - run: ${expectedSecurityAuditCommand}\n        shell: bash -c 'exit 0' {0}`,
      expected: /jobs\.release\.steps\[4\]\.shell|allowed keys/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const release = replaceOnce(base.release, fixture.before, fixture.after);
      assertRejected(
        analyzeRepositoryInputs({ ...base, release }),
        fixture.expected,
        fixture.name,
      );
    });
  }
});

test("rejects custom shells, defaults, and execution-affecting env", async (t) => {
  const base = await readRepositoryInputs();
  const cases = [
    {
      name: "CI audit custom shell",
      field: "ci",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - shell: bash -c 'exit 0' {0}\n        run: ${expectedSecurityAuditCommand}`,
      expected: /shell|allowed keys/,
    },
    {
      name: "release audit custom shell",
      field: "release",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - shell: bash -c 'exit 0' {0}\n        run: ${expectedSecurityAuditCommand}`,
      expected: /shell|allowed keys/,
    },
    {
      name: "CI workflow defaults.run.shell",
      field: "ci",
      before: "name: CI\n",
      after: "name: CI\n\ndefaults:\n  run:\n    shell: bash -c 'exit 0' {0}\n",
      expected: /workflow\.defaults|allowed keys/,
    },
    {
      name: "CI job defaults.run.shell",
      field: "ci",
      before: "  security-audit:\n    name: security-audit\n",
      after:
        "  security-audit:\n    name: security-audit\n    defaults:\n      run:\n        shell: bash -c 'exit 0' {0}\n",
      expected: /jobs\.security-audit\.defaults|allowed keys/,
    },
    {
      name: "CI workflow PATH env",
      field: "ci",
      before: "name: CI\n",
      after: "name: CI\n\nenv:\n  PATH: /tmp/bypass\n",
      expected: /workflow\.env|allowed keys/,
    },
    {
      name: "CI job npm_execpath env",
      field: "ci",
      before: "  security-audit:\n    name: security-audit\n",
      after:
        "  security-audit:\n    name: security-audit\n    env:\n      npm_execpath: /tmp/bypass.cjs\n",
      expected: /jobs\.security-audit\.env|allowed keys/,
    },
    {
      name: "CI job permissions drift",
      field: "ci",
      before: "  security-audit:\n    name: security-audit\n",
      after:
        "  security-audit:\n    name: security-audit\n    permissions:\n      contents: write\n",
      expected: /jobs\.security-audit\.permissions|allowed keys/,
    },
    {
      name: "CI audit NODE_OPTIONS env",
      field: "ci",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - env:\n          NODE_OPTIONS: --require=/tmp/bypass.cjs\n        run: ${expectedSecurityAuditCommand}`,
      expected: /jobs\.security-audit\.steps\[4\]\.env|allowed keys/,
    },
    {
      name: "CI audit conditional",
      field: "ci",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - if: always()\n        run: ${expectedSecurityAuditCommand}`,
      expected: /jobs\.security-audit\.steps\[4\]\.if|allowed keys/,
    },
    {
      name: "CI audit continue-on-error",
      field: "ci",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - continue-on-error: true\n        run: ${expectedSecurityAuditCommand}`,
      expected:
        /jobs\.security-audit\.steps\[4\]\.continue-on-error|allowed keys/,
    },
    {
      name: "CI install working directory",
      field: "ci",
      before: `      - run: ${expectedFrozenInstall}\n      - run: ${expectedSecurityAuditCommand}`,
      after: `      - working-directory: /tmp\n        run: ${expectedFrozenInstall}\n      - run: ${expectedSecurityAuditCommand}`,
      expected:
        /jobs\.security-audit\.steps\[3\]\.working-directory|allowed keys/,
    },
    {
      name: "release workflow defaults.run.shell",
      field: "release",
      before: "name: Release\n",
      after:
        "name: Release\n\ndefaults:\n  run:\n    shell: bash -c 'exit 0' {0}\n",
      expected: /workflow\.defaults|allowed keys/,
    },
    {
      name: "release workflow PATH env",
      field: "release",
      before: "name: Release\n",
      after: "name: Release\n\nenv:\n  PATH: /tmp/bypass\n",
      expected: /workflow\.env|allowed keys/,
    },
    {
      name: "release job defaults.run.shell",
      field: "release",
      before: "    timeout-minutes: 20\n",
      after:
        "    timeout-minutes: 20\n    defaults:\n      run:\n        shell: bash -c 'exit 0' {0}\n",
      expected: /jobs\.release\.defaults|allowed keys/,
    },
    {
      name: "release job PATH env drift",
      field: "release",
      before: "      NPM_CONFIG_PROVENANCE: true\n",
      after: "      NPM_CONFIG_PROVENANCE: true\n      PATH: /tmp/bypass\n",
      expected: /jobs\.release\.env\.PATH|allowed keys/,
    },
    {
      name: "release audit npm_execpath env",
      field: "release",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - env:\n          npm_execpath: /tmp/bypass.cjs\n        run: ${expectedSecurityAuditCommand}`,
      expected: /jobs\.release\.steps\[4\]\.env|allowed keys/,
    },
    {
      name: "release audit continue-on-error",
      field: "release",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - continue-on-error: true\n        run: ${expectedSecurityAuditCommand}`,
      expected: /jobs\.release\.steps\[4\]\.continue-on-error|allowed keys/,
    },
    {
      name: "release audit working directory",
      field: "release",
      before: `      - run: ${expectedSecurityAuditCommand}`,
      after: `      - working-directory: /tmp\n        run: ${expectedSecurityAuditCommand}`,
      expected: /jobs\.release\.steps\[4\]\.working-directory|allowed keys/,
    },
    {
      name: "release provenance env drift",
      field: "release",
      before: "      NPM_CONFIG_PROVENANCE: true",
      after: "      NPM_CONFIG_PROVENANCE: false",
      expected: /jobs\.release\.env\.NPM_CONFIG_PROVENANCE/,
    },
    {
      name: "release token env drift",
      field: "release",
      before: "      NPM_CONFIG_PROVENANCE: true",
      after:
        "      NPM_CONFIG_PROVENANCE: true\n      RELEASE_GITHUB_TOKEN: /tmp/bypass",
      expected: /jobs\.release\.env\.RELEASE_GITHUB_TOKEN/,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const input = {
        ...base,
        [fixture.field]: replaceOnce(
          base[fixture.field],
          fixture.before,
          fixture.after,
        ),
      };
      assertRejected(
        analyzeRepositoryInputs(input),
        fixture.expected,
        fixture.name,
      );
    });
  }
});

test("rejects deploy dependency-status condition bypasses", async (t) => {
  const base = await readRepositoryInputs();
  const prodIf =
    "    if: github.ref == 'refs/heads/main' && github.event_name == 'push'";
  const previewIf = [
    "    if: >-",
    "      github.event_name == 'pull_request' &&",
    "      github.event.pull_request.head.repo.full_name == github.repository &&",
    "      github.event.pull_request.user.login != 'dependabot[bot]'",
    "    permissions:",
  ].join("\n");
  for (const condition of [
    "always()",
    "failure()",
    "cancelled()",
    "!cancelled()",
  ]) {
    for (const [job, before] of [
      ["deploy-prod", prodIf],
      ["deploy-preview", previewIf],
    ]) {
      await t.test(`${job} ${condition}`, () => {
        const replacement =
          job === "deploy-preview"
            ? `    if: ${condition}\n    permissions:`
            : `    if: ${condition}`;
        const ci = replaceOnce(base.ci, before, replacement);
        assertRejected(
          analyzeRepositoryInputs({ ...base, ci }),
          new RegExp(`jobs\\.${job}\\.if`),
          `${job} ${condition}`,
        );
      });
    }
  }

  await t.test("dependency cycle", () => {
    const ci = replaceOnce(
      base.ci,
      "  packaging:\n    name: Packaging — publint + attw\n    runs-on: ubuntu-latest\n    needs: [build]",
      "  packaging:\n    name: Packaging — publint + attw\n    runs-on: ubuntu-latest\n    needs: [build, deploy-prod]",
    );
    assertRejected(
      analyzeRepositoryInputs({ ...base, ci }),
      /dependency cycle/,
      "dependency cycle",
    );
  });
});

test("rejects the original permanent-gate regressions", async (t) => {
  const base = await readRepositoryInputs();
  const cases = [
    {
      name: "deploy-prod loses security audit need",
      field: "ci",
      source: replaceWithinJob(
        base.ci,
        "deploy-prod",
        "deploy-prod-alarm",
        "        security-audit,\n",
        "",
      ),
      expected: /jobs\.deploy-prod\.needs.*missing security-audit/,
    },
    {
      name: "deploy-preview loses security audit need",
      field: "ci",
      source: replaceWithinJob(
        base.ci,
        "deploy-preview",
        "smoke-preview",
        "        security-audit,\n",
        "",
      ),
      expected: /jobs\.deploy-preview\.needs.*missing security-audit/,
    },
    {
      name: "release audit moves below typecheck",
      field: "release",
      source: replaceOnce(
        base.release,
        `      - run: ${expectedSecurityAuditCommand}\n      - run: pnpm typecheck`,
        `      - run: pnpm typecheck\n      - run: ${expectedSecurityAuditCommand}`,
      ),
      expected: /jobs\.release security audit.*first step after/,
    },
    {
      name: "security setup-node pin drifts",
      field: "ci",
      source: replaceWithinJob(
        base.ci,
        "security-audit",
        "api-report",
        "          node-version: 24.19.0",
        "          node-version: 22.0.0",
      ),
      expected: /jobs\.security-audit\.steps\[2\]\.with\.node-version/,
    },
    {
      name: "CI audit command is suppressed",
      field: "ci",
      source: replaceOnce(
        base.ci,
        `      - run: ${expectedSecurityAuditCommand}`,
        `      - run: ${expectedSecurityAuditCommand} || true`,
      ),
      expected: /jobs\.security-audit\.steps.*permanent security audit/,
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      assertRejected(
        analyzeRepositoryInputs({ ...base, [fixture.field]: fixture.source }),
        fixture.expected,
        fixture.name,
      );
    });
  }
});

test("rejects security audit script indirection and partial commands", async (t) => {
  const base = await readRepositoryInputs();
  const exact = expectedSecurityAuditImplementation;
  for (const replacement of [
    "true",
    `${exact} || true`,
    "pnpm audit --audit-level moderate",
    "AUDIT='pnpm audit --audit-level low'; $AUDIT",
  ]) {
    await t.test(replacement, () => {
      const packageData = JSON.parse(base.packageJson);
      packageData.scripts["security:audit"] = replacement;
      const packageJson = `${JSON.stringify(packageData, null, 2)}\n`;
      assertRejected(
        analyzeRepositoryInputs({ ...base, packageJson }),
        /package\.json.*security:audit/,
        replacement,
      );
    });
  }
  await t.test("legacy audit script alias", () => {
    const packageData = JSON.parse(base.packageJson);
    packageData.scripts["security:audit:legacy"] =
      expectedSecurityAuditImplementation;
    const packageJson = `${JSON.stringify(packageData, null, 2)}\n`;
    assertRejected(
      analyzeRepositoryInputs({ ...base, packageJson }),
      /legacy audit script.*must be absent/i,
      "legacy audit script alias",
    );
  });
});

test("contracts repository dependency audit trust inputs", async (t) => {
  const base = await readRepositoryInputs();
  for (const [name, npmrc] of [
    [
      "registry redirect",
      `${expectedNpmrc}registry=https://registry.invalid\n`,
    ],
    ["audit disabled", `${expectedNpmrc}audit=false\n`],
    ["production-only", `${expectedNpmrc}production=true\n`],
    [
      "configuration reorder",
      "strict-peer-dependencies=false\nauto-install-peers=true\n",
    ],
    [
      "CRLF drift",
      "auto-install-peers=true\r\nstrict-peer-dependencies=false\r\n",
    ],
  ]) {
    await t.test(`.npmrc ${name}`, () => {
      assertRejected(
        analyzeRepositoryInputs({ ...base, npmrc }),
        /\.npmrc.*exactly match/,
        `.npmrc ${name}`,
      );
    });
  }

  for (const [name, workspace] of [
    ["dev root key", "packages: []\ndev: true\n"],
    ["optional root key", "packages: []\noptional: false\n"],
    ["extra root key", "packages: []\ncatalog: {}\n"],
    ["package order", "packages:\n  - packages/*\n  - apps/*\n"],
    ["comment", "packages:\n  - apps/*\n  - packages/* # comment\n"],
    ["CRLF", "packages:\r\n  - apps/*\r\n  - packages/*\r\n"],
    ["missing newline", "packages:\n  - apps/*\n  - packages/*"],
    [
      "ignoreCves",
      "packages: []\nauditConfig:\n  ignoreCves: [CVE-2026-0001]\n",
    ],
    [
      "ignoreGhsas",
      "packages: []\nauditConfig:\n  ignoreGhsas: [GHSA-xxxx-yyyy-zzzz]\n",
    ],
    ["empty auditConfig", "packages: []\nauditConfig: {}\n"],
    ["null auditConfig", "packages: []\nauditConfig:\n"],
    ["scalar auditConfig", "packages: []\nauditConfig: false\n"],
    [
      "inline merge key",
      "packages: []\n<<: { auditConfig: { ignoreCves: [CVE-2026-0001] } }\n",
    ],
    [
      "nested inline merge key",
      "packages: []\ncatalog:\n  <<: { auditConfig: { ignoreGhsas: [GHSA-xxxx-yyyy-zzzz] } }\n",
    ],
    [
      "alias merge key",
      "defaults: &defaults { auditConfig: { ignoreCves: [CVE-2026-0001] } }\npackages: []\n<<: *defaults\n",
    ],
    ["alias", "shared: &shared []\npackages: *shared\n"],
    [
      "duplicate auditConfig",
      "packages: []\nauditConfig: {}\nauditConfig: null\n",
    ],
    ["unsupported tag", "packages: !untrusted []\n"],
    ["malformed", "packages: [\n"],
  ]) {
    await t.test(`workspace ${name}`, () => {
      assertRejected(
        analyzeRepositoryInputs({ ...base, workspace }),
        /pnpm-workspace\.yaml.*exact approved bytes/,
        `workspace ${name}`,
      );
    });
  }

  for (const lifecycle of [
    "pnpm:devPreinstall",
    "preinstall",
    "install",
    "postinstall",
    "prepublish",
    "preprepare",
    "prepare",
    "postprepare",
    "prepublishOnly",
    "prepack",
    "postpack",
    "publish",
    "postpublish",
  ]) {
    await t.test(`root ${lifecycle} lifecycle`, () => {
      const packageData = JSON.parse(base.packageJson);
      packageData.scripts[lifecycle] = "node ./scripts/untrusted.cjs";
      assertRejected(
        analyzeRepositoryInputs({
          ...base,
          packageJson: `${JSON.stringify(packageData, null, 2)}\n`,
        }),
        new RegExp(`package\\.json scripts\\.${lifecycle}.*absent`),
        `root ${lifecycle} lifecycle`,
      );
    });
  }

  for (const [name, pnpm] of [
    ["null", null],
    ["boolean", false],
    ["string", "ignored"],
    ["array", []],
    ["empty object", {}],
    ["ignoreGhsas", { auditConfig: { ignoreGhsas: ["GHSA-test"] } }],
    ["ignoreCves", { auditConfig: { ignoreCves: ["CVE-2026-0001"] } }],
    ["configDependencies", { configDependencies: { pnpmfile: "1.0.0" } }],
  ]) {
    await t.test(`root pnpm property ${name}`, () => {
      const packageData = JSON.parse(base.packageJson);
      packageData.pnpm = pnpm;
      assertRejected(
        analyzeRepositoryInputs({
          ...base,
          packageJson: `${JSON.stringify(packageData, null, 2)}\n`,
        }),
        /package\.json own pnpm property must be absent/,
        `root pnpm property ${name}`,
      );
    });
  }

  await t.test("root pnpmfile", () => {
    assertRejected(
      analyzeRepositoryInputs({ ...base, pnpmfile: "module.exports = {};\n" }),
      /\.pnpmfile\.cjs must be absent/,
      "root pnpmfile",
    );
  });
});

test("static repository trust reads reject symlinks without following them", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pretable-static-trust-"));
  try {
    await writeFile(join(directory, "target"), "untrusted\n");
    for (const name of [
      ".npmrc",
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ]) {
      await t.test(name, async () => {
        await symlink("target", join(directory, name));
        await assert.rejects(
          readStableRepositoryFile(directory, name),
          /regular non-symlink repository input/,
        );
      });
    }
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("static contract rejects every pnpmfile entry and an ENOENT race", async (t) => {
  const cases = [
    [
      "regular file",
      (directory, candidate) => writeFile(candidate, "module.exports = {};\n"),
    ],
    [
      "valid symlink",
      async (directory, candidate) => {
        await writeFile(
          join(directory, "target.cjs"),
          "module.exports = {};\n",
        );
        await symlink("target.cjs", candidate);
      },
    ],
    [
      "dangling symlink",
      (_directory, candidate) => symlink("missing.cjs", candidate),
    ],
    ["directory", (_directory, candidate) => mkdir(candidate)],
  ];

  for (const [name, createEntry] of cases) {
    await t.test(name, async () => {
      const directory = await mkdtemp(join(tmpdir(), "pretable-pnpmfile-"));
      try {
        const candidate = join(directory, ".pnpmfile.cjs");
        await createEntry(directory, candidate);
        await assert.rejects(
          assertAbsentRepositoryPath(directory, ".pnpmfile.cjs"),
          /pnpmfile must be absent/,
        );
      } finally {
        await rm(directory, { force: true, recursive: true });
      }
    });
  }

  await t.test("ENOENT lstat race", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pretable-pnpmfile-race-"));
    try {
      const candidate = join(directory, ".pnpmfile.cjs");
      await assert.rejects(
        assertAbsentRepositoryPath(directory, ".pnpmfile.cjs", {
          async lstat(file, options) {
            if (file === candidate) {
              await writeFile(candidate, "module.exports = {};\n");
              throw Object.assign(new Error("raced"), { code: "ENOENT" });
            }
            return lstat(file, options);
          },
        }),
        /pnpmfile must be absent/,
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});

test("rejects unstable trigger and duplicate-context configurations", async (t) => {
  const base = await readRepositoryInputs();
  const triggerBlock = [
    "on:",
    "  pull_request:",
    "    branches: [main]",
    "  push:",
    "    branches: [main]",
  ].join("\n");
  const cases = [
    {
      name: "manual-only trigger",
      ci: replaceOnce(base.ci, triggerBlock, "on: workflow_dispatch"),
      expected: /workflow\.on/,
    },
    {
      name: "pull request path filter",
      ci: replaceOnce(
        base.ci,
        "  pull_request:\n    branches: [main]",
        "  pull_request:\n    branches: [main]\n    paths: [packages/**]",
      ),
      expected: /workflow\.on\.pull_request\.paths|allowed keys/,
    },
    {
      name: "push paths-ignore filter",
      ci: replaceOnce(
        base.ci,
        "  push:\n    branches: [main]",
        "  push:\n    branches: [main]\n    paths-ignore: [docs/**]",
      ),
      expected: /workflow\.on\.push\.paths-ignore|allowed keys/,
    },
    {
      name: "pull request branches-ignore filter",
      ci: replaceOnce(
        base.ci,
        "  pull_request:\n    branches: [main]",
        "  pull_request:\n    branches: [main]\n    branches-ignore: [release/**]",
      ),
      expected: /workflow\.on\.pull_request\.branches-ignore|allowed keys/,
    },
    {
      name: "security job matrix",
      ci: replaceOnce(
        base.ci,
        "  security-audit:\n    name: security-audit\n",
        "  security-audit:\n    name: security-audit\n    strategy:\n      matrix:\n        node: [24.19.0]\n",
      ),
      expected: /jobs\.security-audit\.strategy|allowed keys/,
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      assertRejected(
        analyzeRepositoryInputs({ ...base, ci: fixture.ci }),
        fixture.expected,
        fixture.name,
      );
    });
  }

  await t.test("duplicate effective display context", () => {
    const workflows = new Map(base.workflows);
    workflows.set(
      ".github/workflows/duplicate.yml",
      "name: Duplicate\non: workflow_dispatch\njobs:\n  duplicate:\n    name: security-audit\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n",
    );
    assertRejected(
      analyzeRepositoryInputs({ ...base, workflows }),
      /security-audit.*unique|duplicate.*security-audit/,
      "duplicate effective display context",
    );
  });
  await t.test("duplicate implicit display context", () => {
    const workflows = new Map(base.workflows);
    workflows.set(
      ".github/workflows/duplicate.yaml",
      "name: Duplicate\non: workflow_dispatch\njobs:\n  security-audit:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n",
    );
    assertRejected(
      analyzeRepositoryInputs({ ...base, workflows }),
      /security-audit.*unique|duplicate.*security-audit/,
      "duplicate implicit display context",
    );
  });
  for (const [shape, nameLine] of [
    ["static expression", "    name: ${{ 'security-audit' }}"],
    [
      "format expression",
      "    name: \"${{ format('{0}', 'security-audit') }}\"",
    ],
    ["interpolated expression", '    name: "audit-${{ github.ref_name }}"'],
    ["dynamic expression", "    name: ${{ github.ref_name }}"],
  ]) {
    await t.test(`expression-valued job name: ${shape}`, () => {
      const workflows = new Map(base.workflows);
      workflows.set(
        `.github/workflows/expression-${shape.replaceAll(" ", "-")}.yml`,
        [
          "name: Expression name",
          "on: workflow_dispatch",
          "jobs:",
          "  expression-name:",
          nameLine,
          "    runs-on: ubuntu-latest",
          "    steps:",
          "      - run: echo ok",
          "",
        ].join("\n"),
      );
      assertRejected(
        analyzeRepositoryInputs({ ...base, workflows }),
        /jobs\.expression-name\.name.*expression-valued|expression-valued.*jobs\.expression-name\.name/,
        `expression-valued job name: ${shape}`,
      );
    });
  }
});

test("rejects jobs outside the complete workflow job-id sets", async (t) => {
  const base = await readRepositoryInputs();
  await t.test("extra Vercel deploy job in CI", () => {
    const ci = `${base.ci.trimEnd()}\n\n  deploy-shadow:\n    name: Deploy shadow → Vercel\n    needs: [security-audit]\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx vercel deploy --yes\n`;
    assertRejected(
      analyzeRepositoryInputs({ ...base, ci }),
      /workflow\.jobs.*deploy-shadow|jobs\.deploy-shadow.*not allowed|unexpected job.*deploy-shadow/,
      "extra Vercel deploy job in CI",
    );
  });
  await t.test("extra package publish job in release", () => {
    const release = `${base.release.trimEnd()}\n\n  publish-shadow:\n    name: Publish shadow package\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm publish\n`;
    assertRejected(
      analyzeRepositoryInputs({ ...base, release }),
      /workflow\.jobs.*publish-shadow|jobs\.publish-shadow.*not allowed|unexpected job.*publish-shadow/,
      "extra package publish job in release",
    );
  });
});

test("contracts CI root permissions and concurrency exactly", async (t) => {
  const base = await readRepositoryInputs();
  const cases = [
    {
      name: "permissions value drift",
      ci: setWorkflowValue(base.ci, ["permissions", "contents"], "write"),
      expected: /workflow\.permissions\.contents/,
    },
    {
      name: "permissions scalar shape",
      ci: setWorkflowValue(base.ci, ["permissions"], "read-all"),
      expected: /workflow\.permissions.*mapping/,
    },
    {
      name: "concurrency group drift",
      ci: setWorkflowValue(base.ci, ["concurrency", "group"], "ci-shadow"),
      expected: /workflow\.concurrency\.group/,
    },
    {
      name: "concurrency cancel drift",
      ci: setWorkflowValue(
        base.ci,
        ["concurrency", "cancel-in-progress"],
        false,
      ),
      expected: /workflow\.concurrency\.cancel-in-progress/,
    },
    {
      name: "concurrency scalar shape",
      ci: setWorkflowValue(base.ci, ["concurrency"], "ci-shadow"),
      expected: /workflow\.concurrency.*mapping/,
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      assertRejected(
        analyzeRepositoryInputs({ ...base, ci: fixture.ci }),
        fixture.expected,
        fixture.name,
      );
    });
  }
});

test("contracts release triggers, concurrency, and sensitive values", async (t) => {
  const base = await readRepositoryInputs();
  const cases = [
    {
      name: "manual-only release trigger",
      release: setWorkflowValue(base.release, ["on"], {
        workflow_dispatch: null,
      }),
      expected: /workflow\.on\.push/,
    },
    {
      name: "release push path filter",
      release: setWorkflowValue(
        base.release,
        ["on", "push", "paths"],
        ["packages/**"],
      ),
      expected: /workflow\.on\.push\.paths|allowed keys/,
    },
    {
      name: "release push branch drift",
      release: setWorkflowValue(
        base.release,
        ["on", "push", "branches"],
        ["release"],
      ),
      expected: /workflow\.on\.push\.branches/,
    },
    {
      name: "extra release schedule trigger",
      release: setWorkflowValue(
        base.release,
        ["on", "schedule"],
        [{ cron: "0 0 * * *" }],
      ),
      expected: /workflow\.on\.schedule|allowed keys/,
    },
    {
      name: "configured workflow dispatch shape",
      release: setWorkflowValue(base.release, ["on", "workflow_dispatch"], {
        inputs: { publish: { type: "boolean" } },
      }),
      expected: /workflow\.on\.workflow_dispatch/,
    },
    {
      name: "release concurrency value drift",
      release: setWorkflowValue(
        base.release,
        ["concurrency"],
        "release-shadow",
      ),
      expected: /workflow\.concurrency/,
    },
    {
      name: "release concurrency mapping shape",
      release: setWorkflowValue(base.release, ["concurrency"], {
        group: "${{ github.workflow }}-${{ github.ref }}",
        "cancel-in-progress": false,
      }),
      expected: /workflow\.concurrency.*string/,
    },
    {
      name: "release id-token permission drift",
      release: setWorkflowValue(
        base.release,
        ["jobs", "release", "permissions", "id-token"],
        "read",
      ),
      expected: /jobs\.release\.permissions\.id-token/,
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      assertRejected(
        analyzeRepositoryInputs({ ...base, release: fixture.release }),
        fixture.expected,
        fixture.name,
      );
    });
  }
});

test("workflow audit steps invoke the permanent named command", async (t) => {
  const base = await readRepositoryInputs();
  for (const [workflow, source, path] of [
    ["CI", base.ci, ["jobs", "security-audit", "steps", 4, "run"]],
    ["release", base.release, ["jobs", "release", "steps", 4, "run"]],
  ]) {
    await t.test(workflow, () => {
      assert.equal(workflowValue(source, path), expectedSecurityAuditCommand);
    });
  }

  for (const [workflow, field, expected] of [
    ["CI", "ci", /jobs\.security-audit\.steps.*permanent security audit/],
    ["release", "release", /jobs\.release\.steps.*permanent security audit/],
  ]) {
    await t.test(`${workflow} direct-command bypass`, () => {
      const source = replaceOnce(
        base[field],
        `      - run: ${expectedSecurityAuditCommand}`,
        `      - run: ${expectedSecurityAuditImplementation}`,
      );
      assertRejected(
        analyzeRepositoryInputs({ ...base, [field]: source }),
        expected,
        `${workflow} direct-command bypass`,
      );
    });
  }

  for (const [workflow, field, path] of [
    ["CI", "ci", ["jobs", "security-audit", "steps", 4, "run"]],
    ["release", "release", ["jobs", "release", "steps", 4, "run"]],
  ]) {
    const expected =
      field === "ci"
        ? /jobs\.security-audit\.steps.*permanent security audit/
        : /jobs\.release\.steps.*permanent security audit/;
    for (const [name, command] of [
      [
        "registry redirect",
        "export NPM_CONFIG_REGISTRY=https://registry.invalid && pnpm security:audit",
      ],
      [
        "lower-case registry export",
        "export npm_config_registry=https://registry.npmjs.org && pnpm security:audit",
      ],
      ["missing registry export", "pnpm audit --audit-level moderate"],
    ]) {
      await t.test(`${workflow} ${name}`, () => {
        const source = setWorkflowValue(base[field], path, command);
        assertRejected(
          analyzeRepositoryInputs({ ...base, [field]: source }),
          expected,
          `${workflow} ${name}`,
        );
      });
    }
  }
});

test("CI and release require both packed compatibility matrices after build", async (t) => {
  const base = await readRepositoryInputs();
  for (const [workflow, field, jobPath] of [
    ["CI", "ci", "jobs.packaging.steps"],
    ["release", "release", "jobs.release.steps"],
  ]) {
    for (const command of expectedPackedCompatibilityCommands) {
      await t.test(`${workflow} rejects missing ${command}`, () => {
        const source = replaceOnce(
          base[field],
          `      - run: ${command}\n`,
          "",
        );
        assertRejected(
          analyzeRepositoryInputs({ ...base, [field]: source }),
          new RegExp(
            `${jobPath.replaceAll(".", "\\.")}.*${command.replace(":", "\\:")}`,
          ),
          `${workflow} missing ${command}`,
        );
      });

      await t.test(`${workflow} rejects ${command} before build`, () => {
        const buildCommand =
          field === "ci" ? expectedPublicPackageBuild : "pnpm build";
        const withoutGate = replaceOnce(
          base[field],
          `      - run: ${command}\n`,
          "",
        );
        const source =
          field === "ci"
            ? replaceWithinJob(
                withoutGate,
                "packaging",
                "publish-preflight",
                `      - run: ${buildCommand}\n`,
                `      - run: ${command}\n      - run: ${buildCommand}\n`,
              )
            : replaceOnce(
                withoutGate,
                `      - run: ${buildCommand}\n`,
                `      - run: ${command}\n      - run: ${buildCommand}\n`,
              );
        assertRejected(
          analyzeRepositoryInputs({ ...base, [field]: source }),
          /after the (?:fresh public-package|release) build/i,
          `${workflow} ${command} before build`,
        );
      });
    }
  }
});

test("CI and release use the exact hook-free frozen install", async (t) => {
  const base = await readRepositoryInputs();
  for (const [workflow, field, path] of [
    ["CI", "ci", ["jobs", "security-audit", "steps", 3, "run"]],
    ["release", "release", ["jobs", "release", "steps", 3, "run"]],
  ]) {
    await t.test(`${workflow} exact install`, () => {
      assert.equal(workflowValue(base[field], path), expectedFrozenInstall);
    });
    for (const [name, command] of [
      [
        "drops ignore-scripts",
        "pnpm install --frozen-lockfile --ignore-pnpmfile",
      ],
      [
        "drops ignore-pnpmfile",
        "pnpm install --frozen-lockfile --ignore-scripts",
      ],
      [
        "reorders flags",
        "pnpm install --ignore-scripts --ignore-pnpmfile --frozen-lockfile",
      ],
    ]) {
      await t.test(`${workflow} ${name}`, () => {
        const source = setWorkflowValue(base[field], path, command);
        assertRejected(
          analyzeRepositoryInputs({ ...base, [field]: source }),
          field === "ci"
            ? /jobs\.security-audit\.steps\[3\]\.run/
            : /jobs\.release\.steps\[3\]\.run|frozen install/,
          `${workflow} ${name}`,
        );
      });
    }
  }
});

test("requires bounded CI and release job timeouts", async (t) => {
  const base = await readRepositoryInputs();
  const cases = [
    {
      name: "CI timeout missing",
      field: "ci",
      source: replaceOnce(base.ci, "    timeout-minutes: 10\n", ""),
      expected: /jobs\.security-audit\.timeout-minutes/,
    },
    ...["9", '"10"'].map((timeout) => ({
      name: `CI timeout ${timeout}`,
      field: "ci",
      source: replaceOnce(
        base.ci,
        "    timeout-minutes: 10",
        `    timeout-minutes: ${timeout}`,
      ),
      expected: /jobs\.security-audit\.timeout-minutes/,
    })),
    ...["missing", "19", '"20"'].map((timeout) => ({
      name: `release timeout ${timeout}`,
      field: "release",
      source:
        timeout === "missing"
          ? replaceOnce(base.release, "    timeout-minutes: 20\n", "")
          : replaceOnce(
              base.release,
              "    timeout-minutes: 20",
              `    timeout-minutes: ${timeout}`,
            ),
      expected: /jobs\.release\.timeout-minutes/,
    })),
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      assertRejected(
        analyzeRepositoryInputs({ ...base, [fixture.field]: fixture.source }),
        fixture.expected,
        fixture.name,
      );
    });
  }
});

test("CI and release keep the dependency audit permanent fail-closed", async () => {
  assert.deepEqual(analyzeRepositoryInputs(await readRepositoryInputs()), []);
});
