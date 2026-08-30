export const PUBLIC_PACKAGES = Object.freeze([
  "@pretable/core",
  "@pretable/react",
  "@pretable/stream-adapter",
  "@pretable/ui",
]);

import { spawnSync } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { builtinModules } from "node:module";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";

const TEMPORARY_ROOT_PREFIX = "pretable-packed-consumers-";
const PACKAGE_DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

export const FULL_CONSUMER_VERSIONS = Object.freeze({
  "@types/react": "19.2.18",
  "@types/react-dom": "19.2.5",
  react: "19.2.8",
  "react-dom": "19.2.8",
  typescript: "6.0.3",
  vite: "8.2.1",
  webpack: "5.110.2",
  "webpack-cli": "7.2.3",
});

export const BROWSER_RUNTIME_INVENTORY = Object.freeze([
  "AbortController",
  "Object.fromEntries",
  "ResizeObserver",
  "cancelAnimationFrame",
  "queueMicrotask",
  "requestAnimationFrame",
  "structuredClone",
]);

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_SOURCE_ROOT = join(
  DEFAULT_REPOSITORY_ROOT,
  "test-fixtures",
  "packed-consumers",
);

function isPathWithin(candidatePath, parentPath) {
  const child = relative(resolve(parentPath), resolve(candidatePath));
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`);
}

export function assertSafeTemporaryRoot({
  candidateRoot,
  systemTempRoot,
  prefix = TEMPORARY_ROOT_PREFIX,
}) {
  if (
    typeof candidateRoot !== "string" ||
    typeof systemTempRoot !== "string" ||
    !isAbsolute(candidateRoot) ||
    !isAbsolute(systemTempRoot) ||
    !isPathWithin(candidateRoot, systemTempRoot) ||
    !basename(candidateRoot).startsWith(prefix)
  ) {
    throw new Error(
      `Refusing cleanup outside the harness-owned temporary root: ${String(candidateRoot)}`,
    );
  }

  return resolve(candidateRoot);
}

export function validateConsumerManifest(manifest) {
  if (
    !manifest ||
    manifest.private !== true ||
    typeof manifest.name !== "string"
  ) {
    throw new Error("Generated consumer manifest must be named and private");
  }

  for (const field of PACKAGE_DEPENDENCY_FIELDS) {
    for (const [packageName, specification] of Object.entries(
      manifest[field] ?? {},
    )) {
      if (typeof specification !== "string") {
        throw new Error(
          `${manifest.name} has a non-string ${field} for ${packageName}`,
        );
      }
      if (/^(?:workspace|link):/u.test(specification)) {
        throw new Error(
          `${manifest.name} must use packed tarballs, not a workspace/link dependency for ${packageName}`,
        );
      }
      if (
        PUBLIC_PACKAGES.includes(packageName) &&
        !specification.startsWith("file:")
      ) {
        throw new Error(
          `${manifest.name} must install ${packageName} from an exact file: tarball`,
        );
      }
    }
  }

  return manifest;
}

export function validateTarballInventory({
  expectedVersion,
  tarballs,
  temporaryRoot,
}) {
  if (!tarballs || typeof tarballs !== "object") {
    throw new Error("Tarball inventory is missing");
  }

  for (const packageName of PUBLIC_PACKAGES) {
    const tarballPath = tarballs[packageName];
    if (typeof tarballPath !== "string") {
      throw new Error(`Missing tarball for ${packageName}`);
    }
    if (!isPathWithin(tarballPath, temporaryRoot)) {
      throw new Error(`Tarball for ${packageName} escapes the temporary root`);
    }

    const expectedFilename = `${packageName
      .slice(1)
      .replace("/", "-")}-${expectedVersion}.tgz`;
    if (basename(tarballPath) !== expectedFilename) {
      throw new Error(
        `Unexpected tarball for ${packageName}: expected ${expectedFilename}, received ${basename(tarballPath)}`,
      );
    }
  }

  const unexpectedPackages = Object.keys(tarballs).filter(
    (packageName) => !PUBLIC_PACKAGES.includes(packageName),
  );
  if (unexpectedPackages.length > 0) {
    throw new Error(
      `Unexpected public-package tarballs: ${unexpectedPackages.join(", ")}`,
    );
  }

  return tarballs;
}

export function assertCommandSucceeded(result, commandLabel) {
  if (!result || result.status !== 0) {
    const status = result?.status ?? "missing";
    const output = [result?.stdout, result?.stderr].filter(Boolean).join("\n");
    throw new Error(
      `${commandLabel} failed with status ${status}${output ? `\n${output}` : ""}`,
    );
  }
  return result;
}

export function validateInstallResult(result) {
  assertCommandSucceeded(result, "npm install");
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const dependencyProblem =
    /\bERESOLVE\b|peer dependency|peerDependencies|invalid:|missing:|extraneous:|workspace:|link:/iu.exec(
      output,
    );
  if (dependencyProblem) {
    throw new Error(
      `npm install reported a peer/dependency problem: ${dependencyProblem[0]}`,
    );
  }
  return result;
}

export function assertResolvedInsideFixture({
  fixtureRoot,
  packageName,
  resolvedPath,
}) {
  const fixtureNodeModules = resolve(fixtureRoot, "node_modules");
  if (
    typeof resolvedPath !== "string" ||
    !isAbsolute(resolvedPath) ||
    !isPathWithin(resolvedPath, fixtureNodeModules)
  ) {
    throw new Error(
      `${packageName} resolved outside the fixture node_modules: ${String(resolvedPath)}`,
    );
  }
  return resolve(resolvedPath);
}

function collectManifestTargets(value, targets = []) {
  if (typeof value === "string" && value.startsWith("./")) {
    targets.push(value.slice(2));
  } else if (value && typeof value === "object") {
    for (const nested of Object.values(value))
      collectManifestTargets(nested, targets);
  }
  return targets;
}

function requireArtifact(entries, packageName, pattern, label) {
  if (!entries.some((entry) => pattern.test(entry))) {
    throw new Error(`${packageName} tarball is missing ${label}`);
  }
}

export function validatePackedArtifact({ contents, entries, packageName }) {
  const normalizedEntries = entries.filter((entry) => !entry.endsWith("/"));
  const allowedRootFiles = new Set([
    "package/LICENSE",
    "package/LICENSE.md",
    "package/README",
    "package/README.md",
    "package/package.json",
  ]);
  const allowedUiAssets =
    /^(?:grid|tailwind|tokens)\.css(?:\.d\.ts)?$|^themes\/(?:excel|material|pretable)\.css(?:\.d\.ts)?$/u;

  for (const entry of normalizedEntries) {
    const relativeEntry = entry.replace(/^package\//u, "");
    const allowed =
      allowedRootFiles.has(entry) ||
      entry.startsWith("package/dist/") ||
      (packageName === "@pretable/ui" && allowedUiAssets.test(relativeEntry));
    if (!allowed) {
      throw new Error(
        `${packageName} tarball contains undeclared file ${entry}`,
      );
    }
    if (/\/(?:src|test|tests|__tests__|node_modules)\//u.test(entry)) {
      throw new Error(
        `${packageName} tarball contains private source/test content: ${entry}`,
      );
    }
  }

  const manifestText = contents.get("package/package.json");
  if (!manifestText)
    throw new Error(`${packageName} tarball is missing package.json`);
  const manifest = JSON.parse(manifestText);
  if (manifest.name !== packageName) {
    throw new Error(
      `${packageName} tarball manifest names ${String(manifest.name)}`,
    );
  }
  validateConsumerManifest({ ...manifest, private: true });
  const targets = collectManifestTargets({
    exports: manifest.exports,
    main: manifest.main,
    module: manifest.module,
    types: manifest.types,
  });
  for (const target of targets) {
    if (!normalizedEntries.includes(`package/${target}`)) {
      throw new Error(
        `${packageName} manifest target does not exist: ${target}`,
      );
    }
  }

  requireArtifact(normalizedEntries, packageName, /\.mjs$/u, "an ESM artifact");
  requireArtifact(
    normalizedEntries,
    packageName,
    /\.cjs$/u,
    "a CommonJS artifact",
  );
  requireArtifact(
    normalizedEntries,
    packageName,
    /\.d\.mts$/u,
    "an ESM declaration",
  );
  requireArtifact(
    normalizedEntries,
    packageName,
    /\.d\.cts$/u,
    "a CommonJS declaration",
  );
  requireArtifact(
    normalizedEntries,
    packageName,
    /\.mjs\.map$/u,
    "an ESM source map",
  );
  requireArtifact(
    normalizedEntries,
    packageName,
    /\.cjs\.map$/u,
    "a CommonJS source map",
  );
  requireArtifact(
    normalizedEntries,
    packageName,
    /\.d\.mts\.map$/u,
    "an ESM declaration map",
  );
  requireArtifact(
    normalizedEntries,
    packageName,
    /\.d\.cts\.map$/u,
    "a CommonJS declaration map",
  );

  const codeEntries = normalizedEntries.filter((entry) =>
    /\.(?:[cm]?js|d\.[cm]?ts)$/u.test(entry),
  );
  const combinedCode = codeEntries
    .map((entry) => contents.get(entry) ?? "")
    .join("\n");
  if (combinedCode.includes("@pretable-internal/")) {
    throw new Error(`${packageName} leaks a private @pretable-internal import`);
  }

  const javascriptEntries = normalizedEntries.filter((entry) =>
    /\.(?:mjs|cjs)$/u.test(entry),
  );
  const builtinNames = new Set(
    builtinModules.flatMap((name) => [name, `node:${name}`]),
  );
  for (const entry of javascriptEntries) {
    const source = contents.get(entry) ?? "";
    parse(source, {
      allowHashBang: true,
      ecmaVersion: 2018,
      sourceType: entry.endsWith(".mjs") ? "module" : "script",
    });
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/gu,
    )) {
      if (builtinNames.has(match[1])) {
        throw new Error(
          `${packageName} browser artifact ${entry} imports Node builtin ${match[1]}`,
        );
      }
    }
  }

  for (const entry of normalizedEntries.filter((candidate) =>
    candidate.endsWith(".map"),
  )) {
    const sourceMap = JSON.parse(contents.get(entry) ?? "null");
    if (!Array.isArray(sourceMap?.sources) || sourceMap.sources.length === 0) {
      throw new Error(`${packageName} has an invalid source map: ${entry}`);
    }
    if (
      /\.(?:mjs|cjs)\.map$/u.test(entry) &&
      !Array.isArray(sourceMap.sourcesContent)
    ) {
      throw new Error(
        `${packageName} JavaScript source map omits sourcesContent: ${entry}`,
      );
    }
  }

  if (packageName === "@pretable/react") {
    for (const external of ["react", "@pretable/core"]) {
      if (!combinedCode.includes(external)) {
        throw new Error(
          `@pretable/react no longer preserves external boundary ${external}`,
        );
      }
    }
  } else if (packageName === "@pretable/stream-adapter") {
    if (!combinedCode.includes("@cacheplane/json-stream")) {
      throw new Error(
        "@pretable/stream-adapter no longer preserves its json-stream boundary",
      );
    }
  } else if (
    combinedCode.includes('"react"') ||
    combinedCode.includes("'react'")
  ) {
    throw new Error(
      `${packageName} unexpectedly contains a React runtime boundary`,
    );
  }

  return {
    manifest,
    runtimeApis: BROWSER_RUNTIME_INVENTORY.filter((api) =>
      combinedCode.includes(api),
    ),
  };
}

export function createConsumerManifests({ tarballs }) {
  const fileDependencies = Object.fromEntries(
    PUBLIC_PACKAGES.map((packageName) => [
      packageName,
      `file:${tarballs[packageName]}`,
    ]),
  );
  const full = validateConsumerManifest({
    dependencies: {
      ...fileDependencies,
      react: FULL_CONSUMER_VERSIONS.react,
      "react-dom": FULL_CONSUMER_VERSIONS["react-dom"],
    },
    devDependencies: {
      "@types/react": FULL_CONSUMER_VERSIONS["@types/react"],
      "@types/react-dom": FULL_CONSUMER_VERSIONS["@types/react-dom"],
      typescript: FULL_CONSUMER_VERSIONS.typescript,
      vite: FULL_CONSUMER_VERSIONS.vite,
      webpack: FULL_CONSUMER_VERSIONS.webpack,
      "webpack-cli": FULL_CONSUMER_VERSIONS["webpack-cli"],
    },
    name: "pretable-packed-full-consumer",
    private: true,
    type: "module",
  });
  const frameworkNeutral = validateConsumerManifest({
    dependencies: {
      "@cacheplane/json-stream": "0.0.4",
      "@pretable/core": fileDependencies["@pretable/core"],
      "@pretable/stream-adapter": fileDependencies["@pretable/stream-adapter"],
      "@pretable/ui": fileDependencies["@pretable/ui"],
    },
    name: "pretable-packed-framework-neutral-consumer",
    private: true,
    type: "module",
  });

  return { frameworkNeutral, full };
}

export function createConsumerCommandPlan({ frameworkNeutralRoot, fullRoot }) {
  return [
    {
      args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      command: "npm",
      cwd: fullRoot,
      install: true,
    },
    { args: ["ls", "--all"], command: "npm", cwd: fullRoot, install: true },
    {
      args: ["node/esm.mjs"],
      command: "node",
      cwd: fullRoot,
      outputKey: "esm",
    },
    {
      args: ["node/cjs.cjs"],
      command: "node",
      cwd: fullRoot,
      outputKey: "cjs",
    },
    {
      args: ["--no-install", "tsc", "-p", "types/tsconfig.nodenext.json"],
      command: "npx",
      cwd: fullRoot,
    },
    {
      args: ["--no-install", "tsc", "-p", "types/tsconfig.legacy.json"],
      command: "npx",
      cwd: fullRoot,
    },
    {
      args: [
        "--no-install",
        "vite",
        "build",
        "--config",
        "vite/vite.config.mjs",
      ],
      command: "npx",
      cwd: fullRoot,
    },
    {
      args: [
        "--no-install",
        "webpack",
        "--config",
        "webpack/webpack.esm.config.cjs",
      ],
      command: "npx",
      cwd: fullRoot,
    },
    {
      args: [
        "--no-install",
        "webpack",
        "--config",
        "webpack/webpack.cjs.config.cjs",
      ],
      command: "npx",
      cwd: fullRoot,
    },
    {
      args: [
        "--no-install",
        "vite",
        "build",
        "--config",
        "tree-shaking/vite.config.mjs",
      ],
      command: "npx",
      cwd: fullRoot,
    },
    { args: ["css/check-css.mjs"], command: "node", cwd: fullRoot },
    { args: ["deep-import/reject.mjs"], command: "node", cwd: fullRoot },
    {
      args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
      command: "npm",
      cwd: frameworkNeutralRoot,
      install: true,
    },
    {
      args: ["ls", "--all"],
      command: "npm",
      cwd: frameworkNeutralRoot,
      install: true,
    },
    {
      args: ["framework-neutral/esm.mjs"],
      command: "node",
      cwd: frameworkNeutralRoot,
    },
    {
      args: ["framework-neutral/cjs.cjs"],
      command: "node",
      cwd: frameworkNeutralRoot,
    },
  ];
}

function runCommand({ args, command, cwd, environment = process.env }) {
  const { NODE_PATH: _discardedNodePath, ...cleanEnvironment } = environment;
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: cleanEnvironment,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function readPublicPackageVersion(repositoryRoot) {
  const versions = await Promise.all(
    PUBLIC_PACKAGES.map(async (packageName) => {
      const directory = packageName.split("/")[1];
      const manifest = JSON.parse(
        await readFile(
          join(repositoryRoot, "packages", directory, "package.json"),
          "utf8",
        ),
      );
      if (
        manifest.name !== packageName ||
        typeof manifest.version !== "string"
      ) {
        throw new Error(`Invalid public package manifest for ${packageName}`);
      }
      return manifest.version;
    }),
  );
  const uniqueVersions = new Set(versions);
  if (uniqueVersions.size !== 1) {
    throw new Error(
      `Public package versions must remain fixed as a group: ${versions.join(", ")}`,
    );
  }
  return versions[0];
}

async function packPublicPackages({ repositoryRoot, tarballRoot }) {
  await mkdir(tarballRoot, { recursive: true });
  for (const packageName of PUBLIC_PACKAGES) {
    const result = runCommand({
      args: [
        "--filter",
        packageName,
        "pack",
        "--pack-destination",
        tarballRoot,
      ],
      command: "pnpm",
      cwd: repositoryRoot,
    });
    assertCommandSucceeded(result, `pnpm --filter ${packageName} pack`);
  }

  const tarballNames = (await readdir(tarballRoot)).filter((name) =>
    name.endsWith(".tgz"),
  );
  return Object.fromEntries(
    PUBLIC_PACKAGES.map((packageName) => {
      const prefix = `${packageName.slice(1).replace("/", "-")}-`;
      const matches = tarballNames.filter((name) => name.startsWith(prefix));
      if (matches.length !== 1) {
        throw new Error(
          `Expected one tarball for ${packageName}, received ${matches.length}`,
        );
      }
      return [packageName, join(tarballRoot, matches[0])];
    }),
  );
}

async function verifyTarballFilesExist(tarballs) {
  await Promise.all(Object.values(tarballs).map((tarball) => access(tarball)));
}

function listTarballEntries(tarballPath) {
  const result = runCommand({
    args: ["-tzf", tarballPath],
    command: "tar",
    cwd: dirname(tarballPath),
  });
  assertCommandSucceeded(result, `tar -tzf ${basename(tarballPath)}`);
  return result.stdout
    .trim()
    .split("\n")
    .map((entry) => entry.replace(/^\.\//u, ""))
    .filter(Boolean);
}

function readTarballEntry(tarballPath, entry) {
  const result = runCommand({
    args: ["-xOzf", tarballPath, entry],
    command: "tar",
    cwd: dirname(tarballPath),
  });
  assertCommandSucceeded(result, `read ${entry} from ${basename(tarballPath)}`);
  return result.stdout;
}

async function inspectPackedArtifacts(tarballs) {
  for (const packageName of PUBLIC_PACKAGES) {
    inspectPackedArtifactTarball({
      packageName,
      tarballPath: tarballs[packageName],
    });
  }
}

export function inspectPackedArtifactTarball({ packageName, tarballPath }) {
  const entries = listTarballEntries(tarballPath);
  const contents = new Map(
    entries
      .filter((entry) =>
        /(?:package\.json|\.(?:[cm]?js|[cm]?ts|map))$/u.test(entry),
      )
      .map((entry) => [entry, readTarballEntry(tarballPath, entry)]),
  );
  return validatePackedArtifact({ contents, entries, packageName });
}

async function writeManifest(directory, manifest) {
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function createConsumerDirectories({ manifests, temporaryRoot }) {
  const fullRoot = join(temporaryRoot, "full-consumer");
  const frameworkNeutralRoot = join(
    temporaryRoot,
    "framework-neutral-consumer",
  );
  await Promise.all([
    cp(FIXTURE_SOURCE_ROOT, fullRoot, { recursive: true }),
    cp(FIXTURE_SOURCE_ROOT, frameworkNeutralRoot, { recursive: true }),
  ]);
  await Promise.all([
    writeManifest(fullRoot, manifests.full),
    writeManifest(frameworkNeutralRoot, manifests.frameworkNeutral),
  ]);
  return { frameworkNeutralRoot, fullRoot };
}

async function assertPackageResolutions({ fixtureRoot, packageNames }) {
  const source = `const names=${JSON.stringify(packageNames)};for(const name of names)console.log(JSON.stringify([name,require.resolve(name)]));`;
  const result = runCommand({
    args: ["-e", source],
    command: "node",
    cwd: fixtureRoot,
  });
  assertCommandSucceeded(result, "resolve installed package entries");
  for (const line of result.stdout.trim().split("\n")) {
    const [packageName, resolvedPath] = JSON.parse(line);
    const canonicalPath = await realpath(resolvedPath);
    assertResolvedInsideFixture({
      fixtureRoot,
      packageName,
      resolvedPath: canonicalPath,
    });
  }
}

async function executeConsumerPlan({ frameworkNeutralRoot, fullRoot }) {
  const outputs = new Map();
  const plan = createConsumerCommandPlan({ frameworkNeutralRoot, fullRoot });
  for (const step of plan) {
    const cacheRoot = join(step.cwd, ".npm-cache");
    await mkdir(cacheRoot, { recursive: true });
    const result = runCommand({
      ...step,
      environment: { ...process.env, npm_config_cache: cacheRoot },
    });
    if (step.install) validateInstallResult(result);
    else
      assertCommandSucceeded(result, `${step.command} ${step.args.join(" ")}`);
    if (step.outputKey) outputs.set(step.outputKey, result.stdout.trim());
  }
  if (outputs.get("esm") !== outputs.get("cjs")) {
    throw new Error(
      "Public ESM and CommonJS runtime export inventories differ",
    );
  }
  const treeShakenBundle = join(
    fullRoot,
    "tree-shaking",
    "dist",
    "tree-shaking.mjs",
  );
  const [bundleSource, bundleStats] = await Promise.all([
    readFile(treeShakenBundle, "utf8"),
    stat(treeShakenBundle),
  ]);
  if (
    bundleStats.size >= 50_000 ||
    bundleSource.includes("PretableDisposedModelError")
  ) {
    throw new Error(
      `Tiny @pretable/core import did not tree-shake (${bundleStats.size} byte bundle)`,
    );
  }
}

export async function runPackedConsumerCheck({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  systemTempRoot = tmpdir(),
} = {}) {
  const temporaryRoot = await mkdtemp(
    join(systemTempRoot, TEMPORARY_ROOT_PREFIX),
  );
  assertSafeTemporaryRoot({ candidateRoot: temporaryRoot, systemTempRoot });
  try {
    const expectedVersion = await readPublicPackageVersion(repositoryRoot);
    const tarballs = await packPublicPackages({
      repositoryRoot,
      tarballRoot: join(temporaryRoot, "tarballs"),
    });
    validateTarballInventory({ expectedVersion, tarballs, temporaryRoot });
    await verifyTarballFilesExist(tarballs);
    await inspectPackedArtifacts(tarballs);
    const manifests = createConsumerManifests({ tarballs });
    const directories = await createConsumerDirectories({
      manifests,
      temporaryRoot,
    });
    await executeConsumerPlan(directories);
    await assertPackageResolutions({
      fixtureRoot: directories.fullRoot,
      packageNames: PUBLIC_PACKAGES,
    });
    await assertPackageResolutions({
      fixtureRoot: directories.frameworkNeutralRoot,
      packageNames: PUBLIC_PACKAGES.filter(
        (name) => name !== "@pretable/react",
      ),
    });
  } finally {
    const cleanupRoot = assertSafeTemporaryRoot({
      candidateRoot: temporaryRoot,
      systemTempRoot,
    });
    await rm(cleanupRoot, { force: true, recursive: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runPackedConsumerCheck().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
