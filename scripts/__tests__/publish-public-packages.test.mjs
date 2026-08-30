import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

import { discoverWorkspacePackages } from "../publish-preflight.mjs";
import {
  publishPublicPackages,
  runPublishCli,
  spawnChangesetsPublish,
} from "../publish-public-packages.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));

test("keeps every publishable package in one fixed Changesets group", async () => {
  const config = JSON.parse(
    await readFile(join(REPO_ROOT, ".changeset", "config.json"), "utf8"),
  );
  const publishablePackageNames = (await discoverWorkspacePackages(REPO_ROOT))
    .filter(({ manifest }) => manifest.private !== true)
    .map(({ manifest }) => manifest.name)
    .sort();

  assert.deepEqual(config.fixed, [publishablePackageNames]);
});

test("runs the preflight before publishing", async () => {
  const events = [];

  await publishPublicPackages({
    preflight: async () => events.push("preflight"),
    spawnPublish: async () => events.push("publish"),
  });

  assert.deepEqual(events, ["preflight", "publish"]);
});

test("does not publish when the preflight rejects", async () => {
  const preflightError = new Error("preflight failed");
  let published = false;

  await assert.rejects(
    publishPublicPackages({
      preflight: async () => {
        throw preflightError;
      },
      spawnPublish: async () => {
        published = true;
      },
    }),
    (error) => error === preflightError,
  );

  assert.equal(published, false);
});

test("spawns Changesets without a shell and preserves the Action v2 output channel", async () => {
  const child = new EventEmitter();
  const environment = { CHANGESETS_OUTPUT: "/tmp/changesets-output.json" };
  let invocation;
  const spawn = (...args) => {
    invocation = args;
    return child;
  };

  const publishing = spawnChangesetsPublish({ environment, spawn });
  child.emit("exit", 0, null);
  await publishing;

  assert.deepEqual(invocation, [
    "pnpm",
    ["exec", "changeset", "publish"],
    { env: environment, shell: false, stdio: "inherit" },
  ]);
});

test("rejects with the Changesets nonzero exit code", async () => {
  const child = new EventEmitter();
  const publishing = spawnChangesetsPublish({ spawn: () => child });

  child.emit("exit", 17, null);

  await assert.rejects(publishing, (error) => {
    assert.match(error.message, /changesets publish exited with code 17/i);
    assert.equal(error.exitCode, 17);
    assert.equal(error.signal, null);
    return true;
  });
});

test("rejects with the signal that terminated Changesets", async () => {
  const child = new EventEmitter();
  const publishing = spawnChangesetsPublish({ spawn: () => child });

  child.emit("exit", null, "SIGTERM");

  await assert.rejects(publishing, (error) => {
    assert.match(error.message, /changesets publish terminated by SIGTERM/i);
    assert.equal(error.exitCode, null);
    assert.equal(error.signal, "SIGTERM");
    return true;
  });
});

test("propagates errors from spawning Changesets", async () => {
  const child = new EventEmitter();
  const spawnError = new Error("unable to spawn pnpm");
  const publishing = spawnChangesetsPublish({ spawn: () => child });

  child.emit("error", spawnError);

  await assert.rejects(publishing, (error) => error === spawnError);
});

test("propagates an error thrown synchronously while spawning Changesets", async () => {
  const spawnError = new Error("spawn threw");
  const publishing = spawnChangesetsPublish({
    spawn: () => {
      throw spawnError;
    },
  });

  await assert.rejects(publishing, (error) => error === spawnError);
});

test("keeps the first spawn error when the child subsequently exits", async () => {
  const child = new EventEmitter();
  const spawnError = new Error("unable to spawn pnpm");
  const publishing = spawnChangesetsPublish({ spawn: () => child });

  child.emit("error", spawnError);
  child.emit("exit", 17, null);

  await assert.rejects(publishing, (error) => error === spawnError);
});

test("the publish CLI propagates a terminating signal", async () => {
  const publishError = new Error("publish terminated");
  publishError.signal = "SIGTERM";
  const signals = [];
  const messages = [];
  const processLike = {
    pid: 1234,
    kill: (pid, signal) => signals.push([pid, signal]),
  };

  await runPublishCli({
    processLike,
    publish: async () => {
      throw publishError;
    },
    reportError: (message) => messages.push(message),
  });

  assert.deepEqual(signals, [[1234, "SIGTERM"]]);
  assert.equal(processLike.exitCode, undefined);
  assert.deepEqual(messages, [
    "Public package publish failed: publish terminated",
  ]);
});

test("the publish CLI preserves a nonzero exit code", async () => {
  const publishError = new Error("publish failed");
  publishError.exitCode = 17;
  const processLike = {
    pid: 1234,
    kill: () => assert.fail("unexpected signal propagation"),
  };

  await runPublishCli({
    processLike,
    publish: async () => {
      throw publishError;
    },
    reportError: () => {},
  });

  assert.equal(processLike.exitCode, 17);
});

test("the publish CLI exits with 1 for a generic failure", async () => {
  const processLike = {
    pid: 1234,
    kill: () => assert.fail("unexpected signal propagation"),
  };

  await runPublishCli({
    processLike,
    publish: async () => {
      throw new Error("preflight failed");
    },
    reportError: () => {},
  });

  assert.equal(processLike.exitCode, 1);
});

for (const argument of ["--dry-run", "--unknown"]) {
  test(`the publish CLI rejects unsupported argument ${argument} without publishing`, async () => {
    const operations = [];
    const messages = [];
    const processLike = {};

    await runPublishCli({
      args: [argument],
      processLike,
      publish: () =>
        publishPublicPackages({
          preflight: async () => operations.push("preflight"),
          spawnPublish: async () => operations.push("publish"),
        }),
      reportError: (message) => messages.push(message),
    });

    assert.deepEqual(operations, []);
    assert.equal(processLike.exitCode, 1);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /unsupported argument/i);
    assert.match(messages[0], new RegExp(argument));
  });
}
