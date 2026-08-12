import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPublishPreflight } from "../publish-preflight.mjs";

function versionMap(versions, value) {
  return Object.fromEntries(versions.map((version) => [version, value]));
}

function registryMetadata(result) {
  if (Array.isArray(result)) {
    return { versions: versionMap(result, {}) };
  }

  const metadata = {
    versions: versionMap(result.versions ?? [], {}),
  };
  if (Object.hasOwn(result, "time")) {
    metadata.time = Array.isArray(result.time)
      ? versionMap(result.time, "2026-08-10T00:00:00.000Z")
      : result.time;
  }
  return metadata;
}

async function createFixture(t, { apps = [], packages, registry = {} }) {
  const rootDir = await mkdtemp(join(tmpdir(), "pretable-publish-preflight-"));
  t.after(() => rm(rootDir, { force: true, recursive: true }));

  await Promise.all(
    [
      ...apps.map((manifest, index) => ({
        directory: join(rootDir, "apps", `app-${index}`),
        manifest,
      })),
      ...packages.map((manifest, index) => ({
        directory: join(rootDir, "packages", `package-${index}`),
        manifest,
      })),
    ].map(async ({ directory, manifest }) => {
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "package.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }),
  );

  const server = createServer((request, response) => {
    const packageName = decodeURIComponent(
      (request.url ?? "/").slice(1).split("?")[0],
    );
    const result = registry[packageName];

    if (result === "hang") {
      return;
    }

    if (result === "error") {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "fixture registry error" }));
      return;
    }

    if (!result) {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(registryMetadata(result)));
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(
    () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    rootDir,
    registryUrl: `http://127.0.0.1:${address.port}`,
  };
}

function publicPackage(name, version, fields = {}) {
  return { name, version, ...fields };
}

test("rejects duplicate local package names before resolving workspace dependencies", async (t) => {
  const duplicateName = "@pretable/duplicate";
  const { rootDir, registryUrl } = await createFixture(t, {
    apps: [publicPackage(duplicateName, "1.0.0")],
    packages: [
      {
        name: duplicateName,
        version: "1.0.0",
        private: true,
      },
    ],
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /duplicate/i);
      assert.match(error.message, /@pretable\/duplicate/);
      assert.match(error.message, /apps\/app-0\/package\.json/);
      assert.match(error.message, /packages\/package-0\/package\.json/);
      return true;
    },
  );
});

test("times out a hanging registry request with package context", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [publicPackage("@pretable/react", "0.0.2")],
    registry: { "@pretable/react": "hang" },
  });
  const watchdogSignal = AbortSignal.timeout(500);
  const watchdog = new Promise((_, reject) => {
    watchdogSignal.addEventListener(
      "abort",
      () => reject(new Error("Test watchdog expired")),
      { once: true },
    );
  });

  await assert.rejects(
    Promise.race([
      runPublishPreflight({ rootDir, registryUrl, registryTimeoutMs: 25 }),
      watchdog,
    ]),
    /registry request timed out for @pretable\/react/i,
  );
});

test("rejects malformed dependency fields with manifest context", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: "@pretable/ui@0.0.2",
      }),
    ],
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/react/);
      assert.match(error.message, /dependencies/);
      assert.match(error.message, /packages\/package-0\/package\.json/);
      return true;
    },
  );
});

test("caches encoded registry requests while preserving a registry path prefix", async (t) => {
  const rootDir = await mkdtemp(join(tmpdir(), "pretable-publish-preflight-"));
  t.after(() => rm(rootDir, { force: true, recursive: true }));
  const manifests = [
    publicPackage("@pretable/react", "1.0.0", {
      dependencies: { "@pretable/ui": "workspace:*" },
    }),
    publicPackage("@pretable/ui", "1.0.0"),
  ];
  await Promise.all(
    manifests.map(async (manifest, index) => {
      const packageDir = join(rootDir, "packages", `package-${index}`);
      await mkdir(packageDir, { recursive: true });
      await writeFile(
        join(packageDir, "package.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }),
  );
  const requestedUrls = [];
  const fetch = async (url) => {
    requestedUrls.push(url.href);
    return new Response(JSON.stringify({ versions: {} }), {
      headers: { "content-type": "application/json" },
      status: 200,
    });
  };

  await runPublishPreflight({
    fetch,
    registryUrl: "https://registry.example.test/custom/npm/",
    rootDir,
  });

  assert.equal(
    requestedUrls.filter((url) => url.includes("%40pretable%2Fui")).length,
    1,
  );
  assert.ok(
    requestedUrls.includes(
      "https://registry.example.test/custom/npm/%40pretable%2Fui",
    ),
  );
});

test("accepts dependencies whose published versions satisfy their specifications", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/ui": "0.0.2" },
      }),
    ],
    registry: { "@pretable/ui": ["0.0.2"] },
  });

  await assert.doesNotReject(() =>
    runPublishPreflight({ rootDir, registryUrl }),
  );
});

