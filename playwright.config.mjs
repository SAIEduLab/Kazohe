import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  outputDir: `test-results/${process.env.E2E_REPORT_NAME || "combined"}`,
  timeout: 90000,
  expect: { timeout: 8000 },
  workers: 1,
  retries: 0,
  fullyParallel: false,
  reporter: [
    ["list"],
    [
      "html",
      {
        open: "never",
        outputFolder: `playwright-report/${process.env.E2E_REPORT_NAME || "combined"}`,
      },
    ],
    ["./scripts/test-reporter.mjs"],
  ],
  use: {
    viewport: { width: 1366, height: 768 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
});
