import { spawn as nodeSpawn } from "node:child_process";

import { runPublishPreflight } from "./publish-preflight.mjs";

export function spawnChangesetsPublish({
  environment = process.env,
  spawn = nodeSpawn,
} = {}) {
  return new Promise((resolve, reject) => {
    let child;

    try {
      child = spawn("pnpm", ["exec", "changeset", "publish"], {
        env: environment,
        shell: false,
        stdio: "inherit",
      });
    } catch (error) {
      reject(error);
      return;
    }

    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) {
        const error = new Error(`Changesets publish terminated by ${signal}`);
        error.exitCode = exitCode;
        error.signal = signal;
        reject(error);
        return;
      }

      if (exitCode !== 0) {
        const error = new Error(
          `Changesets publish exited with code ${String(exitCode)}`,
        );
        error.exitCode = exitCode;
        error.signal = signal;
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function publishPublicPackages({
  preflight = runPublishPreflight,
  spawnPublish = spawnChangesetsPublish,
} = {}) {
  await preflight();
  await spawnPublish();
}

export async function runPublishCli({
  args = process.argv.slice(2),
  processLike = process,
  publish = publishPublicPackages,
  reportError = (message) => console.error(message),
} = {}) {
  if (args.length > 0) {
    reportError(
      `Public package publish failed: unsupported argument${args.length === 1 ? "" : "s"}: ${args.join(" ")}`,
    );
    processLike.exitCode = 1;
    return;
  }

  try {
    await publish();
  } catch (error) {
    reportError(
      `Public package publish failed: ${error instanceof Error ? error.message : String(error)}`,
    );

    if (error?.signal) {
      processLike.kill(processLike.pid, error.signal);
      return;
    }

    processLike.exitCode =
      Number.isInteger(error?.exitCode) && error.exitCode !== 0
        ? error.exitCode
        : 1;
  }
}
