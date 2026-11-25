import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "test",
  testMatch: "e2e.spec.js",
  timeout: 120000,
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:47831" },
  webServer: {
    command: "npm start",
    url: "http://127.0.0.1:47831/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 180000,
  },
});
