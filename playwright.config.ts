import { defineConfig } from "@playwright/test";
import {configureTestDisplay} from './tests/display.ts';
configureTestDisplay();

export default defineConfig({
  testDir: "tests",
  timeout: 60_000,
  // CI runners are slower than a desktop: longer waits and one retry there.
  expect: { timeout: process.env.CI ? 15_000 : 5_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  use: { trace: "retain-on-failure" },
  webServer: { command: "npx vite --config tests/vite.config.ts", url: "http://127.0.0.1:5178", reuseExistingServer: false },
});
