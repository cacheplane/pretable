import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

import semver from "semver";

const DEPENDENCY_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
const DEFAULT_REGISTRY_TIMEOUT_MS = 10_000;
const PRETABLE_SCOPE = "@pretable/";

function registryFromEnvironment() {
  return (
    process.env.NPM_CONFIG_REGISTRY ??
    process.env.npm_config_registry ??
    "https://registry.npmjs.org"
  );
}

async function packageDirectories(rootDir, workspaceDirectory) {
  const directory = join(rootDir, workspaceDirectory);

  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function discoverWorkspacePackages(rootDir) {
  const directories = (
    await Promise.all(
      ["apps", "packages"].map((directory) =>
        packageDirectories(rootDir, directory),
      ),
    )
  ).flat();

  const workspacePackages = await Promise.all(
    directories.map(async (directory) => {
      const manifestPath = join(directory, "package.json");
      let manifest;

      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      } catch (error) {
        if (error?.code === "ENOENT") {
          return null;
        }
        throw new Error(
          `Unable to read workspace package manifest ${manifestPath}: ${error.message}`,
          { cause: error },
        );
      }

      return { directory, manifest, manifestPath };
    }),
  );

  return workspacePackages.filter((workspacePackage) => workspacePackage);
}

export function normalizeDependencySpec(spec, localPackage) {
  if (typeof spec !== "string") {
    throw new Error(`Unsupported non-string dependency specification ${spec}`);
  }

  if (spec.startsWith("workspace:")) {
    const localVersion =
      localPackage?.manifest?.version ?? localPackage?.version;
    if (!localVersion) {
      throw new Error(
        `Workspace specification ${spec} requires a matching local package`,
      );
    }
    if (!semver.valid(localVersion)) {
      throw new Error(
        `Workspace specification ${spec} resolves to invalid local version ${localVersion}`,
      );
    }

    const workspaceRange = spec.slice("workspace:".length);
    if (workspaceRange === "*") {
      return localVersion;
    }
    if (workspaceRange === "^" || workspaceRange === "~") {
      return `${workspaceRange}${localVersion}`;
    }

    throw new Error(`Unsupported workspace protocol specification ${spec}`);
  }

  if (semver.validRange(spec) !== null) {
    return spec;
  }

  throw new Error(`Unsupported dependency protocol or specification ${spec}`);
}

function validatePublishablePackage(workspacePackage) {
  const { name, version } = workspacePackage.manifest;
  if (typeof name !== "string" || !name) {
    throw new Error(
      `Publishable workspace package ${workspacePackage.manifestPath} has no valid name`,
    );
  }
  if (!semver.valid(version)) {
    throw new Error(
      `Publishable workspace package ${name} has invalid version ${String(version)}`,
    );
  }
}

function assertUniqueWorkspacePackageNames(workspacePackages) {
  const packagesByName = new Map();

  for (const workspacePackage of workspacePackages) {
    const { name } = workspacePackage.manifest;
    if (typeof name !== "string") {
      continue;
    }

    const matchingPackages = packagesByName.get(name) ?? [];
    matchingPackages.push(workspacePackage);
    packagesByName.set(name, matchingPackages);
  }

  const duplicates = [...packagesByName.entries()].filter(
    ([, matchingPackages]) => matchingPackages.length > 1,
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate workspace package names:\n${duplicates
        .map(
          ([name, matchingPackages]) =>
            `- ${name}: ${matchingPackages.map(({ manifestPath }) => manifestPath).join(", ")}`,
        )
        .join("\n")}`,
    );
  }
}

function validateDependencyFields(workspacePackage) {
  const { manifest, manifestPath } = workspacePackage;

  for (const field of DEPENDENCY_FIELDS) {
    const dependencies = manifest[field];
    if (dependencies === undefined) {
      continue;
    }
    if (
      dependencies === null ||
      typeof dependencies !== "object" ||
      Array.isArray(dependencies) ||
      Object.getPrototypeOf(dependencies) !== Object.prototype
    ) {
      throw new Error(
        `Workspace package ${String(manifest.name)} has invalid ${field} in ${manifestPath}: expected a plain object`,
      );
    }
  }
}

function registryPackageUrl(registryUrl, packageName) {
  const baseUrl = registryUrl.endsWith("/") ? registryUrl : `${registryUrl}/`;
  return new URL(encodeURIComponent(packageName), baseUrl);
}

async function readRegistryVersions(
  packageName,
  registryUrl,
  fetchImpl,
  registryTimeoutMs,
) {
  const signal = AbortSignal.timeout(registryTimeoutMs);
  let response;

  try {
    response = await fetchImpl(registryPackageUrl(registryUrl, packageName), {
      signal,
    });
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Registry request timed out for ${packageName}`, {
        cause: error,
      });
    }
    throw new Error(
      `Registry request failed for ${packageName}: ${error.message}`,
      { cause: error },
    );
  }

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(
      `Registry request failed for ${packageName}: HTTP ${response.status} ${response.statusText}`,
    );
  }

  let metadata;
  try {
    metadata = await response.json();
  } catch (error) {
    if (signal.aborted) {
      throw new Error(`Registry request timed out for ${packageName}`, {
        cause: error,
      });
    }
    throw new Error(
      `Registry metadata was invalid for ${packageName}: ${error.message}`,
      { cause: error },
    );
  }

  if (
    !metadata ||
    typeof metadata !== "object" ||
    !metadata.versions ||
    typeof metadata.versions !== "object" ||
    Array.isArray(metadata.versions)
  ) {
    throw new Error(
      `Registry metadata was invalid for ${packageName}: expected a versions object`,
    );
  }

  return Object.keys(metadata.versions);
}

