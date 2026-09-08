import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e/specs",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  reporter: [["list"], ["html", { outputFolder: ".e2e/report", open: "never" }]],
  use: {
    baseURL: "http://localhost:3100",
    trace: "on",
    screenshot: "on",
    video: "on",
  },
})