test("reports the dependent package, dependency, and missing version", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/ui": "0.0.2" },
      }),
    ],
    registry: { "@pretable/ui": ["0.0.1"] },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    /@pretable\/react.*@pretable\/ui.*0\.0\.2/,
  );
});

test("rejects an optional dependency whose version is missing", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        optionalDependencies: { "@pretable/ui": "0.0.2" },
      }),
    ],
    registry: { "@pretable/ui": ["0.0.1"] },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    /@pretable\/react.*@pretable\/ui.*0\.0\.2/,
  );
});

test("rejects a peer dependency whose version is missing", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        peerDependencies: { "@pretable/ui": "0.0.2" },
      }),
    ],
    registry: { "@pretable/ui": ["0.0.1"] },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    /@pretable\/react.*@pretable\/ui.*0\.0\.2/,
  );
});

test("rejects when registry metadata cannot be read", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/ui": "0.0.2" },
      }),
    ],
    registry: { "@pretable/ui": "error" },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/ui/);
      assert.match(error.message, /registry/i);
      return true;
    },
  );
});

test("rejects every withdrawn local package version in sorted order", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    apps: [publicPackage("@pretable/stream-adapter", "0.1.0")],
    packages: [publicPackage("@pretable/core", "0.1.0")],
    registry: {
      "@pretable/stream-adapter": {
        versions: ["0.0.14", "0.2.0"],
        time: ["created", "modified", "0.1.0", "0.0.14", "0.2.0"],
      },
      "@pretable/core": {
        versions: ["0.0.14", "0.2.0"],
        time: ["created", "modified", "0.1.0", "0.0.14", "0.2.0"],
      },
    },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /previously published/i);
      assert.match(error.message, /no longer active/i);
      assert.match(error.message, /cannot be reused/i);
      assert.match(error.message, /choose a new version/i);
      const coreIndex = error.message.indexOf("@pretable/core@0.1.0");
      const streamIndex = error.message.indexOf(
        "@pretable/stream-adapter@0.1.0",
      );
      assert.ok(coreIndex >= 0);
      assert.ok(streamIndex > coreIndex);
      return true;
    },
  );
});

test("distinguishes active and genuinely new local package versions", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/core", "0.3.1", {
        dependencies: { "@pretable/ui": "workspace:*" },
      }),
      publicPackage("@pretable/ui", "0.3.2"),
    ],
    registry: {
      "@pretable/core": {
        versions: ["0.3.1"],
        time: ["created", "modified", "0.3.1"],
      },
      "@pretable/ui": ["0.3.1"],
    },
  });

  const result = await runPublishPreflight({ rootDir, registryUrl });

  assert.equal(result.publicPackageCount, 2);
  assert.equal(result.sameBatchPackageCount, 1);
  assert.equal(result.checkedEdgeCount, 1);
  assert.equal(result.sameBatchEdgeCount, 1);
  assert.equal(result.registrySatisfiedEdgeCount, 0);
});

test("rejects malformed registry time metadata with package context", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [publicPackage("@pretable/core", "0.3.1")],
    registry: {
      "@pretable/core": { versions: ["0.3.1"], time: "invalid" },
    },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/core/);
      assert.match(error.message, /registry metadata/i);
      assert.match(error.message, /time object/i);
      return true;
    },
  );
});

test("does not satisfy a non-local dependency from registry history", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.3.1", {
        dependencies: { "@pretable/ui": "0.1.0" },
      }),
    ],
    registry: {
      "@pretable/react": {
        versions: ["0.3.1"],
        time: ["0.3.1"],
      },
      "@pretable/ui": {
        versions: ["0.0.14"],
        time: ["0.0.14", "0.1.0"],
      },
    },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/react/);
      assert.match(error.message, /@pretable\/ui/);
      assert.match(error.message, /0\.1\.0/);
      assert.match(error.message, /unavailable from the registry/i);
      assert.doesNotMatch(error.message, /previously published/i);
      return true;
    },
  );
});

test("accepts an unpublished non-private local dependency in the same batch", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/ui": "workspace:*" },
      }),
      publicPackage("@pretable/ui", "0.0.2"),
    ],
  });

  await assert.doesNotReject(() =>
    runPublishPreflight({ rootDir, registryUrl }),
  );
});