function dependencyEdges(workspacePackage) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(workspacePackage.manifest[field] ?? {}).map(
      ([dependencyName, rawSpec]) => ({ dependencyName, field, rawSpec }),
    ),
  ).filter(({ dependencyName }) => dependencyName.startsWith(PRETABLE_SCOPE));
}

export async function runPublishPreflight(options = {}) {
  const rootDir = resolve(options.rootDir ?? process.cwd());
  const registryUrl = options.registryUrl ?? registryFromEnvironment();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const registryTimeoutMs =
    options.registryTimeoutMs ?? DEFAULT_REGISTRY_TIMEOUT_MS;
  if (!Number.isInteger(registryTimeoutMs) || registryTimeoutMs < 1) {
    throw new Error("registryTimeoutMs must be a positive integer");
  }
  const workspacePackages = await discoverWorkspacePackages(rootDir);
  assertUniqueWorkspacePackageNames(workspacePackages);
  const localPackages = new Map(
    workspacePackages
      .filter(({ manifest }) => typeof manifest.name === "string")
      .map((workspacePackage) => [
        workspacePackage.manifest.name,
        workspacePackage,
      ]),
  );
  const publicPackages = workspacePackages.filter(
    ({ manifest }) => manifest.private !== true,
  );

  for (const workspacePackage of publicPackages) {
    validatePublishablePackage(workspacePackage);
    validateDependencyFields(workspacePackage);
  }

  const registryCache = new Map();
  const registryVersions = (packageName) => {
    if (!registryCache.has(packageName)) {
      registryCache.set(
        packageName,
        readRegistryVersions(
          packageName,
          registryUrl,
          fetchImpl,
          registryTimeoutMs,
        ),
      );
    }
    return registryCache.get(packageName);
  };

  const sameBatchPackages = new Set();
  for (const workspacePackage of publicPackages) {
    const { name, version } = workspacePackage.manifest;
    const publishedVersions = await registryVersions(name);
    if (!publishedVersions.includes(version)) {
      sameBatchPackages.add(`${name}@${version}`);
    }
  }

  const violations = [];
  let checkedEdgeCount = 0;
  let registrySatisfiedEdgeCount = 0;
  let sameBatchEdgeCount = 0;

  for (const workspacePackage of publicPackages) {
    const dependentName = workspacePackage.manifest.name;

    for (const { dependencyName, field, rawSpec } of dependencyEdges(
      workspacePackage,
    )) {
      checkedEdgeCount += 1;
      const localPackage = localPackages.get(dependencyName);

      if (localPackage?.manifest.private === true) {
        violations.push(
          `${dependentName} has private local ${field} ${dependencyName} with specification ${String(rawSpec)}`,
        );
        continue;
      }

      let normalizedSpec;
      try {
        normalizedSpec = normalizeDependencySpec(rawSpec, localPackage);
      } catch (error) {
        violations.push(
          `${dependentName} has unsupported ${field} ${dependencyName} specification ${String(rawSpec)}: ${error.message}`,
        );
        continue;
      }

      const publishedVersions = await registryVersions(dependencyName);
      if (
        publishedVersions.some((version) =>
          semver.satisfies(version, normalizedSpec),
        )
      ) {
        registrySatisfiedEdgeCount += 1;
        continue;
      }

      const localVersion = localPackage?.manifest.version;
      if (
        localVersion &&
        sameBatchPackages.has(`${dependencyName}@${localVersion}`) &&
        semver.satisfies(localVersion, normalizedSpec)
      ) {
        sameBatchEdgeCount += 1;
        continue;
      }

      violations.push(
        `${dependentName} ${field} ${dependencyName} specification ${String(rawSpec)} is unavailable from the registry or this publish batch`,
      );
    }
  }

  if (violations.length > 0) {
    throw new Error(
      `Publish dependency preflight failed:\n${violations.map((violation) => `- ${violation}`).join("\n")}`,
    );
  }

  return {
    checkedEdgeCount,
    publicPackageCount: publicPackages.length,
    registrySatisfiedEdgeCount,
    sameBatchEdgeCount,
    sameBatchPackageCount: sameBatchPackages.size,
  };
}

async function runCli() {
  try {
    const result = await runPublishPreflight();
    console.log(
      `Publish preflight passed: ${result.publicPackageCount} public packages, ${result.checkedEdgeCount} dependency edges (${result.registrySatisfiedEdgeCount} registry, ${result.sameBatchEdgeCount} same batch)`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await runCli();
}
