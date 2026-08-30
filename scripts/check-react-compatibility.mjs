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
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
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

import {
  PUBLIC_PACKAGES,
  assertCommandSucceeded,
  assertResolvedInsideFixture,
  assertSafeTemporaryRoot,
  validateConsumerManifest,
  validateInstallResult,
  validateManifestSnapshot,
} from "./check-packed-consumers.mjs";

const TEMPORARY_ROOT_PREFIX = "pretable-react-compat-";
const TYPESCRIPT_VERSION = "6.0.3";
const JSDOM_VERSION = "30.0.1";
const REACT_17_VERSION = "17.0.2";
const EXACT_VERSION = /^\d+\.\d+\.\d+$/u;

export const REACT_COMPATIBILITY_MATRIX = Object.freeze([
  Object.freeze({
    id: "react-18-floor",
    react: "18.0.0",
    reactDom: "18.0.0",
    typesReact: "18.0.0",
    typesReactDom: "18.0.0",
  }),
  Object.freeze({
    id: "react-18-current",
    react: "18.3.1",
    reactDom: "18.3.1",
    typesReact: "18.3.31",
    typesReactDom: "18.3.7",
  }),
  Object.freeze({
    id: "react-19-current",
    react: "19.2.8",
    reactDom: "19.2.8",
    typesReact: "19.2.18",
    typesReactDom: "19.2.5",
  }),
]);

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const FIXTURE_SOURCE_ROOT = join(
  DEFAULT_REPOSITORY_ROOT,
  "test-fixtures",
  "react-compatibility",
);

