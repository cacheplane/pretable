import { createServer } from "node:net";

export async function reserveAvailablePort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once("error", reject);
    reservation.listen(0, "127.0.0.1", resolve);
  });
  const address = reservation.address();
  const port =
    typeof address === "object" && address !== null ? address.port : 0;
  await new Promise((resolve, reject) =>
    reservation.close((error) => (error ? reject(error) : resolve())),
  );
  if (port === 0) throw new Error("Could not reserve a preview port.");
  return port;
}

export function previewArgsForPort(args, port) {
  const result = [...args];
  const index = result.indexOf("--port");
  if (index < 0 || index + 1 >= result.length)
    throw new Error("Preview launch is missing --port.");
  result[index + 1] = String(port);
  return result;
}

export async function waitForOwnedServer(
  url,
  server,
  { timeoutMs = 30_000, fetchImpl = fetch, delay = defaultDelay } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error("Benchmark preview exited early.");
    try {
      if ((await fetchImpl(url)).ok) {
        await delay(50);
        if (server.exitCode !== null)
          throw new Error(
            "Benchmark preview exited during readiness verification.",
          );
        return;
      }
    } catch (error) {
      if (server.exitCode !== null) throw error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${url}.`);
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
