import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: { command: "npx vite --config tests/vite.config.ts", url: "http://127.0.0.1:5178", reuseExistingServer: false },
});
