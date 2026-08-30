import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";

import {
  PUBLIC_PACKAGES,
  TREE_SHAKING_SIZE_CEILING_BYTES,
  assertCommandSucceeded,
  assertResolvedInsideFixture,
  assertSafeTemporaryRoot,
  createConsumerCommandPlan,
  createConsumerManifests,
  validateConsumerManifest,
  validateCanonicalCssAssets,
  validateDependencySpecifications,
  validateInstallResult,
  validateManifestSnapshot,
  validatePackedArtifact,
  validateTarballInventory,
  validateTreeShakenBundle,
} from "../check-packed-consumers.mjs";

const tempRoot = "/tmp/pretable-packed-consumers-safe";

test("rejects cleanup outside the harness-owned temporary namespace", () => {
  assert.throws(
    () =>
      assertSafeTemporaryRoot({
        candidateRoot: "/tmp",
        systemTempRoot: "/tmp",
      }),
    /refusing|temporary root|cleanup/i,
  );
});

test("rejects workspace and link dependency paths in generated consumers", () => {
  for (const specification of ["workspace:*", "link:../../packages/core"]) {
    assert.throws(
      () =>
        validateConsumerManifest({
          dependencies: { "@pretable/core": specification },
          name: "packed-consumer",
          private: true,
        }),
      /workspace|link|tarball/i,
    );
  }
});

test("allows published semver dependencies but rejects workspace protocols", () => {
  assert.doesNotThrow(() =>
    validateDependencySpecifications({
      dependencies: { "@pretable/core": "^0.10.0" },
      name: "@pretable/react",
    }),
  );
  assert.throws(
    () =>
      validateDependencySpecifications({
        dependencies: { "@pretable/core": "workspace:*" },
        name: "@pretable/react",
      }),
    /workspace|link/i,
  );
});

test("rejects a missing public-package tarball", () => {
  const tarballs = Object.fromEntries(
    PUBLIC_PACKAGES.slice(1).map((name) => [
      name,
      join(tempRoot, `${name.slice(1).replace("/", "-")}-0.10.0.tgz`),
    ]),
  );

  assert.throws(
    () =>
      validateTarballInventory({
        expectedVersion: "0.10.0",
        tarballs,
        temporaryRoot: tempRoot,
      }),
    /@pretable\/core|missing tarball/i,
  );
});

test("rejects npm peer warnings even when install exits successfully", () => {
  assert.throws(
    () =>
      validateInstallResult({
        status: 0,
        stderr:
          "npm WARN ERESOLVE overriding peer dependency: react@17 is incompatible",
        stdout: "added 42 packages",
      }),
    /peer|ERESOLVE/i,
  );
});

test("uses semantic exclusion with a generous tree-shaking size alarm", () => {
  assert.doesNotThrow(() =>
    validateTreeShakenBundle({
      size: 147_865,
      source: "export const numberFormats = {};",
    }),
  );
  assert.throws(
    () =>
      validateTreeShakenBundle({
        size: TREE_SHAKING_SIZE_CEILING_BYTES,
        source: "export const numberFormats = {};",
      }),
    /size|byte|alarm/i,
  );
  assert.throws(
    () =>
      validateTreeShakenBundle({
        size: 1,
        source: "class PretableDisposedModelError {}",
      }),
    /PretableDisposedModelError|unrelated|retained/i,
  );
  assert.throws(
    () => validateTreeShakenBundle({ size: 0, source: "" }),
    /evidence|empty|size/i,
  );
});

test("rejects manifest mutation by any public package build", () => {
  const before = Object.fromEntries(
    PUBLIC_PACKAGES.map((packageName) => [packageName, `${packageName}\n`]),
  );
  assert.doesNotThrow(() =>
    validateManifestSnapshot({
      after: { ...before },
      before,
      buildPackageName: "@pretable/core",
    }),
  );
  assert.throws(
    () =>
      validateManifestSnapshot({
        after: { ...before, "@pretable/react": "mutated\n" },
        before,
        buildPackageName: "@pretable/core",
      }),
    /core.*modified.*react.*package\.json/i,
  );
});

