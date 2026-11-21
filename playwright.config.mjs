import { defineConfig } from "@playwright/test";

export default defineConfig({
  // Only rec2test specs (reference/ and generated ones in out/). Unit tests
  // in test/ use node:test, not Playwright.
  testDir: "rec2test",
  testMatch: ["**/*.spec.ts"],
  timeout: 20_000,
  expect: { timeout: 4_000 },
  workers: 1,
  use: { baseURL: process.env.BASE_URL || "http://localhost:4000", headless: true },
});
