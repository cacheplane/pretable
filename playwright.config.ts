import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PRETABLE_BENCH_BASE_URL ?? "http://127.0.0.1:4173";
const useExternalServer = process.env.PRETABLE_BENCH_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./apps/bench/tests",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The HTML report is what the `bench-e2e` job uploads on a red run. A local
  // run keeps the plain list it has always printed.
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // A retry that produces no evidence only tells you the test is red twice.
    // `on-first-retry` costs the passing path nothing.
    //
    // `apps/bench/tests/bench.spec.ts` opts back out with its own
    // `test.use({ trace: "off" })`: it drives `context.tracing` by hand to write
    // the run's trace zip into `status/traces/`, and a second `tracing.start()`
    // on an already-traced context throws.
    trace: process.env.CI ? "on-first-retry" : "off",
    // Cheap, and unlike `trace` it never collides with a spec's own tracing.
    screenshot: process.env.CI ? "only-on-failure" : "off",
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: "pnpm --filter @pretable/app-bench preview:bench",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 30_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
