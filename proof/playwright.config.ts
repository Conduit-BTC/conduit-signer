import { defineConfig } from "@playwright/test"
export default defineConfig({
  testDir: ".",
  testMatch:
    process.env.PROOF_BROWSER_DIAGNOSTIC === "offline-emulation"
      ? "offline-emulation.playwright.ts"
      : "proof.playwright.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: "../test-results",
  use: { screenshot: "off", video: "off", trace: "off" },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: "bun proof/server.ts",
    cwd: "..",
    url: "http://localhost:7030",
    reuseExistingServer: false,
    timeout: 30000,
  },
})