function isPathWithin(candidatePath, parentPath) {
  const child = relative(resolve(parentPath), resolve(candidatePath));
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`);
}

function publicPackageDirectory(packageName) {
  return packageName.slice("@pretable/".length);
}

function runCommand({ args, command, cwd, environment = process.env }) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function validateExactReactRow(row) {
  if (!row || typeof row.id !== "string") {
    throw new Error("React compatibility row must have an id");
  }
  for (const field of ["react", "reactDom", "typesReact", "typesReactDom"]) {
    if (!EXACT_VERSION.test(row[field] ?? "")) {
      throw new Error(`${row.id} must use an exact ${field} version`);
    }
  }
  if (row.react !== row.reactDom) {
    throw new Error(
      `${row.id} must pair identical React and React DOM versions`,
    );
  }
  const runtimeMajor = row.react.split(".")[0];
  if (
    row.typesReact.split(".")[0] !== runtimeMajor ||
    row.typesReactDom.split(".")[0] !== runtimeMajor
  ) {
    throw new Error(
      `${row.id} must pair React ${runtimeMajor} runtime and type packages`,
    );
  }
  return row;
}

export function validateReactTarballs({ tarballs, temporaryRoot, version }) {
  for (const packageName of PUBLIC_PACKAGES) {
    const tarball = tarballs?.[packageName];
    const expectedPrefix = `${packageName.slice(1).replace("/", "-")}-${version}`;
    if (
      typeof tarball !== "string" ||
      !isAbsolute(tarball) ||
      !isPathWithin(tarball, temporaryRoot) ||
      !basename(tarball).startsWith(expectedPrefix) ||
      !tarball.endsWith(".tgz")
    ) {
      throw new Error(
        `${packageName} tarball is outside the compatibility temporary root`,
      );
    }
  }
  return tarballs;
}

export function createReactCompatibilityManifest({ row, tarballs }) {
  validateExactReactRow(row);
  const manifest = {
    name: `pretable-${row.id}`,
    private: true,
    type: "module",
    dependencies: {
      ...Object.fromEntries(
        PUBLIC_PACKAGES.map((packageName) => [
          packageName,
          `file:${tarballs[packageName]}`,
        ]),
      ),
      react: row.react,
      "react-dom": row.reactDom,
    },
    devDependencies: {
      "@types/react": row.typesReact,
      "@types/react-dom": row.typesReactDom,
      ...(row.react.startsWith("18.") ? { "@types/scheduler": "0.16.8" } : {}),
      jsdom: JSDOM_VERSION,
      typescript: TYPESCRIPT_VERSION,
    },
  };
  return validateConsumerManifest(manifest);
}

export function validateHydrationEvidence(evidence) {
  if (
    typeof evidence?.serverMarkup !== "string" ||
    evidence.serverMarkup.length === 0
  ) {
    throw new Error("SSR must produce nonempty expected markup");
  }
  if (
    !Array.isArray(evidence.recoverableErrors) ||
    evidence.recoverableErrors.length > 0
  ) {
    throw new Error("Hydration reported a recoverable hydration error");
  }
  if (
    !Array.isArray(evidence.unexpectedErrors) ||
    evidence.unexpectedErrors.length > 0
  ) {
    throw new Error("Hydration reported an unexpected error");
  }
  if (evidence.beforeInteraction !== "0" || evidence.afterInteraction !== "1") {
    throw new Error("Hydrated interaction did not update from 0 to 1");
  }
  if (evidence.containerEmptyAfterUnmount !== true) {
    throw new Error("Hydration root did not cleanly unmount");
  }
  return evidence;
}

export function validateReact17Rejection(result) {
  const output = `${result?.stdout ?? ""}\n${result?.stderr ?? ""}`;
  if (
    result?.status === 0 ||
    !/ERESOLVE|peer dependency|unable to resolve dependency tree/iu.test(
      output,
    ) ||
    !/react(?:@|\s).*17\.0\.2|Found:\s*react@17\.0\.2/iu.test(output)
  ) {
    throw new Error(`React 17 must fail only at the peer contract\n${output}`);
  }
}

async function readPublicManifestSources(repositoryRoot) {
  return Object.fromEntries(
    await Promise.all(
      PUBLIC_PACKAGES.map(async (packageName) => [
        packageName,
        await readFile(
          join(
            repositoryRoot,
            "packages",
            publicPackageDirectory(packageName),
            "package.json",
          ),
          "utf8",
        ),
      ]),
    ),
  );
}

async function buildPublicPackages(repositoryRoot) {
  const baseline = await readPublicManifestSources(repositoryRoot);
  for (const packageName of PUBLIC_PACKAGES) {
    const result = runCommand({
      args: ["--filter", packageName, "build"],
      command: "pnpm",
      cwd: repositoryRoot,
    });
    assertCommandSucceeded(result, `pnpm --filter ${packageName} build`);
    validateManifestSnapshot({
      after: await readPublicManifestSources(repositoryRoot),
      before: baseline,
      buildPackageName: packageName,
    });
  }
}

async function readPublicPackageVersion(repositoryRoot) {
  const manifests = await readPublicManifestSources(repositoryRoot);
  const versions = PUBLIC_PACKAGES.map(
    (packageName) => JSON.parse(manifests[packageName]).version,
  );
  if (versions.some((version) => version !== versions[0])) {
    throw new Error(`Public package versions differ: ${versions.join(", ")}`);
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
  const names = (await readdir(tarballRoot)).filter((name) =>
    name.endsWith(".tgz"),
  );
  return Object.fromEntries(
    PUBLIC_PACKAGES.map((packageName) => {
      const prefix = `${packageName.slice(1).replace("/", "-")}-`;
      const matches = names.filter((name) => name.startsWith(prefix));
      if (matches.length !== 1) {
        throw new Error(
          `Expected one ${packageName} tarball, received ${matches.length}`,
        );
      }
      return [packageName, join(tarballRoot, matches[0])];
    }),
  );
}

async function writeManifest(directory, manifest) {
  await writeFile(
    join(directory, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function assertLocalResolutions(fixtureRoot) {
  const canonicalRoot = await realpath(fixtureRoot);
  for (const packageName of [...PUBLIC_PACKAGES, "react", "react-dom"]) {
    const result = runCommand({
      args: [
        "-e",
        `console.log(require.resolve(${JSON.stringify(packageName)}))`,
      ],
      command: "node",
      cwd: fixtureRoot,
    });
    assertCommandSucceeded(
      result,
      `resolve ${packageName} in ${basename(fixtureRoot)}`,
    );
    assertResolvedInsideFixture({
      fixtureRoot: canonicalRoot,
      packageName,
      resolvedPath: await realpath(result.stdout.trim()),
    });
  }
}

async function runCompatibilityRow({ row, tarballs, temporaryRoot }) {
  const fixtureRoot = join(temporaryRoot, row.id);
  await cp(FIXTURE_SOURCE_ROOT, fixtureRoot, { recursive: true });
  await writeManifest(
    fixtureRoot,
    createReactCompatibilityManifest({ row, tarballs }),
  );
  const environment = {
    ...process.env,
    npm_config_cache: join(fixtureRoot, ".npm-cache"),
  };
  const install = runCommand({
    args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    command: "npm",
    cwd: fixtureRoot,
    environment,
  });
  validateInstallResult(install);
  const list = runCommand({
    args: ["ls", "--all"],
    command: "npm",
    cwd: fixtureRoot,
    environment,
  });
  assertCommandSucceeded(list, `npm ls for ${row.id}`);
  for (const config of ["tsconfig.nodenext.json", "tsconfig.legacy.json"]) {
    const result = runCommand({
      args: ["--no-install", "tsc", "-p", config],
      command: "npx",
      cwd: fixtureRoot,
      environment,
    });
    assertCommandSucceeded(result, `${row.id} TypeScript ${config}`);
  }
  const runtime = runCommand({
    args: ["runtime.mjs"],
    command: "node",
    cwd: fixtureRoot,
    environment,
  });
  assertCommandSucceeded(runtime, `${row.id} SSR/hydration runtime`);
  const lastLine = runtime.stdout.trim().split("\n").at(-1);
  let evidence;
  try {
    evidence = JSON.parse(lastLine);
  } catch {
    throw new Error(`${row.id} did not emit hydration JSON\n${runtime.stdout}`);
  }
  validateHydrationEvidence(evidence);
  await assertLocalResolutions(fixtureRoot);
}

async function runReact17NegativeControl({ tarballs, temporaryRoot }) {
  const fixtureRoot = join(temporaryRoot, "react-17-negative");
  await mkdir(fixtureRoot, { recursive: true });
  const manifest = validateConsumerManifest({
    name: "pretable-react-17-negative",
    private: true,
    dependencies: {
      ...Object.fromEntries(
        PUBLIC_PACKAGES.map((packageName) => [
          packageName,
          `file:${tarballs[packageName]}`,
        ]),
      ),
      react: REACT_17_VERSION,
      "react-dom": REACT_17_VERSION,
    },
  });
  await writeManifest(fixtureRoot, manifest);
  const result = runCommand({
    args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"],
    command: "npm",
    cwd: fixtureRoot,
    environment: {
      ...process.env,
      npm_config_cache: join(fixtureRoot, ".npm-cache"),
    },
  });
  validateReact17Rejection(result);
}

export async function runReactCompatibilityCheck({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  systemTempRoot = tmpdir(),
} = {}) {
  for (const row of REACT_COMPATIBILITY_MATRIX) validateExactReactRow(row);
  const temporaryRoot = await mkdtemp(
    join(systemTempRoot, TEMPORARY_ROOT_PREFIX),
  );
  assertSafeTemporaryRoot({
    candidateRoot: temporaryRoot,
    prefix: TEMPORARY_ROOT_PREFIX,
    systemTempRoot,
  });
  try {
    await buildPublicPackages(repositoryRoot);
    const version = await readPublicPackageVersion(repositoryRoot);
    const tarballs = await packPublicPackages({
      repositoryRoot,
      tarballRoot: join(temporaryRoot, "tarballs"),
    });
    validateReactTarballs({ tarballs, temporaryRoot, version });
    await Promise.all(
      Object.values(tarballs).map((tarball) => access(tarball)),
    );
    for (const row of REACT_COMPATIBILITY_MATRIX) {
      await runCompatibilityRow({ row, tarballs, temporaryRoot });
    }
    await runReact17NegativeControl({ tarballs, temporaryRoot });
  } finally {
    const cleanupRoot = assertSafeTemporaryRoot({
      candidateRoot: temporaryRoot,
      prefix: TEMPORARY_ROOT_PREFIX,
      systemTempRoot,
    });
    await rm(cleanupRoot, { force: true, recursive: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  runReactCompatibilityCheck().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
