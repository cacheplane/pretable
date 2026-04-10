import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PRETABLE_BENCH_BASE_URL ?? "http://127.0.0.1:4173";
const useExternalServer = process.env.PRETABLE_BENCH_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./apps/bench/tests",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "off",
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
