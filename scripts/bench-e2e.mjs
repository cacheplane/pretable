import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function normalizeBenchE2EArgs(args) {
  if (args[0] === "--") {
    return args.slice(1);
  }

  return args;
}

function run() {
  const child = spawn(
    "pnpm",
    [
      "exec",
      "playwright",
      "test",
      ...normalizeBenchE2EArgs(process.argv.slice(2)),
    ],
    {
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 1);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run();
}
