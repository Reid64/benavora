import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.spec.ts",
      "tests/**/*.test.ts",
    ],
    exclude: ["node_modules", ".next", "tests/e2e/**", "src/__tests__/integration-live/**"],
    passWithNoTests: true,
    setupFiles: ["tests/setup.ts"],
    testTimeout: 30000,
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
