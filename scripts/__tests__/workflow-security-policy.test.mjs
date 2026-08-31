import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parse } from "yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const workflowDir = resolve(repoRoot, ".github/workflows");

async function workflows() {
  const names = (await readdir(workflowDir))
    .filter((name) => /\.ya?ml$/.test(name))
    .sort();
  return Promise.all(
    names.map(async (name) => ({
      name,
      source: await readFile(resolve(workflowDir, name), "utf8"),
      document: parse(await readFile(resolve(workflowDir, name), "utf8")),
    })),
  );
}

function remoteUses(value) {
  const found = [];
  function visit(node, path = "workflow") {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, child] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (
        key === "uses" &&
        typeof child === "string" &&
        !child.startsWith("./")
      ) {
        found.push({ path: childPath, value: child });
      }
      visit(child, childPath);
    }
  }
  visit(value);
  return found;
}

function permissionWrites(document) {
  const writes = [];
  const inspect = (permissions, path) => {
    if (permissions === "read-all" || permissions == null) return;
    if (typeof permissions !== "object") {
      writes.push(`${path}.*`);
      return;
    }
    for (const [scope, access] of Object.entries(permissions)) {
      if (access === "write") writes.push(`${path}.${scope}`);
    }
  };
  inspect(document.permissions, "permissions");
  for (const [jobId, job] of Object.entries(document.jobs ?? {})) {
    inspect(job.permissions, `jobs.${jobId}.permissions`);
  }
  return writes;
}

function stepNamed(job, name) {
  return job.steps.find((step) => step.name === name);
}

test("scalar write-all permissions are classified as writes at every scope", () => {
  assert.deepEqual(permissionWrites({ permissions: "write-all" }), [
    "permissions.*",
  ]);
  assert.deepEqual(
    permissionWrites({
      permissions: "read-all",
      jobs: { unsafe: { permissions: "write-all" } },
    }),
    ["jobs.unsafe.permissions.*"],
  );
});

test("every third-party action is pinned to an immutable commit SHA", async () => {
  const failures = [];
  for (const workflow of await workflows()) {
    for (const action of remoteUses(workflow.document)) {
      const ref = action.value.split("@").at(-1);
      if (!/^[0-9a-f]{40}$/.test(ref)) {
        failures.push(`${workflow.name}: ${action.path} uses ${action.value}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("write permissions are confined to the reviewed job-level allowlist", async () => {
  const expected = {
    "ci.yml": [
      "jobs.deploy-preview.permissions.pull-requests",
      "jobs.deploy-prod-alarm.permissions.issues",
    ],
    "codeql.yml": ["jobs.analyze.permissions.security-events"],
    "prod-freshness.yml": ["jobs.freshness.permissions.issues"],
    "release.yml": ["jobs.release.permissions.id-token"],
    "scorecard.yml": [
      "jobs.scorecard.permissions.id-token",
      "jobs.scorecard.permissions.security-events",
    ],
  };
  for (const workflow of await workflows()) {
    assert.deepEqual(
      permissionWrites(workflow.document).sort(),
      (expected[workflow.name] ?? []).sort(),
      workflow.name,
    );
  }
});

test("CodeQL grants upload permission only to the analysis job", async () => {
  const { document } = (await workflows()).find(
    ({ name }) => name === "codeql.yml",
  );
  assert.deepEqual(document.permissions, { contents: "read" });
  assert.deepEqual(document.jobs.analyze.permissions, {
    actions: "read",
    contents: "read",
    "security-events": "write",
  });
});

test("release uses read-only repository contents and a step-scoped release token", async () => {
  const { document, source } = (await workflows()).find(
    ({ name }) => name === "release.yml",
  );
  const job = document.jobs.release;
  assert.deepEqual(document.permissions, { contents: "read" });
  assert.deepEqual(job.permissions, {
    contents: "read",
    "id-token": "write",
  });
  assert.deepEqual(job.env, { NPM_CONFIG_PROVENANCE: true });

  const changesets = stepNamed(job, "Version PR or publish");
  assert.equal(
    changesets.with["github-token"],
    "${{ secrets.RELEASE_GITHUB_TOKEN }}",
  );

  const autoMerge = stepNamed(job, "Enable auto-merge on Version PR");
  assert.equal(autoMerge.if, "steps.changesets.outputs.pr-number != ''");
  assert.deepEqual(autoMerge.env, {
    GH_TOKEN: "${{ secrets.RELEASE_GITHUB_TOKEN }}",
  });
  assert.doesNotMatch(source, /RELEASE_GITHUB_TOKEN\s*\|\|/);
  assert.doesNotMatch(
    source,
    /github-token:\s*\$\{\{\s*(?:github\.token|secrets\.GITHUB_TOKEN)/,
  );
});

test("Vercel deployments fail closed on CLI errors or invalid URLs", async () => {
  const { document } = (await workflows()).find(
    ({ name }) => name === "ci.yml",
  );
  for (const [jobId, stepName] of [
    ["deploy-prod", "Deploy to Vercel (production)"],
    ["deploy-preview", "Deploy preview to Vercel"],
  ]) {
    const script = stepNamed(document.jobs[jobId], stepName).run;
    assert.match(script, /(?:^|\n)set -o pipefail(?:\n|$)/, jobId);
    assert.match(script, /case "\$url" in\s*\n\s*https:\/\/\*\)/, jobId);
    assert.match(script, /exit 1/, jobId);
  }
});
