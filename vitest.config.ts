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
    // Many src/__tests__/integration/*.test.ts files hit the same live
    // Supabase project, Anthropic API, and Playwright sessions with real
    // network round-trips. Vitest's default thread pool runs test files
    // concurrently, so under real-world network jitter these files contend
    // for the same resources and a different file's hook/test times out each
    // run (observed 2026-08-22: ag19, autoapply-risk-scoring, and
    // platform-config-org-scope each timed out in separate full-suite runs,
    // each passing cleanly standalone). Serializing file execution removes
    // the contention rather than chasing individual timeout bumps file by
    // file.
    fileParallelism: false,
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
