import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    testTimeout: 20_000,
    clearMocks: true,
    restoreMocks: true
  }
});