test("rejects every failed child process with command context", () => {
  assert.throws(
    () =>
      assertCommandSucceeded(
        { status: 2, stderr: "fixture failed", stdout: "" },
        "node node/esm.mjs",
      ),
    /node node\/esm\.mjs|status 2|fixture failed/i,
  );
});

test("rejects a package resolution outside the fixture node_modules", () => {
  const fixtureRoot = join(tempRoot, "full-consumer");

  assert.throws(
    () =>
      assertResolvedInsideFixture({
        fixtureRoot,
        packageName: "@pretable/core",
        resolvedPath: "/workspace/packages/core/dist/index.mjs",
      }),
    /node_modules|outside|workspace/i,
  );
});

test("generates exact tarball manifests and isolated install commands", () => {
  const tarballs = Object.fromEntries(
    PUBLIC_PACKAGES.map((name) => [
      name,
      join(tempRoot, `${name.slice(1).replace("/", "-")}-0.10.0.tgz`),
    ]),
  );
  const manifests = createConsumerManifests({ tarballs });
  for (const packageName of PUBLIC_PACKAGES) {
    assert.equal(
      manifests.full.dependencies[packageName],
      `file:${tarballs[packageName]}`,
    );
    assert.doesNotMatch(JSON.stringify(manifests), /workspace:|link:/u);
  }
  assert.ok(
    !Object.hasOwn(manifests.frameworkNeutral.dependencies, "@pretable/react"),
  );
  assert.ok(!Object.hasOwn(manifests.frameworkNeutral.dependencies, "react"));

  const plan = createConsumerCommandPlan({
    frameworkNeutralRoot: join(tempRoot, "neutral"),
    fullRoot: join(tempRoot, "full"),
  });
  const installs = plan.filter(
    (step) => step.command === "npm" && step.args[0] === "install",
  );
  assert.equal(installs.length, 2);
  for (const install of installs) {
    assert.deepEqual(install.args, [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ]);
  }
});

test("runs the minimal tree-shaking fixture through Vite and Webpack ESM", () => {
  const plan = createConsumerCommandPlan({
    frameworkNeutralRoot: join(tempRoot, "neutral"),
    fullRoot: join(tempRoot, "full"),
  });
  const treeShakingSteps = plan.filter((step) =>
    step.args.some((argument) => argument.includes("tree-shaking/")),
  );

  assert.deepEqual(
    treeShakingSteps
      .map(({ args, command }) => ({ args, command }))
      .sort((left, right) => left.args.at(-1).localeCompare(right.args.at(-1))),
    [
      {
        args: [
          "--no-install",
          "vite",
          "build",
          "--config",
          "tree-shaking/vite.config.mjs",
        ],
        command: "npx",
      },
      {
        args: [
          "--no-install",
          "webpack",
          "--config",
          "tree-shaking/webpack.config.cjs",
        ],
        command: "npx",
      },
    ],
  );
});

