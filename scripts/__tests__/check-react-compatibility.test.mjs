import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  assertCommandSucceeded,
  assertResolvedInsideFixture,
  assertSafeTemporaryRoot,
  validateInstallResult,
} from "../check-packed-consumers.mjs";

import {
  REACT_COMPATIBILITY_MATRIX,
  createReactCompatibilityManifest,
  validateExactReactRow,
  validateHydrationEvidence,
  validateReact17Rejection,
  validateReactTarballs,
} from "../check-react-compatibility.mjs";

const temporaryRoot = "/tmp/pretable-react-compat-safe";
const tarballs = Object.fromEntries(
  ["core", "react", "stream-adapter", "ui"].map((name) => [
    `@pretable/${name}`,
    join(temporaryRoot, `pretable-${name}-0.10.0.tgz`),
  ]),
);

test("expands the exact reviewed React matrix", () => {
  assert.deepEqual(REACT_COMPATIBILITY_MATRIX, [
    {
      id: "react-18-floor",
      react: "18.0.0",
      reactDom: "18.0.0",
      typesReact: "18.0.0",
      typesReactDom: "18.0.0",
    },
    {
      id: "react-18-current",
      react: "18.3.1",
      reactDom: "18.3.1",
      typesReact: "18.3.31",
      typesReactDom: "18.3.7",
    },
    {
      id: "react-19-current",
      react: "19.2.8",
      reactDom: "19.2.8",
      typesReact: "19.2.18",
      typesReactDom: "19.2.5",
    },
  ]);
});

test("rejects ranges, mismatched React pairs, and missing type pairs", () => {
  for (const invalid of [
    { ...REACT_COMPATIBILITY_MATRIX[0], react: "^18.0.0" },
    { ...REACT_COMPATIBILITY_MATRIX[0], reactDom: "18.3.1" },
    { ...REACT_COMPATIBILITY_MATRIX[0], typesReactDom: undefined },
  ]) {
    assert.throws(
      () => validateExactReactRow(invalid),
      /exact|pair|type|version/i,
    );
  }
});

test("generates an isolated exact tarball manifest", () => {
  const manifest = createReactCompatibilityManifest({
    row: REACT_COMPATIBILITY_MATRIX[0],
    tarballs,
  });
  assert.equal(manifest.private, true);
  assert.equal(manifest.dependencies.react, "18.0.0");
  assert.equal(manifest.dependencies["react-dom"], "18.0.0");
  assert.equal(manifest.devDependencies["@types/react"], "18.0.0");
  assert.equal(manifest.devDependencies["@types/react-dom"], "18.0.0");
  assert.equal(manifest.devDependencies["@types/scheduler"], "0.16.8");
  assert.equal(manifest.devDependencies.typescript, "6.0.3");
  assert.equal(manifest.devDependencies.jsdom, "30.0.1");
  assert.doesNotMatch(JSON.stringify(manifest), /workspace:|link:/u);
});

test("rejects tarballs outside the bounded compatibility root", () => {
  assert.doesNotThrow(() =>
    validateReactTarballs({ tarballs, temporaryRoot, version: "0.10.0" }),
  );
  assert.throws(
    () =>
      validateReactTarballs({
        tarballs: { ...tarballs, "@pretable/react": "/workspace/react.tgz" },
        temporaryRoot,
        version: "0.10.0",
      }),
    /outside|tarball|temporary/i,
  );
});

test("requires clean hydration, an update, and cleanup", () => {
  assert.doesNotThrow(() =>
    validateHydrationEvidence({
      afterInteraction: "1",
      beforeInteraction: "0",
      containerEmptyAfterUnmount: true,
      recoverableErrors: [],
      serverMarkup: '<button data-count="0">0</button>',
      unexpectedErrors: [],
    }),
  );
  for (const invalid of [
    { recoverableErrors: ["hydration mismatch"] },
    { unexpectedErrors: ["uncaught"] },
    { afterInteraction: "0" },
    { containerEmptyAfterUnmount: false },
    { serverMarkup: "" },
  ]) {
    assert.throws(
      () =>
        validateHydrationEvidence({
          afterInteraction: "1",
          beforeInteraction: "0",
          containerEmptyAfterUnmount: true,
          recoverableErrors: [],
          serverMarkup: "<button>0</button>",
          unexpectedErrors: [],
          ...invalid,
        }),
      /hydration|interaction|unmount|markup|error/i,
    );
  }
});

