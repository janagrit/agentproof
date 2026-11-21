import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["**/*.spec.ts"],
  timeout: 20_000,
  expect: { timeout: 4_000 },
  workers: 1,
  use: { baseURL: process.env.BASE_URL || "http://localhost:4000", headless: true },
});
