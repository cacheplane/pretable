import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const skippedManifestPaths = [
  "packages/json-stream/package.json",
  "packages/stream-adapter/package.json",
  "packages/ui/package.json",
];

const dryRun = process.argv.includes("--dry-run");

for (const manifestPath of skippedManifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  if (dryRun) {
    console.log(`Would skip ${manifest.name} during release publish.`);
    continue;
  }

  manifest.private = true;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `Skipping ${manifest.name} until npm trusted publishing is configured.`,
  );
}

if (dryRun) {
  process.exit(0);
}

const child = spawn("pnpm", ["exec", "changeset", "publish"], {
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
