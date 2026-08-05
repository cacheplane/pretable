import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  publishPublicPackages,
  runPublishCli,
  spawnChangesetsPublish,
} from "../publish-public-packages.mjs";

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

test("spawns Changesets without a shell and inherits stdio", async () => {
  const child = new EventEmitter();
  let invocation;
  const spawn = (...args) => {
    invocation = args;
    return child;
  };

  const publishing = spawnChangesetsPublish({ spawn });
  child.emit("exit", 0, null);
  await publishing;

  assert.deepEqual(invocation, [
    "pnpm",
    ["exec", "changeset", "publish"],
    { shell: false, stdio: "inherit" },
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
