import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:8000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        channel: "chromium-headless-shell",
      },
    },
  ],
});
