import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runPublishPreflight } from "../publish-preflight.mjs";

async function createFixture(t, { packages, registry = {} }) {
  const rootDir = await mkdtemp(join(tmpdir(), "pretable-publish-preflight-"));

  await Promise.all(
    packages.map(async (manifest, index) => {
      const packageDir = join(rootDir, "packages", `package-${index}`);
      await mkdir(packageDir, { recursive: true });
      await writeFile(
        join(packageDir, "package.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
    }),
  );

  const server = createServer((request, response) => {
    const packageName = decodeURIComponent(
      (request.url ?? "/").slice(1).split("?")[0],
    );
    const result = registry[packageName];

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
    response.end(
      JSON.stringify({
        versions: Object.fromEntries(result.map((version) => [version, {}])),
      }),
    );
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(rootDir, { force: true, recursive: true });
  });

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
