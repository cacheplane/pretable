import { defineConfig, devices } from "@playwright/test";

import { getVercelProtectionBypassHeaders } from "./playwright-headers";

const baseURL = process.env.BASE_URL ?? "https://pretable.vercel.app";
const extraHTTPHeaders = getVercelProtectionBypassHeaders(process.env);

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    ...(extraHTTPHeaders ? { extraHTTPHeaders } : {}),
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});
