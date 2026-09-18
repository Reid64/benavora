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
    exclude: [
      "node_modules",
      ".next",
      "tests/e2e/**",
      "src/__tests__/integration-live/**",
      // src/__tests__/integration/*.test.ts hit real Playwright browsers, the
      // live Anthropic API, and a live Supabase project (2026-09-17: the
      // default `pnpm test` gate - 300s budget, 156 spec files - was killed
      // by timeout with these files still running; a single one of them,
      // form-analyzer-filler.test.ts, launches a real browser against
      // httpbin.org and makes a real Claude call per test). They still run
      // serialized (see the fileParallelism note in vitest.integration.config.ts,
      // which is where they moved) via `pnpm test:integration` - just not
      // inside the fast default suite the gate enforces.
      "src/__tests__/integration/**",
    ],
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