function completeCoreArtifact(overrides = {}) {
  const manifest = {
    exports: {
      ".": {
        import: { default: "./dist/index.mjs", types: "./dist/index.d.mts" },
        require: { default: "./dist/index.cjs", types: "./dist/index.d.cts" },
      },
    },
    main: "./dist/index.cjs",
    module: "./dist/index.mjs",
    name: "@pretable/core",
    types: "./dist/index.d.mts",
    version: "0.10.0",
  };
  const entries = [
    "package/package.json",
    "package/README.md",
    "package/dist/index.mjs",
    "package/dist/index.cjs",
    "package/dist/index.d.mts",
    "package/dist/index.d.cts",
    "package/dist/index.mjs.map",
    "package/dist/index.cjs.map",
    "package/dist/index.d.mts.map",
    "package/dist/index.d.cts.map",
  ];
  const sourceMap = JSON.stringify({
    mappings: "",
    names: [],
    sources: ["../src/index.ts"],
    sourcesContent: ["export const answer = 42;"],
    version: 3,
  });
  const declarationMap = JSON.stringify({
    mappings: "",
    names: [],
    sources: ["../src/index.ts"],
    version: 3,
  });
  const contents = new Map([
    ["package/package.json", JSON.stringify(manifest)],
    ["package/dist/index.mjs", "export const answer = 42;"],
    ["package/dist/index.cjs", '"use strict"; exports.answer = 42;'],
    ["package/dist/index.d.mts", "export declare const answer: 42;"],
    ["package/dist/index.d.cts", "export declare const answer: 42;"],
    ["package/dist/index.mjs.map", sourceMap],
    ["package/dist/index.cjs.map", sourceMap],
    ["package/dist/index.d.mts.map", declarationMap],
    ["package/dist/index.d.cts.map", declarationMap],
  ]);
  for (const [entry, content] of Object.entries(overrides))
    contents.set(entry, content);
  return { contents, entries, packageName: "@pretable/core" };
}

test("accepts a bounded dual-format ES2018 artifact inventory", () => {
  assert.doesNotThrow(() => validatePackedArtifact(completeCoreArtifact()));
});

test("rejects a manifest target that is absent from the tarball", () => {
  const artifact = completeCoreArtifact();
  const manifest = JSON.parse(artifact.contents.get("package/package.json"));
  manifest.exports["."].import.default = "./dist/missing.mjs";
  artifact.contents.set("package/package.json", JSON.stringify(manifest));

  assert.throws(
    () => validatePackedArtifact(artifact),
    /manifest target.*missing\.mjs|does not exist/i,
  );
});

test("requires canonical CSS bytes and a declaration for every public asset", () => {
  const canonical = new Map([
    ["grid.css", "[data-pretable-grid] { display: grid; }\n"],
  ]);
  const declarations = new Map([
    ["grid.css.d.ts", 'declare module "@pretable/ui/grid.css";\n'],
  ]);
  const packed = new Map([...canonical, ...declarations]);

  assert.doesNotThrow(() =>
    validateCanonicalCssAssets({
      assets: ["grid.css"],
      canonical,
      packed,
    }),
  );
  assert.throws(
    () =>
      validateCanonicalCssAssets({
        assets: ["grid.css"],
        canonical,
        packed: new Map(canonical),
      }),
    /declaration|grid\.css\.d\.ts/i,
  );
  assert.throws(
    () =>
      validateCanonicalCssAssets({
        assets: ["grid.css"],
        canonical,
        packed: new Map([["grid.css", "changed"], ...declarations]),
      }),
    /canonical|content|grid\.css/i,
  );
});

test("rejects JavaScript newer than the ES2018 syntax contract", () => {
  const artifact = completeCoreArtifact({
    "package/dist/index.mjs": "export const answer = globalThis?.answer;",
  });
  assert.throws(
    () => validatePackedArtifact(artifact),
    /Unexpected token|ecma/i,
  );
});

test("distinguishes private-package documentation from import leakage", () => {
  const documented = completeCoreArtifact({
    "package/dist/index.mjs":
      "// @pretable-internal/row-model is bundled here.\nexport const answer = 42;",
  });
  assert.doesNotThrow(() => validatePackedArtifact(documented));

  const leaked = completeCoreArtifact({
    "package/dist/index.mjs":
      'export { createRowModel } from "@pretable-internal/row-model";',
  });
  assert.throws(
    () => validatePackedArtifact(leaked),
    /private @pretable-internal import/u,
  );
});

test("rejects an accidentally bundled json-stream dependency", () => {
  const artifact = completeCoreArtifact();
  artifact.packageName = "@pretable/stream-adapter";
  const manifest = JSON.parse(artifact.contents.get("package/package.json"));
  manifest.name = artifact.packageName;
  artifact.contents.set("package/package.json", JSON.stringify(manifest));

  assert.throws(
    () => validatePackedArtifact(artifact),
    /json-stream.*boundary/i,
  );
});