test("accepts only a React 17 peer-contract rejection", () => {
  assert.doesNotThrow(() =>
    validateReact17Rejection({
      status: 1,
      stderr:
        "npm ERR! ERESOLVE unable to resolve dependency tree peer react ^18.0.0 || ^19.0.0",
      stdout: "Found: react@17.0.2",
    }),
  );
  assert.throws(
    () => validateReact17Rejection({ status: 0, stderr: "", stdout: "" }),
    /React 17|peer|reject/i,
  );
  assert.throws(
    () =>
      validateReact17Rejection({
        status: 1,
        stderr: "npm ERR! network timeout",
        stdout: "",
      }),
    /peer|ERESOLVE/i,
  );
});

test("rejects peer warnings and failed fixture commands", () => {
  assert.throws(
    () =>
      validateInstallResult({
        status: 0,
        stderr: "npm WARN ERESOLVE overriding peer dependency",
        stdout: "installed",
      }),
    /peer|ERESOLVE/i,
  );
  assert.throws(
    () =>
      assertCommandSucceeded(
        { status: 2, stderr: "fixture failed", stdout: "" },
        "react-18-floor runtime",
      ),
    /react-18-floor|status 2|fixture failed/i,
  );
});

test("rejects workspace resolution leakage and unbounded cleanup", () => {
  assert.throws(
    () =>
      assertResolvedInsideFixture({
        fixtureRoot: join(temporaryRoot, "react-18-floor"),
        packageName: "@pretable/react",
        resolvedPath: "/workspace/packages/react/dist/index.mjs",
      }),
    /outside|node_modules|workspace/i,
  );
  assert.throws(
    () =>
      assertSafeTemporaryRoot({
        candidateRoot: "/tmp",
        prefix: "pretable-react-compat-",
        systemTempRoot: "/tmp",
      }),
    /cleanup|temporary/i,
  );
});

test("documents the React and package compatibility contract at every entry point", async () => {
  const repositoryRoot = new URL("../../", import.meta.url);
  const compatibilityGuide = await readFile(
    new URL("docs/compatibility.md", repositoryRoot),
    "utf8",
  );
  const entryPoints = await Promise.all(
    [
      "README.md",
      "packages/react/README.md",
      "apps/website/content/docs/getting-started/index.mdx",
    ].map(async (relativePath) => ({
      contents: await readFile(new URL(relativePath, repositoryRoot), "utf8"),
      relativePath,
    })),
  );

  assert.match(compatibilityGuide, /first-class ESM and CommonJS/u);
  assert.match(compatibilityGuide, /ES2018 syntax/u);
  assert.match(compatibilityGuide, /React 18\.0\.0 is the tested floor/u);
  assert.match(compatibilityGuide, /React 17 and earlier are unsupported/u);
  assert.match(compatibilityGuide, /Webpack 4 itself/u);
  assert.match(compatibilityGuide, /dist\/index\.mjs.*unsupported/su);
  for (const runtimeApi of [
    "AbortController",
    "BigInt",
    "Object.fromEntries",
    "ResizeObserver",
    "cancelAnimationFrame",
    "queueMicrotask",
    "requestAnimationFrame",
    "structuredClone",
  ]) {
    assert.ok(compatibilityGuide.includes(`\`${runtimeApi}\``), runtimeApi);
  }

  for (const { contents, relativePath } of entryPoints) {
    assert.match(contents, /React and ReactDOM 18 or 19/u, relativePath);
    assert.match(contents, /package compatibility/u, relativePath);
  }
});