test("accepts unpublished exact and range dependencies from the same batch", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: {
          "@pretable/exact-local": "1.2.3",
          "@pretable/range-local": "^1.2.0",
        },
      }),
      publicPackage("@pretable/exact-local", "1.2.3"),
      publicPackage("@pretable/range-local", "1.2.3"),
    ],
  });

  await assert.doesNotReject(() =>
    runPublishPreflight({ rootDir, registryUrl }),
  );
});

test("rejects an unpublished local dependency whose version does not satisfy the specification", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/ui": "1.2.3" },
      }),
      publicPackage("@pretable/ui", "1.2.4"),
    ],
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    /@pretable\/react.*@pretable\/ui.*1\.2\.3/,
  );
});

test("rejects a workspace dependency that has no matching local package", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/ui": "workspace:*" },
      }),
    ],
    registry: { "@pretable/ui": ["1.2.3"] },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/react/);
      assert.match(error.message, /@pretable\/ui/);
      assert.match(error.message, /workspace:\*/);
      assert.match(error.message, /local/i);
      return true;
    },
  );
});

test("validates dependencies, optionalDependencies, and peerDependencies but ignores devDependencies", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/dependency": "1.2.3" },
        optionalDependencies: { "@pretable/optional": "1.2.3" },
        peerDependencies: { "@pretable/peer": "1.2.3" },
        devDependencies: { "@pretable/dev-only": "99.0.0" },
      }),
    ],
    registry: {
      "@pretable/dependency": ["1.2.3"],
      "@pretable/optional": ["1.2.3"],
      "@pretable/peer": ["1.2.3"],
    },
  });

  await assert.doesNotReject(() =>
    runPublishPreflight({ rootDir, registryUrl }),
  );
});

test("accepts exact, range, and workspace dependency specifications", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: {
          "@pretable/exact": "1.2.3",
          "@pretable/range": "^1.2.0",
          "@pretable/workspace-any": "workspace:*",
          "@pretable/workspace-caret": "workspace:^",
          "@pretable/workspace-tilde": "workspace:~",
        },
      }),
      publicPackage("@pretable/workspace-any", "1.2.3"),
      publicPackage("@pretable/workspace-caret", "1.2.3"),
      publicPackage("@pretable/workspace-tilde", "1.2.3"),
    ],
    registry: {
      "@pretable/exact": ["1.2.3"],
      "@pretable/range": ["1.3.0"],
    },
  });

  await assert.doesNotReject(() =>
    runPublishPreflight({ rootDir, registryUrl }),
  );
});

test("rejects a semantic range with no satisfying registry version", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/ui": "^1.2.0" },
      }),
    ],
    registry: { "@pretable/ui": ["2.0.0"] },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    /@pretable\/react.*@pretable\/ui.*\^1\.2\.0/,
  );
});

for (const specification of [
  "file:../ui",
  "link:../ui",
  "git+https://example.test/pretable-ui.git",
  "https://example.test/pretable-ui.tgz",
  "npm:@other/ui@1.2.3",
]) {
  test(`rejects unsupported dependency protocol ${specification}`, async (t) => {
    const { rootDir, registryUrl } = await createFixture(t, {
      packages: [
        publicPackage("@pretable/react", "0.0.2", {
          dependencies: { "@pretable/ui": specification },
        }),
      ],
    });

    await assert.rejects(
      () => runPublishPreflight({ rootDir, registryUrl }),
      (error) => {
        assert.match(error.message, /@pretable\/react/);
        assert.match(error.message, /@pretable\/ui/);
        assert.match(error.message, /unsupported|protocol/i);
        assert.match(
          error.message,
          new RegExp(specification.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        );
        return true;
      },
    );
  });
}

test("rejects private local dependencies for workspace, exact, and range specifications", async (t) => {
  const { rootDir, registryUrl } = await createFixture(t, {
    packages: [
      publicPackage("@pretable/react", "0.0.2", {
        dependencies: { "@pretable/private": "workspace:*" },
        optionalDependencies: { "@pretable/private": "1.2.3" },
        peerDependencies: { "@pretable/private": "^1.2.0" },
      }),
      { name: "@pretable/private", version: "1.2.3", private: true },
    ],
    registry: { "@pretable/private": ["1.2.3"] },
  });

  await assert.rejects(
    () => runPublishPreflight({ rootDir, registryUrl }),
    (error) => {
      assert.match(error.message, /@pretable\/react/);
      assert.match(error.message, /@pretable\/private/);
      assert.match(error.message, /workspace:\*/);
      assert.match(error.message, /1\.2\.3/);
      assert.match(error.message, /\^1\.2\.0/);
      assert.match(error.message, /private/i);
      return true;
    },
  );
});
