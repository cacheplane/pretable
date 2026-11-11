import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// A real client-router Flight request is essential: aborting an HTML document
// does not reproduce #377. Keep this disposable app out of the deployed site.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const website = join(root, "apps/website");
const require = createRequire(join(website, "package.json"));
const next = require.resolve("next/dist/bin/next");
const version = JSON.parse(
  await readFile(require.resolve("next/package.json"), "utf8"),
).version;
const fixture = await mkdtemp(join(tmpdir(), "pretable-next-abort-"));
const expectAbortError = process.argv.includes("--expect-abort-error");
let server;
let browser;
let output = "";

async function waitFor(predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error(`Timed out: ${label}\n${output}`);
    await delay(50);
  }
}

try {
  await mkdir(join(fixture, "app/slow"), { recursive: true });
  await mkdir(join(fixture, "app/fail"), { recursive: true });
  await symlink(join(website, "node_modules"), join(fixture, "node_modules"));
  const files = {
    "package.json": JSON.stringify({ private: true, type: "module" }),
    "next.config.mjs": "export default { experimental: { cpus: 2 } };\n",
    "app/layout.jsx":
      "export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n",
    "app/page.jsx": `import Link from "next/link";
export default async function Home({ searchParams }) {
  const { id = "complete" } = await searchParams;
  return <Link href={"/slow?id=" + id} prefetch={false}>Start stream</Link>;
}\n`,
    "app/slow/loading.jsx":
      "export default function Loading() { return <p>Streaming fallback</p>; }\n",
    "app/slow/page.jsx": `export const dynamic = "force-dynamic";
function Marker({ id }) { console.log("RENDER-COMPLETED " + id); return <p>Finished {id}</p>; }
export default async function Slow({ searchParams }) {
  const { id } = await searchParams;
  console.log("RENDER-STARTED " + id);
  await new Promise(resolve => setTimeout(resolve, 2000));
  console.log("SUSPENSION-RESOLVED " + id);
  return <Marker id={id} />;
}\n`,
    "app/fail/page.jsx":
      'export const dynamic = "force-dynamic"; export default function Fail() { throw new Error("PRETABLE-GENUINE-RENDER-FAILURE"); }\n',
    "instrumentation.js":
      'export function onRequestError(error) { console.log("REQUEST-ERROR " + error.message); }\n',
  };
  for (const [name, contents] of Object.entries(files))
    await writeFile(join(fixture, name), contents);
  const build = spawn(process.execPath, [next, "build", "--webpack"], {
    cwd: fixture,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let buildOutput = "";
  build.stdout.on("data", (chunk) => {
    buildOutput += chunk;
  });
  build.stderr.on("data", (chunk) => {
    buildOutput += chunk;
  });
  assert.equal((await once(build, "exit"))[0], 0, buildOutput);
  server = spawn(
    process.execPath,
    [next, "start", "--hostname", "127.0.0.1", "--port", "0"],
    {
      cwd: fixture,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", (chunk) => {
    output += chunk;
  });
  server.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await waitFor(() => /Ready in/.test(output), "server readiness");
  const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
  assert.ok(url, output);
  browser = await chromium.launch();

  // Positive control: the child really renders when the request completes.
  const complete = await browser.newContext();
  const page = await complete.newPage();
  await page.goto(`${url}/?id=complete`);
  await page.getByRole("link", { name: "Start stream" }).click();
  await page.getByText("Finished complete").waitFor();
  assert.match(output, /RENDER-COMPLETED complete/);
  await complete.close();

  const aborted = await browser.newContext();
  const abortPage = await aborted.newPage();
  await abortPage.goto(`${url}/?id=abort`);
  await abortPage.getByRole("link", { name: "Start stream" }).click();
  await abortPage.getByText("Streaming fallback").waitFor();
  await waitFor(
    () => output.includes("RENDER-STARTED abort"),
    "in-flight Flight render",
  );
  await aborted.close();
  // Let the suspended component resolve. Its child must never be rendered.
  await waitFor(
    () => output.includes("SUSPENSION-RESOLVED abort"),
    "aborted component's suspended work settling",
  );
  await delay(100);
  assert.doesNotMatch(
    output,
    /RENDER-COMPLETED abort/,
    "aborting must still cancel React rendering",
  );
  const abortErrors =
    output.match(/The destination stream closed early\./g)?.length ?? 0;
  assert.equal(abortErrors > 0, expectAbortError, output);

  const response = await fetch(`${url}/fail`);
  await response.text();
  await waitFor(
    () => output.includes("REQUEST-ERROR PRETABLE-GENUINE-RENDER-FAILURE"),
    "genuine error reporting",
  );
  console.log(
    JSON.stringify({
      next: version,
      abortErrors,
      cancellationPreserved: true,
      genuineErrorReported: true,
    }),
  );
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = once(server, "exit");
    server.kill("SIGTERM");
    await exited;
  }
  await rm(fixture, { recursive: true, force: true });
}
